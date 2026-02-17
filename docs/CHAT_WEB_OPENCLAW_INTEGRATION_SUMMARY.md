# Chat Web 与 OpenClaw 网关集成总结

本文档总结 Horse 拜年分身（chat web）经 OpenClaw 网关接通 chat 的**开发要点、测试要点与关键点**，便于后续维护与排查。集成测试已通过。

---

## 一、开发要点

### 1.1 整体架构

- **前端**（horse-frontend）：带 `?proto=simple` 时连 `/horse-ws` → horse-server:2026，简单协议 `user_message` / `ai_message`。
- **horse-server**：监听 2026，收 user_message（含 `[首屏]` 或用户输入）后，**再连 amyclaw-gateway** 做 connect + chat.send，把网关的 chat 事件转成 ai_message 回给前端。
- **网关**：amyclaw-gateway:3202，需 device 校验时发 `connect.challenge`，验签通过后授予 operator scopes。
- **sign-device**：独立服务（如 3020），使用与网关**同一份** `config/identity/device.json`，按网关协议对 challenge 签名，供 horse-server 在 connect 时带上 device。

### 1.2 协议与连接顺序

- **第一帧**：网关侧先发 `connect.challenge`（含 `nonce`、`ts`），客户端**不得**在 open 时抢先发无 device 的 connect，否则会先以“仅 token”连接成功，scope 不足，chat.send 报 missing scope。
- **正确顺序**：WebSocket open → **等** 网关发 `connect.challenge` → 调 sign-device 拿 device → 发**带 device** 的 connect → 收 `hello-ok` 后连接就绪，再发 chat.send。
- **兼容**：若约 2s 内未收到 challenge（如网关关闭了 device 校验），再发无 device 的 connect，避免永远不连。

### 1.3 Device 签名格式（关键）

- 网关验签使用的原文为 **buildDeviceAuthPayload**（OpenClaw `device-auth.ts`）：
  - 字符串：`v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce`，字段用 `|` 分隔。
  - `scopes` 为逗号拼接，如 `operator.read,operator.write,operator.admin`。
- sign-device 必须：
  - 用**同一格式**拼出 payload，对 payload 做 Ed25519 签名；
  - 输出 **base64url**（`+`→`-`，`/`→`_`，去掉末尾 `=`）的 publicKey 与 signature。
- horse-server 请求 sign-device 时需传与 connect 一致的参数：`nonce`、`timestamp`（或 `ts`）、`token`、`clientId`、`clientMode`、`role`、`scopes`，保证验签时服务端重建的 payload 与签名一致。

### 1.4 client.mode 与 role

- **client.mode**：网关 schema 只接受固定枚举，如 `webchat`、`cli`、`backend`、`node`、`probe`、`test`。**不能**用 `"operator"`（operator 是 role，不是 mode）。后端代理建议用 `mode: "backend"`。
- **role**：`"operator"`；**scopes** 至少包含 `operator.read`、`operator.write`，做 chat 还需 `operator.admin`（否则可能报 missing scope: operator.admin）。

### 1.5 设备配对（pairing）

- 网关启用 device 校验时，device 须在**已配对**列表中，否则会报 `pairing required`。
- 配对信息在 `config/devices/paired.json`（或网关 state 下的等价路径），需包含：
  - `deviceId`、`publicKey` 与当前 identity 一致；
  - `clientMode` 与 connect 时一致（如 `backend`）；
  - `scopes` 包含 `operator.read`、`operator.write`、`operator.admin` 等所需权限。
- 新设备可经控制台或 CLI（如 `openclaw nodes approve`）完成配对后再用。

### 1.6 部署与配置

- **docker-compose**：
  - 增加 **sign-device** 服务（如 node:20-alpine），挂载 `config/identity`、`scripts`，horse-server 通过 `SIGN_DEVICE_URL=http://sign-device:3020` 访问。
  - 网关环境变量：`OPENCLAW_GATEWAY_CONTROL_UI_DANGEROUSLY_DISABLE_DEVICE_AUTH=false`，以启用 challenge。
