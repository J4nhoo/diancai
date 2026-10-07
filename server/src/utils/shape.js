'use strict';

/** 数据库行 -> 对外的 JSON 结构，统一字段命名（下划线转驼峰） */

function shapeUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
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
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    flavor: row.flavor || null,
    status: row.status,
    sortOrder: row.sort_order,
  };
}

module.exports = { shapeUser, shapeGroup, shapeDish };
