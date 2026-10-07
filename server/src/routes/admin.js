'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const storage = require('../storage');
const { requireRole, ROLES } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');
const { asyncHandler, ok, badRequest, notFound, conflict, forbidden } = require('../utils/http');
const { str, int, enumValue, dateStr } = require('../utils/validate');
const { shapeUser, shapeGroup, shapeDish } = require('../utils/shape');

const router = express.Router();

router.use(requireRole('admin'));

const USER_FIELDS = 'id, username, display_name, role, status, created_at';

/** 校验图片地址必须是本站上传的图片（不接受任意外链） */
function normalizeImageUrl(value) {
  const url = str(value, { name: '图片地址', required: false, max: 512 });
  if (!url) return null;
  if (!storage.isManaged(url)) {
    throw badRequest('图片地址必须是本站上传的图片');
  }
  return url;
}

function normalizePrice(value) {
  if (value === undefined || value === null || value === '') return null;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 999999) {
    throw badRequest('价格必须是 0 到 999999 之间的数字');
  }
  return Math.round(price * 100) / 100;
}

// ============================ 账号管理 ============================

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const role = enumValue(req.query.role, ROLES, { name: '角色', required: false });
    const status = req.query.status === undefined || req.query.status === ''
      ? null
      : int(req.query.status, { name: '状态', min: 0, max: 1 });

    const where = [];
    const params = [];
    if (role) {
      where.push('role = ?');
      params.push(role);
    }
    if (status !== null) {
      where.push('status = ?');
      params.push(status);
    }
    const sql = `SELECT ${USER_FIELDS} FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY role, id`;
    const rows = await db.query(sql, params);
    ok(res, { users: rows.map(shapeUser) });
  })
);

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const username = str(req.body && req.body.username, { name: '登录名', min: 3, max: 32 });
    if (!/^[A-Za-z0-9_]+$/.test(username)) {
      throw badRequest('登录名只能包含字母、数字和下划线');
    }
    const password = str(req.body && req.body.password, { name: '密码', min: 6, max: 128 });
    const displayName = str(req.body && req.body.displayName, { name: '显示名', max: 32 });
    const role = enumValue(req.body && req.body.role, ROLES, { name: '角色' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (username, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, 1)',
      [username, hash, displayName, role]
    );
    const row = await db.queryOne(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [result.insertId]);
    ok(res, shapeUser(row));
  })
);

router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '账号', min: 1 });
    const row = await db.queryOne(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [id]);
    if (!row) throw notFound('账号不存在');
    ok(res, shapeUser(row));
  })
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '账号', min: 1 });
    const target = await db.queryOne('SELECT id, role, status FROM users WHERE id = ?', [id]);
    if (!target) throw notFound('账号不存在');

    const fields = [];
    const params = [];
    let bumpToken = false;

    const body = req.body || {};
    if (body.displayName !== undefined) {
      fields.push('display_name = ?');
      params.push(str(body.displayName, { name: '显示名', max: 32 }));
    }
    if (body.role !== undefined) {
      const role = enumValue(body.role, ROLES, { name: '角色' });
      if (id === req.user.id && role !== 'admin') {
        throw badRequest('不能修改自己的角色');
      }
      fields.push('role = ?');
      params.push(role);
      bumpToken = true;
    }
    if (body.status !== undefined) {
      const status = int(body.status, { name: '状态', min: 0, max: 1 });
      if (id === req.user.id && status !== 1) {
        throw badRequest('不能停用自己的账号');
      }
      fields.push('status = ?');
      params.push(status);
      bumpToken = true;
    }
    if (body.password !== undefined) {
      const password = str(body.password, { name: '密码', min: 6, max: 128 });
      fields.push('password_hash = ?');
      params.push(await bcrypt.hash(password, 10));
      bumpToken = true;
    }

    if (!fields.length) throw badRequest('没有需要修改的内容');
    if (bumpToken) fields.push('token_version = token_version + 1');

    params.push(id);
    await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);

    const row = await db.queryOne(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [id]);
    ok(res, shapeUser(row));
  })
);

/** 删除账号 = 停用（保留历史订单的外键），不能删除自己 */
router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '账号', min: 1 });
    if (id === req.user.id) throw forbidden('不能删除自己的账号');

    const target = await db.queryOne('SELECT id FROM users WHERE id = ?', [id]);
    if (!target) throw notFound('账号不存在');

    await db.query('UPDATE users SET status = 0, token_version = token_version + 1 WHERE id = ?', [id]);
    ok(res, { deleted: true });
  })
);

// ============================ 分组管理 ============================

router.get(
  '/groups',
  asyncHandler(async (req, res) => {
    const rows = await db.query(
      `SELECT g.id, g.name, g.sort_order, g.status, COUNT(d.id) AS dish_count
       FROM dish_groups g
       LEFT JOIN dishes d ON d.group_id = g.id
       GROUP BY g.id, g.name, g.sort_order, g.status
       ORDER BY g.sort_order, g.id`
    );
    ok(res, {
      groups: rows.map((r) => ({ ...shapeGroup(r), dishCount: Number(r.dish_count) })),
    });
  })
);

