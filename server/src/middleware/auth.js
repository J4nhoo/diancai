'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden, asyncHandler } = require('../utils/http');

/**
 * 签发 Token。
 * 载荷只放 uid 与 token_version —— role 已降级为显示标签，放进来是过期副本且不参与鉴权；
 * 权限也不放进来，因为权限随时可能被改，必须每请求从库里读才能立即生效。
 */
function signToken(user) {
  return jwt.sign(
    { uid: user.id, tv: user.token_version || 0 },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

/**
 * 校验 Token，并从数据库加载最新的账号状态与权限。
 * 本来就要查库确认 status / token_version，顺带加载权限不增加往返次数。
 */
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
    `SELECT id, username, display_name, role, is_owner, status, token_version
     FROM users WHERE id = ?`,
    [payload.uid]
  );
  if (!user || user.status !== 1) throw unauthorized('账号已被停用，请联系管理者');
  if ((user.token_version || 0) !== (payload.tv || 0)) throw unauthorized('登录状态已失效，请重新登录');

  const isOwner = user.is_owner === 1;
  // 所有者拥有全部权限，不必查授权表
  const perms = isOwner
    ? null
    : new Set(
        (
          await db.query('SELECT permission FROM user_permissions WHERE user_id = ?', [user.id])
        ).map((r) => r.permission)
      );

  req.user = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    isOwner,
    perms,
  };
  next();
});

/**
 * 要求拥有其中【任一】权限即可通过（与原 requireRole 语义一致）。
 * 所有者直接放行 —— 这是防止把自己锁在系统外的兜底。
 */
const requirePermission = (...required) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.isOwner) return next();
  if (required.some((p) => req.user.perms.has(p))) return next();
  return next(forbidden('没有该操作权限，请联系管理者'));
};

module.exports = { authenticate, requirePermission, signToken };
