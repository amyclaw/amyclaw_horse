#!/bin/bash
# 部署 jim 到服务器：同步代码与配置，但【不覆盖】服务器上的 config/identity/ 和 config/devices/
# 覆盖这两处会导致网关配对/key 被替换，AI 互动失效。
#
# 用法： scripts/deploy-to-server.sh [user@host:/path/to/jim]
# 示例： scripts/deploy-to-server.sh root@10.8.52.122:/mnt/disk/amyclaw/jim

set -e
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXCLUDE_FILE="${REPO_DIR}/rsync-exclude.txt"
DEST="${1:-}"

if [[ -z "$DEST" ]]; then
  echo "用法: $0 user@host:/path/to/jim"
  echo "示例: $0 root@10.8.52.122:/mnt/disk/amyclaw/jim"
  echo ""
  echo "会使用 rsync-exclude.txt，不会覆盖服务器上的 config/identity/、config/devices/，避免 key 被换掉导致 AI 失效。"
  exit 1
fi

if [[ ! -f "$EXCLUDE_FILE" ]]; then
  echo "错误: 未找到 $EXCLUDE_FILE"
  exit 1
fi

echo "部署到 $DEST（排除 identity/devices，避免覆盖服务器 key）..."
rsync -avz --exclude-from="$EXCLUDE_FILE" "$REPO_DIR/" "$DEST"
echo "完成。服务器上的 config/identity/ 与 config/devices/ 未被覆盖。"
