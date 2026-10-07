'use strict';

const multer = require('multer');
const config = require('../config');
const { badRequest } = require('../utils/http');
const { ALLOWED_MIME, extOf, ALLOWED_EXT } = require('../storage/naming');

// 用内存存储：文件先进 buffer，再由 storage 驱动决定落磁盘还是传 R2。
// 体积上限受 config.upload.maxBytes 约束，不会吃太多内存。
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(badRequest('图片格式仅支持 jpg / png / webp'));
      return;
    }
    if (!ALLOWED_EXT.has(extOf(file.originalname))) {
      cb(badRequest('图片格式仅支持 jpg / png / webp'));
      return;
    }
    cb(null, true);
  },
}).single('image');

module.exports = { uploadImage };
