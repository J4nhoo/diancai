# 部署到腾讯云 CloudBase 云托管 + Aiven + COS

**CloudBase 云托管**跑 Node 服务（容器）、**Aiven** 提供 MySQL、**腾讯云 COS** 存菜品图片。

> 为什么不用 Render：Render 免费档现在要求**绑信用卡**做身份验证（反滥用），没有卡就走不了。
> CloudBase 你已实名，不用绑卡。

> ⚠️ **本文档的控制台字段说明未能逐字核对官方文档**（编写环境的网络策略挡住了 docs.cloudbase.net）。
> 「容器/环境变量/端口」部分我有把握；**控制台里的按钮名称和字段位置请以界面为准**，我在每个不确定处标了 ⚠️。

---

## 前置：Aiven MySQL 与 COS

这两块与后端平台无关，先准备好。详见同目录 [RENDER-DEPLOY.md](./RENDER-DEPLOY.md) 的第 1、2 步：

- **Aiven MySQL**：Free 计划，抄下 Host / Port / User / Password，数据库用 `defaultdb`
- **腾讯云 COS**：建桶（访问权限选「**公有读私有写**」），抄下 SecretId / SecretKey / 完整桶名（带 APPID）/ 地域

拿到这两组信息后再回来做下面的事。

---

## 第 1 步：确认仓库里有 Dockerfile

本项目前端是纯静态、由 Node 一起托管，所以镜像里**必须同时包含 `server/` 和 `web/`**。
仓库根目录已经有 `Dockerfile` 和 `.dockerignore`，关键点：

- 构建上下文（build context）必须是**仓库根目录**，不是 `server/`
- 镜像内保持 `server/` 与 `web/` 的兄弟目录关系（代码按 `../web` 解析）
- 容器监听 **80** 端口

⚠️ **若控制台让你选 Dockerfile 路径或构建目录，请确认构建上下文是仓库根、Dockerfile 路径为 `/Dockerfile`。**

---

## 第 2 步：在 CloudBase 控制台创建环境与服务

1. 腾讯云控制台搜索 **云开发 CloudBase**，创建一个**环境**（按量计费或包年包月，按提示选）。
2. 进入 **云托管** → **新建服务**。
3. ⚠️ 部署方式按界面选 **代码包上传 / Git 仓库 / 本地代码** 之一。
   - **推荐 Git 仓库**：连上 `github.com/J4nhoo/diancai`，推代码即自动部署。
   - 若用代码包上传：把整个仓库（含 `Dockerfile`、`server/`、`web/`）打成 zip 上传。

4. 服务配置：

| 配置项 | 值 | 说明 |
|---|---|---|
| 服务名称 | `meal-order` | 随意 |
| Dockerfile 路径 | `/Dockerfile` | ⚠️ 以界面为准 |
| 构建上下文 | **仓库根目录** | ⚠️ 关键，填错则前端 404 |
| 容器端口 | **80** | ⚠️ 以界面为准；要与 Dockerfile 的 EXPOSE/ENV PORT 一致 |
| 最小实例数 | 0 或 1 | 见下方「冷启动」说明 |
| 最大实例数 | 1 | 自用小项目，1 个足够 |

---

## 第 3 步：配置环境变量

在服务的「环境变量」设置里逐条添加：

```
NODE_ENV        = production
TRUST_PROXY     = 1
AUTO_INIT_DB    = true

DB_HOST         = <Aiven Host>
DB_PORT         = <Aiven Port>
DB_USER         = avnadmin
DB_PASSWORD     = <Aiven Password>
DB_NAME         = defaultdb
DB_SSL          = true

JWT_SECRET      = <随机长串，见下>

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

`JWT_SECRET` 在本机生成：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**三个必须记住的点：**

1. **`TRUST_PROXY=1`，不要填 `true`** —— 布尔 true 会让 `req.ip` 可被客户端伪造，登录暴力破解限流失效。
2. **`AUTO_INIT_DB=true`** —— 容器平台没有 Shell 让你跑 `npm run init-db`，靠这个在启动时自动建表建种子（幂等）。
3. **`PORT` 一般不用设** —— 平台可能自己注入；若平台要求固定端口，就以控制台里「容器端口」的设置为准。

---

## 第 4 步：部署并看日志

触发部署后看服务日志，应出现：

```
[auto-init] 数据表创建完成
[auto-init] 管理员已创建：admin
[auto-init] 数据库自动初始化完成
[meal-order] 服务已启动 → http://0.0.0.0:80  (env=production)
[meal-order] 图片存储：cos
[meal-order] cos 存储校验通过
```

`cos 存储校验通过` 很关键 —— 它会**实际读一次公网地址**。如果 COS 桶权限不是「公有读私有写」，
这里会直接报 `写入成功但公网读取失败`，把问题在部署阶段暴露，而不是等你传完图才发现全是裂图。

---

## 第 5 步：对外开放访问

1. ⚠️ 在服务设置里找到**公网访问 / 默认域名**，开启后拿到一个 `https://xxx.service.tcloudbase.com` 之类的地址。
2. 用手机浏览器打开，应看到登录页。
3. ⚠️ 若想用自己域名 + HTTPS，在 **访问管理 / 域名配置** 里绑定；微信里打开需要 HTTPS。

---

## 第 6 步：验证

用 `admin` + `ADMIN_PASSWORD` 登录，然后：

1. 建分组（荤菜 / 素菜 / 汤 / 主食）
2. 新建菜品 → **传一张图**
3. 去 COS 桶确认出现 `dishes/2026-10/xxx.jpg`
4. 建一个家人账号、一个厨师账号，分别登录走一遍点菜 / 汇总

---

## 关于冷启动

CloudBase 按量计费下，**最小实例数设为 0 时会缩容到零**，下次访问有冷启动（几秒）。
自用场景可以接受；如果嫌慢，把最小实例数设为 1（会产生常驻费用）。

> 对比 Render 免费档的 50 秒冷启动，CloudBase 的几秒好得多。

---

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 构建失败，找不到 package.json | 构建上下文没设成仓库根，或 Dockerfile 路径不对 |
| 部署成功但页面 404 / 白屏 | 镜像里没有 `web/` 目录 —— 检查 `.dockerignore` 没把 `web/` 排除掉 |
| 所有接口 500 | `TRUST_PROXY` 填了 `true`，改成 `1` |
| `[auto-init] 自动初始化失败` | `DB_*` 配置有误，看具体报错；服务仍会启动 |
| `cos 存储校验失败` | SecretId/SecretKey/Bucket/Region 有误，或桶名漏了 APPID 后缀 |
| `写入成功但公网读取失败` | COS 桶权限不是「公有读私有写」 |
| 启动日志端口不对 | 控制台「容器端口」与 Dockerfile 的 `PORT` 不一致，改成 80 对齐 |
| `ER_NO_SUCH_TABLE` | `AUTO_INIT_DB` 没开，或自动初始化失败（看启动日志） |

## 忘记管理员密码

容器平台没有 Shell，在**本地**连 Aiven 执行：

```bash
cd server
DB_HOST=<Host> DB_PORT=<Port> DB_USER=avnadmin DB_PASSWORD=<密码> \
DB_NAME=defaultdb DB_SSL=true \
node scripts/create-admin.js admin 新密码 管理员
```
