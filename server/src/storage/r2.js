'use strict';

/** Cloudflare R2 驱动（S3 兼容 API）。图片由 R2 的公网域名直接提供，不经本服务。 */

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const config = require('../config');
const { makeKey, extOf, ALLOWED_EXT } = require('./naming');

const r2 = config.storage.r2;

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: r2.accessKeyId,
    secretAccessKey: r2.secretAccessKey,
  },
});

const CONTENT_TYPE = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

async function put(file) {
  const ext = extOf(file.originalname);
  if (!ALLOWED_EXT.has(ext)) throw new Error('不支持的图片格式');

  const key = makeKey(file.originalname);
  await client.send(
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: CONTENT_TYPE[ext] || 'application/octet-stream',
      // 文件名自带随机串，内容不会变，可长期缓存
      CacheControl: 'public, max-age=2592000',
    })
  );

  return { url: `${r2.publicBaseUrl}/${key}`, key };
}

async function remove(url) {
  if (typeof url !== 'string' || !url.startsWith(`${r2.publicBaseUrl}/`)) return false;

  const key = url.slice(r2.publicBaseUrl.length + 1);
  if (!key || key.includes('..')) return false;

  await client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
  return true;
}

/** R2 自行托管图片，本服务不需要暴露静态目录 */
function shouldServeStatic() {
  return false;
}

/** 判断某个图片 URL 是否由本驱动管理（写库前校验，拒绝任意外链） */
function isManaged(url) {
  return typeof url === 'string' && url.startsWith(`${r2.publicBaseUrl}/`);
}

/** 启动时校验桶可写，避免把配置错误拖到用户第一次上传才暴露 */
async function verify() {
  await client.send(new PutObjectCommand({
    Bucket: r2.bucket,
    Key: `.healthcheck/${Date.now()}.txt`,
    Body: 'ok',
    ContentType: 'text/plain',
  }));
}

module.exports = {
  name: 'r2',
  ensureDir() {},
  put,
  remove,
  shouldServeStatic,
  isManaged,
  verify,
};
