'use strict';

App.pages['page-menu'] = {
  template: `
    <div class="page">
      <div class="toolbar">
        <label class="date-pick">
          <span>用餐日期</span>
          <input type="date" v-model="date" :min="minDate" @change="onDateChange" />
        </label>
        <span class="badge" v-if="relative">{{ relative }}</span>
      </div>

      <p v-if="editable === false" class="notice warn">
        该日期已过期，只能查看，不能修改。
      </p>

      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="!groups.length" class="empty">还没有菜品，请联系管理者添加。</div>

      <template v-else>
        <section v-for="group in groups" :key="group.id" class="group">
          <h3 class="group-title">{{ group.name }}</h3>
          <ul class="dish-list">
            <li v-for="dish in group.dishes" :key="dish.id"
                class="dish" :class="{ picked: qty(dish.id) > 0, disabled: !editable }">
              <img :src="dish.imageUrl || fallback(dish.name)" :alt="dish.name"
                   @error="onImgError($event, dish.name)" />
              <div class="dish-info">
                <div class="dish-name">{{ dish.name }}</div>
              </div>
              <div class="stepper" v-if="editable">
                <button type="button" :disabled="qty(dish.id) === 0" @click="dec(dish.id)">−</button>
                <span class="num">{{ qty(dish.id) }}</span>
                <button type="button" @click="inc(dish.id)">+</button>
              </div>
              <div class="stepper readonly" v-else>
                <span class="num">×{{ qty(dish.id) }}</span>
              </div>
            </li>
          </ul>
        </section>
      </template>

      <div class="submit-bar" v-if="!loading && groups.length">
        <textarea v-model="notes" class="notes" rows="2" maxlength="500"
                  :disabled="!editable" placeholder="忌口 / 备注（例如：不要放香菜）"></textarea>
        <div class="submit-row">
          <span class="picked-count">已选 <b>{{ pickedCount }}</b> 道 · 共 {{ totalQuantity }} 份</span>
          <button type="button" class="btn primary" :disabled="!canSubmit" @click="submit">
            {{ saving ? '提交中…' : (hasOrder ? '更新订单' : '提交订单') }}
          </button>
        </div>
      </div>

      <p class="hint">可提前为明天及以后点菜；过期日期只可查看。</p>
    </div>
  `,
  setup() {
    const minDate = App.util.todayStr();
    const date = Vue.ref(minDate);
    const groups = Vue.ref([]);
    const cart = Vue.reactive({});
    const notes = Vue.ref('');
    const loading = Vue.ref(true);
    const saving = Vue.ref(false);
    const hasOrder = Vue.ref(false);
    const editable = Vue.ref(true);

    const relative = Vue.computed(() => App.util.relativeDayLabel(date.value));

    function qty(dishId) {
      return cart[dishId] || 0;
    }

    function inc(dishId) {
      cart[dishId] = Math.min(99, qty(dishId) + 1);
    }

    function dec(dishId) {
      const next = qty(dishId) - 1;
      if (next <= 0) delete cart[dishId];
      else cart[dishId] = next;
    }

    const pickedCount = Vue.computed(() => Object.keys(cart).length);
    const totalQuantity = Vue.computed(() =>
      Object.values(cart).reduce((sum, n) => sum + n, 0)
    );
    const canSubmit = Vue.computed(() => editable.value && pickedCount.value > 0 && !saving.value);

    function clearCart() {
      for (const key of Object.keys(cart)) delete cart[key];
    }

    async function loadOrder() {
      const order = await App.api.get(`/api/orders/mine/${date.value}`);
      clearCart();
      for (const item of order.items || []) cart[item.dishId] = item.quantity;
      notes.value = order.notes || '';
      hasOrder.value = (order.items || []).length > 0;
      editable.value = order.editable !== false;
    }

    async function loadMenu() {
      const data = await App.api.get('/api/menu');
      groups.value = data.groups || [];
    }

    async function onDateChange() {
      loading.value = true;
      try {
        await loadOrder();
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        loading.value = false;
      }
    }

    async function submit() {
      saving.value = true;
      try {
        const items = Object.entries(cart).map(([dishId, quantity]) => ({
          dishId: Number(dishId),
          quantity,
        }));
        await App.api.post('/api/orders', {
          orderDate: date.value,
          notes: notes.value,
          items,
        });
        App.toast.success('已提交');
        await loadOrder();
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        saving.value = false;
      }
    }

    function fallback(name) {
      return App.util.fallbackImage(name);
    }

    function onImgError(event, name) {
      event.target.src = App.util.fallbackImage(name);
    }

    Vue.onMounted(async () => {
      const fromQuery = App.router.state.query.date;
      if (fromQuery) date.value = fromQuery < minDate ? minDate : fromQuery;
      try {
        await loadMenu();
        if (groups.value.length) await loadOrder();
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        loading.value = false;
      }
    });

    return {
      minDate, date, groups, notes, loading, saving, hasOrder, editable, relative,
      qty, inc, dec, pickedCount, totalQuantity, canSubmit, submit, onDateChange,
      fallback, onImgError,
    };
  },
};
