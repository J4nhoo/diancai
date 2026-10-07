'use strict';

App.pages['page-admin-dishes'] = {
  template: `
    <div class="page">
      <div class="toolbar space">
        <h2 class="section-title">菜品管理</h2>
        <div class="toolbar-btns">
          <button type="button" class="btn small" @click="groupsPanel = true">分组</button>
          <button type="button" class="btn primary small" @click="openCreate" :disabled="!groups.length">
            + 新建菜品
          </button>
        </div>
      </div>

      <div class="filter-row">
        <select v-model="filterGroup" @change="loadDishes">
          <option value="">全部分组</option>
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
        <select v-model="filterStatus" @change="loadDishes">
          <option value="">全部状态</option>
          <option :value="1">仅上架</option>
          <option :value="0">仅下架</option>
        </select>
      </div>

      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="!dishes.length" class="empty">还没有菜品，点右上角新建。</div>

      <ul class="admin-list" v-else>
        <li v-for="d in dishes" :key="d.id" class="admin-item dish-item" :class="{ off: d.status !== 1 }">
          <img class="thumb" :src="d.imageUrl || fallback(d.name)" :alt="d.name"
               @error="onImgError($event, d.name)" />
          <div class="admin-main">
            <div class="admin-title">
              {{ d.name }}
              <span class="badge muted" v-if="d.status !== 1">已下架</span>
            </div>
            <div class="admin-sub">
              {{ d.groupName || '未分组' }}
              <template v-if="d.price != null"> · ￥{{ d.price.toFixed(2) }}</template>
            </div>
          </div>
          <div class="admin-actions">
            <button type="button" class="btn small" @click="openEdit(d)">编辑</button>
            <button type="button" class="btn small" v-if="d.status === 1" @click="toggleStatus(d, 0)">下架</button>
            <button type="button" class="btn small" v-else @click="toggleStatus(d, 1)">上架</button>
          </div>
        </li>
      </ul>

      <!-- 菜品编辑面板 -->
      <div v-if="panel" class="sheet-mask" @click.self="close">
        <div class="sheet">
          <h3>{{ editing ? '编辑菜品' : '新建菜品' }}</h3>

          <div class="upload-row">
            <img class="upload-preview" :src="form.imageUrl || fallback(form.name || '菜')" alt="预览"
                 @error="onImgError($event, form.name)" />
            <div class="upload-btns">
              <label class="btn small file-btn">
                {{ uploading ? (uploadStage || '上传中…') : '选择图片' }}
                <input type="file" accept="image/jpeg,image/png,image/webp" @change="onFile" :disabled="uploading" />
              </label>
              <button type="button" class="btn small" v-if="form.imageUrl" @click="form.imageUrl = ''">移除图片</button>
            </div>
          </div>

          <label class="field">
            <span>菜名</span>
            <input v-model.trim="form.name" type="text" placeholder="例如：红烧肉" />
          </label>
          <label class="field">
            <span>分组</span>
            <select v-model="form.groupId">
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>参考价（可选）</span>
            <input v-model="form.price" type="number" min="0" step="0.01" placeholder="留空表示不显示" />
          </label>
          <label class="field">
            <span>排序（可选，小在前）</span>
            <input v-model="form.sortOrder" type="number" min="0" step="1" placeholder="0" />
          </label>

          <p v-if="error" class="form-error">{{ error }}</p>

          <div class="sheet-actions">
            <button type="button" class="btn" @click="close">取消</button>
            <button type="button" class="btn primary" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 分组管理面板 -->
      <div v-if="groupsPanel" class="sheet-mask" @click.self="groupsPanel = false">
        <div class="sheet">
          <h3>分组管理</h3>

          <ul class="group-row-list">
            <li v-for="g in groups" :key="g.id" class="group-row">
              <input v-model.trim="g.name" type="text" class="inline-input" />
              <input v-model.number="g.sortOrder" type="number" class="inline-input sort" />
              <span class="badge muted">{{ g.dishCount }} 道</span>
              <button type="button" class="btn small" @click="saveGroup(g)">保存</button>
              <button type="button" class="btn small danger" @click="removeGroup(g)">删除</button>
            </li>
          </ul>

          <div class="group-add">
            <input v-model.trim="newGroupName" type="text" placeholder="新分组名" class="inline-input" />
            <button type="button" class="btn primary small" @click="addGroup">添加</button>
          </div>

          <div class="sheet-actions">
            <button type="button" class="btn" @click="groupsPanel = false">关闭</button>
          </div>
        </div>
      </div>
    </div>
  `,
  setup() {
    const groups = Vue.ref([]);
    const dishes = Vue.ref([]);
    const loading = Vue.ref(true);
    const filterGroup = Vue.ref('');
    const filterStatus = Vue.ref('');

    const panel = Vue.ref(false);
    const editing = Vue.ref(false);
    const saving = Vue.ref(false);
    const uploading = Vue.ref(false);
    const uploadStage = Vue.ref('');
    const error = Vue.ref('');
    const form = Vue.reactive({ id: 0, name: '', groupId: '', imageUrl: '', price: '', sortOrder: '' });

    const groupsPanel = Vue.ref(false);
    const newGroupName = Vue.ref('');

    function fallback(name) {
      return App.util.fallbackImage(name || '菜');
    }
    function onImgError(event, name) {
      event.target.src = App.util.fallbackImage(name || '菜');
    }

    async function loadGroups() {
      const data = await App.api.get('/api/admin/groups');
      groups.value = data.groups || [];
    }

    async function loadDishes() {
      loading.value = true;
      try {
        const data = await App.api.get('/api/admin/dishes', {
          groupId: filterGroup.value,
          status: filterStatus.value,
        });
        dishes.value = data.dishes || [];
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        loading.value = false;
      }
    }

    function openCreate() {
      editing.value = false;
      error.value = '';
      form.id = 0;
      form.name = '';
      form.groupId = groups.value.length ? groups.value[0].id : '';
      form.imageUrl = '';
      form.price = '';
      form.sortOrder = '';
      panel.value = true;
    }

    function openEdit(d) {
      editing.value = true;
      error.value = '';
      form.id = d.id;
      form.name = d.name;
      form.groupId = d.groupId;
      form.imageUrl = d.imageUrl || '';
      form.price = d.price == null ? '' : String(d.price);
      form.sortOrder = String(d.sortOrder || 0);
      panel.value = true;
    }

    function close() {
      panel.value = false;
    }

    async function onFile(event) {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      uploading.value = true;
      try {
        // 手机原图 3-5MB，先在客户端压到长边 1200px，再传
        uploadStage.value = '压缩中…';
        const compressed = await App.util.compressImage(file);

        uploadStage.value = '上传中…';
        const fd = new FormData();
        fd.append('image', compressed, compressed.name);
        const data = await App.api.upload('/api/admin/dishes/upload', fd);
        form.imageUrl = data.url;
        App.toast.success('图片已上传');
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        uploading.value = false;
        uploadStage.value = '';
      }
    }

    async function save() {
      error.value = '';
      if (!form.name) return (error.value = '请填写菜名');
      if (!form.groupId) return (error.value = '请选择分组');

      saving.value = true;
      try {
        const payload = {
          name: form.name,
          groupId: Number(form.groupId),
          imageUrl: form.imageUrl || null,
          price: form.price === '' ? null : Number(form.price),
          sortOrder: form.sortOrder === '' ? 0 : Number(form.sortOrder),
        };
        if (editing.value) await App.api.patch(`/api/admin/dishes/${form.id}`, payload);
        else await App.api.post('/api/admin/dishes', payload);
        App.toast.success('已保存');
        panel.value = false;
        await loadDishes();
      } catch (err) {
        error.value = err.message;
      } finally {
        saving.value = false;
      }
    }

    async function toggleStatus(d, status) {
      try {
        await App.api.patch(`/api/admin/dishes/${d.id}`, { status });
        App.toast.success(status === 1 ? '已上架' : '已下架');
        await loadDishes();
      } catch (err) {
        App.toast.error(err.message);
      }
    }

    async function addGroup() {
      if (!newGroupName.value) return App.toast.error('请填写分组名');
      try {
        await App.api.post('/api/admin/groups', { name: newGroupName.value });
        newGroupName.value = '';
        await loadGroups();
        App.toast.success('已添加');
      } catch (err) {
        App.toast.error(err.message);
      }
    }

    async function saveGroup(g) {
      try {
        await App.api.patch(`/api/admin/groups/${g.id}`, { name: g.name, sortOrder: g.sortOrder });
        await loadGroups();
        App.toast.success('已保存');
      } catch (err) {
        App.toast.error(err.message);
      }
    }

    async function removeGroup(g) {
      if (!window.confirm(`确定删除分组「${g.name}」吗？`)) return;
      try {
        await App.api.del(`/api/admin/groups/${g.id}`);
        await loadGroups();
        await loadDishes();
        App.toast.success('已删除');
      } catch (err) {
        App.toast.error(err.message);
      }
    }

    Vue.onMounted(async () => {
      try {
        await loadGroups();
        await loadDishes();
      } catch (err) {
        App.toast.error(err.message);
      }
    });

    return {
      groups, dishes, loading, filterGroup, filterStatus,
      panel, editing, saving, uploading, uploadStage, error, form,
      groupsPanel, newGroupName,
      fallback, onImgError, loadGroups, loadDishes,
      openCreate, openEdit, close, onFile, save, toggleStatus,
      addGroup, saveGroup, removeGroup,
    };
  },
};
