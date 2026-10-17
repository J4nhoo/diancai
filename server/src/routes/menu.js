'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler, ok, badRequest } = require('../utils/http');
const { shapeDish } = require('../utils/shape');
const { isValidMeal, currentMeal, MEALS } = require('../meals');

const router = express.Router();

router.use(authenticate, requirePermission('menu.view'));

/**
 * 点菜用的菜单：只返回【适用于该餐次】的上架菜品，按分组嵌套。
 * meal 缺省时按当前时间推（早上打开就是早餐）。
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const raw = req.query.meal;
    const meal = raw === undefined || raw === '' ? currentMeal() : String(raw);
    if (!isValidMeal(meal)) throw badRequest('餐次不合法');

    const groups = await db.query(
      'SELECT id, name, sort_order FROM dish_groups WHERE status = 1 ORDER BY sort_order, id'
    );
    const dishes = await db.query(
      `SELECT id, group_id, name, image_url, notes, meal_types, flavor
       FROM dishes WHERE status = 1 AND FIND_IN_SET(?, meal_types) ORDER BY id`,
      [meal]
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
    ok(res, { meal, meals: MEALS, groups: data });
  })
);

module.exports = router;
