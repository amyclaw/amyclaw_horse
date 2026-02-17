# OpenClaw 马厩报告检查结论

## 功能与逻辑：✅ 正确

- **连接性 (2026)**：/ws → horse-agent 简单协议，无 connect.challenge，与当前配置一致。
- **首屏拜年**：`[首屏]` + ref 触发 AI 拜年语，与 horse_logic.md 一致。
- **话题锁定 / 裂变 / sessionKey 隔离**：与 horse_logic.md 和前端设计一致。

## 需核对：互动次数

- **报告写**：10 次互动上限，第 8–9 次提示，第 10 次收尾。
- **horse_logic.md 写**：单次会话不超过 **5 轮**（第 4～5 轮提醒）。
- 若实际已改为 10 次，请把 `skill/horse_logic.md` 里「5 次」改为 10，并统一提示轮次（如第 8–9 次提示、第 10 次收尾）。

## 配置错误（已修正）

### 1. Nginx root 路径

- **报告建议**：`root /home/node/.openclaw/workspace/horse/www;`
- **问题**：该路径是**容器内**路径（OpenClaw 容器里 node 用户的工作目录）。Nginx 跑在 **122 宿主机**上，只能读宿主机上的路径，读不到容器内部路径（除非做 volume 挂载到同一路径）。
- **正确做法**：122 上 Nginx 的 root 用**宿主机目录**，例如：
  - `root /mnt/disk/amyclaw/data/jim/horse/www;`
- 容器内或工作区里构建好的前端，用**发布脚本**拷到上述目录，例如：
  - `bash scripts/publish-horse-web.sh`
- **已做**：仓库内 `nginx/horse_frontend.conf` 已改回 `root /mnt/disk/amyclaw/data/jim/horse/www;`。

### 2. proxy_pass /ws

- 报告建议 `/ws` → `http://127.0.0.1:2026/`，与当前配置一致，无需改。

## 公网不工作的原因（与报告一致）

1. **静态**：若 122 上 Nginx 的 root 曾被改成容器路径，宿主机上该路径不存在或为空，会 404/空白。已改回宿主机路径。
2. **/ws**：若 122 上实际仍是 3012，会走网关并出现 connect.challenge；需保证 122 上 `/ws` 指向 **2026**。
3. **2026 暴露**：horse-agent 必须在 122 上监听 2026（本机或容器 `ports: "2026:2026"`），Nginx 才能 `proxy_pass http://127.0.0.1:2026/`。

## 建议你在 122 上执行

1. **确认 horse_frontend 使用宿主机 root**  
   检查生效配置里是否有：
   - `root /mnt/disk/amyclaw/data/jim/horse/www;`
   若仍是 `/home/node/.openclaw/workspace/horse/www`，改为上面这行并重载 Nginx。

2. **把最新前端发布到该 root**  
   在能访问仓库和该目录的机器上执行：
   - `bash /mnt/disk/amyclaw/jim/scripts/publish-horse-web.sh`
   或把容器内/工作区里 `horse/www` 的内容拷到 `/mnt/disk/amyclaw/data/jim/horse/www`。

3. **确认 /ws 指向 2026**  
   - `grep -A1 "location /ws" /etc/nginx/sites-enabled/*`  
   应为 `proxy_pass http://127.0.0.1:2026/;`

4. **重载 Nginx**  
   - `sudo nginx -t && sudo nginx -s reload`

## 小结

- 报告里的**业务逻辑和功能描述**正确；**Nginx root 用容器路径**在 122 上不可用，已按宿主机路径改好。
- 公网要通：122 上 root 用宿主机目录、前端发布到该目录、/ws → 2026、2026 端口在宿主机可连，然后重载 Nginx。
