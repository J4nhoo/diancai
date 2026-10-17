-- 家庭点菜 H5 —— 数据库结构
-- 全部使用 utf8mb4，支持中文菜名与备注。
-- 本文件可重复执行（CREATE TABLE IF NOT EXISTS）。

SET NAMES utf8mb4;

-- ---------- 账号 ----------
-- 账号只能由所有者/有权限的人创建，不开放注册。
-- role 只是显示标签（如「姐姐」「厨师」），不参与鉴权；权限见 user_permissions。
-- is_owner 是引导概念：所有者永远拥有全部权限，且不可通过 API 剥夺，
-- 只能由 scripts/create-admin.js 设置。否则一旦有人改错权限就可能把自己锁在外面。
-- token_version 用于让已签发的 Token 立即失效（改密 / 停用时自增；
-- 改权限【不】自增，因为权限每请求重新加载，立即生效）。
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(32)  NOT NULL                COMMENT '登录名',
  password_hash VARCHAR(100) NOT NULL                COMMENT 'bcrypt 哈希',
  display_name  VARCHAR(32)  NOT NULL                COMMENT '显示名',
  role          VARCHAR(32)  NOT NULL DEFAULT '家人'  COMMENT '显示标签，无权限含义',
  is_owner      TINYINT(1)   NOT NULL DEFAULT 0      COMMENT '所有者，拥有全部权限且不可通过 API 变更',
  status        TINYINT      NOT NULL DEFAULT 1      COMMENT '1 启用，0 停用',
  token_version INT UNSIGNED NOT NULL DEFAULT 0      COMMENT 'Token 版本，自增即让旧 Token 失效',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  KEY idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账号';

-- ---------- 账号权限 ----------
-- 权限独立于角色授权。用关联表而非 SET 列：SET 上限 64 项、不能作为连接目标，
-- 也无法记录每项权限的授权人与授权时间。
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id     INT UNSIGNED NOT NULL,
  permission  VARCHAR(32)  NOT NULL                COMMENT '权限标识，如 menu.view',
  granted_by  INT UNSIGNED NULL                    COMMENT '授权人 id，仅留痕',
  granted_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission),
  KEY idx_up_perm (permission),
  CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账号权限';


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
  notes      VARCHAR(500) NULL                  COMMENT '菜品备注',
  meal_types VARCHAR(24)  NOT NULL DEFAULT 'lunch,dinner' COMMENT '适用餐次，逗号分隔（breakfast/lunch/dinner）',
  flavor     JSON         NULL                  COMMENT '预留：口味/调料结构化配置',
  status     TINYINT      NOT NULL DEFAULT 1    COMMENT '1 上架，0 下架',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dishes_name (name),
  KEY idx_dishes_group (group_id, status, id),
  CONSTRAINT fk_dishes_group FOREIGN KEY (group_id) REFERENCES dish_groups (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='菜品';

-- ---------- 订单 ----------
-- 一人一天一个餐次一单：唯一键 (order_date, meal_type, user_id)。
-- 提交为幂等 upsert，家人改"今天午餐吃什么"不会产生重复单；
-- 同一天的早餐、午餐、晚餐是三份互不干扰的订单。
CREATE TABLE IF NOT EXISTS orders (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL              COMMENT '下单人',
  order_date DATE         NOT NULL              COMMENT '用餐日期',
  meal_type  ENUM('breakfast','lunch','dinner') NOT NULL DEFAULT 'lunch' COMMENT '餐次：早/午/晚',
  notes      VARCHAR(500) NULL                  COMMENT '忌口/整体备注',
  status     TINYINT      NOT NULL DEFAULT 1    COMMENT '1 有效，0 已撤销',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_orders_date_meal_user (order_date, meal_type, user_id),
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

-- ---------- 操作记录 ----------
-- actor_name / target_name 存【快照】而非外键：账号被停用或改名后，历史记录仍要读得懂。
-- before_json / after_json 用 JSON 存变更前后，实体字段演进时日志表结构无需改动。
-- 记录范围：菜品、分组的增删改，账号变更，权限授予/回收（不含订单）。
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    INT UNSIGNED NULL                 COMMENT '操作人 id，账号删除后置空',
  actor_name  VARCHAR(32)  NOT NULL             COMMENT '操作人显示名快照',
  action      VARCHAR(32)  NOT NULL             COMMENT '动作，如 dish.update / perm.grant',
  target_type VARCHAR(16)  NOT NULL             COMMENT 'dish / group / user / permission',
  target_id   INT UNSIGNED NULL                 COMMENT '变更对象 id',
  target_name VARCHAR(64)  NULL                 COMMENT '变更对象名称快照',
  before_json JSON         NULL                 COMMENT '变更前',
  after_json  JSON         NULL                 COMMENT '变更后',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_target (target_type, target_id),
  KEY idx_audit_actor (actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作记录';

-- ---------- 迁移标记 ----------
-- 记录已执行的迁移脚本名，保证迁移脚本幂等。
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       VARCHAR(64) NOT NULL,
  applied_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='迁移标记';

-- ---------- 菜品评价 ----------
-- 粒度是「一次用餐」：同一人对同一道菜，不同日期可以各评一次（唯一键含 order_date）。
-- 刻意【不】外键引用 orders：家人可以撤销订单，若评价挂在订单上会连带被删。
-- 改存 order_date 快照，评价就独立于订单生命周期存在 —— 与 audit_logs 存
-- actor_name 快照是同一个思路（吃过就是吃过）。
-- 菜品只在「从未被点过」时才允许物理删除，那种情况下不可能有评价，
-- 所以 dish_id 的 CASCADE 实际不会触发，保留它只是语义上更自然。
CREATE TABLE IF NOT EXISTS dish_reviews (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  dish_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  order_date DATE         NOT NULL              COMMENT '针对哪一餐的评价',
  meal_type  ENUM('breakfast','lunch','dinner') NOT NULL DEFAULT 'lunch' COMMENT '餐次：早/午/晚',
  rating     TINYINT      NOT NULL              COMMENT '1-5 星',
  content    VARCHAR(500) NULL                  COMMENT '文字评论',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_review_dish_date_meal_user (dish_id, order_date, meal_type, user_id),
  KEY idx_review_dish (dish_id, created_at),
  KEY idx_review_user (user_id),
  CONSTRAINT fk_review_dish FOREIGN KEY (dish_id) REFERENCES dishes (id) ON DELETE CASCADE,
  CONSTRAINT fk_review_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='菜品评价';

