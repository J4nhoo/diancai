'use strict';

/** 图片存储入口：按 STORAGE_DRIVER 选择 local 或 r2 驱动，对上层暴露统一接口。 */

const config = require('./config');

const driver = config.storage.driver === 'r2' ? require('./storage/r2') : require('./storage/local');

module.exports = driver;
