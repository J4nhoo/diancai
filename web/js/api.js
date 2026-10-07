'use strict';

/** 后端接口封装：注入 Bearer Token，统一解包 {ok, data} / {ok:false, error} */

App.api = (function () {
  const TOKEN_KEY = 'meal_token';
  let token = localStorage.getItem(TOKEN_KEY) || '';
  let onUnauthorized = null;

  function setToken(value) {
    token = value || '';
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function getToken() {
    return token;
  }

  async function request(method, path, { body, query, form } = {}) {
    let url = path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') qs.append(key, value);
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    let payload;
    if (form) {
      payload = form; // FormData，浏览器自行设置 Content-Type
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, { method, headers, body: payload });
    } catch (_) {
      throw new Error('网络异常，请检查网络后重试');
    }

    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      /* 空响应或非 JSON */
    }

    if (res.status === 401) {
      setToken('');
      if (onUnauthorized) onUnauthorized();
      throw new Error((json && json.error && json.error.message) || '登录已失效，请重新登录');
    }

    if (!res.ok || !json || json.ok !== true) {
      const message = (json && json.error && json.error.message) || `请求失败（${res.status}）`;
      const err = new Error(message);
      err.code = json && json.error && json.error.code;
      throw err;
    }

    return json.data;
  }

  return {
    getToken,
    setToken,
    setUnauthorizedHandler(fn) {
      onUnauthorized = fn;
    },
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    put: (path, body) => request('PUT', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    del: (path, body) => request('DELETE', path, { body }),
    upload: (path, form) => request('POST', path, { form }),
  };
})();
