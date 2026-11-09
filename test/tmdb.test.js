'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tmdb = require('../tmdb');

const API_KEY = '0123456789abcdef0123456789abcdef';
const READ_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZXN0In0.signature';

test('TMDb 短 API Key 会作为 api_key 参数发送', () => {
    const auth = tmdb.buildAuth(API_KEY);
    assert.equal(auth.type, 'api_key');
    assert.equal(auth.params.api_key, API_KEY);
    assert.deepEqual(auth.headers, {});
});

test('TMDb Read Access Token 会作为 Bearer 头发送', () => {
    const auth = tmdb.buildAuth('Bearer ' + READ_TOKEN);
    assert.equal(auth.type, 'bearer');
    assert.equal(auth.headers.Authorization, 'Bearer ' + READ_TOKEN);
    assert.deepEqual(auth.params, {});
});

test('粘贴时带 tmdb 标记也能识别长 Token', () => {
    const auth = tmdb.buildAuth('tmdb' + READ_TOKEN);
    assert.equal(auth.type, 'bearer');
    assert.equal(auth.headers.Authorization, 'Bearer ' + READ_TOKEN);
});

test('整段粘贴两段凭据时优先提取长 Token', () => {
    const auth = tmdb.buildAuth('tmdb' + READ_TOKEN + '密钥' + API_KEY);
    assert.equal(auth.type, 'bearer');
    assert.equal(auth.headers.Authorization, 'Bearer ' + READ_TOKEN);
});

test('带中文标签的短密钥也能自动提取', () => {
    assert.equal(tmdb.normalizeCredential('API Key：' + API_KEY), API_KEY);
    assert.equal(tmdb.buildAuth('密钥' + API_KEY).params.api_key, API_KEY);
});

test('后台 TMDb 凭据优先于环境变量', () => {
    const resolved = tmdb.resolveCredential(
        { tmdbCredential: API_KEY },
        { TMDB_API_KEY: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
    );
    assert.equal(resolved.value, API_KEY);
    assert.equal(resolved.source, 'admin');
});

test('兼容 TMDB_READ_TOKEN 和旧的 TMDB_API_KEY', () => {
    assert.equal(tmdb.resolveCredential({}, { TMDB_READ_TOKEN: READ_TOKEN }).type, 'bearer');
    assert.equal(tmdb.resolveCredential({}, { TMDB_API_KEY: 'cccccccccccccccccccccccccccccccc' }).type, 'api_key');
});

test('凭据提示只暴露末尾四位', () => {
    const masked = tmdb.maskCredential(READ_TOKEN);
    assert.equal(masked, '••••' + READ_TOKEN.slice(-4));
    assert.ok(!masked.includes('eyJ'));
});

test('TMDb 反代根地址会自动补齐 API 和图片路径', () => {
    const upstreams = tmdb.resolveUpstreams({ tmdbProxyUrl: 'tmdb.example.com' }, {});
    assert.equal(upstreams.apiBase, 'https://tmdb.example.com/3');
    assert.equal(upstreams.imageBase, 'https://tmdb.example.com/t/p');
    assert.equal(upstreams.apiFallback, '');
    assert.equal(upstreams.imageFallback, '');
    assert.equal(upstreams.proxyUrl, 'https://tmdb.example.com');
});

test('反代地址带 /3 或 /t/p 时也能正确识别', () => {
    let upstreams = tmdb.resolveUpstreams({ tmdbProxyUrl: 'https://tmdb.example.com/3' }, {});
    assert.equal(upstreams.apiBase, 'https://tmdb.example.com/3');
    assert.equal(upstreams.imageBase, 'https://tmdb.example.com/t/p');
    upstreams = tmdb.resolveUpstreams({ tmdbProxyUrl: 'https://tmdb.example.com/t/p' }, {});
    assert.equal(upstreams.apiBase, 'https://tmdb.example.com/3');
    assert.equal(upstreams.imageBase, 'https://tmdb.example.com/t/p');
});

test('API 和图片可以使用不同的反代地址', () => {
    const upstreams = tmdb.resolveUpstreams({
        tmdbProxyUrl: 'https://api-proxy.example.com',
        tmdbImageProxyUrl: 'https://img-proxy.example.com/t/p'
    }, {});
    assert.equal(upstreams.apiBase, 'https://api-proxy.example.com/3');
    assert.equal(upstreams.imageBase, 'https://img-proxy.example.com/t/p');
});

test('非法反代地址会被安全忽略', () => {
    assert.equal(tmdb.sanitizeProxyUrl('javascript:alert(1)'), '');
    assert.equal(tmdb.sanitizeProxyUrl('ftp://example.com'), '');
    const upstreams = tmdb.resolveUpstreams({ tmdbProxyUrl: 'javascript:alert(1)' }, {});
    assert.equal(upstreams.apiBase, 'https://api.themoviedb.org/3');
    assert.equal(upstreams.imageBase, 'https://image.tmdb.org/t/p');
});
