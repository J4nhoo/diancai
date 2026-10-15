'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const storage = require('../storage');
const { requirePermission } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');
const { asyncHandler, ok, badRequest, notFound, conflict, forbidden } = require('../utils/http');
const { str, int, dateStr } = require('../utils/validate');
const { shapeUser, shapeGroup, shapeDish } = require('../utils/shape');
const { PERMISSIONS, PERMISSION_KEYS, isValidPermission } = require('../permissions');
const audit = require('../utils/audit');

const router = express.Router();

// 各接口权限不同，逐个挂 requirePermission（不再用整路由的角色门禁）

const USER_FIELDS = 'id, username, display_name, role, is_owner, status, created_at';

/** 校验图片地址必须是本站上传的图片（不接受任意外链） */
function normalizeImageUrl(value) {
  const url = str(value, { name: '图片地址', required: false, max: 512 });
  if (!url) return null;
  if (!storage.isManaged(url)) {
    throw badRequest('图片地址必须是本站上传的图片');
  }
  return url;
}

// ============================ 权限目录 ============================

/** 权限清单，供管理界面渲染勾选框。任何已登录用户可读（不含敏感信息）。 */
router.get(
  '/permissions',
  asyncHandler(async (req, res) => {
    ok(res, { permissions: PERMISSIONS });
  })
);

// ============================ 账号管理 ============================

/** 读某账号的权限列表 */
async function permsOf(userId) {
  const rows = await db.query(
    'SELECT permission FROM user_permissions WHERE user_id = ? ORDER BY permission',
    [userId]
  );
  return rows.map((r) => r.permission);
}

router.get(
  '/users',
  requirePermission('user.manage'),
  asyncHandler(async (req, res) => {
    // 角色现在是自由文本标签，只做模糊筛选，不再校验枚举
    const role = str(req.query.role, { name: '角色', required: false, max: 32 });
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
    const sql = `SELECT ${USER_FIELDS} FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`;
    const rows = await db.query(sql, params);

    // 一次查出全部权限，避免逐个账号查询（N+1）
    const permRows = await db.query('SELECT user_id, permission FROM user_permissions');
    const byUser = new Map();
    for (const r of permRows) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id).push(r.permission);
    }

    ok(res, {
      users: rows.map((r) => shapeUser(r, r.is_owner === 1 ? null : byUser.get(r.id) || [])),
    });
  })
);

