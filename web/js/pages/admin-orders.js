'use strict';

App.pages['page-admin-orders'] = {
  template: `
    <div class="page">
      <h2 class="section-title">全部订单</h2>

      <div class="toolbar">
        <label class="date-pick">
          <span>日期</span>
          <input type="date" v-model="date" @change="() => { from = ''; to = ''; page = 1; load(); }" />
        </label>
      </div>
      <div class="toolbar">
        <label class="date-pick">
          <span>从</span>
          <input type="date" v-model="from" @change="() => { date = ''; page = 1; load(); }" />
        </label>
        <label class="date-pick">
          <span>到</span>
          <input type="date" v-model="to" @change="() => { date = ''; page = 1; load(); }" />
        </label>
        <button type="button" class="btn small" @click="clearFilters">全部</button>
      </div>

      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="!orders.length" class="empty">没有符合条件的订单。</div>

      <template v-else>
        <p class="result-count">共 {{ total }} 条</p>

        <ul class="order-list">
          <li v-for="(order, idx) in orders" :key="order.orderDate + '-' + idx" class="order-card">
            <div class="order-head">
              <div>
                <b>{{ friendly(order.orderDate) }}</b>
                <span class="badge" v-if="relative(order.orderDate)">{{ relative(order.orderDate) }}</span>
              </div>
              <span class="who-small">{{ order.displayName }}<em>{{ order.role }}</em></span>
            </div>

            <ul class="mini-items">
              <li v-for="item in order.items" :key="item.dishId">
                <span>{{ item.dishName }}</span>
                <span class="qty">×{{ item.quantity }}</span>
              </li>
            </ul>

            <p v-if="order.notes" class="order-notes">备注：{{ order.notes }}</p>
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
    const date = Vue.ref('');
    const from = Vue.ref('');
    const to = Vue.ref('');
    const page = Vue.ref(1);
    const pageSize = 20;
    const orders = Vue.ref([]);
    const total = Vue.ref(0);
    const loading = Vue.ref(true);

    const friendly = App.util.friendlyDate;
    const relative = App.util.relativeDayLabel;

    async function load() {
      loading.value = true;
      try {
        const data = await App.api.get('/api/admin/orders', {
          date: date.value,
          from: from.value,
          to: to.value,
          page: page.value,
          pageSize,
        });
        orders.value = data.orders || [];
        total.value = data.total || 0;
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        loading.value = false;
      }
    }

    function go(next) {
      page.value = next;
      load();
      window.scrollTo(0, 0);
    }

    function clearFilters() {
      date.value = '';
      from.value = '';
      to.value = '';
      page.value = 1;
      load();
    }

    Vue.onMounted(load);

    return { date, from, to, page, pageSize, orders, total, loading, friendly, relative, load, go, clearFilters };
  },
};
