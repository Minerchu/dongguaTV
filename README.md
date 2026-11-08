# 冬瓜TV (dongguaTV)

🎬 打造你的私人 Netflix！TMDb 智能刮削 + 全网聚合 + 极速播放

## 🌟 项目简介

冬瓜TV是一个基于Node.js的视频聚合平台，集成了30+个影视资源站点的API，提供智能搜索、资源聚合、实时测速等功能，让你轻松构建个人影视库。

## ✨ 核心功能

- 🔍 **智能搜索** - 聚合30+影视站点，一键搜索全网资源
- ⚡ **实时测速** - 自动检测各站点响应速度，优先推荐最快资源
- 🎯 **多源聚合** - 支持非凡影视、暴风资源、电影天堂等30+主流站点
- 🔥 **热门推荐** - 自动获取24小时热门影视内容
- 🎨 **简洁界面** - 响应式设计，支持PC/移动端完美适配
- 🔐 **后台管理** - 支持站点开关配置，自定义资源源
- 📊 **数据持久化** - JSON数据库存储，支持自定义配置
- 🛠️ **后台可视化配置** - 不用改文件，浏览器里就能添加/测试/删除采集站，内置图文教程
- ☁️ **网盘资源搜索** - 接入 PanSou 后，搜索影视时同步返回夸克、百度、阿里、UC 等网盘资源

## 🚀 快速开始

### 环境要求
- Node.js ≥ 16.0
- npm ≥ 6.0

### 安装部署
```bash
# 克隆项目
git clone https://github.com/your-username/dongguaTV.git
cd dongguaTV

# 安装依赖
npm install

# 复制配置模板，按需填写
cp .env.example .env
# 至少填 TMDB_API_KEY（前端还需要把 public/index.html 里的 TMDB_API_KEY 改成同一个 Key）

# 启动服务
npm start
# 或
node server.js
```

### Docker 方式
```bash
# 克隆项目
git clone https://github.com/your-username/dongguaTV.git
cd dongguaTV
# 编译和启动
docker compose up -d --build
```
### 访问应用
- 前端页面: http://localhost:3000
- 后台管理: http://localhost:3000/admin.html
- 管理员密码: `admin`（生产环境请用 `ADMIN_PASSWORD` 环境变量修改）

### 后台怎么用
1. 打开 `/admin.html`，输入管理员密码登录
2. 在「采集站管理」里填站点名称 + Maccms JSON 接口地址，点「测试并添加」
3. 不知道去哪找接口？点「使用教程」，里面写了谷歌搜索关键词、接口格式和验证方法
4. 想开网盘搜索？在「网盘搜索」页填 PanSou 地址并保存

## 📡 API接口

### 公共接口
```
GET  /api/config                     # 前台配置（是否开启网盘搜索、启用站点数）
GET  /api/search?wd=关键词            # 聚合搜索（影视）
GET  /api/cloud/search?wd=关键词      # 网盘搜索（需配置 PanSou）
GET  /api/detail?site_key=站点key&id=影片ID
GET  /api/hot                        # 热门推荐
GET  /api/check?key=站点key           # 站点测速
```

### 管理接口（需登录，使用 Cookie 或 X-Admin-Token）
```
POST   /api/admin/login              # 登录，返回 token 并写入 HttpOnly Cookie
POST   /api/admin/logout
GET    /api/admin/sites              # 站点列表 + 网盘设置
POST   /api/admin/sites              # 新增站点（test=true 时先测连通性）
PUT    /api/admin/sites/:key         # 修改站点 / 启用状态 / 标识
DELETE /api/admin/sites/:key         # 删除站点
POST   /api/admin/sites/test         # 测试任意 Maccms 接口
POST   /api/admin/sites/import       # 批量导入
POST   /api/admin/sites/reset-defaults
PUT    /api/admin/settings           # 保存 PanSou 地址 / Token / 开关
POST   /api/admin/pansou/test        # 测试 PanSou 连通性
```

## 🎛️ 内置站点

平台集成了以下30+个影视资源站点：

