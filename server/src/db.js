'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  // DATE / DATETIME 统一按字符串返回，避免时区偏移导致日期错位
  dateStrings: ['DATE', 'DATETIME', 'TIMESTAMP'],
  // 托管数据库（Aiven 等）强制 TLS
  ...(config.db.ssl
    ? { ssl: { rejectUnauthorized: config.db.sslRejectUnauthorized } }
    : {}),
});

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function withTransaction(handler) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await handler(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, queryOne, withTransaction, ping };
