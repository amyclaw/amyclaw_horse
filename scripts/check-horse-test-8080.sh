#!/usr/bin/env bash
# 在 122 宿主机上运行，用于排查测试站 http://<内网IP>:8080 无法访问的问题
# 用法：bash scripts/check-horse-test-8080.sh  或  ssh 122 'bash -s' < scripts/check-horse-test-8080.sh

set -e

echo "=== Horse 测试站 8080 诊断 ==="
echo ""

# 1. 是否有进程监听 8080
echo "[1] 端口 8080 监听情况："
if command -v ss >/dev/null 2>&1; then
  ss -tlnp 2>/dev/null | grep -E "8080|Address" || true
fi
if ! ss -tlnp 2>/dev/null | grep -q 8080; then
  echo "    → 未检测到 8080 监听。需要启用测试站 Nginx 配置（见下方）。"
else
  echo "    → 有进程在监听 8080。"
fi
echo ""

# 2. 系统 Nginx 是否加载了 8080 的 server
echo "[2] Nginx 是否配置了 listen 8080："
if [[ -d /etc/nginx ]]; then
  if grep -r "listen 8080" /etc/nginx/ 2>/dev/null | head -5; then
    echo "    → 已找到 listen 8080 配置。"
  else
    echo "    → 未找到。请部署测试站配置："
    echo "      sudo cp /mnt/disk/amyclaw/jim/nginx/horse_frontend_test.conf /etc/nginx/sites-available/horse-test"
    echo "      sudo ln -sf /etc/nginx/sites-available/horse-test /etc/nginx/sites-enabled/horse-test"
    echo "      sudo nginx -t && sudo systemctl reload nginx"
  fi
else
  echo "    → /etc/nginx 不存在（可能 Nginx 在 Docker 中）。若 Nginx 在容器内，需在容器内添加 8080 并映射宿主机 8080。"
fi
echo ""

# 3. horse-test 是否在 sites-enabled
echo "[3] 测试站站点是否启用（sites-enabled）："
if [[ -L /etc/nginx/sites-enabled/horse-test ]]; then
  echo "    → 已启用：/etc/nginx/sites-enabled/horse-test -> $(readlink -f /etc/nginx/sites-enabled/horse-test 2>/dev/null || readlink /etc/nginx/sites-enabled/horse-test)"
else
  echo "    → 未启用。执行： sudo ln -sf /etc/nginx/sites-available/horse-test /etc/nginx/sites-enabled/horse-test"
fi
echo ""

# 4. 测试站静态目录
echo "[4] 测试站静态目录 www-test："
ROOT_TEST="/mnt/disk/amyclaw/data/jim/horse/www-test"
if [[ -d "$ROOT_TEST" ]]; then
  if [[ -f "$ROOT_TEST/index.html" ]]; then
    echo "    → 存在且含 index.html。"
  else
    echo "    → 目录存在但缺少 index.html。请执行： bash /mnt/disk/amyclaw/jim/scripts/publish-horse-web-test.sh"
  fi
else
  echo "    → 目录不存在。请执行： mkdir -p $ROOT_TEST && bash /mnt/disk/amyclaw/jim/scripts/publish-horse-web-test.sh"
fi
echo ""

# 5. Nginx 语法与重载
echo "[5] Nginx 语法检查："
if command -v nginx >/dev/null 2>&1; then
  if sudo nginx -t 2>&1; then
    echo "    → 语法正确。若仍无法访问，可执行： sudo systemctl reload nginx"
  else
    echo "    → 语法有误，请修正后再 reload。"
  fi
else
  echo "    → 未找到 nginx 命令（可能仅在 Docker 中）。"
fi
echo ""

# 6. 本机 curl 8080（若已在监听）
echo "[6] 本机访问 8080："
if ss -tlnp 2>/dev/null | grep -q 8080; then
  if command -v curl >/dev/null 2>&1; then
    CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://127.0.0.1:8080/ 2>/dev/null || echo "fail")
    if [[ "$CODE" == "200" ]]; then
      echo "    → curl http://127.0.0.1:8080/ 返回 200。本机可访问，若外网/内网不可访问请检查防火墙。"
    else
      echo "    → curl 返回: $CODE。请检查 Nginx 该 server 的 root 与权限。"
    fi
  fi
else
  echo "    → 跳过（8080 未监听）。"
fi
echo ""

echo "=== 一键修复（在 122 上执行）==="
echo "  mkdir -p /mnt/disk/amyclaw/data/jim/horse/www-test"
echo "  bash /mnt/disk/amyclaw/jim/scripts/publish-horse-web-test.sh"
echo "  sudo cp /mnt/disk/amyclaw/jim/nginx/horse_frontend_test.conf /etc/nginx/sites-available/horse-test"
echo "  sudo ln -sf /etc/nginx/sites-available/horse-test /etc/nginx/sites-enabled/horse-test"
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo "  然后访问： http://10.8.52.122:8080"
echo ""
