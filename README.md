<p align="center">
  <img src="docs/assets/readme-banner.png" alt="冬瓜TV" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Minerchu/dongguaTV/stargazers"><img src="https://img.shields.io/github/stars/Minerchu/dongguaTV?style=flat-square&logo=github&label=Stars" alt="Stars"></a>
  <a href="https://github.com/Minerchu/dongguaTV/forks"><img src="https://img.shields.io/github/forks/Minerchu/dongguaTV?style=flat-square&logo=github&label=Forks" alt="Forks"></a>
  <a href="https://github.com/Minerchu/dongguaTV/commits/main"><img src="https://img.shields.io/github/last-commit/Minerchu/dongguaTV?style=flat-square&label=Last%20Commit" alt="Last commit"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Minerchu/dongguaTV?style=flat-square&label=License" alt="License"></a>
</p>

影视聚合站点。后端 Node.js + Express，前端 Vue 3 + Bootstrap，附带 Kotlin + Jetpack Compose 的 Android 客户端。

- 搜索结果按片名和年份聚合，同一个影片只出现一张卡片，点进去再选站点。
- 播放统一走服务端代理，自动补 Referer/UA、重写 HLS 分片；线路失败时只提示手动切换，不再自动切源。
- 采集站每 10 分钟做一次 HTTP PING 巡检，连续失败先冷却，恢复后自动重新参与搜索；不解析接口内容，也不判断是否返回 m3u8。
- 浏览记录、收藏和继续观看保存在浏览器本地，不需要账号。
- 后台支持备份/恢复，每天自动备份，保留最近 7 份。
- 支持服务端自定义源适配器，非 Maccms 的 JSON/HTML 站点也能接入后台，并参与搜索、详情、PING 巡检和播放代理。
- Android 客户端支持扫码绑定服务器、检查更新，以及调用系统播放器或投屏应用。
- 公开状态页 `/status`，不暴露采集站地址。

