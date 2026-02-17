# Horse / amyclaw 端口与 Nginx 关系

## 公网 → 内网 完整反向代理链路

整条链路由两段 Nginx 组成（公网代理 + 122 本机），请求路径如下。

### 1. 公网侧（Nginx 代理服务器）

- **角色**：对外提供 HTTPS（SSL 终结），域名 `horse.amyclaw.com`，证书等在此处理。
- **配置**：见 `nginx/horse-proxy-external.conf`，部署在**公网可访问的那台 Nginx 服务器**上（非 122）。
- **逻辑**：
  - `listen 443 ssl`（或 80） + `server_name horse.amyclaw.com`
  - `location /` → `proxy_pass http://10.8.52.122:80`
  - 必须带：`Upgrade`、`Connection "upgrade"`（WebSocket）、`X-Forwarded-Proto $scheme`、`Host`、`X-Real-IP`、`X-Forwarded-For`
- **出口**：所有请求（含 `/` 和 `/ws`）统一反代到 **内网 122 的 80 端口**。

### 2. 内网 122（宿主机 Nginx）

- **角色**：在 122 上 listen 80，按 `server_name horse.amyclaw.com` 处理来自公网代理的请求。
- **配置**：见 `nginx/horse_frontend.conf`，实际生效为 `/etc/nginx/sites-available/horse`（或 horse-frontend）。
- **逻辑**：
  - `location /` → 静态 root（`/mnt/disk/amyclaw/data/jim/horse/www`），`try_files` + `/index.html`
  - `location /ws` → `proxy_pass http://127.0.0.1:3012/`（转到本机 3012，即 amyclaw-nginx 容器）
- **说明**：122 上 **没有** 把 gateway 的 3202 暴露到宿主机，所以 `/ws` 必须经 **3012（amyclaw-nginx）** 再进 Docker 网到 gateway:3202。

### 3. 122 本机 3012（amyclaw-nginx 容器）

- **角色**：Docker 容器，宿主机映射 `3012:80`，与 amyclaw-gateway 同网。
- **配置**：`nginx/nginx_proxy.conf`，挂载到容器内。
- **逻辑**：`server_name amy.amyclaw.com`，`location /` → `proxy_pass http://amyclaw-gateway:3202`（含 WebSocket 头）。
- **说明**：来自 122 的 `/ws` 请求（Host 可能是 horse.amyclaw.com）会命中该 default/server，被转到 **amyclaw-gateway:3202**，URI 保持为 `/ws`。

### 4. 容器内 amyclaw-gateway

- **角色**：OpenClaw 网关，只监听容器内 **3202**，不直接暴露到宿主机。
- **逻辑**：处理 WebSocket 握手与后续消息，统一做 AI 会话与生成。

### 链路小结（公网 → 解析到后端）

```
用户浏览器 (https://horse.amyclaw.com/ 或 /ws)
  → 公网 Nginx 代理（SSL 终结，proxy_pass http://10.8.52.122:80）
  → 122:80 宿主机 Nginx（horse 站点）
       ├─ /     → 静态文件
       └─ /ws   → proxy_pass http://127.0.0.1:3012/
  → 122:3012 amyclaw-nginx 容器（proxy_pass http://amyclaw-gateway:3202）
  → 容器内 amyclaw-gateway:3202（WebSocket 与 AI）
```

公网代理只需反代到 **122:80**；122 上的 Nginx 负责把 `/ws` 转到 **127.0.0.1:3012**，再由 amyclaw-nginx 转至 gateway:3202。无需在公网或 122 上单独暴露 3202。

---

## 当前实际端口（122 宿主机）

| 宿主机端口 | 来源 | 说明 |
|-----------|------|------|
| **80** | 宿主机 Nginx | 对外 HTTP，含 horse.amyclaw.com、默认站等 |
| **3012** | 容器 amyclaw-nginx (80→3012) | 只有此端口能进 Docker 网内的 amyclaw-gateway |
| **3020** | 宿主机 Node 进程 | sign-device-server（主网关 identity 签名，供 Horse connect 带 device 获取 operator.write） |
| **2026** | 容器 horse-agent | 独立 Horse 容器（若弃用可关） |
| **3001** | 容器 horse-agent | sign-device（若走统一网关可弃用） |
| **3202** | **未暴露** | amyclaw-gateway 只在容器内监听，宿主机没有 3202 |

## 问题

- horse 站点 Nginx 配置了 `/ws` → `proxy_pass http://127.0.0.1:3202/`
- 宿主机上 **没有任何进程监听 3202**（gateway 未 publish 3202）
- 所以 Horse 的 WebSocket 连 127.0.0.1:3202 会失败（连接被拒或超时）

## 正确流量路径（统一网关）

目标：Horse 的 /ws 必须最终到达 **amyclaw-gateway:3202**（容器内）。

- **方案 A**：暴露 3202  
  - docker-compose 里 amyclaw-gateway 已写 `ports: 3202:3202`，需执行 `docker compose up -d` 让容器重建，宿主机才有 3202。  
  - horse Nginx 保持 `proxy_pass http://127.0.0.1:3202/`。

- **方案 B（推荐）**：不暴露 3202，经 amyclaw-nginx 转一层  
  - 宿主机 3012 已映射到 amyclaw-nginx；amyclaw-nginx 已把请求转到 `amyclaw-gateway:3202`。  
  - 把 horse 的 `/ws` 改为 `proxy_pass http://127.0.0.1:3012/`，路径变为：  
    **浏览器 → 宿主机 Nginx (horse) /ws → 127.0.0.1:3012 (amyclaw-nginx) → amyclaw-gateway:3202**  
  - 无需改 docker-compose、无需重启 gateway，立刻生效。

## 建议

采用 **方案 B**：horse 的 `location /ws` 改为 `proxy_pass http://127.0.0.1:3012/`，并确保 Nginx 把 WebSocket 相关头（Upgrade、Connection 等）和 X-Forwarded-* 传给 3012。
