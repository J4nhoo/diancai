'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler, ok, badRequest, notFound, forbidden } = require('../utils/http');
const { dateStr, int, str, todayStr } = require('../utils/validate');

const router = express.Router();

router.use(authenticate, requirePermission('order.submit'));

const ITEM_SQL = `
  SELECT oi.dish_id, oi.quantity, oi.flavor, d.name AS dish_name, d.image_url
  FROM order_items oi
  JOIN dishes d ON d.id = oi.dish_id
  WHERE oi.order_id = ?
  ORDER BY d.id`;

async function loadItems(orderId) {
  const rows = await db.query(ITEM_SQL, [orderId]);
  return rows.map((r) => ({
    dishId: r.dish_id,
    dishName: r.dish_name,
    imageUrl: r.image_url || null,
    quantity: r.quantity,
    flavor: r.flavor || null,
  }));
}

async function loadOrder(userId, date) {
  const order = await db.queryOne(
    'SELECT id, order_date, notes, status FROM orders WHERE user_id = ? AND order_date = ? AND status = 1',
    [userId, date]
  );
  if (!order) return null;
  return {
    orderDate: order.order_date,
    notes: order.notes || '',
    items: await loadItems(order.id),
  };
}

/** 解析并校验提交的菜品明细：去重合并、数量 1..99、菜品必须存在且上架 */
async function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw badRequest('请至少选择一道菜');
  }
  if (rawItems.length > 100) throw badRequest('一次最多选择 100 道菜');

  const merged = new Map();
  for (const item of rawItems) {
    const dishId = int(item && item.dishId, { name: '菜品', min: 1 });
    const quantity = int(item.quantity, { name: '份数', min: 1, max: 99 });
    const flavor = str(item && item.flavor, { name: '口味备注', required: false, max: 100 }) || null;
    merged.set(dishId, { dishId, quantity, flavor });
  }
  const items = [...merged.values()];

  const ids = items.map((i) => i.dishId);
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await db.pool.query(
    `SELECT id FROM dishes WHERE status = 1 AND id IN (${placeholders})`,
    ids
  );
  const available = new Set(rows.map((r) => r.id));

  for (const item of items) {
    if (!available.has(item.dishId)) throw badRequest('存在已下架或不存在的菜品，请刷新菜单后重试');
  }
  return items;
}

async function writeItems(conn, orderId, items) {
  await conn.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
  const values = items.map((i) => [orderId, i.dishId, i.quantity, i.flavor]);
  await conn.query(
    'INSERT INTO order_items (order_id, dish_id, quantity, flavor) VALUES ?',
    [values]
  );
}

/** 提交/覆盖自己某天的订单（幂等 upsert）。今天的可以提交，往后的也允许，过去的不行。 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const date = dateStr(req.body && req.body.orderDate);
    if (date < todayStr()) throw badRequest('不能提交过去日期的订单');

    const notes = str(req.body && req.body.notes, { name: '忌口/备注', required: false, max: 500 }) || null;
    const items = await normalizeItems(req.body && req.body.items);

    await db.withTransaction(async (conn) => {
      const [existing] = await conn.query(
        'SELECT id FROM orders WHERE user_id = ? AND order_date = ?',
        [req.user.id, date]
      );
      let orderId;
      if (existing.length) {
        orderId = existing[0].id;
        await conn.query(
          'UPDATE orders SET notes = ?, status = 1 WHERE id = ?',
          [notes, orderId]
        );
      } else {
        const [result] = await conn.query(
          'INSERT INTO orders (user_id, order_date, notes, status) VALUES (?, ?, ?, 1)',
          [req.user.id, date, notes]
        );
        orderId = result.insertId;
      }
      await writeItems(conn, orderId, items);
    });

    ok(res, await loadOrder(req.user.id, date));
  })
);

/** 我的订单列表，可按日期区间过滤 */
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const from = dateStr(req.query.from, { name: '起始日期', required: false });
    const to = dateStr(req.query.to, { name: '结束日期', required: false });

    const where = ['user_id = ?', 'status = 1'];
    const params = [req.user.id];
    if (from) {
      where.push('order_date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('order_date <= ?');
      params.push(to);
    }

    const orders = await db.query(
      `SELECT id, order_date, notes FROM orders WHERE ${where.join(' AND ')} ORDER BY order_date DESC LIMIT 100`,
      params
    );

    const today = todayStr();
    const data = [];
    for (const order of orders) {
      data.push({
        orderDate: order.order_date,
        notes: order.notes || '',
        editable: order.order_date >= today,
        items: await loadItems(order.id),
      });
    }
    ok(res, { orders: data });
  })
);

/** 我某天的订单 */
router.get(
  '/mine/:date',
  asyncHandler(async (req, res) => {
    const date = dateStr(req.params.date);
    const order = await loadOrder(req.user.id, date);
    if (!order) {
      return ok(res, { orderDate: date, notes: '', items: [], editable: date >= todayStr() });
    }
    ok(res, { ...order, editable: date >= todayStr() });
  })
);

function assertEditable(date) {
  if (date < todayStr()) throw forbidden('过往日期的订单不可修改');
}

/** 修改我某天的订单 */
router.put(
  '/mine/:date',
  asyncHandler(async (req, res) => {
    const date = dateStr(req.params.date);
    assertEditable(date);

    const existing = await db.queryOne(
      'SELECT id FROM orders WHERE user_id = ? AND order_date = ? AND status = 1',
      [req.user.id, date]
    );
    if (!existing) throw notFound('该日期没有你的订单');

    const notes = str(req.body && req.body.notes, { name: '忌口/备注', required: false, max: 500 }) || null;
    const items = await normalizeItems(req.body && req.body.items);

    await db.withTransaction(async (conn) => {
      await conn.query('UPDATE orders SET notes = ? WHERE id = ?', [notes, existing.id]);
      await writeItems(conn, existing.id, items);
    });

    ok(res, await loadOrder(req.user.id, date));
  })
);

/** 撤销我某天的订单 */
router.delete(
  '/mine/:date',
  asyncHandler(async (req, res) => {
    const date = dateStr(req.params.date);
    assertEditable(date);

    const result = await db.withTransaction(async (conn) => {
      const [rows] = await conn.query(
        'SELECT id FROM orders WHERE user_id = ? AND order_date = ? AND status = 1',
        [req.user.id, date]
      );
      if (!rows.length) return 0;
      await conn.query('DELETE FROM order_items WHERE order_id = ?', [rows[0].id]);
      await conn.query('DELETE FROM orders WHERE id = ?', [rows[0].id]);
      return 1;
    });

    if (!result) throw notFound('该日期没有你的订单');
    ok(res, { deleted: true });
  })
);

module.exports = router;
