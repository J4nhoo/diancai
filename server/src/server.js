'use strict';

const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const storage = require('./storage');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/error');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// 同源部署（Nginx 同时托管前端与反代 API）时无需跨域。
// 只有显式配置了 CORS_ORIGINS 才启用，避免多引一个依赖。
if (config.corsOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });
}

// 登录接口严格限流，防暴力破解
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: '登录尝试过于频繁，请稍后再试' } },
});

// 其余接口通用限流
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } },
});

app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);

// 图片静态托管：仅 local 驱动需要（生产由 Nginx 托管，本地开发由 Express 托管）。
// r2 驱动下图片由 R2 公网域名提供，这里不挂载。
if (storage.shouldServeStatic()) {
  storage.ensureDir();
  app.use(
    config.upload.urlPrefix,
    express.static(config.upload.dir, { maxAge: '7d', index: false, fallthrough: true })
  );
}

app.use('/api', routes);

// 托管前端。Nginx 部署时 Nginx 会直接命中静态文件、不会走到这里；
// Render 等没有前置 Nginx 的平台则依赖这里。
app.use(express.static(config.webDir, { index: 'index.html' }));
// SPA 回退：Express 5 不再支持 app.get('*')，用普通中间件处理
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return next();
  if (req.path.startsWith(config.upload.urlPrefix)) return next();
  return res.sendFile(path.join(config.webDir, 'index.html'), (err) => (err ? next() : undefined));
});

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  // 托管平台（Render 免费档）没有 Shell，用 AUTO_INIT_DB=true 在启动时自动建表。
  // 失败只记日志不阻断启动，避免数据库临时抖动导致服务反复重启、更难排查。
  if (config.autoInitDb) {
    try {
      await require('./bootstrap').run((msg) => console.log(`[auto-init] ${msg}`));
      console.log('[auto-init] 数据库自动初始化完成');
    } catch (err) {
      console.error('[auto-init] 自动初始化失败：', err.message);
      console.error('[auto-init] 服务仍会启动，请检查 DB_* 配置，或手动执行 npm run init-db');
    }
  }

  const server = app.listen(config.port, () => {
    console.log(`[meal-order] 服务已启动 → http://127.0.0.1:${config.port}  (env=${config.env})`);
    console.log(`[meal-order] 图片存储：${storage.name}${storage.shouldServeStatic() ? `（${config.upload.dir}）` : ''}`);
    console.log(`[meal-order] 前端目录：${config.webDir}`);
    if (typeof storage.verify === 'function') {
      storage
        .verify()
        .then(() => console.log(`[meal-order] ${storage.name} 存储校验通过`))
        .catch((err) => console.error(`[meal-order] ${storage.name} 存储校验失败：`, err.message));
    }
  });

  function shutdown(signal) {
    console.log(`[meal-order] 收到 ${signal}，正在关闭...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

start();

module.exports = app;
