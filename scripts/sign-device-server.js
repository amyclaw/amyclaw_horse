#!/usr/bin/env node
/**
 * OpenClaw Gateway connect.challenge 设备签名服务
 * 使用与 amyclaw-gateway 相同的 identity（config/identity/device.json），按网关协议
 * buildDeviceAuthPayload 格式（v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce）签名，
 * 供 Horse 在 connect 时带上 device，以获取 operator.write 等完整 scopes。
 *
 * 用法：IDENTITY_DIR=/path/to/identity node scripts/sign-device-server.js [port]
 * 默认 port=3020。POST /sign-device 或 /api/sign-device，body: { nonce, timestamp?, token?, clientId?, clientMode?, role?, scopes? }
 */

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_PORT = 3020;
const identityDir = process.env.IDENTITY_DIR || path.join(__dirname, "..", "config", "identity");
const devicePath = path.join(identityDir, "device.json");
const deviceAuthPath = path.join(identityDir, "device-auth.json");

function base64UrlEncode(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadDevice() {
  const raw = fs.readFileSync(devicePath, "utf8");
  const dev = JSON.parse(raw);
  if (!dev.deviceId || !dev.privateKeyPem) throw new Error("device.json 缺少 deviceId 或 privateKeyPem");
  const privateKey = crypto.createPrivateKey(dev.privateKeyPem);
  const publicKeyPem = dev.publicKeyPem || crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const publicKeyDer = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  const rawPublicKey = publicKeyDer.slice(-32);
  let deviceToken = null;
  try {
    const auth = JSON.parse(fs.readFileSync(deviceAuthPath, "utf8"));
    if (auth.tokens && auth.tokens.operator && auth.tokens.operator.token) {
      deviceToken = auth.tokens.operator.token;
    }
  } catch (_) {}
  return { deviceId: dev.deviceId, privateKey, publicKeyPem, rawPublicKey, deviceToken };
}

let device;
try {
  device = loadDevice();
} catch (e) {
  console.error("加载 identity 失败:", e.message);
  process.exit(1);
}

// 与 OpenClaw gateway device-auth.ts buildDeviceAuthPayload 一致（v2 带 nonce）
function buildDeviceAuthPayload(params) {
  const version = "v2";
  const scopes = Array.isArray(params.scopes) ? params.scopes.join(",") : (params.scopes || "operator.read,operator.write");
  const token = params.token ?? "";
  const base = [
    version,
    params.deviceId,
    params.clientId ?? "cli",
    params.clientMode ?? "operator",
    params.role ?? "operator",
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce ?? "",
  ];
  return base.join("|");
}

function signChallenge(json) {
  const nonce = (json.nonce != null && json.nonce !== "") ? String(json.nonce) : "";
  if (!nonce) throw new Error("missing nonce");
  const signedAtMs = typeof json.ts === "number" ? json.ts : (typeof json.timestamp === "number" ? json.timestamp : Date.now());
  const clientId = json.clientId ?? "cli";
  const clientMode = json.clientMode ?? "operator";
  const role = json.role ?? "operator";
  const scopes = json.scopes ?? ["operator.read", "operator.write"];
  const token = json.token ?? "";

  const payload = buildDeviceAuthPayload({
    deviceId: device.deviceId,
    clientId,
    clientMode,
    role,
    scopes,
    signedAtMs,
    token,
    nonce,
  });
  const message = Buffer.from(payload, "utf8");
  const sig = crypto.sign(null, message, device.privateKey);
  const out = {
    id: device.deviceId,
    deviceId: device.deviceId,
    publicKey: base64UrlEncode(device.rawPublicKey),
    signature: base64UrlEncode(sig),
    signedAt: signedAtMs,
    nonce,
  };
  if (device.deviceToken) out.authToken = device.deviceToken;
  return out;
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || "").split("?")[0];
  if (req.method !== "POST" || (pathname !== "/api/sign-device" && pathname !== "/sign-device")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    try {
      const json = JSON.parse(body || "{}");
      if (!(json.nonce != null && json.nonce !== "")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing nonce", message: "缺少 nonce" }));
        return;
      }
      const out = signChallenge(json);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

const port = parseInt(process.argv[2], 10) || DEFAULT_PORT;
const host = process.env.LISTEN_HOST || "0.0.0.0";
server.listen(port, host, () => {
  console.log(`sign-device 服务已监听 ${host}:${port}`);
});
