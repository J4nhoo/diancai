'use strict';

/** 本地磁盘驱动：图片落到 upload.dir，由 Express（开发）或 Nginx（生产）托管 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { makeKey, extOf, ALLOWED_EXT } = require('./naming');

function ensureDir() {
  fs.mkdirSync(config.upload.dir, { recursive: true });
}

// key 形如 dishes/2026-10/xxx.jpg，落盘时把目录也建出来
function absPath(key) {
  const abs = path.resolve(config.upload.dir, key);
  const root = path.resolve(config.upload.dir);
  if (!abs.startsWith(root + path.sep)) {
    throw new Error('非法的存储路径');
  }
  return abs;
}

async function put(file) {
  const ext = extOf(file.originalname);
  if (!ALLOWED_EXT.has(ext)) throw new Error('不支持的图片格式');

  const key = makeKey(file.originalname);
  const abs = absPath(key);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, file.buffer);

  // local 驱动把 key 当作 URL 路径，对外仍是 /uploads/...
  return { url: `${config.upload.urlPrefix}/${key}`, key };
}

/** 只删除本服务 urlPrefix 下的文件，且强制取 basename，防目录穿越 */
async function remove(url) {
  if (typeof url !== 'string' || !url) return false;
  const prefix = `${config.upload.urlPrefix}/`;
  if (!url.startsWith(prefix)) return false;

  // 兼容旧的平铺文件名与新的 dishes/年-月/ 子目录
  const rel = url.slice(prefix.length).split('/').filter((s) => s && s !== '.' && s !== '..');
  if (!rel.length) return false;

  const abs = path.resolve(config.upload.dir, ...rel);
  const root = path.resolve(config.upload.dir);
  if (!abs.startsWith(root + path.sep)) return false;

  try {
    fs.unlinkSync(abs);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/** 本地驱动需要把 upload.dir 暴露成静态目录 */
function shouldServeStatic() {
  return true;
}

/** 判断某个图片 URL 是否由本驱动管理（写库前校验，拒绝外链） */
function isManaged(url) {
  return typeof url === 'string' && url.startsWith(`${config.upload.urlPrefix}/`);
}

module.exports = { name: 'local', ensureDir, put, remove, shouldServeStatic, isManaged };
