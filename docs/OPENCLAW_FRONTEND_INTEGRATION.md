# 在前端网页中集成 OpenClaw

在自有前端里接入 OpenClaw，主要有两种方式。以下「自行接入 chat 前端的规则」整理自 [OpenClaw Gateway 协议](https://docs.openclaw.ai/gateway/protocol) 与 [中文站网关协议](https://openclawcn.com/docs/gateway/protocol/)。

---

## OpenClaw 自行接入 chat 前端的规则（摘要）

### 传输

- **WebSocket**，文本帧，**JSON 负载**。
- **第一帧必须是 `connect` 请求**（不能先发别的）。

### 握手（connect）

1. **网关 → 客户端**（预连接挑战，非本地连接时必发）  
   - 事件：`{ "type": "event", "event": "connect.challenge", "payload": { "nonce": "…", "ts": 1737264000000 } }`  
   - 客户端必须用 **device 私钥对 nonce（或 nonce+ts，视实现）签名**，在下一步 connect 里带上 `device`。

2. **客户端 → 网关**（connect 请求）  
   - 方法：`{ "type": "req", "id": "…", "method": "connect", "params": { … } }`  
   - **params 必须包含**：
     - `minProtocol` / `maxProtocol`：例如 `3`。
     - `client`：**`id` 必须为固定值 `"cli"`**（operator 控制平面客户端）；`version`、`platform`、`mode` 等建议带上。
     - `role`：`"operator"`（做 chat 的前端用 operator）。
     - `scopes`：**至少包含 `"operator.read"` 和 `"operator.write"`** 才能发消息、收 chat 事件；如需配对/审批等可加 `operator.pairing`、`operator.approvals`、`operator.admin`。
     - `auth`：`{ "token": "YOUR_ACCESS_TOKEN" }`，需与网关配置的 `OPENCLAW_GATEWAY_TOKEN`（或 config 里 `gateway.auth.token`）一致。
     - `device`：**非本地连接时必须带**（除非开启了 `gateway.controlUi.dangerouslyDisableDeviceAuth`）；包含 `id`、`publicKey`、`signature`、`signedAt`、`nonce`（签名内容与格式需与网关校验一致，否则会报 device signature invalid）。
   - 有副作用的方法需 **幂等键**（如 `chat.send` 的 `idempotencyKey`）。

3. **网关 → 客户端**（连接成功）  
   - 响应：`{ "type": "res", "id": "…", "ok": true, "payload": { "type": "hello-ok", "protocol": 3, "policy": { … } } }`  
   - 若签发设备令牌，`payload` 里会带 `auth.deviceToken`、`auth.role`、`auth.scopes`，客户端应持久化供后续连接使用。

### 设备与鉴权

- **非本地连接**：必须对 `connect.challenge` 的 nonce 做 **device 签名**，并在 connect 里带上完整 `device`；否则网关不会授予 `operator.write`，无法 `chat.send`。
- **控制 UI 例外**：仅当配置了 `gateway.controlUi.allowInsecureAuth` 或 `gateway.controlUi.dangerouslyDisableDeviceAuth` 时，控制台可省略 device（不推荐生产环境）。
- **token**：`connect.params.auth.token` 必须与网关配置的 token 一致，否则连接会被关闭。

### 发消息与收回复（chat）

- **发送**：请求 `method: "chat.send"`，params 中带 **sessionKey**（会话标识）、**message**（用户输入文本）、**idempotencyKey**（幂等键）。
- **接收**：监听 `type: "event"`, `event: "chat"` 的帧，从 `payload` 中取 AI 回复内容；支持 **流式**（如 `state: "delta"` / `"final"`），可做逐段或最终展示。

### 角色与作用域（operator）

- **operator** = 控制平面客户端（CLI、Web UI、自动化）。
- 常见 **scopes**：`operator.read`、`operator.write`、`operator.admin`、`operator.approvals`、`operator.pairing`。  
  做 chat 的前端至少需要 **operator.read + operator.write**；网关按 connect 时声明的 scopes 与 device 签发结果授权，缺少 `operator.write` 会报 missing scope，无法调用 `chat.send`。

---

## 我们当前实现是否符合上述规则

| 规则项 | 要求 | horse-frontend（网关路径） | horse-server（简单路径代理网关） |
|--------|------|----------------------------|----------------------------------|
| 第一帧为 connect | 客户端发出的第一帧必须是 connect | ✅ 先收 `connect.challenge` 再发 connect（首帧即 connect） | ✅ open 后立即发 connect，收到 challenge 后再发带 device 的 connect |
| client.id | 必须为 `"cli"` | ✅ `client.id: "cli"` | ✅ `client.id: "cli"` |
| role | operator | ✅ `role: "operator"` | ✅ `role: "operator"` |
| scopes | 至少 operator.read、operator.write | ✅ `["operator.read", "operator.write"]` | ✅ 同上 |
| auth.token | 与网关配置一致 | ✅ `openclaw20260207`（与 config 一致） | ✅ `GATEWAY_AUTH_TOKEN=openclaw20260207` |
| device | 非本地必带，含 id/publicKey/signature/signedAt/nonce | ✅ 收 challenge 后调 /api/sign-device，再发 connect 带 device | ✅ 收 challenge 后调 SIGN_DEVICE_URL，再发 connect 带 device |
| chat.send | params 含 sessionKey、message、idempotencyKey | ✅ sessionKey、message、idempotencyKey 均有 | ✅ sessionKey(gsKey)、message、idempotencyKey 均有 |
| 收 chat 事件 | 监听 event: "chat"，处理 payload | ✅ 处理 `event === "chat"`，delta/final 与 text 提取 | ✅ 处理 `event === "chat"`，解析 message 文本 |

**结论：协议字段与流程符合 OpenClaw 自行接入 chat 前端的规则。**

当前未接通的原因在**实现细节**，不在协议违反：

- **device 签名格式**：网关对 nonce（及 ts）的签名格式有要求，sign-device 的 `SIGN_FORMAT` 需与网关校验一致（如 `nonce_ts_newline` 等），否则会报 `device signature invalid`。
- **client.mode**：官方示例中 operator 为 `mode: "operator"`，我们为 `mode: "cli"`；若网关对 mode 有校验可改为 `"operator"` 再试。

---

## 1. 简易集成：iframe 嵌入内置控制台

**做法**：在页面里用 `<iframe>` 嵌入 OpenClaw 自带的 Web UI。

- **地址**：OpenClaw 控制台默认端口一般为 **18789**（以实际部署为准）。
- **鉴权**：URL 带 token，防止未授权访问。  
  格式：`http://your-ip:18789/?token=YOUR_ACCESS_TOKEN`
- **示例**：
  ```html
  <iframe src="http://your-openclaw-host:18789/?token=YOUR_ACCESS_TOKEN" width="100%" height="600"></iframe>
  ```

**特点**：实现快、无需对接协议，但 UI 独立于你的站点，无法深度定制。

---

## 2. 深度集成：对接 WebSocket 网关（推荐）

让聊天界面与站点风格统一，需要直接连 **OpenClaw Gateway**。

- **连接**：用浏览器原生 `WebSocket` 连网关地址（例如 `ws://your-host:18789` 或你环境里的 `wss://amy.amyclaw.com`、经 Nginx 反代的 `wss://horse.amyclaw.com/ws` 等）。
- **鉴权**：连接建立后发送**初始化/connect** 消息，带上 **token**（以及若网关开启 device 校验，则需带 **device 签名**）。
- **会话与消息**：
  - 用 **session_id / sessionKey** 标识会话，网关侧会做上下文与历史（如 SQLite）关联。
  - **发送**：构造 JSON 消息（包含 session 标识与用户 **text**）。
  - **接收**：监听 WebSocket 的 `message` 事件；OpenClaw 支持**流式输出**，可实时展示 AI 逐字/逐段回复。
- **协议**：当前 Gateway 使用 **JSON 帧**（非严格 JSON-RPC 2.0 名称，但思路一致）：
  - 请求：`{ type: "req", id, method, params }`，例如 `method: "connect"`、`method: "chat.send"`。
  - 响应：`{ type: "res", id, ok, payload | error }`。
  - 服务端推送：`{ type: "event", event, payload }`，例如 `event: "connect.challenge"`、`event: "chat"`（含 AI 回复内容）。

---

## 与本仓库 Horse 项目的关系

| 集成方式     | Horse 中的对应实现 |
|--------------|--------------------|
| **iframe**   | 未使用；若需要可单独加一个页面嵌入 OpenClaw 控制台 URL（带 token）。 |
| **WebSocket** | **已用**：<br>• 网关路径：`horse-frontend/app.js` 连 `/ws` → 3012 → amyclaw-gateway；发 `connect`（token + 可选 device）→ `chat.send(sessionKey, message)`，收 `chat` 事件展示回复。<br>• 简单路径：`?proto=simple` 时连 `/horse-ws` → horse-server(2026)；horse-server 再连 amyclaw-gateway 做 connect + chat.send，把网关的 chat 事件转成前端的 `ai_message`。 |

- **session 标识**：前端用 `sessionKey = agent:main:horse_<ref>_<uid>`，与网关约定一致。
- **流式**：前端已处理 `chat` 事件的 `state === "delta"` / `"final"`，可做逐段或最终展示。

若要在新页面中“深度集成” OpenClaw，可参考 `horse-frontend/app.js` 中与 `/ws` 的建连、`connect`、`chat.send` 及 `chat` 事件处理逻辑。