- **horse-server**：`GATEWAY_WS_URL`、`GATEWAY_AUTH_TOKEN` 与网关配置一致；`SIGN_DEVICE_URL` 指向 sign-device 地址。

---

## 二、测试要点

### 2.1 集成测试脚本

- 位置：`horse-server/test-ws.js`  
- 作用：连 horse-server 的 2026，发 `[首屏]` 与「你好」，检查是否收到**非兜底**的 AI 回复。

### 2.2 执行方式

```bash
# 保证 sign-device、horse-server、amyclaw-gateway 已起
docker cp horse-server/test-ws.js horse-server:/app/test-ws.js
docker exec horse-server node /app/test-ws.js 127.0.0.1
```

### 2.3 通过标准

- 输出出现 **「✅ 开屏与对话均有 AI 回复，测试通过」**。
- 首屏与「你好」的回复内容**不是**固定兜底文案「新年快乐～咱们这儿是拜年马厩……」（若仍是该文案则判为未接通，退出码 1）。

### 2.4 需验证的点

| 项目 | 说明 |
|------|------|
| connect 顺序 | 先收 challenge 再发带 device 的 connect，不先发无 device connect |
| device 签名 | sign-device 返回 200，horse-server 能拿到 device 并带上 connect |
| hello-ok | 网关返回 hello-ok，连接进入 ready |
| chat.send | 无 missing scope（operator.read/write/admin）错误 |
| chat 事件 | 能收到 event: "chat"，并解析出 message 文本回给前端 |

### 2.5 失败时排查

- `docker logs horse-server 2>&1 | tail -30`：看 gateway error（如 invalid connect params、device signature invalid、missing scope、pairing required）。
- `docker logs sign-device`：确认是否被请求、是否返回 device。
- `docker logs amyclaw-gateway`：搜索 challenge、device、scope、chat.send 相关日志。

---

## 三、关键点（易错与必做）

### 3.1 必须一致的部分

- **identity**：sign-device 与 amyclaw-gateway 使用**同一份** `config/identity/device.json`（及配对/device-auth 配置），否则 device 校验必失败。
- **payload 格式**：sign-device 的 buildDeviceAuthPayload 与 OpenClaw 官方**完全一致**（v2 + 字段顺序 + 分隔符），签名字节与 base64url 编码一致。
- **connect 参数**：sign-device 请求体中的 clientId、clientMode、role、scopes、token 与 connect 的 params **一致**，否则验签重建的 payload 对不上。

### 3.2 常见错误与对应处理

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| invalid connect params: client/mode | client.mode 用了 "operator" 或非法值 | 改为 "backend"（或 "cli" 等 schema 允许值） |
| device signature invalid | 签名原文或编码与网关不一致 | sign-device 用 buildDeviceAuthPayload + base64url，与网关 device-auth.ts 对齐 |
| missing scope: operator.write / operator.admin | 未带 device 或 device 未通过，或 scopes 不足 | 确保先收 challenge、带 device 连接；scopes 含 read、write、admin；paired.json 中该 device 的 scopes 也包含这些 |
| pairing required | device 未配对或配对信息与当前 connect 不符 | 见下方「排查 pairing required」；或补全 config/devices/paired.json 后**重启 amyclaw-gateway** |
| gateway chat timeout | 先前的 connect 失败（如 pairing required）导致无完整 scope，或 AI 响应过慢 | 先解决 pairing，再观察；必要时调大 horse-server 内 chat 超时（当前 60s） |
| 收到兜底文案 | connect 未就绪或 chat.send 失败 | 查 horse-server 日志，按上面几项逐项核对 |

**排查 pairing required（在部署机 x1 上执行）：**

