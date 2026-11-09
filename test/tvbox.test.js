'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const tvbox = require('../tvbox');

const sample = {
    sites: [
        { key: 'good', name: '示例资源站', type: 1, api: 'https://example.com/api.php/provide/vod' },
        { key: 'xml', name: 'XML资源', type: 0, api: 'https://api.example.net/api.php/provide/vod/at/xml/' },
        { key: 'builtin', name: '内置源', type: 3, api: 'csp_Test' }
    ]
};

test('规范化 Maccms 地址并跳过 csp 内置源', () => {
    assert.equal(tvbox.normalizeTvboxApi('https://api.example.net/api.php/provide/vod/at/xml/'), 'https://api.example.net/api.php/provide/vod');
    assert.equal(tvbox.normalizeTvboxApi('csp_Test'), '');
    const result = tvbox.collectTvboxSites(sample, { url: 'https://example.com/tvbox.json' });
    assert.equal(result.entries.length, 2);
    assert.equal(result.directSites, 2);
    assert.equal(result.skippedSites, 1);
    assert.equal(result.entries[0].api, 'https://example.com/api.php/provide/vod');
});

test('解析带注释和尾逗号的 TVBox JSON', () => {
    const text = '// comment\n' + JSON.stringify(sample).replace('}]' , '},]');
    const decoded = tvbox.decodeTvboxBody(Buffer.from(text));
    assert.equal(decoded.decodeType, 'plain');
    assert.equal(tvbox.parseTvboxJson(decoded.text).sites.length, 3);
});

test('解开 Base64 TVBox 配置', () => {
    const encoded = Buffer.from(JSON.stringify(sample), 'utf8').toString('base64');
    const decoded = tvbox.decodeTvboxBody(Buffer.from(encoded));
    assert.equal(decoded.decodeType, 'base64');
    assert.equal(tvbox.parseTvboxJson(decoded.text).sites.length, 3);
});

test('解开 TVBox 2423/2324 AES-128-CBC 配置', () => {
    const key = Buffer.from('1234567890123456', 'ascii');
    const shortIv = Buffer.from('abcdefghijklm', 'ascii');
    const paddedIv = Buffer.concat([shortIv, Buffer.from('000', 'ascii')]);
    const cipher = crypto.createCipheriv('aes-128-cbc', key, paddedIv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(sample), 'utf8'), cipher.final()]);
    const hex = '2423' + key.toString('hex') + '2324' + encrypted.toString('hex') + shortIv.toString('hex');
    const decoded = tvbox.decodeTvboxBody(Buffer.from(hex));
    assert.equal(decoded.decodeType, 'tvbox-aes-128-cbc');
    assert.equal(tvbox.parseTvboxJson(decoded.text).sites.length, 3);
});

test('提取 JPEG 图片尾部隐藏配置', () => {
    const encoded = Buffer.from(Buffer.from(JSON.stringify(sample), 'utf8').toString('base64'), 'utf8');
    const image = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), encoded]);
    const decoded = tvbox.decodeTvboxBody(image);
    assert.ok(decoded.decodeType === 'base64' || decoded.decodeType === 'image-base64');
    assert.equal(tvbox.parseTvboxJson(decoded.text).sites.length, 3);
});

test('苹果CMS导入会查重并去掉输入内重复项', () => {
    const input = [
        '已存在,https://example.com/api.php/provide/vod',
        '新资源站,example.org/inc/apijson.php',
        'example.org/inc/apijson.php'
    ].join('\n');
    const result = tvbox.previewMaccmsInput(input, { existingApis: ['https://example.com/api.php/provide/vod'] });
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates.find(item => item.api.includes('example.com')).existing, true);
    assert.equal(result.candidates.find(item => item.api.includes('example.org')).existing, false);
    assert.equal(result.stats.duplicates, 1);
    assert.equal(result.errors.length, 0);
});

test('苹果CMS地址变体也会命中已有站点', () => {
    const result = tvbox.previewMaccmsInput('https://example.com/api.php/provide/vod/at/xml/', {
        existingApis: ['https://example.com/api.php/provide/vod']
    });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].existing, true);
});

test('直接粘贴 TVBox JSON 内容也能解析预览', async () => {
    const result = await tvbox.previewTvboxInput(JSON.stringify(sample), {
        existingApis: ['https://api.example.net/api.php/provide/vod']
    });
    assert.equal(result.stats.configsFetched, 1);
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates.find(item => item.api.includes('api.example.net')).existing, true);
    assert.equal(result.candidates.find(item => item.api.includes('example.com')).existing, false);
});

test('连续拼接的配置地址可以拆开', () => {
    const result = tvbox.extractTargets('https://a.example/tvhttps://b.example/tv');
    assert.equal(result.kind, 'urls');
    assert.deepEqual(result.items.map(item => item.url), ['https://a.example/tv', 'https://b.example/tv']);
});
