'use strict';

/** 图片文件名与类型白名单，local / r2 两个驱动共用 */

const path = require('path');
const crypto = require('crypto');

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function extOf(originalname) {
  return path.extname(originalname || '').toLowerCase();
}

/**
 * 生成对象键：dishes/2026-10/1728..._ab12cd.jpg
 * 完全丢弃客户端文件名，只保留白名单内的扩展名。
 */
function makeKey(originalname) {
  const ext = extOf(originalname);
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `dishes/${ym}/${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
}

module.exports = { ALLOWED_EXT, ALLOWED_MIME, extOf, makeKey };
