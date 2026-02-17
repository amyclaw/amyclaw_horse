# Horse 经网关 chat 接通排查

## 现象

- 开屏/对话一直收到兜底文案：「新年快乐～咱们这儿是拜年马厩……」
- 说明 horse-server 连上网关后拿不到 `operator.write`，或 device 校验失败。

## 已做修改

1. **config/identity/device-auth.json**  
   已为 operator 增加 `operator.read`、`operator.write`（原只有 operator.admin 等）。  
   网关会按 device 的 scopes 授权，缺 read/write 会导致 chat.send 报 missing scope。

2. **config/identity 权限**  
   `device-auth.json` 需对网关进程可读（容器内一般为 node 用户）。  
   宿主机可执行：  
   `sudo chown 1000:1000 config/identity/device-auth.json`

3. **horse-server 逻辑**  
   - 仅在接受 `connect.challenge` 并成功发送带 device 的 connect 后，才把该连接视为就绪（`sentDeviceConnect`）。  
   - 使用 `client.id: "cli"`、scopes 含 `operator.read` 与 `operator.write`。

## Device 签名格式（已与 OpenClaw 网关一致）

网关验签时使用的原文为 **buildDeviceAuthPayload** 生成的字符串（`device-auth.ts`）：  
`v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce`（`|` 分隔）。

`scripts/sign-device-server.js` 已按此格式实现，并输出 **base64url** 的公钥与签名。  
horse-server 请求 sign-device 时会带上 `nonce`、`timestamp`、`token`（GATEWAY_AUTH_TOKEN）、`clientId`、`clientMode`、`role`、`scopes`，保证与 connect 参数一致。

若仍报「device signature invalid」，确认：  
- 宿主机 3020 运行的是本仓库的 `scripts/sign-device-server.js`（与网关使用同一份 `config/identity/device.json`）；  
- horse-server 的 `SIGN_DEVICE_URL` 指向该地址（如 `http://172.17.0.1:3020`）。

## 自测

1. **宿主机**先启动 sign-device（horse-server 容器通过 `SIGN_DEVICE_URL=http://172.17.0.1:3020` 访问）：

   ```bash
   IDENTITY_DIR=/path/to/jim/config/identity node scripts/sign-device-server.js 3020
   ```

2. 在仓库内执行：

   ```bash
   docker cp horse-server/test-ws.js horse-server:/app/test-ws.js
   docker exec horse-server node /app/test-ws.js 127.0.0.1
   ```

- 若出现「✅ 开屏与对话均有 AI 回复」则已接通。  
- 若仍为「⚠️ 收到的是兜底文案」，再查：  
  `docker logs horse-server 2>&1 | tail -30`