1. **确认 identity 与 paired 的 deviceId 一致**（否则网关不认当前设备）：
   ```bash
   cd /mnt/disk/amyclaw/jim
   echo "identity:" && node -e "console.log(require('./config/identity/device.json').deviceId)"
   echo "paired keys:" && node -e "console.log(Object.keys(require('./config/devices/paired.json')).join(' '))"
   ```
   两处应为同一 deviceId（如 `59a2e9b0b5dc5a6fe714bba04dcb21915ef001141ea652d4c42552f361cfb7d1`）。

2. **重启网关以重新加载 paired.json**（网关可能只在启动时读）：
   ```bash
   docker compose restart amyclaw-gateway
   ```

3. **看网关侧拒绝原因**：
   ```bash
   docker logs amyclaw-gateway 2>&1 | grep -iE "pair|device|challenge"
   ```

### 3.3 不建议的做法

- **不要**在 WebSocket open 时立即发无 device 的 connect（会先建立“仅 token”连接，scope 不足）。
- **不要**关闭网关的 device 校验（`dangerouslyDisableDeviceAuth=true`）作为长期方案，否则无法保证 operator 完整权限与安全模型。
- **不要**让前端或 horse-server 使用与网关 identity 不同的 device 签名服务（如另一套 key 或另一台机器的 sign-device），否则 device signature invalid。

---

## 四、查看用户消息与 AI 回复滚动日志

### 4.1 实时滚动（horse-server 标准输出）

每条**用户消息**（含首屏）和每条 **AI 回复**都会打一行日志，格式：
- 用户：`[horse-ws] user_message <ref> <userId> <内容前80字>`
- AI：`[horse-ws] ai_message <ref> <userId> <内容前80字>`

```bash
# 实时查看用户消息 + AI 回复（一起收看）
docker logs -f horse-server 2>&1 | grep -E "user_message|ai_message"
```

### 4.2 日志与会话存储路径

| 类型 | 宿主机路径 | 说明 |
|------|------------|------|
| **用户消息 / AI 回复滚动日志** | 无独立文件 | horse-server 打 stdout，由 Docker 收集；查看用 `docker logs horse-server`。若需落盘可：`docker logs -f horse-server >> /path/to/horse.log` 或配置 Docker logging driver。 |
| **会话（对话历史）** | **`/mnt/disk/amyclaw/data/openclaw-sessions/`** | 容器内 `/home/node/.openclaw/agents/main/sessions`；每个会话 `<uuid>.jsonl`，含用户与 AI 消息。 |
| **配置审计日志** | **`config/logs/config-audit.jsonl`** | 配置写入等审计事件（非聊天内容）。 |
| **网关内部日志文件** | 容器内 `/tmp/openclaw/openclaw-*.log` | 网关可能写入的日志，未挂载到宿主机，重启即丢。 |

### 4.3 历史记录（OpenClaw 会话 JSONL）

会话持久化在宿主机 **`/mnt/disk/amyclaw/data/openclaw-sessions/`**（容器内 `/home/node/.openclaw/agents/main/sessions`），每个会话一个 `<uuid>.jsonl`，每行一条 JSON。

- 用户消息：`"type":"message"` 且 `"message":{"role":"user", ...}`，正文在 `message.content[].text`。
- 查看某文件中所有用户消息示例：
  ```bash
  grep '"role":"user"' /mnt/disk/amyclaw/data/openclaw-sessions/*.jsonl | head -20
  ```
- 需要按 sessionKey 找对应文件时，可查同目录下 `sessions.json` 中的映射（sessionKey → session id / 文件前缀）。

---

## 五、相关文档

- 协议与合规：`docs/OPENCLAW_FRONTEND_INTEGRATION.md`
- 设备与签名排查：`docs/HORSE_GATEWAY_DEVICE_CHECK.md`
- 连接链与端口：`docs/HORSE_CONNECT_CHAIN.md`、`docs/HORSE_PORT_ANALYSIS.md`
- horse-server 使用：`horse-server/README.md`
