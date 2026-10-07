'use strict';

App.pages['page-my-orders'] = {
  template: `
    <div class="page">
      <div class="toolbar">
        <label class="date-pick">
          <span>从</span>
          <input type="date" v-model="from" @change="load" />
        </label>
        <label class="date-pick">
          <span>到</span>
          <input type="date" v-model="to" @change="load" />
        </label>
      </div>

      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="!orders.length" class="empty">这段时间还没有点过菜。</div>

      <ul class="order-list" v-else>
        <li v-for="order in orders" :key="order.orderDate" class="order-card">
          <div class="order-head">
            <div>
              <b>{{ friendly(order.orderDate) }}</b>
              <span class="badge" v-if="relative(order.orderDate)">{{ relative(order.orderDate) }}</span>
            </div>
            <span class="badge" :class="order.editable ? 'ok' : 'muted'">
              {{ order.editable ? '可修改' : '已锁定' }}
            </span>
          </div>

          <ul class="mini-items">
            <li v-for="item in order.items" :key="item.dishId">
              <span>{{ item.dishName }}</span>
              <span class="qty">×{{ item.quantity }}</span>
            </li>
          </ul>

          <p v-if="order.notes" class="order-notes">备注：{{ order.notes }}</p>

          <div class="order-actions" v-if="order.editable">
            <button type="button" class="btn small" @click="reOrder(order.orderDate)">修改</button>
            <button type="button" class="btn small danger" :disabled="busy === order.orderDate"
                    @click="remove(order)">
              {{ busy === order.orderDate ? '撤销中…' : '撤销' }}
            </button>
          </div>
        </li>
      </ul>
    </div>
  `,
  setup() {
    const today = App.util.todayStr();
    const from = Vue.ref(App.util.addDays(today, -14));
    const to = Vue.ref(today);
    const orders = Vue.ref([]);
    const loading = Vue.ref(true);
    const busy = Vue.ref('');

    const friendly = App.util.friendlyDate;
    const relative = App.util.relativeDayLabel;

    async function load() {
      loading.value = true;
      try {
        const data = await App.api.get('/api/orders/mine', { from: from.value, to: to.value });
        orders.value = data.orders || [];
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        loading.value = false;
      }
    }

    function reOrder(dateStr) {
      location.hash = `#/menu?date=${dateStr}`;
    }

    async function remove(order) {
      if (!window.confirm(`确定撤销 ${friendly(order.orderDate)} 的订单吗？`)) return;
      busy.value = order.orderDate;
      try {
        await App.api.del(`/api/orders/mine/${order.orderDate}`);
        App.toast.success('已撤销');
        await load();
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        busy.value = '';
      }
    }

    Vue.onMounted(load);

    return { from, to, orders, loading, busy, friendly, relative, load, remove, reOrder };
  },
};
