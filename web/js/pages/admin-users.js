'use strict';

App.pages['page-admin-users'] = {
  template: `
    <div class="page">
      <div class="toolbar space">
        <h2 class="section-title">账号管理</h2>
        <button type="button" class="btn primary small" @click="openCreate">+ 新建账号</button>
      </div>

      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="!users.length" class="empty">还没有账号。</div>

      <ul class="admin-list" v-else>
        <li v-for="u in users" :key="u.id" class="admin-item" :class="{ off: u.status !== 1 }">
          <div class="admin-main">
            <div class="admin-title">
              {{ u.displayName }}
              <span class="badge muted">{{ u.role }}</span>
              <span class="badge owner" v-if="u.isOwner">所有者</span>
              <span class="badge muted" v-if="u.status !== 1">已停用</span>
              <span class="badge ok" v-if="u.id === me.id">我</span>
            </div>
            <div class="admin-sub">
              账号：{{ u.username }}
              <template v-if="!u.isOwner && u.permissions && u.permissions.length">
                · {{ u.permissions.length }} 项权限
              </template>
              <template v-if="u.isOwner">· 全部权限</template>
            </div>
          </div>
          <div class="admin-actions">
            <template v-if="!u.isOwner">
              <button type="button" class="btn small" @click="openEdit(u)">编辑</button>
              <button type="button" class="btn small" @click="resetPassword(u)">改密</button>
              <button type="button" class="btn small danger" v-if="u.id !== me.id && u.status === 1"
                      :disabled="busy === u.id" @click="disable(u)">
                {{ busy === u.id ? '…' : '停用' }}
              </button>
              <button type="button" class="btn small" v-if="u.id !== me.id && u.status !== 1"
                      :disabled="busy === u.id" @click="enable(u)">启用</button>
            </template>
            <span v-else class="hint-inline">不可修改</span>
          </div>
        </li>
      </ul>

      <div v-if="panel" class="sheet-mask" @click.self="close">
        <div class="sheet">
          <h3>{{ editing ? '编辑账号' : '新建账号' }}</h3>

          <label class="field" v-if="!editing">
            <span>登录名</span>
            <input v-model.trim="form.username" type="text" placeholder="3-32 位字母/数字/下划线" />
          </label>
          <p v-else class="field-static">账号：{{ form.username }}</p>

          <label class="field">
            <span>显示名</span>
            <input v-model.trim="form.displayName" type="text" placeholder="例如：妈妈" />
          </label>

          <label class="field">
            <span>身份标签（只是称呼，不影响权限）</span>
            <input v-model.trim="form.role" type="text" maxlength="32"
                   placeholder="例如：姐姐、厨师、后勤" />
          </label>

          <label class="field" v-if="!editing">
            <span>初始密码</span>
            <input v-model="form.password" type="text" placeholder="至少 6 位" />
          </label>

          <div class="perm-group" v-if="canGrant">
            <div class="perm-head">
              <span>权限</span>
              <button type="button" class="link-sm" @click="toggleAll">{{ allChecked ? '全不选' : '全选' }}</button>
            </div>
            <label v-for="p in permissionCatalog" :key="p.key" class="perm-item">
              <input type="checkbox" :value="p.key" v-model="form.permissions" />
              <span class="perm-body">
                <b>{{ p.label }}</b>
                <em>{{ p.desc }}</em>
              </span>
            </label>
            <p class="perm-note">权限改动【立即生效】，对方无需重新登录。</p>
          </div>
          <p v-else class="perm-note muted">你没有「分配权限」的权限，无法修改权限。</p>

          <p v-if="error" class="form-error">{{ error }}</p>

          <div class="sheet-actions">
            <button type="button" class="btn" @click="close">取消</button>
            <button type="button" class="btn primary" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const store = App.store;
    const users = Vue.ref([]);
    const loading = Vue.ref(true);
    const busy = Vue.ref(0);
    const panel = Vue.ref(false);
    const editing = Vue.ref(false);
    const saving = Vue.ref(false);
    const error = Vue.ref('');
    const permissionCatalog = Vue.ref([]);
    const form = Vue.reactive({
      id: 0, username: '', displayName: '', role: '家人', password: '', permissions: [],
    });
    const me = Vue.computed(() => store.state.user);
    const canGrant = Vue.computed(() => store.can('user.grant'));

    const allChecked = Vue.computed(
      () => permissionCatalog.value.length > 0 && form.permissions.length === permissionCatalog.value.length
    );

    function toggleAll() {
      form.permissions = allChecked.value ? [] : permissionCatalog.value.map((p) => p.key);
    }

    async function load() {
      loading.value = true;
      try {
        const data = await App.api.get('/api/admin/users');
        users.value = data.users || [];
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        loading.value = false;
      }
    }

    async function loadCatalog() {
      try {
        const data = await App.api.get('/api/admin/permissions');
        permissionCatalog.value = data.permissions || [];
      } catch (_) {
        permissionCatalog.value = [];
      }
    }

    function resetForm() {
      form.id = 0;
      form.username = '';
      form.displayName = '';
      form.role = '家人';
      form.password = '';
      form.permissions = [];
      error.value = '';
    }

    function openCreate() {
      editing.value = false;
      resetForm();
      panel.value = true;
    }

    function openEdit(u) {
      editing.value = true;
      error.value = '';
      form.id = u.id;
      form.username = u.username;
      form.displayName = u.displayName;
      form.role = u.role;
      form.password = '';
      form.permissions = [...(u.permissions || [])];
      panel.value = true;
    }

    function close() {
      panel.value = false;
    }

    async function save() {
      error.value = '';
      saving.value = true;
      try {
        if (editing.value) {
          const payload = { displayName: form.displayName, role: form.role };
          if (canGrant.value) payload.permissions = form.permissions;
          await App.api.patch(`/api/admin/users/${form.id}`, payload);
        } else {
          const payload = {
            username: form.username,
            displayName: form.displayName,
            role: form.role,
            password: form.password,
          };
          if (canGrant.value) payload.permissions = form.permissions;
          await App.api.post('/api/admin/users', payload);
        }
        App.toast.success('已保存');
        panel.value = false;
        await load();
      } catch (err) {
        error.value = err.message;
      } finally {
        saving.value = false;
      }
    }

    async function resetPassword(u) {
      const pwd = window.prompt(`为「${u.displayName}」设置新密码（至少 6 位）`);
      if (pwd === null) return;
      if (pwd.length < 6) return App.toast.error('密码至少 6 位');
      try {
        await App.api.patch(`/api/admin/users/${u.id}`, { password: pwd });
        App.toast.success('密码已重置，该账号需重新登录');
      } catch (err) {
        App.toast.error(err.message);
      }
    }

    async function disable(u) {
      if (!window.confirm(`确定停用「${u.displayName}」吗？停用后将无法登录。`)) return;
      busy.value = u.id;
      try {
        await App.api.del(`/api/admin/users/${u.id}`);
        App.toast.success('已停用');
        await load();
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        busy.value = 0;
      }
    }

    async function enable(u) {
      busy.value = u.id;
      try {
        await App.api.patch(`/api/admin/users/${u.id}`, { status: 1 });
        App.toast.success('已启用');
        await load();
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        busy.value = 0;
      }
    }

    Vue.onMounted(async () => {
      await Promise.all([load(), loadCatalog()]);
    });

    return {
      users, loading, busy, panel, editing, saving, error, form, me, canGrant,
      permissionCatalog, allChecked, toggleAll,
      openCreate, openEdit, close, save, resetPassword, disable, enable,
    };
  },
};
