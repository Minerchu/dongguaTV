'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

function cleanId(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
}

function cleanText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max || 500);
}

function safeJson(value, fallback) {
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(String(value || '')); } catch (e) { return fallback; }
}

function createAdapterRegistry(options) {
    const config = Object.assign({
        dir: path.join(process.cwd(), 'data', 'adapters'),
        timeout: 15000
    }, options || {});
    const dir = path.resolve(config.dir);
    let entries = new Map();
    let loadedAt = 0;
    let lastError = '';

    function httpFor(site, adapterConfig) {
        const baseURL = cleanText(site.baseUrl || adapterConfig.baseUrl, 500).replace(/\/+$/, '');
        const instance = axios.create({
            baseURL,
            timeout: Math.max(1000, Number(adapterConfig.timeout) || config.timeout),
            validateStatus: () => true,
            maxRedirects: 3,
            headers: Object.assign({
                'User-Agent': 'Mozilla/5.0 DongguaTV/2.0',
                'Accept': 'application/json,text/html,text/plain,*/*'
            }, adapterConfig.headers || {})
        });
        const check = (response) => {
            if (!response || response.status >= 400) {
                const error = new Error('上游返回 HTTP ' + (response && response.status));
                error.response = response;
                throw error;
            }
            return response;
        };
        return {
            client: instance,
            get: (...args) => instance.get(...args).then(check),
            post: (...args) => instance.post(...args).then(check),
            getJson: async (url, params) => {
                const response = await instance.get(url, { params });
                check(response);
                return response.data;
            },
            getText: async (url, params) => {
                const response = await instance.get(url, { params, responseType: 'text' });
                check(response);
                return response.data;
            }
        };
    }

    function normalizeSearchItem(item, site, index) {
        const raw = item && typeof item === 'object' ? item : {};
        const id = cleanText(raw.id ?? raw.vod_id ?? raw.vodId ?? raw.key, 120);
        const name = cleanText(raw.name ?? raw.title ?? raw.vod_name ?? raw.vodName, 200);
        if (!id || !name) return null;
        return {
            vod_id: id,
            vod_name: name,
            vod_pic: cleanText(raw.pic ?? raw.poster ?? raw.vod_pic ?? raw.cover, 1000),
            vod_remarks: cleanText(raw.remarks ?? raw.note ?? raw.vod_remarks, 200),
            vod_year: cleanText(raw.year ?? raw.vod_year, 8),
            type_name: cleanText(raw.type ?? raw.typeName ?? raw.type_name, 80),
            vod_lang: cleanText(raw.lang ?? raw.language, 40),
            vod_area: cleanText(raw.area ?? raw.region, 40),
            vod_actor: cleanText(raw.actors ?? raw.actor ?? raw.vod_actor, 500),
            vod_director: cleanText(raw.director ?? raw.vod_director, 240),
            site_key: site.key,
            site_name: site.name,
            latency: Math.max(0, Number(raw.latency) || 0),
            adapter: site.adapter,
            _adapter_index: index
        };
    }

    function normalizeDetail(data, site, id) {
        const raw = data && typeof data === 'object' ? data : {};
        if (raw.list && Array.isArray(raw.list) && raw.list[0]) {
            return { list: raw.list.map(item => Object.assign({}, item, {
                site_key: site.key,
                site_name: site.name,
                adapter: site.adapter
            })) };
        }
        const name = cleanText(raw.name ?? raw.title ?? raw.vod_name, 200) || '未命名影片';
        const episodes = [];
        const seen = new Set();
        const addEpisode = (episode, index) => {
            if (!episode) return;
            const url = cleanText(typeof episode === 'string' ? episode : (episode.url || episode.playUrl || episode.play_url), 2000);
            if (!url || seen.has(url)) return;
            seen.add(url);
            episodes.push({
                name: cleanText(typeof episode === 'string' ? '' : (episode.name || episode.title), 80) || (index === 0 ? '正片' : '第 ' + (index + 1) + ' 集'),
                url
            });
        };
        const sourceEpisodes = Array.isArray(raw.episodes) ? raw.episodes : [];
        sourceEpisodes.forEach(addEpisode);
        if (!episodes.length) addEpisode(raw.playUrl || raw.play_url || raw.url, 0);
        if (!episodes.length) throw new Error('适配器详情没有返回可播放地址');
        return {
            list: [{
                vod_id: cleanText(raw.id ?? raw.vod_id, 120) || id,
                vod_name: name,
                vod_pic: cleanText(raw.pic ?? raw.poster ?? raw.vod_pic, 1000),
                vod_content: cleanText(raw.content ?? raw.overview ?? raw.description, 5000),
                vod_actor: cleanText(raw.actors ?? raw.actor ?? raw.vod_actor, 500),
                vod_director: cleanText(raw.director ?? raw.vod_director, 240),
                vod_year: cleanText(raw.year ?? raw.vod_year, 8),
                vod_area: cleanText(raw.area ?? raw.vod_area, 80),
                vod_remarks: cleanText(raw.remarks ?? raw.note ?? raw.vod_remarks, 200),
                vod_play_url: episodes.map(item => item.name + '$' + item.url).join('#'),
                site_key: site.key,
                site_name: site.name,
                adapter: site.adapter
            }]
        };
    }

    function load() {
        const next = new Map();
        loadedAt = Date.now();
        lastError = '';
        try {
            fs.mkdirSync(dir, { recursive: true });
            const files = fs.readdirSync(dir, { withFileTypes: true })
                .filter(entry => entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('_'))
                .map(entry => path.join(dir, entry.name))
                .sort();
            for (const file of files) {
                try {
                    delete require.cache[require.resolve(file)];
                    const exported = require(file);
                    const adapter = exported && exported.default ? exported.default : exported;
                    if (!adapter || typeof adapter !== 'object') throw new Error('模块必须导出对象');
                    const id = cleanId(adapter.id || path.basename(file, '.js'));
                    if (!id) throw new Error('缺少 id');
                    if (typeof adapter.search !== 'function') throw new Error('缺少 search(ctx)');
                    if (typeof adapter.detail !== 'function') throw new Error('缺少 detail(ctx)');
                    next.set(id, {
                        id,
                        name: cleanText(adapter.name, 80) || id,
                        version: cleanText(adapter.version, 30),
                        description: cleanText(adapter.description, 500),
                        configExample: adapter.configExample || {},
                        file: path.basename(file),
                        search: adapter.search.bind(adapter),
                        detail: adapter.detail.bind(adapter),
                        test: typeof adapter.test === 'function' ? adapter.test.bind(adapter) : null
                    });
                } catch (error) {
                    lastError = path.basename(file) + ': ' + (error.message || error);
                    console.error('[Adapter] ' + lastError);
                }
            }
            entries = next;
            return list();
        } catch (error) {
            lastError = error.message || String(error);
            entries = next;
            return list();
        }
    }

    function list() {
        return [...entries.values()].map(adapter => ({
            id: adapter.id,
            name: adapter.name,
            version: adapter.version,
            description: adapter.description,
            configExample: adapter.configExample,
            file: adapter.file
        }));
    }

    function get(id) {
        return entries.get(cleanId(id)) || null;
    }

    function contextFor(adapter, site, extra) {
        const adapterConfig = safeJson(site.adapterConfig, {});
        const ctx = Object.assign({
            adapter: adapter.id,
            baseUrl: cleanText(site.baseUrl || adapterConfig.baseUrl, 500),
            config: adapterConfig,
            site: {
                key: site.key,
                name: site.name,
                baseUrl: cleanText(site.baseUrl, 500),
                adapterConfig
            },
            http: httpFor(site, adapterConfig)
        }, extra || {});
        return ctx;
    }

    async function callWithTimeout(fn, timeout) {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(fn),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('适配器执行超时')), Math.max(1000, timeout));
                    if (timer.unref) timer.unref();
                })
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    async function search(id, site, query) {
        const adapter = get(id);
        if (!adapter) throw new Error('适配器不存在: ' + id);
        const started = Date.now();
        const result = await callWithTimeout(
            () => adapter.search(contextFor(adapter, site, { query: cleanText(query, 120) })),
            Number(safeJson(site.adapterConfig, {}).timeout) || config.timeout
        );
        const rawList = Array.isArray(result) ? result : (result && Array.isArray(result.list) ? result.list : []);
        return rawList.map((item, index) => normalizeSearchItem(item, site, index)).filter(Boolean)
            .map(item => Object.assign(item, { latency: Math.max(item.latency, Date.now() - started) }));
    }

    async function detail(id, site, videoId) {
        const adapter = get(id);
        if (!adapter) throw new Error('适配器不存在: ' + id);
        const result = await callWithTimeout(
            () => adapter.detail(contextFor(adapter, site, { id: cleanText(videoId, 120), videoId: cleanText(videoId, 120) })),
            Number(safeJson(site.adapterConfig, {}).timeout) || config.timeout
        );
        if (!result) throw new Error('适配器没有返回详情');
        return normalizeDetail(result, site, videoId);
    }

    async function test(id, site) {
        const adapter = get(id);
        if (!adapter) throw new Error('适配器不存在: ' + id);
        const started = Date.now();
        if (adapter.test) {
            const result = await callWithTimeout(
                () => adapter.test(contextFor(adapter, site, {})),
                Number(safeJson(site.adapterConfig, {}).timeout) || config.timeout
            );
            return Object.assign({ ok: true, latency: Date.now() - started }, result || {});
        }
        const query = cleanText(safeJson(site.adapterConfig, {}).testQuery, 80) || '测试';
        const items = await search(id, site, query);
        return {
            ok: true,
            latency: Date.now() - started,
            count: items.length,
            sample: items.slice(0, 3).map(item => item.vod_name).filter(Boolean)
        };
    }

    load();

    return {
        load,
        list,
        get,
        search,
        detail,
        test,
        get dir() { return dir; },
        get loadedAt() { return loadedAt; },
        get lastError() { return lastError; }
    };
}

module.exports = { createAdapterRegistry };
