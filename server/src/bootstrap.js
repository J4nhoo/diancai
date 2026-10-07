'use strict';

/**
 * 建库建表 + 种子分组 + 创建首个管理员。幂等，可重复执行。
 * 被 scripts/init-db.js（手动执行）和 src/server.js（AUTO_INIT_DB=true 时启动自动执行）复用。
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('./config');

const SEED_GROUPS = [
  ['荤菜', 1],
  ['素菜', 2],
  ['汤', 3],
  ['主食', 4],
];

function connectionOptions(extra) {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    charset: 'utf8mb4_unicode_ci',
    ...(config.db.ssl
      ? { ssl: { rejectUnauthorized: config.db.sslRejectUnauthorized } }
      : {}),
    ...extra,
  };
}

async function run(log = () => {}) {
  if (!/^[A-Za-z0-9_]+$/.test(config.db.database || '')) {
    throw new Error('DB_NAME 只能包含字母、数字和下划线');
  }

  const conn = await mysql.createConnection(connectionOptions({ multipleStatements: true }));
  try {
    log(`连接 ${config.db.host}:${config.db.port} 成功`);

    // 托管数据库（Aiven 免费档用 defaultdb）通常已建好库、且可能不给建库权限，
    // 所以建库失败不当致命错误，继续往下走 —— 真正有问题的话 USE 那步会报出来。
    try {
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } catch (err) {
      log(`建库跳过（${err.code || err.message}），假定 ${config.db.database} 已存在`);
    }

    await conn.query(`USE \`${config.db.database}\``);

    const schema = fs.readFileSync(path.resolve(__dirname, '..', 'schema.sql'), 'utf8');
    await conn.query(schema);
    log('数据表创建完成');

    await conn.query('INSERT IGNORE INTO dish_groups (name, sort_order, status) VALUES ?', [
      SEED_GROUPS.map(([name, sort]) => [name, sort, 1]),
    ]);
    log('默认分组已就绪（荤菜 / 素菜 / 汤 / 主食）');

    const [admins] = await conn.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (admins.length) {
      log('已存在管理员账号，跳过创建');
    } else if (!config.initAdmin.password) {
      log('未配置 ADMIN_PASSWORD，跳过管理员创建');
    } else {
      const hash = await bcrypt.hash(config.initAdmin.password, 10);
      await conn.query(
        'INSERT INTO users (username, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, 1)',
        [config.initAdmin.username, hash, config.initAdmin.displayName, 'admin']
      );
      log(`管理员已创建：${config.initAdmin.username}`);
    }
  } finally {
    await conn.end();
  }
}

module.exports = { run };
