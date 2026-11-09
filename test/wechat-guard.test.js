'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WECHAT_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50';
const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

function close(server) {
    return new Promise(resolve => server.close(resolve));
}

test('WeChat pages redirect to the browser guide without blocking assets or APIs', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-wechat-guard-'));
    process.env.DB_PATH = path.join(tmp, 'db.json');
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.ADAPTER_DIR = path.join(tmp, 'adapters');
    process.env.ADMIN_PASSWORD = 'integration-pass';

    delete require.cache[require.resolve('../server')];
    const app = require('../server');
    const server = app.listen(0, '127.0.0.1');
    const port = await new Promise((resolve, reject) => {
        server.once('listening', () => resolve(server.address().port));
        server.once('error', reject);
    });
    const base = 'http://127.0.0.1:' + port;

    const request = (url, userAgent) => fetch(base + url, {
        headers: { 'user-agent': userAgent },
        redirect: 'manual'
    });

    try {
        let response = await request('/title/movie/1263337?from=wechat', WECHAT_UA);
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const guide = new URL(response.headers.get('location'), base);
        assert.equal(guide.pathname, '/wechat-guide.html');
        assert.equal(guide.searchParams.get('next'), '/title/movie/1263337?from=wechat');

        response = await request('/wechat-guide.html?next=%2Ftitle%2Fmovie%2F1263337', WECHAT_UA);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /请改用浏览器打开/);

        response = await request('/api/config', WECHAT_UA);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /application\/json/);

        response = await request('/assets/favicon.png', WECHAT_UA);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /image\/png/);

        response = await request('/', BROWSER_UA);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /<div id="app">/);
    } finally {
        await close(server);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
