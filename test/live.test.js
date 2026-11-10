'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');
const live = require('../live');

function close(server) {
    return new Promise(resolve => server.close(resolve));
}

function listen(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1');
        server.once('listening', () => resolve(server));
        server.once('error', reject);
    });
}

test('M3U 解析支持标准属性、标题后属性、EXTGRP、相对地址和去重', () => {
    const source = [
        '#EXTM3U',
        '#PLAYLIST:测试直播',
        '#EXTINF:-1 tvg-id="cctv1" tvg-logo="logo/cctv1.png" group-title="央视",CCTV-1',
        'streams/cctv1.m3u8',
        '#EXTINF:-1,湖南卫视 tvg-id="hunan"',
        '#EXTGRP:卫视',
        'https://cdn.example.com/hunan.m3u8',
        '#EXTINF:-1 group-title="忽略",无效协议',
        'rtp://239.0.0.1:5000',
        '#EXTINF:-1,CCTV-1 重复',
        'streams/cctv1.m3u8'
    ].join('\n');

    const channels = live.parseM3u(source, 'https://example.com/list/live.m3u');
    assert.equal(channels.length, 2);
    assert.equal(channels[0].name, 'CCTV-1');
    assert.equal(channels[0].group, '央视');
    assert.equal(channels[0].url, 'https://example.com/list/streams/cctv1.m3u8');
    assert.equal(channels[0].logo, 'https://example.com/list/logo/cctv1.png');
    assert.equal(channels[1].name, '湖南卫视');
    assert.equal(channels[1].group, '卫视');
});

test('直播源规范化会补全 ID、拒绝重复地址并保留启停状态', () => {
    const sources = live.normalizeSources([
        { name: '源 A', url: 'https://example.com/a.m3u', enabled: true },
        { name: '重复', url: 'https://example.com/a.m3u', enabled: false }
    ]);
    assert.equal(sources.length, 1);
    assert.match(sources[0].id, /^live_[a-f0-9]{12}$/);
    assert.equal(sources[0].enabled, true);
    assert.throws(() => live.normalizeSources([
        { name: 'A', url: 'https://example.com/a.m3u' },
        { name: 'B', url: 'https://example.com/a.m3u' }
    ], { strict: true }), /重复/);
});

test('直播服务聚合频道并生成可验证的代理签名', async () => {
    const playlist = [
        '#EXTM3U',
        '#EXTINF:-1 group-title="央视",CCTV-1',
        'https://cdn.example.com/cctv1.m3u8',
        '#EXTINF:-1 group-title="卫视",湖南卫视',
        'https://cdn.example.com/hunan.m3u8'
    ].join('\n');
    const service = live.createService({
        secret: 'test-secret',
        getSettings: () => ({
            liveEnabled: true,
            liveSources: [{ id: 'source-a', name: '源 A', url: 'https://example.com/a.m3u', enabled: true }]
        }),
        fetchText: async () => ({ text: playlist, finalUrl: 'https://example.com/a.m3u' })
    });

    const data = await service.listChannels({});
    assert.equal(data.enabled, true);
    assert.equal(data.channelCount, 2);
    assert.equal(data.sources[0].count, 2);
    assert.deepEqual(data.groups.sort(), ['央视', '卫视'].sort());

    const proxy = new URL('http://localhost' + data.channels[0].proxyUrl);
    assert.equal(service.verifyProxyUrl(
        proxy.searchParams.get('url'),
        proxy.searchParams.get('exp'),
        proxy.searchParams.get('sig')
    ), true);
    assert.equal(service.verifyProxyUrl(
        proxy.searchParams.get('url') + '?tampered=1',
        proxy.searchParams.get('exp'),
        proxy.searchParams.get('sig')
    ), false);
});

test('直播代理会重写 HLS 子地址并拒绝无签名请求', async () => {
    const service = live.createService({
        secret: 'proxy-secret',
        getSettings: () => ({ liveEnabled: true, liveSources: [] }),
        fetchText: async () => '',
        openStream: async url => ({
            response: {
                status: 200,
                headers: { 'content-type': 'application/vnd.apple.mpegurl' },
                data: Readable.from([Buffer.from('#EXTM3U\n#EXTINF:-1,测试\nhttps://cdn.example.com/part.m3u8\n')])
            },
            finalUrl: url
        })
    });
    const app = express();
    app.use('/api/live', service.router);
    const server = await listen(app);
    const base = 'http://127.0.0.1:' + server.address().port;

    try {
        const proxyUrl = service.signProxyUrl('https://origin.example.com/master.m3u8');
        const response = await fetch(base + proxyUrl);
        assert.equal(response.status, 200);
        const body = await response.text();
        assert.match(body, /#EXTM3U/);
        assert.match(body, /\/api\/live\/stream\?url=/);
        assert.doesNotMatch(body, /https:\/\/cdn\.example\.com\/part\.m3u8/);

        const rejected = await fetch(base + '/api/live/stream?url=' + encodeURIComponent('https://origin.example.com/master.m3u8'));
        assert.equal(rejected.status, 403);
    } finally {
        await close(server);
    }
});

test('后台保存直播源后配置接口和直播页可用', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-live-'));
    process.env.DB_PATH = path.join(tmp, 'db.json');
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.ADAPTER_DIR = path.join(tmp, 'adapters');
    process.env.ADMIN_PASSWORD = 'live-test-pass';

    delete require.cache[require.resolve('../server')];
    const app = require('../server');
    const server = await listen(app);
    const base = 'http://127.0.0.1:' + server.address().port;

    try {
        const login = await fetch(base + '/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'live-test-pass' })
        });
        const loginData = await login.json();
        assert.equal(loginData.success, true);

        const save = await fetch(base + '/api/admin/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': loginData.token },
            body: JSON.stringify({
                liveEnabled: true,
                liveSources: [{ name: '测试直播', url: 'https://example.com/live.m3u', enabled: true }]
            })
        });
        const saved = await save.json();
        assert.equal(saved.success, true);
        assert.equal(saved.settings.liveSources.length, 1);

        const config = await (await fetch(base + '/api/config')).json();
        assert.equal(config.liveEnabled, true);
        assert.equal(config.liveSourceCount, 1);

        const page = await fetch(base + '/live', {
            headers: { 'user-agent': 'Mozilla/5.0 Version/17.0 Safari/604.1' }
        });
        assert.equal(page.status, 200);
        assert.match(await page.text(), /\/live\.js/);
    } finally {
        await close(server);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
