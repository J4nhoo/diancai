# 部署到 Render + Aiven + Cloudflare R2（免费路线）

全部免费额度内：**Render** 跑 Node 服务、**Aiven** 提供 MySQL、**Cloudflare R2** 存菜品图片。

> 为什么不把图片放 Render：免费档的磁盘是**临时的**，每次重新部署或休眠回收后文件都没了，而库里还留着 URL，菜图会全部变裂图。所以图片必须放外部存储。

三者的免费额度对本项目都绰绰有余（1 个月约 180 张压缩后图片 ≈ 50MB，R2 免费 10GB）。

---

## 第 0 步：代码准备

把代码推到 Git 仓库（GitHub / GitLab 均可），Render 从仓库部署。

确认仓库里**没有** `.env`（它含密钥，已在 `.gitignore` 里）。仓库结构：

```
server/    ← 后端
web/       ← 前端（Render 会一起部署，由 Node 托管）
deploy/
```

---

## 第 1 步：Aiven MySQL

1. 注册 https://aiven.io ，新建 **MySQL** 服务。选 **Free** 计划，区域就近（如 `google-asia-east1`）。
2. 等服务变成 Running（约 2-5 分钟），在 **Overview** 页记下：
   - `Host`、`Port`、`User`（默认 `avnadmin`）、`Password`
   - **默认数据库是 `defaultdb`**（免费档不能自己建库，所以直接用 `defaultdb`）
3. 下载 **CA Certificate**（或直接信任，见下）。

> **关于证书**：Aiven 用受信任 CA 签发证书，Node 自带的根证书库能验通，所以 `DB_SSL_REJECT_UNAUTHORIZED=true` 通常可以直接用，不需要下载 CA 文件。若遇到 `self signed certificate` 报错，再改成 `false`。

---

## 第 2 步：Cloudflare R2

1. 登录 Cloudflare → **R2** → **Create bucket**，名字如 `meal-images`。
2. 桶的 **Settings** → **Public access** → 允许公开访问，拿到形如
   `https://pub-xxxxxxxxxxxx.r2.dev` 的公网地址（也可绑自己的域名，更快且不被限速）。
3. 右上角 **Manage R2 API Tokens** → **Create API Token**：
   - 权限选 **Object Read & Write**
   - 可限定只能访问 `meal-images` 这个桶
   - 创建后记下 **Access Key ID** 和 **Secret Access Key**（Secret 只显示一次）
4. 记下账户 ID（在 R2 概览页右侧，或 API Token 页面会带出）。

---

## 第 3 步：Render Web Service

1. 注册 https://render.com ，**New** → **Web Service**，连上你的 Git 仓库。
2. 填写：

| 项 | 值 |
| --- | --- |
| Name | `meal-order`（随意） |
| Region | 选离你和 Aiven 都近的，如 Singapore |
| **Root Directory** | `server` |
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Instance Type | **Free** |
| Health Check Path | `/api/health` |

> Root Directory 填 `server` 之后，代码里的 `web/` 相对路径是 `../web` —— Render 会把整个仓库都克隆下来，所以前端文件在，Node 会顺带把 `web/` 托管出去，不需要单独搞静态站点。**因此不需要 `CORS_ORIGINS`，前端后端同源。**

3. **Environment** 页添加环境变量（`Render 会从环境变量读，不需要 .env 文件`）：

```ini
NODE_ENV=production
# 填 1（跳数），不要填 true
TRUST_PROXY=1
CORS_ORIGINS=

DB_HOST=<Aiven 的 Host>
DB_PORT=<Aiven 的 Port>
DB_USER=avnadmin
DB_PASSWORD=<Aiven 的 Password>
DB_NAME=defaultdb
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true
DB_CONNECTION_LIMIT=5

JWT_SECRET=<随机长字符串，见下>
JWT_EXPIRES_IN=7d

# 启动时自动建表建种子（幂等）。Render 免费档没有 Shell，靠这个省掉手工初始化。
AUTO_INIT_DB=true

STORAGE_DRIVER=r2
MAX_UPLOAD_MB=8
R2_ACCOUNT_ID=<你的账户 ID>
R2_ACCESS_KEY_ID=<R2 Access Key>
R2_SECRET_ACCESS_KEY=<R2 Secret>
R2_BUCKET=meal-images
R2_PUBLIC_BASE_URL=https://pub-xxxxxxxxxxxx.r2.dev

ADMIN_USERNAME=admin
ADMIN_PASSWORD=<首次登录用的强密码>
ADMIN_DISPLAY_NAME=管理员
```

