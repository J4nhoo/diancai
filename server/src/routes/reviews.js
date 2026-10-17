'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler, ok, badRequest, notFound, forbidden } = require('../utils/http');
const { int, str, dateStr } = require('../utils/validate');
const { isValidMeal, MEALS } = require('../meals');

const router = express.Router();

router.use(authenticate);

/**
 * 校验「确实点过这道菜」。
 *
 * 这是【权限之外】的额外约束：拥有 review.create 只代表"能评价"，
 * 不代表能评价任意菜。必须该菜出现在自己已提交的订单里才行。
 * 用订单日期定位是哪一餐 —— 同一个人同一道菜，不同日期可以各评一次。
 */
async function assertOrdered(userId, dishId, orderDate, mealType) {
  const hit = await db.queryOne(
    `SELECT o.id FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.user_id = ? AND oi.dish_id = ? AND o.order_date = ? AND o.meal_type = ? AND o.status = 1
     LIMIT 1`,
    [userId, dishId, orderDate, mealType]
  );
  if (!hit) throw forbidden('只能评价自己点过的那一餐的菜');
}

/** 某道菜的评价列表 + 平均分 */
router.get(
  '/dish/:dishId',
  asyncHandler(async (req, res) => {
    const dishId = int(req.params.dishId, { name: '菜品', min: 1 });

    const dish = await db.queryOne('SELECT id, name FROM dishes WHERE id = ?', [dishId]);
    if (!dish) throw notFound('菜品不存在');

    const rows = await db.query(
      `SELECT r.id, r.rating, r.content, r.order_date, r.meal_type, r.created_at, r.user_id,
              u.display_name, u.username
       FROM dish_reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.dish_id = ?
       ORDER BY r.order_date DESC, FIELD(r.meal_type,'breakfast','lunch','dinner'), r.id DESC
       LIMIT 100`,
      [dishId]
    );
    const stat = await db.queryOne(
      'SELECT COUNT(*) AS c, AVG(rating) AS avg_rating FROM dish_reviews WHERE dish_id = ?',
      [dishId]
    );

    const count = Number(stat.c);
    ok(res, {
      dishId,
      dishName: dish.name,
      count,
      // 保留一位小数；无评价时为 null
      average: count ? Math.round(Number(stat.avg_rating) * 10) / 10 : null,
      meals: MEALS,
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        content: r.content || '',
        orderDate: r.order_date,
        mealType: r.meal_type,
        createdAt: r.created_at,
        userId: r.user_id,
        displayName: r.display_name,
        username: r.username,
        mine: r.user_id === req.user.id,
      })),
    });
  })
);

/** 提交评价（同人同菜同日期则覆盖） */
router.post(
  '/',
  requirePermission('review.create'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const dishId = int(body.dishId, { name: '菜品', min: 1 });
    const orderDate = dateStr(body.orderDate, { name: '用餐日期' });
    const mealType = body.mealType;
    if (!isValidMeal(mealType)) throw badRequest('请选择餐次');
    const rating = int(body.rating, { name: '评分', min: 1, max: 5 });
    const content = str(body.content, { name: '评论', required: false, max: 500 }) || null;

    const dish = await db.queryOne('SELECT id, name FROM dishes WHERE id = ?', [dishId]);
    if (!dish) throw notFound('菜品不存在');

    await assertOrdered(req.user.id, dishId, orderDate, mealType);

    await db.query(
      `INSERT INTO dish_reviews (dish_id, user_id, order_date, meal_type, rating, content)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), content = VALUES(content)`,
      [dishId, req.user.id, orderDate, mealType, rating, content]
    );

    const row = await db.queryOne(
      'SELECT id FROM dish_reviews WHERE dish_id = ? AND user_id = ? AND order_date = ? AND meal_type = ?',
      [dishId, req.user.id, orderDate, mealType]
    );
    ok(res, { id: row.id, dishId, dishName: dish.name, orderDate, mealType, rating, content });
  })
);

/** 删除评价：只能删自己的，所有者可删任意 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '评价', min: 1 });
    const row = await db.queryOne('SELECT id, user_id FROM dish_reviews WHERE id = ?', [id]);
    if (!row) throw notFound('评价不存在');
    if (row.user_id !== req.user.id && !req.user.isOwner) {
      throw forbidden('只能删除自己的评价');
    }

    await db.query('DELETE FROM dish_reviews WHERE id = ?', [id]);
    ok(res, { deleted: true });
  })
);

module.exports = router;
