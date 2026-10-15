'use strict';

/**
 * 点菜页：列表 + 搜索 → 点进详情才有加减。
 *
 * 列表页只做浏览和搜索，避免误触；加减数量在详情页操作。
 * 视图切换是页内状态，不走路由 —— 手写 hash 路由没必要为它加一层。
 */

App.pages['page-menu'] = {
  template: `
    <div class="page">
      <div class="toolbar">
        <label class="date-pick">
          <span>用餐日期</span>
          <input type="date" v-model="date" :min="minDate"
                 @focus="rememberDate" @change="onDateChange(prevDate)" />
        </label>
        <span class="badge" v-if="relative">{{ relative }}</span>
      </div>

      <p v-if="editable === false" class="notice warn">
        该日期已过期，只能查看，不能修改。
      </p>

      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="!groups.length" class="empty">还没有菜品，请联系管理者添加。</div>

      <!-- ============ 列表视图 ============ -->
      <template v-else-if="view === 'list'">
        <div class="search-row">
          <input v-model.trim="search" type="search" placeholder="搜索菜名…" class="search-input" />
          <button type="button" class="btn small" v-if="search" @click="search = ''">清空</button>
        </div>

        <div v-if="!filteredGroups.length" class="empty">没有找到「{{ search }}」相关的菜。</div>

        <section v-for="group in filteredGroups" :key="group.id" class="group">
          <h3 class="group-title">{{ group.name }}</h3>
          <ul class="dish-list">
            <li v-for="dish in group.dishes" :key="dish.id"
                class="dish-row" :class="{ picked: qty(dish.id) > 0 }"
                @click="openDetail(dish)">
              <img :src="dish.imageUrl || fallback(dish.name)" :alt="dish.name"
                   @error="onImgError($event, dish.name)" />
              <div class="dish-info">
                <div class="dish-name">{{ dish.name }}</div>
                <div class="dish-sub" v-if="dish.notes">{{ dish.notes }}</div>
              </div>
              <span class="qty-badge" v-if="qty(dish.id) > 0">{{ qty(dish.id) }}</span>
              <span class="chevron">›</span>
            </li>
          </ul>
        </section>
      </template>

      <!-- ============ 详情视图 ============ -->
      <template v-else-if="activeDish">
        <button type="button" class="btn small back-btn" @click="backToList">← 返回列表</button>

        <div class="dish-detail">
          <img class="detail-img" :src="activeDish.imageUrl || fallback(activeDish.name)"
               :alt="activeDish.name" @error="onImgError($event, activeDish.name)" />
          <h3 class="detail-name">{{ activeDish.name }}</h3>
          <p class="detail-group" v-if="activeDish.groupName">{{ activeDish.groupName }}</p>
          <p class="detail-notes" v-if="activeDish.notes">{{ activeDish.notes }}</p>

          <div class="detail-stepper" v-if="editable">
            <button type="button" class="big-btn" :disabled="qty(activeDish.id) === 0"
                    @click="dec(activeDish.id)">−</button>
            <span class="detail-num">{{ qty(activeDish.id) }}</span>
            <button type="button" class="big-btn" @click="inc(activeDish.id)">+</button>
          </div>
          <p class="detail-locked" v-else>该日期已过期，只能查看。</p>
        </div>

        <!-- ============ 评价区 ============ -->
        <section class="review-section">
          <div class="review-head">
            <h3 class="group-title">评价</h3>
            <span class="review-summary" v-if="reviews.count">
              <b>{{ reviews.average }}</b> 分 · {{ reviews.count }} 条
            </span>
            <span class="review-summary muted" v-else>还没有评价</span>
          </div>

          <!-- 只有点过这道菜、且有评价权限时才显示输入区 -->
          <div class="review-form" v-if="canReview">
            <div class="star-row">
              <button v-for="n in 5" :key="n" type="button"
                      class="star" :class="{ on: n <= draft.rating }"
                      @click="draft.rating = n">★</button>
              <span class="star-hint">{{ draft.rating ? draft.rating + ' 星' : '点击打分' }}</span>
            </div>
            <textarea v-model="draft.content" rows="2" maxlength="500"
                      placeholder="说说这道菜怎么样（可选）"></textarea>
            <div class="review-actions">
              <button type="button" class="btn primary small" :disabled="!draft.rating || savingReview"
                      @click="submitReview">
                {{ savingReview ? '提交中…' : (myReview ? '更新评价' : '发表评价') }}
              </button>
              <button type="button" class="btn small danger" v-if="myReview"
                      @click="deleteReview(myReview.id)">撤回</button>
            </div>
          </div>
          <p class="review-locked" v-else-if="canReviewPermission">
            在这天点过这道菜才能评价。
          </p>
          <p class="review-locked" v-else>你没有「评价菜品」的权限。</p>

          <ul class="review-list" v-if="reviews.reviews.length">
            <li v-for="r in reviews.reviews" :key="r.id" class="review-item" :class="{ mine: r.mine }">
              <div class="review-meta">
                <b>{{ r.displayName }}</b>
                <span class="review-stars">{{ '★'.repeat(r.rating) }}<em>{{ '★'.repeat(5 - r.rating) }}</em></span>
                <span class="review-date">{{ friendly(r.orderDate) }}</span>
              </div>
              <p class="review-content" v-if="r.content">{{ r.content }}</p>
            </li>
          </ul>
        </section>
      </template>

      <!-- 详情页也显示已选概览，避免每次都要返回列表才知道选了多少 -->
      <div class="submit-bar compact" v-if="view === 'detail' && groups.length">
        <div class="submit-row">
          <span class="picked-count">已选 <b>{{ pickedCount }}</b> 道 · 共 {{ totalQuantity }} 份</span>
          <button type="button" class="btn primary" @click="goSubmit">去提交</button>
        </div>
      </div>

      <!-- 列表视图底部才显示购物车；详情页返回后即可看到 -->
      <div class="submit-bar" v-if="!loading && groups.length && view === 'list'">
        <textarea v-model="notes" class="notes" rows="2" maxlength="500"
                  :disabled="!editable" placeholder="忌口 / 备注（例如：不要放香菜）"></textarea>
        <div class="submit-row">
          <span class="picked-count">已选 <b>{{ pickedCount }}</b> 道 · 共 {{ totalQuantity }} 份</span>
          <button type="button" class="btn small" v-if="pickedCount && editable" @click="clearAll">清空</button>
          <button type="button" class="btn primary" :disabled="!canSubmit" @click="submit">
            {{ saving ? '提交中…' : (hasOrder ? '更新订单' : '提交订单') }}
          </button>
        </div>
      </div>

      <p class="hint" v-if="view === 'list'">可提前为明天及以后点菜；过期日期只可查看。</p>
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

    // 视图状态：list（列表+搜索）/ detail（详情+加减）
    const view = Vue.ref('list');
    const activeDish = Vue.ref(null);
    const search = Vue.ref('');

    // 评价
    const reviews = Vue.ref({ count: 0, average: null, reviews: [] });
    const myReview = Vue.ref(null);
    const draft = Vue.reactive({ rating: 0, content: '' });
    const savingReview = Vue.ref(false);
    // 已【提交】订单里的菜品 id。不能用 cart 判断：cart 还包含刚选但没提交的菜，
    // 而评价的前提是确实点过（后端也会再校验一次）。
    const orderedIds = Vue.ref(new Set());
    const canReviewPermission = Vue.computed(() => App.store.can('review.create'));
    const canReview = Vue.computed(
      () => canReviewPermission.value && !!activeDish.value && orderedIds.value.has(activeDish.value.id)
    );

    const relative = Vue.computed(() => App.util.relativeDayLabel(date.value));
    const friendly = App.util.friendlyDate;

    /** 当前购物车快照，用来判断是否有未提交的改动 */
    function snapshot() {
      const items = Object.entries(cart)
        .map(([id, q]) => [Number(id), q])
        .sort((a, b) => a[0] - b[0]);
      return JSON.stringify({ items, notes: notes.value });
    }
    let savedSnapshot = snapshot();

    const hasUnsavedChanges = Vue.computed(() => snapshot() !== savedSnapshot);

    /**
     * 按关键词过滤：菜名匹配，或【分组名匹配时整组保留】。
     * 这样搜「汤」能列出汤类全部菜品，而不只是菜名里带「汤」字的。
     */
    const filteredGroups = Vue.computed(() => {
      const kw = search.value.trim().toLowerCase();
      if (!kw) return groups.value;
      return groups.value
        .map((g) => {
          const groupHit = (g.name || '').toLowerCase().includes(kw);
          const dishes = groupHit
            ? g.dishes
            : g.dishes.filter((d) => (d.name || '').toLowerCase().includes(kw));
          return { ...g, dishes };
        })
        .filter((g) => g.dishes.length > 0);
    });

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

    function openDetail(dish) {
      // 补上分组名，详情页要显示
      activeDish.value = {
        ...dish,
        groupName: groups.value.find((g) => g.dishes.some((d) => d.id === dish.id))?.name || '',
      };
      view.value = 'detail';
      loadReviews(dish.id);
    }

    /** 载入该菜的评价；失败不打断主流程（评价是附加信息） */
    async function loadReviews(dishId) {
      reviews.value = { count: 0, average: null, reviews: [] };
      try {
        reviews.value = await App.api.get(`/api/reviews/dish/${dishId}`);
      } catch (_) {
        /* 忽略：没有评价或接口异常都不该阻碍点菜 */
      }
      // 把自己在当前日期已写过的评价回填到输入区，方便修改
      const mine = reviews.value.reviews.find((r) => r.mine && r.orderDate === date.value);
      myReview.value = mine || null;
      draft.rating = mine ? mine.rating : 0;
      draft.content = mine ? mine.content : '';
    }

    async function submitReview() {
      if (!draft.rating) return App.toast.error('请先打分');
      savingReview.value = true;
      try {
        await App.api.post('/api/reviews', {
          dishId: activeDish.value.id,
          orderDate: date.value,
          rating: draft.rating,
          content: draft.content,
        });
        App.toast.success('评价已保存');
        await loadReviews(activeDish.value.id);
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        savingReview.value = false;
      }
    }

    async function deleteReview(id) {
      if (!window.confirm('确定撤回这条评价吗？')) return;
      try {
        await App.api.del(`/api/reviews/${id}`);
        App.toast.success('已撤回');
        await loadReviews(activeDish.value.id);
      } catch (err) {
        App.toast.error(err.message);
      }
    }

    function backToList() {
      view.value = 'list';
      activeDish.value = null;
    }

    /** 详情页点「去提交」：回到列表并滚到提交栏 */
    function goSubmit() {
      backToList();
      Vue.nextTick(() => {
        const bar = document.querySelector('.submit-bar');
        if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    }

    /** 清空已选（保留备注，备注是独立填写的） */
    function clearAll() {
      if (!window.confirm('确定清空已选的所有菜吗？')) return;
      clearCart();
    }

    function clearCart() {
      for (const key of Object.keys(cart)) delete cart[key];
    }

    async function commitAndLoadOrder() {
      const order = await App.api.get(`/api/orders/mine/${date.value}`);
      clearCart();
      for (const item of order.items || []) cart[item.dishId] = item.quantity;
      notes.value = order.notes || '';
      hasOrder.value = (order.items || []).length > 0;
      editable.value = order.editable !== false;
      // 记录已提交的菜品，用于判断能否评价
      orderedIds.value = new Set((order.items || []).map((i) => i.dishId));
      savedSnapshot = snapshot();
    }

    async function loadMenu() {
      const data = await App.api.get('/api/menu');
      groups.value = data.groups || [];
    }

    /**
     * 切换日期。如果当前有未提交的已选，先确认 —— 否则会被静默清空。
     * 用户取消时把日期改回去（input 的值已经变了，必须手动回滚）。
     * prevDate 由 @focus 时记录，因为 change 触发时 v-model 已经更新了。
     */
    const prevDate = Vue.ref(minDate);

    function rememberDate() {
      prevDate.value = date.value;
    }

    async function onDateChange(previous) {
      if (hasUnsavedChanges.value && pickedCount.value > 0) {
        const ok = window.confirm('切换日期会清空当前已选（未提交），确定继续吗？');
        if (!ok) {
          date.value = previous || minDate;
          return;
        }
      }
      loading.value = true;
      backToList();
      try {
        await commitAndLoadOrder();
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
        await commitAndLoadOrder();
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
        if (groups.value.length) await commitAndLoadOrder();
      } catch (err) {
        App.toast.error(err.message);
      } finally {
        loading.value = false;
      }
    });

    return {
      minDate, date, groups, notes, loading, saving, hasOrder, editable, relative,
      view, activeDish, search, filteredGroups,
      reviews, myReview, draft, savingReview, canReview, canReviewPermission,
      submitReview, deleteReview, friendly,
      qty, inc, dec, pickedCount, totalQuantity, canSubmit, submit, onDateChange, rememberDate,
      openDetail, backToList, goSubmit, clearAll, fallback, onImgError,
    };
  },
};
