'use strict';

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
  }
}

const badRequest = (message, code) => new HttpError(400, message, code || 'BAD_REQUEST');
const unauthorized = (message, code) => new HttpError(401, message || '请先登录', code || 'UNAUTHORIZED');
const forbidden = (message) => new HttpError(403, message || '没有操作权限', 'FORBIDDEN');
const notFound = (message) => new HttpError(404, message || '内容不存在', 'NOT_FOUND');
const conflict = (message) => new HttpError(409, message, 'CONFLICT');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function ok(res, data) {
  res.json({ ok: true, data: data === undefined ? null : data });
}

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, asyncHandler, ok };
