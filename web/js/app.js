'use strict';

/** 根组件：顶栏 + 路由视图 + 底部导航 + 轻提示 */

/**
 * 全局模态弹窗。轻提示（toast）用于一闪而过的反馈，
 * 这里用于需要用户明确看到并处理的内容（选餐次、待确认提醒）。
 *
 * 用队列保证同一时刻只显示一个：多个模块同时想弹时排队，
 * 前一个关闭后自动显示下一个（否则后弹的会覆盖先弹的，用户看不到提醒）。
 *
 * 用法：
 *   App.modal.open({ title, body, actions: [{ label, primary, onClick }] })
 *   App.modal.close()
 */
App.modal = (function () {
  const state = Vue.reactive({ open: false, title: '', body: '', actions: [], dismissible: true });
  const queue = [];
  let showing = false;

  function showNext() {
    if (showing || !queue.length) return;
    const next = queue.shift();
    showing = true;
    state.title = next.title || '';
    state.body = next.body || '';
    state.actions = next.actions || [];
    state.dismissible = next.dismissible !== false;
    state.open = true;
  }

  function open(opts) {
    queue.push(opts);
    showNext();
  }

  function close() {
    state.open = false;
    state.actions = [];
    // 等渲染一帧再弹下一个，避免同一 tick 内闪动
    Vue.nextTick(() => {
      showing = false;
      showNext();
    });
  }

  function choose(action) {
    // 先执行回调再关闭 —— 回调里可能要开新弹窗（如跳转后弹餐次）
    const cb = action && typeof action.onClick === 'function' ? action.onClick : null;
    state.open = false;
    state.actions = [];
    Vue.nextTick(() => {
      showing = false;
      showNext();
      if (cb) cb();
    });
  }

  return { state, open, close, choose };
})();

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
  // 导航项按【权限】过滤，不再按角色分组 —— 任何账号只要有对应权限就会出现这些入口
  const ALL_TABS = [
    { path: '/home', label: '首页', perm: null },
    { path: '/menu', label: '点菜', perm: 'menu.view' },
    { path: '/my-orders', label: '我的订单', perm: 'order.submit' },
    { path: '/summary', label: '汇总', perm: 'summary.view' },
    { path: '/admin/dishes', label: '菜品', perm: 'menu.manage' },
    { path: '/admin/users', label: '账号', perm: 'user.manage' },
    { path: '/admin/audit', label: '记录', perm: 'log.view' },
  ];

  const RootComponent = {
    template: `
      <div class="app">
        <header class="topbar" v-if="user">
          <a class="brand" href="#/home">朝夕家膳</a>
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

        <!-- 全局模态弹窗 -->
        <div v-if="modal.open" class="modal-mask" @click.self="onMaskClick">
          <div class="modal">
            <h3 class="modal-title" v-if="modal.title">{{ modal.title }}</h3>
            <div class="modal-body" v-html="modal.body"></div>
            <div class="modal-actions">
              <button v-for="(a, i) in modal.actions" :key="i" type="button"
                      class="btn" :class="{ primary: a.primary }"
                      @click="chooseModalAction(a)">{{ a.label }}</button>
            </div>
          </div>
        </div>
      </div>
    `,
    setup() {
      const store = App.store;
      const modal = App.modal.state;

      function onMaskClick() {
        if (modal.dismissible) App.modal.close();
      }

      function chooseModalAction(action) {
        App.modal.choose(action);
      }
      const router = App.router;

      const user = Vue.computed(() => store.state.user);
      // 角色是自由标签，直接显示；所有者额外标一下，便于识别谁有全部权限
      const roleLabel = Vue.computed(() => {
        if (!user.value) return '';
        return user.value.isOwner ? `${user.value.role} · 所有者` : user.value.role;
      });
      const tabs = Vue.computed(() => (user.value ? ALL_TABS.filter((t) => store.can(t.perm)) : []));
      // 未登录时由 router 统一指向 /login，因此这里直接取当前路由组件即可
      const view = Vue.computed(() => router.current.value);
      const routeKey = Vue.computed(() => `${router.state.path}?${JSON.stringify(router.state.query)}`);

      function isActive(path) {
        return router.state.path === path;
      }

      function logout() {
        if (window.confirm('确定要退出登录吗？')) store.logout();
      }

      return {
        user, roleLabel, tabs, view, routeKey, isActive, logout,
        toasts: App.toast.items, modal, onMaskClick, chooseModalAction,
      };
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

  /**
   * 登录后提醒未确认订单（只查一次，且只提醒今天+明天）。
   * 只有能确认或能看全部订单的人才查 —— 家人看不到别人的单，也不该被打扰。
   */
  async function notifyPending() {
    const store = App.store.state.user;
    if (!store) return;
    if (!App.store.can('order.confirm') && !App.store.can('order.viewAll')) return;

    let data;
    try {
      data = await App.api.get('/api/summary/pending');
    } catch (_) {
      return; // 提醒失败不该影响使用
    }
    if (!data || !data.count) return;

    const lines = data.items
      .map(
        (it) =>
          `<div class="pending-line">${App.util.friendlyDate(it.date)} · ${App.util.mealLabel(
            it.mealType
          )}（${it.count} 单）</div>`
      )
      .join('');

    App.modal.open({
      title: '订单未确认',
      body: `${lines}<p style="margin-top:10px">订单未确认，请及时处理！</p>`,
      actions: [
        { label: '知道了', onClick: () => {} },
        {
          label: '去看看',
          primary: true,
          onClick: () => {
            const first = data.items[0];
            location.hash = `#/summary?date=${first.date}&meal=${first.mealType}`;
          },
        },
      ],
    });
  }

  App.store.loadMe().then(async () => {
    app.mount('#app');
    // 先把待确认提醒放进队列（它在异步请求后入队，若不先等，
    // 点菜页的餐次弹窗会先弹出来，把提醒盖到后面）。
    await notifyPending();
    App.router.start();
  });

  // 登录成功后也要提醒一次（首次加载走 loadMe，登录是另一条路径）
  App.notifyPendingAfterLogin = notifyPending;

  App.vm = app;
})();
