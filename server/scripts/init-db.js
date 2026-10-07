'use strict';

/**
 * 初始化数据库：建表 → 种子分组 → 创建首个管理员。
 * 可重复执行，不会破坏已有数据。
 *
 *   npm run init-db
 *
 * 也可以直接连远程数据库初始化（例如 Aiven）：
 *   DB_HOST=xxx DB_PORT=12345 DB_USER=avnadmin DB_PASSWORD=xxx \
 *   DB_NAME=defaultdb DB_SSL=true npm run init-db
 */

const bootstrap = require('../src/bootstrap');

bootstrap
  .run((msg) => console.log(`[init-db] ${msg}`))
  .then(() => console.log('[init-db] 全部完成 ✓'))
  .catch((err) => {
    console.error('[init-db] 失败：', err.message);
    process.exit(1);
  });