router.post(
  '/users',
  requirePermission('user.manage'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const username = str(body.username, { name: '登录名', min: 3, max: 32 });
    if (!/^[A-Za-z0-9_]+$/.test(username)) {
      throw badRequest('登录名只能包含字母、数字和下划线');
    }
    const password = str(body.password, { name: '密码', min: 6, max: 128 });
    const displayName = str(body.displayName, { name: '显示名', max: 32 });
    const role = str(body.role, { name: '角色标签', required: false, max: 32 }) || '家人';

    // 权限是可选参数；只有拥有 user.grant 的人才能在建号时一并授予
    const requested = Array.isArray(body.permissions) ? body.permissions : null;
    if (requested) {
      if (!req.user.isOwner && !req.user.perms.has('user.grant')) {
        throw forbidden('没有分配权限的权限');
      }
      for (const p of requested) {
        if (!isValidPermission(p)) throw badRequest(`未知权限：${p}`);
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const created = await db.withTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO users (username, password_hash, display_name, role, is_owner, status)
         VALUES (?, ?, ?, ?, 0, 1)`,
        [username, hash, displayName, role]
      );
      const id = result.insertId;

      if (requested && requested.length) {
        await conn.query('INSERT IGNORE INTO user_permissions (user_id, permission, granted_by) VALUES ?', [
          requested.map((p) => [id, p, req.user.id]),
        ]);
      }

      await audit.record(conn, {
        actor: audit.actorOf(req),
        action: 'user.create',
        targetType: 'user',
        targetId: id,
        targetName: displayName,
        before: null,
        after: { username, displayName, role, permissions: requested || [] },
      });
      return id;
    });

    const row = await db.queryOne(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [created]);
    ok(res, shapeUser(row, await permsOf(created)));
  })
);

router.get(
  '/users/:id',
  requirePermission('user.manage', 'user.grant'),
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '账号', min: 1 });
    const row = await db.queryOne(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [id]);
    if (!row) throw notFound('账号不存在');
    ok(res, shapeUser(row, row.is_owner === 1 ? null : await permsOf(id)));
  })
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '账号', min: 1 });
    const body = req.body || {};

    const target = await db.queryOne(
      'SELECT id, username, display_name, role, is_owner, status FROM users WHERE id = ?',
      [id]
    );
    if (!target) throw notFound('账号不存在');
    if (target.is_owner === 1) throw forbidden('所有者账号不可修改，请用命令行脚本操作');

    const changesPerms = body.permissions !== undefined;
    // 改资料要 user.manage，改权限要 user.grant
    const need = changesPerms ? 'user.grant' : 'user.manage';
    if (!req.user.isOwner && !req.user.perms.has(need)) {
      throw forbidden(changesPerms ? '没有分配权限的权限' : '没有管理账号的权限');
    }

    // 防止把自己关在门外：非所有者不能撤销自己的 user.grant
    if (changesPerms && id === req.user.id && !req.user.isOwner) {
      const next = Array.isArray(body.permissions) ? body.permissions : [];
      if (!next.includes('user.grant')) {
        throw badRequest('不能撤销自己的「分配权限」权限');
      }
    }

    // 非所有者不能停用自己
    if (body.status !== undefined && id === req.user.id && int(body.status, { name: '状态', min: 0, max: 1 }) !== 1) {
      throw badRequest('不能停用自己的账号');
    }

    const beforePerms = changesPerms ? await permsOf(id) : null;

    const fields = [];
    const params = [];
    let bumpToken = false;
    const beforeProfile = {
      displayName: target.display_name,
      role: target.role,
      status: target.status,
    };
    const afterProfile = { ...beforeProfile };

    if (body.displayName !== undefined) {
      const v = str(body.displayName, { name: '显示名', max: 32 });
      fields.push('display_name = ?');
      params.push(v);
      afterProfile.displayName = v;
    }
    if (body.role !== undefined) {
      // 角色是纯标签，改了不影响任何权限，也不让 token 失效
      const v = str(body.role, { name: '角色标签', max: 32 });
      fields.push('role = ?');
      params.push(v);
      afterProfile.role = v;
    }
    if (body.status !== undefined) {
      const v = int(body.status, { name: '状态', min: 0, max: 1 });
      fields.push('status = ?');
      params.push(v);
      afterProfile.status = v;
      bumpToken = true;
    }
    let passwordChanged = false;
    if (body.password !== undefined) {
      const password = str(body.password, { name: '密码', min: 6, max: 128 });
      fields.push('password_hash = ?');
      params.push(await bcrypt.hash(password, 10));
      bumpToken = true;
      passwordChanged = true;
    }

    if (!fields.length && !changesPerms) throw badRequest('没有需要修改的内容');

    await db.withTransaction(async (conn) => {
      if (fields.length) {
        if (bumpToken) fields.push('token_version = token_version + 1');
        const p = [...params, id];
        await conn.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, p);
      }

      const actor = audit.actorOf(req);

      if (passwordChanged) {
        // 只记「已修改」，绝不记录密码或哈希
        await audit.record(conn, {
          actor,
          action: 'user.password',
          targetType: 'user',
          targetId: id,
          targetName: target.display_name,
          before: null,
          after: { password: '已重置' },
        });
      }

      const profileDiff = audit.diffFields(beforeProfile, afterProfile, ['displayName', 'role', 'status']);
      if (profileDiff) {
        await audit.record(conn, {
          actor,
          action: 'user.update',
          targetType: 'user',
          targetId: id,
          targetName: afterProfile.displayName,
          before: profileDiff.before,
          after: profileDiff.after,
        });
      }

      if (changesPerms) {
        const next = Array.isArray(body.permissions) ? body.permissions : [];
        for (const p of next) {
          if (!isValidPermission(p)) throw badRequest(`未知权限：${p}`);
        }
        const nextSet = new Set(next);
        const beforeSet = new Set(beforePerms);
        const added = next.filter((p) => !beforeSet.has(p));
        const removed = beforePerms.filter((p) => !nextSet.has(p));

        if (removed.length) {
          await conn.query(
            `DELETE FROM user_permissions WHERE user_id = ? AND permission IN (${removed.map(() => '?').join(',')})`,
            [id, ...removed]
          );
          await audit.record(conn, {
            actor,
            action: 'perm.revoke',
            targetType: 'permission',
            targetId: id,
            targetName: target.display_name,
            before: { permissions: removed },
            after: null,
          });
        }
        if (added.length) {
          await conn.query('INSERT IGNORE INTO user_permissions (user_id, permission, granted_by) VALUES ?', [
            added.map((p) => [id, p, req.user.id]),
          ]);
          await audit.record(conn, {
            actor,
            action: 'perm.grant',
            targetType: 'permission',
            targetId: id,
            targetName: target.display_name,
            before: null,
            after: { permissions: added },
          });
        }
      }
    });

    const row = await db.queryOne(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [id]);
    ok(res, shapeUser(row, row.is_owner === 1 ? null : await permsOf(id)));
  })
);

/** 删除账号 = 停用（保留历史订单的外键），不能删除自己，不能停用所有者 */
router.delete(
  '/users/:id',
  requirePermission('user.manage'),
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '账号', min: 1 });
    if (id === req.user.id) throw forbidden('不能删除自己的账号');

    const target = await db.queryOne(
      'SELECT id, display_name, is_owner FROM users WHERE id = ?',
      [id]
    );
    if (!target) throw notFound('账号不存在');
    if (target.is_owner === 1) throw forbidden('所有者账号不可停用');

    await db.withTransaction(async (conn) => {
      await conn.query('UPDATE users SET status = 0, token_version = token_version + 1 WHERE id = ?', [id]);
      await audit.record(conn, {
        actor: audit.actorOf(req),
        action: 'user.disable',
        targetType: 'user',
        targetId: id,
        targetName: target.display_name,
        before: { status: 1 },
        after: { status: 0 },
      });
    });

    ok(res, { deleted: true });
  })
);

// ============================ 分组管理 ============================

router.get(
  '/groups',
  requirePermission('menu.view', 'menu.manage'),
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
  requirePermission('menu.manage'),
  asyncHandler(async (req, res) => {
    const name = str(req.body && req.body.name, { name: '分组名', max: 32 });
    const sortOrder = int(req.body && req.body.sortOrder, { name: '排序', required: false, min: 0, max: 9999, fallback: 0 });

    const row = await db.withTransaction(async (conn) => {
      const [result] = await conn.query(
        'INSERT INTO dish_groups (name, sort_order, status) VALUES (?, ?, 1)',
        [name, sortOrder]
      );
      const [rows] = await conn.query(
        'SELECT id, name, sort_order, status FROM dish_groups WHERE id = ?',
        [result.insertId]
      );
      await audit.record(conn, {
        actor: audit.actorOf(req),
        action: 'group.create',
        targetType: 'group',
        targetId: result.insertId,
        targetName: name,
        before: null,
        after: { name, sortOrder, status: 1 },
      });
      return rows[0];
    });

    ok(res, shapeGroup(row));
  })
);

router.patch(
  '/groups/:id',
  requirePermission('menu.manage'),
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '分组', min: 1 });
    const existing = await db.queryOne(
      'SELECT id, name, sort_order, status FROM dish_groups WHERE id = ?',
      [id]
    );
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

    const row = await db.withTransaction(async (conn) => {
      await conn.query(`UPDATE dish_groups SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
      const [rows] = await conn.query(
        'SELECT id, name, sort_order, status FROM dish_groups WHERE id = ?',
        [id]
      );
      const after = rows[0];
      const diff = audit.diffFields(
        { name: existing.name, sortOrder: existing.sort_order, status: existing.status },
        { name: after.name, sortOrder: after.sort_order, status: after.status },
        ['name', 'sortOrder', 'status']
      );
      if (diff) {
        await audit.record(conn, {
          actor: audit.actorOf(req),
          action: 'group.update',
          targetType: 'group',
          targetId: id,
          targetName: after.name,
          before: diff.before,
          after: diff.after,
        });
      }
      return after;
    });

    ok(res, shapeGroup(row));
  })
);

