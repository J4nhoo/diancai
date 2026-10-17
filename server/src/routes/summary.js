'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler, ok, badRequest } = require('../utils/http');
const { dateStr, todayStr } = require('../utils/validate');
const { isValidMeal, currentMeal, MEALS } = require('../meals');

const router = express.Router();

router.use(authenticate, requirePermission('summary.view'));

const MERGED_SQL = `
  SELECT d.id AS dish_id, d.name AS dish_name, d.image_url,
         g.id AS group_id, g.name AS group_name, g.sort_order AS group_sort,
         SUM(oi.quantity) AS total_quantity,
         COUNT(DISTINCT o.id) AS order_count
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id AND o.status = 1
  JOIN dishes d ON d.id = oi.dish_id
  LEFT JOIN dish_groups g ON g.id = d.group_id
  WHERE o.order_date = ? AND o.meal_type = ?
  GROUP BY d.id, d.name, d.image_url, g.id, g.name, g.sort_order
  ORDER BY g.sort_order, g.id, d.id`;

function buildText(groups, notes) {
  const lines = [];
  for (const group of groups) {
    for (const dish of group.dishes) {
      lines.push(`${dish.dishName} x${dish.totalQuantity}`);
    }
  }
  if (notes.length) {
    lines.push('');
    lines.push('备注：');
    for (const note of notes) {
      lines.push(`${note.displayName}：${note.notes}`);
    }
  }
  return lines.join('\n');
}

/** 按日期 + 餐次汇总该时段的菜品数量与备注。所有角色均可查询。 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const date = dateStr(req.query.date, { name: '日期', required: false }) || todayStr();
    const rawMeal = req.query.meal;
    const meal = rawMeal === undefined || rawMeal === '' ? currentMeal() : String(rawMeal);
    if (!isValidMeal(meal)) throw badRequest('餐次不合法');

    const rows = await db.query(MERGED_SQL, [date, meal]);
    const orderRow = await db.queryOne(
      'SELECT COUNT(*) AS c FROM orders WHERE order_date = ? AND meal_type = ? AND status = 1',
      [date, meal]
    );

    // 各人的订单明细 —— 只有拥有 order.viewAll 的人才看得到「谁点了什么」。
    // 仅能看汇总的人只拿合并后的采购清单，避免泄露其他人的点菜内容。
    const canViewAll = req.user.isOwner || req.user.perms.has('order.viewAll');
    let orders = [];
    let notes = [];

    if (canViewAll) {
      const orderList = await db.query(
        `SELECT o.id, o.notes, u.id AS user_id, u.display_name, u.username, u.role
         FROM orders o JOIN users u ON u.id = o.user_id
         WHERE o.order_date = ? AND o.meal_type = ? AND o.status = 1
         ORDER BY u.display_name, u.id`,
        [date, meal]
      );
      const orderIds = orderList.map((o) => o.id);
      let itemRows = [];
      if (orderIds.length) {
        // 用 pool.query 而不是 execute：IN 列表长度不定，预编译语句放不了动态占位符
        const ph = orderIds.map(() => '?').join(',');
        const [raw] = await db.pool.query(
          `SELECT oi.order_id, oi.dish_id, oi.quantity, oi.flavor,
                  d.name AS dish_name, d.image_url
           FROM order_items oi JOIN dishes d ON d.id = oi.dish_id
           WHERE oi.order_id IN (${ph})
           ORDER BY d.id`,
          orderIds
        );
        itemRows = raw;
      }
      const itemsByOrder = new Map();
      for (const it of itemRows) {
        if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
        itemsByOrder.get(it.order_id).push({
          dishId: it.dish_id,
          dishName: it.dish_name,
          imageUrl: it.image_url || null,
          quantity: it.quantity,
          flavor: it.flavor || null,
        });
      }

      orders = orderList.map((o) => ({
        orderId: o.id,
        userId: o.user_id,
        displayName: o.display_name,
        username: o.username,
        role: o.role,
        notes: o.notes || '',
        items: itemsByOrder.get(o.id) || [],
      }));

      notes = orderList
        .filter((o) => o.notes)
        .map((o) => ({
          displayName: o.display_name,
          username: o.username,
          notes: o.notes,
        }));
    }

    const groupMap = new Map();
    let totalQuantity = 0;
    for (const row of rows) {
      const groupId = row.group_id === null ? 0 : row.group_id;
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, {
          groupId: row.group_id,
          groupName: row.group_name || '未分组',
          dishes: [],
        });
      }
      groupMap.get(groupId).dishes.push({
        dishId: row.dish_id,
        dishName: row.dish_name,
        imageUrl: row.image_url || null,
        totalQuantity: Number(row.total_quantity),
        orderCount: Number(row.order_count),
      });
      totalQuantity += Number(row.total_quantity);
    }

    const groups = [...groupMap.values()];
    ok(res, {
      date,
      mealType: meal,
      meals: MEALS,
      groups,
      orders,
      notes,
      dishCount: rows.length,
      totalQuantity,
      orderCount: Number(orderRow.c),
      text: buildText(groups, notes),
    });
  })
);

module.exports = router;
