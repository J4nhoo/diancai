'use strict';

/**
 * 腾讯云 COS 驱动。
 * 用官方 cos-nodejs-sdk-v5 而非 AWS SDK —— COS 虽兼容 S3 协议，但新版 AWS SDK
 * 会发送 x-amz-checksum-* 头，COS 处理不了会直接报错。
 *
 * 前提：桶的访问权限设为「公有读私有写」，图片才能被浏览器直接加载。
 */

const COS = require('cos-nodejs-sdk-v5');
const config = require('../config');
const { makeKey, extOf, ALLOWED_EXT } = require('./naming');

const cosConf = config.storage.cos;

const cos = new COS({
  SecretId: cosConf.secretId,
  SecretKey: cosConf.secretKey,
});

// 未配置自定义域名时用 COS 默认域名
function publicBaseUrl() {
  if (cosConf.publicBaseUrl) return cosConf.publicBaseUrl;
  return `https://${cosConf.bucket}.cos.${cosConf.region}.myqcloud.com`;
}

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
  await cos.putObject({
    Bucket: cosConf.bucket,
    Region: cosConf.region,
    Key: key,
    Body: file.buffer,
    ContentType: CONTENT_TYPE[ext] || 'application/octet-stream',
    // 文件名自带随机串，内容不会变，可长期缓存
    CacheControl: 'public, max-age=2592000',
  });

  return { url: `${publicBaseUrl()}/${key}`, key };
}

async function remove(url) {
  const base = publicBaseUrl();
  if (typeof url !== 'string' || !url.startsWith(`${base}/`)) return false;

  const key = url.slice(base.length + 1);
  if (!key || key.includes('..')) return false;

  await cos.deleteObject({ Bucket: cosConf.bucket, Region: cosConf.region, Key: key });
  return true;
}

/** COS 自行托管图片，本服务不需要暴露静态目录 */
function shouldServeStatic() {
  return false;
}

/** 判断某个图片 URL 是否由本驱动管理（写库前校验，拒绝任意外链） */
function isManaged(url) {
  return typeof url === 'string' && url.startsWith(`${publicBaseUrl()}/`);
}

/**
 * 启动时校验：既确认能写，也确认图片公网可读。
 * 「桶没设成公有读」是最容易犯又最难察觉的错误（上传成功但图片静默 403），
 * 所以这里主动读一次公网 URL 把它揪出来。
 */
async function verify() {
  const key = `.healthcheck/${Date.now()}.txt`;

  await cos.putObject({
    Bucket: cosConf.bucket,
    Region: cosConf.region,
    Key: key,
    Body: 'ok',
    ContentType: 'text/plain',
  });

  if (typeof fetch === 'function') {
    const url = `${publicBaseUrl()}/${key}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          `写入成功但公网读取失败（HTTP ${res.status}）：请把 COS 桶的访问权限设为「公有读私有写」`
        );
      }
    } catch (err) {
      if (err.message && err.message.includes('公有读')) throw err;
      throw new Error(`写入成功但无法访问公网地址 ${url}：${err.message}`);
    }
  }

  await cos.deleteObject({ Bucket: cosConf.bucket, Region: cosConf.region, Key: key });
}

module.exports = {
  name: 'cos',
  ensureDir() {},
  put,
  remove,
  shouldServeStatic,
  isManaged,
  verify,
};
