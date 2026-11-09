# 自定义源适配器

适配器用于接入非 Maccms 的片源。它是运行在服务端的 CommonJS 模块，不是前端插件。

1. 把 `.js` 文件复制到 `data/adapters/`。
2. 在后台「采集站管理」点「重载适配器」。
3. 添加采集站时选择「自定义适配器」，填写基础地址和 JSON 配置。

最小接口：

```js
module.exports = {
  id: 'my-source',
  name: '我的片源',
  async search(ctx) {
    // ctx.query 是搜索词，ctx.http 已经带好 baseUrl 和超时
    return [{ id: '1', title: '示例影片' }];
  },
  async detail(ctx) {
    // ctx.id 是搜索结果里的 id
    return { id: ctx.id, name: '示例影片', episodes: [{ name: '正片', url: 'https://cdn.example/1.m3u8' }] };
  }
};
```

`search` 返回数组或 `{ list: [] }`；`detail` 返回上面的对象、`{ list: [] }`，或 Maccms 风格的详情对象。适配器在服务端执行，只应从可信来源安装。

`generic-json.js` 是一个可配置示例，适合自建 JSON 接口。它支持：

```json
{
  "searchPath": "/api/search",
  "queryParam": "q",
  "detailPath": "/api/detail/{id}",
  "testQuery": "测试"
}
```