生成 `JWT_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

4. 点 **Deploy**。等构建完成，日志里应出现：

```
[meal-order] 服务已启动 → http://127.0.0.1:10000  (env=production)
[meal-order] 图片存储：r2
[meal-order] 前端目录：/opt/render/project/src/web
[meal-order] R2 连接校验通过
```

`R2 连接校验通过` 很关键 —— 它说明 R2 配置正确。若打印失败，先解决再往下走。

---

## 第 4 步：初始化数据库（已自动化）

因为上面配了 `AUTO_INIT_DB=true`，服务第一次启动时会自动建表、建种子分组、建首个管理员，
日志里会出现：

```
[auto-init] 数据表创建完成
[auto-init] 默认分组已就绪（荤菜 / 素菜 / 汤 / 主食）
[auto-init] 管理员已创建：admin
[auto-init] 数据库自动初始化完成
```

这一步是幂等的，重复部署不会破坏数据。**正常情况下你不需要做任何手工操作。**

如果日志里出现 `[auto-init] 自动初始化失败`，说明 `DB_*` 配置有问题，按报错信息检查（服务本身仍会启动，不会反复重启）。

若想手动重跑，在本地连 Aiven 执行（Aiven 公网可达）：

```bash
cd server
DB_HOST=<Aiven Host> DB_PORT=<Port> DB_USER=avnadmin \
DB_PASSWORD=<密码> DB_NAME=defaultdb DB_SSL=true \
npm run init-db
```

---

## 第 5 步：验证

```bash
curl -s https://<你的服务>.onrender.com/api/health
# {"ok":true,"data":{"status":"ok","db":"up"}}
```

浏览器打开服务地址，用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录，然后：

1. 建分组（如「荤菜 / 素菜 / 汤 / 主食」）
2. 新建菜品，**传一张图** —— 传完在菜品列表里应能立刻看到图
3. 到 R2 控制台确认桶里出现了 `dishes/2026-10/xxx.jpg`
4. 建一个家人账号、一个厨师账号，分别登录走一遍点菜 / 汇总

---

## 第 6 步：防止免费档休眠（重要）

Render 免费档**空闲 15 分钟就休眠**，下次访问要等约 50 秒冷启动。你这个应用一天只用几次，等于每次打开都要先愣一分钟，体验很差。

解法：挂个免费定时器每 10 分钟打一次健康检查，把实例"顶"住不睡。免费档给 750 实例小时/月，单实例 24 小时常驻约 730 小时，刚好够。

任选其一：

- https://cron-job.org —— 新建任务，URL 填 `https://<你的服务>.onrender.com/api/health`，间隔 10 分钟
- https://uptimerobot.com —— 新建 HTTP(s) 监控，同样 10 分钟间隔

> 顺带好处：这个监控还能在你服务挂掉时发邮件告警。

---

## 更新发版

推代码到 Git 仓库，Render 自动重新部署。前端是纯静态文件，一起打包进去了，**没有独立构建步骤**。

---

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 启动/请求日志反复出现 `ERR_ERL_PERMISSIVE_TRUST_PROXY` | `TRUST_PROXY` 填了 `true`。改成 `1`。功能上不致命，但登录限流会被伪造 IP 绕过 |
| 启动日志 `R2 连接校验失败` | Key/Secret/Bucket/AccountId 有一项填错，或 Token 权限不是 Object Read & Write |
| 图片上传成功但显示裂图 | `R2_PUBLIC_BASE_URL` 不对，或桶没开启公共访问。在浏览器直接打开图片 URL 验证 |
| `DB_UNAVAILABLE` | Aiven 服务在休眠/已删除，或 `DB_SSL` 没开 |
| `self signed certificate` | 把 `DB_SSL_REJECT_UNAUTHORIZED` 改成 `false` |
| `ER_NO_SUCH_TABLE` | `AUTO_INIT_DB` 没开，或自动初始化失败（看启动日志的 `[auto-init]` 行） |
| 第一次打开要等 1 分钟 | 免费档冷启动，按第 6 步挂定时器即可避免 |
| 登录提示「尝试过于频繁」 | 登录限流 15 分钟 10 次，等待即可 |
| 图片几个月后消失 | R2 免费额度内不会；检查 R2 桶是否被清理，或账号是否超额 |

## 忘记管理员密码

免费档没有 Shell，所以**在本地连 Aiven 执行**（Aiven 公网可达）：

```bash
cd server
DB_HOST=<Aiven Host> DB_PORT=<Port> DB_USER=avnadmin \
DB_PASSWORD=<密码> DB_NAME=defaultdb DB_SSL=true \
node scripts/create-admin.js admin 新密码 管理员
```

改完该账号的旧登录状态会失效，需重新登录。
