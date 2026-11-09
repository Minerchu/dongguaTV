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
- 播放统一走服务端代理，自动补 Referer/UA、重写 HLS 分片；当前线路失败会自动切换下一条，最多 3 次。
- 采集站每 10 分钟自动巡检，连续失败先冷却，恢复后自动重新参与搜索。
- 浏览记录、收藏和继续观看保存在浏览器本地，不需要账号。
- 后台支持备份/恢复，每天自动备份，保留最近 7 份。
- 自带可选 Caddy HTTPS 配置；另有公开状态页 `/status`，不暴露采集站地址。

- 教程：https://minerchu.github.io/dongguaTV/
- 后台：`http://服务器IP:3000/admin.html`

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

编辑 `.env`，至少设置 `ADMIN_PASSWORD` 和 `TMDB_API_KEY`。启动后访问 `http://服务器IP:3000`。

默认会同时启动 PanSou，地址为 `http://pansou:8888`，不需要在公网开放 8888。

不想用 Compose 时，可以构建单容器版本：

```bash
docker build -f Dockerfile.allinone -t dongguatv:allinone .

docker run -d --name dongguatv \
  -p 3000:3000 \
  -v dongguatv-data:/app/data \
  -e ADMIN_PASSWORD=你的密码 \
  -e TMDB_API_KEY=你的密钥 \
  dongguatv:allinone
```

All-in-One 不包含 APK 编译组件。需要后台生成 Android 客户端时，请使用 `docker compose` 或标准 `Dockerfile`。

## Android 客户端

1. 在后台添加至少一个可用的 Maccms 接口。
2. 打开「Android 客户端」，填写应用名称和手机能访问的服务器地址。
3. 可选上传 512×512 PNG 图标，修改版本号和版本名称。
4. 保存后等待生成完成，在后台或首页下载 APK。

标准 Docker 镜像已经包含 Android SDK、Gradle、apktool 和签名工具。第一次构建镜像会下载依赖，耗时较长；后续修改客户端配置只会重新打包 APK，通常几十秒完成。

签名保存在 `data/android-client/`。升级服务时请保留整个 `data/`，否则手机可能无法覆盖安装。

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

## 配置

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | 容器内端口 |
| `HOST_PORT` | `3000` | Docker 对外端口 |
| `DOMAIN` | 空 | 启用自带 Caddy HTTPS 时填写域名 |
| `DB_PATH` | `./db.json` | 配置文件；镜像内默认 `/app/data/db.json` |
| `ADMIN_PASSWORD` | `admin` | 后台密码 |
| `TMDB_API_KEY` | 空 | TMDb API Key |
| `TMDB_API_BASE` | `https://api.themoviedb.org/3` | TMDb API 地址 |
| `TMDB_IMAGE_BASE` | `https://image.tmdb.org/t/p` | TMDb 图片地址 |
| `TMDB_TIMEOUT` | `15000` | TMDb 超时，毫秒 |
| `TMDB_LANGUAGE` | `zh-CN` | TMDb 语言 |
| `PANSOU_URL` | 空 | PanSou 地址 |
| `PANSOU_TOKEN` | 空 | PanSou Token |
| `PANSOU_USER` / `PANSOU_PASS` | 空 | PanSou 账号密码 |
| `SEARCH_TIMEOUT` | `6000` | 单站搜索超时，毫秒 |
| `TEST_TIMEOUT` | `5000` | 添加站点时的测试超时，毫秒 |
| `PANSOU_TIMEOUT` | `15000` | 网盘搜索超时，毫秒 |
| `HEALTH_CHECK` | `1` | 采集站自动巡检开关，`0` 关闭 |
| `BACKUP_DIR` | `data/backups` | 自动备份目录 |

后台填写的 PanSou 配置优先于环境变量。

## 端口

只改对外端口时，编辑 `.env`：

```env
HOST_PORT=8080
```

然后执行：

```bash
docker compose up -d
```

容器内部仍使用 3000。

## 自带 HTTPS

