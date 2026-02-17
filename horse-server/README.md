# Horse 拜年分身 WebSocket 服务（简单协议）

前端 `?proto=simple` 连 `/horse-ws`，Nginx 反代到本服务（默认端口 2026）。协议：收 `user_message`，回 `ai_message`。**开屏词与对话均由 amyclaw-gateway 的 chat 生成**（horse_logic.md 技能）。

## 运行（Docker，推荐）

与 jim 同目录：

```bash
docker compose up -d horse-server
```

本服务需与 amyclaw-gateway 同网（amyclaw-bridge），通过 `GATEWAY_WS_URL` 连网关做 connect + chat.send，并把 chat 事件里的回复作为 ai_message 回给前端。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| PORT | 2026 | 监听端口 |
| GATEWAY_WS_URL | ws://amyclaw-gateway:3202 | 网关 WebSocket 地址 |
| GATEWAY_AUTH_TOKEN | openclaw20260207 | 网关认证 token |
| SIGN_DEVICE_URL | 空 | 若网关发 connect.challenge 则必填，如 `http://172.17.0.1:3020`（宿主机 3020） |

## 协议

- 前端发：`{ type: "user_message", userId, ref, text: "[首屏]" }` → 网关 chat 按 horse_logic 生成首屏拜年语。
- 前端发：`{ type: "user_message", userId, ref, text: "用户输入" }` → 网关 chat 生成回复。
- 服务端回：`{ type: "ai_message", text: "..." }` 或 `{ type: "system", text: "..." }`。

## 若网关要求 device 签名

若网关返回 connect.challenge，需在宿主机运行 sign-device（如 3020），并让容器能访问：例如 `SIGN_DEVICE_URL=http://172.17.0.1:3020`（Linux 下 Docker 网桥网关）。compose 中可加：

```yaml
environment:
  - SIGN_DEVICE_URL=http://172.17.0.1:3020
```
