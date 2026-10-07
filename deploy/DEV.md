# 本地开发

无需构建步骤：后端 Express 直接托管 `web/` 静态文件，改完刷新浏览器即可。

图片默认存本地磁盘（`STORAGE_DRIVER=local`），不需要配 R2 就能开发。只有部署到 Render 时才需要切到 R2，见 [RENDER-AIVEN.md](./RENDER-AIVEN.md)。

## 1. 准备 MySQL

本地装好 MySQL 并启动，创建一个库和账号（或直接用 root）：

```sql
CREATE DATABASE IF NOT EXISTS meal_order
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'meal_order'@'localhost' IDENTIFIED BY 'devpass';
GRANT ALL PRIVILEGES ON meal_order.* TO 'meal_order'@'localhost';
FLUSH PRIVILEGES;
```

## 2. 配置 .env

```bash
cd server
cp .env.example .env
```

本地开发建议：

```ini
NODE_ENV=development
PORT=3000
DB_HOST=127.0.0.1
DB_USER=meal_order
DB_PASSWORD=devpass
DB_NAME=meal_order
JWT_SECRET=dev-secret-随便填-本地用
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
ADMIN_DISPLAY_NAME=管理员
```

## 3. 安装依赖并初始化

```bash
npm install
npm run init-db        # 建表 + 默认分组 + 管理员
```

输出「全部完成 ✓」即成功。

## 4. 启动

```bash
npm run dev            # node --watch，改后端自动重启
```

浏览器打开 http://localhost:3000 ，用 `admin` / `admin123` 登录。

> 因为 `NODE_ENV=development`，后端会顺带把 `web/` 也托管出去，所以前端和后端同源，不存在跨域问题。前端改动只需刷新页面。

## 5. 其他命令

```bash
npm run check                          # 全量 JS 语法检查（含 web/js）
npm run create-admin -- 用户名 密码      # 新建或重置管理员
curl http://localhost:3000/api/health   # 探活
```

## 目录速览

```
server/
  src/server.js           入口：中间件、限流、静态托管、路由挂载
  src/routes/             auth / menu / orders / summary / admin
  src/middleware/         auth（Token+角色）、upload（图片）、error
  src/utils/              http（响应与错误封装）、validate（参数校验）、shape（字段转换）
  schema.sql              建表语句
  scripts/                init-db / create-admin / check-syntax

web/
  index.html
  vendor/vue.global.prod.js   Vue 3 运行时（已内置，不依赖 CDN）
  css/style.css
  js/api.js               接口封装（注入 Token、统一解包）
  js/store.js             登录态
  js/router.js            hash 路由
  js/app.js               根组件（顶栏/底部导航/轻提示）
  js/pages/*.js           各页面组件
```

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `DB_NOT_READY` | 还没执行 `npm run init-db` |
| `DB_UNAVAILABLE` | MySQL 没起，或 `.env` 密码不对 |
| 端口被占用 | 改 `.env` 的 `PORT`，或用 `npx kill-port 3000` |
| 图片上传后 404 | 检查 `IMAGE_DIR` 是否存在，`server.js` 启动时会自动创建 |
| 页面白屏 | 打开浏览器控制台看报错；确认 `web/vendor/vue.global.prod.js` 存在 |
