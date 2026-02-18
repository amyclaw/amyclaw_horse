# 日志查询指令汇总

本文档汇总了项目中所有日志查询相关的命令。

---

## 一、实时滚动日志（用户消息与 AI 回复）

### 1.1 实时查看用户消息和 AI 回复（一起收看）

```bash
# 实时查看用户消息 + AI 回复（一起收看）
docker logs -f horse-server 2>&1 | grep -E "user_message|ai_message"
```

**日志格式说明：**
- 用户消息：`[horse-ws] user_message <ref> <userId> <内容前80字>`
- AI 回复：`[horse-ws] ai_message <ref> <userId> <source=gateway|source=fallback> <内容前200字>`

---

## 二、服务日志查询

### 2.1 horse-server 日志

```bash
# 查看最近 30 行日志（用于错误排查）
docker logs horse-server 2>&1 | tail -30

# 实时查看所有日志
docker logs -f horse-server

# 查看错误日志
docker logs horse-server 2>&1 | grep -i error

# 查看网关相关错误
docker logs horse-server 2>&1 | grep -iE "gateway|connect|device|scope|pairing"
```

### 2.2 sign-device 日志

```bash
# 查看 sign-device 服务日志
docker logs sign-device

# 实时查看 sign-device 日志
docker logs -f sign-device
```

### 2.3 amyclaw-gateway 日志

```bash
# 查看网关日志（配对、设备、challenge 相关）
docker logs amyclaw-gateway 2>&1 | grep -iE "pair|device|challenge"

# 查看网关所有日志
docker logs amyclaw-gateway

# 实时查看网关日志
docker logs -f amyclaw-gateway

# 查看飞书相关日志
docker compose logs -f amyclaw-gateway | grep -i feishu

# 查看网关错误日志
docker logs amyclaw-gateway 2>&1 | grep -iE "error|fail|invalid|missing"
```

---

## 三、会话历史记录查询

### 3.1 OpenClaw 会话 JSONL 文件

**存储路径：** `/mnt/disk/amyclaw/data/openclaw-sessions/`  
**容器内路径：** `/home/node/.openclaw/agents/main/sessions`

```bash
# 查看所有会话文件中的用户消息（前 20 条）
grep '"role":"user"' /mnt/disk/amyclaw/data/openclaw-sessions/*.jsonl | head -20

# 查看特定会话文件的内容
cat /mnt/disk/amyclaw/data/openclaw-sessions/<uuid>.jsonl

# 查看会话映射（sessionKey → session id）
cat /mnt/disk/amyclaw/data/openclaw-sessions/sessions.json
```

---

## 四、配置审计日志

### 4.1 配置审计日志

**存储路径：** `config/logs/config-audit.jsonl`

```bash
# 查看配置审计日志
cat config/logs/config-audit.jsonl

# 查看最近的配置变更
tail -20 config/logs/config-audit.jsonl

# 实时查看配置变更
tail -f config/logs/config-audit.jsonl
```

---

## 五、Nginx 日志查询

### 5.1 Nginx 访问和错误日志

```bash
# 查看 Nginx 访问日志（实时）
sudo tail -f /var/log/nginx/access.log

# 查看 Nginx 错误日志（实时）
sudo tail -f /var/log/nginx/error.log

# 查看最近的访问日志
sudo tail -100 /var/log/nginx/access.log

# 查看最近的错误日志
sudo tail -100 /var/log/nginx/error.log
```

---

## 六、日志保存到文件

### 6.1 将 Docker 日志保存到文件

```bash
# 将 horse-server 日志保存到文件（实时追加）
docker logs -f horse-server >> /path/to/horse.log

# 将网关日志保存到文件
docker logs -f amyclaw-gateway >> /path/to/gateway.log
```

---

## 七、常见排查场景

### 7.1 排查 pairing required 错误

```bash
# 1. 确认 identity 与 paired 的 deviceId 一致
cd /mnt/disk/amyclaw/jim
echo "identity:" && node -e "console.log(require('./config/identity/device.json').deviceId)"
echo "paired keys:" && node -e "console.log(Object.keys(require('./config/devices/paired.json')).join(' '))"

# 2. 查看网关侧拒绝原因
docker logs amyclaw-gateway 2>&1 | grep -iE "pair|device|challenge"
```

### 7.2 排查网关连接错误

```bash
# 查看 horse-server 的网关错误
docker logs horse-server 2>&1 | tail -30

# 查看网关的 challenge、device、scope、chat.send 相关日志
docker logs amyclaw-gateway 2>&1 | grep -iE "challenge|device|scope|chat.send|connect"
```

### 7.3 排查设备签名错误

```bash
# 查看 sign-device 是否被请求
docker logs sign-device

# 查看 horse-server 的设备相关错误
docker logs horse-server 2>&1 | grep -iE "device|signature|sign-device"
```

---

## 八、日志路径汇总

| 类型 | 宿主机路径 | 说明 |
|------|------------|------|
| **用户消息 / AI 回复滚动日志** | 无独立文件 | horse-server 打 stdout，由 Docker 收集；查看用 `docker logs horse-server` |
| **会话（对话历史）** | `/mnt/disk/amyclaw/data/openclaw-sessions/` | 容器内 `/home/node/.openclaw/agents/main/sessions`；每个会话 `<uuid>.jsonl` |
| **配置审计日志** | `config/logs/config-audit.jsonl` | 配置写入等审计事件（非聊天内容） |
| **网关内部日志文件** | 容器内 `/tmp/openclaw/openclaw-*.log` | 网关可能写入的日志，未挂载到宿主机，重启即丢 |
| **Nginx 访问日志** | `/var/log/nginx/access.log` | Web 请求访问日志 |
| **Nginx 错误日志** | `/var/log/nginx/error.log` | Nginx 错误日志 |

---

## 九、快速参考

```bash
# 最常用的实时日志查看命令
docker logs -f horse-server 2>&1 | grep -E "user_message|ai_message"

# 最常用的错误排查命令
docker logs horse-server 2>&1 | tail -30

# 最常用的网关日志查看命令
docker logs amyclaw-gateway 2>&1 | grep -iE "pair|device|challenge"
```
