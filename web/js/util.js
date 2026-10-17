'use strict';

/** 全局命名空间：各文件按顺序挂载，页面组件注册到 App.pages */
window.App = { pages: {} };

App.util = (function () {
  // 餐次。与后端 server/src/meals.js 保持一致，改的时候两处都要动
  // （前端不引入构建工具，无法共享模块）
  const MEALS = [
    { key: 'breakfast', label: '早餐' },
    { key: 'lunch', label: '午餐' },
    { key: 'dinner', label: '晚餐' },
  ];
  const MEAL_LABEL = Object.fromEntries(MEALS.map((m) => [m.key, m.label]));

  /** 按小时推当前餐次。与后端 currentMeal() 同规则（10 点 / 16 点分界）。 */
  function currentMeal(date) {
    const hour = (date || new Date()).getHours();
    if (hour < 10) return 'breakfast';
    if (hour < 16) return 'lunch';
    return 'dinner';
  }

  function mealLabel(key) {
    return MEAL_LABEL[key] || key || '';
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 本地日期字符串 YYYY-MM-DD（不经过 UTC，避免时区偏移） */
  function toDateStr(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function todayStr() {
    return toDateStr(new Date());
  }

  function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return toDateStr(date);
  }

  /** 2026-10-07 -> 10月7日 周三 */
  function friendlyDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
    return `${m}月${d}日 ${week}`;
  }

  function relativeDayLabel(dateStr) {
    const today = todayStr();
    if (dateStr === today) return '今天';
    if (dateStr === addDays(today, 1)) return '明天';
    if (dateStr === addDays(today, -1)) return '昨天';
    return '';
  }

  /** 复制文本：优先 Clipboard API，微信 webview 下回退到 execCommand */
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      /* 落到下面的回退方案 */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const okDone = document.execCommand('copy');
      document.body.removeChild(ta);
      return okDone;
    } catch (_) {
      return false;
    }
  }

  /** 图片加载失败时的占位（inline SVG，避免额外请求） */
  function fallbackImage(label) {
    const ch = (label || '菜').slice(0, 1);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">` +
      `<rect width="120" height="120" fill="#f1ece6"/>` +
      `<text x="60" y="72" font-size="44" fill="#c0997a" text-anchor="middle" font-family="sans-serif">${ch}</text>` +
      `</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  /** 把图片解码成 ImageBitmap / HTMLImageElement，失败返回 null */
  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        // imageOrientation: 'from-image' 让手机竖拍的照片按 EXIF 摆正
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (_) {
        /* 落到下面的 img 方案 */
      }
    }
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  /**
   * 上传前压缩：长边缩到 maxSize，输出 JPEG。
   * 手机原始照片 3-5MB，压缩后约 200-400KB，蜂窝网络上传从十几秒降到 1 秒内。
   * 任何环节失败都回退成原文件，不阻断上传。
   */
  async function compressImage(file, { maxSize = 1200, quality = 0.8 } = {}) {
    try {
      // GIF 和 SVG 不能这么压，直接放行
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;

      const source = await decodeImage(file);
      if (!source) return file;

      const w = source.width || source.naturalWidth;
      const h = source.height || source.naturalHeight;
      if (!w || !h) return file;

      const scale = Math.min(1, maxSize / Math.max(w, h));
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      // 铺白底，避免 PNG 透明区域转 JPEG 后变黑
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, tw, th);
      ctx.drawImage(source, 0, 0, tw, th);
      if (source.close) source.close();

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) return file;
      // 压缩后反而更大就用原图
      if (blob.size >= file.size) return file;

      const name = file.name.replace(/\.[^.]+$/, '') || 'dish';
      return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
    } catch (_) {
      return file;
    }
  }

  return {
    todayStr, addDays, friendlyDate, relativeDayLabel, copyText, toDateStr, fallbackImage,
    compressImage, MEALS, currentMeal, mealLabel,
  };
})();
