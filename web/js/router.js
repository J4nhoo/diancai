'use strict';

/** 极简 hash 路由（无 vue-router 依赖）。
 * 路由守卫按【权限】判断，不再看角色 —— 角色只是显示标签。
 */

App.router = (function () {
  const routes = [
    { path: '/login', component: 'page-login', title: '登录', perm: null },
    { path: '/menu', component: 'page-menu', title: '点菜', perm: 'menu.view' },
    { path: '/my-orders', component: 'page-my-orders', title: '我的订单', perm: 'order.submit' },
    { path: '/summary', component: 'page-summary', title: '菜单汇总', perm: 'summary.view' },
    { path: '/admin/dishes', component: 'page-admin-dishes', title: '菜品管理', perm: 'menu.manage' },
    { path: '/admin/orders', component: 'page-admin-orders', title: '全部订单', perm: 'order.viewAll' },
    { path: '/admin/users', component: 'page-admin-users', title: '账号管理', perm: 'user.manage' },
    { path: '/admin/audit', component: 'page-admin-audit', title: '操作记录', perm: 'log.view' },
  ];

  const state = Vue.reactive({ path: '/login', query: {} });

  function parse() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    const query = {};
    if (qs) {
      for (const [key, value] of new URLSearchParams(qs).entries()) query[key] = value;
    }
    return { path: path || '/', query };
  }

  function find(path) {
    return routes.find((r) => r.path === path) || null;
  }

  function navigate() {
    const { path, query } = parse();
    const route = find(path);

    // 未登录：只能停在登录页
    if (!App.store.state.user) {
      state.path = '/login';
      state.query = path === '/login' ? query : {};
      if (path !== '/login') location.hash = '#/login';
      return;
    }

    // 已登录还去登录页、路径未知、或没有该页权限：都回到有权限的首页
    if (path === '/login' || !route || !App.store.can(route.perm)) {
      const home = App.store.homePath();
      if (path !== home) {
        location.hash = `#${home}`;
        return;
      }
    }

    state.path = path;
    state.query = query;
  }

  function start() {
    window.addEventListener('hashchange', navigate);
    navigate();
  }

  const current = Vue.computed(() => {
    const route = find(state.path);
    return route ? route.component : null;
  });

  const title = Vue.computed(() => {
    const route = find(state.path);
    return route ? route.title : '家庭点菜';
  });

  return { state, current, title, routes, start, navigate };
})();
