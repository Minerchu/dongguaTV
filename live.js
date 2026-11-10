'use strict';

const express = require('express');
const crypto = require('crypto');
const zlib = require('zlib');
const playback = require('./playback');

const SOURCE_LIMIT = 24;
const PLAYLIST_TTL = 10 * 60 * 1000;
const PLAYLIST_MAX_BYTES = 6 * 1024 * 1024;
const PROXY_TTL = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 15000;

function text(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max || 200);
}

function stableHash(value) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function validSourceId(value) {
    return /^[A-Za-z0-9_-]{1,48}$/.test(String(value || ''));
}

function normalizeHttpUrl(raw, baseUrl) {
    const value = text(raw, 4096);
    if (!value) return '';
    try {
        const url = new URL(value, baseUrl || undefined);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        return url.href;
    } catch (error) {
        return '';
    }
}

function hostFallback(url) {
    try {
        return new URL(url).hostname || '直播源';
    } catch (error) {
        return '直播源';
    }
}

function normalizeSources(input, options) {
    const opts = options || {};
    const list = Array.isArray(input) ? input : [];
    const output = [];
    const seenUrls = new Set();
    const seenIds = new Set();

    for (let index = 0; index < list.length; index++) {
        if (output.length >= SOURCE_LIMIT) {
            if (opts.strict) throw new Error('直播源最多只能添加 ' + SOURCE_LIMIT + ' 个');
            break;
        }
        const raw = list[index];
        if (!raw || typeof raw !== 'object') {
            if (opts.strict) throw new Error('第 ' + (index + 1) + ' 个直播源格式不正确');
            continue;
        }
        const url = normalizeHttpUrl(raw.url);
        if (!url) {
            if (opts.strict) throw new Error('第 ' + (index + 1) + ' 个直播源的订阅地址不是有效的 HTTP/HTTPS 地址');
            continue;
        }
        if (seenUrls.has(url)) {
            if (opts.strict) throw new Error('第 ' + (index + 1) + ' 个直播源与前面的订阅地址重复');
            continue;
        }

        let id = text(raw.id, 48);
        if (!validSourceId(id) || seenIds.has(id)) id = 'live_' + stableHash(url);
        let suffix = 2;
        const baseId = id;
        while (seenIds.has(id)) id = baseId.slice(0, 42) + '_' + suffix++;

        seenUrls.add(url);
        seenIds.add(id);
        output.push({
            id,
            name: text(raw.name, 60) || hostFallback(url),
            url,
            enabled: raw.enabled !== false
        });
    }
    return output;
}

function parseAttributes(line) {
    const attrs = {};
    const pattern = /([A-Za-z0-9_-]+)=\x22([^\x22]*)\x22/g;
    let match;
    while ((match = pattern.exec(line))) attrs[match[1].toLowerCase()] = match[2].trim();
    return attrs;
}

function nameFromUrl(url) {
    try {
        const parsed = new URL(url);
        const last = parsed.pathname.split('/').filter(Boolean).pop();
        if (last) {
            let decoded = last;
            try { decoded = decodeURIComponent(last); } catch (error) { }
            decoded = decoded.replace(/\.(m3u8?|flv|ts|mp4)$/i, '');
            if (decoded) return decoded;
        }
        return parsed.hostname || '未命名频道';
    } catch (error) {
        return '未命名频道';
    }
}

