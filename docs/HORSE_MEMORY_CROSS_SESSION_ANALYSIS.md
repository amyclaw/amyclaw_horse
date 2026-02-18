# Horse：跨设备 / 跨 ref 仍出现「同一用户记忆」的原因分析

## 你观察到的现象

在**电脑**和**手机**浏览器、用**不同的 ref** 对话时，AI 仍然能回忆起你之前问过的问题（像是认出了同一个人）。

## 代码里「同一用户」的认定方式（回顾）

- 前端用 `localStorage['horse_uid_'+ref]` 生成 **uid**，再拼成 **sessionKey** = `agent:main:horse_<ref>_<uid前8位>`。
- 对话历史（会话消息）是**按 sessionKey 隔离**的：换 ref 或换浏览器会得到新的 sessionKey，理论上**不会**共享同一段对话历史。

所以单看「会话历史」这一层，**不应该**出现跨设备、跨 ref 的“同一用户”记忆。若出现了，说明还有别的机制在起作用。

## 最可能的原因：Gateway 的长期记忆（memorySearch）未按 session 隔离

OpenClaw 配置里有 **memorySearch**（agent 的长期记忆 / 向量检索）：

- 位置：`config/openclaw.json` → `agents.defaults.memorySearch`。
- 作用：对话过程中可能把信息写入「记忆」、并在回复时做检索，用来增强上下文。

若 Gateway 在写入或检索 memory 时：

- **没有按 sessionKey 隔离**（例如只按 agent 维度，或按某个全局/用户维度），那么：
  - 所有 Horse 会话（不同 ref、不同设备）都会命中**同一批记忆**；
  - 你在电脑/手机、用不同 ref 问过的问题，会被当成「同一批记忆」检索出来，看起来就像「AI 记得你问过」。

也就是说：**“同一用户”的感觉，很可能来自「共享的长期记忆」，而不是来自「同一 sessionKey / 同一对话历史」。**

## 如何自测验证

已在 `horse-server/test-memory-cross-ref.js` 放了一个自动化测试脚本，逻辑是：

1. **会话 A**：ref=TestMemA、userId=userA_xxx，发送「请记住：我的测试暗号是西瓜123」。
2. **会话 B**：ref=TestMemB、userId=userB_xxx（不同 ref、不同 userId），问「我的测试暗号是什么？」。
3. 若会话 B 的回复里出现「西瓜123」，则说明**存在跨 ref/跨 userId 的记忆**（即记忆未按 sessionKey 严格隔离）。

**运行方式**（需在能访问 Horse 的机器上，且 horse-server / 网关已启动）：

```bash
cd horse-server && node test-memory-cross-ref.js
```

若本机没有 8080 服务，可指定测试站或生产站 WebSocket 地址，例如：

```bash
HORSE_WS_URL=ws://10.8.52.122:8080 node horse-server/test-memory-cross-ref.js
```

你也可以**手动**在浏览器里做类似测试：

1. 电脑打开 `?ref=TestA`，对 AI 说：「请记住：我的暗号是香蕉」。
2. 手机打开 `?ref=TestB`（或清空 localStorage 后换 ref），问：「我的暗号是什么？」
3. 若手机上的 AI 答「香蕉」，即可确认存在跨设备/跨 ref 的共享记忆。

## 小结

| 层次           | 是否按 sessionKey 隔离 | 可能现象 |
|----------------|------------------------|----------|
| 会话历史（对话列表） | 是                     | 换 ref/换浏览器看不到对方设备的历史消息。 |
| 长期记忆（memorySearch） | 若 Gateway 未按 session 隔离则否 | 换设备、换 ref 仍可能“记得”你问过的事。 |

因此：**“电脑和手机、不同 ref 仍得到同样问过的问题的记忆”**，很大概率是因为 **AI 用的是共享的长期记忆（agent 级或未按 session 隔离），而不是因为“识别到同一个 session 用户”。**  
若要严格按会话/按用户隔离记忆，需要在 OpenClaw Gateway 侧确认并配置 memory 的存储与检索是否按 sessionKey（或等价会话标识）做隔离。

---

## 实测确认：记忆全局共享（隔离失效）

**现象**：在**全新设备、全新 ID**（从未在已知设备登录过）上访问 Horse 时，AI 会：

1. 把**自动化测试脚本**里写入的内容（如 ref 111/222 的苹果、橘子、香蕉、葡萄、A1、X1、Y2 等）告诉该新用户；
2. 把**用户从未访问过的陌生 ref** 的对话/记忆内容也告诉该新用户。

**结论**：当前 Gateway 侧的记忆/会话**未按 sessionKey 严格隔离**，存在**全局共享**：

- 新设备、新 ID 本应对应全新的 sessionKey，不应看到任何其他会话的内容；
- 实际却能看到其他 ref、其他 userId 的测试内容与陌生 ref 的内容。

说明至少有一处（或两处同时）存在问题：

| 可能来源 | 说明 |
|----------|------|
| **长期记忆（memorySearch）** | 写入/检索未按 sessionKey 过滤，所有会话共用同一批向量记忆，导致任意新会话都能检索到其他会话写入的内容。 |
| **会话历史（conversation history）** | 若回复时拉取历史未严格按当前 sessionKey 过滤，或存在跨 session 的上下文注入，也会导致“看到别人对话”。 |

**必须修复**：在 OpenClaw Gateway 中，确保：

- 会话历史（对话列表）的读取**仅限当前 sessionKey**；
- 长期记忆（memorySearch）的**写入与检索都按 sessionKey（或等价会话 ID）做隔离**，禁止跨 session 返回或注入记忆。

否则会持续出现隐私与数据串会话问题。
