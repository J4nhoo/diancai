'use strict';

const { badRequest } = require('./http');

function str(value, { name = '参数', min = 1, max = 255, required = true, trim = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${name}不能为空`);
    return null;
  }
  let out = String(value);
  if (trim) out = out.trim();
  if (!out) {
    if (required) throw badRequest(`${name}不能为空`);
    return null;
  }
  if (out.length < min) throw badRequest(`${name}长度不能少于 ${min} 个字符`);
  if (out.length > max) throw badRequest(`${name}长度不能超过 ${max} 个字符`);
  return out;
}

function int(value, { name = '参数', min = 0, max = Number.MAX_SAFE_INTEGER, required = true, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${name}不能为空`);
    return fallback === undefined ? null : fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${name}必须是整数`);
  if (n < min) throw badRequest(`${name}不能小于 ${min}`);
  if (n > max) throw badRequest(`${name}不能大于 ${max}`);
  return n;
}

function enumValue(value, allowed, { name = '参数', required = true, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${name}不能为空`);
    return fallback === undefined ? null : fallback;
  }
  const out = String(value).trim();
  if (!allowed.includes(out)) throw badRequest(`${name}取值不合法`);
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateStr(value, { name = '日期', required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${name}不能为空`);
    return null;
  }
  const out = String(value).trim();
  if (!DATE_RE.test(out)) throw badRequest(`${name}格式应为 YYYY-MM-DD`);
  const [y, m, d] = out.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw badRequest(`${name}不是有效日期`);
  }
  return out;
}

function todayStr(offsetDays = 0) {
  const now = new Date();
  now.setHours(now.getHours() + offsetDays * 24);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = { str, int, enumValue, dateStr, todayStr };
