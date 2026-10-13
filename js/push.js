// 手機提醒（規格第 10-1 節）：行事曆上方「🔔 手機提醒」，選要收哪個單位的提醒 → 開啟；可以改單位、傳測試通知、關閉。
// 只存推播網址和選的單位，不存名字。通知一定要本人按允許。
(function () {
  'use strict';

  const UNIT_KEY = 'fentan-calendar:push-unit';
  const el = {};
  const st = { sub: null, unit: '', busy: false, msg: '', msgKind: '' };

  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  // 本機預覽不能開啟（window.__pushDemo：截常見問題的圖時，顯示正式網站的畫面）
  const local = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !window.__pushDemo;

  function readUnit() {
    try { return localStorage.getItem(UNIT_KEY) || ''; } catch (e) { return ''; }
  }
  function saveUnit(u) {
    try { if (u) localStorage.setItem(UNIT_KEY, u); else localStorage.removeItem(UNIT_KEY); } catch (e) { /* 不記住 */ }
  }

  function unitLabel(u) {
    return u === window.SITE.fentan ? '分壇的活動' : `${u}＋分壇的活動`;
  }

  function unitOptions(selected) {
    return [window.SITE.fentan].concat(window.SITE.units)
      .map((u) => `<option value="${Fmt.esc(u)}"${u === selected ? ' selected' : ''}>${Fmt.esc(u === window.SITE.fentan ? '分壇' : u)}</option>`).join('');
  }

  /** base64url → Uint8Array（applicationServerKey 用） */
  function keyBytes(b64) {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }

  async function registration() {
    return navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready);
  }

  async function refresh() {
    st.sub = null;
    if (supported() && !local() && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        st.sub = reg ? await reg.pushManager.getSubscription() : null;
      } catch (e) { st.sub = null; }
    }
    st.unit = readUnit();
    if (st.sub && !st.unit) st.unit = window.SITE.fentan;
    renderButton();
  }

  function renderButton() {
    el.btn.textContent = st.sub ? `🔔 手機提醒：已開啟（${st.unit === window.SITE.fentan ? '分壇' : st.unit}）` : '🔔 手機提醒';
    el.btn.classList.toggle('is-on', !!st.sub);
  }

  function setMsg(text, kind) {
    st.msg = text;
    st.msgKind = kind || '';
  }

  function render() {
    renderButton();
    if (el.panel.hidden) return;
    let html;
    const msg = st.msg ? `<p class="push-msg${st.msgKind ? ' is-' + st.msgKind : ''}" role="status">${Fmt.esc(st.msg)}</p>` : '';
    if (local()) {
      html = '<p>本機預覽不能開啟手機提醒，請到正式網站試。</p>';
    } else if (isIos() && !standalone()) {
      html = `<p><strong>iPhone、iPad 要先把網站加到主畫面</strong>，再從主畫面打開，才能開啟提醒：</p>
        <ol class="help-steps">
          <li><span class="help-num">1</span><span>用 Safari 打開這個網站，按下面的「分享」按鈕（方框加向上箭頭）。</span></li>
          <li><span class="help-num">2</span><span>選「加入主畫面」，再按「加入」。</span></li>
          <li><span class="help-num">3</span><span>從主畫面的「分壇行事曆」打開，再按「🔔 手機提醒」。</span></li>
        </ol>
        <p class="hint">需要 iOS 16.4 以上。</p>`;
    } else if (!supported()) {
      html = '<p>這個瀏覽器不支援手機提醒，請用 Chrome（Android）或 Safari（iPhone，要先加到主畫面）打開。</p>';
    } else if (Notification.permission === 'denied') {
      html = `<p><strong>通知被封鎖了。</strong>請到手機的設定裡，找到這個網站（或 Chrome、Safari）的「通知」，改成允許，再回來開啟。</p>`;
    } else if (!st.sub) {
      const def = st.unit || CalendarPage.unit();
      html = `<p>開啟後，每天<strong>晚上 8 點提醒明天</strong>、<strong>早上 7 點提醒今天</strong>的活動（沒有活動不送），管理者也可能發重要通知。不用填名字。</p>
        <label class="push-unit"><span>要收哪個單位的提醒</span><select class="input" data-f="unit">${unitOptions(def)}</select></label>
        <p class="hint">選某一區，會提醒那一區＋分壇的活動；選分壇，只提醒分壇的活動。</p>
        ${msg}
        <button type="button" class="btn btn-primary btn-block" data-act="on"${st.busy ? ' disabled' : ''}>開啟提醒</button>`;
    } else {
      html = `<p>已開啟：收 <strong>${Fmt.esc(unitLabel(st.unit))}</strong>的提醒。</p>
        <label class="push-unit"><span>改成收哪個單位</span><select class="input" data-f="unit">${unitOptions(st.unit)}</select></label>
        ${msg}
        <div class="push-actions">
          <button type="button" class="btn" data-act="test"${st.busy ? ' disabled' : ''}>傳測試通知</button>
          <button type="button" class="btn btn-quiet-danger" data-act="off"${st.busy ? ' disabled' : ''}>關閉提醒</button>
        </div>`;
    }
    el.body.innerHTML = html;
  }

  async function run(fn, okText) {
    st.busy = true;
    setMsg('處理中⋯');
    render();
    try {
      await fn();
      setMsg(okText, 'ok');
    } catch (err) {
      setMsg(err.message || '發生錯誤，請稍後再試', 'error');
    }
    st.busy = false;
    render();
  }

  async function turnOn(unit) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? '通知被封鎖了，請到手機設定裡允許通知' : '要按「允許」才能收到提醒');
    const reg = await registration();
    const { publicKey } = await Api.pushKey();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await Api.pushSubscribe(sub.endpoint, unit);
    st.sub = sub;
    st.unit = unit;
    saveUnit(unit);
  }

  async function turnOff() {
    const sub = st.sub;
    if (sub) {
      await Api.pushUnsubscribe(sub.endpoint).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    st.sub = null;
    saveUnit('');
  }

  async function changeUnit(unit) {
    await Api.pushSubscribe(st.sub.endpoint, unit);
    st.unit = unit;
    saveUnit(unit);
  }

  function init() {
    el.btn = document.getElementById('push-open');
    el.panel = document.getElementById('push-panel');
    el.body = el.panel.querySelector('.push-body');
    el.btn.addEventListener('click', () => {
      el.panel.hidden = !el.panel.hidden;
      el.btn.setAttribute('aria-expanded', el.panel.hidden ? 'false' : 'true');
      setMsg('');
      render();
    });
    el.panel.querySelector('[data-act="close"]').addEventListener('click', () => { el.panel.hidden = true; el.btn.setAttribute('aria-expanded', 'false'); });
    el.body.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b || st.busy) return;
      const unitSel = el.body.querySelector('[data-f="unit"]');
      if (b.dataset.act === 'on') run(() => turnOn(unitSel.value), '已開啟！可以按「傳測試通知」試試看');
      if (b.dataset.act === 'test') run(() => Api.pushTest(st.sub.endpoint), '已傳出，幾秒內手機會收到');
      if (b.dataset.act === 'off') run(turnOff, '已關閉提醒');
    });
    el.body.addEventListener('change', (ev) => {
      if (ev.target.dataset.f !== 'unit' || !st.sub) return;
      const u = ev.target.value;
      run(() => changeUnit(u), `已改成收${unitLabel(u)}的提醒`);
    });
    refresh();
  }

  window.PushPage = { init };
})();
