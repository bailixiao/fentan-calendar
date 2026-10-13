// 呼叫分壇的 Worker API。
// 讀取用 GET（逾時就同時再問一次，誰先回來用誰）；寫入用 POST，內容是 JSON 但標頭設 text/plain，避免 CORS 預檢。
(function () {
  'use strict';

  const TOKEN_KEY = 'fentan-calendar:admin';

  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  async function parse(res) {
    if (!res.ok) throw new ApiError('NETWORK', '連線失敗，請稍後再試');
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new ApiError('NETWORK', '伺服器回應格式錯誤，請稍後再試');
    }
    if (!json.ok) throw new ApiError(json.error.code, json.error.message);
    return json.data;
  }

  async function fetchJson(url, init, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await parse(await fetch(url, Object.assign({ signal: ctrl.signal }, init)));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('NETWORK', '無法連線，請檢查網路後再試');
    } finally {
      clearTimeout(timer);
    }
  }

  /** 讀取：4 秒沒回來就同時再送一次（前一個不取消），最多 3 個；全部都連線失敗才算失敗 */
  function get(action, params) {
    const url = window.APP_CONFIG.API_URL + '?' + new URLSearchParams(Object.assign({ action }, params || {})).toString();
    const waits = [4000, 8000];
    return new Promise((resolve, reject) => {
      let done = false;
      let started = 0;
      let failed = 0;
      let timer = null;
      const launch = () => {
        if (done) return;
        started++;
        if (started <= waits.length) timer = setTimeout(launch, waits[started - 1]);
        fetchJson(url, {}, 20000).then((data) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(data);
        }, (err) => {
          if (done) return;
          if (err.code !== 'NETWORK') { done = true; clearTimeout(timer); return reject(err); }
          failed++;
          if (failed < started) return;
          if (started <= waits.length) { clearTimeout(timer); launch(); return; }
          done = true;
          reject(err);
        });
      };
      launch();
    });
  }

  function post(body) {
    return fetchJson(window.APP_CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }, 30000);
  }

  // ---------- 管理後台：通行碼存在這個瀏覽器（12 小時後過期）；讀寫失敗只是要重新登入 ----------

  function loadSaved() {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      return t && t.expires > Date.now() ? t : null;
    } catch (e) {
      return null;
    }
  }

  /** 記住通行碼與登入的是誰（總管理者，或某一區的組長帳號） */
  function saveToken(token, expiresInSec, account, role) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, account: account || '總管理者', role: role || 'super', expires: Date.now() + expiresInSec * 1000 - 60000 }));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 無痕模式等，忽略 */ }
  }

  const saved = loadSaved();
  let adminToken = saved ? saved.token : null;
  let adminWho = saved ? { account: saved.account || '總管理者', role: saved.role || 'super' } : null;

  /** 管理 API（一律 POST，通行碼放在內容）。通行碼無效時清除並丟出 UNAUTHORIZED，由畫面導回登入 */
  async function admin(action, payload) {
    try {
      return await post(Object.assign({ action, token: adminToken }, payload || {}));
    } catch (err) {
      if (err.code === 'UNAUTHORIZED' && /登入/.test(err.message)) { adminToken = null; adminWho = null; saveToken(null); }
      throw err;
    }
  }

  async function adminLogin(password, account) {
    const data = await post({ action: 'adminLogin', password, account: account || '' });
    adminToken = data.token;
    adminWho = { account: data.account || '總管理者', role: data.role || 'super' };
    saveToken(data.token, data.expiresInSec, adminWho.account, adminWho.role);
  }

  function adminLogout() {
    const token = adminToken;
    adminToken = null;
    adminWho = null;
    saveToken(null);
    if (token) post({ action: 'adminLogout', token }).catch(() => {});
  }

  window.Api = {
    ApiError,
    getEvents: (from, to, fresh) => get('getEvents', Object.assign({ from, to }, fresh ? { fresh: '1' } : {})),
    // 分壇行事曆畫面：只有分壇的活動，各區的勤務掛在下面（規格第 9-3 節）
    getCalendar: (from, to, fresh, test) => get('getCalendar', Object.assign({ from, to }, fresh ? { fresh: '1' } : {}, test ? { test: '1' } : {})),
    loginAccounts: () => get('loginAccounts', {}),
    // 手機提醒：只送推播網址和單位，沒有名字
    pushKey: () => get('pushKey', {}),
    pushSubscribe: (endpoint, unit) => post({ action: 'pushSubscribe', endpoint, unit }),
    pushUnsubscribe: (endpoint) => post({ action: 'pushUnsubscribe', endpoint }),
    pushTest: (endpoint) => post({ action: 'pushTest', endpoint }),
    admin,
    adminLogin,
    adminLogout,
    isAdmin: () => !!adminToken,
    who: () => adminWho // { account, role: 'super' | 'region' }
  };
})();
