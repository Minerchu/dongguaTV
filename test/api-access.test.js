'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function startApp(adminAllowedIps) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-api-access-'));
    process.env.DB_PATH = path.join(tmp, 'db.json');
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.ADAPTER_DIR = path.join(tmp, 'adapters');
    process.env.ADMIN_PASSWORD = 'integration-pass';
    process.env.ADMIN_ALLOWED_IPS = adminAllowedIps || '';
    delete process.env.API_ALLOWED_ORIGINS;
    delete process.env.TRUST_PROXY;

    delete require.cache[require.resolve('../server')];
    const app = require('../server');
    const server = app.listen(0, '127.0.0.1');
    const port = await new Promise((resolve, reject) => {
        server.once('listening', () => resolve(server.address().port));
        server.once('error', reject);
    });
    return {
        base: 'http://127.0.0.1:' + port,
        close: () => new Promise(resolve => server.close(resolve)),
        cleanup: () => fs.rmSync(tmp, { recursive: true, force: true })
    };
}

test('API 默认拒绝跨站来源，只放行同源请求', async () => {
    const ctx = await startApp('');
    try {
        const same = await fetch(ctx.base + '/api/config', {
            headers: { Origin: ctx.base }
        });
        assert.equal(same.status, 200);
        assert.equal(same.headers.get('access-control-allow-origin'), ctx.base);
        assert.equal(same.headers.get('access-control-allow-credentials'), 'true');

        const plain = await fetch(ctx.base + '/api/config');
        assert.equal(plain.status, 200);
        assert.equal(plain.headers.get('access-control-allow-origin'), null);

        const crossSite = await fetch(ctx.base + '/api/config', {
            headers: { Origin: 'https://evil.example' }
        });
        assert.equal(crossSite.status, 403);
        assert.equal(crossSite.headers.get('access-control-allow-origin'), null);

        const preflight = await fetch(ctx.base + '/api/search', {
            method: 'OPTIONS',
            headers: {
                Origin: ctx.base,
                'Access-Control-Request-Method': 'GET'
            }
        });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get('access-control-allow-origin'), ctx.base);
        assert.match(preflight.headers.get('access-control-allow-headers'), /X-Admin-Token/);

        const blockedPreflight = await fetch(ctx.base + '/api/search', {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://evil.example',
                'Access-Control-Request-Method': 'GET'
            }
        });
        assert.equal(blockedPreflight.status, 403);

        const admin = await fetch(ctx.base + '/api/admin/sites', {
            headers: { Origin: ctx.base }
        });
        assert.equal(admin.status, 401);
        assert.deepEqual(await admin.json(), { success: false, error: '请先登录后台' });
    } finally {
        await ctx.close();
        ctx.cleanup();
    }
});

test('后台 IP 白名单可以限制为仅本机访问', async () => {
    const denied = await startApp('203.0.113.10');
    try {
        const adminPage = await fetch(denied.base + '/admin.html');
        assert.equal(adminPage.status, 403);

        const adminApi = await fetch(denied.base + '/api/admin/me');
        assert.equal(adminApi.status, 403);

        const publicApi = await fetch(denied.base + '/api/config');
        assert.equal(publicApi.status, 200);
    } finally {
        await denied.close();
        denied.cleanup();
    }

    const local = await startApp('loopback');
    try {
        const adminPage = await fetch(local.base + '/admin.html');
        assert.equal(adminPage.status, 200);

        const adminApi = await fetch(local.base + '/api/admin/me');
        assert.equal(adminApi.status, 200);
        assert.deepEqual(await adminApi.json(), { loggedIn: false });
    } finally {
        await local.close();
        local.cleanup();
    }
});
