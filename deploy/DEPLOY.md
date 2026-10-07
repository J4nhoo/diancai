# 部署到轻量云服务器

> 这条是**自建 VPS 路线**（Nginx + systemd + 本地磁盘存图）。
> 如果要用 Render + Aiven + R2 的免费托管路线，看同目录的 [RENDER-AIVEN.md](./RENDER-AIVEN.md)。
> 两者选其一即可。

目标：一台 Linux 服务器（Ubuntu 22.04 / Debian 12 为例），Nginx + Node.js + MySQL 全在一台机器上，HTTPS 通过 Let's Encrypt 免费证书。

> 下文假设项目放在 `/srv/meal-order`，域名为 `meal.example.com`，请按需替换。

## 1. 安装运行环境

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx mysql-server

# 版本确认
node -v      # 应 >= 18
nginx -v
mysql --version
```

## 2. 建库与授权

```bash
sudo mysql
```

```sql
CREATE DATABASE IF NOT EXISTS meal_order
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'meal_order'@'localhost' IDENTIFIED BY '换成你的强密码';
GRANT ALL PRIVILEGES ON meal_order.* TO 'meal_order'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> 应用本身也会在 `init-db` 时尝试建库，但生产环境建议先手动建好并授权最小权限。

## 3. 上传代码

在本地把整个项目传到服务器（任选其一）：

```bash
# 方式一：rsync（推荐，排除 node_modules）
rsync -avz --exclude node_modules --exclude .env ./ user@your-server:/srv/meal-order/

# 方式二：先在本地打 zip 再 scp 上去解压
```

创建运行用户并放权：

```bash
sudo useradd -r -s /usr/sbin/nologin mealorder
sudo mkdir -p /srv/meal-order/server/uploads
sudo chown -R mealorder:mealorder /srv/meal-order/server/uploads
```

## 4. 配置环境变量

```bash
cd /srv/meal-order/server
cp .env.example .env
# 生成 JWT 密钥
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
sudo nano .env
```

`.env` 关键项：

```ini
NODE_ENV=production
PORT=3000
TRUST_PROXY=true
CORS_ORIGINS=

DB_HOST=127.0.0.1
DB_USER=meal_order
DB_PASSWORD=第 2 步设置的密码
DB_NAME=meal_order

JWT_SECRET=刚才生成的长随机串

IMAGE_DIR=./uploads
IMAGE_URL_PREFIX=/uploads
MAX_UPLOAD_MB=8

ADMIN_USERNAME=admin
ADMIN_PASSWORD=首次登录用的强密码
ADMIN_DISPLAY_NAME=管理员
```

```bash
sudo chmod 600 /srv/meal-order/server/.env   # 内含密钥，禁止他人读取
```

## 5. 安装依赖并初始化数据库

```bash
cd /srv/meal-order/server
sudo -u mealorder npm ci --omit=dev     # 无 lock 文件时用 npm install --omit=dev
sudo -u mealorder npm run init-db       # 建表 + 默认分组 + 首个管理员
```

看到「全部完成 ✓」即成功。重复执行是安全的。

## 6. 配置 Nginx

```bash
sudo cp /srv/meal-order/deploy/nginx.conf /etc/nginx/conf.d/meal-order.conf
sudo nano /etc/nginx/conf.d/meal-order.conf   # 替换 meal.example.com 与 /srv/meal-order
```

首次还没有证书，先注释掉 `ssl_certificate` / `ssl_certificate_key` 两行，并临时删掉整个 443 server 块，只保留 80 端口，然后：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 7. 申请 HTTPS 证书

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d meal.example.com
```

certbot 会自动补回证书路径并配置好 80→443 跳转。验证续期：

```bash
sudo certbot renew --dry-run
```

## 8. 启动后端（systemd）

```bash
sudo cp /srv/meal-order/deploy/meal-order.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now meal-order
sudo systemctl status meal-order
```

## 9. 自检

```bash
curl -s http://127.0.0.1:3000/api/health          # {"ok":true,"data":{"status":"ok","db":"up"}}
curl -sI https://meal.example.com/                # 200，且是 index.html
curl -sI https://meal.example.com/uploads/        # 403/404 均正常（目录不可列）
```

浏览器打开 `https://meal.example.com`，用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录，先建分组与菜品、上传图片，再创建家人/厨师账号。

## 10. 日常运维

```bash
journalctl -u meal-order -f          # 实时日志
sudo systemctl restart meal-order    # 重启
sudo systemctl stop meal-order       # 停止
```

### 更新发版

```bash
cd /srv/meal-order
git pull                              # 或重新 rsync
cd server && sudo -u mealorder npm install --omit=dev
sudo systemctl restart meal-order
# 前端是纯静态，直接覆盖 web/ 即可，无需构建
```

### 备份

数据量很小，直接导出即可：

```bash
mysqldump -u meal_order -p meal_order > ~/meal_order-$(date +%F).sql
tar czf ~/uploads-$(date +%F).tgz -C /srv/meal-order/server uploads
```

建议加进 crontab 每天备份。

## 常见问题

| 现象 | 排查 |
| --- | --- |
| 打开页面 502 | 后端没起来：`systemctl status meal-order`、`journalctl -u meal-order -n 50` |
| 接口返回 `DB_NOT_READY` | 未执行 `npm run init-db` |
| 接口返回 `DB_UNAVAILABLE` | `.env` 里的数据库账号/密码不对，或 MySQL 未启动 |
| 登录提示「登录尝试过于频繁」 | 登录接口限流（15 分钟 10 次），等待或重启服务 |
| 图片 404 | `deploy/nginx.conf` 的 `alias` 路径与实际 `IMAGE_DIR` 不一致，或文件属主不是 `mealorder` |
| 上传图片返回 400 | 格式仅支持 jpg/png/webp，或超过 `MAX_UPLOAD_MB` |
| 发版后仍是旧页面 | `index.html` 被缓存：确认 Nginx 的 `location = /index.html` 未开启缓存 |
| 关闭浏览器后要求重新登录 | 正常，Token 默认 7 天（`JWT_EXPIRES_IN`） |

## 忘记管理员密码

```bash
cd /srv/meal-order/server
sudo -u mealorder node scripts/create-admin.js admin 新密码 管理员
sudo systemctl restart meal-order
```
