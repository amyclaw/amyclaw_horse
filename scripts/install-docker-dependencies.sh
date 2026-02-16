#!/bin/bash
# Docker容器启动前安装所有依赖的脚本
# 此脚本确保所有扩展和技能所需的npm包都已正确安装

set -e

echo "=== 开始安装Docker依赖 ==="

# 1. 安装全局依赖（在/app目录，供feishu插件使用）
if [ ! -d /app/node_modules/@larksuiteoapi ]; then
    echo "安装全局依赖: @larksuiteoapi/node-sdk"
    cd /app && npm install @larksuiteoapi/node-sdk@^1.58.0 --save --no-package-lock 2>&1 | grep -v "npm WARN" || true
fi

# 2. 安装feishu扩展依赖
if [ -d /home/node/.openclaw/extensions/feishu ]; then
    echo "安装feishu扩展依赖..."
    mkdir -p /home/node/.openclaw/extensions/feishu/node_modules
    
    # 优先从全局复制，否则安装
    if [ -d /app/node_modules/@larksuiteoapi ]; then
        echo "从全局node_modules复制@larksuiteoapi到feishu扩展..."
        cp -r /app/node_modules/@larksuiteoapi /home/node/.openclaw/extensions/feishu/node_modules/ || true
    else
        echo "在feishu扩展目录安装@larksuiteoapi/node-sdk..."
        cd /home/node/.openclaw/extensions/feishu && \
        npm install @larksuiteoapi/node-sdk@^1.58.0 --save --no-package-lock 2>&1 | grep -v "npm WARN" || true
    fi
    
    # 修复权限
    chown -R node:node /home/node/.openclaw/extensions/feishu/node_modules 2>/dev/null || true
fi

# 3. 安装技能依赖
if [ -d /home/node/.openclaw/skills/playwright-heavy-scraper ]; then
    echo "安装playwright-heavy-scraper技能依赖..."
    cd /home/node/.openclaw/skills/playwright-heavy-scraper
    
    # 检查是否已安装
    if [ ! -d node_modules/playwright-core ]; then
        echo "安装playwright-core..."
        npm install playwright-core@^1.58.2 --save --no-package-lock 2>&1 | grep -v "npm WARN" || true
    fi
    
    # 修复权限
    chown -R node:node /home/node/.openclaw/skills/playwright-heavy-scraper/node_modules 2>/dev/null || true
fi

# 4. 验证安装
echo "=== 验证依赖安装 ==="
if [ -d /home/node/.openclaw/extensions/feishu/node_modules/@larksuiteoapi ]; then
    echo "✅ feishu SDK已安装"
else
    echo "⚠️  feishu SDK未安装"
fi

if [ -d /home/node/.openclaw/skills/playwright-heavy-scraper/node_modules/playwright-core ]; then
    echo "✅ playwright-core已安装"
else
    echo "⚠️  playwright-core未安装"
fi

echo "=== 依赖安装完成 ==="
