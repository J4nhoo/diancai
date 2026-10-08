'use strict';

/** 图片存储入口：按 STORAGE_DRIVER 选择驱动，对上层暴露统一接口。 */

const config = require('./config');

const DRIVERS = {
  local: './storage/local',
  r2: './storage/r2',
  cos: './storage/cos',
};

const driver = require(DRIVERS[config.storage.driver]);

module.exports = driver;
