'use strict';

const axios = require('axios');

const DEFAULT_TIMEOUT = 5000;
const USER_AGENT = 'Mozilla/5.0 DongguaTV/2.0';

function siteTarget(site) {
    const input = site && typeof site === 'object' ? site : { api: site };
    const raw = String(input.baseUrl || input.api || '').trim();
    if (!raw || !/^https?:\/\//i.test(raw)) return '';
    try {
        const url = new URL(raw);
        if (!/^https?:$/.test(url.protocol)) return '';
        return url.href;
    } catch (error) {
        return '';
    }
}

async function pingSite(site, options) {
    const opts = options || {};
    const target = siteTarget(site);
    const started = Date.now();
    if (!target) {
        return {
            ok: false,
            latency: 0,
            status: 0,
            probe: 'ping',
            message: '没有可 PING 的 http/https 地址'
        };
    }

    try {
        const response = await axios.get(target, {
            timeout: Math.max(1000, Number(opts.timeout) || DEFAULT_TIMEOUT),
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
                'Range': 'bytes=0-0'
            },
            responseType: 'stream',
            validateStatus: () => true,
            maxRedirects: 3,
            decompress: false
        });
        const latency = Date.now() - started;
        if (response.data && response.data.destroy) response.data.destroy();
        const status = Number(response.status) || 0;
        const ok = status > 0 && status < 500;
        return {
            ok,
            latency: ok ? latency : 0,
            status,
            probe: 'ping',
            message: ok ? '' : 'HTTP ' + status
        };
    } catch (error) {
        return {
            ok: false,
            latency: Date.now() - started,
            status: 0,
            probe: 'ping',
            message: error.code === 'ECONNABORTED' ? 'PING 超时' : (error.message || 'PING 失败')
        };
    }
}

module.exports = { pingSite, siteTarget };