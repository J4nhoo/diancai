'use strict';

/**
 * 建表 + 跑迁移 + 种子分组 + 创建首个管理员。幂等，可重复执行。
 * 被 scripts/init-db.js（手动执行）和 src/server.js（AUTO_INIT_DB=true 时启动自动执行）复用。
 *
 * 迁移脚本改动 schema 时【必须】在这里登记，否则部署到已存在的库上不会生效 ——
 * schema.sql 全是 CREATE TABLE IF NOT EXISTS，对已存在的表是空操作，加不了新列。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('./config');

const SEED_GROUPS = [
  ['荤菜', 1],
  ['素菜', 2],
  ['汤', 3],
  ['主食', 4],
];

/** 按顺序执行的迁移脚本（文件名在 scripts/ 下）。新增迁移请追加到末尾。 */
const MIGRATIONS = ['migrate-001-permissions.js', 'migrate-002-dish-fields-and-reviews.js'];

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

/**
 * 执行尚未应用的迁移。
 *
 * 迁移脚本是【独立进程】运行的（各自建连接、自己写 schema_migrations 标记），
 * 因为它们会改表结构，和连接复用在一起容易踩到元数据缓存的问题。
 * 每个脚本都自带幂等判断，重复执行会直接跳过。
 */
async function runMigrations(log) {
  for (const file of MIGRATIONS) {
    const script = path.resolve(__dirname, '..', 'scripts', file);
    if (!fs.existsSync(script)) {
      log(`迁移脚本不存在，跳过：${file}`);
      continue;
    }
    // 先问标记表是否已应用，避免每次都起进程（已应用时最省事）
    const conn = await mysql.createConnection(connectionOptions({ database: config.db.database }));
    let applied;
    try {
      const [rows] = await conn.query('SELECT 1 FROM schema_migrations WHERE name = ?', [
        file.replace(/^migrate-/, '').replace(/\.js$/, ''),
      ]);
      applied = rows.length > 0;
    } catch (_) {
      // schema_migrations 还不存在（全新库），交给脚本自己处理
      applied = false;
    } finally {
      await conn.end();
    }

    if (applied) continue;

    log(`执行迁移：${file}`);
    execFileSync(process.execPath, [script], {
      stdio: 'inherit',
      env: process.env,
      cwd: path.resolve(__dirname, '..'),
    });
  }
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
    log('基础表结构就绪');
  } finally {
    await conn.end();
  }

  // 表建好后再跑迁移（迁移会改结构、加列）
  await runMigrations(log);

  const conn2 = await mysql.createConnection(connectionOptions({ database: config.db.database }));
  try {
    await conn2.query('INSERT IGNORE INTO dish_groups (name, sort_order, status) VALUES ?', [
      SEED_GROUPS.map(([name, sort]) => [name, sort, 1]),
    ]);
    log('默认分组已就绪（荤菜 / 素菜 / 汤 / 主食）');

    const [owners] = await conn2.query('SELECT id FROM users WHERE is_owner = 1 LIMIT 1');
    if (owners.length) {
      log('已存在所有者账号，跳过创建');
    } else if (!config.initAdmin.password) {
      log('未配置 ADMIN_PASSWORD，跳过管理员创建');
    } else {
      const hash = await bcrypt.hash(config.initAdmin.password, 10);
      // 首个账号设为所有者：拥有全部权限且不可通过 API 剥夺，
      // 避免有人改错权限后把所有人锁在系统外
      await conn2.query(
        `INSERT INTO users (username, password_hash, display_name, role, is_owner, status)
         VALUES (?, ?, ?, '管理者', 1, 1)`,
        [config.initAdmin.username, hash, config.initAdmin.displayName]
      );
      log(`所有者账号已创建：${config.initAdmin.username}（拥有全部权限）`);
    }
  } finally {
    await conn2.end();
  }
}

module.exports = { run, MIGRATIONS };
