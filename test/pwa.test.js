'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const WECHAT_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50';
const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

function close(server) {
    return new Promise(resolve => server.close(resolve));
}

test('PWA manifest and service worker avoid private API routes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
    assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
    assert.ok(manifest.shortcuts.some(shortcut => shortcut.url === '/live'));
    manifest.icons.forEach(icon => {
        assert.equal(fs.existsSync(path.join(PUBLIC_DIR, icon.src)), true, icon.src);
    });

    const sw = fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8');
    assert.match(sw, /startsWith\('\/api\/'\)/);
    assert.match(sw, /startsWith\('\/tmdb\/'\)/);
    assert.match(sw, /startsWith\('\/player'\)/);
    assert.match(sw, /startsWith\('\/admin'\)/);
    assert.match(sw, /startsWith\('\/live'\)/);
    assert.match(sw, /WeChat|wechat-guide/);
});

test('PWA assets stay reachable inside WeChat and the shell contains new player controls', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-pwa-'));
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

    try {
        for (const asset of ['/manifest.webmanifest', '/pwa.js', '/sw.js']) {
            const response = await fetch(base + asset, { headers: { 'user-agent': WECHAT_UA } });
            assert.equal(response.status, 200, asset);
        }

        const response = await fetch(base + '/', { headers: { 'user-agent': BROWSER_UA } });
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.ok(html.includes('manifest.webmanifest'));
        assert.ok(html.includes('/pwa.js'));
        assert.ok(html.includes('pwa-install'));
        assert.ok(html.includes('toggleAutoNext'));
        assert.ok(html.includes('toggleSkipEditor'));
        assert.match(html, /\.mount\('#app'\)/);
    } finally {
        await close(server);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
