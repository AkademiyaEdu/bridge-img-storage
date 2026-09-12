# Bridge Image Storage

QQ/Discord 桥的独立图片存储进程。目前负责两件事：监听 Discord 用户头像并落盘，以及接收主桥发来的 Discord attachment URL、下载图片并永久保存。

## Nix package

Flake 同时提供生产 package 和开发环境。公开仓库可以直接构建或运行：

```bash
nix build github:AkademiyaEdu/bridge-img-storage
./result/bin/bridge-img-storage
```

也可以直接：

```bash
nix run github:AkademiyaEdu/bridge-img-storage
```

Package 使用 Node.js 26 和 pnpm 10 构建 TypeScript，产物中只保留运行时依赖，并提供 `bin/bridge-img-storage` 启动入口。程序数据仍应放在 Nix store 之外，例如 `/var/lib/bridge-img-storage`。

如果要从另一个 flake 引用：

```nix
inputs.bridge-img-storage = {
  url = "github:AkademiyaEdu/bridge-img-storage";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

对应 package 为：

```nix
inputs.bridge-img-storage.packages.${pkgs.system}.default
```

## 开发

开发环境直接使用 nixpkgs 的 Node.js 26、pnpm 10、git 和 jq。

```bash
nix develop
pnpm install
cp .env.example .env
```

配置示例：

```dotenv
DISCORD_BOT_TOKEN=你的BotToken
DISCORD_CHANNEL_ID=需要监听头像的频道ID
DB_PATH=./data/img.db
AVATAR_DIR=./data/avatars
ATTACHMENT_DIR=./data/attachments
PUBLIC_BASE_URL=https://discord.nahida.im
STORAGE_API_TOKEN=与主桥共享的随机Token
HTTP_HOST=127.0.0.1
HTTP_PORT=8787
```

`DISCORD_CHANNEL_ID` 留空时会监听 Bot 可见的所有服务器频道消息。`PUBLIC_BASE_URL` 是静态图片对 QQ 可见的公网域名。SQLite 默认使用 `./data/img.db`。

```bash
pnpm typecheck
pnpm test
pnpm dev
```

## Discord attachment API

主桥通过以下接口要求本进程保存一组图片：

```http
POST /api/discord/attachments
Authorization: Bearer <STORAGE_API_TOKEN>
Content-Type: application/json

[
  {
    "id": "1548211192839929936",
    "url": "https://cdn.discordapp.com/attachments/..."
  },
  {
    "id": "1548211193062940723",
    "url": "https://cdn.discordapp.com/attachments/..."
  }
]
```

本进程会并发下载数组中的图片，并按请求顺序返回永久 URL：

```json
[
  "https://discord.nahida.im/attachments/1548211192839929936.png",
  "https://discord.nahida.im/attachments/1548211193062940723.png"
]
```

只接受 `https://cdn.discordapp.com/attachments/...`，并校验 URL 中的 attachment ID 与请求 ID 一致。文件已存在时直接返回，不重复下载。同一个 attachment ID 的并发请求会合并。

`GET /healthz` 不需要鉴权。写接口使用 Bearer Token；公网测试时应由 Nginx/Caddy 提供 HTTPS，Node 继续监听 `127.0.0.1`。

## 静态文件

本进程只提供控制 API，不直接提供图片文件。由 Nginx、Caddy 或 CDN 读取数据目录：

```nginx
location /avatars/ {
    alias /var/lib/bridge-img-storage/avatars/;
    add_header Cache-Control "public, max-age=60, must-revalidate";
}

location /attachments/ {
    alias /var/lib/bridge-img-storage/attachments/;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

头像文件名是 `{userid}.webp`，会被覆盖，因此不能长期 immutable。Discord attachment ID 对应内容不变，可以长期缓存。
