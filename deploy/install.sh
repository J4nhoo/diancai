#!/bin/bash
# 家庭点菜 —— 腾讯云轻量服务器（香港/新加坡）一键部署
#
# 用法（在服务器上，root 身份）：
#   curl -fsSL <脚本地址> | bash
# 或先把代码传到 /srv/meal-order 后：
#   sudo bash /srv/meal-order/deploy/install.sh
#
# 做的事：
#   1. 装 Node 20 / MySQL / Nginx
#   2. 建数据库和账号
#   3. 装依赖、跑迁移、建管理员
#   4. 配 Nginx、开开机自启
#   5. 打印访问地址和默认账号

set -euo pipefail

APP_DIR="${APP_DIR:-/srv/meal-order}"
DB_NAME="${DB_NAME:-meal_order}"
DB_USER="${DB_USER:-meal_order}"
DB_PASS="${DB_PASS:-$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 20)}"
ADMIN_PASS="${ADMIN_PASS:-$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 16)}"

c_green() { printf '\033[32m%s\033[0m\n' "$*"; }
c_yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
c_red() { printf '\033[31m%s\033[0m\n' "$*"; }
step() { echo; c_green "==> $*"; }

[ "$(id -u)" -eq 0 ] || { c_red "请用 root 运行（sudo bash $0）"; exit 1; }
[ -f "$APP_DIR/server/package.json" ] || {
  c_red "没找到 $APP_DIR/server/package.json"
  echo "请先把项目代码传到 $APP_DIR（可用 rsync/scp，见 DEPLOY-HK.md）"
  exit 1
}

# ---------- 1. 系统依赖 ----------
step "安装系统依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg lsb-release nginx mysql-server rsync

if ! command -v node >/dev/null 2>&1; then
  step "安装 Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
c_green "Node $(node -v) / Nginx $(nginx -v 2>&1 | grep -oP '[\d.]+' | head -1)"

# ---------- 2. 数据库 ----------
step "准备 MySQL"
systemctl enable --now mysql

mysql -e "
  CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
  ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
  GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
  FLUSH PRIVILEGES;
"
c_green "数据库 $DB_NAME 就绪"

# ---------- 3. 应用配置 ----------
step "生成 .env"
cd "$APP_DIR/server"
if [ -f .env ]; then
  c_yellow ".env 已存在，保留原配置（如需重设请先备份删除）"
  DB_PASS="$(grep -E '^DB_PASSWORD=' .env | cut -d= -f2-)"
  ADMIN_PASS="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
else
  [ -f .env.example ] || { c_red "找不到 server/.env.example"; exit 1; }
  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"

  # 以 .env.example 为底稿，只覆盖本机需要的值。
  # 这样以后项目新增任何环境变量，这个脚本都不用改。
  cp .env.example .env
  node - "$DB_USER" "$DB_PASS" "$DB_NAME" "$JWT_SECRET" "$ADMIN_PASS" <<'NODE_SETUP'
const fs = require('fs');
const [, , DB_USER, DB_PASS, DB_NAME, JWT_SECRET, ADMIN_PASS] = process.argv;
const overrides = {
  NODE_ENV: 'production',
  PORT: '3000',
  TRUST_PROXY: '1',
  CORS_ORIGINS: '',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER,
  DB_PASSWORD: DB_PASS,
  DB_NAME,
  DB_CONNECTION_LIMIT: '10',
  DB_SSL: 'false',
  DB_SSL_REJECT_UNAUTHORIZED: 'true',
  JWT_SECRET,
  AUTO_INIT_DB: 'true',
  // 默认存本机磁盘，由 Nginx 托管；要换成 COS 改这里即可
  STORAGE_DRIVER: 'local',
  IMAGE_DIR: './uploads',
  IMAGE_URL_PREFIX: '/uploads',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: ADMIN_PASS,
  ADMIN_DISPLAY_NAME: '管理员',
};
let text = fs.readFileSync('.env', 'utf8');
for (const [key, value] of Object.entries(overrides)) {
  const re = new RegExp('^' + key + '=.*$', 'm');
  text = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text}\n${key}=${value}`;
}
fs.writeFileSync('.env', text);
NODE_SETUP

  chmod 600 .env
  c_green ".env 已生成（基于 .env.example，已填入本机数据库与本机随机密钥）"
fi

mkdir -p uploads
chmod -R 755 uploads

# ---------- 4. 依赖与初始化 ----------
step "安装依赖并初始化数据库"
npm ci --omit=dev --no-audit --no-fund
npm run init-db

# ---------- 5. Nginx ----------
step "配置 Nginx"
cp "$APP_DIR/deploy/nginx-ip.conf" /etc/nginx/conf.d/meal-order.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx
c_green "Nginx 已启动"

# 放行 80 端口（ufw 存在时才处理）
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then
  ufw allow 80/tcp >/dev/null
  c_green "已放行 80 端口"
fi

# ---------- 6. 后端服务 ----------
step "配置开机自启（systemd）"
cat > /etc/systemd/system/meal-order.service <<EOF
[Unit]
Description=家庭点菜 H5 后端
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$APP_DIR/server/.env
ExecStart=$(command -v node) src/server.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=meal-order

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now meal-order
sleep 2
systemctl is-active --quiet meal-order && c_green "后端服务已启动" || {
  c_red "后端启动失败，查看日志：journalctl -u meal-order -n 50 --no-pager"
  exit 1
}

# ---------- 7. 自检与输出 ----------
step "自检"
sleep 1
HEALTH="$(curl -s --max-time 10 http://127.0.0.1/api/health || true)"
echo "  $HEALTH"
echo "$HEALTH" | grep -q '"ok":true' || c_red "健康检查未通过，请看 journalctl -u meal-order -n 50"

PUB_IP="$(curl -s --max-time 8 https://api.ipify.org || echo '<你的公网IP>')"

echo
echo "=================================================="
c_green "  部署完成"
echo "=================================================="
echo "  访问地址：  http://$PUB_IP"
echo
echo "  管理员账号：admin"
echo "  管理员密码：$ADMIN_PASS"
echo
c_yellow "  请立刻登录并修改密码，把上面这行密码记下来。"
echo
echo "  常用命令："
echo "    journalctl -u meal-order -f      查看后端日志"
echo "    systemctl restart meal-order     重启后端"
echo "    systemctl status meal-order      查看状态"
echo "    nginx -t && systemctl reload nginx  改 Nginx 后重载"
echo
echo "  注意：腾讯云控制台的「防火墙」里要放行 80 端口，否则外网访问不了。"
echo "=================================================="