/** 分组下有菜品时不允许删除（含已下架菜品，避免历史数据失去分组） */
router.delete(
  '/groups/:id',
  requirePermission('menu.manage'),
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '分组', min: 1 });
    const existing = await db.queryOne('SELECT id, name FROM dish_groups WHERE id = ?', [id]);
    if (!existing) throw notFound('分组不存在');

    const count = await db.queryOne('SELECT COUNT(*) AS c FROM dishes WHERE group_id = ?', [id]);
    if (Number(count.c) > 0) throw conflict('该分组下还有菜品，请先移走或删除这些菜品');

    await db.withTransaction(async (conn) => {
      await conn.query('DELETE FROM dish_groups WHERE id = ?', [id]);
      await audit.record(conn, {
        actor: audit.actorOf(req),
        action: 'group.delete',
        targetType: 'group',
        targetId: id,
        targetName: existing.name,
        before: { name: existing.name },
        after: null,
      });
    });

    ok(res, { deleted: true });
  })
);

// ============================ 菜品管理 ============================

router.get(
  '/dishes',
  requirePermission('menu.view', 'menu.manage'),
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
      `SELECT d.id, d.group_id, d.name, d.image_url, d.notes, d.flavor, d.status,
              g.name AS group_name
       FROM dishes d
       LEFT JOIN dish_groups g ON g.id = d.group_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY g.sort_order, d.group_id, d.id`,
      params
    );
    ok(res, { dishes: rows.map(shapeDish) });
  })
);

