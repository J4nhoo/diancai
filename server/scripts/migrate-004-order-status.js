'use strict';

/**
 * 迁移 004：订单状态机。
 *
 *   node scripts/migrate-004-order-status.js
 *
 * 把 orders.status 从「1 有效 / 0 已撤销」改成四态枚举：
 *   pending   待确认（刚下单）
 *   confirmed 已确认（厨师接单）
 *   overdue   已逾期（过了截止时间还没确认）
 *   completed 已完成（已确认且过了截止时间）
 *
 * 说明：原定义的 status=0（已撤销）从未被写入过 —— 撤销走的是物理删除。
 * 所以这次改造不需要回填旧数据，DEFAULT 会把任何遗留行归为 pending（语义也合理）。
 *
 * 幂等：已执行过直接退出；列类型已是目标枚举时跳过。
 * 执行前请备份：mysqldump -u root -p meal_order > 备份.sql
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const MIGRATION_NAME = '004-order-status';

const TARGET_TYPE =
  "enum('pending','confirmed','overdue','completed')";

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
  const log = (m) => console.log(`[migrate-004] ${m}`);

  try {
    const schema = fs.readFileSync(path.resolve(__dirname, '..', 'schema.sql'), 'utf8');
    await conn.query(schema);
    log('表结构就绪');

    const [done] = await conn.query('SELECT name FROM schema_migrations WHERE name = ?', [MIGRATION_NAME]);
    if (done.length) {
      log('该迁移已执行过，跳过');
      return;
    }

    const type = await columnType(conn, 'orders', 'status');
    if (type === TARGET_TYPE) {
      log('orders.status 已是目标枚举，跳过变更');
    } else {
      // 先确认没有 status=0 的历史行（理论上不存在，撤销是物理删除）
      const [zero] = await conn.query('SELECT COUNT(*) AS c FROM orders WHERE status = 0');
      if (Number(zero[0].c) > 0) {
        log(`⚠️ 发现 ${zero[0].c} 条 status=0 的历史行，将归为 pending`);
      }
      await conn.query(
        `ALTER TABLE orders
         MODIFY COLUMN status ${TARGET_TYPE} NOT NULL DEFAULT 'pending'
         COMMENT 'pending待确认 / confirmed已确认 / overdue已逾期 / completed已完成'`
      );
      log(`orders.status 已从 ${type} 改为四态枚举`);
    }

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
    log('迁移完成 ✓');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[migrate-004] 失败：', err.message);
  process.exit(1);
});
