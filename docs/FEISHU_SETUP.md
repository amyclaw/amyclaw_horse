# 飞书开发平台配置指南

## 当前应用信息

- **App ID**: `cli_a919afd2fd389bef`
- **App Secret**: `cmIJ3X8zKqR2bDYq4GkohcW8HfSQrJ1p`
- **验证 Token**: `LwlvYWKZsieCPtLm7Uqv9fxxAAJ8113I`
- **连接方式**: WebSocket 长连接（OpenClaw 主动连接飞书服务器）

---

## 1. 事件订阅配置（必需）

### ⚠️ 重要：OpenClaw 使用 WebSocket 长连接，不是 Webhook

OpenClaw 的飞书集成使用 **WebSocket 长连接**方式，这意味着：

- ✅ **不需要配置回调 URL**（不需要填写 webhook 地址）
- ✅ OpenClaw 会**主动连接**到飞书的 WebSocket 服务器（`wss://open.feishu.cn`）
- ✅ 需要在飞书后台选择 **"使用长连接接收事件（WebSocket）"**

### 飞书后台配置步骤

1. 进入飞书开放平台后台 → **事件订阅**
2. 选择 **"使用长连接接收事件（WebSocket）"**（不是 HTTP 回调）
3. **验证 Token**：`LwlvYWKZsieCPtLm7Uqv9fxxAAJ8113I`（这个 token 在 `config/openclaw.json` 中配置）

### 需要订阅的事件类型

至少需要订阅以下事件：

- ✅ **接收消息** (`im.message.receive_v1`)
  - 私聊消息
  - 群聊消息（@机器人）
  
- ✅ **用户进入群聊** (`im.chat.member.user.added_v1`)
  
- ✅ **用户离开群聊** (`im.chat.member.user.withdrawn_v1`)

- ✅ **机器人被添加** (`im.chat.member.bot.added_v1`)

- ✅ **机器人被移除** (`im.chat.member.bot.withdrawn_v1`)

---

## 2. 权限配置（必需）

在飞书开放平台后台 → **权限管理** → **权限配置**，需要申请以下权限：

### 基础权限

- ✅ **获取与发送单聊、群组消息** (`im:message`)
  - `im:message:send_as_bot` - 以应用身份发送消息
  - `im:message` - 接收消息

- ✅ **获取用户基本信息** (`contact:user.id:readonly`)
  - 用于识别发送消息的用户

- ✅ **获取群组信息** (`im:chat`)
  - `im:chat:readonly` - 读取群组信息

### 高级权限（可选，根据功能需求）

- ✅ **读取用户邮箱信息** (`contact:user.email:readonly`)
- ✅ **读取通讯录** (`contact:user:readonly`)
- ✅ **获取用户手机号** (`contact:user.phone:readonly`)

---

## 3. 服务器地址白名单（如果启用）

如果飞书应用启用了**IP 白名单**功能，需要添加：

- `10.8.52.122` （新服务器 IP）
- `10.8.0.0/16` （内网段，如果从内网访问）

**注意**：如果使用域名 `amy.amyclaw.com`，通常不需要配置 IP 白名单，因为飞书会通过域名解析访问。

---

## 4. 应用发布状态

确保应用状态为：
- ✅ **已发布** 或 **开发中**（开发中状态也可以测试）
- ✅ **已启用** 事件订阅功能

---

## 5. 验证配置

配置完成后，可以通过以下方式验证：

### 5.1 检查事件订阅是否生效

1. 在飞书群里 @机器人发送消息
2. 查看 OpenClaw 日志：

```bash
docker compose logs -f amyclaw-gateway | grep -i feishu
```

应该能看到接收到消息的日志。

### 5.2 检查 WebSocket 连接

由于使用长连接方式，OpenClaw 会主动连接到飞书的 WebSocket 服务器。检查日志中是否有连接成功的提示。

---

## 6. 常见问题排查

### 问题：收不到消息

1. **检查是否选择了长连接方式**
   - 确认在飞书后台选择了 **"使用长连接接收事件（WebSocket）"**，而不是 HTTP 回调
   - 如果选择了 HTTP 回调，需要改为长连接方式

2. **检查验证 Token**
   - 确认 `verificationToken`（`LwlvYWKZsieCPtLm7Uqv9fxxAAJ8113I`）与飞书后台配置一致
   - 检查 `config/openclaw.json` 中的 `channels.feishu.verificationToken` 是否正确

3. **检查权限**
   - 确认已申请 `im:message` 相关权限
   - 确认应用已发布或处于开发状态

4. **检查网络连接**
   - 确认服务器 `10.8.52.122` 可以访问外网（需要能连接到 `wss://open.feishu.cn`）
   - 检查防火墙是否允许出站 WebSocket 连接（443 端口）
   - 如果在内网环境，确认 DNS 解析正常（`open.feishu.cn` 能正确解析）

5. **检查 App ID 和 App Secret**
   - 确认 `appId` 和 `appSecret` 在 `config/openclaw.json` 中正确配置
   - 确认与飞书后台的应用凭证一致

### 问题：WebSocket 连接失败

- 检查日志中是否有 WebSocket 连接错误
- 确认 `open.feishu.cn` 域名可以正常解析和访问
- 检查是否有代理或防火墙阻止了 WebSocket 连接

---

## 7. 参考链接

- [飞书开放平台文档](https://open.feishu.cn/document/)
- [事件订阅配置指南](https://open.feishu.cn/document/ukTMukTMukTM/uczM3UjL3MzN14yNzcTN)
- [权限申请指南](https://open.feishu.cn/document/ukTMukTMukTM/uITNzUjLyUzM14iM1MTN)

---

## 快速检查清单

- [ ] ✅ **已选择长连接方式**：在飞书后台选择了"使用长连接接收事件（WebSocket）"
- [ ] ✅ **验证 Token 已设置**：`LwlvYWKZsieCPtLm7Uqv9fxxAAJ8113I`（与 `config/openclaw.json` 一致）
- [ ] ✅ **已订阅事件**：`im.message.receive_v1`
- [ ] ✅ **已申请权限**：`im:message`、`im:chat`、`contact:user.id:readonly`
- [ ] ✅ **应用凭证正确**：`appId` 和 `appSecret` 在配置文件中正确
- [ ] ✅ **应用已发布或处于开发状态**
- [ ] ✅ **网络连接正常**：服务器可以访问 `wss://open.feishu.cn`
- [ ] ✅ **防火墙已放行**：允许出站 WebSocket 连接（443 端口）