router.post(
  '/dishes',
  requirePermission('menu.manage'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = str(body.name, { name: '菜名', max: 64 });
    const groupId = int(body.groupId, { name: '分组', min: 1 });
    const imageUrl = normalizeImageUrl(body.imageUrl);
    const notes = str(body.notes, { name: '备注', required: false, max: 500 }) || null;

    const group = await db.queryOne('SELECT id, name FROM dish_groups WHERE id = ?', [groupId]);
    if (!group) throw badRequest('分组不存在');

    const row = await db.withTransaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO dishes (group_id, name, image_url, notes, status)
         VALUES (?, ?, ?, ?, 1)`,
        [groupId, name, imageUrl, notes]
      );
      const [rows] = await conn.query(
        `SELECT d.id, d.group_id, d.name, d.image_url, d.notes, d.flavor, d.status,
                g.name AS group_name
         FROM dishes d LEFT JOIN dish_groups g ON g.id = d.group_id WHERE d.id = ?`,
        [result.insertId]
      );
      await audit.record(conn, {
        actor: audit.actorOf(req),
        action: 'dish.create',
        targetType: 'dish',
        targetId: result.insertId,
        targetName: name,
        before: null,
        after: { name, group: group.name, notes, status: 1 },
      });
      return rows[0];
    });

    ok(res, shapeDish(row));
  })
);

// 注意：上传/删除图片必须声明在 /dishes/:id 之前，否则会被 :id 路由拦截。
/** 上传菜品图片：交给 storage 驱动（本地磁盘或 COS），返回可直接存库的 URL */
router.post('/dishes/upload', requirePermission('menu.manage'), (req, res, next) => {
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
  requirePermission('menu.manage'),
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
  requirePermission('menu.manage'),
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '菜品', min: 1 });
    const existing = await db.queryOne(
      `SELECT d.id, d.name, d.group_id, d.image_url, d.notes, d.status,
              g.name AS group_name
       FROM dishes d LEFT JOIN dish_groups g ON g.id = d.group_id WHERE d.id = ?`,
      [id]
    );
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
      const group = await db.queryOne('SELECT id, name FROM dish_groups WHERE id = ?', [groupId]);
      if (!group) throw badRequest('分组不存在');
      fields.push('group_id = ?');
      params.push(groupId);
    }
    if (body.imageUrl !== undefined) {
      fields.push('image_url = ?');
      params.push(normalizeImageUrl(body.imageUrl));
    }
    if (body.notes !== undefined) {
      fields.push('notes = ?');
      params.push(str(body.notes, { name: '备注', required: false, max: 500 }) || null);
    }
    if (body.status !== undefined) {
      fields.push('status = ?');
      params.push(int(body.status, { name: '状态', min: 0, max: 1 }));
    }
    if (!fields.length) throw badRequest('没有需要修改的内容');

    const row = await db.withTransaction(async (conn) => {
      await conn.query(`UPDATE dishes SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
      const [rows] = await conn.query(
        `SELECT d.id, d.group_id, d.name, d.image_url, d.notes, d.flavor, d.status,
                g.name AS group_name
         FROM dishes d LEFT JOIN dish_groups g ON g.id = d.group_id WHERE d.id = ?`,
        [id]
      );
      const after = rows[0];
      const before = {
        name: existing.name,
        group: existing.group_name,
        notes: existing.notes,
        status: existing.status,
      };
      const now = {
        name: after.name,
        group: after.group_name,
        notes: after.notes,
        status: after.status,
      };
      const diff = audit.diffFields(before, now, ['name', 'group', 'notes', 'status']);
      if (diff) {
        await audit.record(conn, {
          actor: audit.actorOf(req),
          action: body.status === 0 && existing.status === 1 ? 'dish.off' : 'dish.update',
          targetType: 'dish',
          targetId: id,
          targetName: after.name,
          before: diff.before,
          after: diff.after,
        });
      }
      return after;
    });

    ok(res, shapeDish(row));
  })
);

