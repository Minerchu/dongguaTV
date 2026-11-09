'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createAdapterRegistry } = require('../adapters');

test('自定义适配器可加载、搜索、详情和检查', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'donggua-adapter-'));
    fs.writeFileSync(path.join(dir, 'demo.js'), `
module.exports = {
  id: 'demo',
  name: '示例适配器',
  description: '测试用',
  async search(ctx) {
    return [{ id: '42', title: '示例影片 ' + ctx.query, poster: 'https://img.example/p.jpg', year: 2026 }];
  },
  async detail(ctx) {
    return {
      id: ctx.id,
      name: '示例影片',
      episodes: [{ name: '第1集', url: 'https://cdn.example/1.m3u8' }]
    };
  },
  async test() { return { ok: true, count: 1 }; }
};
`, 'utf8');
    try {
        const registry = createAdapterRegistry({ dir, timeout: 2000 });
        const adapters = registry.list();
        assert.equal(adapters.length, 1);
        assert.equal(adapters[0].id, 'demo');

        const site = { key: 'demo', name: '示例站', adapter: 'demo', baseUrl: 'https://example.com', adapterConfig: {} };
        const list = await registry.search('demo', site, '测试');
        assert.equal(list.length, 1);
        assert.equal(list[0].vod_id, '42');
        assert.equal(list[0].vod_name, '示例影片 测试');
        assert.equal(list[0].site_key, 'demo');

        const detail = await registry.detail('demo', site, '42');
        assert.equal(detail.list[0].vod_play_url, '第1集$https://cdn.example/1.m3u8');

        const checked = await registry.test('demo', site);
        assert.equal(checked.ok, true);
        assert.equal(checked.count, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('坏掉的适配器不会影响其他适配器加载', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'donggua-adapter-bad-'));
    fs.writeFileSync(path.join(dir, 'bad.js'), 'module.exports = { id: bad };', 'utf8');
    fs.writeFileSync(path.join(dir, 'good.js'), `
module.exports = {
  id: 'good', name: '正常',
  async search() { return []; },
  async detail() { return null; }
};
`, 'utf8');
    try {
        const registry = createAdapterRegistry({ dir });
        assert.equal(registry.list().length, 1);
        assert.equal(registry.list()[0].id, 'good');
        assert.match(registry.lastError, /bad\.js/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('通用 JSON 适配器可以搜索和读取自建接口', async (t) => {
    const upstream = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (url.pathname === '/api/search') {
            res.end(JSON.stringify({ list: [{ id: '7', title: '示例影片 ' + url.searchParams.get('q'), year: 2026 }] }));
            return;
        }
        if (url.pathname === '/api/detail/7') {
            res.end(JSON.stringify({ id: '7', name: '示例影片', episodes: [{ name: '正片', url: 'https://cdn.example/7.m3u8' }] }));
            return;
        }
        res.statusCode = 404;
        res.end('{}');
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => upstream.close(resolve)));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'donggua-adapter-json-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.copyFileSync(path.join(__dirname, '..', 'examples', 'adapters', 'generic-json.js'), path.join(dir, 'generic-json.js'));

    const address = upstream.address();
    const registry = createAdapterRegistry({ dir, timeout: 3000 });
    const site = {
        key: 'json-test',
        name: 'JSON 测试站',
        adapter: 'generic-json',
        baseUrl: 'http://127.0.0.1:' + address.port,
        adapterConfig: {
            searchPath: '/api/search',
            queryParam: 'q',
            detailPath: '/api/detail/{id}'
        }
    };
    const items = await registry.search('generic-json', site, '测试');
    assert.equal(items.length, 1);
    assert.equal(items[0].vod_name, '示例影片 测试');
    assert.equal(items[0].vod_year, '2026');

    const detail = await registry.detail('generic-json', site, '7');
    assert.equal(detail.list[0].vod_name, '示例影片');
    assert.equal(detail.list[0].vod_play_url, '正片$https://cdn.example/7.m3u8');
});