function parseM3u(content, baseUrl) {
    const channels = [];
    const seen = new Set();
    let pending = null;

    for (const rawLine of String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        if (/^#EXTINF/i.test(line)) {
            const attrs = parseAttributes(line);
            const stripped = line
                .replace(/([A-Za-z0-9_-]+)=\x22[^\x22]*\x22/g, '')
                .replace(/^#EXTINF\s*:\s*/i, '');
            const comma = stripped.indexOf(',');
            const title = (comma >= 0 ? stripped.slice(comma + 1) : '')
                .trim()
                .replace(/^\x22+|\x22+$/g, '');
            pending = { attrs, title, extGroup: '' };
            continue;
        }

        if (/^#EXTGRP\s*:/i.test(line)) {
            if (pending) {
                const group = line.replace(/^#EXTGRP\s*:/i, '').trim();
                if (group && !pending.extGroup) pending.extGroup = group;
            }
            continue;
        }

        if (line.startsWith('#')) continue;

        const url = normalizeHttpUrl(line, baseUrl);
        const context = pending || { attrs: {}, title: '', extGroup: '' };
        pending = null;
        if (!url || seen.has(url)) continue;

        const attrs = context.attrs || {};
        const logo = normalizeHttpUrl(attrs['tvg-logo'], baseUrl);
        const name = context.title || text(attrs['tvg-name'], 100) || nameFromUrl(url);
        const group = text(attrs['group-title'], 80) || text(context.extGroup, 80) || '未分组';
        seen.add(url);
        channels.push({
            id: text(attrs['tvg-id'], 80) || 'ch_' + stableHash(url),
            name: text(name, 120) || nameFromUrl(url),
            url,
            logo: logo || '',
            group,
            tvgId: text(attrs['tvg-id'], 80),
            rawName: text(attrs['tvg-name'], 120)
        });
    }

    return channels;
}

function decodeBuffer(buffer, encoding) {
    const type = String(encoding || '').toLowerCase();
    let output = buffer;
    try {
        if (type.includes('br')) output = zlib.brotliDecompressSync(buffer);
        else if (type.includes('gzip')) output = zlib.gunzipSync(buffer);
        else if (type.includes('deflate')) output = zlib.inflateSync(buffer);
    } catch (error) { }
    return output.toString('utf8').replace(/^\uFEFF/, '');
}

function collectWithTimeout(collect, stream, limit, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            try { stream.destroy(new Error('读取超时')); } catch (error) { }
            reject(new Error('直播数据读取超时'));
        }, timeoutMs || FETCH_TIMEOUT);
        Promise.resolve(collect(stream, limit)).then(
            value => { clearTimeout(timer); resolve(value); },
            error => { clearTimeout(timer); reject(error); }
        );
    });
}

async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            try {
                results[index] = await worker(items[index], index);
            } catch (error) {
                results[index] = { error };
            }
        }
    });
    await Promise.all(runners);
    return results;
}

