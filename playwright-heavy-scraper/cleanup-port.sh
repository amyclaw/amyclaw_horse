#!/bin/bash
# 清理 9222 端口冲突脚本

echo "正在清理 9222 端口冲突..."

# 杀掉宿主机可能残留的调试进程
if command -v fuser &> /dev/null; then
    fuser -k 9222/tcp 2>/dev/null && echo "✓ 已清理宿主机 9222 端口占用" || echo "✓ 宿主机 9222 端口未被占用"
else
    echo "⚠ fuser 命令不可用，跳过宿主机端口清理"
fi

# 检查 Docker 容器状态
echo ""
echo "检查 Docker 容器状态..."
docker ps | grep -E "amyclaw-browser|amyclaw-gateway" || echo "未找到相关容器"

echo ""
echo "如需重启服务，请执行："
echo "  docker compose -f /mnt/disk/amyclaw/jim/docker-compose.yml up -d --force-recreate"
