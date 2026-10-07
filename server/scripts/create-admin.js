'use strict';

/**
 * 创建或重置一个管理员账号（忘记密码时的救援入口）。
 *
 *   node scripts/create-admin.js <用户名> <密码> [显示名]
 *   npm run create-admin -- admin 新密码 管理员
 *
 * 未传参数时回退到 .env 里的 ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_DISPLAY_NAME。
 */

const bcrypt = require('bcryptjs');
const config = require('../src/config');
const db = require('../src/db');

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

  const hash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO users (username, password_hash, display_name, role, status)
     VALUES (?, ?, ?, 'admin', 1)
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       display_name  = VALUES(display_name),
       role          = 'admin',
       status        = 1,
       token_version = token_version + 1`,
    [username, hash, displayName]
  );

  console.log(`管理员已就绪：${username}（显示名：${displayName}）`);
  console.log('旧登录状态已失效，请重新登录。');
  await db.pool.end();
}

main().catch((err) => {
  console.error('创建管理员失败：', err.message);
  process.exit(1);
});
