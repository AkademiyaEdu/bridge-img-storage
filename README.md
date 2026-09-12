# Discord Avatar Sync

独立的 Discord 头像同步进程。只监听事件、下载头像、写 SQLite 和指定目录。不提供 HTTP 服务，不连接 QQ，不发送消息。

## 开发

Nix flake 只提供开发环境，直接使用 nixpkgs 的 Node.js 26、pnpm、git 和 jq。

```bash
nix develop
pnpm install
cp .env.example .env
```

编辑 `.env`，填入 Bot Token 和需要监听的频道 ID：

```dotenv
DISCORD_BOT_TOKEN=你的BotToken
DISCORD_CHANNEL_ID=你的频道ID
DB_PATH=./data/avatar.db
AVATAR_DIR=./data/avatars
```

频道 ID 留空则监听 Bot 可见的所有服务器频道消息。路径可以使用绝对路径。

```bash
pnpm typecheck
pnpm test
pnpm dev
```

普通启动为 `pnpm start`；需要编译时使用 `pnpm build` 和 `pnpm serve`。首次安装生成的 `pnpm-lock.yaml` 应提交到 Git，后续可使用 `pnpm install --frozen-lockfile`。

## 同步逻辑

- 使用相同 Bot Token 建立独立 Discord Gateway 连接，只监听，不转发。
- 新消息检查作者头像；`UserUpdate` 作为补充，不能保证所有用户换头像时都会收到。
- SQLite 只有 `avatar(id TEXT PRIMARY KEY, url TEXT NOT NULL)`。
- 相同头像 hash 且文件存在则跳过，否则下载并覆盖 `AVATAR_DIR/{userid}.webp`，成功后更新数据库。
- 输出 48×48 静态 WebP，不保留动态头像动画；只处理用户全局头像。
- 同一用户的并发更新合并，下载失败保留旧文件。首次出现的用户可能暂时没有文件。

## 静态文件

本进程不监听任何 HTTP 端口。由你现有的 Nginx、Caddy 或 CDN 直接读取 `AVATAR_DIR`。公开 URL 由主桥配置，当前进程不需要知道域名。

Nginx 路径示例：

```nginx
location /avatars/ {
    alias /var/lib/discord-avatar-server/avatars/;
    add_header Cache-Control "public, max-age=60, must-revalidate";
}
```

Nginx 必须拥有目录的读取和遍历权限。SQLite 不需要开放给 Web 服务器。NixOS 上可由 systemd 管理进程，数据目录独立持久化，flake 不负责服务部署。

主桥只需引用 `https://你的图片域名/avatars/{userid}.webp`。固定文件名会覆盖，因此 CDN 不要设置 immutable 或长期强制缓存。QQ 图片代理可能另行缓存，无法保证历史消息立即刷新。

备份 SQLite 和头像目录即可。不要提交 `.env` 或把 Token 写进 Nix store。
