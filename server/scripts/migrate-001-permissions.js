'use strict';

/**
 * 迁移 001：把「角色即权限」改为「权限独立授权」。
 *
 *   node scripts/migrate-001-permissions.js
 *
 * 幂等：已执行过会直接退出（靠 schema_migrations 标记）。
 * 会改动 users 表结构，执行前请先备份：
 *   mysqldump -u root -p meal_order > 备份.sql
 *
 * 顺序不能颠倒 —— 必须先用【旧的英文角色值】回填权限，再把标签改成中文。
 */

const mysql = require('mysql2/promise');
const config = require('../src/config');
const { ROLE_PERMISSION_MAP, ROLE_LABEL_MAP } = require('../src/permissions');

const MIGRATION_NAME = '001-permissions';

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

async function columnType(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length ? rows[0].t : null;
}

async function main() {
  const conn = await mysql.createConnection(connOptions({ multipleStatements: true }));
  const log = (m) => console.log(`[migrate] ${m}`);

  try {
    // 1. 建新表 + 迁移标记表
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(path.resolve(__dirname, '..', 'schema.sql'), 'utf8');
    await conn.query(schema);
    log('表结构就绪（含 user_permissions / audit_logs / schema_migrations）');

    // 2. 已执行过则退出
    const [done] = await conn.query('SELECT name FROM schema_migrations WHERE name = ?', [MIGRATION_NAME]);
    if (done.length) {
      log('该迁移已执行过，跳过');
      return;
    }

    // 3. role: ENUM -> VARCHAR(32)。此时值仍是 family/chef/admin
    const roleType = await columnType(conn, 'users', 'role');
    if (roleType && roleType.startsWith('enum')) {
      await conn.query(
        `ALTER TABLE users MODIFY COLUMN role VARCHAR(32) NOT NULL DEFAULT '家人'
         COMMENT '显示标签，无权限含义'`
      );
      log('users.role 已从 ENUM 改为 VARCHAR(32)');
    } else {
      log(`users.role 已是 ${roleType}，跳过类型变更`);
    }

    // 4. is_owner 列（MySQL 不支持 ADD COLUMN IF NOT EXISTS）
    const ownerCol = await columnType(conn, 'users', 'is_owner');
    if (!ownerCol) {
      await conn.query(
        `ALTER TABLE users ADD COLUMN is_owner TINYINT(1) NOT NULL DEFAULT 0
         COMMENT '所有者，拥有全部权限且不可通过 API 变更'`
      );
      log('users.is_owner 列已添加');
    } else {
      log('users.is_owner 已存在，跳过');
    }

    // 5. 回填所有者：取 id 最小的旧 admin（即 init-db 建的那个账号）
    const [ownerCount] = await conn.query('SELECT COUNT(*) AS c FROM users WHERE is_owner = 1');
    if (Number(ownerCount[0].c) === 0) {
      const [r] = await conn.query(
        "UPDATE users SET is_owner = 1 WHERE role = 'admin' ORDER BY id LIMIT 1"
      );
      if (r.affectedRows) log('已指定所有者：id 最小的旧 admin 账号');
      else log('⚠️ 没有找到旧 admin 账号，请用 node scripts/create-admin.js 创建所有者');
    } else {
      log(`已存在 ${ownerCount[0].c} 个所有者，跳过回填`);
    }

    // 6. 按旧角色回填权限（此时 role 仍是英文）
    const [permCount] = await conn.query('SELECT COUNT(*) AS c FROM user_permissions');
    if (Number(permCount[0].c) === 0) {
      const [users] = await conn.query('SELECT id, role FROM users');
      let inserted = 0;
      for (const u of users) {
        const perms = ROLE_PERMISSION_MAP[u.role];
        if (!perms || !perms.length) {
          log(`⚠️ 账号 id=${u.id} 的角色「${u.role}」无对应权限映射，跳过`);
          continue;
        }
        await conn.query(
          'INSERT IGNORE INTO user_permissions (user_id, permission) VALUES ?',
          [perms.map((p) => [u.id, p])]
        );
        inserted += perms.length;
      }
      log(`已按角色回填 ${inserted} 条权限`);
    } else {
      log(`user_permissions 已有 ${permCount[0].c} 条记录，跳过回填`);
    }

    // 7. 角色标签中文化（放最后，因为第 6 步依赖英文值）
    const [r7] = await conn.query(
      `UPDATE users SET role = CASE role
         WHEN 'family' THEN '家人'
         WHEN 'chef'   THEN '厨师'
         WHEN 'admin'  THEN '管理者'
         ELSE role END
       WHERE role IN ('family','chef','admin')`
    );
    if (r7.affectedRows) log(`已把 ${r7.affectedRows} 个账号的角色标签改成中文`);

    // 8. 写入标记
    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
    log('迁移完成 ✓');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[migrate] 失败：', err.message);
  process.exit(1);
});
