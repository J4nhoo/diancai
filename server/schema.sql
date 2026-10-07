-- 家庭点菜 H5 —— 数据库结构
-- 全部使用 utf8mb4，支持中文菜名与备注。
-- 本文件可重复执行（CREATE TABLE IF NOT EXISTS）。

SET NAMES utf8mb4;

-- ---------- 账号 ----------
-- 账号只能由管理者创建，不开放注册。
-- token_version 用于让已签发的 Token 立即失效（改密 / 停用 / 改角色时自增）。
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(32)  NOT NULL                COMMENT '登录名',
  password_hash VARCHAR(100) NOT NULL                COMMENT 'bcrypt 哈希',
  display_name  VARCHAR(32)  NOT NULL                COMMENT '显示名',
  role          ENUM('family','chef','admin') NOT NULL DEFAULT 'family' COMMENT '角色：家人/厨师/管理者',
  status        TINYINT      NOT NULL DEFAULT 1      COMMENT '1 启用，0 停用',
  token_version INT UNSIGNED NOT NULL DEFAULT 0      COMMENT 'Token 版本，自增即让旧 Token 失效',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  KEY idx_users_role_status (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账号';

-- ---------- 菜品分组 ----------
CREATE TABLE IF NOT EXISTS dish_groups (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(32)  NOT NULL              COMMENT '分组名，如 荤菜/素菜/汤/主食',
  sort_order INT          NOT NULL DEFAULT 0    COMMENT '排序，越小越靠前',
  status     TINYINT      NOT NULL DEFAULT 1    COMMENT '1 启用，0 停用',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_groups_name (name),
  KEY idx_groups_sort (status, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='菜品分组';

-- ---------- 菜品 ----------
-- 菜品不做物理删除（管理员"删除"等于下架）。order_items 对 dishes 是 RESTRICT，
-- 保证历史订单汇总永远能取到菜名。
-- flavor 为预留的口味/做法结构化配置（JSON），本期不填，将来无需改表。
CREATE TABLE IF NOT EXISTS dishes (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id   INT UNSIGNED NOT NULL              COMMENT '所属分组',
  name       VARCHAR(64)  NOT NULL              COMMENT '菜名',
  image_url  VARCHAR(255) NULL                  COMMENT '图片地址，仅存 URL，文件在服务器/Nginx',
  price      DECIMAL(8,2) NULL                  COMMENT '参考价，可为空',
  flavor     JSON         NULL                  COMMENT '预留：口味/调料结构化配置',
  status     TINYINT      NOT NULL DEFAULT 1    COMMENT '1 上架，0 下架',
  sort_order INT          NOT NULL DEFAULT 0    COMMENT '组内排序',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dishes_name (name),
  KEY idx_dishes_group (group_id, status, sort_order, id),
  CONSTRAINT fk_dishes_group FOREIGN KEY (group_id) REFERENCES dish_groups (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='菜品';

-- ---------- 订单 ----------
-- 一人一天一单：唯一键 (order_date, user_id)。
-- 提交为幂等 upsert，家人改"今天吃什么"不会产生重复单。
-- 将来若要区分午餐/晚餐，加 meal_type 列并把唯一键扩为三列即可。
CREATE TABLE IF NOT EXISTS orders (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL              COMMENT '下单人',
  order_date DATE         NOT NULL              COMMENT '用餐日期',
  notes      VARCHAR(500) NULL                  COMMENT '忌口/整体备注',
  status     TINYINT      NOT NULL DEFAULT 1    COMMENT '1 有效，0 已撤销',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_orders_date_user (order_date, user_id),
  KEY idx_orders_date (order_date, status),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单';

-- ---------- 订单明细 ----------
-- 同一单内同一道菜只保留一行（唯一键），数量累加。
-- flavor 为预留的单品口味备注。
CREATE TABLE IF NOT EXISTS order_items (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  dish_id  INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1     COMMENT '份数',
  flavor   VARCHAR(100) NULL                   COMMENT '预留：单品口味备注',
  PRIMARY KEY (id),
  UNIQUE KEY uk_items_order_dish (order_id, dish_id),
  KEY idx_items_dish (dish_id),
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_items_dish  FOREIGN KEY (dish_id)  REFERENCES dishes (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单明细';
