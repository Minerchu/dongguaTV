// 本地开发可把配置放在 .env（Docker / 面板部署直接传环境变量即可）
try { require('dotenv').config(); } catch (e) { }

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildApk, isAvailable: isApkBuilderAvailable } = require('./apk-builder');
const tvbox = require('./tvbox');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.dirname(DATA_FILE);
const CLIENT_DIR = path.join(DATA_DIR, 'android-client');
const APP_APK_FILE = path.join(CLIENT_DIR, 'donggua-tv.apk');
const APP_ICON_FILE = path.join(CLIENT_DIR, 'icon.png');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const SEARCH_TIMEOUT = Number(process.env.SEARCH_TIMEOUT) || 6000;
const TEST_TIMEOUT = Number(process.env.TEST_TIMEOUT) || 5000;
const PANSOU_TIMEOUT = Number(process.env.PANSOU_TIMEOUT) || 15000;
const TMDB_API_KEY = (process.env.TMDB_API_KEY || '').trim();
const TMDB_API_BASE = (process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3').replace(/\/+$/, '');
const TMDB_IMAGE_BASE = (process.env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p').replace(/\/+$/, '');
const TMDB_API_FALLBACK = (process.env.TMDB_API_FALLBACK || (TMDB_API_BASE === 'https://api.themoviedb.org/3' ? 'https://api.tmdb.org/3' : '')).replace(/\/+$/, '');
const TMDB_IMAGE_FALLBACK = (process.env.TMDB_IMAGE_FALLBACK || (TMDB_IMAGE_BASE === 'https://image.tmdb.org/t/p' ? 'https://www.themoviedb.org/t/p' : '')).replace(/\/+$/, '');
const TMDB_TIMEOUT = Number(process.env.TMDB_TIMEOUT) || 15000;
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'zh-CN';
const SEARCH_CACHE_TTL = 60 * 1000;
const SESSION_TTL = 24 * 60 * 60 * 1000;

app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

// ========== 数据 ==========
// 采集站地址不写进代码 / 仓库，首次启动为空，请在后台添加。
// 这样仓库里不会出现任何第三方站点地址。



// ========== 数据库 ==========
function defaultClientSettings() {
    return {
        appName: '冬瓜TV',
        serverUrl: '',
        versionName: '1.0.0',
        versionCode: 1,
        iconVersion: 0,
        buildStatus: 'idle',
        buildMessage: '',
        builtAt: '',
        apkSize: 0,
        apkSha256: '',
        appliedServerUrl: '',
        appliedAppName: '',
        appliedVersionName: '',
        appliedVersionCode: 0,
        appliedIconVersion: 0
    };
}
function defaultSettings() {
    return { pansouUrl: '', pansouToken: '', pansouEnabled: true, client: defaultClientSettings() };
}
function normalizeSettings(input) {
    const source = input && typeof input === 'object' ? input : {};
    const merged = Object.assign(defaultSettings(), source);
    merged.client = Object.assign(defaultClientSettings(), source.client || {});
    const versionCode = Number(merged.client.versionCode);
    merged.client.versionCode = Number.isFinite(versionCode) && versionCode > 0 ? Math.floor(versionCode) : 1;
    merged.client.apkSize = Number(merged.client.apkSize) || 0;
    merged.client.iconVersion = Number(merged.client.iconVersion) || 0;
    return merged;
}
function defaultDB() {
    return { sites: [], settings: defaultSettings(), version: 3 };
}
function atomicWrite(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text, 'utf-8');
    fs.renameSync(tmp, file);
}
function readDB() {
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.sites)) return defaultDB();
        data.settings = normalizeSettings(data.settings);
        return data;
    } catch (e) {
        return defaultDB();
    }
}
function getDB() { return readDB(); }
function saveDB(data) {
    data.settings = normalizeSettings(data.settings);
    atomicWrite(DATA_FILE, JSON.stringify(data, null, 2));
}
function writeDBIfMissing() {
    if (!fs.existsSync(DATA_FILE)) saveDB(defaultDB());
}

// ========== Android 客户端构建 ==========
const buildState = { running: false, queued: false };

function normalizeClientServerUrl(raw) {
    let value = cleanText(raw, 400).replace(/\/+$/, '');
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) value = 'http://' + value;
    let parsed;
    try { parsed = new URL(value); } catch (e) { throw new Error('服务器地址格式不正确'); }
    if (!parsed.hostname) throw new Error('服务器地址缺少域名');
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
}

function clientArtifactReady(client) {
    if (!client || !client.serverUrl || !fs.existsSync(APP_APK_FILE)) return false;
    return client.appliedServerUrl === client.serverUrl
        && client.appliedAppName === client.appName
        && String(client.appliedVersionName) === String(client.versionName)
        && Number(client.appliedVersionCode) === Number(client.versionCode)
        && Number(client.appliedIconVersion) === Number(client.iconVersion);
}

