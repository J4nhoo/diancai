'use strict';

/** 操作记录：谁在什么时候把什么改成了什么 */

const AUDIT_ACTION_LABELS = {
  'dish.create': '新建菜品',
  'dish.update': '修改菜品',
  'dish.off': '下架菜品',
  'group.create': '新建分组',
  'group.update': '修改分组',
  'group.delete': '删除分组',
  'user.create': '新建账号',
  'user.update': '修改账号',
  'user.password': '重置密码',
  'user.disable': '停用账号',
  'user.delete': '删除账号',
  'perm.grant': '授予权限',
  'perm.revoke': '回收权限',
  'log.delete': '删除记录',
};

const TARGET_LABELS = {
  dish: '菜品',
  group: '分组',
  user: '账号',
  permission: '权限',
  log: '记录',
};

App.pages['page-admin-audit'] = {
  template: `
    <div class="page">
      <h2 class="section-title">操作记录</h2>

      <div class="toolbar">
        <label class="date-pick">
          <span>从</span>
          <input type="date" v-model="from" @change="reload" />
        </label>
        <label class="date-pick">
          <span>到</span>
          <input type="date" v-model="to" @change="reload" />
        </label>
        <select v-model="targetType" @change="reload" class="inline-select">
          <option value="">全部对象</option>
          <option value="dish">菜品</option>
          <option value="group">分组</option>
          <option value="user">账号</option>
          <option value="permission">权限</option>
          <option value="log">记录</option>
        </select>
        <button type="button" class="btn small" @click="clearFilters">重置</button>
      </div>

      <div class="audit-bulk" v-if="canDelete && logs.length">
        <label class="check-row">
          <input type="checkbox" :checked="allChecked" @change="toggleAll" />
          <span>全选本页</span>
        </label>
        <button type="button" class="btn small danger" :disabled="!selected.length || deleting"
                @click="removeSelected">
          {{ deleting ? '删除中…' : '删除选中（' + selected.length + '）' }}
        </button>
      </div>

      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="!logs.length" class="empty">没有符合条件的记录。</div>

      <template v-else>
        <p class="result-count">共 {{ total }} 条</p>

        <ul class="audit-list">
          <li v-for="log in logs" :key="log.id" class="audit-item">
            <div class="audit-head">
              <label class="check-inline" v-if="canDelete">
                <input type="checkbox" :value="log.id" v-model="selected" />
              </label>
              <span class="audit-action" :class="actionClass(log.action)">{{ actionLabel(log.action) }}</span>
              <span class="audit-target">{{ targetLabel(log.targetType) }}<template v-if="log.targetName">「{{ log.targetName }}」</template></span>
              <button type="button" class="btn small danger audit-del" v-if="canDelete"
                      @click="removeOne(log)">删</button>
            </div>
            <div class="audit-meta">{{ log.actorName }} · {{ log.createdAt }}</div>
            <div class="audit-diff" v-if="log.before || log.after">
              <div v-if="log.before" class="audit-side before">
                <span class="audit-tag">改前</span>{{ format(log.before) }}
              </div>
              <div v-if="log.after" class="audit-side after">
                <span class="audit-tag">改后</span>{{ format(log.after) }}
              </div>
            </div>
          </li>
        </ul>

        <div class="pager">
          <button type="button" class="btn small" :disabled="page <= 1" @click="go(page - 1)">上一页</button>
          <span>第 {{ page }} 页</span>
          <button type="button" class="btn small" :disabled="page * pageSize >= total" @click="go(page + 1)">下一页</button>
        </div>
      </template>
    </div>
  `,
  setup() {
    const from = Vue.ref('');
    const to = Vue.ref('');
    const targetType = Vue.ref('');
    const page = Vue.ref(1);
    const pageSize = 20;
    const logs = Vue.ref([]);
    const total = Vue.ref(0);
    const loading = Vue.ref(true);
    const selected = Vue.ref([]);
    const deleting = Vue.ref(false);

    const canDelete = Vue.computed(() => App.store.can('log.delete'));
    const allChecked = Vue.computed(
      () => logs.value.length > 0 && selected.value.length === logs.value.length
    );

    function toggleAll() {
      selected.value = allChecked.value ? [] : logs.value.map((l) => l.id);
    }

    const FIELD_LABELS = {
      name: '名称', group: '分组', price: '价格', status: '状态', sortOrder: '排序',
      displayName: '显示名', role: '身份标签', permissions: '权限', password: '密码',
      username: '登录名',
    };
    const VALUE_LABELS = { 1: '启用', 0: '停用' };

    function actionLabel(a) {
      return AUDIT_ACTION_LABELS[a] || a;
    }
    function targetLabel(t) {
      return TARGET_LABELS[t] || t;
    }
    function actionClass(a) {
      if (a.endsWith('.create') || a === 'perm.grant') return 'add';
      if (a.endsWith('.delete') || a.endsWith('.disable') || a === 'perm.revoke' || a === 'dish.off') return 'del';
      return 'edit';
    }

    /** 把 {name:'红烧肉',price:38} 渲染成可读文本 */
    function format(obj) {
      if (!obj || typeof obj !== 'object') return String(obj);
      return Object.entries(obj)
        .map(([k, v]) => {
          const label = FIELD_LABELS[k] || k;
          let text;
          if (k === 'permissions' && Array.isArray(v)) {
            text = v.map((p) => App.store.permissionLabel(p)).join('、');
          } else if (k === 'status' && VALUE_LABELS[v] !== undefined) {
            text = VALUE_LABELS[v];
          } else if (v === null || v === undefined || v === '') {
            text = '空';
          } else {
            text = String(v);
          }
          return `${label}：${text}`;
        })
        .join('　');
    }

    async function load() {
      loading.value = true;
      try {
        const data = await App.api.get('/api/admin/audit-logs', {
          from: from.value, to: to.value, targetType: targetType.value,
          page: page.value, pageSize,
        });
        logs.value = data.logs || [];
        total.value = data.total || 0;
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        loading.value = false;
      }
    }

    function reload() {
      page.value = 1;
      load();
    }

    function go(next) {
      page.value = next;
      load();
      window.scrollTo(0, 0);
    }

    function clearFilters() {
      from.value = '';
      to.value = '';
      targetType.value = '';
      reload();
    }

    /** 删除记录。所有者不留痕，其他人会多出一条「删除记录」——这是后端决定的。 */
    async function doDelete(ids, tip) {
      if (!window.confirm(tip)) return false;
      deleting.value = true;
      try {
        const r = await App.api.del('/api/admin/audit-logs', { ids });
        App.toast.success(`已删除 ${r.count} 条`);
        selected.value = [];
        await load();
        return true;
      } catch (err) {
        App.toast.error(err.message);
        return false;
      } finally {
        deleting.value = false;
      }
    }

    function removeOne(log) {
      return doDelete(
        [log.id],
        `确定删除这条「${actionLabel(log.action)}」记录吗？${
          App.store.state.user.isOwner ? '' : '\n\n注意：你的这次删除也会被记录下来。'
        }`
      );
    }

    function removeSelected() {
      if (!selected.value.length) return;
      return doDelete(
        [...selected.value],
        `确定删除选中的 ${selected.value.length} 条记录吗？${
          App.store.state.user.isOwner ? '' : '\n\n注意：你的这次删除也会被记录下来。'
        }`
      );
    }

    Vue.onMounted(load);

    return {
      from, to, targetType, page, pageSize, logs, total, loading,
      selected, deleting, canDelete, allChecked, toggleAll,
      actionLabel, targetLabel, actionClass, format, load, reload, go, clearFilters,
      removeOne, removeSelected,
    };
  },
};
