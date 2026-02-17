#!/usr/bin/env node
/**
 * Horse 拜年分身 - 简单协议 WebSocket 服务
 * 协议：收 user_message（[首屏] 或用户文本），通过 amyclaw-gateway 的 chat 生成并回 ai_message。
 * 端口默认 2026，Nginx /horse-ws 反代到此。
 */

const WebSocket = require("ws");
const http = require("http");

const PORT = parseInt(process.env.PORT || "2026", 10);
const GATEWAY_WS_URL = process.env.GATEWAY_WS_URL || "ws://amyclaw-gateway:3202";
const GATEWAY_AUTH_TOKEN = process.env.GATEWAY_AUTH_TOKEN || "openclaw20260207";
const SIGN_DEVICE_URL = process.env.SIGN_DEVICE_URL || ""; // 若网关发 connect.challenge 则需填，如 http://host.docker.internal:3020

// 网关 sessionKey 格式（与前端一致）
function gatewaySessionKey(ref, userId) {
  const r = (ref && ref.trim()) || "Admin";
  const u = (userId && String(userId).slice(0, 8)) || "guest";
  return `agent:main:horse_${r}_${u}`;
}

// 每个 session 一个网关连接，复用
const gatewayConnections = new Map();

function getOrCreateGatewayConnection(sessionKey) {
  if (gatewayConnections.has(sessionKey)) {
    const c = gatewayConnections.get(sessionKey);
    if (c.ws.readyState === 1) return Promise.resolve(c);
    gatewayConnections.delete(sessionKey);
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_WS_URL);
    const state = { ws, ready: false, pending: null, sentDeviceConnect: false, connectFallbackTimer: null };

    ws.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }

      if (payload.type === "event" && payload.event === "connect.challenge") {
        const nonce = payload.payload && payload.payload.nonce;
        const ts = (payload.payload && payload.payload.ts) || Date.now();
        if (!SIGN_DEVICE_URL || !nonce) {
          state.ws.close();
          reject(new Error("gateway requires device but SIGN_DEVICE_URL not set"));
          return;
        }
        fetch(SIGN_DEVICE_URL + "/sign-device", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nonce,
            timestamp: ts,
            token: GATEWAY_AUTH_TOKEN,
            clientId: "cli",
            clientMode: "backend",
            role: "operator",
            scopes: ["operator.read", "operator.write", "operator.admin"],
          }),
        })
          .then((r) => r.json())
          .then((deviceData) => {
            const connectReq = {
              type: "req",
              id: `connect_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: { id: "cli", version: "1.0.0", platform: "node", mode: "backend" },
                role: "operator",
                scopes: ["operator.read", "operator.write", "operator.admin"],
                caps: [],
                commands: [],
                permissions: {},
                auth: { token: GATEWAY_AUTH_TOKEN },
                locale: "zh-CN",
                userAgent: "Horse-Server/1.0",
                device: {
                  id: deviceData.deviceId,
                  publicKey: deviceData.publicKey,
                  signature: deviceData.signature,
                  signedAt: deviceData.signedAt,
                  nonce: deviceData.nonce,
                },
              },
            };
            if (state.connectFallbackTimer) clearTimeout(state.connectFallbackTimer);
            state.connectFallbackTimer = null;
            state.sentDeviceConnect = true;
            ws.send(JSON.stringify(connectReq));
          })
          .catch((e) => {
            state.ws.close();
            reject(e);
          });
        return;
      }

      if (payload.type === "res" && payload.ok === true && payload.payload && payload.payload.type === "hello-ok") {
        if (!state.sentDeviceConnect) return;
        if (state.connectFallbackTimer) clearTimeout(state.connectFallbackTimer);
        state.connectFallbackTimer = null;
        state.ready = true;
        gatewayConnections.set(sessionKey, state);
        resolve(state);
        return;
      }

      if (payload.type === "res" && payload.ok === false && payload.id && String(payload.id).startsWith("connect_")) {
        state.ws.close();
        reject(new Error((payload.error && payload.error.message) || "connect failed"));
        return;
      }

      if (payload.type === "res" && payload.id && String(payload.id).startsWith("chat_") && state.pending) {
        if (payload.ok === false) {
          state.pending.reject(new Error((payload.error && payload.error.message) || "chat.send failed"));
          state.pending = null;
        }
        return;
      }

      if (payload.type === "event" && payload.event === "chat" && state.pending) {
        const chatData = payload.payload;
        let messageText = null;
        if (chatData && chatData.message) {
          const msg = chatData.message;
          if (msg.text) messageText = msg.text;
          else if (typeof msg.content === "string") messageText = msg.content;
          else if (Array.isArray(msg.content)) {
            messageText = msg.content
              .filter((item) => item.type === "text" && item.text)
              .map((item) => item.text)
              .join("\n");
          }
        }
        if (messageText != null && state.pending) {
          state.pending.lastText = messageText;
          if (chatData.state === "final") {
            state.pending.resolve(messageText);
            state.pending = null;
          } else if (chatData.state !== "delta") {
            state.pending.resolve(messageText);
            state.pending = null;
          }
        }
      }
    });

    ws.on("open", () => {
      if (state.ready) return;
      // 等网关先发 connect.challenge，再带 device 发 connect。若 2s 未收到 challenge 则发无 device 的 connect（兼容未开 device 校验）
      state.connectFallbackTimer = setTimeout(() => {
        if (state.ready || state.sentDeviceConnect) return;
        state.sentDeviceConnect = true;
        state.connectFallbackTimer = null;
        ws.send(JSON.stringify({
          type: "req",
          id: `connect_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "cli", version: "1.0.0", platform: "node", mode: "backend" },
            role: "operator",
            scopes: ["operator.read", "operator.write", "operator.admin"],
            caps: [],
            commands: [],
            permissions: {},
            auth: { token: GATEWAY_AUTH_TOKEN },
            locale: "zh-CN",
            userAgent: "Horse-Server/1.0",
          },
        }));
      }, 2000);
    });

    ws.on("error", (err) => {
      gatewayConnections.delete(sessionKey);
      if (state.pending) state.pending.reject(err);
      reject(err);
    });

    ws.on("close", () => {
      gatewayConnections.delete(sessionKey);
      if (state.pending) state.pending.reject(new Error("gateway closed"));
    });
  });
}

