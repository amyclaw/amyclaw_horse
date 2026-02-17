# Horse 连接链路与「以前能连、现在不能」排查

## 端口关系（122 宿主机）

| 端口 | 服务 | 说明 |
|------|------|------|
| **80** | Nginx | horse.amyclaw.com，/ → 静态，/ws → 见下，/api/ → 见下 |
| **2026** | horse-agent | 简单协议，不发 connect.challenge；**/ws 指此则能连** |
| **3012** | amyclaw-nginx | 转发到 gateway:3202，会发 connect.challenge |
| **3020** | sign-device | 主网关 identity 签名；**/api/ 必须指此** |
| **3001** | horse-agent 的 sign-device | 身份与主网关不同，**/api/ 若指此会 device signature invalid** |

关键：若 /ws 指向 3012 且 /api/ 指向 **3001**，前端拿到的签名是 horse-agent 的身份，主网关校验必失败 → device signature invalid。请确认 122 上 **location /api/** 的 proxy_pass 是 **3020** 不是 3001。

**在 122 上快速检查**（看 /ws 和 /api 实际指到哪）：
```bash
grep -E "location /(ws|api)" -A1 /etc/nginx/sites-enabled/* /etc/nginx/sites-available/horse* 2>/dev/null
grep proxy_pass /etc/nginx/sites-enabled/* /etc/nginx/sites-available/horse* 2>/dev/null | grep -E "2026|3012|3020|3001"
```

---

## 结论：为什么以前能连、现在不能？

- **以前能连**：当时 `/ws` 指向 **horse-agent（2026）**，后端不发 `connect.challenge`，前端 **open 即连**，走简单协议（user_message / ai_message）。
- **现在不能**：若 122 上 Nginx 把 `/ws` 改成了 **amyclaw-gateway（经 3012）**，后端会发 `connect.challenge`，前端必须带 **device 签名** 完成 connect；签名一直失败（device signature invalid）→ connect 被拒 → 表现「不能连」。

所以本质是：**当前 /ws 实际指到的是网关，而不是 horse-agent**。

---

## 完整链路（按你当前环境逐项对）

### 1. 浏览器 → 站点

- 你访问：`https://horse.amyclaw.com`（或 http）
- 公网 Nginx 反代到内网 122:80
- 122 上 Nginx 的 `server_name horse.amyclaw.com` 处理请求

### 2. 静态页与脚本

- `location /` → `root /mnt/disk/amyclaw/data/jim/horse/www` → 返回 index.html、app.js 等
- 无特别问题则页面能打开

### 3. WebSocket /ws 实际指到哪（关键）

122 上 **当前生效** 的配置里，`location /ws` 的 `proxy_pass` 决定「连谁」：

| proxy_pass 指向        | 后端是谁           | 会发 connect.challenge？ | 前端行为 |
|------------------------|--------------------|---------------------------|----------|
| `http://127.0.0.1:2026/` | horse-agent        | **否**                    | 约 800ms 后走 simple，open 即连，**能连** |
| `http://127.0.0.1:3012/` | amyclaw-gateway    | **是**                    | 必须 sign-device + device，签名失败则 **不能连** |

你日志里已经出现 `connect.challenge` → 说明 **当前 /ws 实际指到的是 3012（gateway）**，不是 2026。

**怎么确认：**

在 122 上执行：

```bash
grep -A2 "location /ws" /etc/nginx/sites-enabled/horse* /etc/nginx/sites-available/horse* 2>/dev/null
```

看输出里 `proxy_pass` 是 2026 还是 3012。

### 4. 若 /ws → 3012（gateway）：/api/sign-device

- 前端收到 challenge 后会请求 `POST /api/sign-device`（body: nonce, ts）
- 122 上必须有 `location /api/` 且 `proxy_pass http://127.0.0.1:3020/`（sign-device 容器）
- 若没有 /api/ 或指错，会 404/非 JSON → 前端「获取设备签名失败」
- 若有 3020，能拿到签名，但网关校验失败 → 控制台会看到 **connect 被拒: device signature invalid**

### 5. 若 /ws → 2026（horse-agent）：不需要 /api

- 不发 connect.challenge，前端不会调 sign-device
- 只要 horse-agent 进程在、端口 2026 通，即可「能连」

---

## 要「像以前一样能连」的两种做法

### 做法 A：恢复走 horse-agent（推荐，立刻能连）

1. 在 122 上把 **/ws 改回 2026**：
   - 在生效的 horse 配置里，`location /ws` 中写：`proxy_pass http://127.0.0.1:2026/;`
2. 重载 Nginx：`sudo nginx -t && sudo systemctl reload nginx`
3. 确认 horse-agent 在跑：`docker ps | grep horse-agent` 或本机 2026 进程

这样就不会再出现 connect.challenge，前端会走 simple 模式，**和以前一样能连**。

### 做法 B：坚持用 amyclaw-gateway（/ws → 3012）

- 必须让 device 签名通过网关校验（修 sign-device 或网关侧校验逻辑）
- 目前所有尝试的签名格式都报 device signature invalid，需要网关/OpenClaw 侧排查或提供正确格式

---

## 仓库里的配置 vs 实际

- **仓库里** `nginx/horse_frontend.conf` 当前是 **/ws → 2026**（horse-agent），且**没有** `location /api/`。
- 若 122 上**完全按这份配置**，理论上不会出现 connect.challenge；你出现 challenge 说明 122 上**实际生效的配置**里 /ws 指向了 3012，或公网/其他层把 /ws 转到了 gateway。

建议：在 122 上直接查一遍 `location /ws` 和 `proxy_pass`，再决定是改回 2026（做法 A）还是继续排查 gateway 签名（做法 B）。
