'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden, asyncHandler } = require('../utils/http');

const ROLES = ['family', 'chef', 'admin'];

function signToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, tv: user.token_version || 0 },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

/** 校验 Token，并从数据库加载最新的账号状态（禁用 / 改密后立即失效） */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? '登录已过期，请重新登录' : '登录状态无效，请重新登录');
  }

  const user = await db.queryOne(
    'SELECT id, username, display_name, role, status, token_version FROM users WHERE id = ?',
    [payload.uid]
  );
  if (!user || user.status !== 1) throw unauthorized('账号已被停用，请联系管理者');
  if ((user.token_version || 0) !== (payload.tv || 0)) throw unauthorized('登录状态已失效，请重新登录');

  req.user = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
  };
  next();
});

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden('当前角色无权进行该操作'));
  return next();
};

module.exports = { authenticate, requireRole, signToken, ROLES };
