#!/usr/bin/env node
/**
 * 测试 horse-server：连 /horse-ws 协议，发 [首屏] 和 你好，检查是否收到 AI 回复
 * 用法：node test-ws.js [host]  默认 host=127.0.0.1
 */
const WebSocket = require("ws");

const host = process.argv[2] || "127.0.0.1";
const port = 2026;
const url = `ws://${host}:${port}/?ref=Admin&userId=test-${Date.now()}`;

console.log("连接", url, "...");
const ws = new WebSocket(url);

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));

ws.on("open", async () => {
  try {
    // 1. 发 [首屏]
    ws.send(JSON.stringify({ type: "user_message", userId: "test-1", ref: "Admin", text: "[首屏]" }));
    const openRes = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("首屏回复超时")), 25000);
      ws.once("message", (raw) => {
        clearTimeout(t);
        try {
          const p = JSON.parse(raw.toString());
          if (p.type === "ai_message" && p.text) resolve(p.text);
          else if (p.type === "system") resolve("(system: " + (p.text || "") + ")");
          else reject(new Error("非 ai_message: " + JSON.stringify(p).slice(0, 120)));
        } catch (e) {
          reject(e);
        }
      });
    });
    console.log("【首屏】", openRes.slice(0, 80) + (openRes.length > 80 ? "…" : ""));

    // 2. 发 你好
    ws.send(JSON.stringify({ type: "user_message", userId: "test-1", ref: "Admin", text: "你好" }));
    const chatRes = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("对话回复超时")), 25000);
      ws.once("message", (raw) => {
        clearTimeout(t);
        try {
          const p = JSON.parse(raw.toString());
          if (p.type === "ai_message" && p.text) resolve(p.text);
          else if (p.type === "system") resolve("(system: " + (p.text || "") + ")");
          else reject(new Error("非 ai_message: " + JSON.stringify(p).slice(0, 120)));
        } catch (e) {
          reject(e);
        }
      });
    });
    console.log("【你好】", chatRes.slice(0, 80) + (chatRes.length > 80 ? "…" : ""));

    const isFallback =
      openRes.includes("新年快乐～咱们这儿是拜年马厩") && chatRes.includes("新年快乐～咱们这儿是拜年马厩");
    if (isFallback) {
      console.log("\n⚠️ 收到的是兜底文案，网关 chat 可能未接通");
      process.exit(1);
    }
    console.log("\n✅ 开屏与对话均有 AI 回复，测试通过");
    process.exit(0);
  } catch (e) {
    console.error("\n❌", e.message);
    process.exit(1);
  } finally {
    ws.close();
  }
});

ws.on("error", (e) => {
  console.error("WebSocket 错误:", e.message);
  process.exit(1);
});

ws.on("close", (code, reason) => {
  if (code !== 1000 && process.exitCode === undefined) {
    console.error("连接关闭:", code, reason?.toString());
    process.exit(1);
  }
});
