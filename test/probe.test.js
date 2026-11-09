'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const probe = require('../probe');

function listen(server) {
    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
        server.on('error', reject);
    });
}

function close(server) {
    return new Promise(resolve => server.close(resolve));
}

test('PING 接受普通 HTML 响应，不要求 Maccms JSON', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>ok</html>');
    });
    const port = await listen(server);
    try {
        const result = await probe.pingSite({ api: 'http://127.0.0.1:' + port + '/api.php/provide/vod/' });
        assert.equal(result.ok, true);
        assert.equal(result.probe, 'ping');
        assert.equal(result.status, 200);
        assert.ok(result.latency >= 0);
    } finally {
        await close(server);
    }
});

test('PING 把 5xx 判为不可用', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('down');
    });
    const port = await listen(server);
    try {
        const result = await probe.pingSite({ api: 'http://127.0.0.1:' + port + '/api.php/provide/vod/' });
        assert.equal(result.ok, false);
        assert.equal(result.status, 503);
    } finally {
        await close(server);
    }
});

test('PING 把 4xx 视为服务器可达', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('forbidden');
    });
    const port = await listen(server);
    try {
        const result = await probe.pingSite({ api: 'http://127.0.0.1:' + port + '/api.php/provide/vod/' });
        assert.equal(result.ok, true);
        assert.equal(result.status, 403);
    } finally {
        await close(server);
    }
});

test('PING 拒绝非 http/https 目标', async () => {
    const result = await probe.pingSite({ api: 'ftp://example.com/file' });
    assert.equal(result.ok, false);
    assert.match(result.message, /http\/https/);
});

test('适配器优先使用 baseUrl', () => {
    assert.equal(probe.siteTarget({ adapter: 'demo', baseUrl: 'https://example.com/base', api: 'https://ignored.test' }), 'https://example.com/base');
});