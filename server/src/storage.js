'use strict';

/**
 * 图片存储入口：按 STORAGE_DRIVER 选择驱动，对上层暴露统一接口。
 * 同时把驱动抛出的错误统一标记 isStorageError，
 * 让统一的错误处理能把它们翻译成可读提示（见 middleware/error.js）。
 */

const config = require('./config');

const DRIVERS = {
  local: './storage/local',
  r2: './storage/r2',
  cos: './storage/cos',
};

const driver = require(DRIVERS[config.storage.driver]);

/** 给错误打上存储标记，便于上层区分「存储失败」与「数据库失败」 */
function mark(err) {
  if (err && typeof err === 'object') err.isStorageError = true;
  return err;
}

/** 包一层，保证驱动里任何异常都带上标记 */
function wrap(fn) {
  return (...args) => {
    try {
      const out = fn(...args);
      return out && typeof out.then === 'function' ? out.catch((e) => { throw mark(e); }) : out;
    } catch (e) {
      throw mark(e);
    }
  };
}

module.exports = {
  name: driver.name,
  ensureDir: () => driver.ensureDir(),
  shouldServeStatic: () => driver.shouldServeStatic(),
  isManaged: (url) => driver.isManaged(url),
  put: wrap(driver.put),
  remove: wrap(driver.remove),
  ...(driver.verify ? { verify: wrap(driver.verify) } : {}),
};
