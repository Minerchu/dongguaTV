'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const aggregate = require('../aggregate');
const health = require('../health');
const playback = require('../playback');
const backup = require('../backup');

test('搜索结果按片名和年份聚合，并去掉同站重复项', () => {
    const list = [
        { vod_name: '示例电影', vod_year: '2024', vod_id: 1, site_key: 'a', site_name: 'A站', vod_pic: 'https://img.example/a.jpg' },
        { vod_name: '示例电影（国语）', vod_year: '2024', vod_id: 2, site_key: 'b', site_name: 'B站', vod_pic: 'https://img.example/b.jpg' },
        { vod_name: '示例电影', vod_year: '2024', vod_id: 1, site_key: 'a', site_name: 'A站' }
    ];
    const groups = aggregate.groupSearchResults(list);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].siteCount, 2);
    assert.equal(groups[0].sourceCount, 2);
    assert.equal(groups[0].pic, 'https://img.example/a.jpg');
});

test('同名不同年份不会合并', () => {
    const groups = aggregate.groupSearchResults([
        { vod_name: '同名剧', vod_year: '2019', vod_id: 1, site_key: 'a' },
        { vod_name: '同名剧', vod_year: '2024', vod_id: 2, site_key: 'b' }
    ]);
    assert.equal(groups.length, 2);
});

test('无年份版本会并入唯一的年份分组', () => {
    const groups = aggregate.groupSearchResults([
        { vod_name: '无年份片', vod_id: 1, site_key: 'a' },
        { vod_name: '无年份片', vod_year: '2023', vod_id: 2, site_key: 'b' }
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].year, '2023');
    assert.equal(groups[0].sourceCount, 2);
});

test('健康巡检连续失败进入冷却，恢复后自动解除', async () => {
    let now = 1000000;
    let shouldFail = true;
    const monitor = health.createHealthMonitor({
        now: () => now,
        failureThreshold: 2,
        cooldownBase: 1000,
        check: async () => shouldFail ? { ok: false, message: '超时' } : { ok: true, latency: 12 }
    });
    const sites = [{ key: 'a', name: 'A', api: 'https://example.com/api.php/provide/vod', active: true }];
    monitor.recordFailure('a', '超时');
    monitor.recordFailure('a', '超时');
    assert.equal(monitor.isCooling('a'), true);
    assert.equal(monitor.snapshot('a').cooldownSeconds, 1);
    now += 1500;
    assert.equal(monitor.isCooling('a'), false);
    shouldFail = false;
    await monitor.checkSites(sites, { force: true });
    const state = monitor.snapshot('a');
    assert.equal(state.ok, true);
    assert.equal(state.consecutiveFails, 0);
    assert.equal(state.latency, 12);
});

test('健康巡检默认跳过冷却中的站点', async () => {
    let checked = 0;
    const monitor = health.createHealthMonitor({
        now: () => 5000,
        failureThreshold: 1,
        cooldownBase: 10000,
        check: async () => { checked++; return { ok: true, latency: 1 }; }
    });
    const sites = [{ key: 'a', name: 'A', api: 'https://example.com/api.php/provide/vod', active: true }];
    monitor.recordFailure('a', '失败');
    await monitor.checkSites(sites);
    assert.equal(checked, 0);
    await monitor.checkSites(sites, { force: true });
    assert.equal(checked, 1);
});

test('播放代理识别内网地址', async () => {
    assert.equal(playback.isPrivateIp('127.0.0.1'), true);
    assert.equal(playback.isPrivateIp('10.2.3.4'), true);
    assert.equal(playback.isPrivateIp('172.20.1.1'), true);
    assert.equal(playback.isPrivateIp('192.168.1.1'), true);
    assert.equal(playback.isPrivateIp('::1'), true);
    assert.equal(playback.isPrivateIp('8.8.8.8'), false);
    assert.equal(playback.isBlockedHostname('localhost'), true);
    await assert.rejects(() => playback.assertPublicUrl('http://127.0.0.1/a.m3u8'), /内网|本机/);
    await assert.rejects(() => playback.assertPublicUrl('http://[::1]/a.m3u8'), /内网|本机/);
    const publicUrl = await playback.assertPublicUrl('http://8.8.8.8/a.m3u8');
    assert.equal(publicUrl.hostname, '8.8.8.8');
});

test('HLS 播放列表会重写分片、密钥和子列表地址', () => {
    const source = [
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000',
        'low/index.m3u8',
        '#EXTINF:6,',
        'seg-1.ts?token=abc'
    ].join('\n');
    const output = playback.rewriteHlsPlaylist(source, 'https://cdn.example.com/path/master.m3u8', url => '/p?u=' + encodeURIComponent(url));
    assert.ok(output.includes('URI="/p?u=' + encodeURIComponent('https://cdn.example.com/path/key.bin')));
    assert.ok(output.includes('/p?u=' + encodeURIComponent('https://cdn.example.com/path/init.mp4')));
    assert.ok(output.includes('/p?u=' + encodeURIComponent('https://cdn.example.com/path/low/index.m3u8')));
    assert.ok(output.includes('/p?u=' + encodeURIComponent('https://cdn.example.com/path/seg-1.ts?token=abc')));
});

test('播放列表识别不依赖单一扩展名', () => {
    assert.equal(playback.isPlaylistRequest('https://example.com/a.m3u8?x=1', ''), true);
    assert.equal(playback.isPlaylistRequest('https://example.com/play', 'application/vnd.apple.mpegurl'), true);
    assert.equal(playback.isPlaylistRequest('https://example.com/a.ts', 'video/mp2t'), false);
});

test('备份文件按时间排序并只保留指定数量', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'donggua-backup-'));
    const dataFile = path.join(dir, 'db.json');
    const backupDir = path.join(dir, 'backups');
    fs.writeFileSync(dataFile, '{"sites":[]}', 'utf8');
    try {
        for (let i = 0; i < 4; i++) backup.createBackup(dataFile, backupDir, { keep: 2, now: new Date(2026, 0, 1, 0, 0, i) });
        const files = backup.listBackups(backupDir);
        assert.equal(files.length, 2);
        assert.ok(backup.readBackup(backupDir, files[0].name).includes('sites'));
        assert.throws(() => backup.backupPath(backupDir, '../db.json'), /文件名/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
