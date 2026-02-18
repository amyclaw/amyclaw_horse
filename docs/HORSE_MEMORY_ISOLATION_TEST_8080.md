# Horse 记忆隔离测试（122 测试站 8080）

## 测试环境

- **测试站**：http://10.8.52.122:8080（122 宿主机 Nginx，/horse-ws 反代到 horse-server:2026）
- **后端**：与生产共用 horse-server、amyclaw-gateway、sign-device

## 如何启动 8080 测试站（122 上）

```bash
# 1. 静态与 Nginx
mkdir -p /mnt/disk/amyclaw/data/jim/horse/www-test
bash /mnt/disk/amyclaw/jim/scripts/publish-horse-web-test.sh
sudo cp /mnt/disk/amyclaw/jim/nginx/horse_frontend_test.conf /etc/nginx/sites-available/horse-test
sudo ln -sf /etc/nginx/sites-available/horse-test /etc/nginx/sites-enabled/horse-test
sudo nginx -t && sudo systemctl reload nginx

# 2. 确保 Docker 中 horse-server、amyclaw-gateway 已启动（端口 2026、3202 等）
cd /mnt/disk/amyclaw/jim && docker compose ps
```

诊断 8080 无法访问时：`bash /mnt/disk/amyclaw/jim/scripts/check-horse-test-8080.sh`

## 记忆隔离测试（ref 111 / 222，同 uid 跨设备）

脚本：`horse-server/test-memory-isolation-ref111-222.js`

**条件**：模拟「同一 ID 曾在两个设备/浏览器分别跑过」—— 用相同或不同的 `userId` 连接，验证记忆是否按 ref 与按用户隔离。

### 测试 1：ref 111 与 ref 222 各自在两“设备”（不同 userId）

- ref=111 设备1 记「苹果」、设备2 记「橘子」；ref=222 设备1 记「香蕉」、设备2 记「葡萄」。
- 各自问「我的暗号是什么」→ 应得到各自暗号；ref 111 不应出现 222 的暗号，反之亦然。
- **结论**：同 ref 内不同用户隔离、ref 间隔离。

### 测试 2：同一 uid 在两“设备”都用 ref=111

- 同一 `userId`（alice）在 ref=111 记「A1」，再次用同一 ref+userId 问 → 应得到 A1。
- **结论**：同 sessionKey（ref+uid）下记忆共享，符合「同 ID 跨设备用同一 ref 应看到同一记忆」。

### 测试 3：同一 uid 在 ref=111 与 ref=222 各用一次

- 同一 `userId`（bob）在 ref=111 记「X1」、在 ref=222 记「Y2」。
- ref=111 问「我的暗号」→ 应为 X1；ref=222 问 → 应为 Y2；且 111 不应出现 Y2、222 不应出现 X1。
- **结论**：跨 ref 不共享记忆（同一 uid 在不同 ref 下应隔离）。

### 运行

```bash
cd /mnt/disk/amyclaw/jim/horse-server
HORSE_WS_URL=ws://127.0.0.1:8080 node test-memory-isolation-ref111-222.js
```

（在 122 本机跑时可用 `ws://127.0.0.1:8080`；若从别机跑需改为 `ws://10.8.52.122:8080`。）

### 首次完整运行结果（摘要）

- 测试 1（ref 111/222 各自两设备、ref 间隔离）：**6 项全通过**（1a–1f）。
- 测试 2（同 uid 在 ref=111 共享）：**通过**（同 uid 再次问得到 A1）。
- 测试 3（同 uid 跨 ref 隔离）：**3b、3c、3d 通过**；**3a 曾失败一次**（ref=111 问 bob 时返回了通用开场白而非 X1，可能为模型偶发或该 session 未正确保留，需在网关侧确认同 uid 多 ref 时的 session 隔离）。

**重要**：上述自动化测试在「单次会话内按 sessionKey 发请求」时可通过，但**真实用户实测**表明隔离在整体上**未成立**：

- **新设备 + 新 ID** 访问时，AI 会把**测试脚本写入的内容**（ref 111/222、苹果/橘子/香蕉/葡萄、A1/X1/Y2 等）告诉该新用户；
- 还会把**用户从未访问过的陌生 ref** 的内容告诉该新用户。

因此：**记忆/会话在 Gateway 侧存在全局共享**，自动化测试通过不能代表生产环境已按 session 隔离。必须在 OpenClaw Gateway 侧对**会话历史**与**长期记忆（memorySearch）** 都做严格的 sessionKey 隔离，详见 `HORSE_MEMORY_CROSS_SESSION_ANALYSIS.md`。
