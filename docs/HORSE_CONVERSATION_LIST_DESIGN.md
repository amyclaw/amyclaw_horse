# Horse：左侧用户/会话列表与「自己历史 + 别人发给我」实现方案

## 一、产品含义

- **拉自己的历史**：当前访客与当前马主（ref）AI 的对话记录，按 sessionKey 从服务端拉取并展示。
- **拉取别人发给自己的对话**：以**马主视角**看「谁来找过我的 AI」——即所有访客与「我的 ref」的会话列表；点开某条 = 查看该访客与我的 AI 的完整对话（即「别人发给我的」那条对话）。

因此需要区分两种视角：

| 视角 | 左侧列表含义 | 主区展示 |
|------|--------------|----------|
| **访客** | 可选：仅「当前与马主的对话」或未来扩展多会话 | 当前会话消息（自己 + AI） |
| **马主** | 所有与该马主 ref 相关的会话（每个会话对应一个访客/uid） | 选中会话的完整对话（访客消息 + AI 回复） |

## 二、数据与后端

### 2.1 现有数据

- 会话持久化：`/mnt/disk/amyclaw/data/openclaw-sessions/`（容器内 `.../sessions`）。
- 每个会话：`<uuid>.jsonl`，映射在 `sessions.json`（sessionKey → sessionId/文件前缀）。
- Horse 的 sessionKey 格式：`agent:main:horse_<ref>_<uid前8位>`。
- 马主 ref 固定时，**列出「别人发给我的」= 列出所有 sessionKey 匹配 `agent:main:horse_<当前ref>_*` 的会话**。

### 2.2 后端能力需求

需要两类接口（可由 Gateway 或自建服务提供）：

1. **会话列表（按 ref 过滤）**
   - 输入：`ref`（马主标识）。
   - 输出：会话列表，每项至少包含：`sessionKey` / `sessionId`、最后更新时间、可选「最后一条消息摘要」、可选「访客 uid（从 sessionKey 解析）」。
   - 实现途径：
     - **优先**：若 OpenClaw Gateway 对 operator 暴露「按前缀列出 session」或 `sessions_list` 的等价 WebSocket 方法，则前端或 horse-server 直接调网关。
     - **备选**：在 horse-server 或单独小服务中，读取宿主机上的 `openclaw-sessions/sessions.json` 与各 `*.jsonl`，按 sessionKey 前缀 `agent:main:horse_<ref>_` 过滤，返回列表（含 lastMessageTime、lastMessagePreview 等）。

2. **单会话历史**
   - 输入：`sessionKey` 或 `sessionId`。
   - 输出：该会话的完整消息列表（user / assistant 等），按时间序。
   - 实现途径：
     - **优先**：Gateway 的 `sessions_history` 若对 operator 可用（或通过某 WebSocket method 暴露），则直接调用。
     - **备选**：自建 API 读对应 `<uuid>.jsonl`，解析每行 JSON，过滤出 `type: "message"` 且 `message.role` 为 user/assistant 等，返回统一格式。

### 2.3 马主身份与鉴权

- 当前 Horse 无登录，马主与访客仅通过 URL 的 `ref` 区分。
- 「马主视角」可用约定：例如 `?ref=Admin&view=owner` 表示马主查看列表；或同一 ref 下由后端根据某 token / 简单密码判断是否为马主。
- 列表与历史接口需做权限控制：仅允许马主（或受信端）拉取该 ref 下所有会话；访客仅能拉取自己的 sessionKey 的历史。

## 三、前端：左侧用户列表 + 列表填充对话记录

### 3.1 布局

- **左侧**：固定宽度（如 260px）的「会话列表」面板。
  - 标题：如「对话列表」或「谁来找过我」（马主视角）/「当前对话」（访客视角）。
  - 列表项：每条 = 一个会话，展示「访客标识（如 uid 短码或匿名）」+ 最后一条消息预览 + 时间。
- **右侧**：保留现有主聊天区（消息列表 + 输入框）。
  - 选中左侧某条时，主区展示该会话的历史消息（拉取单会话历史接口）；若为当前会话，可继续发送新消息。

### 3.2 列表数据流

1. **进入页面**
   - 若为马主视角（如 `view=owner` 且 ref 为当前马主）：请求「会话列表」接口（传入 `ref`），拿到 `agent:main:horse_<ref>_*` 的会话列表。
   - 若为访客视角：可只显示「当前会话」一条，或请求列表接口但只返回当前用户的 sessionKey（后端按 uid/sessionKey 过滤）。
2. **填充列表**
   - 用接口返回的数组渲染左侧列表；每项显示：会话标识（如 uid 后 8 位）、最后消息预览、`updatedAt` 格式化时间。
   - 默认选中「当前会话」（访客）或列表第一项（马主），并请求该会话的「单会话历史」接口。
3. **切换会话**
   - 点击列表项 → 请求该 sessionKey 的「单会话历史」→ 主区清空并渲染该会话消息；若为当前会话则允许输入并发送，否则可设为只读。

### 3.3 与现有逻辑的衔接

- **当前会话**：仍用现有 `sessionKey = agent:main:horse_<ref>_<uid>` 与 WebSocket 的 `chat.send` + `chat` 事件；新消息先走现有推送，再在「单会话历史」中可选地补一条（或下次拉历史时自然包含）。
- **历史消息**：仅来自「单会话历史」接口，与现有「首屏/拜年」逻辑独立；进入页面时若已有历史，先拉历史再决定是否发首屏请求。

## 四、实现步骤建议

1. **后端**
   - 确认 Gateway 是否对 operator 暴露「按前缀列 session」和「拉单会话历史」；若否，在 horse-server 或单独服务中实现两个 HTTP API（或通过现有 WebSocket 扩展），读 `openclaw-sessions` 的 `sessions.json` 与 `*.jsonl`。
   - 为马主视角加简单鉴权（如 `view=owner` + token 或 ref 对应密码）。
2. **前端**
   - 在 `index.html` 中增加左侧栏结构（例如 `<aside class="conversation-list">` + `<ul id="conversationList">`），右侧主区保持 `#chatMessages` 与输入框。
   - 在 `app.js` 中：根据 `ref`、`view`、当前 uid 决定调用「列表」接口；用返回结果填充 `#conversationList`；点击项时调用「单会话历史」接口并刷新 `#chatMessages`；当前会话仍走现有 WebSocket 发信与收信。
3. **样式**
   - 在 `style.css` 中为左侧栏、列表项、选中态、时间与预览样式加布局与样式，保证移动端可折叠或抽屉展示。

按上述方式即可实现：**不仅拉自己的历史，也拉取「别人发给自己的」对话（马主视角），左侧为用户/会话列表，列表项对应对话记录，点击后在主区展示该条对话的完整历史。**
