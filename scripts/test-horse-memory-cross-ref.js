#!/usr/bin/env node
/**
 * 测试：不同 ref、不同 userId 的两个会话，AI 是否会“跨会话”回忆之前让记住的内容。
 * 若会话 B 能答出会话 A 里让记住的内容，说明存在跨 session 的记忆（如 agent 级 memory）。
 *
 * 运行方式（需在本机或能访问 Horse 的机器上，且 horse-server/网关已启动）：
 *   cd horse-server && node test-memory-cross-ref.js
 * 或指定 WebSocket 地址（例如测试站）：
 *   HORSE_WS_URL=ws://10.8.52.122:8080 node horse-server/test-memory-cross-ref.js
 */

const WebSocket = require("ws");

const BASE_URL = process.env.HORSE_WS_URL || "ws://127.0.0.1:8080";
const REMEMBER_PHRASE = "西瓜123";
const REF_A = "TestMemA";
const REF_B = "TestMemB";
const USER_A = "userA_" + Date.now();
const USER_B = "userB_" + Date.now();

function connect(ref, userId) {
  const url = `${BASE_URL}/horse-ws?ref=${encodeURIComponent(ref)}&userId=${encodeURIComponent(userId)}`;
  return new WebSocket(url);
}

function sendAndWaitReply(ws, text, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }
      if (msg.type === "ai_message" && msg.text) {
        clearTimeout(t);
        ws.removeListener("message", onMessage);
        resolve(String(msg.text).trim());
      }
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type: "user_message", userId: ws.userId, ref: ws.ref, text }));
  });
}

async function main() {
  console.log("HORSE 跨 ref 记忆测试");
  console.log("  BASE_URL:", BASE_URL);
  console.log("  会话 A: ref=%s, userId=%s → 让 AI 记住「%s」", REF_A, USER_A, REMEMBER_PHRASE);
  console.log("  会话 B: ref=%s, userId=%s → 问「我的测试暗号是什么」", REF_B, USER_B);
  console.log("");

  // 会话 A：让记住
  const wsA = connect(REF_A, USER_A);
  wsA.ref = REF_A;
  wsA.userId = USER_A;

  await new Promise((resolve, reject) => {
    wsA.on("open", resolve);
    wsA.on("error", reject);
  });

  const rememberPrompt = `请记住：我的测试暗号是${REMEMBER_PHRASE}。只回复「好的，已记住」即可。`;
  console.log("[会话A] 发送:", rememberPrompt);
  const replyA = await sendAndWaitReply(wsA, rememberPrompt);
  console.log("[会话A] 回复:", replyA.slice(0, 200));
  wsA.close();

  // 稍等，避免并发
  await new Promise((r) => setTimeout(r, 2000));

  // 会话 B：不同 ref、不同 userId，问刚才让记住的内容
  const wsB = connect(REF_B, USER_B);
  wsB.ref = REF_B;
  wsB.userId = USER_B;

  await new Promise((resolve, reject) => {
    wsB.on("open", resolve);
    wsB.on("error", reject);
  });

  const askPrompt = "我的测试暗号是什么？";
  console.log("[会话B] 发送:", askPrompt);
  const replyB = await sendAndWaitReply(wsB, askPrompt);
  console.log("[会话B] 回复:", replyB.slice(0, 300));
  wsB.close();

  const hasPhrase = replyB.includes(REMEMBER_PHRASE);
  console.log("");
  if (hasPhrase) {
    console.log("结论: 存在跨 ref/跨 userId 记忆 —— 会话 B 答出了会话 A 中让记住的内容。");
  } else {
    console.log("结论: 未检测到跨会话记忆 —— 会话 B 的回复中未包含「" + REMEMBER_PHRASE + "」。");
  }
  process.exit(hasPhrase ? 0 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
