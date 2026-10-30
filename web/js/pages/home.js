'use strict';

/**
 * 首页：产品介绍。
 *
 * 为什么需要它：之前登录后直接落地点菜页，而点菜页每次进入都要弹"选餐次"，
 * 等于每次登录都被弹窗拦一下。加一层首页既解决这个打断，也顺带把
 * "这个应用是干什么的"讲清楚 —— 新来的家人第一次登录能看懂。
 *
 * 不需要任何权限，所有登录用户都能看。
 */

App.pages['page-home'] = {
  template: `
    <div class="page home">
      <section class="home-hero">
        <div class="home-logo">朝</div>
        <h1 class="home-name">朝夕家膳</h1>
        <p class="home-slogan">告别凭空想菜，全家点餐分工清晰，口味汇总、评价留档一步到位</p>
      </section>

      <section class="home-intro">
        <h2 class="home-section-title">产品简介</h2>
        <p>还在为每天三餐纠结吃什么？还在群里反复统计家人想吃的菜品？</p>
        <p>本点餐系统一站式解决家庭用餐全部难题：</p>
        <ul class="home-features">
          <li><span class="tick">✅</span>自建菜品库，菜品自由分类搭配，轻松解决选菜难题；</li>
          <li><span class="tick">✅</span>严格区分家人、厨师两大账号权限，不同角色展示不同页面信息；</li>
          <li><span class="tick">✅</span>全员点餐信息自动汇总，生成清晰烹饪清单，厨师直接对照制作；</li>
          <li><span class="tick">✅</span>支持餐后菜品打分点评，沉淀全家口味偏好；</li>
          <li><span class="tick">✅</span>所有点餐订单永久保存，历史三餐记录随时查询回看。</li>
        </ul>
        <p class="home-note">分早午晚餐独立点菜，午晚餐共用菜单，三餐有序，备餐省心。</p>
      </section>

      <section class="home-cards">
        <h2 class="home-section-title">核心功能</h2>
        <div class="feature-card" v-for="f in features" :key="f.title">
          <div class="feature-icon">{{ f.icon }}</div>
          <div class="feature-body">
            <h3 class="feature-title">{{ f.title }}</h3>
            <p class="feature-desc">{{ f.desc }}</p>
          </div>
        </div>
      </section>

      <p class="home-footer">朝夕家膳 · 一日三餐，有据可依</p>
    </div>
  `,
  setup() {
    const features = [
      {
        icon: '📚',
        title: '菜品库管理',
        desc: '菜品统一维护，自由搭配组合，告别"想不出吃什么"',
      },
      {
        icon: '👥',
        title: '多角色权限管控',
        desc: '家人点菜、厨师看单，账号分离，页面内容独立展示',
      },
      {
        icon: '📋',
        title: '用餐需求自动汇总',
        desc: '全员点餐一键合并，自动生成烹饪清单，省去人工统计',
      },
      {
        icon: '⭐',
        title: '菜品口碑评价',
        desc: '餐后打分写点评，记录每道菜的好坏，持续优化菜谱',
      },
      {
        icon: '🗂️',
        title: '订单历史永久存档',
        desc: '三餐订单完整留存，过往菜单随时查阅，三餐有据可查',
      },
    ];

    return { features };
  },
};
