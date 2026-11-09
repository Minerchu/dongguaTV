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

test('后台 TMDb 反代会同时用于 API 和图片请求', async () => {
    const requests = [];
    const imagePath = '/t/p/w92/wwemzKWzjKYJFfCeiB57q3r4Bcm.png';
    const mockProxy = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        requests.push({ path: url.pathname, query: url.search });
        if (url.pathname === '/3/configuration') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } }));
            return;
        }
        if (url.pathname === imagePath) {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(Buffer.from('89504e470d0a1a0a', 'hex'));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
    });
    const proxyPort = await listen(mockProxy);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-tmdb-proxy-'));
    process.env.DB_PATH = path.join(tmp, 'db.json');
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.ADMIN_PASSWORD = 'integration-pass';
    process.env.TMDB_API_KEY = '';
    process.env.TMDB_READ_TOKEN = '';
    process.env.TMDB_ACCESS_TOKEN = '';
    process.env.TMDB_API_READ_TOKEN = '';
    process.env.TMDB_API_BASE = 'http://127.0.0.1:1/3';
    process.env.TMDB_API_FALLBACK = '';
    process.env.TMDB_IMAGE_BASE = 'http://127.0.0.1:1/t/p';
    process.env.TMDB_IMAGE_FALLBACK = '';
    process.env.TMDB_TIMEOUT = '2000';

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

        const apiKey = '0123456789abcdef0123456789abcdef';
        const proxyUrl = 'http://127.0.0.1:' + proxyPort;
        response = await request('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify({ tmdbCredential: apiKey, tmdbProxyUrl: proxyUrl })
        });
        let data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.success, true);
        assert.equal(data.settings.tmdbProxyConfigured, true);
        assert.equal(data.settings.tmdbApiEndpoint, proxyUrl + '/3');
        assert.equal(data.settings.tmdbImageEndpoint, proxyUrl + '/t/p');

        response = await request('/tmdb/3/configuration');
        assert.equal(response.status, 200);
        assert.equal(requests.at(-1).path, '/3/configuration');
        assert.match(requests.at(-1).query, /api_key=/);

        response = await request('/tmdb/t/p/w92/wwemzKWzjKYJFfCeiB57q3r4Bcm.png');
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/png');
        assert.equal(requests.at(-1).path, imagePath);

        response = await request('/api/admin/tmdb/test', {
            method: 'POST',
            body: JSON.stringify({ credential: apiKey, proxyUrl, imageProxyUrl: '' })
        });
        data = await response.json();
        assert.equal(data.success, true);
        assert.equal(data.imageOk, true);
        assert.equal(data.apiEndpoint, proxyUrl + '/3');
        assert.equal(data.imageEndpoint, proxyUrl + '/t/p');

        response = await request('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify({ tmdbProxyUrl: 'ftp://invalid.example.com' })
        });
        data = await response.json();
        assert.equal(response.status, 400);
        assert.equal(data.success, false);
    } finally {
        await close(server);
        await close(mockProxy);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
