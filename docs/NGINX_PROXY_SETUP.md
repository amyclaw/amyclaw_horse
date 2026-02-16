# Horse 外部 Nginx 代理服务器配置指南

## 目标服务器信息

- **内网服务器 IP**：`10.8.52.122`
- **HTTP 端口**：`80`（默认，无需显式指定）
- **WebSocket 端口**：`2026`（Horse Agent 监听端口，由内网服务器 Nginx 代理到 `/ws` 路径）
- **域名**：`horse.amyclaw.com`

## 外部代理服务器 Nginx 配置

### HTTP 配置（80 端口）

```nginx
server {
    listen 80;
    server_name horse.amyclaw.com;

    # 反向代理到内网服务器
    location / {
        proxy_pass http://10.8.52.122:80;
        
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 支持（重要！）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_connect_timeout 60s;
        proxy_read_timeout 3600s;
    }
}
```

### HTTPS 配置（443 端口，推荐生产环境）

```nginx
server {
    listen 443 ssl http2;
    server_name horse.amyclaw.com;

    # SSL 证书配置
    ssl_certificate /path/to/your/cert.pem;
    ssl_certificate_key /path/to/your/key.pem;
    
    # SSL 优化配置（可选）
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 反向代理到内网服务器
    location / {
        proxy_pass http://10.8.52.122:80;
        
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 支持（重要！）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_connect_timeout 60s;
        proxy_read_timeout 3600s;
    }
}

# HTTP 重定向到 HTTPS（可选）
server {
    listen 80;
    server_name horse.amyclaw.com;
    return 301 https://$server_name$request_uri;
}
```

## 配置说明

### 关键配置项

1. **proxy_pass**：指向内网服务器 `http://10.8.52.122:80`
   - 如果内网服务器监听其他端口，修改端口号即可

2. **WebSocket 支持**：
   - `proxy_set_header Upgrade $http_upgrade;`
   - `proxy_set_header Connection "upgrade";`
   - 这两行必须配置，否则 WebSocket 连接会失败

3. **超时设置**：
   - `proxy_read_timeout 3600s;`：WebSocket 长连接需要较长的超时时间

### 部署步骤

1. **将配置保存到文件**：
   ```bash
   sudo nano /etc/nginx/sites-available/horse-proxy
   ```

2. **创建软链接启用站点**：
   ```bash
   sudo ln -s /etc/nginx/sites-available/horse-proxy /etc/nginx/sites-enabled/horse-proxy
   ```

3. **测试配置**：
   ```bash
   sudo nginx -t
   ```

4. **重载 Nginx**：
   ```bash
   sudo systemctl reload nginx
   ```

## 内网服务器（10.8.52.122）Nginx 配置

### 配置文件位置

配置文件位于：`nginx/horse_frontend.conf`

### 部署步骤

1. **复制配置文件到内网服务器**：
   ```bash
   # 从本仓库复制配置文件
   scp nginx/horse_frontend.conf <your-user>@10.8.52.122:/tmp/horse-frontend.conf
   ```

2. **在内网服务器上安装配置**：
   ```bash
   # SSH 登录到内网服务器
   ssh <your-user>@10.8.52.122
   
   # 复制配置文件到 Nginx 配置目录
   sudo cp /tmp/horse-frontend.conf /etc/nginx/sites-available/horse-frontend
   
   # 创建软链接启用站点
   sudo ln -s /etc/nginx/sites-available/horse-frontend /etc/nginx/sites-enabled/horse-frontend
   
   # 测试配置
   sudo nginx -t
   
   # 如果测试通过，重载 Nginx
   sudo systemctl reload nginx
   ```

3. **确保静态文件目录存在**：
   ```bash
   # 确保前端文件已部署到指定目录
   sudo mkdir -p /mnt/disk/amyclaw/data/jim/horse/www
   # 将 horse-frontend 目录内容复制到该目录
   ```

### 配置说明

- **Nginx 监听**：`0.0.0.0:80`
- **静态文件目录**：`/mnt/disk/amyclaw/data/jim/horse/www`
- **WebSocket 代理**：`/ws` → `127.0.0.1:2026`（Horse Agent）
- **Horse Agent 容器**：监听 `2026` 端口

## 访问测试

配置完成后，访问：
- HTTP：`http://horse.amyclaw.com/index.html?ref=Admin`
- HTTPS：`https://horse.amyclaw.com/index.html?ref=Admin`

## 故障排查

1. **检查内网服务器连通性**：
   ```bash
   curl -I http://10.8.52.122/
   ```

2. **检查 WebSocket 连接**：
   - 浏览器开发者工具 → Network → WS 标签
   - 查看 `/ws` 请求是否返回 `101 Switching Protocols`

3. **查看 Nginx 日志**：
   ```bash
   sudo tail -f /var/log/nginx/access.log
   sudo tail -f /var/log/nginx/error.log
   ```

4. **检查防火墙**：
   - 确保外部代理服务器可以访问内网服务器的 80 端口

## 更新日期

- **配置日期**：2026-02-16
- **内网服务器 IP**：10.8.52.122
- **Horse Agent 端口**：2026
