'use strict';

const axios = require('axios');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_URLS = 20;
const MAX_NESTED_URLS = 20;
const MAX_NESTED_DEPTH = 2;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT = 20000;
const DEFAULT_UA = 'okhttp/3.15';

function cleanText(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max || 120);
}

function isTvboxHex(text) {
    const compact = String(text || '').replace(/\s+/g, '');
    return compact.length > 64 && compact.startsWith('2423') && compact.includes('2324') && /^[0-9a-fA-F]+$/.test(compact);
}

function rightPadBytes(value, length) {
    const source = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
    const out = Buffer.alloc(length || 16, 0x30);
    source.copy(out, 0, 0, Math.min(source.length, out.length));
    return out;
}

function removePkcs7Padding(buffer) {
    if (!buffer || !buffer.length) return buffer;
    const pad = buffer[buffer.length - 1];
    if (pad < 1 || pad > 16 || pad > buffer.length) return buffer;
    for (let i = buffer.length - pad; i < buffer.length; i++) {
        if (buffer[i] !== pad) return buffer;
    }
    return buffer.subarray(0, buffer.length - pad);
}

function decryptTvboxHex(text) {
    const hex = String(text || '').replace(/\s+/g, '');
    const split = hex.indexOf('2324', 4);
    if (!hex.startsWith('2423') || split < 0) throw new Error('TVBox 加密格式不完整');
    const keyHex = hex.slice(4, split);
    const ivHex = hex.slice(-26);
    const dataHex = hex.slice(split + 4, -26);
    if (!keyHex || ivHex.length !== 26 || !dataHex) throw new Error('TVBox 加密内容不完整');

    const key = rightPadBytes(Buffer.from(keyHex, 'hex'), 16);
    const iv = rightPadBytes(Buffer.from(ivHex, 'hex'), 16);
    const cipher = Buffer.from(dataHex, 'hex');
    if (!cipher.length) throw new Error('TVBox 加密数据为空');

    let plain;
    try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        plain = Buffer.concat([decipher.update(cipher), decipher.final()]);
    } catch (e) {
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(false);
        plain = removePkcs7Padding(Buffer.concat([decipher.update(cipher), decipher.final()]));
    }
    const textValue = plain.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (!textValue) throw new Error('TVBox AES 解密结果为空');
    return textValue;
}

function stripJsonNoise(input) {
    let text = String(input || '').replace(/^\uFEFF/, '').trim();
    const brace = text.indexOf('{');
    const bracket = text.indexOf('[');
    const start = brace < 0 ? bracket : (bracket < 0 ? brace : Math.min(brace, bracket));
    if (start > 0) text = text.slice(start);

    let withoutComments = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            withoutComments += ch;
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            withoutComments += ch;
        } else if (ch === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            withoutComments += '\n';
        } else if (ch === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? text.length : end + 1;
        } else {
            withoutComments += ch;
        }
    }

    let clean = '';
    inString = false;
    escaped = false;
    for (let i = 0; i < withoutComments.length; i++) {
        const ch = withoutComments[i];
        if (inString) {
            clean += ch;
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            clean += ch;
            continue;
        }
        if (ch === ',') {
            let j = i + 1;
            while (j < withoutComments.length && /\s/.test(withoutComments[j])) j++;
            if (withoutComments[j] === '}' || withoutComments[j] === ']') continue;
        }
        clean += ch;
    }
    return clean.trim();
}

function parseTvboxJson(text) {
    const clean = stripJsonNoise(text);
    try {
        return JSON.parse(clean);
    } catch (e) {
        throw new Error('配置不是有效 JSON，可能仍未解密或接口返回了网页');
    }
}

