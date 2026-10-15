'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler, ok } = require('../utils/http');
const { shapeDish } = require('../utils/shape');

const router = express.Router();

router.use(authenticate, requirePermission('menu.view'));

/** 点菜用的菜单：仅返回上架分组与上架菜品，按分组嵌套 */
router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const groups = await db.query(
      'SELECT id, name, sort_order FROM dish_groups WHERE status = 1 ORDER BY sort_order, id'
    );
    const dishes = await db.query(
      `SELECT id, group_id, name, image_url, notes, flavor
       FROM dishes WHERE status = 1 ORDER BY id`
    );

    const byGroup = new Map();
    for (const group of groups) {
      byGroup.set(group.id, {
        id: group.id,
        name: group.name,
        sortOrder: group.sort_order,
        dishes: [],
      });
    }
    for (const dish of dishes) {
      const bucket = byGroup.get(dish.group_id);
      if (bucket) bucket.dishes.push(shapeDish(dish));
    }

    const data = [...byGroup.values()].filter((g) => g.dishes.length > 0);
    ok(res, { groups: data });
  })
);

module.exports = router;
