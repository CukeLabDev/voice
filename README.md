# Koe Voice

一个可自行部署的网页语音大厅，适合 Minecraft 社区等小型社群。用户可进入常驻公共房间；站长可以授权其他用户创建房间。账号可使用本地密码、Mutsaki OAuth，或同时启用两种方式。前端使用 React，API 使用 Node.js + PostgreSQL，实时语音由 LiveKit 提供。

本项目采用 [GNU AGPL-3.0](LICENSE) 许可证。部署修改版并通过网络向用户提供服务时，请提供该版本的对应源代码；页面上的“源代码”链接可通过 `SOURCE_URL` 设置。

## 仅将前端部署到 Cloudflare Pages

已有独立后端时，可以把网页部署到 Pages。仓库根目录是 Pages 项目的根目录；构建命令为 `npm run build:pages`，输出目录为 `client/dist`，Node.js 版本使用 22。`build:pages` 会复制 AGPL 许可证，并只让 `/api/*` 请求进入 Pages Function。`/source` 会跳转到本仓库；如果发布的是 fork，请把 `client/public/_redirects` 改为实际提供对应源码的地址。

在 Pages 项目的 Production 环境设置 `API_ORIGIN` 为后端的 HTTPS 源站地址（例如 `https://api.example.com`，不能包含 `/api` 或末尾以外的路径）。Pages Function 会将同源的 `/api/*` 转发到该地址的同一路径；前端不需要设置 `VITE_API_BASE`。同源转发使 Mutsaki OAuth 回调 Cookie 可以留在网页域名下。后端须把 `CLIENT_ORIGIN` 设为网页的正式地址；启用 Mutsaki 时，回调应为 `https://网页域名/api/auth/mutsaki/callback`。LiveKit 地址仍由后端的房间令牌接口下发。

绑定正式域名后，先检查 `https://网页域名/api/health`，再检查本地账号登录、Mutsaki 回调（若启用）和两台设备的双向语音。预览域名通常不在后端允许的来源中，不适合做登录验收。

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

### 选择账号来源

在根目录 `.env` 中设置 `AUTH_PROVIDERS`，可选 `local`、`mutsaki` 或 `local,mutsaki`；默认只启用本地账号。修改后运行 `docker compose up -d`。关闭某一种登录方式不会删除该方式已有的账号，但其现有语音平台令牌会失效；重新启用后可以再次登录。新的认证提供方可按 `server/src/providers/` 中的接口加入注册表。

启用 Mutsaki 前，先到 [Mutsaki 开发者平台](https://mutsaki.com/development) 创建并获批 OAuth 应用。授权回调必须填写 `https://你的网页域名/api/auth/mutsaki/callback`（将域名换成 `APP_DOMAIN` 的实际值）。然后在 `.env` 中填写：

```dotenv
AUTH_PROVIDERS=local,mutsaki
MUTSAKI_CLIENT_ID=获批的客户端ID
MUTSAKI_CLIENT_SECRET=客户端密钥
```

客户端密钥只进入 API 容器，不能放到网页代码或 Git 仓库。Mutsaki 登录使用授权码与 S256 PKCE；语音平台用 Mutsaki 返回的稳定 `sub` 识别用户，昵称变化不会产生新账号。**本地账号与 Mutsaki 账号始终独立**，即使同名也不会自动合并。首次用 Mutsaki 登录的用户为普通成员。

如果只启用 `mutsaki`，无需创建本地 owner。先用 Mutsaki 登录一次，再在服务器执行下面两条命令，找出该账号的 `sub` 并授予 owner。`list-accounts` 输出包含账号标识，请勿公开分享。

```sh
docker compose exec api npm run list-accounts --workspace server
docker compose exec api npm run set-owner --workspace server -- mutsaki '上一步看到的sub'
```

本地 owner 也可通过 `set-owner --workspace server -- local 用户名` 指定。Mutsaki 授权令牌在读取资料后尝试撤销；语音平台会签发自己的登录令牌。退出语音平台不会退出 Mutsaki，反之亦然。

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

需要 Node.js 20+ 和 Docker。根目录的 `.env.example` 是本地开发模板，与生产的 `deploy/.env.example` 分开；本地默认只启用 `local`，Mutsaki 正式 OAuth 应用要求获批的 HTTPS 回调。PowerShell 使用 `Copy-Item .env.example .env`，bash 使用 `cp .env.example .env`。随后运行：

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
