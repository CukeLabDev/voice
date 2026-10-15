# Koe Voice

一个可自行部署的网页语音大厅，适合 Minecraft 社区等小型社群。用户可注册账号、进入常驻公共房间；站长可以授权其他用户创建房间。前端使用 React，API 使用 Node.js + PostgreSQL，实时语音由 LiveKit 提供。

本项目采用 [GNU AGPL-3.0](LICENSE) 许可证。部署修改版并通过网络向用户提供服务时，请提供该版本的对应源代码；页面上的“源代码”链接可通过 `SOURCE_URL` 设置。

## 用 Docker Compose 部署到服务器

需要一台有公网 IPv4 的 Linux 服务器、Docker Engine + Compose 插件、OpenSSL，以及两个指向这台服务器的 DNS A 记录（例如 `voice.example.com` 和 `rtc.example.com`）。服务器的 80/443 TCP、7881 TCP 和 50000–50100 UDP 端口需要开放。HTTPS 证书由 Caddy 自动申请；浏览器麦克风需要 HTTPS。

```sh
git clone https://github.com/CukeLabDev/voice.git
cd voice
sh deploy/setup.sh
docker compose up -d --build
docker compose exec api npm run create-owner --workspace server -- admin
```

运行 `setup.sh` 时输入网页域名和语音域名。它会生成不提交到 Git 的 `.env` 及随机数据库、JWT、LiveKit 密钥。也可手动复制 `deploy/.env.example` 为根目录 `.env`，逐项填入真实值。请在启动前确认两个 DNS 记录已经生效，服务器上的 80/443 没被其他服务占用。首次启动会自动建表并创建公共房间。

命令会提示输入 owner 密码，输入内容不会显示，也不会进入 shell 历史。访问 `https://你的网页域名`，用这个账号登录。之后用户可在网页自行注册。

### 运行和维护

```sh
docker compose ps
docker compose logs --tail=100 api livekit web
docker compose up -d --build
docker compose down
```

更新代码后再运行 `docker compose up -d --build`。数据库和 Caddy 证书保存在 Docker 卷中，普通 `docker compose down` 不会删除它们。备份 PostgreSQL 时可用 `docker compose exec -T db pg_dump -U koe -d koe > ../koe-backup.sql`，并妥善保存备份；恢复前先确认目标数据库与版本。不要运行 `docker compose down -v`，除非确实要删除全部用户与房间数据。

当前 Compose 方案面向**单台服务器**。LiveKit 需要直达服务器的公网 UDP；只有 HTTPS 反向代理而没有开放 UDP 时，语音可能连不上。公司或校园网络若屏蔽 UDP，可能需要额外配置 TURN。请检查 `https://你的网页域名/api/health` 是否返回 `{"ok":true}`，再用两台设备实际测试双向语音。

目前额外房间不会自动过期，数据库中的 `max_members` 也尚未作为语音连接上限执行。站长可删除额外房间；公共房间始终保留。

## 本地开发

需要 Node.js 20+ 和 Docker。根目录的 `.env.example` 是本地开发模板，与生产的 `deploy/.env.example` 分开。PowerShell 使用 `Copy-Item .env.example .env`，bash 使用 `cp .env.example .env`。随后运行：

```sh
npm install
docker compose -f deploy/docker-compose.yml up -d postgres livekit
npm run migrate --workspace server
npm run create-owner --workspace server -- admin
npm run dev
```

前端在 `http://localhost:5173`，API 在 `http://localhost:4000`。本地模板中的密码和 LiveKit dev key **仅用于本机开发**，不要复制到公网部署。

## 贡献

欢迎提交 issue 和 pull request。提交前请勿包含 `.env`、数据库备份、用户数据或其他密钥。代码提交应遵循 AGPL-3.0；界面与依赖的第三方许可证仍归各自项目所有。
