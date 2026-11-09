'use strict';

function createHealthMonitor(options) {
    const config = Object.assign({
        check: null,
        now: () => Date.now(),
        failureThreshold: 3,
        cooldownBase: 5 * 60 * 1000,
        cooldownMax: 30 * 60 * 1000,
        concurrency: 4
    }, options || {});
    const state = new Map();
    let running = false;
    let lastRun = 0;

    function now() { return Number(config.now()) || Date.now(); }

    function ensure(key) {
        if (!state.has(key)) {
            state.set(key, {
                key,
                ok: null,
                latency: 0,
                lastCheck: 0,
                lastSuccess: 0,
                lastError: '',
                successCount: 0,
                failCount: 0,
                consecutiveFails: 0,
                cooldownUntil: 0
            });
        }
        return state.get(key);
    }

    function snapshot(key) {
        const item = ensure(key);
        const t = now();
        return {
            key: item.key,
            ok: item.ok,
            latency: item.latency,
            lastCheck: item.lastCheck,
            lastSuccess: item.lastSuccess,
            lastError: item.lastError,
            successCount: item.successCount,
            failCount: item.failCount,
            consecutiveFails: item.consecutiveFails,
            cooling: item.cooldownUntil > t,
            cooldownUntil: item.cooldownUntil,
            cooldownSeconds: item.cooldownUntil > t ? Math.ceil((item.cooldownUntil - t) / 1000) : 0
        };
    }

    function recordSuccess(key, latency) {
        const item = ensure(key);
        item.ok = true;
        item.latency = Math.max(0, Number(latency) || 0);
        item.lastCheck = now();
        item.lastSuccess = item.lastCheck;
        item.lastError = '';
        item.successCount++;
        item.consecutiveFails = 0;
        item.cooldownUntil = 0;
        return snapshot(key);
    }

    function recordFailure(key, error) {
        const item = ensure(key);
        const t = now();
        item.ok = false;
        item.lastCheck = t;
        item.lastError = String(error || '连接失败').slice(0, 200);
        item.failCount++;
        item.consecutiveFails++;
        if (item.consecutiveFails >= config.failureThreshold) {
            const steps = item.consecutiveFails - config.failureThreshold + 1;
            const wait = Math.min(config.cooldownMax, config.cooldownBase * Math.max(1, steps));
            item.cooldownUntil = t + wait;
        }
        return snapshot(key);
    }

    function isCooling(key) {
        const item = state.get(key);
        return Boolean(item && item.cooldownUntil > now());
    }

    function status(sites) {
        return (Array.isArray(sites) ? sites : []).map(site => Object.assign({
            key: site.key,
            name: site.name,
            active: site.active !== false
        }, snapshot(site.key)));
    }

    async function mapLimit(items, limit, fn) {
        let index = 0;
        const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
            while (index < items.length) {
                const current = index++;
                await fn(items[current], current);
            }
        });
        await Promise.all(workers);
    }

    async function checkSites(sites, checkOptions) {
        if (typeof config.check !== 'function') throw new Error('健康检查函数未配置');
        const opts = checkOptions || {};
        const list = (Array.isArray(sites) ? sites : []).filter(site => site && (site.api || site.adapter) && site.active !== false);
        const targets = opts.force ? list : list.filter(site => !isCooling(site.key));
        running = true;
        try {
            await mapLimit(targets, config.concurrency, async site => {
                const started = now();
                try {
                    const result = await config.check(site);
                    if (result && result.ok) recordSuccess(site.key, result.latency || (now() - started));
                    else recordFailure(site.key, result && result.message);
                } catch (error) {
                    recordFailure(site.key, error && error.message);
                }
            });
            lastRun = now();
        } finally {
            running = false;
        }
        return status(list);
    }

    return {
        recordSuccess,
        recordFailure,
        isCooling,
        snapshot,
        status,
        checkSites,
        get running() { return running; },
        get lastRun() { return lastRun; }
    };
}

module.exports = { createHealthMonitor };