function createService(options) {
    const opts = options || {};
    if (typeof opts.getSettings !== 'function') throw new Error('createService requires getSettings');
    if (!opts.secret) throw new Error('createService requires secret');

    const getSettings = opts.getSettings;
    const secret = opts.secret;
    const openStream = opts.openStream || playback.openStream;
    const collectStream = opts.collectStream || playback.collectStream;
    const cache = new Map();

    function currentSettings() {
        try {
            return getSettings() || {};
        } catch (error) {
            return {};
        }
    }

    function signProxyUrl(url, ttlMs) {
        const target = String(url || '');
        const exp = Date.now() + Number(ttlMs || PROXY_TTL);
        const sig = crypto.createHmac('sha256', secret).update(target + '\n' + exp).digest('hex');
        return '/api/live/stream?url=' + encodeURIComponent(target) + '&exp=' + exp + '&sig=' + sig;
    }

    function verifyProxyUrl(url, exp, sig) {
        const target = String(url || '');
        const expires = Number(exp);
        const supplied = String(sig || '');
        if (!target || target.length > 4096) return false;
        if (!Number.isFinite(expires) || expires < Date.now()) return false;
        if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
        const expected = crypto.createHmac('sha256', secret).update(target + '\n' + expires).digest('hex');
        const a = Buffer.from(supplied, 'hex');
        const b = Buffer.from(expected, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    async function fetchSubscription(url) {
        if (typeof opts.fetchText === 'function') {
            const injected = await opts.fetchText(url);
            if (typeof injected === 'string') return { text: injected, finalUrl: url };
            return {
                text: String(injected && injected.text || ''),
                finalUrl: String(injected && injected.finalUrl || url)
            };
        }
        const opened = await openStream(url, { timeout: FETCH_TIMEOUT });
        const response = opened.response;
        if (!response || response.status < 200 || response.status >= 300) {
            if (response && response.data && response.data.destroy) response.data.destroy();
            throw new Error('订阅地址返回 HTTP ' + (response ? response.status : 'unknown'));
        }
        const buffer = await collectWithTimeout(collectStream, response.data, PLAYLIST_MAX_BYTES, FETCH_TIMEOUT);
        return {
            text: decodeBuffer(buffer, response.headers && response.headers['content-encoding']),
            finalUrl: opened.finalUrl || url
        };
    }

    async function sourceChannels(source, force) {
        const key = source.url;
        const cached = cache.get(key);
        if (!force && cached && cached.expires > Date.now()) {
            return { channels: cached.channels, name: cached.name, cached: true, latency: 0 };
        }
        const started = Date.now();
        const fetched = await fetchSubscription(source.url);
        const body = String(fetched.text || '');
        if (!/#EXTINF/i.test(body)) throw new Error('订阅内容不是有效的 M3U 直播列表');
        const channels = parseM3u(body, fetched.finalUrl || source.url);
        if (!channels.length) throw new Error('订阅里没有浏览器可播放的 HTTP 频道');
        const nameMatch = body.match(/^#PLAYLIST:(.+)$/m);
        const record = {
            channels,
            name: nameMatch ? text(nameMatch[1], 80) : '',
            expires: Date.now() + PLAYLIST_TTL
        };
        cache.set(key, record);
        while (cache.size > 64) cache.delete(cache.keys().next().value);
        return { channels, name: record.name, cached: false, latency: Date.now() - started };
    }

    async function listChannels(query) {
        const params = query || {};
        const dbSettings = currentSettings();
        const enabled = dbSettings.liveEnabled !== false;
        const allSources = normalizeSources(dbSettings.liveSources);
        const requestedId = text(params.sourceId, 48);
        const targets = allSources.filter(source => source.enabled !== false && (!requestedId || source.id === requestedId));
        if (!enabled) {
            return {
                enabled: false,
                configuredSources: allSources.length,
                activeSources: 0,
                channels: [],
                groups: [],
                sources: [],
                channelCount: 0
            };
        }

        const loaded = await mapLimit(targets, 4, async source => {
            try {
                const result = await sourceChannels(source, Boolean(params.force));
                return { source, result };
            } catch (error) {
                return { source, error: error && error.message ? error.message : '订阅加载失败' };
            }
        });

        const seen = new Set();
        const channels = [];
        const groups = new Set();
        const sources = [];
        for (const item of loaded) {
            if (!item || !item.source) continue;
            if (item.error) {
                sources.push({ id: item.source.id, name: item.source.name, count: 0, error: item.error, cached: false });
                continue;
            }
            const result = item.result || {};
            const list = Array.isArray(result.channels) ? result.channels : [];
            sources.push({
                id: item.source.id,
                name: item.source.name,
                playlistName: result.name || '',
                count: list.length,
                cached: Boolean(result.cached),
                latency: Number(result.latency) || 0
            });
            for (const channel of list) {
                if (!channel || !channel.url || seen.has(channel.url)) continue;
                seen.add(channel.url);
                groups.add(channel.group || '未分组');
                channels.push(Object.assign({}, channel, {
                    sourceId: item.source.id,
                    sourceName: item.source.name,
                    proxyUrl: signProxyUrl(channel.url, PROXY_TTL)
                }));
            }
        }

        return {
            enabled: true,
            configuredSources: allSources.length,
            activeSources: targets.length,
            fetchedAt: new Date().toISOString(),
            channels,
            channelCount: channels.length,
            groups: Array.from(groups).sort((a, b) => a.localeCompare(b, 'zh-CN')),
            sources
        };
    }

    async function testSource(input) {
        const normalized = normalizeSources([input || {}], { strict: true })[0];
        if (!normalized) throw new Error('请填写直播订阅地址');
        const started = Date.now();
        const result = await sourceChannels(normalized, true);
        return {
            success: true,
            name: normalized.name,
            playlistName: result.name || '',
            channelCount: result.channels.length,
            groupCount: new Set(result.channels.map(channel => channel.group || '未分组')).size,
            groups: Array.from(new Set(result.channels.map(channel => channel.group || '未分组'))).slice(0, 12),
            sample: result.channels.slice(0, 8).map(channel => channel.name),
            latency: Date.now() - started
        };
    }

    const router = express.Router();

    router.get('/channels', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const data = await listChannels({
                sourceId: req.query.source || req.query.sourceId,
                force: String(req.query.force || '') === '1'
            });
            res.json(data);
        } catch (error) {
            res.status(502).json({
                enabled: true,
                channels: [],
                groups: [],
                channelCount: 0,
                error: error && error.message ? error.message : '直播频道加载失败'
            });
        }
    });

    router.get('/stream', async (req, res) => {
        const url = String(req.query.url || '');
        if (!verifyProxyUrl(url, req.query.exp, req.query.sig)) {
            return res.status(403).type('text/plain').send('直播代理链接无效或已过期，请刷新频道列表');
        }

        let opened;
        try {
            opened = await openStream(url, {
                timeout: FETCH_TIMEOUT,
                range: req.headers.range
            });
        } catch (error) {
            return res.status(502).type('text/plain').send(error && error.message ? error.message : '直播流连接失败');
        }

        const response = opened.response;
        const upstream = response.data;
        const contentType = response.headers && response.headers['content-type'];
        const isPlaylist = playback.isPlaylistRequest(opened.finalUrl || url, contentType)
            || /\.m3u8?(?:$|\?)/i.test(url);

        if (isPlaylist) {
            try {
                if (response.status < 200 || response.status >= 300) {
                    if (upstream && upstream.destroy) upstream.destroy();
                    return res.status(response.status).type('text/plain').send('上游播放列表返回 HTTP ' + response.status);
                }
                const buffer = await collectWithTimeout(collectStream, upstream, PLAYLIST_MAX_BYTES, FETCH_TIMEOUT);
                const body = decodeBuffer(buffer, response.headers && response.headers['content-encoding']);
                if (!/#EXTM3U|#EXTINF/i.test(body)) {
                    return res.status(502).type('text/plain').send('上游内容不是有效的 HLS 播放列表');
                }
                const rewritten = playback.rewriteHlsPlaylist(body, opened.finalUrl || url, uri => signProxyUrl(uri, PROXY_TTL));
                res.status(200);
                res.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
                res.set('Cache-Control', 'no-store');
                return res.send(rewritten);
            } catch (error) {
                if (!res.headersSent) return res.status(502).type('text/plain').send('播放列表读取失败');
                return res.end();
            }
        }

        res.status(response.status || 200);
        res.set('Content-Type', contentType || 'application/octet-stream');
        res.set('Cache-Control', 'no-store');
        res.set('X-Accel-Buffering', 'no');
        if (response.headers['content-length']) res.set('Content-Length', response.headers['content-length']);
        if (response.headers['content-range']) res.set('Content-Range', response.headers['content-range']);
        if (response.headers['accept-ranges']) res.set('Accept-Ranges', response.headers['accept-ranges']);

        upstream.on('error', () => {
            if (!res.headersSent) res.status(502).end();
            else res.destroy();
        });
        res.on('close', () => {
            if (!res.writableEnded && upstream && upstream.destroy) upstream.destroy();
        });
        upstream.pipe(res);
    });

    function clearCache() {
        cache.clear();
    }

    return {
        router,
        listChannels,
        testSource,
        signProxyUrl,
        verifyProxyUrl,
        clearCache
    };
}

module.exports = {
    normalizeSources,
    parseM3u,
    normalizeHttpUrl,
    parseAttributes,
    createService
};