/**
 * 删除菜品。
 *
 * 只允许删除【从未被点过】的菜：一旦出现在任何订单明细里，物理删除会让历史汇总
 * 失去菜名（order_items.dish_id 是 RESTRICT，本来也删不掉），这种情况提示改用下架。
 */
router.delete(
  '/dishes/:id',
  requirePermission('menu.manage'),
  asyncHandler(async (req, res) => {
    const id = int(req.params.id, { name: '菜品', min: 1 });
    const existing = await db.queryOne(
      'SELECT id, name, image_url, status FROM dishes WHERE id = ?',
      [id]
    );
    if (!existing) throw notFound('菜品不存在');

    const used = await db.queryOne('SELECT COUNT(*) AS c FROM order_items WHERE dish_id = ?', [id]);
    if (Number(used.c) > 0) {
      throw conflict('该菜品已被点过，删除会让历史订单失去菜名；如需隐藏请改为「下架」');
    }

    await db.withTransaction(async (conn) => {
      await conn.query('DELETE FROM dishes WHERE id = ?', [id]);
      await audit.record(conn, {
        actor: audit.actorOf(req),
        action: 'dish.delete',
        targetType: 'dish',
        targetId: id,
        targetName: existing.name,
        before: { name: existing.name, status: existing.status },
        after: null,
      });
    });

    // 图片是独立资源，库删掉后顺带清理，避免留下孤儿文件（失败不影响删除结果）
    if (existing.image_url) {
      try {
        await storage.remove(existing.image_url);
      } catch (err) {
        console.error('[dishes] 删除图片文件失败：', err.message);
      }
    }

    ok(res, { deleted: true });
  })
);

// ============================ 全部历史订单 ============================

router.get(
  '/orders',
  requirePermission('order.viewAll'),
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
         WHERE oi.order_id = ? ORDER BY d.id`,
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

// ============================ 操作记录 ============================

const AUDIT_TARGETS = ['dish', 'group', 'user', 'permission', 'log'];

router.get(
  '/audit-logs',
  requirePermission('log.view'),
  asyncHandler(async (req, res) => {
    const from = dateStr(req.query.from, { name: '起始日期', required: false });
    const to = dateStr(req.query.to, { name: '结束日期', required: false });
    const targetType = str(req.query.targetType, { name: '对象类型', required: false, max: 16 });
    if (targetType && !AUDIT_TARGETS.includes(targetType)) {
      throw badRequest('对象类型不合法');
    }
    const actorId = int(req.query.actorId, { name: '操作人', required: false, min: 1 });
    const page = int(req.query.page, { name: '页码', required: false, min: 1, fallback: 1 });
    const pageSize = int(req.query.pageSize, { name: '每页条数', required: false, min: 1, max: 100, fallback: 20 });

    ok(res, await audit.list({ from, to, targetType, actorId, page, pageSize }));
  })
);

/**
 * 删除操作记录。
 *
 * 所有者删除【不留痕】—— 它是可信的引导账号，用于清理误记数据。
 * 其他持有 log.delete 的人删除会【再写一条记录】，否则拿到这个权限的人
 * 就能把自己的操作痕迹抹干净，审计也就失去意义了。
 */
router.delete(
  '/audit-logs',
  requirePermission('log.delete'),
  asyncHandler(async (req, res) => {
    const raw = req.body && req.body.ids;
    if (!Array.isArray(raw) || raw.length === 0) throw badRequest('请选择要删除的记录');
    if (raw.length > 200) throw badRequest('一次最多删除 200 条');
    const ids = raw.map((v, i) => int(v, { name: `第 ${i + 1} 条记录`, min: 1 }));

    const deleted = await db.withTransaction(async (conn) => {
      const [r] = await conn.query(
        `DELETE FROM audit_logs WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      if (!req.user.isOwner && r.affectedRows > 0) {
        await audit.record(conn, {
          actor: audit.actorOf(req),
          action: 'log.delete',
          targetType: 'log',
          targetId: null,
          targetName: `删除 ${r.affectedRows} 条记录`,
          before: { ids },
          after: null,
        });
      }
      return r.affectedRows;
    });

    ok(res, { deleted: true, count: deleted });
  })
);

module.exports = router;
