#!/bin/bash

# Configuration
REPO_DIR="/home/node/jim"
LOCK_FILE="/tmp/git_auto_backup.lock"
LOG_FILE="/home/node/.openclaw/git_sync.log"
BRANCH="dev2"

# Auth configuration
# 下行用于设置带认证信息的 origin URL，避免在脚本中硬编码 Token。
# 推荐在环境变量中提供完整 URL，例如：
#   export GIT_AUTH_ORIGIN_URL="https://<username>:<token>@github.com/amyclaw/amyclaw_jim.git"
GIT_AUTH_ORIGIN_URL="${GIT_AUTH_ORIGIN_URL:-}"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Locking mechanism
exec 200>"$LOCK_FILE"
flock -n 200 || { echo "$(date '+%Y-%m-%d %H:%M:%S') Another sync process is running. Exiting." >> "$LOG_FILE"; exit 1; }

cd "$REPO_DIR" || exit 1

# 1. Environment Cleanup Check
if [ -d ".git/rebase-merge" ] || [ -d ".git/rebase-apply" ] || [ -f ".git/MERGE_HEAD" ]; then
    ALERT_MSG="⚠️ Git 同步冲突：需人工处理 (检测到未完成的 rebase/merge)。上次提交：$(git rev-parse --short HEAD)"
    echo "$(date '+%Y-%m-%d %H:%M:%S') $ALERT_MSG" >> "$LOG_FILE"
    echo "$ALERT_MSG" # Output for OpenClaw to catch
    exit 1
fi

# 2. Stash Protection
STASH_MSG="auto_save_$(date +%s)"
git stash push -m "$STASH_MSG" >> "$LOG_FILE" 2>&1

# 3. Atomic Update
# 如果提供了带认证信息的远程地址，则临时覆盖 origin URL。
if [ -n "$GIT_AUTH_ORIGIN_URL" ]; then
    git remote set-url origin "$GIT_AUTH_ORIGIN_URL"
fi

if ! git pull --rebase origin "$BRANCH" >> "$LOG_FILE" 2>&1; then
    git rebase --abort >> "$LOG_FILE" 2>&1
    ALERT_MSG="⚠️ Git 同步冲突：需人工处理 (Pull Rebase 失败)。上次提交：$(git rev-parse --short HEAD)"
    echo "$(date '+%Y-%m-%d %H:%M:%S') $ALERT_MSG" >> "$LOG_FILE"
    echo "$ALERT_MSG"
    exit 1
fi

# 4. Recover and Push
if git stash list | grep -q "$STASH_MSG"; then
    if ! git stash pop >> "$LOG_FILE" 2>&1; then
        ALERT_MSG="⚠️ Git 同步冲突：需人工处理 (Stash Pop 冲突)。上次提交：$(git rev-parse --short HEAD)"
        echo "$(date '+%Y-%m-%d %H:%M:%S') $ALERT_MSG" >> "$LOG_FILE"
        echo "$ALERT_MSG"
        exit 1
    fi
fi

git add . >> "$LOG_FILE" 2>&1
if ! git diff-index --quiet HEAD --; then
    if ! git commit -m "Auto-sync (IM-files & Workspace) $(date +'%Y-%m-%d %H:%M')" >> "$LOG_FILE" 2>&1; then
        ALERT_MSG="⚠️ Git 同步冲突：需人工处理 (Commit 失败)。上次提交：$(git rev-parse --short HEAD)"
        echo "$(date '+%Y-%m-%d %H:%M:%S') $ALERT_MSG" >> "$LOG_FILE"
        echo "$ALERT_MSG"
        exit 1
    fi
fi

if ! git push origin "$BRANCH" >> "$LOG_FILE" 2>&1; then
    ALERT_MSG="⚠️ Git 同步冲突：需人工处理 (Push 失败)。上次提交：$(git rev-parse --short HEAD)"
    echo "$(date '+%Y-%m-%d %H:%M:%S') $ALERT_MSG" >> "$LOG_FILE"
    echo "$ALERT_MSG"
    exit 1
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Success: Sync completed." >> "$LOG_FILE"