function updateClientState(patch) {
    const db = getDB();
    db.settings.client = Object.assign(db.settings.client, patch || {});
    saveDB(db);
    return db.settings.client;
}

function publicAndroidState() {
    const client = getDB().settings.client;
    const available = clientArtifactReady(client);
    return {
        available,
        name: client.appName,
        version: client.versionName,
        size: client.apkSize,
        builtAt: client.builtAt,
        downloadUrl: available ? '/api/app/download' : ''
    };
}

async function runClientBuildLoop() {
    try {
        do {
            buildState.queued = false;
            const client = getDB().settings.client;
            if (!client.serverUrl) {
                updateClientState({ buildStatus: 'idle', buildMessage: '尚未填写服务器地址' });
                break;
            }
            updateClientState({ buildStatus: 'building', buildMessage: '正在生成 APK，请稍候…' });
            const snapshot = {
                appName: client.appName,
                serverUrl: client.serverUrl,
                versionName: client.versionName,
                versionCode: client.versionCode,
                iconVersion: client.iconVersion,
                iconPath: fs.existsSync(APP_ICON_FILE) ? APP_ICON_FILE : ''
            };
            try {
                const result = await buildApk({ android: snapshot, dataDir: DATA_DIR });
                const latest = getDB().settings.client;
                const latestMatches = latest.serverUrl === snapshot.serverUrl
                    && latest.appName === snapshot.appName
                    && Number(latest.versionCode) === Number(snapshot.versionCode)
                    && latest.versionName === snapshot.versionName
                    && Number(latest.iconVersion) === Number(snapshot.iconVersion);
                updateClientState({
                    buildStatus: latestMatches ? 'success' : 'stale',
                    buildMessage: latestMatches ? 'APK 已生成，可下载' : '配置在构建期间发生变化，将自动重新生成',
                    builtAt: new Date().toISOString(),
                    apkSize: result.size,
                    apkSha256: result.sha256,
                    appliedServerUrl: snapshot.serverUrl,
                    appliedAppName: snapshot.appName,
                    appliedVersionName: snapshot.versionName,
                    appliedVersionCode: snapshot.versionCode,
                    appliedIconVersion: snapshot.iconVersion
                });
                if (!latestMatches) buildState.queued = true;
            } catch (error) {
                const message = String(error && error.message ? error.message : error).slice(0, 1200);
                updateClientState({ buildStatus: 'failed', buildMessage: message });
                console.error('[Android Build]', message);
            }
        } while (buildState.queued);
    } finally {
        buildState.running = false;
        if (buildState.queued) requestClientBuild();
    }
}

function requestClientBuild() {
    if (!isApkBuilderAvailable()) {
        updateClientState({
            buildStatus: 'failed',
            buildMessage: '当前镜像缺少 APK 构建组件。请使用项目提供的 Docker 镜像重新构建。'
        });
        return false;
    }
    if (buildState.running) {
        buildState.queued = true;
        return true;
    }
    buildState.running = true;
    setTimeout(runClientBuildLoop, 80);
    return true;
}

function resetInterruptedBuild() {
    const client = getDB().settings.client;
    if (client.buildStatus === 'building') {
        updateClientState({ buildStatus: 'idle', buildMessage: '上次构建被中断，准备重新生成' });
    }
}

function maybeBuildOnStartup() {
    const client = getDB().settings.client;
    if (client.serverUrl && !clientArtifactReady(client)) requestClientBuild();
}

function validatePng(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 33) throw new Error('请选择有效的 PNG 图片');
    const signature = buffer.subarray(0, 8);
    const expected = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    if (!signature.equals(expected)) throw new Error('图标必须是 PNG 格式');
    if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('PNG 文件结构不正确');
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width < 48 || height < 48) throw new Error('图标至少需要 48×48 像素');
    if (width > 2048 || height > 2048) throw new Error('图标不能超过 2048×2048 像素');
    return { width, height };
}

function adminClientState() {
    const client = getDB().settings.client;
    return {
        ...client,
        artifactReady: clientArtifactReady(client),
        buildRunning: buildState.running,
        buildQueued: buildState.queued,
        builderAvailable: isApkBuilderAvailable(),
        iconUrl: fs.existsSync(APP_ICON_FILE) ? `/api/app/icon?v=${client.iconVersion}` : '',
        downloadUrl: clientArtifactReady(client) ? '/api/app/download' : '',
        apkPath: fs.existsSync(APP_APK_FILE) ? APP_APK_FILE : ''
    };
}