function sendChatAndWaitReply(ref, userId, messageText) {
  const gsKey = gatewaySessionKey(ref, userId);
  return getOrCreateGatewayConnection(gsKey).then((state) => {
    return new Promise((resolve, reject) => {
      const id = `chat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const idempotencyKey = `horse_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      state.pending = { resolve, reject, lastText: null };
      const timeout = setTimeout(() => {
        if (state.pending && state.pending.lastText) {
          state.pending.resolve(state.pending.lastText);
          state.pending = null;
        } else if (state.pending) {
          state.pending.reject(new Error("gateway chat timeout"));
          state.pending = null;
        }
      }, 60000);
      const origResolve = state.pending.resolve;
      state.pending.resolve = (text) => {
        clearTimeout(timeout);
        origResolve(text);
      };
      state.ws.send(
        JSON.stringify({
          type: "req",
          id,
          method: "chat.send",
          params: {
            sessionKey: gsKey,
            message: messageText,
            idempotencyKey,
          },
        })
      );
    });
  });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Horse WS server (via Amyclaw gateway). Connect via WebSocket.\n");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const ref = url.searchParams.get("ref") || "Admin";
  const userId = url.searchParams.get("userId") || "";

  function send(obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (_) {
      send({ type: "system", text: "消息格式错误" });
      return;
    }

    if (msg.type !== "user_message") return;

    const text = msg.text && String(msg.text).trim();
    const refFromMsg = msg.ref || ref;
    // 首屏请求时在消息中带上 ref，供 horse_logic 生成符合规则的拜年语（50 字内、以马主为主语、引导句）
    const messageToGateway =
      !text || text === "[首屏]"
        ? `[首屏]\n（当前马主：${refFromMsg}）`
        : text;

    let reply;
    try {
      reply = await sendChatAndWaitReply(refFromMsg, userId, messageToGateway);
    } catch (e) {
      console.error("[horse-ws] gateway error:", e.message);
      const name = refFromMsg && refFromMsg.trim() ? refFromMsg.trim() : "马主";
      reply = `${name} 给您拜年啦！衷心祝愿您和全家在马年里龙马精神、红红火火！愿新的一年里，您家中喜气盈门，事业一马当先，福气、财气、好运统统奔腾而来，万事顺遂，阖家大吉！`;
    }

    const name = refFromMsg && refFromMsg.trim() ? refFromMsg.trim() : "马主";
    const fallback = `${name} 给您拜年啦！衷心祝愿您和全家在马年里龙马精神、红红火火！愿新的一年里，您家中喜气盈门，事业一马当先，福气、财气、好运统统奔腾而来，万事顺遂，阖家大吉！`;
    send({ type: "ai_message", text: (reply && String(reply).trim()) ? reply : fallback });
  });

  ws.on("close", () => {});
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[horse-ws] listening on 0.0.0.0:${PORT} (chat via ${GATEWAY_WS_URL})`);
});
