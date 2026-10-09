# 部署到 CloudBase **HTTP 云函数**（免费版可用）+ Aiven + COS

用**免费版**的云函数跑后端。不用按量计费环境，不用信用卡。

> 前情：Render 要绑卡、Cloudflare R2 要绑卡、CloudBase 云托管要按量计费环境。
> 这条路是唯一不花钱且能跑通的。
> Aiven（MySQL）与腾讯云 COS（图片）与平台无关，见 [RENDER-DEPLOY.md](./RENDER-DEPLOY.md) 的第 1、2 步。

---

## ⚠️ 先读：三个必须知道的风险

### 1. MySQL 走 TCP 是平台的"例外路径"

CloudBase 官方文档把「用 `mysql2` 这类经典 TCP 客户端连 MySQL」标注为 **exception-only path**（例外路径），
平台期望你用它的原生 SDK。本项目正是 `mysql2` + 连接池。

**影响**：可能需要给函数绑定 **VPC** 才能访问数据库；而文档同时指出
「绑定 VPC 后，公网出口可能需要 NAT 网关」。

**当前判断**：Aiven 是**公网**地址（不是私有网络），所以**不绑 VPC、走公网出口**理论上能连通。
如果连不上，见文末「连不上 Aiven 怎么办」。

### 2. 连接池与函数实例数

本项目的 `db.js` 用了连接池（默认 10 条）。云函数按需扩容，
若并发实例多，总连接数 = 实例数 × 10，可能**打满 Aiven 免费档的连接上限**。

**缓解**：`DB_CONNECTION_LIMIT` 设小一点（本项目示例用 5）。
家庭自用并发极低，实际很难触发。

### 3. 每次调用结束进程不会退出

HTTP 云函数是常驻进程模型（靠 `scf_bootstrap` 拉起一个 Web 服务），
不是每次请求都重启，所以连接池能复用 —— 这点比事件函数好。

---

## 云函数的关键约束（踩了会静默失败）

| 约束 | 说明 |
|---|---|
| 必须监听 **9000** 端口 | CloudBase 约定。`scf_bootstrap` 里已兜底 `PORT=9000` |
| 必须有 **`scf_bootstrap`** | 文件名必须一字不差，**必须 LF 换行**，**必须可执行** |
| **函数类型创建后不可改** | 必须一开始就建成 **HTTP** 型，建成 Event 型就只能删掉重建 |
| HTTP 函数**不支持** `installDependency` | 必须**自带 `node_modules`**（打包脚本已处理） |
| 运行时要选 **Nodejs18.15** 或以上 | 与本地开发一致 |

---

## 第 1 步：准备 Aiven 与 COS

见 [RENDER-DEPLOY.md](./RENDER-DEPLOY.md)：

- **Aiven MySQL**：Free 计划 → 抄 Host / Port / Password（User 用 `avnadmin`，库名 `defaultdb`）
  > ⚠️ **服务类型务必选 MySQL，不要选 PostgreSQL**（Aiven 默认是 Postgres）。
  > 建错了的表现是：TCP 连上、TLS 握手成功，然后 MySQL 层永远 0 字节直到超时 ——
  > 因为 MySQL 是服务端先发问候包、Postgres 是客户端先发，双方互相等。
  > 详见 RENDER-DEPLOY.md 第 1 步的警告。
- **腾讯云 COS**：建桶（权限选「**公有读私有写**」）→ 抄 SecretId / SecretKey / 完整桶名 / 地域

再生成 JWT 密钥：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 第 2 步：打包函数代码

仓库已备好打包脚本：

```bash
bash deploy/cloudfunction/build.sh
```

它会产出 `deploy/cloudfunction/meal-order-api/`，包含：

```
meal-order-api/
├── scf_bootstrap     ← 启动文件（可执行 + LF）
├── server/           ← 后端源码 + 生产依赖 node_modules
└── web/              ← 前端静态文件（必须一起打包，云函数没有前置 Nginx）
```

> ⚠️ 为什么 `web/` 要打进包里：本项目前端由 Node 托管。`config.js` 的 `resolveWebDir()`
> 会自动在包内找 `server/web`。
>
> `deploy/cloudfunction/meal-order-api/` 已在 `.gitignore` 中，不会提交（含 node_modules）。

---

## 第 3 步：部署（两条路，选一条）

### 路线 A：tcb CLI（推荐）

CLI 会重新打包并**正确处理文件权限**，比手动压缩可靠。

```bash
npm i -g @cloudbase/cli
tcb login                      # 扫码登录
tcb env list                   # 查看你的环境 ID
tcb env use <你的环境ID>
tcb fn deploy meal-order-api --httpFn
```

> ⚠️ `--httpFn` 是关键 —— 不加会建成 Event 型函数，而**函数类型创建后不可更改**。

环境变量若不想写进文件，可先复制配置模板：

```bash
cp deploy/cloudfunction/cloudbaserc.example.json cloudbaserc.json
# 填好真实值（cloudbaserc.json 已在 .gitignore，不会提交）
```

然后 `tcb fn deploy meal-order-api --httpFn` 会读取该配置。

