'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function listen(server) {
    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
        server.on('error', reject);
    });
}

function close(server) {
    return new Promise(resolve => server.close(resolve));
}

test('后台可保存两种 TMDb 凭据并通过代理鉴权', async () => {
    const requests = [];
    const mockTmdb = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        requests.push({
            path: url.pathname,
            apiKey: url.searchParams.get('api_key'),
            authorization: req.headers.authorization || ''
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ images: {} }));
    });
    const mockPort = await listen(mockTmdb);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-tmdb-admin-'));
    process.env.DB_PATH = path.join(tmp, 'db.json');
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.ADMIN_PASSWORD = 'integration-pass';
    process.env.TMDB_API_KEY = '';
    process.env.TMDB_READ_TOKEN = '';
    process.env.TMDB_ACCESS_TOKEN = '';
    process.env.TMDB_API_READ_TOKEN = '';
    process.env.TMDB_API_BASE = 'http://127.0.0.1:' + mockPort + '/3';
    process.env.TMDB_API_FALLBACK = '';

    delete require.cache[require.resolve('../server')];
    const app = require('../server');
    const server = app.listen(0, '127.0.0.1');
    const port = await new Promise((resolve, reject) => {
        server.once('listening', () => resolve(server.address().port));
        server.once('error', reject);
    });
    const base = 'http://127.0.0.1:' + port;
    let cookie = '';
    const request = async (url, options) => {
        const headers = Object.assign({}, options && options.headers);
        if (cookie) headers.Cookie = cookie;
        if (options && options.body) headers['Content-Type'] = 'application/json';
        return fetch(base + url, Object.assign({}, options, { headers }));
    };

    try {
        let response = await request('/api/admin/login', {
            method: 'POST',
            body: JSON.stringify({ password: 'integration-pass' })
        });
        cookie = String(response.headers.get('set-cookie') || '').split(';')[0];

        response = await request('/api/admin/sites');
        let data = await response.json();
        assert.equal(data.settings.tmdbConfigured, false);

        const apiKey = '0123456789abcdef0123456789abcdef';
        response = await request('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify({ tmdbCredential: apiKey })
        });
        data = await response.json();
        assert.equal(data.settings.tmdbConfigured, true);
        assert.equal(data.settings.tmdbType, 'api_key');
        assert.equal(data.settings.tmdbSource, 'admin');
        assert.equal(data.settings.tmdbCredential, '');
        assert.equal(data.settings.tmdbCredentialHint, '••••' + apiKey.slice(-4));
        assert.ok(!JSON.stringify(data).includes(apiKey));

        response = await request('/tmdb/3/configuration');
        assert.equal(response.status, 200);
        assert.equal(requests.at(-1).apiKey, apiKey);
        assert.equal(requests.at(-1).authorization, '');

        const readToken = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZXN0In0.signature';
        response = await request('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify({ tmdbCredential: 'tmdb' + readToken + '密钥' + apiKey })
        });
        data = await response.json();
        assert.equal(data.settings.tmdbType, 'bearer');
        assert.equal(data.settings.tmdbCredential, '');
        assert.ok(!JSON.stringify(data).includes(readToken));

        response = await request('/tmdb/3/configuration');
        assert.equal(response.status, 200);
        assert.equal(requests.at(-1).apiKey, null);
        assert.equal(requests.at(-1).authorization, 'Bearer ' + readToken);

        response = await request('/api/admin/tmdb/test', {
            method: 'POST',
            body: JSON.stringify({ credential: readToken })
        });
        data = await response.json();
        assert.equal(data.success, true);
        assert.equal(data.type, 'bearer');

        response = await request('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify({ tmdbCredential: '' })
        });
        data = await response.json();
        assert.equal(data.settings.tmdbConfigured, false);

        response = await request('/tmdb/3/configuration');
        assert.equal(response.status, 503);
    } finally {
        await close(server);
        await close(mockTmdb);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});