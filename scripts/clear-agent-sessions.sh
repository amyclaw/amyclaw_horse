#!/bin/bash
# 清除 Agent 会话缓存脚本
# 用法: ./clear-agent-sessions.sh [all|feishu|telegram]

set -e

CONTAINER="amyclaw-gateway"
SESSIONS_DIR="/home/node/.openclaw/agents/main/sessions"

echo "=== Agent 会话缓存清除工具 ==="
echo ""

# 检查容器是否运行
if ! docker ps | grep -q "$CONTAINER"; then
    echo "❌ 错误: 容器 $CONTAINER 未运行"
    exit 1
fi

# 显示当前会话数量
CURRENT_COUNT=$(docker exec "$CONTAINER" sh -c "ls -1 $SESSIONS_DIR/*.jsonl 2>/dev/null | wc -l" || echo "0")
echo "当前会话文件数量: $CURRENT_COUNT"

if [ "$CURRENT_COUNT" -eq 0 ]; then
    echo "✅ 没有会话文件需要清除"
    exit 0
fi

# 显示会话文件列表
echo ""
echo "会话文件列表:"
docker exec "$CONTAINER" sh -c "ls -lh $SESSIONS_DIR/*.jsonl 2>/dev/null | awk '{print \$9, \$5}'" | head -10

# 确认清除
echo ""
read -p "是否清除所有会话缓存? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 已取消"
    exit 0
fi

# 备份会话文件到 data 盘（可选）
BACKUP_DIR="/home/node/data/jim/sessions_backup_$(date +%Y%m%d_%H%M%S)"
echo "备份会话文件到: $BACKUP_DIR (宿主机: /mnt/disk/amyclaw/data/jim/...)"
docker exec "$CONTAINER" sh -c "mkdir -p /home/node/data/jim && mkdir -p $BACKUP_DIR && cp $SESSIONS_DIR/*.jsonl $BACKUP_DIR/ 2>/dev/null || true"

# 清除会话文件
echo "正在清除会话文件..."
docker exec "$CONTAINER" sh -c "rm -f $SESSIONS_DIR/*.jsonl"

# 验证清除结果
REMAINING=$(docker exec "$CONTAINER" sh -c "ls -1 $SESSIONS_DIR/*.jsonl 2>/dev/null | wc -l" || echo "0")
if [ "$REMAINING" -eq 0 ]; then
    echo "✅ 会话缓存已清除"
    echo ""
    echo "⚠️  建议重启 gateway 以确保 Agent 重新加载配置:"
    echo "   docker compose restart amyclaw-gateway"
else
    echo "⚠️  警告: 仍有 $REMAINING 个会话文件未清除"
fi
