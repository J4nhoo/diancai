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

  if (err && (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR')) {
    console.error('[db]', err.message);
    return res.status(503).json({ ok: false, error: { code: 'DB_UNAVAILABLE', message: '数据库连接失败' } });
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

module.exports = { notFoundHandler, errorHandler };
