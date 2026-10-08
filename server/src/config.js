'use strict';

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const rootDir = path.resolve(__dirname, '..');

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * trust proxy 可以是布尔值，也可以是代理跳数（如 Render 前面只有一层代理，填 1）。
 * 不要用 true：那会让 Express 信任整条 X-Forwarded-For 链，req.ip 变成客户端可伪造的值，
 * 从而绕过基于 IP 的限流（尤其是登录暴力破解防护），并且每个请求都会记一条
 * ERR_ERL_PERMISSIVE_TRUST_PROXY 错误日志。所以先解析数字：'1' -> 1（跳数）。
 */
function trustProxy(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const raw = String(value).trim().toLowerCase();
  if (['false', 'no', 'off'].includes(raw)) return false;
  if (['true', 'yes', 'on'].includes(raw)) return true;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const imageDir = path.resolve(rootDir, process.env.IMAGE_DIR || './uploads');

const storageDriver = (process.env.STORAGE_DRIVER || 'local').trim().toLowerCase();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  trustProxy: trustProxy(process.env.TRUST_PROXY, 1),
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'meal_order',
    connectionLimit: int(process.env.DB_CONNECTION_LIMIT, 10),
    // Aiven 等托管数据库强制 TLS，必须开启
    ssl: bool(process.env.DB_SSL, false),
    sslRejectUnauthorized: bool(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  upload: {
    dir: imageDir,
    // 仅 local 驱动会用到；r2 驱动下图片由 R2 的公网域名提供
    urlPrefix: (process.env.IMAGE_URL_PREFIX || '/uploads').replace(/\/+$/, ''),
    maxBytes: int(process.env.MAX_UPLOAD_MB, 8) * 1024 * 1024,
  },

  storage: {
    driver: storageDriver,
    r2: {
      accountId: process.env.R2_ACCOUNT_ID || '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      bucket: process.env.R2_BUCKET || '',
      // 形如 https://pub-xxxx.r2.dev 或自定义域名，末尾不要带斜杠
      publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    },
    cos: {
      secretId: process.env.COS_SECRET_ID || '',
      secretKey: process.env.COS_SECRET_KEY || '',
      // 桶名要带 APPID 后缀，形如 meal-images-1250000000
      bucket: process.env.COS_BUCKET || '',
      // 形如 ap-guangzhou / ap-shanghai
      region: process.env.COS_REGION || '',
      // 留空则用默认域名 https://<bucket>.cos.<region>.myqcloud.com
      // 绑定了 CDN 加速域名后填这里，末尾不带斜杠
      publicBaseUrl: (process.env.COS_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    },
  },

  rootDir,
  webDir: path.resolve(rootDir, '..', 'web'),

  // 启动时自动建表建种子（幂等）。托管平台没有 Shell 时用它省掉手工跑 init-db。
  autoInitDb: bool(process.env.AUTO_INIT_DB, false),

  initAdmin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
    displayName: process.env.ADMIN_DISPLAY_NAME || '管理员',
  },
};

config.isProd = config.env === 'production';

if (config.isProd && config.jwt.secret === 'dev-only-insecure-secret') {
  throw new Error('生产环境必须配置 JWT_SECRET，请参考 .env.example');
}

if (!['local', 'r2', 'cos'].includes(config.storage.driver)) {
  throw new Error(`STORAGE_DRIVER 只能是 local / r2 / cos，当前为：${config.storage.driver}`);
}

if (config.storage.driver === 'r2') {
  const r2 = config.storage.r2;
  const missing = ['accountId', 'accessKeyId', 'secretAccessKey', 'bucket', 'publicBaseUrl'].filter(
    (k) => !r2[k]
  );
  if (missing.length) {
    throw new Error(
      `STORAGE_DRIVER=r2 时必须配置：${missing.join(', ')}（请参考 .env.example）`
    );
  }
}

if (config.storage.driver === 'cos') {
  const cos = config.storage.cos;
  const missing = ['secretId', 'secretKey', 'bucket', 'region'].filter((k) => !cos[k]);
  if (missing.length) {
    throw new Error(
      `STORAGE_DRIVER=cos 时必须配置：${missing.join(', ')}（请参考 .env.example）`
    );
  }
}

module.exports = config;
