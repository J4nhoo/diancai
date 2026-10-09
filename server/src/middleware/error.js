'use strict';

const multer = require('multer');
const { HttpError } = require('../utils/http');
const config = require('../config');

function notFoundHandler(req, res) {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? '图片体积超出限制' : '图片上传失败';
    return res.status(400).json({ ok: false, error: { code: 'UPLOAD_ERROR', message } });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
  }

  // 存储错误靠 storage.js 打的 isStorageError 标记识别，不靠错误码猜测。
  // 必须排在数据库判断【之前】：MySQL 和对象存储都会抛 ETIMEDOUT / ENOTFOUND，
  // 若反过来的话，COS 超时会被误报成"数据库连接超时"。
  // 这类错误（桶不存在 / 密钥错 / 权限不足）信息具体且不泄密，直接告诉调用方，
  // 免得被通用 500 吞掉、排查时只能翻日志。
  if (err && err.isStorageError) {
    const code = err.code || err.name || 'STORAGE_ERROR';
    console.error('[storage]', code, err.message);
    return res.status(502).json({
      ok: false,
      error: { code: 'STORAGE_ERROR', message: describeStorageError(code) },
    });
  }

  if (err && err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ ok: false, error: { code: 'CONFLICT', message: '数据已存在，请检查是否重复' } });
  }

  if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_DB_ERROR')) {
    console.error('[db]', err.message);
    return res.status(500).json({
      ok: false,
      error: { code: 'DB_NOT_READY', message: '数据库尚未初始化，请先执行 npm run init-db' },
    });
  }

  if (
    err &&
    (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ETIMEDOUT')
  ) {
    console.error('[db]', err.code, err.message);
    return res.status(503).json({
      ok: false,
      error: { code: 'DB_UNAVAILABLE', message: '数据库连接失败或超时，请检查数据库是否可访问' },
    });
  }

  console.error('[error]', err);
  return res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
      ...(config.isProd ? {} : { detail: String(err && err.message) }),
    },
  });
}

const STORAGE_MESSAGES = {
  NoSuchBucket: '对象存储桶不存在，请检查 COS_BUCKET（需带 APPID 后缀）',
  AccessDenied: '对象存储拒绝访问，请检查密钥是否具备该桶的读写权限',
  SignatureDoesNotMatch: '对象存储密钥错误（SecretKey 不正确）',
  InvalidAccessKeyId: '对象存储的 SecretId 无效',
  InvalidBucketName: '对象存储桶名格式不正确',
  ENOTFOUND: '对象存储域名解析失败，请检查网络与配置',
  ETIMEDOUT: '连接对象存储超时',
};

/** 把存储 SDK 的错误码翻译成可读的中文提示，未知码回退为通用提示 */
function describeStorageError(code) {
  return STORAGE_MESSAGES[code] || `对象存储操作失败（${code}）`;
}

module.exports = { notFoundHandler, errorHandler };
