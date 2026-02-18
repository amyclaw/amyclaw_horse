#!/usr/bin/env node
/**
 * 记忆隔离测试：ref 111 / 222，跨设备、同 uid 跨设备、同 uid 跨 ref
 *
 * 条件：模拟「同一 ID 曾在两个设备/浏览器分别跑过」—— 用相同的 userId 连接不同会话。
 *
 * 测试 1：ref 111 与 ref 222 各自在两个“设备”（不同 userId）跑过
 *   - 111 设备1/设备2 各自记住不同暗号，问各自 → 应得到各自暗号（同 ref 下不同用户隔离）
 *   - 222 同理。且 111 与 222 之间不应串记忆（ref 隔离）
 *
 * 测试 2：同一 uid 在两个“设备”都用过 ref 111
 *   - 设备1 ref=111 userId=alice 记住「A1」；设备2 ref=111 userId=alice 问「我的暗号」→ 应得到 A1（同 sessionKey 共享）
 *
 * 测试 3：同一 uid 在设备1 用 ref=111、设备2 用 ref=222
 *   - 111 上 alice 记住「A1」；222 上 alice 记住「B2」
 *   - ref=111 alice 问「我的暗号」→ 应为 A1；ref=222 alice 问「我的暗号」→ 应为 B2（跨 ref 不共享）
 *
 * 用法：HORSE_WS_URL=ws://127.0.0.1:8080 node test-memory-isolation-ref111-222.js
 */

const WebSocket = require("ws");

const BASE_URL = process.env.HORSE_WS_URL || "ws://127.0.0.1:8080";
const REF_111 = "111";
const REF_222 = "222";

function connect(ref, userId) {
  const url = `${BASE_URL}/horse-ws?ref=${encodeURIComponent(ref)}&userId=${encodeURIComponent(userId)}`;
  return new WebSocket(url);
}

