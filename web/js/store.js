'use strict';

/** 登录态与当前用户（响应式）。
 *
 * 鉴权一律走权限（permissions）而非角色 —— 角色（role）只是显示标签，
 * 用户可以随便起名（「姐姐」「厨师」），不参与任何判断。
 * 所有者（isOwner）拥有全部权限，后端会返回空 permissions 数组并由 isOwner 短路。
 */

App.store = (function () {
  const PERMISSION_LABELS = {
    'menu.view': '查看菜单',
    'order.submit': '点菜',
    'summary.view': '查看汇总',
    'order.viewAll': '查看全部订单',
    'menu.manage': '管理菜品与分组',
    'user.manage': '管理账号',
    'user.grant': '分配权限',
    'log.view': '查看操作记录',
  };

  const state = Vue.reactive({
    user: null, // {id, username, displayName, role, isOwner, permissions[]}
    ready: false,
  });

  /** 当前用户是否拥有某项权限；owner 恒为真 */
  function can(perm) {
    const u = state.user;
    if (!u) return false;
    if (!perm) return true;
    if (u.isOwner) return true;
    const list = u.permissions || [];
    return Array.isArray(perm) ? perm.some((p) => list.includes(p)) : list.includes(perm);
  }

  /** 侧边导航与落地页的候选顺序，取第一个有权限的 */
  const HOME_CANDIDATES = ['/menu', '/summary', '/admin/dishes', '/admin/orders', '/admin/users', '/admin/audit'];

  /** 当前用户的默认落地页（不含 #） */
  function homePath() {
    if (!state.user) return '/login';
    const hit = HOME_CANDIDATES.find((p) => can(PATH_PERMISSION[p]));
    return hit || '/summary';
  }

  /** 路径 → 所需权限（与 router.js 的路由表保持一致） */
  const PATH_PERMISSION = {
    '/menu': 'menu.view',
    '/my-orders': 'order.submit',
    '/summary': 'summary.view',
    '/admin/dishes': 'menu.manage',
    '/admin/users': 'user.manage',
    '/admin/orders': 'order.viewAll',
    '/admin/audit': 'log.view',
  };

  function permissionLabel(key) {
    return PERMISSION_LABELS[key] || key;
  }

  async function loadMe() {
    if (!App.api.getToken()) {
      state.user = null;
      state.ready = true;
      return;
    }
    try {
      state.user = await App.api.get('/api/auth/me');
    } catch (_) {
      state.user = null;
    } finally {
      state.ready = true;
    }
  }

  async function login(username, password) {
    const data = await App.api.post('/api/auth/login', { username, password });
    App.api.setToken(data.token);
    state.user = data.user;
  }

  async function changePassword(oldPassword, newPassword) {
    const data = await App.api.post('/api/auth/password', { oldPassword, newPassword });
    // 改密后旧 Token 失效，这里换上新签发的 Token 保持当前会话
    App.api.setToken(data.token);
    state.user = data.user;
  }

  function logout() {
    App.api.setToken('');
    state.user = null;
    location.hash = '#/login';
  }

  function setUser(user) {
    state.user = user;
  }

  return {
    state,
    loadMe,
    login,
    logout,
    changePassword,
    can,
    homePath,
    permissionLabel,
    setUser,
    PATH_PERMISSION,
  };
})();
