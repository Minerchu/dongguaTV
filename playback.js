'use strict';

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const axios = require('axios');

const BLOCKED_HOSTS = new Set([
    'localhost',
    'metadata',
    'metadata.google.internal',
    'instance-data',
    'instance-data.ec2.internal'
]);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

function normalizeIp(value) {
    return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
}

function ipv4Parts(value) {
    const parts = normalizeIp(value).split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map(part => Number(part));
    if (nums.some(num => !Number.isInteger(num) || num < 0 || num > 255)) return null;
    return nums;
}

function isPrivateIpv4(value) {
    const parts = ipv4Parts(value);
    if (!parts) return false;
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 192 && b === 168) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;
    return false;
}

function isPrivateIpv6(value) {
    const ip = normalizeIp(value);
    if (!net.isIPv6(ip)) return false;
    if (ip === '::' || ip === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;
    if (/^2001:db8:/.test(ip)) return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
        const high = parseInt(mappedHex[1], 16);
        const low = parseInt(mappedHex[2], 16);
        return isPrivateIpv4([(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255].join('.'));
    }
    return false;
}

function isPrivateIp(value) {
    const ip = normalizeIp(value);
    return net.isIPv4(ip) ? isPrivateIpv4(ip) : (net.isIPv6(ip) ? isPrivateIpv6(ip) : false);
}

function isBlockedHostname(value) {
    const host = normalizeIp(value).replace(/\.$/, '');
    if (!host) return true;
    if (BLOCKED_HOSTS.has(host)) return true;
    if (BLOCKED_SUFFIXES.some(suffix => host.endsWith(suffix))) return true;
    if (net.isIP(host)) return isPrivateIp(host);
    return false;
}

function normalizeTarget(raw) {
    let value = String(raw == null ? '' : raw).trim();
    if (!value) throw new Error('缺少播放地址');
    if (value.startsWith('//')) value = 'https:' + value;
    let url;
    try { url = new URL(value); } catch (error) { throw new Error('播放地址格式不正确'); }
    if (!/^https?:$/.test(url.protocol)) throw new Error('只允许 http/https 播放地址');
    if (url.username || url.password) throw new Error('播放地址不能包含账号密码');
    if (!url.hostname) throw new Error('播放地址缺少域名');
    return url;
}

async function assertPublicUrl(raw) {
    const url = normalizeTarget(raw);
    const host = normalizeIp(url.hostname);
    if (isBlockedHostname(host)) throw new Error('禁止代理内网或本机地址');
    if (net.isIP(host)) {
        if (isPrivateIp(host)) throw new Error('禁止代理内网或本机地址');
        return url;
    }
    const records = await dns.promises.lookup(host, { all: true, verbatim: true });
    if (!records.length) throw new Error('播放地址无法解析');
    if (records.some(record => isPrivateIp(record.address))) throw new Error('禁止代理内网或本机地址');
    return url;
}

function safeLookup(hostname, options, callback) {
    const wantsAll = options && typeof options === 'object' && options.all;
    dns.lookup(hostname, { all: true, verbatim: true }, (error, records) => {
        if (error) return callback(error);
        if (!records || !records.length) return callback(new Error('播放地址无法解析'));
        if (records.some(record => isPrivateIp(record.address))) return callback(new Error('禁止代理内网或本机地址'));
        if (wantsAll) return callback(null, records);
        callback(null, records[0].address, records[0].family);
    });
}

const httpAgent = new http.Agent({ keepAlive: true, lookup: safeLookup });
const httpsAgent = new https.Agent({ keepAlive: true, lookup: safeLookup });

function upstreamHeaders(site, range) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity'
    };
    const originSource = site && (site.api || site.baseUrl);
    if (originSource) {
        try {
            const siteUrl = new URL(originSource);
            headers.Referer = siteUrl.origin + '/';
            headers.Origin = siteUrl.origin;
        } catch (error) { }
    }
    if (range) headers.Range = String(range);
    return headers;
}

async function openStream(raw, options) {
    const opts = options || {};
    let current = await assertPublicUrl(raw);
    let response = null;
    for (let hop = 0; hop < 6; hop++) {
        response = await axios.request({
            url: current.href,
            method: opts.method || 'GET',
            headers: upstreamHeaders(opts.site, opts.range),
            responseType: 'stream',
            validateStatus: () => true,
            maxRedirects: 0,
            timeout: opts.timeout || 20000,
            httpAgent,
            httpsAgent,
            decompress: false
        });
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            if (response.data && response.data.destroy) response.data.destroy();
            current = await assertPublicUrl(new URL(response.headers.location, current.href).href);
            continue;
        }
        return { response, finalUrl: current.href };
    }
    if (response && response.data && response.data.destroy) response.data.destroy();
    throw new Error('播放地址重定向次数过多');
}

function isPlaylistRequest(targetUrl, contentType) {
    let pathname = '';
    try { pathname = new URL(targetUrl).pathname.toLowerCase(); } catch (error) { }
    const type = String(contentType || '').toLowerCase();
    return pathname.endsWith('.m3u8') || pathname.endsWith('.m3u') || /mpegurl|vnd\.apple/.test(type);
}

function collectStream(stream, maxBytes) {
    const limit = maxBytes || 4 * 1024 * 1024;
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        stream.on('data', chunk => {
            size += chunk.length;
            if (size > limit) {
                stream.destroy();
                reject(new Error('播放列表超过大小限制'));
                return;
            }
            chunks.push(chunk);
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

function rewriteHlsPlaylist(text, baseUrl, makeProxyUrl) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const absolute = uri => {
        const value = String(uri || '').trim();
        if (!value) return value;
        if (value.startsWith('/api/play/proxy')) return value;
        try { return new URL(value, baseUrl).href; } catch (error) { return value; }
    };
    return source.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
            return line.replace(/(URI\s*=\s*")([^"]+)(")/gi, (match, before, uri, after) => before + makeProxyUrl(absolute(uri)) + after)
                .replace(/(URI\s*=\s*')([^']+)(')/gi, (match, before, uri, after) => before + makeProxyUrl(absolute(uri)) + after);
        }
        return makeProxyUrl(absolute(trimmed));
    }).join('\n');
}

module.exports = {
    assertPublicUrl,
    isPrivateIp,
    isBlockedHostname,
    isPlaylistRequest,
    rewriteHlsPlaylist,
    openStream,
    collectStream
};