| 站点名称 | 状态 | 特点 |
|---------|------|------|
| 非凡影视 | ✅ | 资源丰富，更新快速 |
| 暴风资源 | ✅ | 高清资源多 |
| 电影天堂 | ✅ | 经典老牌站点 |
| 天涯资源 | ✅ | 稳定可靠 |
| 360资源 | ✅ | 接口稳定 |
| 量子资源 | ✅ | 蓝光高清 |
| 豆瓣资源 | ✅ | 评分准确 |
| 爱奇艺 | ✅ | 正版资源 |
| ... | ... | ... |

## 🔧 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `ADMIN_PASSWORD` | `admin` | 后台管理员密码，**生产环境务必修改** |
| `TMDB_API_KEY` | 无 | TMDb API Key（Docker 启动时会注入到 index.html） |
| `PANSOU_URL` | 无 | PanSou 服务地址，例如 `http://127.0.0.1:8888` |
| `PANSOU_TOKEN` | 无 | PanSou 开启认证时的访问 Token |
| `PANSOU_USER` / `PANSOU_PASS` | 无 | 也可用账号密码自动换取 Token |
| `SEARCH_TIMEOUT` | `6000` | 单站搜索超时（毫秒） |
| `TEST_TIMEOUT` | `5000` | 接口测试超时（毫秒） |
| `PANSOU_TIMEOUT` | `15000` | 网盘搜索超时（毫秒） |

后台里保存的 PanSou 地址/Token 会写入 `db.json`，`PANSOU_URL` 环境变量优先级更高。

### 站点配置
站点配置保存在 `db.json`，正常情况下**不需要手动改文件**，请在后台增删改。
如需迁移或备份，可直接复制 `db.json`。

```json
{
  "sites": [
    {
      "key": "ffzy",
      "name": "非凡影视",
      "api": "https://api.ffzyapi.com/api.php/provide/vod",
      "active": true
    }
  ],
  "settings": {
    "pansouUrl": "",
    "pansouToken": "",
    "pansouEnabled": true
  }
}
```

## ☁️ 网盘搜索（PanSou）

本项目本身不提供网盘资源，只做接口聚合。先部署 [fish2018/pansou](https://github.com/fish2018/pansou)：

```bash
docker run -d --name pansou -p 8888:8888 ghcr.io/fish2018/pansou:latest
```

然后二选一：

- 后台 →「网盘搜索」→ 填 `http://服务器IP:8888` → 测试连接 → 保存配置
- 或设置环境变量 `PANSOU_URL=http://服务器IP:8888`

用户搜索时会多出「网盘资源」标签页，展示网盘类型、标题、提取码和分享链接。
如果 PanSou 开启了认证（`AUTH_ENABLED=true`），请在后台填 Token，或配置 `PANSOU_USER` / `PANSOU_PASS`。

## 🛠️ 技术栈

- **后端**: Node.js + Express.js
- **前端**: HTML5 + CSS3 + JavaScript
- **数据存储**: JSON文件数据库
- **HTTP请求**: Axios
- **跨域处理**: CORS
- **缓存**: Node-cache

## 📱 界面预览

### 主界面
- 搜索框：支持关键词搜索
- 热门推荐：展示24小时热门内容
- 搜索结果：显示多源聚合结果
- 详情页面：展示影片详细信息和播放链接

### 管理后台
- 采集站管理：添加 / 测速 / 启用 / 删除 / 批量导入 / 导出
- 使用教程：怎么搜采集站、怎么判断 Maccms 接口、常见问题
- 网盘搜索：PanSou 地址与 Token 配置、连通性测试

## 🔒 安全说明

- 必须修改默认管理员密码（`ADMIN_PASSWORD`）
- 管理接口已加登录校验，未登录无法读取或修改站点配置
- 生产环境建议使用Nginx反向代理
- 定期更新依赖包以确保安全性

## 📝 免责声明

本项目仅供学习研究使用，请勿用于商业用途。使用本项目产生的任何法律问题由使用者自行承担。请支持正版影视内容。

## 🤝 贡献指南

欢迎提交Issue和Pull Request来完善项目！

### 开发计划
- [ ] 添加更多影视资源站点
- [ ] 支持用户收藏和历史记录
- [ ] 添加播放历史同步功能
- [ ] 支持多用户系统
- [ ] 添加影视推荐算法

## 📄 开源协议

MIT License - 详见 [LICENSE](LICENSE) 文件

## ⭐ 支持项目

如果这个项目对你有帮助，请给个Star支持一下！

---

**🎬 冬瓜TV - 让每个人都能拥有专属的影视库！**