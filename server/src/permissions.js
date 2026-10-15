'use strict';

/**
 * 权限目录 —— 全系统唯一的权限定义来源。
 * 后端用于校验与鉴权，前端用于渲染权限勾选界面与导航，故中文名也放这里。
 *
 * 角色（users.role）只是显示标签，不参与鉴权；一切授权都以本目录为准。
 */

const PERMISSIONS = [
  { key: 'menu.view', label: '查看菜单', desc: '打开点菜页、浏览菜品与分组' },
  { key: 'order.submit', label: '点菜', desc: '提交自己的订单、修改数量、撤销，并查看自己的订单' },
  { key: 'review.create', label: '评价菜品', desc: '对自己点过的菜打分与评论（只能评吃过的）' },
  { key: 'summary.view', label: '查看汇总', desc: '按日期查看当日汇总菜单、一键复制' },
  { key: 'order.viewAll', label: '查看全部订单', desc: '查看所有人（而非仅自己）的订单' },
  { key: 'menu.manage', label: '管理菜品与分组', desc: '新增/修改/删除/下架菜品，增删改分组，上传图片' },
  { key: 'user.manage', label: '管理账号', desc: '新建账号、改显示名、停用/启用、重置密码' },
  { key: 'user.grant', label: '分配权限', desc: '给账号增删权限（提权操作，请谨慎授予）' },
  { key: 'log.view', label: '查看操作记录', desc: '查看菜品、分组、账号与权限的变更记录' },
  { key: 'log.delete', label: '删除操作记录', desc: '删除变更记录（所有者删除不留痕，其他人删除会留下记录）' },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
const PERMISSION_SET = new Set(PERMISSION_KEYS);

function isValidPermission(key) {
  return PERMISSION_SET.has(key);
}

/** 旧角色 → 权限，供迁移脚本使用 */
const ROLE_PERMISSION_MAP = {
  family: ['menu.view', 'order.submit', 'summary.view'],
  chef: ['menu.view', 'order.submit', 'summary.view', 'order.viewAll'],
  admin: [...PERMISSION_KEYS],
};

/** 旧角色 → 显示标签，迁移时把英文枚举改成中文 */
const ROLE_LABEL_MAP = {
  family: '家人',
  chef: '厨师',
  admin: '管理者',
};

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  isValidPermission,
  ROLE_PERMISSION_MAP,
  ROLE_LABEL_MAP,
};
