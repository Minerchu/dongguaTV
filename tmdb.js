'use strict';

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const API_KEY_PATTERN = /\b[0-9a-f]{32}\b/i;
const DEFAULT_API_BASE = 'https://api.themoviedb.org/3';
const DEFAULT_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const DEFAULT_API_FALLBACK = 'https://api.tmdb.org/3';
const DEFAULT_IMAGE_FALLBACK = 'https://www.themoviedb.org/t/p';

function stripQuotes(value) {
    const credential = String(value || '').trim();
    if (credential.length < 2) return credential;
    const first = credential[0];
    const last = credential[credential.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return credential.slice(1, -1).trim();
    }
    return credential;
}

function normalizeCredential(value) {
    let credential = stripQuotes(value);
    if (!credential) return '';

    const jwt = credential.match(JWT_PATTERN);
    if (jwt) return jwt[0];

    const apiKey = credential.match(API_KEY_PATTERN);
    if (apiKey) return apiKey[0];

    credential = credential.replace(/^Bearer\s+/i, '').trim();
    credential = credential.replace(/^tmdb[\s:：]*/i, '').trim();
    return stripQuotes(credential);
}

function credentialType(value) {
    const credential = normalizeCredential(value);
    if (!credential) return 'none';
    if (JWT_PATTERN.test(credential) || credential.length > 80) return 'bearer';
    return 'api_key';
}

function buildAuth(value) {
    const credential = normalizeCredential(value);
    const type = credentialType(credential);
    if (type === 'bearer') {
        return { type, params: {}, headers: { Authorization: 'Bearer ' + credential } };
    }
    return { type, params: credential ? { api_key: credential } : {}, headers: {} };
}

function resolveCredential(settings, env) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const variables = env || process.env;
    const fromAdmin = normalizeCredential(source.tmdbCredential);
    if (fromAdmin) return { value: fromAdmin, type: credentialType(fromAdmin), source: 'admin' };
    const fromEnv = normalizeCredential(
        variables.TMDB_READ_TOKEN ||
        variables.TMDB_ACCESS_TOKEN ||
        variables.TMDB_API_READ_TOKEN ||
        variables.TMDB_API_KEY
    );
    if (fromEnv) return { value: fromEnv, type: credentialType(fromEnv), source: 'env' };
    return { value: '', type: 'none', source: 'none' };
}

function maskCredential(value) {
    const credential = normalizeCredential(value);
    return credential ? '••••' + credential.slice(-4) : '';
}

function trimBase(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeProxyUrl(value) {
    let url = trimBase(value);
    if (!url) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:\/\//i.test(url)) {
        throw new Error('TMDb 反代地址只支持 http 或 https');
    }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let parsed;
    try { parsed = new URL(url); } catch (e) { throw new Error('TMDb 反代地址格式不正确'); }
    if (!parsed.hostname) throw new Error('TMDb 反代地址缺少域名');
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('TMDb 反代地址只支持 http 或 https');
    if (parsed.username || parsed.password) throw new Error('TMDb 反代地址不能包含账号密码');
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
}

function sanitizeProxyUrl(value) {
    try { return normalizeProxyUrl(value); } catch (e) { return ''; }
}

function proxyRoot(value) {
    return normalizeProxyUrl(value).replace(/\/3$/i, '').replace(/\/t\/p$/i, '');
}

function apiBaseFromProxy(value) {
    const url = normalizeProxyUrl(value);
    if (!url) return '';
    if (/\/3$/i.test(url)) return url;
    return proxyRoot(url) + '/3';
}

function imageBaseFromProxy(value) {
    const url = normalizeProxyUrl(value);
    if (!url) return '';
    if (/\/t\/p$/i.test(url)) return url;
    return proxyRoot(url) + '/t/p';
}

function resolveUpstreams(settings, env) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const variables = env || process.env;
    const envApiBase = trimBase(variables.TMDB_API_BASE) || DEFAULT_API_BASE;
    const envImageBase = trimBase(variables.TMDB_IMAGE_BASE) || DEFAULT_IMAGE_BASE;
    const apiProxy = sanitizeProxyUrl(source.tmdbProxyUrl);
    const imageProxy = sanitizeProxyUrl(source.tmdbImageProxyUrl);
    let apiBase = envApiBase;
    let imageBase = envImageBase;
    let apiFallback = trimBase(variables.TMDB_API_FALLBACK)
        || (envApiBase === DEFAULT_API_BASE ? DEFAULT_API_FALLBACK : '');
    let imageFallback = trimBase(variables.TMDB_IMAGE_FALLBACK)
        || (envImageBase === DEFAULT_IMAGE_BASE ? DEFAULT_IMAGE_FALLBACK : '');

    if (apiProxy) {
        apiBase = apiBaseFromProxy(apiProxy);
        apiFallback = '';
        if (!imageProxy) {
            imageBase = imageBaseFromProxy(apiProxy);
            imageFallback = '';
        }
    }
    if (imageProxy) {
        imageBase = imageBaseFromProxy(imageProxy);
        imageFallback = '';
    }

    return {
        apiBase,
        imageBase,
        apiFallback,
        imageFallback,
        apiSource: apiProxy ? 'admin' : (envApiBase !== DEFAULT_API_BASE ? 'env' : 'default'),
        imageSource: imageProxy ? 'admin' : (apiProxy ? 'admin' : (envImageBase !== DEFAULT_IMAGE_BASE ? 'env' : 'default')),
        proxyUrl: apiProxy,
        imageProxyUrl: imageProxy
    };
}

module.exports = {
    normalizeCredential,
    credentialType,
    buildAuth,
    resolveCredential,
    maskCredential,
    normalizeProxyUrl,
    sanitizeProxyUrl,
    resolveUpstreams
};
