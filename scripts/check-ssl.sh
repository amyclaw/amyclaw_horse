#!/bin/bash
# 检测指定域名的 SSL 是否正常
# 用法: ./scripts/check-ssl.sh [域名或IP] [端口，默认443]
# 例: ./scripts/check-ssl.sh horse.amyclaw.com
#     ./scripts/check-ssl.sh 10.8.52.152 443

set -e
HOST="${1:-horse.amyclaw.com}"
PORT="${2:-443}"

echo "=== SSL 检测: ${HOST}:${PORT} ==="
echo ""

# 1. 连接与证书链（简要）
echo "--- 1. 连接与证书有效期 ---"
echo | openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" 2>/dev/null | openssl x509 -noout -subject -dates -issuer 2>/dev/null || {
  echo "openssl 连接失败，请检查: 端口是否开放、防火墙、域名解析"
  exit 1
}

# 2. 证书过期时间（醒目）
echo ""
echo "--- 2. 证书过期时间 ---"
EXPIRY=$(echo | openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
echo "过期时间: $EXPIRY"

# 3. HTTPS 可访问性（curl）
echo ""
echo "--- 3. HTTPS 响应 (curl) ---"
if curl -sSf --connect-timeout 5 "https://${HOST}:${PORT}/" -k -o /dev/null -w "HTTP 状态: %{http_code}\n" 2>/dev/null; then
  echo "HTTPS 请求成功"
else
  echo "HTTPS 请求失败或超时（若为 IP 或自签证书，-k 已忽略证书校验）"
  curl -v --connect-timeout 5 "https://${HOST}:${PORT}/" -k 2>&1 | head -30
fi

echo ""
echo "=== 检测结束 ==="
