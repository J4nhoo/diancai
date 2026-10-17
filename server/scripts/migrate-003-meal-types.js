'use strict';

/**
 * 迁移 003：引入餐次（早/午/晚）。
 *
 *   node scripts/migrate-003-meal-types.js
 *
 * 内容：
 *   1. dishes 加 meal_types（默认 lunch,dinner —— 现有菜都是午晚餐）
 *   2. orders 加 meal_type，唯一键 (order_date,user_id) → (order_date,meal_type,user_id)
 *      —— 同一天从此可以有三份互不干扰的订单
 *   3. dish_reviews 加 meal_type，唯一键同步扩为四列
 *      —— 评价粒度从「一天一次」变为「一天一时段」，午餐和晚餐可分别评价
 *
 * 已有数据靠列 DEFAULT 自动归入 lunch / lunch,dinner，无需额外 UPDATE。
 * 幂等：已执行过直接退出；列与索引变更前先查 information_schema。
 * 执行前请备份：mysqldump -u root -p meal_order > 备份.sql
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const MIGRATION_NAME = '003-meal-types';

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

async function hasIndex(conn, table, index) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection(connOptions({ multipleStatements: true }));
  const log = (m) => console.log(`[migrate-003] ${m}`);

  try {
    const schema = fs.readFileSync(path.resolve(__dirname, '..', 'schema.sql'), 'utf8');
    await conn.query(schema);
    log('表结构就绪');

    const [done] = await conn.query('SELECT name FROM schema_migrations WHERE name = ?', [MIGRATION_NAME]);
    if (done.length) {
      log('该迁移已执行过，跳过');
      return;
    }

    // 1. 菜品适用餐次
    if (!(await hasColumn(conn, 'dishes', 'meal_types'))) {
      await conn.query(
        `ALTER TABLE dishes ADD COLUMN meal_types VARCHAR(24) NOT NULL DEFAULT 'lunch,dinner'
         COMMENT '适用餐次，逗号分隔（breakfast/lunch/dinner）' AFTER notes`
      );
      log('已添加 dishes.meal_types（现有菜品默认：午晚餐）');
    } else {
      log('dishes.meal_types 已存在，跳过');
    }

    // 2. 订单餐次 + 唯一键扩为三列
    if (!(await hasColumn(conn, 'orders', 'meal_type'))) {
      await conn.query(
        `ALTER TABLE orders ADD COLUMN meal_type ENUM('breakfast','lunch','dinner')
         NOT NULL DEFAULT 'lunch' COMMENT '餐次：早/午/晚' AFTER order_date`
      );
      log('已添加 orders.meal_type（现有订单默认：午餐）');
    } else {
      log('orders.meal_type 已存在，跳过');
    }
    if (await hasIndex(conn, 'orders', 'uk_orders_date_user')) {
      await conn.query('ALTER TABLE orders DROP INDEX uk_orders_date_user');
      log('已移除旧唯一键 (order_date, user_id)');
    }
    if (!(await hasIndex(conn, 'orders', 'uk_orders_date_meal_user'))) {
      await conn.query(
        'ALTER TABLE orders ADD UNIQUE KEY uk_orders_date_meal_user (order_date, meal_type, user_id)'
      );
      log('已建立新唯一键 (order_date, meal_type, user_id)');
    }

    // 3. 评价餐次 + 唯一键扩为四列
    if (!(await hasColumn(conn, 'dish_reviews', 'meal_type'))) {
      await conn.query(
        `ALTER TABLE dish_reviews ADD COLUMN meal_type ENUM('breakfast','lunch','dinner')
         NOT NULL DEFAULT 'lunch' COMMENT '餐次：早/午/晚' AFTER order_date`
      );
      log('已添加 dish_reviews.meal_type（现有评价默认：午餐）');
    } else {
      log('dish_reviews.meal_type 已存在，跳过');
    }
    if (await hasIndex(conn, 'dish_reviews', 'uk_review_dish_user_date')) {
      await conn.query('ALTER TABLE dish_reviews DROP INDEX uk_review_dish_user_date');
      log('已移除旧评价唯一键');
    }
    if (!(await hasIndex(conn, 'dish_reviews', 'uk_review_dish_date_meal_user'))) {
      await conn.query(
        `ALTER TABLE dish_reviews
         ADD UNIQUE KEY uk_review_dish_date_meal_user (dish_id, order_date, meal_type, user_id)`
      );
      log('已建立新评价唯一键 (dish_id, order_date, meal_type, user_id)');
    }

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
    log('迁移完成 ✓');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[migrate-003] 失败：', err.message);
  process.exit(1);
});
