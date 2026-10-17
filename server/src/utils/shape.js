'use strict';

/** 数据库行 -> 对外的 JSON 结构，统一字段命名（下划线转驼峰） */

/**
 * 数据库行 -> 对外的 JSON 结构，统一字段命名（下划线转驼峰）。
 * permissions 由调用方按需传入（列表页不查权限，避免 N+1）。
 */
function shapeUser(row, permissions) {
  const out = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isOwner: row.is_owner === 1,
    status: row.status,
    createdAt: row.created_at,
  };
  if (permissions !== undefined) {
    out.permissions = permissions === null ? [] : permissions;
  }
  return out;
}

function shapeGroup(row) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    status: row.status,
  };
}

function shapeDish(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name === undefined ? undefined : row.group_name,
    name: row.name,
    imageUrl: row.image_url || null,
    notes: row.notes || null,
    // 适用餐次数组；调用方若未查该列则回退为午晚餐
    mealTypes: row.meal_types ? String(row.meal_types).split(',') : ['lunch', 'dinner'],
    flavor: row.flavor || null,
    status: row.status,
  };
}

module.exports = { shapeUser, shapeGroup, shapeDish };
