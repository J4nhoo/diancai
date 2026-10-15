'use strict';

/**
 * 创建或重置【所有者】账号 —— 拥有全部权限，忘记密码时的救援入口。
 *
 *   node scripts/create-admin.js <用户名> <密码> [显示名]
 *   npm run create-admin -- admin 新密码 管理员
 *
 * 未传参数时回退到 .env 里的 ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_DISPLAY_NAME。
 *
 * 这是唯一能设置 is_owner 的入口：API 永不接受该字段，防止有人给自己提权，
 * 也防止改错权限后把所有人锁在系统外。
 */

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const config = require('../src/config');

function connOptions(extra) {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4_unicode_ci',
    ...(config.db.ssl ? { ssl: { rejectUnauthorized: config.db.sslRejectUnauthorized } } : {}),
    ...extra,
  };
}

async function main() {
  const [argUser, argPass, argName] = process.argv.slice(2);

  const username = argUser || config.initAdmin.username;
  const password = argPass || config.initAdmin.password;
  const displayName = argName || config.initAdmin.displayName || username;

  if (!username || !password) {
    console.error('用法：node scripts/create-admin.js <用户名> <密码> [显示名]');
    console.error('或先在 .env 配置 ADMIN_USERNAME / ADMIN_PASSWORD 后执行 npm run create-admin');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('密码至少 6 位');
    process.exit(1);
  }
  if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
    console.error('用户名需为 3-32 位的字母、数字或下划线');
    process.exit(1);
  }

  const conn = await mysql.createConnection(connOptions());
  const hash = await bcrypt.hash(password, 10);

  try {
    // 库里已有所有者时，不抢走所有权（否则会把原来的所有者降级）
    const [owners] = await conn.query(
      'SELECT id, username FROM users WHERE is_owner = 1 LIMIT 1'
    );
    const existing = owners.length ? owners[0] : null;
    const grantOwner = existing ? 0 : 1;

    await conn.query(
      `INSERT INTO users (username, password_hash, display_name, role, is_owner, status)
       VALUES (?, ?, ?, '管理者', ?, 1)
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash),
         display_name  = VALUES(display_name),
         status        = 1,
         is_owner      = GREATEST(is_owner, VALUES(is_owner)),
         token_version = token_version + 1`,
      [username, hash, displayName, grantOwner]
    );

    if (grantOwner) {
      console.log(`所有者已就绪：${username}（显示名：${displayName}）—— 拥有全部权限`);
    } else {
      console.log(`账号已就绪：${username}（显示名：${displayName}）`);
      console.log(`注意：系统中已有所有者「${existing.username}」，本次未转移所有权。`);
      console.log('如需转移，请先手动把目标账号的 is_owner 改为 1 并把原所有者改为 0。');
    }
    console.log('旧登录状态已失效，请重新登录。');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('创建失败：', err.message);
  process.exit(1);
});
