#!/bin/bash
# 将 horse-frontend 发布到测试站目录（www-test），与正式 www 隔离
# 测试站访问：内网 http://<内网IP>:8080
set -e
SRC="$(dirname "$0")/../horse-frontend"
DEST="${1:-/mnt/disk/amyclaw/data/jim/horse/www-test}"
if [[ ! -d "$SRC" ]]; then echo "Error: $SRC not found"; exit 1; fi
mkdir -p "$DEST"
cp -r "$SRC"/* "$DEST"/
echo "Published horse-frontend (test) -> $DEST"
echo "Visit: http://<内网IP>:8080"