// ========== 工具 ==========
function cleanText(v, max) {
    return String(v == null ? '' : v).trim().slice(0, max || 200);
}
function normalizeApi(raw) {
    let u = cleanText(raw, 500);
    if (!u) throw new Error('API 地址不能为空');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    let parsed;
    try { parsed = new URL(u); } catch (e) { throw new Error('API 地址格式不正确'); }
    if (!parsed.hostname) throw new Error('API 地址缺少域名');
    u = u.split('#')[0].split('?')[0].replace(/\/+$/, '');
    if (!/\.php$/i.test(u) && !/provide\/vod/i.test(u)) u += '/api.php/provide/vod';
    return u;
}
function comparableApi(raw) {
    const tvboxApi = tvbox.normalizeTvboxApi(raw);
    if (tvboxApi) return tvboxApi;
    try { return normalizeApi(raw); } catch (e) { return ''; }
}
function existingApiSet(db) {
    const sites = db && Array.isArray(db.sites) ? db.sites : [];
    return new Set(sites.map(site => comparableApi(site && site.api)).filter(Boolean));
}
function siteHost(api) {
    try { return new URL(api).hostname.replace(/^www\./, ''); } catch (e) { return 'site'; }
}
function makeKey(api, taken) {
    const labels = siteHost(api).split('.');
    const generic = new Set(['api', 'www', 'cj', 'caiji', 'm3u8', 'vod', 'm', 'v']);
    const picked = labels.find(l => l && l.length > 1 && !generic.has(l.toLowerCase())) || labels[0] || 'site';
    const base = picked.replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'site';
    let key = base, i = 2;
    while (taken.has(key)) { key = base + i; i++; }
    taken.add(key);
    return key;
}
function validKey(k) { return /^[a-zA-Z0-9_-]{1,40}$/.test(k); }
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            out[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}
function withQuery(url, query) {
    return url + (url.includes('?') ? '&' : '?') + query;
}
function parseMaccmsList(data) {
    if (!data || typeof data !== 'object') return null;
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.data)) return data.data;
    if (data.data && Array.isArray(data.data.list)) return data.data.list;
    return null;
}

// ========== 简易缓存 ==========
const searchCache = new Map();
const cloudCache = new Map();
const hotCache = new Map();
function cacheGet(map, key) {
    const hit = map.get(key);
    if (!hit) return null;
    if (Date.now() > hit.exp) { map.delete(key); return null; }
    return hit.value;
}
function cacheSet(map, key, value, ttl) {
    if (map.size > 300) {
        const first = map.keys().next().value;
        map.delete(first);
    }
    map.set(key, { value, exp: Date.now() + (ttl || SEARCH_CACHE_TTL) });
}

// ========== 管理员会话 ==========
const ADMIN_SECRET = crypto.randomBytes(32);
const loginAttempts = new Map();

function signSession(exp) {
    const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(String(exp)).digest('hex');
    return exp + '.' + sig;
}
function verifySession(token) {
    if (!token || typeof token !== 'string') return false;
    const dot = token.indexOf('.');
    if (dot < 1) return false;
    const exp = token.slice(0, dot), sig = token.slice(dot + 1);
    if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
    const expect = crypto.createHmac('sha256', ADMIN_SECRET).update(exp).digest('hex');
    const a = Buffer.from(sig), b = Buffer.from(expect);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function readCookie(req, name) {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return '';
}
function adminToken(req) {
    return readCookie(req, 'dg_admin') || req.headers['x-admin-token'] || '';
}
function requireAdmin(req, res, next) {
    if (!verifySession(adminToken(req))) return res.status(401).json({ success: false, error: '请先登录后台' });
    next();
}
function tooManyAttempts(ip) {
    const rec = loginAttempts.get(ip);
    if (!rec) return false;
    if (Date.now() > rec.reset) { loginAttempts.delete(ip); return false; }
    return rec.count >= 8;
}
function recordFailure(ip) {
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec || now > rec.reset) loginAttempts.set(ip, { count: 1, reset: now + 10 * 60 * 1000 });
    else rec.count++;
}

// ========== 采集站检查 ==========
async function testApi(api) {
    const started = Date.now();
    const url = withQuery(api, 'ac=list&pg=1');
    try {
        const resp = await axios.get(url, {
            timeout: TEST_TIMEOUT,
            responseType: 'json',
            headers: { 'User-Agent': 'Mozilla/5.0 DongguaTV/2.0', 'Accept': 'application/json,text/plain,*/*' },
            validateStatus: () => true,
            maxRedirects: 3
        });
        const latency = Date.now() - started;
        const list = parseMaccmsList(resp.data);
        if (!list) {
            const preview = typeof resp.data === 'string' ? resp.data.slice(0, 80) : JSON.stringify(resp.data || {}).slice(0, 80);
            return { ok: false, latency, status: resp.status, message: '不是 Maccms JSON 接口（返回内容：' + preview + '）' };
        }
        return {
            ok: true,
            latency,
            status: resp.status,
            count: list.length,
            sample: list.slice(0, 3).map(x => x.vod_name).filter(Boolean)
        };
    } catch (e) {
        return { ok: false, latency: Date.now() - started, message: e.code === 'ECONNABORTED' ? '连接超时' : (e.message || '请求失败') };
    }
}

