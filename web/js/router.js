'use strict';

/** 极简 hash 路由（无 vue-router 依赖） */

App.router = (function () {
  const routes = [
    { path: '/login', component: 'page-login', title: '登录', roles: null },
    { path: '/menu', component: 'page-menu', title: '点菜', roles: ['family'] },
    { path: '/my-orders', component: 'page-my-orders', title: '我的订单', roles: ['family'] },
    { path: '/summary', component: 'page-summary', title: '菜单汇总', roles: ['family', 'chef', 'admin'] },
    { path: '/admin/users', component: 'page-admin-users', title: '账号管理', roles: ['admin'] },
    { path: '/admin/dishes', component: 'page-admin-dishes', title: '菜品管理', roles: ['admin'] },
    { path: '/admin/orders', component: 'page-admin-orders', title: '全部订单', roles: ['admin'] },
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

    // 已登录还去登录页，或路径未知，或角色不符：都回到角色首页
    if (path === '/login' || !route || (route.roles && !App.store.can(route.roles))) {
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

  /** 当前路由对应的组件名 */
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
