## Horse 拜年分身部署手册（/opt/horse）

> 目标：在一台干净的 Ubuntu Server 上，以独立 OpenClaw 容器的方式运行 Horse 拜年分身服务（WebSocket 端口 8080），供 `horse.amyclaw.com` H5 前端使用。

### 一、准备 /opt/horse 目录

```bash
sudo mkdir -p /opt/horse/memories
sudo mkdir -p /opt/horse/skills
sudo chown -R $USER:$USER /opt/horse
cd /opt/horse
```

说明：
- `/opt/horse/memories`：存放每个马主的祝福留言（`<ref>/guestbook.md`）。
- `/opt/horse/skills`：存放 Horse 专用的 OpenClaw Skill 文件（例如 `horse_logic.md`）。

### 二、拉起 Horse 核心容器

> 镜像：`molt-org/openclaw:latest`  
> 端口：宿主 `8080` 映射容器 `8080`

```bash
cd /opt/horse

docker run -d --name horse-agent \
  --cpus="2.0" --memory="14g" \
  -v "$(pwd)"/memories:/app/memories \
  -v "$(pwd)"/skills:/app/skills \
  -e NODE_OPTIONS="--max-old-space-size=12288" \
  -p 8080:8080 \
  molt-org/openclaw:latest
```

约定：
- 容器内 `/app/skills/horse_logic.md` 会被 OpenClaw 当作技能加载。
- Skill 中约定写入路径为 `./memories/{{metadata.ref}}/guestbook.md`，对应宿主 `/opt/horse/memories/{{ref}}/guestbook.md`。

### 三、注入 Horse Skill（horse_logic.md）

1. 在本仓库 `skill/horse_logic.md` 中维护 Horse Skill 源版本。
2. 部署时将该文件复制到服务器：

```bash
scp skill/horse_logic.md <your-user>@<your-server>:/opt/horse/skills/horse_logic.md
```

3. 如需热更新 Skill：
   - 覆盖 `/opt/horse/skills/horse_logic.md` 后，重启容器：

```bash
docker restart horse-agent
```

### 四、H5 前端对接方式（horse.amyclaw.com）

- WebSocket 握手示例：

```js
const urlParams = new URLSearchParams(window.location.search);
const currentHorseOwner = urlParams.get("ref") || "Admin";
const uid = crypto.randomUUID();

const socket = new WebSocket(
  `ws://<你的服务器IP或域名>:8080?userId=${encodeURIComponent(uid)}&ref=${encodeURIComponent(currentHorseOwner)}`
);
```

- 后端会根据 `ref` 将访客留言归档到对应马主目录中：
  - `/opt/horse/memories/<ref>/guestbook.md`

### 五、与现有 amyclaw 环境的关系

- Horse 容器是一个独立的 OpenClaw 实例，仅负责拜年分身场景：
  - 不影响现有 `amy.amyclaw.com` 网关和配置。
  - 前端 H5 只需要能访问到 `ws://<host>:8080` 即可。
- 后续如果需要，也可以在 Nginx 中为 Horse 配置独立域名或反向代理（例如 `ws://horse.amyclaw.com/ws` -> `horse-agent:8080`）。

