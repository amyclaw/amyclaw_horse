# Horse 多用户对话支持说明

## OpenClaw Gateway 多用户对话支持

OpenClaw Gateway **完全支持多用户参与对话**。每个用户通过独立的 `sessionKey` 来维护各自的对话上下文和历史记录。

## Horse 项目的实现方式

### 1. SessionKey 设计

每个用户访问 Horse 页面时，系统会为其生成一个唯一的 `sessionKey`：

```
格式：agent:main:horse_<ref>_<uid>
示例：agent:main:horse_Admin_a1b2c3d4
```

**设计说明：**
- `agent:main`：使用默认的 main agent
- `horse_<ref>`：标识这是 Horse 项目，`ref` 是 URL 参数（如 `?ref=Admin`）
- `<uid>`：用户唯一标识符（UUID 的前 8 位）

**优势：**
- ✅ 每个用户有独立的对话历史
- ✅ 同一 `ref` 的不同用户互不干扰
- ✅ 用户刷新页面后，如果 `uid` 保存在 localStorage，可以恢复对话历史

### 2. IdempotencyKey

每次发送消息时，都会生成一个唯一的 `idempotencyKey`：

```
格式：horse_<timestamp>_<random>
示例：horse_1771258139375_xvnhta24tyo
```

**作用：**
- 防止重复发送相同的消息
- 确保消息的唯一性和幂等性
- Gateway 会基于 `idempotencyKey` 去重

### 3. 多用户对话流程

```
用户 A 访问 ?ref=Admin
  ↓
生成 sessionKey: agent:main:horse_Admin_uidA
  ↓
发送消息 → Gateway 处理 → 保存到独立的 session
  ↓
用户 B 访问 ?ref=Admin
  ↓
生成 sessionKey: agent:main:horse_Admin_uidB
  ↓
发送消息 → Gateway 处理 → 保存到独立的 session（与用户 A 隔离）
```

### 4. 对话隔离机制

- **Session 隔离**：每个 `sessionKey` 对应一个独立的会话存储
- **历史隔离**：不同用户的对话历史完全独立
- **内存隔离**：Gateway 为每个 session 维护独立的内存上下文

### 5. 如何确保对话正常工作

#### 5.1 前端配置

确保每个用户都有唯一的标识：

```javascript
// 生成用户唯一 ID（保存在 localStorage）
const uid = localStorage.getItem('horse_uid') || generateUid();
localStorage.setItem('horse_uid', uid);

// 创建 sessionKey
const sessionKey = `agent:main:horse_${currentHorseOwner}_${uid.slice(0, 8)}`;
```

#### 5.2 Gateway 配置

确保 Gateway 支持多 session：

- ✅ Gateway 默认支持多 session（无需额外配置）
- ✅ 每个 session 独立存储对话历史
- ✅ Session 数据保存在 `/app/memories/<sessionKey>/` 目录

#### 5.3 消息发送格式

```javascript
{
  type: "req",
  id: "chat_send_<timestamp>_<random>",
  method: "chat.send",
  params: {
    sessionKey: "agent:main:horse_Admin_a1b2c3d4",
    message: "用户消息内容",
    idempotencyKey: "horse_<timestamp>_<random>"
  }
}
```

### 6. 常见问题

#### Q: 多个用户访问同一个 ref，会看到彼此的对话吗？

**A:** 不会。每个用户有独立的 `sessionKey`，对话完全隔离。

#### Q: 用户刷新页面后，对话历史会丢失吗？

**A:** 如果 `uid` 保存在 localStorage，刷新后可以恢复相同的 `sessionKey`，从而恢复对话历史。

#### Q: 如何实现"共享对话"功能？

**A:** 如果希望多个用户共享对话，可以使用相同的 `sessionKey`（例如基于 `ref` 而不是 `uid`）。但需要注意并发冲突。

#### Q: Session 数据存储在哪里？

**A:** Gateway 的 session 数据存储在容器内的 `/app/memories/<sessionKey>/` 目录。对于 Horse 项目，数据会保存在挂载的卷中。

### 7. 最佳实践

1. **用户标识持久化**：将 `uid` 保存在 localStorage，确保用户刷新后能恢复对话
2. **SessionKey 命名规范**：使用有意义的命名，便于调试和管理
3. **IdempotencyKey 唯一性**：确保每次消息都有唯一的 `idempotencyKey`
4. **错误处理**：处理 Gateway 返回的错误，特别是 session 相关的错误

### 8. 扩展功能建议

- **对话历史恢复**：实现前端对话历史缓存，提升用户体验
- **多设备同步**：如果需要跨设备同步，可以使用服务器端 session 管理
- **对话导出**：允许用户导出自己的对话记录
