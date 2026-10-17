'use strict';

App.pages['page-summary'] = {
  template: `
    <div class="page">
      <div class="meal-tabs">
        <button v-for="m in meals" :key="m.key" type="button"
                class="meal-tab" :class="{ active: m.key === meal }"
                @click="switchMeal(m.key)">{{ m.label }}</button>
      </div>

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

        <div v-if="!groups.length" class="empty">这一餐还没有人点菜。</div>

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

          <!-- 各人订单：把「谁点了什么」和合并后的采购清单放在同一页。
               只有拥有 order.viewAll 的人能看到；后端也会再校验一次。 -->
          <section class="group" v-if="canViewAll">
            <h3 class="group-title">各人订单（{{ orders.length }} 单）</h3>
            <ul class="order-list">
              <li v-for="o in orders" :key="o.orderId" class="order-card">
                <div class="order-head">
                  <div>
                    <b>{{ o.displayName }}</b>
                    <span class="badge muted" v-if="o.role">{{ o.role }}</span>
                  </div>
                  <button type="button" class="btn small danger" v-if="canDelete"
                          :disabled="deleting === o.orderId" @click="removeOrder(o)">
                    {{ deleting === o.orderId ? '…' : '删除' }}
                  </button>
                </div>

                <ul class="mini-items">
                  <li v-for="item in o.items" :key="item.dishId">
                    <span>{{ item.dishName }}<em class="flavor" v-if="item.flavor">（{{ item.flavor }}）</em></span>
                    <span class="qty">×{{ item.quantity }}</span>
                  </li>
                </ul>

                <p v-if="o.notes" class="order-notes">备注：{{ o.notes }}</p>
              </li>
            </ul>
          </section>
        </template>
      </template>
    </div>
  `,
  setup() {
    const date = Vue.ref(App.router.state.query.date || App.util.todayStr());
    const meals = App.util.MEALS;
    // 默认按当前时间落在对应餐次，厨师打开就是当下要准备的
    const meal = Vue.ref(App.router.state.query.meal || App.util.currentMeal());
    const data = Vue.ref({});
    const loading = Vue.ref(true);
    const deleting = Vue.ref(null);
    const canDelete = Vue.computed(() => App.store.can('order.delete'));
    const canViewAll = Vue.computed(() => App.store.can('order.viewAll'));

    function switchMeal(next) {
      if (next === meal.value) return;
      meal.value = next;
      load();
    }
    const relative = Vue.computed(() => App.util.relativeDayLabel(date.value));

    const groups = Vue.computed(() =>
      (data.value.groups || []).map((g, index) => ({
        groupKey: g.groupId == null ? `none-${index}` : g.groupId,
        groupName: g.groupName,
        dishes: g.dishes,
      }))
    );
    const notes = Vue.computed(() => data.value.notes || []);
    const orders = Vue.computed(() => data.value.orders || []);

    async function removeOrder(o) {
      const ok = window.confirm(
        `确定永久删除「${o.displayName}」的这一单吗？\n\n` +
          `菜品：${o.items.map((i) => `${i.dishName}×${i.quantity}`).join('、')}\n` +
          `此操作不可撤销。`
      );
      if (!ok) return;
      deleting.value = o.orderId;
      try {
        await App.api.del(`/api/admin/orders/${o.orderId}`);
        App.toast.success('已删除');
        await load();
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        deleting.value = null;
      }
    }

    async function load() {
      loading.value = true;
      try {
        data.value = await App.api.get('/api/summary', { date: date.value, meal: meal.value });
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

    return {
      date, data, loading, groups, notes, orders, relative, load, copy, fallback, onImgError,
      meals, meal, switchMeal, deleting, canDelete, canViewAll, removeOrder,
    };
  },
};
