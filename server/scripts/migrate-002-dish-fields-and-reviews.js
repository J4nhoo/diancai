'use strict';

/**
 * 迁移 002：菜品字段精简 + 菜品评价。
 *
 *   node scripts/migrate-002-dish-fields-and-reviews.js
 *
 * 内容：
 *   1. 建 dish_reviews 表
 *   2. 删除 dishes.price / dishes.sort_order（price 全为 NULL，sort_order 仅 2 行非零，损失可忽略）
 *   3. 新增 dishes.notes
 *   4. 给所有非所有者账号补 review.create 权限
 *
 * 幂等：已执行过直接退出（schema_migrations 标记）；列变更前先查 information_schema。
 * 执行前请先备份：mysqldump -u root -p meal_order > 备份.sql
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const MIGRATION_NAME = '002-dish-fields-and-reviews';

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

async function hasColumn(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection(connOptions({ multipleStatements: true }));
  const log = (m) => console.log(`[migrate-002] ${m}`);

  try {
    // 建表（含 dish_reviews / schema_migrations）
    const schema = fs.readFileSync(path.resolve(__dirname, '..', 'schema.sql'), 'utf8');
    await conn.query(schema);
    log('表结构就绪');

    const [done] = await conn.query('SELECT name FROM schema_migrations WHERE name = ?', [MIGRATION_NAME]);
    if (done.length) {
      log('该迁移已执行过，跳过');
      return;
    }

    // 删除 price / sort_order（MySQL 不支持 DROP COLUMN IF EXISTS）
    for (const col of ['price', 'sort_order']) {
      if (await hasColumn(conn, 'dishes', col)) {
        await conn.query(`ALTER TABLE dishes DROP COLUMN ${col}`);
        log(`已删除 dishes.${col}`);
      } else {
        log(`dishes.${col} 不存在，跳过`);
      }
    }

    // 新增 notes
    if (!(await hasColumn(conn, 'dishes', 'notes'))) {
      await conn.query(
        `ALTER TABLE dishes ADD COLUMN notes VARCHAR(500) NULL COMMENT '菜品备注' AFTER image_url`
      );
      log('已添加 dishes.notes');
    } else {
      log('dishes.notes 已存在，跳过');
    }

    // 评价是家庭场景的核心互动，默认给所有非所有者账号开通
    // （所有者靠 is_owner 短路，不需要权限行）
    const [r] = await conn.query(
      `INSERT IGNORE INTO user_permissions (user_id, permission, granted_by)
       SELECT id, 'review.create', NULL FROM users WHERE is_owner = 0`
    );
    log(`已为 ${r.affectedRows} 个账号开通「评价菜品」权限`);

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
    log('迁移完成 ✓');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[migrate-002] 失败：', err.message);
  process.exit(1);
});