function tryBase64Payload(text) {
    let candidate = String(text || '').trim();
    if (/^base64:\/\//i.test(candidate)) candidate = candidate.slice(9);
    candidate = candidate.replace(/\s+/g, '');
    const marker = candidate.indexOf('**');
    if (marker > 0 && marker <= 64) {
        const tail = candidate.slice(marker + 2);
        if (tail.length >= 24 && /^[A-Za-z0-9+/=_-]+$/.test(tail)) candidate = tail;
    }
    if (candidate.length < 24 || !/^[A-Za-z0-9+/=_-]+$/.test(candidate)) return null;
    candidate = candidate.replace(/-/g, '+').replace(/_/g, '/');
    while (candidate.length % 4) candidate += '=';
    let decoded;
    try {
        decoded = Buffer.from(candidate, 'base64');
    } catch (e) {
        return null;
    }
    if (!decoded.length) return null;
    const preview = decoded.toString('utf8').replace(/^\uFEFF/, '').trim();
    return preview.startsWith('{') || preview.startsWith('[') || isTvboxHex(preview) ? preview : null;
}

function imageTail(body) {
    if (!Buffer.isBuffer(body) || body.length < 4) return null;
    if (body[0] === 0xff && body[1] === 0xd8) {
        const marker = Buffer.from([0xff, 0xd9]);
        const pos = body.lastIndexOf(marker);
        return pos >= 0 && pos + 2 < body.length ? body.subarray(pos + 2) : null;
    }
    const pngEnd = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    const pos = body.lastIndexOf(pngEnd);
    return pos >= 0 && pos + pngEnd.length < body.length ? body.subarray(pos + pngEnd.length) : null;
}

function decodeTvboxBody(body, depth = 0) {
    if (depth > 4) throw new Error('配置嵌套层数过多');
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
    const tail = imageTail(buffer);
    if (tail && tail.toString('utf8').trim()) {
        const nested = decodeTvboxBody(tail, depth + 1);
        if (nested.decodeType === 'plain') nested.decodeType = 'image-base64';
        nested.notes.unshift('已提取图片尾部数据');
        return nested;
    }

    const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (!text) throw new Error('配置内容为空');
    if (isTvboxHex(text)) {
        return { text: decryptTvboxHex(text), decodeType: 'tvbox-aes-128-cbc', notes: ['已使用 TVBox AES-128-CBC 解密'] };
    }
    const base64 = tryBase64Payload(text);
    if (base64) {
        const nested = decodeTvboxBody(Buffer.from(base64, 'utf8'), depth + 1);
        if (nested.decodeType === 'plain') nested.decodeType = 'base64';
        nested.notes.unshift('已解开 Base64');
        return nested;
    }
    return { text, decodeType: 'plain', notes: [] };
}

function normalizeTvboxApi(raw) {
    const value = cleanText(raw, 1000);
    if (!/^https?:\/\//i.test(value)) return '';
    let parsed;
    try { parsed = new URL(value); } catch (e) { return ''; }
    if (!parsed.hostname || parsed.username || parsed.password) return '';

    let pathname = parsed.pathname.replace(/\/+$/, '');
    pathname = pathname.replace(/\/at\/(?:xml|json)$/i, '');
    if (!pathname) pathname = '/api.php/provide/vod';
    if (!/provide\/vod/i.test(pathname) && !/apijson\.php/i.test(pathname)) return '';

    parsed.pathname = pathname;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
}

function collectTvboxSites(config, source) {
    const entries = [];
    let directSites = 0;
    let skippedSites = 0;
    const sites = config && Array.isArray(config.sites) ? config.sites : [];
    for (const site of sites) {
        if (!site || typeof site !== 'object') { skippedSites++; continue; }
        const rawApi = typeof site.api === 'string' ? site.api : '';
        if (!/^https?:\/\//i.test(rawApi)) { skippedSites++; continue; }
        const api = normalizeTvboxApi(rawApi);
        if (!api) { skippedSites++; continue; }
        directSites++;
        let fallbackName = api;
        try { fallbackName = new URL(api).hostname.replace(/^www\./, ''); } catch (e) { }
        entries.push({
            name: cleanText(site.name || site.key || fallbackName, 80),
            api,
            siteType: site.type == null ? '' : String(site.type),
            sourceUrl: source && source.url || '',
            sourceName: source && source.name || ''
        });
    }
    return { entries, directSites, skippedSites };
}

function isPrivateIp(address) {
    const ip = String(address || '').toLowerCase();
    if (net.isIPv4(ip)) {
        const p = ip.split('.').map(Number);
        if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
        if (p[0] === 169 && p[1] === 254) return true;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
        if (p[0] === 192 && p[1] === 168) return true;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
        if (p[0] === 192 && p[1] === 0 && (p[2] === 0 || p[2] === 2)) return true;
        if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
        if (p[0] >= 224) return true;
        return false;
    }
    if (net.isIPv6(ip)) {
        if (ip === '::' || ip === '::1') return true;
        if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true;
        if (ip.startsWith('ff')) return true;
        if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
    }
    return false;
}

async function assertPublicUrl(raw) {
    let parsed;
    try { parsed = new URL(raw); } catch (e) { throw new Error('配置地址格式不正确'); }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('只支持 HTTP/HTTPS 配置地址');
    if (parsed.username || parsed.password) throw new Error('配置地址不能包含账号密码');
    const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host || host === 'localhost' || host.endsWith('.local')) throw new Error('不允许访问内网地址');
    if (net.isIP(host)) {
        if (isPrivateIp(host)) throw new Error('不允许访问内网地址');
        return;
    }
    let records;
    try {
        records = await dns.lookup(host, { all: true, verbatim: true });
    } catch (e) {
        throw new Error('域名解析失败');
    }
    if (!records.length || records.some(item => isPrivateIp(item.address))) throw new Error('配置地址解析到了内网地址');
}

async function fetchTvboxBuffer(rawUrl) {
    let current = String(rawUrl || '').trim();
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
        await assertPublicUrl(current);
        let response;
        try {
            response = await axios.get(current, {
                responseType: 'arraybuffer',
                timeout: FETCH_TIMEOUT,
                maxRedirects: 0,
                maxContentLength: MAX_BYTES,
                validateStatus: () => true,
                headers: { 'User-Agent': DEFAULT_UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9' }
            });
        } catch (e) {
            throw new Error(e.code === 'ECONNABORTED' ? '配置地址请求超时' : '无法连接配置地址');
        }
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            current = new URL(String(response.headers.location), current).toString();
            continue;
        }
        if (response.status < 200 || response.status >= 300) throw new Error('配置地址返回 HTTP ' + response.status);
        const buffer = Buffer.from(response.data || []);
        if (!buffer.length || buffer.length > MAX_BYTES) throw new Error(!buffer.length ? '配置内容为空' : '配置内容过大');
        return { buffer, finalUrl: current, contentType: response.headers['content-type'] || '' };
    }
    throw new Error('配置地址重定向次数过多');
}

function extractTargets(input) {
    const text = String(input || '').trim();
    if (!text) throw new Error('请先粘贴 TVBox 配置地址');
    const compact = text.replace(/\s+/g, '');
    if (/^[{[]/.test(text) || /^base64:\/\//i.test(text) || /^[0-9a-fA-F]{64,}$/.test(compact) || /"sites"\s*:/.test(text)) {
        return { kind: 'content', text };
    }

    const items = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const pieces = line.split(/(?=https?:\/\/)/i);
        let label = '';
        for (const piece of pieces) {
            const match = piece.match(/^https?:\/\/[^\s,|]+/i);
            if (!match) continue;
            const before = piece.slice(0, match.index || 0).replace(/[|,]\s*$/, '').trim();
            if (before && !label) label = before;
            const url = match[0].replace(/[)\]}>，。]+$/, '');
            items.push({ name: label, url });
        }
    }
    if (items.length) {
        if (items.length > MAX_INPUT_URLS) throw new Error('一次最多解析 ' + MAX_INPUT_URLS + ' 个配置地址');
        return { kind: 'urls', items };
    }
    if (text.length >= 24) return { kind: 'content', text };
    throw new Error('没有找到可解析的 HTTP/HTTPS 配置地址');
}

