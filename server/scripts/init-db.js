'use strict';

/**
 * 初始化数据库：建表 → 自动执行未应用的迁移 → 种子分组 → 创建首个所有者。
 * 可重复执行，不会破坏已有数据。
 *
 *   npm run init-db
 *
 * 也可以连远程数据库初始化（需要时在 env 里指定 DB_HOST / DB_SSL 等）：
 *   DB_HOST=10.0.0.5 DB_USER=meal_order DB_PASSWORD=xxx DB_NAME=meal_order npm run init-db
 */

const bootstrap = require('../src/bootstrap');

bootstrap
  .run((msg) => console.log(`[init-db] ${msg}`))
  .then(() => console.log('[init-db] 全部完成 ✓'))
  .catch((err) => {
    console.error('[init-db] 失败：', err.message);
    process.exit(1);
  });
