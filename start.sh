#!/bin/bash
# 启动家庭点菜服务，并打印当前局域网访问地址。
#
#   bash start.sh
#
# 为什么需要这个脚本：家用路由器的 DHCP 会定期重新分配 IP，
# 昨天发给家人的地址可能今天就失效了。每次启动都打印一次，避免用旧地址。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/server"

# ---- 取当前局域网 IPv4（排除虚拟网卡：WSL / Docker / 回环）----
lan_ip() {
  ipconfig 2>/dev/null | tr -d '\r' \
    | awk '
        # 中英文 Windows 都用这个判断网卡切换（中文是「适配器」，英文是 "adapter"）
        /适配器|adapter/ { iface = tolower($0) }
        /IPv4/ {
          ip = $NF
          if (iface ~ /wsl|vethernet|hyper-v|docker|vmware|virtualbox/) next
          if (ip ~ /^192\.168\./ || ip ~ /^10\./ || ip ~ /^172\.(1[6-9]|2[0-9]|3[01])\./) {
            print ip; exit
          }
        }'
}

IP="$(lan_ip || true)"
PORT="${PORT:-3000}"

echo "================================================"
echo "  家庭点菜"
echo "================================================"
if [ -n "$IP" ]; then
  echo "  手机访问（需连同一个 WiFi）："
  echo "      http://${IP}:${PORT}"
else
  echo "  ⚠️ 没找到局域网 IP，请检查是否连上了 WiFi"
fi
echo
echo "  本机访问：http://localhost:${PORT}"
echo "  停止服务：Ctrl + C"
echo "================================================"
echo

# 每次启动把当前地址写一份到文件，方便回头查
if [ -n "$IP" ]; then
  echo "http://${IP}:${PORT}" > "$ROOT/server/.lan-url"
fi

exec node src/server.js