// ========== 网盘搜索（PanSou） ==========
function pansouBase() {
    const s = getDB().settings || {};
    const base = String(s.pansouUrl || process.env.PANSOU_URL || '').trim().replace(/\/+$/, '');
    return base;
}
let pansouTokenCache = { token: '', exp: 0 };
async function pansouToken(base) {
    if (pansouTokenCache.token && Date.now() < pansouTokenCache.exp) return pansouTokenCache.token;
    const s = getDB().settings || {};
    const staticToken = s.pansouToken || process.env.PANSOU_TOKEN || '';
    if (staticToken) return staticToken;
    const user = process.env.PANSOU_USER, pass = process.env.PANSOU_PASS;
    if (!user || !pass) return '';
    const r = await axios.post(base + '/api/auth/login', { username: user, password: pass }, { timeout: 8000 });
    if (r.data && r.data.token) {
        const ttl = Number(r.data.expires_at) ? Number(r.data.expires_at) - Date.now() : 12 * 3600 * 1000;
        pansouTokenCache = { token: r.data.token, exp: Date.now() + Math.max(60 * 1000, ttl - 60 * 1000) };
        return r.data.token;
    }
    return '';
}
function normalizePansou(data, wd) {
    const root = data && data.data && typeof data.data === 'object' ? data.data : data;
    const seen = new Set();
    const list = [];
    const types = {};
    function add(item, link, fallbackType) {
        const url = String(link.url || '').trim();
        if (!url || seen.has(url)) return;
        seen.add(url);
        const type = String(link.type || fallbackType || 'others').toLowerCase();
        const title = item.title || link.note || link.work_title || wd;
        types[type] = (types[type] || 0) + 1;
        list.push({
            title: cleanText(title, 160),
            content: cleanText(item.content, 300),
            channel: cleanText(link.source || item.channel, 60),
            datetime: item.datetime || link.datetime || '',
            type,
            url,
            password: cleanText(link.password, 32),
            work_title: cleanText(link.work_title || link.note || title, 160),
            tags: Array.isArray(item.tags) ? item.tags.slice(0, 6) : []
        });
    }
    if (root && root.merged_by_type && typeof root.merged_by_type === 'object') {
        for (const [type, links] of Object.entries(root.merged_by_type)) {
            if (!Array.isArray(links)) continue;
            for (const link of links) add({}, link, type);
        }
    } else {
        const results = Array.isArray(root && root.results) ? root.results : [];
        for (const item of results) {
            const links = Array.isArray(item.links) ? item.links : [];
            for (const link of links) add(item, link, link.type);
        }
    }
    const total = Number(root && root.total) || list.length;
    return { enabled: true, query: wd, total, types, list: list.slice(0, 200) };
}

// ========== TMDb 同源代理 ==========
// 前端只请求本站的 /tmdb，Key 和上游地址都留在服务端，不暴露给浏览器。
app.get('/tmdb/3/*', async (req, res) => {
    if (!TMDB_API_KEY) return res.status(503).json({ error: 'TMDB_API_KEY 未配置' });
    const pathPart = String(req.params[0] || '').replace(/^\/+/, '');
    if (!pathPart || pathPart.includes('..')) return res.status(400).json({ error: '无效的 TMDb 路径' });
    const params = Object.assign({}, req.query);
    delete params.api_key;
    params.api_key = TMDB_API_KEY;
    if (!params.language) params.language = TMDB_LANGUAGE;
    const bases = [TMDB_API_BASE];
    if (TMDB_API_FALLBACK && TMDB_API_FALLBACK !== TMDB_API_BASE) bases.push(TMDB_API_FALLBACK);
    for (let i = 0; i < bases.length; i++) {
        try {
            const upstream = await axios.get(bases[i] + '/' + pathPart, {
                params,
                timeout: TMDB_TIMEOUT,
                validateStatus: () => true
            });
            if (upstream.status >= 500 && i < bases.length - 1) continue;
            res.status(upstream.status);
            res.set('Cache-Control', upstream.status >= 200 && upstream.status < 300 ? 'public, max-age=300' : 'no-store');
            return res.json(upstream.data);
        } catch (e) {
            if (i === bases.length - 1) break;
        }
    }
    res.status(502).json({ error: 'TMDb 请求失败' });
});