- [部署与使用教程](https://minerchu.github.io/dongguaTV/)
- 后台地址：`http://服务器IP:3000/admin.html`

## 界面

| 首页 | 详情 |
| --- | --- |
| ![首页](docs/assets/screenshots/home-tmdb.jpg?v=20261109) | ![详情](docs/assets/screenshots/tmdb-detail.jpg?v=20261109) |

电脑和电视使用横版剧照，手机自动切换无字竖版海报。详情页由大背景、海报缩略图和 TMDb 透明 Logo 组成。

## 部署

需要 Docker 20.10+ 和 Docker Compose v2。

```bash
git clone https://github.com/Minerchu/dongguaTV.git
cd dongguaTV
cp .env.example .env
docker compose up -d --build
```

编辑 `.env`，至少设置 `ADMIN_PASSWORD`。启动后访问 `http://服务器IP:3000`，登录后台的「系统设置」填写 TMDb 凭据；短 Key 和长 Token 任选一个，整段粘贴也能自动识别。

默认会同时启动 PanSou，地址为 `http://pansou:8888`，不需要在公网开放 8888。

正式使用建议选一台能稳定访问 TMDb 的海外服务器；域名和 HTTPS 配置见[教程](https://minerchu.github.io/dongguaTV/#reverse-proxy)。

不想用 Compose 时，可以构建单容器版本：

```bash
docker build -f Dockerfile.allinone -t dongguatv:allinone .

docker run -d --name dongguatv \
  -p 3000:3000 \
  -v dongguatv-data:/app/data \
  -e ADMIN_PASSWORD=你的密码 \
  dongguatv:allinone
```

All-in-One 不包含 APK 编译组件。需要后台生成 Android 客户端时，请使用 `docker compose` 或标准 `Dockerfile`。

## Android 客户端

1. 在后台添加至少一个可用的 Maccms 接口。
2. 打开「Android 客户端」，填写应用名称和手机能访问的服务器地址。
3. 可选上传 512×512 PNG 图标，修改版本号和版本名称。
4. 保存后等待生成完成，在后台或首页下载 APK。
5. 客户端首次打开可点「扫码连接服务器」，扫描后台 Android 页面的二维码，不用手输地址。

![后台生成 Android 客户端](docs/assets/screenshots/admin-android.jpg?v=20261109c)

标准 Docker 镜像已经包含 Android SDK、Gradle、apktool 和签名工具。第一次构建镜像会下载依赖，耗时较长；后续修改客户端配置只会重新打包 APK，通常几十秒完成。

签名保存在 `data/android-client/`。升级服务时请保留整个 `data/`，否则手机可能无法覆盖安装。

客户端设置页可以检查站点是否生成了新版本；发现新版本会直接打开下载地址。播放页右上角可以把当前集交给系统里的其他播放器或投屏应用。

## 采集站

仓库不带采集站地址。新安装的站点列表为空，请在后台自行添加。

常见接口地址：

```text
https://example.com/api.php/provide/vod
https://example.com/inc/apijson.php
```

在浏览器里给地址加上 `?ac=list&pg=1`，返回包含 `list` 的 JSON 才可用。

可以搜索：

- `"api.php/provide/vod"`
- `inurl:"api.php/provide/vod"`
- `"inc/apijson.php"`
- `maccms 采集接口`

后台的「导入采集源」支持两种方式，解析后会先查重，再让你勾选导入：

- **TVBox 配置**：每行粘贴一个配置地址。支持明文 JSON、Base64、图片尾部隐写、TVBox 2423/2324 加密，以及配置里的 `urls` 仓库。
- **苹果CMS 接口**：每行一个接口，可以只填地址，也可以写成「名称,地址」。

```text
资源站A,https://example.com/api.php/provide/vod
资源站B,https://example.org/inc/apijson.php
```

预览表里会直接标出「新接口」和「已存在」，已存在的不能重复导入。TVBox 里的 `csp_` 内置源、Jar 源需要播放器自己运行，网页后台用不了，会自动跳过并显示原因。

站点配置保存在 `data/db.json`，不会提交到 Git。

## 自定义适配器

内置采集只支持 Maccms JSON。遇到自建 JSON、非标准 JSON 或需要自己拼接请求头的站点，可以写一个服务端适配器。

1. 把 `.js` 文件放进 `data/adapters/`。
2. 打开后台「采集站管理」→「重载适配器」。
3. 添加采集站时切到「自定义适配器」，选择适配器、填写基础地址和 JSON 配置。

仓库里有一个通用示例：

```bash
mkdir -p data/adapters
cp examples/adapters/generic-json.js data/adapters/
```

然后点「重载适配器」。示例支持配置：

```json
{
  "searchPath": "/api/search",
  "queryParam": "q",
  "detailPath": "/api/detail/{id}",
  "testQuery": "测试"
}
```

适配器接口和完整示例见 [examples/adapters/README.md](examples/adapters/README.md)。适配器会在服务端执行，只安装你信任的代码。

## 配置与端口

| 变量 | 用途 |
| --- | --- |
| `ADMIN_PASSWORD` | 后台密码，公网部署前必须修改 |
| `TMDB_API_KEY` | 短的 TMDb API Key；也可以在后台「系统设置」填写 |
| `TMDB_READ_TOKEN` | 长的 TMDb Read Access Token；和 API Key 二选一 |
| `HOST_PORT` | Docker 对外端口，默认 `3000` |
| `PANSOU_URL` | 使用外部 PanSou 时填写；Compose 默认使用内置实例 |

后台「系统设置」里填写的 TMDb 凭据优先于环境变量，两种凭据只需填一个。完整配置见 [.env.example](.env.example)。改端口只需在 `.env` 写 `HOST_PORT=8080`，再执行 `docker compose up -d`；容器内部仍是 `3000`。

## 数据与更新

后台「备份与恢复」可以下载、创建和恢复备份；自动备份在 `data/backups/`，每天一次，保留 7 份。

```bash
git pull origin main
docker compose up -d --build
```

`data/db.json` 不会因重建容器丢失。API 与二次开发接口见[教程](https://minerchu.github.io/dongguaTV/#api)。

## 常见问题

搜索没结果先在后台 PING 测速；播放失败请手动切换线路。很多源本身不提供 m3u8，不是所有采集站都能直接播放。首页没有海报多半是 TMDb Key 或服务器网络问题。更多排查见[教程 FAQ](https://minerchu.github.io/dongguaTV/#faq)。

## 安全

- 公网部署前修改 `ADMIN_PASSWORD`。
- 建议配置 HTTPS。
- 不要提交 `db.json`、`.env` 或采集站地址。
- 定期备份数据。

## 免责声明

本项目只做接口聚合，不存储或发布影视内容。采集站和网盘资源均由第三方提供，请只接入你有权使用的接口，并遵守当地法律法规。

## License

MIT，详见 [LICENSE](LICENSE)。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Minerchu/dongguaTV&type=Date)](https://star-history.com/#Minerchu/dongguaTV&Date)
