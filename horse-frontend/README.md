## Horse H5 前端（horse-frontend）

这是 `horse.amyclaw.com` 的前端 H5 单页应用，实现「Horse 拜年分身」MVP 版：

- 根据 URL 参数 `?ref=xxx` 动态识别当前马主。
- 展示 Horse 分身对话窗口，引导访客留下新年祝福。
- 通过 WebSocket 将访客消息发送给后端 Horse Agent。
- 展示当前链接并支持一键复制，用于裂变分享。

### 目录结构

- `index.html`：单页入口，包含页面结构与静态文案。
- `style.css`：页面样式，移动端优先设计。
- `app.js`：核心交互逻辑（ref 解析、聊天、WebSocket、分享链接）。

### 部署方式（示例 Nginx）

将 `horse-frontend` 目录内容部署为静态站点，例如：

```nginx
server {
    listen 80;
    server_name horse.amyclaw.com;

    root /var/www/horse-frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

然后将本仓库中的 `horse-frontend` 拷贝到服务器：

```bash
rsync -av ./horse-frontend/ <your-user>@<your-server>:/var/www/horse-frontend/
```

### WebSocket 配置

前端默认在 `app.js` 中使用占位地址：

```js
const WS_BASE_URL = "ws://YOUR_SERVER_IP_OR_DOMAIN:8080";
```

部署到生产环境时，请根据实际 Horse Agent 地址修改为：

- 单机直连示例：

```js
const WS_BASE_URL = "ws://1.2.3.4:8080";
```

- 或者经 Nginx 反向代理（例如 `/ws`）：

```js
const WS_BASE_URL = "wss://horse.amyclaw.com/ws";
```

并在 Nginx 中增加：

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

### 本地预览

在无 Node.js 环境下，可以直接用任意静态服务器或浏览器打开：

- 方式一：在服务器上让 Nginx 指向 `horse-frontend` 目录。
- 方式二：本地简单预览（开发机）：

```bash
cd horse-frontend
python3 -m http.server 4173
```

然后访问 `http://localhost:4173/index.html?ref=Admin`。

