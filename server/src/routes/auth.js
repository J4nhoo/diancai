'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authenticate } = require('../middleware/auth');
const { asyncHandler, ok, unauthorized, badRequest } = require('../utils/http');
const { str } = require('../utils/validate');
const { shapeUser } = require('../utils/shape');

const router = express.Router();

const USER_FIELDS =
  'id, username, display_name, role, status, token_version, created_at';

/** 登录：账号不存在、已停用、密码错误统一提示，避免枚举出账号 */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const username = str(req.body && req.body.username, { name: '用户名', max: 32 });
    const password = str(req.body && req.body.password, { name: '密码', max: 128 });
    const fail = unauthorized('用户名或密码错误');

    const user = await db.queryOne(
      `SELECT ${USER_FIELDS}, password_hash FROM users WHERE username = ?`,
      [username]
    );
    if (!user || user.status !== 1) throw fail;

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) throw fail;

    ok(res, { token: signToken(user), user: shapeUser(user) });
  })
);

/** 当前登录用户 */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await db.queryOne(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [req.user.id]);
    if (!user || user.status !== 1) throw unauthorized('账号已被停用，请联系管理者');
    ok(res, shapeUser(user));
  })
);

/** 修改自己的密码。改完旧 Token 立即失效，同时给当前会话补发新 Token。 */
router.post(
  '/password',
  authenticate,
  asyncHandler(async (req, res) => {
    const oldPassword = str(req.body && req.body.oldPassword, { name: '原密码', max: 128 });
    const newPassword = str(req.body && req.body.newPassword, { name: '新密码', min: 6, max: 128 });

    const row = await db.queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!row) throw unauthorized();

    const matched = await bcrypt.compare(oldPassword, row.password_hash);
    if (!matched) throw badRequest('原密码不正确');

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
      [hash, req.user.id]
    );

    const fresh = await db.queryOne(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [req.user.id]);
    ok(res, { token: signToken(fresh), user: shapeUser(fresh) });
  })
);

module.exports = router;
