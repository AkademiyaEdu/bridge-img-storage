# Bridge Image Storage

QQ/Discord 桥的独立图片存储进程。目前负责监听 Discord 用户头像，以及保存 Discord / QQ 两侧需要长期公网访问的图片。

Discord attachment 和 QQ 图片共用 `ATTACHMENT_DIR`。下载完成后按内容计算 SHA-256，并保存为 `{sha256}.{ext}`，因此两侧字节完全相同的图片只会存一份。

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

`DISCORD_CHANNEL_ID` 留空时会监听 Bot 可见的所有服务器频道消息。`PUBLIC_BASE_URL` 是静态图片的公网域名。SQLite 默认使用 `./data/img.db`。如果使用 rclone mount / VFS，把 `ATTACHMENT_DIR` 指向挂载目录即可；SQLite 和头像目录仍建议保留在本地磁盘。

```bash
pnpm typecheck
pnpm test
pnpm dev
```

## Discord attachment API

主桥通过以下接口要求本进程保存一组 Discord 图片：

```http
POST /api/discord/attachments
Authorization: Bearer <STORAGE_API_TOKEN>
Content-Type: application/json

[
  {
    "id": "1548211192839929936",
    "url": "https://cdn.discordapp.com/attachments/..."
  }
]
```

只接受 `https://cdn.discordapp.com/attachments/...`，并校验 URL 中的 attachment ID 与请求 ID 一致。

## QQ attachment API

QQ → Discord 需要外链存储的图片通过以下接口保存：

```http
POST /api/qq/attachments
Authorization: Bearer <STORAGE_API_TOKEN>
Content-Type: application/json

[
  {
    "id": "<QQ fileid>",
    "url": "https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=...&rkey=..."
  }
]
```

只接受 `https://multimedia.nt.qq.com.cn/download`，并校验查询参数中的 `fileid` 与请求 ID 一致。QQ 临时 URL 会由本进程立即下载。

两个接口都会并发下载数组中的图片，并按请求顺序返回永久 URL：

```json
[
  "https://discord.nahida.im/attachments/3c9f...f12a.png"
]
```

文件名使用下载内容的 SHA-256。Discord 和 QQ 共用同一个目录及命名空间，因此相同内容会自动去重；并发写入同一内容也会合并到同一个最终文件。所有图片都通过 `/attachments/` 暴露。

`GET /healthz` 不需要鉴权。写接口使用 Bearer Token；公网部署时应由 Nginx/Caddy 提供 HTTPS，Node 继续监听 `127.0.0.1`。

## 静态文件

本进程只提供控制 API，不直接提供图片文件。由 Nginx、Caddy 或 CDN 读取数据目录：

```nginx
location /avatars/ {
    alias /var/lib/bridge-img-storage/avatars/;
    add_header Cache-Control "public, max-age=60, must-revalidate";
}

location /attachments/ {
    alias /mnt/gdrive/bridge-img-storage/attachments/;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

头像文件名是 `{userid}.webp`，会被覆盖，因此不能长期 immutable。图片 URL 由内容 SHA-256 决定，不会变化，可以长期缓存。
