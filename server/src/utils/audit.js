'use strict';

const db = require('../db');

/**
 * 写一条操作记录。
 *
 * 接收【事务连接】而非全局 pool —— 日志必须与业务变更在同一个事务里落地，
 * 否则变更成功而日志丢失（或反之）会让记录失去可信度。
 *
 * actorName / targetName 存快照而非外键：账号被停用或改名后，历史记录仍要读得懂。
 *
 * @param {object} conn  事务连接（db.withTransaction 的入参）
 * @param {object} entry
 * @param {object} entry.actor      { id, displayName }
 * @param {string} entry.action     如 'dish.update'
 * @param {string} entry.targetType 'dish' | 'group' | 'user' | 'permission'
 * @param {number|null} entry.targetId
 * @param {string|null} entry.targetName
 * @param {object|null} entry.before
 * @param {object|null} entry.after
 */
async function record(conn, { actor, action, targetType, targetId, targetName, before, after }) {
  await conn.query(
    `INSERT INTO audit_logs
       (actor_id, actor_name, action, target_type, target_id, target_name, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actor ? actor.id : null,
      actor ? (actor.displayName || actor.username || '未知') : '系统',
      action,
      targetType,
      targetId === undefined ? null : targetId,
      targetName === undefined ? null : targetName,
      before === undefined || before === null ? null : JSON.stringify(before),
      after === undefined || after === null ? null : JSON.stringify(after),
    ]
  );
}

/** 造一个 actor 对象，供路由里从 req.user 取 */
function actorOf(req) {
  return { id: req.user.id, displayName: req.user.displayName, username: req.user.username };
}

/** 只保留发生变化的字段，让日志更易读；无变化返回 null */
function diffFields(before, after, fields) {
  const b = {};
  const a = {};
  let changed = false;
  for (const f of fields) {
    const bv = before ? before[f] : undefined;
    const av = after ? after[f] : undefined;
    if (String(bv) !== String(av)) {
      b[f] = bv === undefined ? null : bv;
      a[f] = av === undefined ? null : av;
      changed = true;
    }
  }
  return changed ? { before: b, after: a } : null;
}

/** 分页查询操作记录 */
async function list({ from, to, targetType, actorId, page = 1, pageSize = 20 }) {
  const where = [];
  const params = [];
  if (from) {
    where.push('created_at >= ?');
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(`${to} 23:59:59`);
  }
  if (targetType) {
    where.push('target_type = ?');
    params.push(targetType);
  }
  if (actorId) {
    where.push('actor_id = ?');
    params.push(actorId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await db.queryOne(`SELECT COUNT(*) AS c FROM audit_logs ${whereSql}`, params);
  const offset = (page - 1) * pageSize;
  // page/pageSize 已经过 int() 校验为整数，直接内联（预编译语句对 LIMIT 占位符有兼容问题）
  const rows = await db.query(
    `SELECT id, actor_id, actor_name, action, target_type, target_id, target_name,
            before_json, after_json, created_at
     FROM audit_logs ${whereSql}
     ORDER BY id DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return {
    total: Number(totalRow.c),
    page,
    pageSize,
    logs: rows.map((r) => ({
      id: Number(r.id),
      actorId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      targetName: r.target_name,
      // mysql2 对 JSON 列会自动反序列化，但字符串也兜底一下
      before: parseJson(r.before_json),
      after: parseJson(r.after_json),
      createdAt: r.created_at,
    })),
  };
}

function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch (_) {
    return null;
  }
}

module.exports = { record, actorOf, diffFields, list };