router.post(
  '/groups',
  asyncHandler(async (req, res) => {
    const name = str(req.body && req.body.name, { name: '分组名', max: 32 });
    const sortOrder = int(req.body && req.body.sortOrder, { name: '排序', required: false, min: 0, max: 9999, fallback: 0 });

    const result = await db.query(
      'INSERT INTO dish_groups (name, sort_order, status) VALUES (?, ?, 1)',
      [name, sortOrder]
    );
    const row = await db.queryOne('SELECT id, name, sort_order, status FROM dish_groups WHERE id = ?', [result.insertId]);
    ok(res, shapeGroup(row));
  })
);

router.patch(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '分组', min: 1 });
    const existing = await db.queryOne('SELECT id FROM dish_groups WHERE id = ?', [id]);
    if (!existing) throw notFound('分组不存在');

    const fields = [];
    const params = [];
    const body = req.body || {};
    if (body.name !== undefined) {
      fields.push('name = ?');
      params.push(str(body.name, { name: '分组名', max: 32 }));
    }
    if (body.sortOrder !== undefined) {
      fields.push('sort_order = ?');
      params.push(int(body.sortOrder, { name: '排序', min: 0, max: 9999 }));
    }
    if (body.status !== undefined) {
      fields.push('status = ?');
      params.push(int(body.status, { name: '状态', min: 0, max: 1 }));
    }
    if (!fields.length) throw badRequest('没有需要修改的内容');

    params.push(id);
    await db.query(`UPDATE dish_groups SET ${fields.join(', ')} WHERE id = ?`, params);
    const row = await db.queryOne('SELECT id, name, sort_order, status FROM dish_groups WHERE id = ?', [id]);
    ok(res, shapeGroup(row));
  })
);

/** 分组下有菜品时不允许删除（含已下架菜品，避免历史数据失去分组） */
router.delete(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '分组', min: 1 });
    const existing = await db.queryOne('SELECT id FROM dish_groups WHERE id = ?', [id]);
    if (!existing) throw notFound('分组不存在');

    const count = await db.queryOne('SELECT COUNT(*) AS c FROM dishes WHERE group_id = ?', [id]);
    if (Number(count.c) > 0) throw conflict('该分组下还有菜品，请先移走或删除这些菜品');

    await db.query('DELETE FROM dish_groups WHERE id = ?', [id]);
    ok(res, { deleted: true });
  })
);

// ============================ 菜品管理 ============================

router.get(
  '/dishes',
  asyncHandler(async (req, res) => {
    const groupId = int(req.query.groupId, { name: '分组', required: false, min: 1 });
    const status = req.query.status === undefined || req.query.status === ''
      ? null
      : int(req.query.status, { name: '状态', min: 0, max: 1 });

    const where = [];
    const params = [];
    if (groupId) {
      where.push('d.group_id = ?');
      params.push(groupId);
    }
    if (status !== null) {
      where.push('d.status = ?');
      params.push(status);
    }

    const rows = await db.query(
      `SELECT d.id, d.group_id, d.name, d.image_url, d.price, d.flavor, d.status, d.sort_order,
              g.name AS group_name
       FROM dishes d
       LEFT JOIN dish_groups g ON g.id = d.group_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY g.sort_order, d.group_id, d.sort_order, d.id`,
      params
    );
    ok(res, { dishes: rows.map(shapeDish) });
  })
);