function sendAndWaitReply(ws, text, timeoutMs = 70000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout: " + text.slice(0, 30))), timeoutMs);
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

async function openSendAsk(ref, userId, rememberValue, askQuestion = "我的暗号是什么？") {
  const ws = connect(ref, userId);
  ws.ref = ref;
  ws.userId = userId;
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  const rememberPrompt = `请记住：我的暗号是${rememberValue}。只回复「好的，已记住」即可。`;
  await sendAndWaitReply(ws, rememberPrompt);
  ws.close();
  await new Promise((r) => setTimeout(r, 1500));

  const ws2 = connect(ref, userId);
  ws2.ref = ref;
  ws2.userId = userId;
  await new Promise((resolve, reject) => {
    ws2.on("open", resolve);
    ws2.on("error", reject);
  });
  const reply = await sendAndWaitReply(ws2, askQuestion);
  ws2.close();
  return reply;
}

async function askOnly(ref, userId, question, timeoutMs = 70000) {
  const ws = connect(ref, userId);
  ws.ref = ref;
  ws.userId = userId;
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  const reply = await sendAndWaitReply(ws, question, timeoutMs);
  ws.close();
  return reply;
}

async function tellOnly(ref, userId, text, timeoutMs = 70000) {
  const ws = connect(ref, userId);
  ws.ref = ref;
  ws.userId = userId;
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  const reply = await sendAndWaitReply(ws, text, timeoutMs);
  ws.close();
  return reply;
}

const results = { pass: 0, fail: 0, logs: [] };
function ok(name, cond, detail) {
  if (cond) {
    results.pass++;
    results.logs.push(`[PASS] ${name}: ${detail}`);
  } else {
    results.fail++;
    results.logs.push(`[FAIL] ${name}: ${detail}`);
  }
}

function contains(reply, needle) {
  return reply && String(reply).includes(needle);
}

async function main() {
  console.log("=== Horse 记忆隔离测试（ref 111 / 222，同 uid 跨设备）===\n");
  console.log("BASE_URL:", BASE_URL);
  console.log("");

  try {
    // ---------- 测试 1：ref 111 与 222 各自两“设备”（不同 userId），互不串
    console.log("--- 测试 1：ref 111 / 222 各自两设备（不同 userId），同 ref 内不同用户隔离、ref 间隔离 ---");
    const dev1_111 = "dev1_ref111_" + Date.now();
    const dev2_111 = "dev2_ref111_" + Date.now();
    const dev1_222 = "dev1_ref222_" + Date.now();
    const dev2_222 = "dev2_ref222_" + Date.now();

    await tellOnly(REF_111, dev1_111, "请记住：我的暗号是苹果。只回复「好的，已记住」即可。");
    await new Promise((r) => setTimeout(r, 1500));
    await tellOnly(REF_111, dev2_111, "请记住：我的暗号是橘子。只回复「好的，已记住」即可。");
    await new Promise((r) => setTimeout(r, 1500));
    await tellOnly(REF_222, dev1_222, "请记住：我的暗号是香蕉。只回复「好的，已记住」即可。");
    await new Promise((r) => setTimeout(r, 1500));
    await tellOnly(REF_222, dev2_222, "请记住：我的暗号是葡萄。只回复「好的，已记住」即可。");
    await new Promise((r) => setTimeout(r, 2000));

    const r111_dev1 = await askOnly(REF_111, dev1_111, "我的暗号是什么？");
    const r111_dev2 = await askOnly(REF_111, dev2_111, "我的暗号是什么？");
    const r222_dev1 = await askOnly(REF_222, dev1_222, "我的暗号是什么？");
    const r222_dev2 = await askOnly(REF_222, dev2_222, "我的暗号是什么？");

    ok("1a ref111 设备1 得到自己的暗号(苹果)", contains(r111_dev1, "苹果"), "reply: " + (r111_dev1 || "").slice(0, 80));
    ok("1b ref111 设备2 得到自己的暗号(橘子)", contains(r111_dev2, "橘子"), "reply: " + (r111_dev2 || "").slice(0, 80));
    ok("1c ref222 设备1 得到自己的暗号(香蕉)", contains(r222_dev1, "香蕉"), "reply: " + (r222_dev1 || "").slice(0, 80));
    ok("1d ref222 设备2 得到自己的暗号(葡萄)", contains(r222_dev2, "葡萄"), "reply: " + (r222_dev2 || "").slice(0, 80));
    ok("1e ref111 不出现 222 的暗号(香蕉/葡萄)", !contains(r111_dev1, "香蕉") && !contains(r111_dev1, "葡萄"), "ref111 dev1 未串到 222");
    ok("1f ref222 不出现 111 的暗号(苹果/橘子)", !contains(r222_dev1, "苹果") && !contains(r222_dev1, "橘子"), "ref222 未串到 111");
    console.log("");

    // ---------- 测试 2：同一 uid 在两个“设备”都用 ref 111 → 应共享记忆
    console.log("--- 测试 2：同一 uid（alice）在两设备都用 ref=111，应共享 111 的记忆 ---");
    const alice = "alice_same_uid_" + Date.now();
    await tellOnly(REF_111, alice, "请记住：我的暗号是A1。只回复「好的，已记住」即可。");
    await new Promise((r) => setTimeout(r, 2000));
    const alice_111_ask = await askOnly(REF_111, alice, "我的暗号是什么？");
    ok("2 同 uid 在 ref111 再次问得到 A1", contains(alice_111_ask, "A1"), "reply: " + (alice_111_ask || "").slice(0, 80));
    console.log("");

    // ---------- 测试 3：同一 uid 在 ref=111 与 ref=222 各用一次 → 不应跨 ref 共享
    console.log("--- 测试 3：同一 uid（bob）在 ref=111 记 A1、在 ref=222 记 B2，问各自应得各自暗号 ---");
    const bob = "bob_cross_ref_" + Date.now();
    await tellOnly(REF_111, bob, "请记住：我的暗号是X1。只回复「好的，已记住」即可。");
    await new Promise((r) => setTimeout(r, 1500));
    await tellOnly(REF_222, bob, "请记住：我的暗号是Y2。只回复「好的，已记住」即可。");
    await new Promise((r) => setTimeout(r, 2000));

    const bob_111 = await askOnly(REF_111, bob, "我的暗号是什么？");
    const bob_222 = await askOnly(REF_222, bob, "我的暗号是什么？");
    ok("3a ref=111 bob 得到 X1", contains(bob_111, "X1"), "reply: " + (bob_111 || "").slice(0, 80));
    ok("3b ref=222 bob 得到 Y2", contains(bob_222, "Y2"), "reply: " + (bob_222 || "").slice(0, 80));
    ok("3c ref=111 不出现 Y2", !contains(bob_111, "Y2"), "111 未串 222 的记忆");
    ok("3d ref=222 不出现 X1", !contains(bob_222, "X1"), "222 未串 111 的记忆");
    console.log("");

  } catch (err) {
    results.logs.push("[ERROR] " + err.message);
    console.error(err);
  }

  console.log("=== 结果 ===");
  results.logs.forEach((l) => console.log(l));
  console.log("");
  console.log("通过:", results.pass, "失败:", results.fail);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
