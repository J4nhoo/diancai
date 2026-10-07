'use strict';

const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ok } = require('../utils/http');
const authRoutes = require('./auth');
const menuRoutes = require('./menu');
const orderRoutes = require('./orders');
const summaryRoutes = require('./summary');
const adminRoutes = require('./admin');

const router = express.Router();

/** 探活：确认进程与数据库均正常 */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    await db.ping();
    ok(res, { status: 'ok', db: 'up' });
  })
);

router.use('/auth', authRoutes);
router.use('/menu', menuRoutes);
router.use('/orders', orderRoutes);
router.use('/summary', summaryRoutes);
router.use('/admin', authenticate, adminRoutes);

module.exports = router;
