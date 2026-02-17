#!/bin/bash
# 将 horse-frontend 发布到公测目录，horse.amyclaw.com 使用此目录
set -e
SRC="$(dirname "$0")/../horse-frontend"
DEST="${1:-/mnt/disk/amyclaw/data/jim/horse/www}"
if [[ ! -d "$SRC" ]]; then echo "Error: $SRC not found"; exit 1; fi
mkdir -p "$DEST"
cp -r "$SRC"/* "$DEST"/
echo "Published horse-frontend -> $DEST"