router.post(
  '/dishes',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = str(body.name, { name: '菜名', max: 64 });
    const groupId = int(body.groupId, { name: '分组', min: 1 });
    const imageUrl = normalizeImageUrl(body.imageUrl);
    const price = normalizePrice(body.price);
    const sortOrder = int(body.sortOrder, { name: '排序', required: false, min: 0, max: 9999, fallback: 0 });

    const group = await db.queryOne('SELECT id FROM dish_groups WHERE id = ?', [groupId]);
    if (!group) throw badRequest('分组不存在');

    const result = await db.query(
      `INSERT INTO dishes (group_id, name, image_url, price, status, sort_order)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [groupId, name, imageUrl, price, sortOrder]
    );
    const row = await db.queryOne(
      `SELECT d.id, d.group_id, d.name, d.image_url, d.price, d.flavor, d.status, d.sort_order,
              g.name AS group_name
       FROM dishes d LEFT JOIN dish_groups g ON g.id = d.group_id WHERE d.id = ?`,
      [result.insertId]
    );
    ok(res, shapeDish(row));
  })
);

// 注意：上传/删除图片必须声明在 /dishes/:id 之前，否则会被 :id 路由拦截。
/** 上传菜品图片：交给 storage 驱动（本地磁盘或 R2），返回可直接存库的 URL */
router.post('/dishes/upload', (req, res, next) => {
  uploadImage(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return next(badRequest('请选择要上传的图片'));
    try {
      const result = await storage.put(req.file);
      return ok(res, { url: result.url, key: result.key });
    } catch (uploadErr) {
      return next(uploadErr);
    }
  });
});

/** 删除未被引用的图片（仅限本站上传的图片） */
router.delete(
  '/dishes/image',
  asyncHandler(async (req, res) => {
    const url = str(req.body && req.body.url, { name: '图片地址', max: 512 });
    if (!storage.isManaged(url)) throw badRequest('图片地址必须是本站上传的图片');

    const removed = await storage.remove(url);
    if (!removed) throw notFound('图片不存在或已被删除');
    ok(res, { deleted: true });
  })
);

router.patch(
  '/dishes/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '菜品', min: 1 });
    const existing = await db.queryOne('SELECT id FROM dishes WHERE id = ?', [id]);
    if (!existing) throw notFound('菜品不存在');

    const fields = [];
    const params = [];
    const body = req.body || {};
    if (body.name !== undefined) {
      fields.push('name = ?');
      params.push(str(body.name, { name: '菜名', max: 64 }));
    }
    if (body.groupId !== undefined) {
      const groupId = int(body.groupId, { name: '分组', min: 1 });
      const group = await db.queryOne('SELECT id FROM dish_groups WHERE id = ?', [groupId]);
      if (!group) throw badRequest('分组不存在');
      fields.push('group_id = ?');
      params.push(groupId);
    }
    if (body.imageUrl !== undefined) {
      fields.push('image_url = ?');
      params.push(normalizeImageUrl(body.imageUrl));
    }
    if (body.price !== undefined) {
      fields.push('price = ?');
      params.push(normalizePrice(body.price));
    }
    if (body.status !== undefined) {
      fields.push('status = ?');
      params.push(int(body.status, { name: '状态', min: 0, max: 1 }));
    }
    if (body.sortOrder !== undefined) {
      fields.push('sort_order = ?');
      params.push(int(body.sortOrder, { name: '排序', min: 0, max: 9999 }));
    }
    if (!fields.length) throw badRequest('没有需要修改的内容');

    params.push(id);
    await db.query(`UPDATE dishes SET ${fields.join(', ')} WHERE id = ?`, params);
    const row = await db.queryOne(
      `SELECT d.id, d.group_id, d.name, d.image_url, d.price, d.flavor, d.status, d.sort_order,
              g.name AS group_name
       FROM dishes d LEFT JOIN dish_groups g ON g.id = d.group_id WHERE d.id = ?`,
      [id]
    );
    ok(res, shapeDish(row));
  })
);

/** 删除菜品 = 下架（历史订单仍需引用菜名） */
router.delete(
  '/dishes/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '菜品', min: 1 });
    const existing = await db.queryOne('SELECT id FROM dishes WHERE id = ?', [id]);
    if (!existing) throw notFound('菜品不存在');

    await db.query('UPDATE dishes SET status = 0 WHERE id = ?', [id]);
    ok(res, { deleted: true });
  })
);

// ============================ 全部历史订单 ============================

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const date = dateStr(req.query.date, { name: '日期', required: false });
    const from = dateStr(req.query.from, { name: '起始日期', required: false });
    const to = dateStr(req.query.to, { name: '结束日期', required: false });
    const userId = int(req.query.userId, { name: '账号', required: false, min: 1 });
    const page = int(req.query.page, { name: '页码', required: false, min: 1, fallback: 1 });
    const pageSize = int(req.query.pageSize, { name: '每页条数', required: false, min: 1, max: 100, fallback: 20 });

    const where = ['o.status = 1'];
    const params = [];
    if (date) {
      where.push('o.order_date = ?');
      params.push(date);
    } else {
      if (from) {
        where.push('o.order_date >= ?');
        params.push(from);
      }
      if (to) {
        where.push('o.order_date <= ?');
        params.push(to);
      }
    }
    if (userId) {
      where.push('o.user_id = ?');
      params.push(userId);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const total = await db.queryOne(`SELECT COUNT(*) AS c FROM orders o ${whereSql}`, params);
    // page/pageSize 已通过 int() 校验为整数，直接内联，避免预编译语句对 LIMIT 占位符的兼容问题
    const offset = (page - 1) * pageSize;
    const orders = await db.query(
      `SELECT o.id, o.order_date, o.notes, u.display_name, u.username, u.role
       FROM orders o JOIN users u ON u.id = o.user_id
       ${whereSql}
       ORDER BY o.order_date DESC, o.id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    const data = [];
    for (const order of orders) {
      const items = await db.query(
        `SELECT oi.dish_id, oi.quantity, oi.flavor, d.name AS dish_name, d.image_url
         FROM order_items oi JOIN dishes d ON d.id = oi.dish_id
         WHERE oi.order_id = ? ORDER BY d.sort_order, d.id`,
        [order.id]
      );
      data.push({
        orderDate: order.order_date,
        notes: order.notes || '',
        displayName: order.display_name,
        username: order.username,
        role: order.role,
        items: items.map((i) => ({
          dishId: i.dish_id,
          dishName: i.dish_name,
          imageUrl: i.image_url || null,
          quantity: i.quantity,
          flavor: i.flavor || null,
        })),
      });
    }

    ok(res, { orders: data, total: Number(total.c), page, pageSize });
  })
);

module.exports = router;
