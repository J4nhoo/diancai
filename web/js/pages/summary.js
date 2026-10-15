'use strict';

App.pages['page-summary'] = {
  template: `
    <div class="page">
      <div class="toolbar">
        <label class="date-pick">
          <span>日期</span>
          <input type="date" v-model="date" @change="load" />
        </label>
        <span class="badge" v-if="relative">{{ relative }}</span>
      </div>

      <div v-if="loading" class="loading">加载中…</div>

      <template v-else>
        <div class="stat-row">
          <div class="stat"><b>{{ data.orderCount || 0 }}</b><span>人点菜</span></div>
          <div class="stat"><b>{{ data.dishCount || 0 }}</b><span>道菜</span></div>
          <div class="stat"><b>{{ data.totalQuantity || 0 }}</b><span>总份数</span></div>
        </div>

        <div v-if="!groups.length" class="empty">这一天还没有人点菜。</div>

        <template v-else>
          <button type="button" class="btn primary block" @click="copy">一键复制菜单</button>

          <section v-for="group in groups" :key="group.groupKey" class="group">
            <h3 class="group-title">{{ group.groupName }}</h3>
            <ul class="summary-list">
              <li v-for="dish in group.dishes" :key="dish.dishId" class="summary-item">
                <img class="summary-thumb" :src="dish.imageUrl || fallback(dish.dishName)"
                     :alt="dish.dishName" @error="onImgError($event, dish.dishName)" />
                <span class="dish-name">{{ dish.dishName }}</span>
                <span class="summary-qty">×{{ dish.totalQuantity }}</span>
              </li>
            </ul>
          </section>

          <section v-if="notes.length" class="group">
            <h3 class="group-title">忌口 / 备注</h3>
            <ul class="note-list">
              <li v-for="(note, i) in notes" :key="i" class="note-item">
                <b>{{ note.displayName }}</b>
                <span>{{ note.notes }}</span>
              </li>
            </ul>
          </section>

          <details class="raw">
            <summary>查看可复制的文本</summary>
            <pre class="raw-text">{{ data.text }}</pre>
          </details>
        </template>
      </template>
    </div>
  `,
  setup() {
    const date = Vue.ref(App.router.state.query.date || App.util.todayStr());
    const data = Vue.ref({});
    const loading = Vue.ref(true);
    const relative = Vue.computed(() => App.util.relativeDayLabel(date.value));

    const groups = Vue.computed(() =>
      (data.value.groups || []).map((g, index) => ({
        groupKey: g.groupId == null ? `none-${index}` : g.groupId,
        groupName: g.groupName,
        dishes: g.dishes,
      }))
    );
    const notes = Vue.computed(() => data.value.notes || []);

    async function load() {
      loading.value = true;
      try {
        data.value = await App.api.get('/api/summary', { date: date.value });
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        loading.value = false;
      }
    }

    async function copy() {
      const text = data.value.text || '';
      const done = await App.util.copyText(text);
      if (done) App.toast.success('菜单已复制');
      else App.toast.error('复制失败，请长按下方文本手动复制');
    }

    Vue.onMounted(load);

    function fallback(name) {
      return App.util.fallbackImage(name);
    }
    function onImgError(event, name) {
      event.target.src = App.util.fallbackImage(name);
    }

    return { date, data, loading, groups, notes, relative, load, copy, fallback, onImgError };
  },
};
