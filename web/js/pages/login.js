'use strict';

App.pages['page-login'] = {
  template: `
    <div class="login-wrap">
      <div class="login-card">
        <h1 class="login-title">家庭点菜</h1>
        <p class="login-sub">请使用家庭账号登录</p>

        <form @submit.prevent="submit">
          <label class="field">
            <span>账号</span>
            <input v-model.trim="username" type="text" autocomplete="username"
                   placeholder="请输入账号" :disabled="loading" />
          </label>
          <label class="field">
            <span>密码</span>
            <input v-model="password" type="password" autocomplete="current-password"
                   placeholder="请输入密码" :disabled="loading" />
          </label>

          <p v-if="error" class="login-error">{{ error }}</p>

          <button type="submit" class="btn primary block" :disabled="loading || !canSubmit">
            {{ loading ? '登录中…' : '登 录' }}
          </button>
        </form>

        <p class="login-tip">账号由家里的管理者创建，如忘记密码请联系管理者。</p>
      </div>
    </div>
  `,
  setup() {
    const username = Vue.ref('');
    const password = Vue.ref('');
    const error = Vue.ref('');
    const loading = Vue.ref(false);

    const canSubmit = Vue.computed(() => username.value && password.value);

    async function submit() {
      error.value = '';
      loading.value = true;
      try {
        await App.store.login(username.value, password.value);
        App.toast.success('登录成功');
        location.hash = `#${App.store.homePath()}`;
      } catch (err) {
        error.value = err.message;
      } finally {
        loading.value = false;
      }
    }

    return { username, password, error, loading, canSubmit, submit };
  },
};
