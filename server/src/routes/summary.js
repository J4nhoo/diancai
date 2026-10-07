'use strict';

const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ok } = require('../utils/http');
const { dateStr, todayStr } = require('../utils/validate');

const router = express.Router();

router.use(authenticate);

const MERGED_SQL = `
  SELECT d.id AS dish_id, d.name AS dish_name, d.image_url,
         g.id AS group_id, g.name AS group_name, g.sort_order AS group_sort,
         d.sort_order AS dish_sort,
         SUM(oi.quantity) AS total_quantity,
         COUNT(DISTINCT o.id) AS order_count
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id AND o.status = 1
  JOIN dishes d ON d.id = oi.dish_id
  LEFT JOIN dish_groups g ON g.id = d.group_id
  WHERE o.order_date = ?
  GROUP BY d.id, d.name, d.image_url, g.id, g.name, g.sort_order, d.sort_order
  ORDER BY g.sort_order, g.id, d.sort_order, d.id`;

const NOTES_SQL = `
  SELECT u.display_name, u.username, o.notes
  FROM orders o
  JOIN users u ON u.id = o.user_id
  WHERE o.order_date = ? AND o.status = 1 AND o.notes IS NOT NULL AND o.notes <> ''
  ORDER BY u.display_name, u.id`;

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

/** 按日期汇总当日所有订单的菜品数量与备注。所有角色均可查询。 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const date = dateStr(req.query.date, { name: '日期', required: false }) || todayStr();

    const rows = await db.query(MERGED_SQL, [date]);
    const noteRows = await db.query(NOTES_SQL, [date]);
    const orderRow = await db.queryOne(
      'SELECT COUNT(*) AS c FROM orders WHERE order_date = ? AND status = 1',
      [date]
    );

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
    const notes = noteRows.map((r) => ({
      displayName: r.display_name,
      username: r.username,
      notes: r.notes,
    }));

    ok(res, {
      date,
      groups,
      notes,
      dishCount: rows.length,
      totalQuantity,
      orderCount: Number(orderRow.c),
      text: buildText(groups, notes),
    });
  })
);

module.exports = router;
