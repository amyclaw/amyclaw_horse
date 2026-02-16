#!/usr/bin/env bash
set -euo pipefail

echo "=== 初始化 /opt/horse 环境 ==="

if [[ "$EUID" -ne 0 ]]; then
  echo "[WARN] 建议使用 sudo 运行本脚本：sudo $0"
fi

HORSE_ROOT="/opt/horse"

echo "[INFO] 创建目录：${HORSE_ROOT}/memories, ${HORSE_ROOT}/skills"
mkdir -p "${HORSE_ROOT}/memories"
mkdir -p "${HORSE_ROOT}/skills"

echo "[INFO] 当前登录用户：$(whoami)"
echo "[INFO] 如有需要，请手动调整 /opt/horse 的属主：sudo chown -R <user>:<group> /opt/horse"

cat <<'EOF'

下一步手动操作建议：

1. 将本仓库中的 skill/horse_logic.md 拷贝到服务器：
   scp skill/horse_logic.md <your-user>@<your-server>:/opt/horse/skills/horse_logic.md

2. 在服务器上执行启动容器命令（示例）：
   cd /opt/horse
   docker run -d --name horse-agent \
     --cpus="2.0" --memory="14g" \
     -v "$(pwd)"/memories:/app/memories \
     -v "$(pwd)"/skills:/app/skills \
     -e NODE_OPTIONS="--max-old-space-size=12288" \
     -p 8080:8080 \
     molt-org/openclaw:latest

3. 前端 H5 通过 ws://<服务器IP或域名>:8080?userId=xxx&ref=xxx 接入 Horse。

EOF

echo "=== /opt/horse 目录初始化完成 ==="

