'use strict';

/** 登录态与当前用户（响应式） */

App.store = (function () {
  const state = Vue.reactive({
    user: null, // {id, username, displayName, role}
    ready: false, // 是否已完成首次登录状态探测
  });

  const ROLE_LABEL = { family: '家人', chef: '厨师', admin: '管理者' };

  function roleLabel(role) {
    return ROLE_LABEL[role] || role;
  }

  function is(role) {
    return !!state.user && state.user.role === role;
  }

  function can(roles) {
    return !!state.user && (!roles || roles.includes(state.user.role));
  }

  /** 每个角色的默认落地页（不含 #） */
  function homePath() {
    if (!state.user) return '/login';
    return state.user.role === 'family' ? '/menu' : '/summary';
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

  return { state, loadMe, login, logout, changePassword, roleLabel, is, can, homePath, setUser };
})();