async function previewTvboxInput(input, options) {
    const opts = options || {};
    const existingApis = new Set(opts.existingApis || []);
    const errors = [];
    const candidates = [];
    const byApi = new Set();
    const visited = new Set();
    const queue = [];
    const stats = { configsFetched: 0, configsFailed: 0, directSites: 0, skippedSites: 0, duplicates: 0 };
    let nestedCount = 0;

    const addConfig = (data, sourceUrl, sourceName) => {
        const collected = collectTvboxSites(data, { url: sourceUrl, name: sourceName });
        stats.directSites += collected.directSites;
        stats.skippedSites += collected.skippedSites;
        for (const entry of collected.entries) {
            if (byApi.has(entry.api)) { stats.duplicates++; continue; }
            byApi.add(entry.api);
            candidates.push(Object.assign({}, entry, { existing: existingApis.has(entry.api), selected: !existingApis.has(entry.api) }));
        }
        if (data && Array.isArray(data.urls)) {
            for (const item of data.urls) {
                if (nestedCount >= MAX_NESTED_URLS) break;
                const raw = typeof item === 'string' ? item : item && typeof item.url === 'string' ? item.url : '';
                if (!raw || !/^https?:\/\//i.test(raw)) continue;
                let resolved = raw;
                try { resolved = sourceUrl ? new URL(raw, sourceUrl).toString() : new URL(raw).toString(); } catch (e) { continue; }
                queue.push({ url: resolved, name: item && item.name || sourceName || '', depth: 1 });
                nestedCount++;
            }
        }
    };

    try {
        const targets = extractTargets(input);
        if (targets.kind === 'content') {
            const decoded = decodeTvboxBody(Buffer.from(targets.text, 'utf8'));
            addConfig(parseTvboxJson(decoded.text), '', '粘贴内容');
            stats.configsFetched++;
        } else {
            for (const item of targets.items) queue.push(Object.assign({}, item, { depth: 0 }));
        }
    } catch (e) {
        throw new Error(e.message || '无法解析输入');
    }

    while (queue.length) {
        const item = queue.shift();
        if (item.depth > MAX_NESTED_DEPTH) continue;
        const key = item.url.replace(/#.*$/, '');
        if (visited.has(key)) continue;
        visited.add(key);
        try {
            const fetched = await fetchTvboxBuffer(key);
            const decoded = decodeTvboxBody(fetched.buffer);
            const data = parseTvboxJson(decoded.text);
            stats.configsFetched++;
            addConfig(data, fetched.finalUrl, item.name || '');
        } catch (e) {
            stats.configsFailed++;
            errors.push({ url: item.url, name: item.name || '', error: e.message || '解析失败' });
        }
    }

    candidates.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.api.localeCompare(b.api));
    return { candidates, errors, stats };
}

function parseMaccmsLine(line) {
    const value = String(line || '').trim();
    if (!value || value.startsWith('#')) return null;
    const match = value.match(/https?:\/\/[^\s,|]+/i);
    if (match) {
        const rawApi = match[0].replace(/[)\]}>，。]+$/, '');
        const name = value.slice(0, match.index).replace(/[|,\t\s]+$/, '').trim();
        return { name, rawApi };
    }
    const parts = value.split(/[|,\t]/).map(item => item.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return /^https?:\/\//i.test(parts[0]) ? { name: parts[1], rawApi: parts[0] } : { name: parts[0], rawApi: parts[1] };
    }
    return { name: '', rawApi: parts[0] || value };
}