app.get('/tmdb/t/p/*', async (req, res) => {
    const pathPart = String(req.params[0] || '').replace(/^\/+/, '');
    if (!/^[A-Za-z0-9/_.-]+$/.test(pathPart) || pathPart.includes('..')) return res.status(400).end();
    const bases = [TMDB_IMAGE_BASE];
    if (TMDB_IMAGE_FALLBACK && TMDB_IMAGE_FALLBACK !== TMDB_IMAGE_BASE) bases.push(TMDB_IMAGE_FALLBACK);
    for (let i = 0; i < bases.length; i++) {
        try {
            const upstream = await axios.get(bases[i] + '/' + pathPart, {
                responseType: 'stream',
                timeout: TMDB_TIMEOUT,
                validateStatus: () => true
            });
            if (upstream.status >= 500 && i < bases.length - 1) {
                upstream.data.destroy();
                continue;
            }
            res.status(upstream.status);
            res.set('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
            res.set('Cache-Control', upstream.status >= 200 && upstream.status < 300 ? 'public, max-age=86400' : 'no-store');
            return upstream.data.pipe(res);
        } catch (e) {
            if (i === bases.length - 1) break;
        }
    }
    res.status(502).end();
});

// ========== 公共 API ==========
app.get('/api/config', (req, res) => {
    const db = getDB();
    res.json({
        cloudEnabled: Boolean(pansouBase()) && db.settings.pansouEnabled !== false,
        siteCount: db.sites.filter(s => s.active !== false).length,
        android: publicAndroidState()
    });
});

app.get('/api/app/icon', (req, res) => {
    if (!fs.existsSync(APP_ICON_FILE)) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('png');
    fs.createReadStream(APP_ICON_FILE).pipe(res);
});

app.get('/api/app/download', (req, res) => {
    const client = getDB().settings.client;
    if (!clientArtifactReady(client) || !fs.existsSync(APP_APK_FILE)) {
        return res.status(404).json({ error: 'APK 还没有生成完成' });
    }
    const displayName = cleanText(client.appName, 40).replace(/[\\/:*?"<>|\r\n]/g, '') || 'DongguaTV';
    const asciiName = displayName.replace(/[^\x20-\x7E]/g, '').trim() || 'donggua-tv';
    const stat = fs.statSync(APP_APK_FILE);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}.apk"; filename*=UTF-8''${encodeURIComponent(displayName + '.apk')}`);
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(APP_APK_FILE).pipe(res);
});

app.get('/api/sites', (req, res) => {
    const sites = getDB().sites.map(s => ({ key: s.key, name: s.name, active: s.active !== false }));
    res.json({ sites, cloudEnabled: Boolean(pansouBase()) && getDB().settings.pansouEnabled !== false });
});

app.get('/api/check', async (req, res) => {
    const key = cleanText(req.query.key, 60);
    const site = getDB().sites.find(s => s.key === key);
    if (!site) return res.json({ latency: 9999, ok: false });
    const started = Date.now();
    try {
        const resp = await axios.get(withQuery(site.api, 'ac=list&pg=1'), { timeout: 3000, validateStatus: () => true });
        const latency = Date.now() - started;
        const ok = Boolean(parseMaccmsList(resp.data));
        res.json({ latency: ok ? latency : 9999, ok });
    } catch (e) {
        res.json({ latency: 9999, ok: false });
    }
});

app.get('/api/hot', async (req, res) => {
    const cached = cacheGet(hotCache, 'hot');
    if (cached) return res.json(cached);
    const sites = getDB().sites.filter(s => s.active !== false && s.api).slice(0, 8);
    for (const site of sites) {
        try {
            const response = await axios.get(withQuery(site.api, 'ac=list&pg=1&h=24&out=json'), {
                timeout: 4000,
                validateStatus: () => true
            });
            const list = parseMaccmsList(response.data);
            if (list && list.length > 0) {
                const payload = { list: list.slice(0, 12) };
                cacheSet(hotCache, 'hot', payload, 5 * 60 * 1000);
                return res.json(payload);
            }
        } catch (e) { /* 换下一个源 */ }
    }
    res.json({ list: [] });
});

app.get('/api/search', async (req, res) => {
    const wd = cleanText(req.query.wd, 80);
    if (!wd) return res.json({ list: [], errors: 0 });
    const cacheKey = 's:' + wd.toLowerCase();
    const cached = cacheGet(searchCache, cacheKey);
    if (cached) return res.json(cached);

    const sites = getDB().sites.filter(s => s.active !== false && s.api);
    let errors = 0;
    const chunks = await mapLimit(sites, 8, async (site) => {
        try {
            const response = await axios.get(withQuery(site.api, 'ac=list&wd=' + encodeURIComponent(wd) + '&out=json'), {
                timeout: SEARCH_TIMEOUT,
                responseType: 'json',
                validateStatus: () => true
            });
            const list = parseMaccmsList(response.data);
            if (!Array.isArray(list)) { errors++; return []; }
            return list.map(item => ({
                ...item,
                site_key: site.key,
                site_name: site.name,
                latency: 0
            }));
        } catch (e) {
            errors++;
            return [];
        }
    });
    const payload = { list: chunks.flat(), errors, siteCount: sites.length };
    cacheSet(searchCache, cacheKey, payload, SEARCH_CACHE_TTL);
    res.json(payload);
});

app.get('/api/detail', async (req, res) => {
    const siteKey = cleanText(req.query.site_key, 60);
    const id = cleanText(req.query.id, 60);
    const targetSite = getDB().sites.find(s => s.key === siteKey);
    if (!targetSite) return res.status(404).json({ error: 'Site not found' });
    try {
        const response = await axios.get(withQuery(targetSite.api, 'ac=detail&ids=' + encodeURIComponent(id) + '&out=json'), { timeout: 8000 });
        res.json(response.data);
    } catch (e) {
        res.status(502).json({ error: 'Source Error' });
    }
});

app.get('/api/cloud/search', async (req, res) => {
    const wd = cleanText(req.query.wd, 80);
    if (!wd) return res.json({ enabled: true, list: [], total: 0 });
    const base = pansouBase();
    if (!base || getDB().settings.pansouEnabled === false) {
        return res.json({ enabled: false, list: [], total: 0, message: '站长尚未开启网盘搜索' });
    }
    const cacheKey = 'c:' + wd.toLowerCase();
    const cached = cacheGet(cloudCache, cacheKey);
    if (cached) return res.json(cached);
    try {
        const token = await pansouToken(base);
        const headers = token ? { Authorization: 'Bearer ' + token } : {};
        const resp = await axios.post(base + '/api/search', { kw: wd }, { timeout: PANSOU_TIMEOUT, headers });
        const payload = normalizePansou(resp.data, wd);
        cacheSet(cloudCache, cacheKey, payload, 5 * 60 * 1000);
        res.json(payload);
    } catch (e) {
        const status = e.response && e.response.status;
        const message = status === 401
            ? '网盘搜索需要认证，请在后台填写 PanSou Token'
            : (e.code === 'ECONNABORTED' ? '网盘搜索超时' : '网盘搜索暂不可用');
        res.json({ enabled: true, list: [], total: 0, error: message });
    }
});

// ========== 后台 API ==========
app.post('/api/admin/login', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (tooManyAttempts(ip)) return res.status(429).json({ success: false, error: '尝试次数过多，请 10 分钟后再试' });
    const password = String((req.body && req.body.password) || '');
    if (password !== ADMIN_PASSWORD) {
        recordFailure(ip);
        return res.status(403).json({ success: false, error: '密码不正确' });
    }
    loginAttempts.delete(ip);
    const exp = Date.now() + SESSION_TTL;
    const token = signSession(exp);
    res.setHeader('Set-Cookie', 'dg_admin=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL / 1000));
    res.json({ success: true, token, expiresAt: exp });
});

app.post('/api/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'dg_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ success: true });
});

