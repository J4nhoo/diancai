# 部署到腾讯云轻量服务器（香港 · 纯 IP 访问）

**目标**：一台常开的云服务器，自带 MySQL，公网可访问。不用备案、不用内网穿透、不用开自己电脑。

预计耗时：**20 分钟**（其中大部分是等系统装软件）。

---

## 为什么是这条路

之前试过的方案都不合适：

| 方案 | 问题 |
|---|---|
| Render | 免费档要绑信用卡 |
| Cloudflare R2 | 要绑信用卡 |
| CloudBase 云函数 | 默认域名有「测试域名」警告页，去不掉 |
| CloudBase 云托管 | 要按量计费环境 |
| Aiven 免费 MySQL | 闲置会被回收，域名直接消失 |
| 本机跑 | 只能用同一个 WiFi，电脑不能关 |

香港轻量服务器绕开了全部问题：微信/支付宝付款、不用备案、买完当天能用。

**代价**：没有域名就是 `http://数字IP`，浏览器会标「不安全」，微信里可能提示「非官方网页」。接受即可；以后想消除，加个域名配 HTTPS 就行。

---

## 第 1 步：买服务器

腾讯云 → **轻量应用服务器** → **新建**

| 选项 | 填什么 |
|---|---|
| 地域 | **中国香港**（或新加坡） |
| 镜像 | **Ubuntu Server 22.04 LTS** |
| 套餐 | 2核2G / 40GB SSD 够用 |
| 时长 | 新用户通常有首年优惠 |

买完记下**公网 IP**，并在控制台重置 root 密码（或上传 SSH 密钥）。

---

## 第 2 步：放行 80 端口（**容易忘**）

轻量服务器默认只开了 22 端口。

控制台 → 你的服务器 → **防火墙** → **添加规则**：

- 应用类型：`HTTP (80)`
- 协议：TCP
- 端口：80
- 来源：`0.0.0.0/0`

保存。

> 不开这一步，后面部署完会发现外网打不开，很难查。

---

## 第 3 步：传代码

在**你自己的电脑**上执行（Git Bash / WSL / macOS 终端）：

```bash
# 把整个项目传到服务器（必须包含 deploy/ 目录，部署脚本要用）
rsync -avz --exclude node_modules --exclude .env --exclude uploads \
  ./ root@<服务器IP>:/srv/meal-order/
```

如果没有 rsync，可以先用 tar 打包再 scp：

```bash
# 本地打包（排除 node_modules、.env、本地上传的图片）
tar --exclude=node_modules --exclude=.env --exclude=uploads \
    --exclude=.git --exclude=.backups \
    -czf meal-order.tar.gz .
# 上传
scp meal-order.tar.gz root@<服务器IP>:/tmp/
# 服务器上解压
ssh root@<服务器IP>
mkdir -p /srv/meal-order && tar -xzf /tmp/meal-order.tar.gz -C /srv/meal-order
```

> ⚠️ **`.env` 不要传**（含本机数据库密码和密钥），服务器上的 `.env` 由部署脚本重新生成。

---

## 第 4 步：一键部署

```bash
ssh root@<服务器IP>
sudo bash /srv/meal-order/deploy/install.sh
```

脚本会自动完成：

1. 装 Node 20 / MySQL / Nginx
2. 建数据库、生成随机密码
3. 生成 `.env`（含随机 JWT 密钥）
4. 装依赖、建表、跑迁移、建管理员
5. 配 Nginx（80 端口 + 反代 API + 托管前端）
6. 配 systemd 开机自启
7. 打印访问地址和 admin 初始密码

跑完会看到：

```
==================================================
  部署完成
==================================================
  访问地址：  http://1.2.3.4

  管理员账号：admin
  管理员密码：xxxxxxxxxxxxxxxx
==================================================
```

**把这行密码记下来**（也可以 `cat /srv/meal-order/server/.env` 查看）。

---

## 第 5 步：验证

手机上用**移动数据**（不要连 WiFi）打开 `http://<服务器IP>`：

1. 应该看到登录页
2. 用 admin + 脚本打印的密码登录
3. 建一个家人账号和一个厨师账号试试

如果能打开，就成功了 —— 这台服务器 24 小时在线，你电脑关机也不影响。

---

## 第 6 步：配置图片存储

部署脚本默认 `STORAGE_DRIVER=local`，图片存服务器磁盘（`/srv/meal-order/server/uploads`），由 Nginx 托管。

**也可以用腾讯云 COS**（你之前已经建好了桶）：

```bash
nano /srv/meal-order/server/.env
```

改这几行：

```ini
STORAGE_DRIVER=cos
COS_SECRET_ID=<你的 SecretId>
COS_SECRET_KEY=<你的 SecretKey>
COS_BUCKET=meal-images-1404821677
COS_REGION=ap-guangzhou
```

然后：

```bash
systemctl restart meal-order
journalctl -u meal-order -n 20 --no-pager    # 应看到「cos 存储校验通过」
```

> 用 local 也完全够用（几十张图才几 MB），而且少一个依赖。两者都行。

---

## 日常运维

```bash
# 看日志（实时）
journalctl -u meal-order -f

# 重启后端
systemctl restart meal-order

# 改代码后更新
cd /srv/meal-order
rsync -avz --exclude node_modules --exclude .env ./ root@<IP>:/srv/meal-order/
# 服务器上：
cd /srv/meal-order/server && npm ci --omit=dev && npm run init-db
systemctl restart meal-order

# 备份数据库
mysqldump -u meal_order -p meal_order > ~/backup-$(date +%F).sql
```

> `npm run init-db` 会**自动执行未应用的迁移**（幂等），所以改表结构后部署不必手动跑迁移。

---

## 常见问题

| 现象 | 原因 |
|---|---|
| 外网打不开，但 `curl 127.0.0.1` 正常 | **腾讯云防火墙没放行 80**（第 2 步） |
| 页面打开是 502 | 后端没起来：`journalctl -u meal-order -n 50` |
| 页面打开是 Nginx 默认页 | `sites-enabled/default` 没删掉，重跑 install.sh |
| `DB_NOT_READY` | 没跑 `npm run init-db` |
| 图片上传后 404 | 用的是 local 存储但 `uploads` 目录权限不对；或用了 COS 但配置有误 |
| 微信提示「非官方网页」 | 纯 IP + HTTP 的固有限制，加域名 + HTTPS 才能消除 |

---

## 以后想加域名

服务器在香港，**不需要备案**：

1. Cloudflare 买域名（约 ¥60/年）
2. DNS 加一条 A 记录指向服务器 IP
3. `apt install certbot python3-certbot-nginx`
4. `certbot --nginx -d 你的域名`
5. Nginx 配置里的 `server_name _` 改成你的域名

大约 15 分钟，之后链接变成 `https://你的域名`，微信里也不会有提示了。
