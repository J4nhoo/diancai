'use strict';

const db = require('../db');
const { MEAL_CUTOFF } = require('../meals');

/**
 * 订单状态推进。
 *
 *   pending  + 已过截止 → overdue（已逾期）
 *   confirmed + 已过截止 → completed（已完成）
 *
 * 为什么放在「请求时」而不是定时任务：服务可能长时间没人访问（甚至停着），
 * 定时器要么空转要么根本没跑。读接口顺手扫一遍，效果一样且不用常驻。
 * 没人访问时状态暂时不动，但下次访问会一次性补齐，结果一致。
 */

// 把 (日期, 餐次) 拼成一个具体时刻，用于和 NOW() 比较。
// 截止时间来自常量，不含用户输入，直接内联是安全的。
function cutoffTimestampSql() {
  const cases = Object.entries(MEAL_CUTOFF)
    .map(([meal, time]) => `WHEN '${meal}' THEN '${time}:00'`)
    .join(' ');
  return `TIMESTAMP(order_date, CASE meal_type ${cases} ELSE '23:59:59' END)`;
}

const ADVANCE_SQL = `
  UPDATE orders
  SET status = CASE
    WHEN status = 'pending'   THEN 'overdue'
    WHEN status = 'confirmed' THEN 'completed'
    ELSE status
  END
  WHERE status IN ('pending', 'confirmed')
    AND ${cutoffTimestampSql()} < NOW()`;

/**
 * 推进所有已到期的订单。返回受影响行数。
 * 调用方应容忍失败 —— 状态推进失败不应该让主查询也挂掉。
 */
async function advanceExpired() {
  const [result] = await db.pool.query(ADVANCE_SQL);
  return result.affectedRows;
}

/** 包一层：失败只记日志，不影响调用方 */
async function safeAdvanceExpired() {
  try {
    return await advanceExpired();
  } catch (err) {
    console.error('[orderStatus] 推进状态失败：', err.message);
    return 0;
  }
}

/**
 * 订单是否还能被下单人修改。
 * 只有「待确认」能改 —— 一旦厨师确认（或已逾期/完成），就锁定了。
 */
function isEditableByOwner(status) {
  return status === 'pending';
}

/**
 * 订单状态。后端只存英文枚举，中文文案在这里维护一份供错误提示用
 * （前端另有一份展示用的，两边改的时候要一起改）。
 */
const ORDER_STATUS = ['pending', 'confirmed', 'overdue', 'completed'];

const STATUS_TEXT = {
  pending: '待确认',
  confirmed: '已确认',
  overdue: '已逾期',
  completed: '已完成',
};

function statusText(status) {
  return STATUS_TEXT[status] || status;
}

module.exports = {
  advanceExpired,
  safeAdvanceExpired,
  isEditableByOwner,
  cutoffTimestampSql,
  ORDER_STATUS,
  STATUS_TEXT,
  statusText,
};