app.get('/api/admin/me', (req, res) => {
    res.json({ loggedIn: verifySession(adminToken(req)) });
});

app.get('/api/admin/sites', requireAdmin, (req, res) => {
    const db = getDB();
    res.json({ sites: db.sites, settings: db.settings });
});

app.get('/api/admin/client', requireAdmin, (req, res) => {
    res.json({ success: true, client: adminClientState() });
});

app.put('/api/admin/client', requireAdmin, (req, res) => {
    const body = req.body || {};
    const db = getDB();
    try {
        const previous = db.settings.client;
        const appName = cleanText(body.appName, 40) || previous.appName;
        const serverUrl = normalizeClientServerUrl(body.serverUrl !== undefined ? body.serverUrl : previous.serverUrl);
        const versionName = cleanText(body.versionName, 24) || previous.versionName;
        if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,23}$/.test(versionName)) {
            return res.status(400).json({ success: false, error: '版本号只能包含字母、数字、点和下划线' });
        }
        const rawCode = Number(body.versionCode !== undefined ? body.versionCode : previous.versionCode);
        const versionCode = Number.isFinite(rawCode) ? Math.max(1, Math.min(2100000000, Math.floor(rawCode))) : 1;
        Object.assign(db.settings.client, { appName, serverUrl, versionName, versionCode });
        if (!serverUrl) Object.assign(db.settings.client, { buildStatus: 'idle', buildMessage: '填写服务器地址后会自动生成 APK' });
        saveDB(db);
        const current = getDB().settings.client;
        const queued = serverUrl && !clientArtifactReady(current) ? requestClientBuild() : false;
        res.json({ success: true, client: adminClientState(), queued });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/client/build', requireAdmin, (req, res) => {
    const client = getDB().settings.client;
    if (!client.serverUrl) return res.status(400).json({ success: false, error: '请先填写并保存服务器地址' });
    const queued = requestClientBuild();
    res.json({ success: queued, client: adminClientState(), queued });
});

