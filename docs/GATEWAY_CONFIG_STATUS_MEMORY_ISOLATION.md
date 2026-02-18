# Gateway 配置与记忆/会话隔离现状（仅现状说明，未做任何修改）

本文档基于项目路径下**所有与 Gateway 相关的配置**做只读检查，用于后期创建系统任务前了解现状。**未修改任何配置或代码。**

---

## 一、配置来源与加载方式

| 项目 | 说明 |
|------|------|
| **主配置** | `config/openclaw.json`，由 Docker 环境变量 `OPENCLAW_CONFIG_PATH=/home/node/.openclaw/openclaw.json` 指定，通过挂载 `./config` → 容器内 `/home/node/.openclaw` 注入。 |
| **Gateway 进程** | `docker-compose.yml` 中 `amyclaw-gateway` 使用镜像 `ghcr.io/phioranex/openclaw-docker:latest`，启动命令为 `node /app/dist/index.js gateway --bind lan --port 3202 --token openclaw20260207 --allow-unconfigured`。 |
| **会话持久化目录** | 宿主机 `./data/openclaw-sessions`（或 `/mnt/disk/amyclaw/data/openclaw-sessions`）挂载到容器内 **`/home/node/.openclaw/agents/main/sessions`**。会话文件为 `<uuid>.jsonl`，映射关系在同目录下 `sessions.json`（sessionKey → session id）。 |

---

## 二、openclaw.json 中与记忆/会话相关的配置

### 2.1 agents.defaults（agent 默认行为）

```json
"agents": {
  "defaults": {
    "model": { "primary": "google/gemini-3-flash-preview" },
    "workspace": "/home/node/.openclaw/workspace",
    "memorySearch": {
      "provider": "openai",
      "remote": {
        "baseUrl": "http://10.8.52.108:8001/v1/",
        "apiKey": ""
      },
      "model": "embedding"
    },
    "compaction": { "mode": "safeguard" },
    "elevatedDefault": "full",
    "maxConcurrent": 4,
    "subagents": { "maxConcurrent": 8 }
  }
}
```

- **workspace**：agent 工作目录，容器内为 `/home/node/.openclaw/workspace`，对应宿主机 **`config/workspace`**（因 `./config` 挂载为 `/home/node/.openclaw`）。该目录下包括：
  - `MEMORY.md`、`workspace/memory/`、`workspace/horse/memories/<ref>/guestbook.md` 等。
  - **未按 sessionKey 区分**：所有会话共用同一 workspace，即文件级“记忆”天然是**跨会话共享**的。
- **memorySearch**：长期记忆（向量检索）使用外部 OpenAI 兼容 API（`http://10.8.52.108:8001/v1/`），`model: "embedding"`。
  - 配置中**没有任何字段**表示按 sessionKey / sessionId / 用户 做隔离或命名空间（例如无 `scope`、`sessionKeyPrefix`、`namespace` 等）。
  - 即：**当前配置层面无法指定“记忆按会话隔离”**，是否按 session 隔离完全由 Gateway 应用代码（镜像内 `/app/dist`）决定。

### 2.2 gateway 块（网关运行方式与鉴权）

```json
"gateway": {
  "mode": "local",
  "controlUi": {
    "enabled": true,
    "allowInsecureAuth": true,
    "dangerouslyDisableDeviceAuth": false
  },
  "auth": { "mode": "token", "token": "openclaw20260207" },
  "trustedProxies": ["10.8.0.0/16", "172.17.0.0/16", "172.18.0.0/16", "172.19.0.0/16"],
  "nodes": { "browser": { "mode": "auto" } }
}
```

- 与**会话隔离、记忆作用域**无关，仅涉及运行模式、控制台、认证和代理信任。

### 2.3 其他与“记忆/会话”相关的顶层键

- **models**：只配置了 Google 模型与 API，无会话/记忆相关项。
- **browser / tools / messages / commands / channels / plugins**：未发现与 session 或 memory 作用域相关的配置。

**结论（配置层面）**：  
在 **config/openclaw.json** 及本项目中可见的 Gateway 相关配置里，**没有任何一项**用于指定“会话隔离”或“记忆按 sessionKey 隔离”。  
会话存储路径、sessionKey → uuid 的映射、以及 memorySearch 是否按 session 切分，均由 **Gateway 应用实现**（镜像内代码）决定，配置无法直接控制。

---

## 三、会话存储与 workspace 的物理布局（现状）

