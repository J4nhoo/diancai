'use strict';

/**
 * 餐次定义。全系统唯一的来源：后端用于校验与过滤，前端从这里复制一份到 util.js
 * （前端不引入构建工具，无法共享模块，只能各存一份，改的时候两处都要动）。
 */

const MEALS = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' },
];

const MEAL_KEYS = MEALS.map((m) => m.key);

const MEAL_LABELS = Object.fromEntries(MEALS.map((m) => [m.key, m.label]));

/** 菜品默认适用餐次：现有菜都是午晚餐，早餐是后来才有的概念 */
const DEFAULT_DISH_MEALS = 'lunch,dinner';

/** 按小时推当前餐次。分界点（10 点 / 16 点）只是经验值，用于汇总页默认选中，用户可随手切。 */
function currentMeal(date) {
  const hour = (date || new Date()).getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 16) return 'lunch';
  return 'dinner';
}

/** 'lunch,dinner' -> ['lunch','dinner']；非法值丢弃，保证顺序固定 */
function parseMealTypes(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const set = new Set(raw.map((s) => String(s).trim()).filter((s) => MEAL_KEYS.includes(s)));
  return MEAL_KEYS.filter((k) => set.has(k));
}

/** ['dinner','lunch'] -> 'lunch,dinner'（去重 + 固定顺序）；空数组抛错，避免出现哪种餐次都看不到的菜 */
function serializeMealTypes(value) {
  const list = parseMealTypes(value);
  if (!list.length) {
    throw new Error('菜品至少要适用于一个餐次');
  }
  return list.join(',');
}

function isValidMeal(key) {
  return MEAL_KEYS.includes(key);
}

module.exports = {
  MEALS,
  MEAL_KEYS,
  MEAL_LABELS,
  DEFAULT_DISH_MEALS,
  currentMeal,
  parseMealTypes,
  serializeMealTypes,
  isValidMeal,
};
