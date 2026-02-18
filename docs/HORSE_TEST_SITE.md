# Horse 测试站点与生产站点说明

## 概述

- **生产站点**：对外正式发布，通过域名 `horse.amyclaw.com` 访问。
- **测试站点**：与生产隔离，仅用于内网 IP 测试，通过 `http://<内网IP>:8080` 访问。

两者共用同一套后端（horse-server、sign-device、amyclaw-gateway），仅**入口、端口和静态文件目录**不同。

---

## 测试路径 vs 生产路径 差别

| 项目 | 生产站点（正式发布） | 测试站点（内网测试） |
|------|----------------------|----------------------|
| **访问地址** | `https://horse.amyclaw.com` 或 `http://horse.amyclaw.com`（经外部 Nginx 反代到 122:80） | `http://10.8.52.122:8080` 或 `http://<内网IP>:8080` |
| **Nginx 监听** | 端口 **80**，`server_name horse.amyclaw.com` | 端口 **8080**，`server_name _`（接受任意 Host，可用 IP 访问） |
| **静态文件目录** | `/mnt/disk/amyclaw/data/jim/horse/www` | `/mnt/disk/amyclaw/data/jim/horse/www-test` |
| **发布命令** | `bash scripts/publish-horse-web.sh` | `bash scripts/publish-horse-web-test.sh` |
| **Nginx 配置** | `nginx/horse_frontend.conf` → 部署为 `sites-available/horse` | `nginx/horse_frontend_test.conf` → 部署为 `sites-available/horse-test` |
| **公网暴露** | 是（通过外部代理 + 域名） | 否，仅内网端口 8080 |
| **后端服务** | 2026 horse-server、3020 sign-device、3012→gateway | 与生产共用同一 2026、3020、3012 |

---

## 测试站点部署步骤

1. **创建测试静态目录并发布前端**
   ```bash
   mkdir -p /mnt/disk/amyclaw/data/jim/horse/www-test
   bash /mnt/disk/amyclaw/jim/scripts/publish-horse-web-test.sh
   ```

2. **在 122 上启用测试站 Nginx 配置**
   ```bash
   sudo cp /mnt/disk/amyclaw/jim/nginx/horse_frontend_test.conf /etc/nginx/sites-available/horse-test
   sudo ln -sf /etc/nginx/sites-available/horse-test /etc/nginx/sites-enabled/horse-test
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. **访问测试站**
   - 内网浏览器打开：`http://10.8.52.122:8080`

---

## 8080 无法访问时排查

测试站 8080 由 **122 宿主机上的 Nginx** 提供（不是 Docker 里的 amyclaw-nginx）。若 `http://10.8.52.122:8080` 打不开，在 122 上执行诊断：

```bash
# 在 122 上执行（或从本机：ssh 10.8.52.122 'bash -s' < /mnt/disk/amyclaw/jim/scripts/check-horse-test-8080.sh）
bash /mnt/disk/amyclaw/jim/scripts/check-horse-test-8080.sh
```

脚本会检查：端口是否监听、Nginx 是否配置 8080、horse-test 是否启用、www-test 目录是否存在、本机 curl 是否 200。

**常见原因与处理：**

| 现象 | 原因 | 处理 |
|------|------|------|
| 连接被拒绝 / 超时 | 未启用测试站或 Nginx 未监听 8080 | 按上文「测试站点部署步骤」第 2 步执行 cp + ln -sf + nginx -t + reload |
| 本机 curl 200，内网其他机器访问不了 | 防火墙未放行 8080 | 若需内网访问：`sudo ufw allow 8080/tcp` 或 iptables 放行 8080（生产建议仅内网） |
| 403 / 404 | www-test 不存在或为空 | `mkdir -p /mnt/disk/amyclaw/data/jim/horse/www-test` 后执行 `bash scripts/publish-horse-web-test.sh` |
| Nginx 在 Docker 中 | 8080 需在宿主机或代理层暴露 | 确认提供 horse.amyclaw.com 的 Nginx 所在位置；若在宿主机，按本文在宿主机启用 horse-test；若在容器，需在容器内加入 8080 配置并映射宿主机 8080 |

---

## 使用建议

- 在测试站（8080 + www-test）验证前端改动，确认无误后再用 `publish-horse-web.sh` 发布到生产 www。
- 生产环境不要将 8080 暴露到公网，仅在内网使用测试站。