app.post('/api/admin/client/icon', requireAdmin, express.raw({ type: ['image/png', 'application/octet-stream'], limit: '3mb' }), (req, res) => {
    try {
        const buffer = req.body;
        validatePng(buffer);
        fs.mkdirSync(CLIENT_DIR, { recursive: true });
        const temp = APP_ICON_FILE + '.tmp';
        fs.writeFileSync(temp, buffer);
        fs.renameSync(temp, APP_ICON_FILE);
        const client = updateClientState({ iconVersion: Date.now() });
        const queued = client.serverUrl ? requestClientBuild() : false;
        res.json({ success: true, client: adminClientState(), queued });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.delete('/api/admin/client/icon', requireAdmin, (req, res) => {
    try { fs.rmSync(APP_ICON_FILE, { force: true }); } catch (e) { }
    const client = updateClientState({ iconVersion: Date.now() });
    const queued = client.serverUrl ? requestClientBuild() : false;
    res.json({ success: true, client: adminClientState(), queued });
});

app.post('/api/admin/sites', requireAdmin, async (req, res) => {
    const db = getDB();
    const name = cleanText(req.body.name, 40);
    let api;
    try { api = normalizeApi(req.body.api); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    if (!name) return res.status(400).json({ success: false, error: '请填写站点名称' });
    if (db.sites.some(s => s.api === api)) return res.status(409).json({ success: false, error: '该 API 地址已存在' });
    let key = cleanText(req.body.key, 40);
    if (key) {
        if (!validKey(key)) return res.status(400).json({ success: false, error: '标识只能包含字母、数字、下划线和中划线' });
        if (db.sites.some(s => s.key === key)) return res.status(409).json({ success: false, error: '标识已被占用' });
    } else {
        key = makeKey(api, new Set(db.sites.map(s => s.key)));
    }
    const site = { key, name, api, active: req.body.active !== false };
    let test = null;
    if (req.body.test !== false) {
        test = await testApi(api);
        if (!test.ok) {
            return res.status(400).json({ success: false, error: '连接失败：' + (test.message || '无法访问该接口'), test });
        }
    }
    db.sites.push(site);
    saveDB(db);
    res.json({ success: true, site, test });
});

app.put('/api/admin/sites/:key', requireAdmin, async (req, res) => {
    const db = getDB();
    const key = cleanText(req.params.key, 40);
    const site = db.sites.find(s => s.key === key);
    if (!site) return res.status(404).json({ success: false, error: '站点不存在' });
    if (req.body.name !== undefined) site.name = cleanText(req.body.name, 40);
    if (req.body.active !== undefined) site.active = Boolean(req.body.active);
    if (req.body.api !== undefined) {
        let api;
        try { api = normalizeApi(req.body.api); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
        if (db.sites.some(s => s.key !== key && s.api === api)) return res.status(409).json({ success: false, error: '该 API 地址已存在' });
        site.api = api;
    }
    if (req.body.key !== undefined && req.body.key !== key) {
        const newKey = cleanText(req.body.key, 40);
        if (!validKey(newKey)) return res.status(400).json({ success: false, error: '标识格式不正确' });
        if (db.sites.some(s => s.key === newKey)) return res.status(409).json({ success: false, error: '标识已被占用' });
        site.key = newKey;
    }
    saveDB(db);
    res.json({ success: true, site });
});

app.delete('/api/admin/sites/:key', requireAdmin, (req, res) => {
    const db = getDB();
    const key = cleanText(req.params.key, 40);
    const before = db.sites.length;
    db.sites = db.sites.filter(s => s.key !== key);
    if (db.sites.length === before) return res.status(404).json({ success: false, error: '站点不存在' });
    saveDB(db);
    res.json({ success: true });
});

app.post('/api/admin/sites/test', requireAdmin, async (req, res) => {
    let api;
    try { api = normalizeApi(req.body.api); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    const result = await testApi(api);
    res.json({ success: result.ok, api, ...result });
});

app.post('/api/admin/sites/import', requireAdmin, async (req, res) => {
    const text = String(req.body.text || '');
    const db = getDB();
    const taken = new Set(db.sites.map(s => s.key));
    const existingApis = existingApiSet(db);
    const added = [], skipped = [], failed = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    for (const line of lines) {
        const parts = line.split(/[|,\t]/).map(x => x.trim()).filter(Boolean);
        let name = '', apiRaw = '';
        if (parts.length >= 2 && /^https?:\/\//i.test(parts[1])) { name = parts[0]; apiRaw = parts[1]; }
        else if (parts.length >= 2 && /^https?:\/\//i.test(parts[0])) { apiRaw = parts[0]; name = parts[1]; }
        else { apiRaw = parts[0] || line; }
        let api;
        try { api = normalizeApi(apiRaw); } catch (e) { failed.push({ line, error: e.message }); continue; }
        const comparable = comparableApi(api);
        if (existingApis.has(comparable)) { skipped.push({ line, reason: '已存在' }); continue; }
        if (!name) name = siteHost(api);
        db.sites.push({ key: makeKey(api, taken), name: cleanText(name, 40), api, active: true });
        existingApis.add(comparable);
        added.push(api);
    }
    saveDB(db);
    res.json({ success: true, added: added.length, skipped: skipped.length, failed: failed.length, details: { added, skipped, failed } });
});

app.post('/api/admin/import/preview', requireAdmin, async (req, res) => {
    const input = String(req.body.input || req.body.text || '').slice(0, 900000);
    const mode = req.body.mode === 'maccms' ? 'maccms' : 'tvbox';
    if (!input.trim()) return res.status(400).json({ success: false, error: mode === 'tvbox' ? '请先粘贴 TVBox 配置地址' : '请先粘贴苹果CMS接口' });
    try {
        const db = getDB();
        const options = { existingApis: Array.from(existingApiSet(db)) };
        const result = mode === 'maccms'
            ? tvbox.previewMaccmsInput(input, options)
            : await tvbox.previewTvboxInput(input, options);
        res.json({ success: true, mode, ...result });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message || '导入源解析失败' });
    }
});

app.post('/api/admin/import/sites', requireAdmin, (req, res) => {
    const items = Array.isArray(req.body.sites) ? req.body.sites.slice(0, 200) : [];
    if (!items.length) return res.status(400).json({ success: false, error: '没有选中要导入的站点' });
    const db = getDB();
    const taken = new Set(db.sites.map(s => s.key));
    const existingApis = existingApiSet(db);
    const added = [], skipped = [], failed = [];
    for (const item of items) {
        const raw = item && typeof item === 'object' ? item : {};
        const api = tvbox.normalizeTvboxApi(raw.api);
        if (!api) { failed.push({ name: cleanText(raw.name, 80), api: cleanText(raw.api, 500), error: '不是受支持的 Maccms 接口' }); continue; }
        if (existingApis.has(api)) { skipped.push({ name: cleanText(raw.name, 80), api, reason: '已存在' }); continue; }
        const name = cleanText(raw.name, 40) || siteHost(api);
        db.sites.push({ key: makeKey(api, taken), name, api, active: true });
        existingApis.add(api);
        added.push({ name, api });
    }
    if (added.length) saveDB(db);
    res.json({ success: true, added: added.length, skipped: skipped.length, failed: failed.length, details: { added, skipped, failed } });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
    const db = getDB();
    const body = req.body || {};
    if (body.pansouUrl !== undefined) {
        let url = cleanText(body.pansouUrl, 300).replace(/\/+$/, '');
        if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
        db.settings.pansouUrl = url;
    }
    if (body.pansouToken !== undefined) db.settings.pansouToken = cleanText(body.pansouToken, 500);
    if (body.pansouEnabled !== undefined) db.settings.pansouEnabled = Boolean(body.pansouEnabled);
    saveDB(db);
    pansouTokenCache = { token: '', exp: 0 };
    res.json({ success: true, settings: db.settings });
});

app.post('/api/admin/pansou/test', requireAdmin, async (req, res) => {
    let base = cleanText(req.body.url, 300).replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) base = 'http://' + base;
    if (!base) return res.status(400).json({ success: false, error: '请先填写 PanSou 地址' });
    try {
        const started = Date.now();
        const health = await axios.get(base + '/api/health', { timeout: 8000, validateStatus: () => true });
        res.json({
            success: health.status === 200,
            latency: Date.now() - started,
            authEnabled: Boolean(health.data && health.data.auth_enabled),
            plugins: health.data && health.data.plugin_count
        });
    } catch (e) {
        res.json({ success: false, error: e.code === 'ECONNABORTED' ? '连接超时' : '无法连接，请检查地址和端口' });
    }
});

// 兼容旧前端：保留原来的整体保存接口（需登录）
app.post('/api/admin/sites-legacy', requireAdmin, (req, res) => {
    const sites = Array.isArray(req.body.sites) ? req.body.sites : [];
    const db = getDB();
    db.sites = sites.map(s => ({ key: s.key, name: s.name, api: s.api, active: s.active !== false }));
    saveDB(db);
    res.json({ success: true });
});

writeDBIfMissing();

app.get(['/search', '/title/:type/:id', '/watch'], (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

if (require.main === module) {
    resetInterruptedBuild();
    app.listen(PORT, () => {
        console.log(`服务已启动: http://localhost:${PORT}`);
        console.log(`后台管理: http://localhost:${PORT}/admin.html`);
        if (!process.env.ADMIN_PASSWORD) console.warn('[安全提示] 正在使用默认后台密码 admin，请设置环境变量 ADMIN_PASSWORD');
        setTimeout(maybeBuildOnStartup, 1500);
    });
}

module.exports = app;
