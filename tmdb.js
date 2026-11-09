'use strict';

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const API_KEY_PATTERN = /\b[0-9a-f]{32}\b/i;

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

module.exports = { normalizeCredential, credentialType, buildAuth, resolveCredential, maskCredential };