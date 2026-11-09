'use strict';

// 通用 JSON 片源适配器示例。
// 复制到 data/adapters/generic-json.js，重载适配器后即可在后台选择。
module.exports = {
    id: 'generic-json',
    name: '通用 JSON 片源',
    version: '1.0.0',
    description: '适配自建 JSON 接口：搜索返回 list/results，详情返回 episodes 或 playUrl。',
    configExample: {
        searchPath: '/api/search',
        queryParam: 'q',
        detailPath: '/api/detail/{id}',
        testQuery: '测试'
    },
    async search(ctx) {
        const config = ctx.config || {};
        const path = config.searchPath || '/api/search';
        const queryParam = config.queryParam || 'q';
        const data = await ctx.http.getJson(path, { [queryParam]: ctx.query });
        const list = Array.isArray(data) ? data : (data.list || data.results || data.data || []);
        return list.map(item => ({
            id: item.id || item.vod_id,
            title: item.title || item.name || item.vod_name,
            poster: item.poster || item.pic || item.cover,
            year: item.year || '',
            remarks: item.remarks || item.note || '',
            type: item.type || item.category || ''
        }));
    },
    async detail(ctx) {
        const config = ctx.config || {};
        const template = config.detailPath || '/api/detail/{id}';
        const path = template.replace('{id}', encodeURIComponent(ctx.id));
        const data = await ctx.http.getJson(path);
        const item = data.data || data;
        const episodes = Array.isArray(item.episodes) ? item.episodes : [];
        if (!episodes.length && item.playUrl) episodes.push({ name: '正片', url: item.playUrl });
        return {
            id: item.id || ctx.id,
            name: item.title || item.name || '未命名影片',
            pic: item.poster || item.pic || '',
            year: item.year || '',
            area: item.area || '',
            remarks: item.remarks || '',
            content: item.content || item.overview || '',
            episodes
        };
    }
};
