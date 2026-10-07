'use strict';

/** 根组件：顶栏 + 路由视图 + 底部导航 + 轻提示 */

App.toast = (function () {
  let seq = 0;
  const items = Vue.reactive([]);

  function show(text, type) {
    const id = ++seq;
    items.push({ id, text, type: type || 'info' });
    setTimeout(() => {
      const idx = items.findIndex((t) => t.id === id);
      if (idx >= 0) items.splice(idx, 1);
    }, 2600);
  }

  return {
    items,
    show,
    success: (text) => show(text, 'success'),
    error: (text) => show(text, 'error'),
  };
})();

(function () {
  const TABS = {
    family: [
      { path: '/menu', label: '点菜' },
      { path: '/my-orders', label: '我的订单' },
      { path: '/summary', label: '汇总' },
    ],
    chef: [{ path: '/summary', label: '菜单汇总' }],
    admin: [
      { path: '/summary', label: '汇总' },
      { path: '/admin/dishes', label: '菜品' },
      { path: '/admin/users', label: '账号' },
      { path: '/admin/orders', label: '订单' },
    ],
  };

  const RootComponent = {
    template: `
      <div class="app">
        <header class="topbar" v-if="user">
          <span class="brand">家庭点菜</span>
          <span class="topbar-right">
            <span class="who">{{ user.displayName }}<em>{{ roleLabel }}</em></span>
            <button type="button" class="link" @click="logout">退出</button>
          </span>
        </header>

        <main class="main" :class="{ 'no-tabbar': !tabs.length }">
          <component v-if="view" :is="view" :key="routeKey"></component>
        </main>

        <nav class="tabbar" v-if="tabs.length">
          <a v-for="tab in tabs" :key="tab.path" :href="'#' + tab.path"
             class="tab" :class="{ active: isActive(tab.path) }">
            {{ tab.label }}
          </a>
        </nav>

        <div class="toasts">
          <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.text }}</div>
        </div>
      </div>
    `,
    setup() {
      const store = App.store;
      const router = App.router;

      const user = Vue.computed(() => store.state.user);
      const roleLabel = Vue.computed(() => (user.value ? store.roleLabel(user.value.role) : ''));
      const tabs = Vue.computed(() => (user.value ? TABS[user.value.role] || [] : []));
      // 未登录时由 router 统一指向 /login，因此这里直接取当前路由组件即可
      const view = Vue.computed(() => router.current.value);
      const routeKey = Vue.computed(() => `${router.state.path}?${JSON.stringify(router.state.query)}`);

      function isActive(path) {
        return router.state.path === path;
      }

      function logout() {
        if (window.confirm('确定要退出登录吗？')) store.logout();
      }

      return { user, roleLabel, tabs, view, routeKey, isActive, logout, toasts: App.toast.items };
    },
  };

  const app = Vue.createApp(RootComponent);
  for (const [name, def] of Object.entries(App.pages)) {
    app.component(name, def);
  }

  App.api.setUnauthorizedHandler(() => {
    App.store.state.user = null;
    if (location.hash !== '#/login') location.hash = '#/login';
  });

  App.store.loadMe().then(() => {
    app.mount('#app');
    App.router.start();
  });

  App.vm = app;
})();