| 内容 | 宿主机路径 | 容器内路径 | 说明 |
|------|------------|------------|------|
| 主配置与 agent 配置 | `config/` | `/home/node/.openclaw` | 含 openclaw.json、agents/main/agent/*.json 等。 |
| Agent workspace（文件记忆等） | `config/workspace/` | `/home/node/.openclaw/workspace` | MEMORY.md、horse/memories/<ref>/guestbook.md 等，**所有会话共用**。 |
| 会话 JSONL 与映射 | `data/openclaw-sessions/` | `/home/node/.openclaw/agents/main/sessions` | 每个会话 `<uuid>.jsonl`，`sessions.json` 存 sessionKey → uuid。 |

- **会话文件**：按 sessionKey 映射到不同 uuid，说明**对话历史**在存储上是按 session 分文件的；但回复时是否**只读当前 sessionKey 对应的文件**、是否混入其他 session 或全局记忆，由 Gateway 逻辑决定，配置中无法体现。
- **Workspace**：明确是**单一份**、不按 session 划分，因此文件级“记忆”（如 guestbook、MEMORY.md）在现状下是**跨会话共享**的。

---

## 四、memorySearch（长期记忆）现状小结

- **配置**：仅包含 provider、remote.baseUrl、model，**无 scope / namespace / sessionKey 等**。
- **行为**：是否按 sessionKey 写入或检索，**完全依赖 OpenClaw Gateway 源码**（本仓库不包含该源码）。若实现上是“按 agent 或全局”存储/检索，则会出现“新设备、新 ID 仍能看到其他会话/其他 ref 内容”的现象，与当前用户实测一致。

---

## 五、本项目中与 Gateway 相关的其他文件（未改）

- **config/agents/main/agent/models.json**：仅模型配置，无会话/记忆相关项。
- **config/agents/main/agent/auth-profiles.json**：API key 等鉴权配置，无会话隔离相关项。
- **config/workspace/**：agent 共用 workspace，包含 MEMORY.md、horse 逻辑与 guestbook 等，如前所述为共享。
- **docker-compose.yml**：Gateway 的环境变量与卷挂载（OPENCLAW_*、sessions 挂载点）已在上文体现，无“记忆作用域”类配置。

---

## 六、与“记忆隔离”相关的现状总结（供后期系统任务用）

| 层次 | 当前配置/布局能否体现“按 session 隔离”？ | 说明 |
|------|------------------------------------------|------|
| **会话历史（sessions/*.jsonl）** | 存储上按 sessionKey 分文件；**是否只读当前 session 由 Gateway 实现决定** | 配置中无“仅限当前 sessionKey”的开关。 |
| **长期记忆（memorySearch）** | **不能** | 无 scope/namespace/sessionKey；是否按 session 隔离取决于 Gateway 代码。 |
| **Workspace 文件（MEMORY.md、guestbook 等）** | **不能** | 单一份 workspace，所有会话共用，天然跨会话共享。 |

**整体**：  
- 项目内 **Gateway 相关配置已全部检查**，**没有任何一项**用于配置“记忆或会话按 sessionKey 隔离”。  
- 要实现“新设备、新 ID、新 ref 不看到其他会话/其他 ref 内容”，需要在 **OpenClaw Gateway 应用层**（会话历史读取 + memorySearch 写入/检索 + 若需则 workspace 使用方式）做按 sessionKey 的隔离；本仓库仅能提供上述现状说明，供后期创建系统任务使用。

---

## 七、MVP 2.0 开发计划（下一步开发）

上述「记忆隔离」是 **MVP 2.0** 的技术前提，已与产品与开发计划整合如下。

### 7.1 指向 PRD

完整产品与开发计划见：**`docs/PRD_MVP2.0.md`**，包括：

- **目标**：智能体可共享给所有访问用户，用户凭自己名字生成的链接即可访问，体验为「专为自己服务的个人 AI 助理」。
- **鉴权**：不建用户库/密码，仅通过暗号/口令；同一链接可能被不同用户使用，会话开始默认询问口令，由专用鉴权逻辑匹配会话档案；无匹配则开新对话并绑定口令；支持同 ref 下跨设备访问。
- **多匹配与无匹配**：多档案同口令时通过「曾讨论话题」或「按创建时间选档案」消歧；无匹配时告知开新对话、确认/可修改口令。
- **访客（Guest）**：他人用同一链接时使用主人设定的 Guest 专用口令；可定义任务（如约会议、询问事项）；主人通过白名单控制对 Guest 公开的信息；鉴权口令仅用于匹配不对外提供；主人鉴权后可调阅任意 Guest 的口令与交互记录。
- **界面**：拜年界面改为个人助理界面，UI 与提示词改为「个人助理」风格。
- **开发阶段**：阶段 0（记忆隔离）→ 阶段 1（鉴权与会话绑定）→ 阶段 2（个人助理 UI）→ 阶段 3（Guest 机制）→ 阶段 4（联调与文档）。

### 7.2 记忆隔离在 MVP 2.0 中的位置

- **阶段 0**：在 OpenClaw Gateway 侧完成会话历史与 memorySearch 的 **sessionKey 严格隔离**（见本文档第二节、第六节）。
- **必要性**：不完成阶段 0，同一 ref 下多用户/多档案仍会串记忆，口令鉴权无法真正保护隐私；阶段 1 及以后依赖「一个 sessionKey = 一个用户档案」的隔离保证。
- 阶段 0 可与阶段 1 部分并行，但**上线前必须完成隔离**。

### 7.3 后续使用方式

- 创建系统任务或排期时，以 **PRD_MVP2.0.md** 为主产品文档，以本文档为**记忆隔离技术现状与阶段 0 依据**。
- 实现 Gateway 侧隔离时，以本文档「二、六」为配置与结论参考。