> ⚠️ 环境变量更新是**全量覆盖**不是合并 —— 少写一个就会删掉一个。
> 改动前先 `tcb fn detail meal-order-api` 看现有值。

### 路线 B：控制台手动上传

1. 把 `deploy/cloudfunction/meal-order-api/` 整个目录压缩成 zip
2. 云开发控制台 → **云函数** → **新建函数** → 类型选 **HTTP 函数**
3. 运行时选 **Nodejs18.15**，上传 zip
4. 在函数的「环境变量」里逐条填（见下）

> ⚠️ **不要用 Windows 自带压缩 / PowerShell 的 `Compress-Archive`** ——
> 它们**不保留 Linux 可执行位**，`scf_bootstrap` 到云端会变成不可执行，然后静默启动失败。
> 如果只有这些工具，用 Git Bash 里的 `zip`，或干脆走路线 A。

---

## 第 4 步：环境变量

无论哪条路，最终这些变量都要在云端生效：

```
NODE_ENV        = production
PORT            = 9000
TRUST_PROXY     = 1
AUTO_INIT_DB    = true

DB_HOST         = <Aiven Host>
DB_PORT         = <Aiven Port>
DB_USER         = avnadmin
DB_PASSWORD     = <Aiven Password>
DB_NAME         = defaultdb
DB_SSL          = true
DB_CONNECTION_LIMIT = 5

JWT_SECRET      = <随机长串>

STORAGE_DRIVER     = cos
MAX_UPLOAD_MB      = 8
COS_SECRET_ID      = <SecretId>
COS_SECRET_KEY     = <SecretKey>
COS_BUCKET         = meal-images-1250000000
COS_REGION         = ap-guangzhou

ADMIN_USERNAME     = admin
ADMIN_PASSWORD     = <你自己定的登录密码>
ADMIN_DISPLAY_NAME = 管理员
```

**要点：**

- `PORT=9000` —— HTTP 云函数必须监听此端口（`scf_bootstrap` 里也兜底了）
- `TRUST_PROXY=1`，**不要填 `true`**
- `AUTO_INIT_DB=true` —— 云函数没有 Shell，靠它在首次启动时建表建种子（幂等）

---

## 第 5 步：看日志

部署后调用一次，看日志应出现：

```
[auto-init] 数据表创建完成
[auto-init] 管理员已创建：admin
[auto-init] 数据库自动初始化完成
[meal-order] 服务已启动 → http://0.0.0.0:9000  (env=production)
[meal-order] 前端目录：/var/user/web
[meal-order] cos 存储校验通过
```

CLI 看日志：`tcb fn log meal-order-api`

---

## 第 6 步：拿到访问地址

HTTP 云函数创建后会分配一个访问地址（形如 `https://xxx.service.tcloudbase.com/...`）。
在函数详情页的「**访问服务 / 触发路径**」里能看到。

手机浏览器打开该地址，应看到登录页。

---

## 第 7 步：验证

用 `admin` + `ADMIN_PASSWORD` 登录 → 建分组 → 建菜品 + **传图** → 去 COS 桶确认出现
`dishes/2026-10/xxx.jpg` → 建家人与厨师账号走一遍点菜 / 汇总。

---

## 连不上 Aiven 怎么办

如果日志里出现 `DB_UNAVAILABLE` 或连接超时：

1. **先确认 Aiven 服务在运行**（免费档长期不用可能被回收）
2. **确认 `DB_SSL=true`** —— Aiven 强制 TLS，不开必失败
3. **若仍连不上**：云函数的公网出口可能被限制。此时要给函数绑定 **VPC** 并配 **NAT 网关**
   （会产生少量费用，且需要知道 VPC ID / 子网 ID —— 这些我不能替你猜，要从腾讯云控制台读）。
   ⚠️ 注意：**Aiven 在公网、不在你的腾讯云 VPC 里**，绑 VPC 主要是为了拿到公网出口，
   这条路要额外配 NAT，属于进阶操作。
4. **替代方案**：如果云函数始终连不通 Aiven，考虑把 MySQL 换成腾讯云自己的数据库，
   或者退回到轻量应用服务器（VPS）方案，见 [DEPLOY.md](./DEPLOY.md)。

---

## 常见问题

| 现象 | 原因 |
|---|---|
| 函数启动失败，无日志 | `scf_bootstrap` 换行符是 CRLF，或缺执行权限 |
| 函数启动失败，`MODULE_NOT_FOUND` | 没把 `node_modules` 打进包（HTTP 函数不支持自动装依赖） |
| 页面 404 / 白屏 | 包里缺 `web/` 目录 |
| 建成了 Event 函数 | 部署时漏了 `--httpFn`；**类型不可改，只能删掉重建** |
| `Task timed out` | 超时设置太短，调到 60 秒 |
| `ER_NO_SUCH_TABLE` | `AUTO_INIT_DB` 没开，或自动初始化失败（看日志 `[auto-init]` 行） |
| `cos 存储校验失败` | COS 密钥/桶名有误，或桶名漏了 APPID 后缀 |
| `写入成功但公网读取失败` | COS 桶权限不是「公有读私有写」 |
| 所有接口 500 | `TRUST_PROXY` 填了 `true`，改 `1` |