项目里已经放好 Caddy 配置，不需要自己写 Nginx 反代。先把域名解析到服务器，然后在 `.env` 填写：

```env
DOMAIN=tv.example.com
```

启动：

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

Caddy 会自动申请和续期证书，并把请求转发到 `dongguatv:3000`。服务器的 80、443 端口要保持可用；如果 80 端口已经被别的服务占用，先停掉那个服务。

只用 IP + 端口访问时，继续用默认的 `docker compose up -d` 即可，不需要设置 `DOMAIN`。

TMDb 已经走本站 `/tmdb` 代理，不需要额外搭建反代。前端不会拿到 API Key。服务器无法访问 TMDb 时，可以设置 `HTTPS_PROXY`，或修改 `TMDB_API_BASE` 和 `TMDB_IMAGE_BASE`。

## 数据

后台「备份与恢复」可以直接下载、创建和恢复备份。也可以命令行复制：

```bash
docker cp dongguatv:/app/data/db.json ./db.json.bak
```

自动备份保存在宿主机 `data/backups/`，每天一次，保留最近 7 份。恢复前会先把当前数据库再备份一份。

更新：

```bash
git pull origin main
docker compose up -d --build
```

`data/db.json` 不会因重建容器丢失。旧版本如果配置在 `/app/db.json`，先迁移到宿主机的 `data/db.json`。

## API

公共接口：

```text
GET  /api/config
GET  /api/sites
GET  /api/check?key=站点key
GET  /api/hot
GET  /api/search?wd=关键词
GET  /api/detail?site_key=&id=
GET  /api/play/proxy?url=&site=
GET  /api/status
GET  /api/cloud/search?wd=关键词
GET  /api/app/download
GET  /api/app/icon
GET  /tmdb/3/*
GET  /tmdb/t/p/*
```

管理接口需要 `dg_admin` Cookie 或 `X-Admin-Token`：

```text
POST   /api/admin/login
POST   /api/admin/logout
GET    /api/admin/me
GET    /api/admin/sites
POST   /api/admin/sites
PUT    /api/admin/sites/:key
DELETE /api/admin/sites/:key
POST   /api/admin/sites/test
POST   /api/admin/sites/import
POST   /api/admin/import/preview
POST   /api/admin/import/sites
POST   /api/admin/health/check
GET    /api/admin/health
GET    /api/admin/backup
GET    /api/admin/backups
POST   /api/admin/backups
GET    /api/admin/backups/:name
POST   /api/admin/backups/:name/restore
POST   /api/admin/restore
PUT    /api/admin/settings
POST   /api/admin/pansou/test
GET    /api/admin/client
PUT    /api/admin/client
POST   /api/admin/client/build
POST   /api/admin/client/icon
DELETE /api/admin/client/icon
```

登录失败在 10 分钟内超过 8 次会返回 `429`。

## 常见问题

**搜索没有结果**

先在后台测试采集站。接口需要返回 JSON，网页、XML 和 404 都不能用。

**某条线路播放失败**

页面会自动尝试同一影片的下一条线路。如果全部失败，通常是源站改了播放地址或加了验证，换一个搜索结果即可。

**后台显示某个站冷却中**

这是连续失败后的临时保护，不是永久禁用。冷却结束后会自动重新参与搜索，也可以在后台点「自动巡检」立即重试。

**TMDb 首页是空的**

检查 `TMDB_API_KEY`。服务器访问不了 TMDb 时，配置代理或换 `TMDB_API_BASE` / `TMDB_IMAGE_BASE`。

**网盘搜索不可用**

检查 PanSou 是否运行，以及服务器能否访问 Telegram。Compose 默认地址是 `http://pansou:8888`。

**忘记后台密码**

修改 `.env` 里的 `ADMIN_PASSWORD`，然后重启容器。

**APK 编译失败**

执行 `docker compose logs -f dongguatv` 查看原因。服务器地址必须是手机能访问的地址，不能填 `127.0.0.1` 或容器名。

**3000 端口被占用**

设置 `HOST_PORT=其他端口`，再执行 `docker compose up -d`。

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