function previewMaccmsInput(input, options) {
    const opts = options || {};
    const existingApis = new Set(opts.existingApis || []);
    const text = String(input || '').trim();
    if (!text) throw new Error('请先粘贴苹果CMS接口');
    const candidates = [];
    const errors = [];
    const byApi = new Set();
    let duplicates = 0;
    let skippedSites = 0;
    let lineCount = 0;

    for (const line of text.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        lineCount++;
        const parsed = parseMaccmsLine(line);
        let rawApi = parsed && parsed.rawApi || '';
        if (rawApi && !/^https?:\/\//i.test(rawApi)) rawApi = 'https://' + rawApi;
        const api = normalizeTvboxApi(rawApi);
        if (!api) {
            skippedSites++;
            errors.push({ line: cleanText(line, 300), error: '不是受支持的苹果CMS接口' });
            continue;
        }
        if (byApi.has(api)) { duplicates++; continue; }
        byApi.add(api);
        let fallbackName = api;
        try { fallbackName = new URL(api).hostname.replace(/^www\./, ''); } catch (e) { }
        const existing = existingApis.has(api);
        candidates.push({
            name: cleanText(parsed && parsed.name || fallbackName, 80),
            api,
            siteType: '',
            sourceUrl: '',
            sourceName: '粘贴导入',
            existing,
            selected: !existing
        });
    }

    if (!lineCount) throw new Error('没有找到可导入的接口');
    const existingCount = candidates.filter(item => item.existing).length;
    return {
        candidates,
        errors,
        stats: {
            lines: lineCount,
            validSites: candidates.length,
            newSites: candidates.length - existingCount,
            existingSites: existingCount,
            skippedSites,
            duplicates
        }
    };
}

module.exports = {
    decodeTvboxBody,
    decryptTvboxHex,
    normalizeTvboxApi,
    collectTvboxSites,
    parseTvboxJson,
    previewTvboxInput,
    previewMaccmsInput,
    extractTargets
};
