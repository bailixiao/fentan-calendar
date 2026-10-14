// 管理後台（#/admin）：登入（總管理者或各區組長）、活動列表、新增／修改／另存新的／刪除、批次匯入（可整批刪除）、
// 發通知（手機提醒）、帳號（各區組長）、填名單、操作紀錄、下載備份。組長帳號只看得到填名單。權限由伺服器檢查。
(function () {
  'use strict';

  const UNIT_KEY = 'fentan-calendar:admin-unit';
  let view = null;
  let events = null; // 上次讀到的手動活動
  let units = null;
  const filter = { unit: readUnit(), q: '', past: false };

  function readUnit() {
    try { return localStorage.getItem(UNIT_KEY) || '全部'; } catch (e) { return '全部'; }
  }

  function editableUnits() {
    return units || [window.SITE.fentan].concat(window.SITE.units, window.SITE.testRegion);
  }

  function busy(on, text) {
    const box = document.getElementById('busy');
    box.hidden = !on;
    box.querySelector('.busy-text').textContent = text || '處理中⋯';
  }

  function tabs(active) {
    const t = (hash, label, key) => `<a class="admin-tab${active === key ? ' is-active' : ''}" href="${hash}">${label}</a>`;
    return `
      <div class="admin-head">
        <h1 class="admin-title">管理後台</h1>
        <button type="button" class="link-btn" data-act="logout">登出</button>
      </div>
      <nav class="admin-tabs">${t('#/admin', '活動', 'list')}${t('#/admin/new', '＋ 新增活動', 'new')}${t('#/admin/roster', '填名單', 'roster')}${t('#/admin/accounts', '帳號', 'accounts')}${t('#/admin/import', '匯入', 'import')}${t('#/admin/push', '📣 發通知', 'push')}${t('#/admin/log', '操作紀錄', 'log')}</nav>`;
  }

  // ---------- 路由 ----------

  async function show(el, sub) {
    view = el;
    const parts = (sub || '').split('/');
    // 活動頁「✏️ 填寫名單」：#/admin/fill/<區>/<勤務 id>，沒登入就先登入（帳號選好那一區）
    const fill = parts[0] === 'fill' ? { unit: decodeURIComponent(parts[1] || ''), id: decodeURIComponent(parts[2] || '') } : null;
    if (!Api.isAdmin()) return renderLogin('', fill && fill.unit);
    const who = Api.who() || { role: 'super' };
    try {
      // 組長帳號：只有填名單
      if (who.role === 'region') {
        // 併區（例：教慈/理）的兩區是同一行，兩區的組長都可以
        const sameRow = fill && window.SITE.attendRows.some((r) => r[1].indexOf(fill.unit) !== -1 && r[1].indexOf(who.account) !== -1);
        const other = fill && fill.unit !== who.account && !sameRow ? `你登入的是${who.account}，只能填${who.account}的名單。要填${fill.unit}的，請先登出再用${fill.unit}的帳號登入。` : '';
        return renderRoster(who.account, fill && !other ? fill.id : '', other);
      }
      if (fill) return renderRoster(fill.unit, fill.id);
      if (parts[0] === 'accounts') return renderAccounts();
      if (parts[0] === 'roster') return renderRoster(decodeURIComponent(parts[1] || '') || editableUnits().filter((u) => u !== window.SITE.fentan)[0]);
      if (parts[0] === 'new') return renderForm(null, 'new');
      if (parts[0] === 'edit' || parts[0] === 'copy') {
        if (!events) await loadEvents();
        const ev = events.find((e) => e.id === decodeURIComponent(parts[1] || ''));
        if (!ev) return renderMissing();
        return renderForm(ev, parts[0]);
      }
      if (parts[0] === 'log') return renderLog();
      if (parts[0] === 'import') return renderImport();
      if (parts[0] === 'push') return renderPush();
      await renderList();
    } catch (err) {
      handleError(err);
    }
  }

  function handleError(err) {
    if (err.code === 'UNAUTHORIZED') {
      renderLogin(err.message);
      return;
    }
    view.innerHTML = `<div class="notice notice-error"><p>${Fmt.esc(err.message || '發生錯誤')}</p></div><button type="button" class="btn" onclick="location.reload()">重新整理</button>`;
  }

  function bindCommon() {
    const out = view.querySelector('[data-act="logout"]');
    if (out) out.addEventListener('click', () => {
      Api.adminLogout();
      events = null;
      renderLogin();
    });
  }

  // ---------- 登入 ----------

  async function renderLogin(message, preset) {
    let accounts = ['總管理者'];
    try { accounts = (await Api.loginAccounts()).accounts; } catch (e) { /* 讀不到：只列總管理者 */ }
    let last = '';
    try { last = localStorage.getItem('fentan-calendar:last-account') || ''; } catch (e) { /* 忽略 */ }
    view.innerHTML = `
      <form class="admin-login" autocomplete="off">
        <div class="login-head">
          <img class="login-logo" src="icons/icon-192.png" alt="" width="72" height="72">
          <h1 class="login-title">管理後台</h1>
          <p class="login-sub">${Fmt.esc(window.SITE.name)}</p>
        </div>
        ${message ? `<p class="form-error">${Fmt.esc(message)}</p>` : ''}
        <label class="login-field">
          <span>帳號</span>
          <select class="input login-input" name="account">${accounts.map((a) => `<option${a === (preset && accounts.indexOf(preset) !== -1 ? preset : last) ? ' selected' : ''}>${Fmt.esc(a)}</option>`).join('')}</select>
        </label>
        <label class="login-field">
          <span>密碼</span>
          <span class="login-pw">
            <input class="input login-input" type="password" name="password" required autocomplete="current-password">
            <button type="button" class="login-eye" aria-label="顯示密碼">顯示</button>
          </span>
        </label>
        <p class="form-error" hidden></p>
        <button type="submit" class="btn btn-primary btn-block login-submit">登入</button>
        <p class="login-foot">各區組長選自己的區登入填名單；家人們看行事曆不用登入</p>
      </form>`;
    const form = view.querySelector('form');
    const input = form.password;
    const errBox = form.querySelector('.form-error[hidden]');
    form.querySelector('.login-eye').addEventListener('click', (ev) => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      ev.currentTarget.textContent = show ? '隱藏' : '顯示';
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errBox.hidden = true;
      busy(true, '登入中⋯');
      try {
        await Api.adminLogin(input.value, form.account.value === '總管理者' ? '' : form.account.value);
        try { localStorage.setItem('fentan-calendar:last-account', form.account.value); } catch (x) { /* 忽略 */ }
        busy(false);
        show(view, location.hash.replace(/^#\/admin\/?/, ''));
      } catch (err) {
        busy(false);
        errBox.textContent = err.message;
        errBox.hidden = false;
        input.select();
      }
    });
    input.focus();
  }

  // ---------- 各區組長：帳號、填名單（規格第 9-4 節） ----------

  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  /** 總管理者：每區一個組長帳號，設定或刪除密碼 */
  async function renderAccounts() {
    view.innerHTML = tabs('accounts') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const data = await Api.admin('adminAccounts');
    view.innerHTML = tabs('accounts') + `
      <h2 class="admin-sub">各區組長帳號</h2>
      <p class="hint">每區一個帳號。設好密碼（至少 6 個字）交給那一區的組長，組長登入後只能填「分壇派給這一區的勤務」的名單，不能改活動。改密碼後，已經登入的會被登出。</p>
      <ul class="admin-list">${data.accounts.map((a) => `
        <li class="admin-row">
          <div class="admin-row-main"><strong>${Fmt.esc(a.unit)}</strong><span class="card-meta">${a.hasPassword ? '已設密碼' : '還沒有帳號'}</span></div>
          <div class="admin-row-actions">
            <a class="btn btn-small" href="#/admin/roster/${encodeURIComponent(a.unit)}">看名單</a>
            <button type="button" class="btn btn-small" data-edit="${Fmt.esc(a.unit)}">${a.hasPassword ? '改密碼' : '設密碼'}</button>
            ${a.hasPassword ? `<button type="button" class="btn btn-small btn-quiet-danger" data-remove="${Fmt.esc(a.unit)}">刪除帳號</button>` : ''}
          </div>
          <form class="region-form" data-form="${Fmt.esc(a.unit)}" hidden>
            <label class="form-row"><span>${Fmt.esc(a.unit)}組長的密碼（至少 6 個字）</span><input class="input" type="password" name="password" autocomplete="new-password" minlength="6"></label>
            <p class="form-error" hidden></p>
            <button type="submit" class="btn btn-primary">儲存</button>
          </form>
        </li>`).join('')}</ul>`;
    bindCommon();
    view.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const f = view.querySelector(`[data-form="${b.dataset.edit}"]`);
      f.hidden = !f.hidden;
      if (!f.hidden) f.password.focus();
    }));
    view.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm(`確定要刪除${b.dataset.remove}的組長帳號？刪除後組長不能再登入填名單（已經填的名單會保留）。`)) return;
      busy(true, '刪除中⋯');
      try { await Api.admin('adminSetAccount', { unit: b.dataset.remove, remove: true }); busy(false); renderAccounts(); } catch (err) { busy(false); handleError(err); }
    }));
    view.querySelectorAll('.region-form').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = f.querySelector('.form-error');
      busy(true, '儲存中⋯');
      try {
        await Api.admin('adminSetAccount', { unit: f.dataset.form, password: f.password.value });
        busy(false);
        renderAccounts();
      } catch (x) {
        busy(false);
        if (x.code === 'UNAUTHORIZED') return renderLogin(x.message);
        err.textContent = x.message;
        err.hidden = false;
      }
    }));
  }

  /** 填名單：組長看自己區的；總管理者可以選任何一區 */
  async function renderRoster(unit, focusId, notice) {
    const who = Api.who() || { role: 'super' };
    const isRegion = who.role === 'region';
    const head = isRegion
      ? `<div class="admin-head"><h1 class="admin-title">${Fmt.esc(unit)}・填名單</h1><button type="button" class="link-btn" data-act="logout">登出</button></div>`
      : tabs('roster');
    view.innerHTML = head + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    let data;
    try { data = await Api.admin('adminRosterList', isRegion ? {} : { unit }); } catch (err) { return handleError(err); }
    const regions = editableUnits().filter((u) => u !== window.SITE.fentan);
    const fields = (ev) => (ev.positions && ev.positions.length ? ev.positions : [{ id: '_', name: '名單', min: null, max: null }]);
    const need = (p) => [p.min ? `需要 ${p.min} 人` : '', p.max ? `最多 ${p.max} 人` : ''].filter(Boolean).join('、');
    // 各區報名出席的班：這一區（併區的話兩區同一行）填出席、陪班、備註
    const attendHtml = (a) => {
      const lock = a.closed && isRegion ? ' readonly' : '';
      const ta = (key, label, list) => `<label class="form-row"><span><strong>${label}</strong>：<b data-count="${key}">${list.length}</b> 人</span>
        <textarea class="input textarea" name="${key}" rows="2"${lock} placeholder="名字之間空一格或用、隔開">${Fmt.esc(list.join('、'))}</textarea></label>
        <div class="name-preview" data-preview="${key}" aria-live="polite"></div>`;
      return `
      <article class="roster-card attend-card${a.id === focusId ? ' is-focus' : ''}" id="roster-${Fmt.esc(a.id)}">
        <h3>${Fmt.esc(a.name)}<span class="attend-tag">出席名單・${Fmt.esc(a.row)}</span></h3>
        <p class="card-meta">${Fmt.esc([a.start === a.end ? Fmt.shortDate(a.start) : `${Fmt.shortDate(a.start)} – ${Fmt.shortDate(a.end)}`, Fmt.timeRange(a), a.location].filter(Boolean).join('・'))}</p>
        ${a.deadline ? `<p class="deadline${a.closed ? ' is-closed' : ''}">${a.closed ? `已經過了截止日期（${md(a.deadline)}）${isRegion ? '，要改名單請找分壇' : '，組長不能再改，總管理者還可以改'}` : `名單 ${Fmt.esc(Fmt.shortDate(a.deadline))} 截止`}</p>` : ''}
        <form class="attend-fill" data-id="${Fmt.esc(a.id)}" data-row="${Fmt.esc(a.row)}">
          ${ta('names', '出席', a.data.names || [])}
          ${ta('escort', '陪班', a.data.escort || [])}
          ${ta('traffic', '交通', a.data.traffic || [])}
          <div class="roster-fill-actions"><button type="submit" class="btn btn-primary btn-small"${lock ? ' disabled' : ''}>儲存</button><span class="muted" data-msg></span></div>
        </form>
      </article>`;
    };
    const evHtml = (ev) => `
      <article class="roster-card${ev.id === focusId ? ' is-focus' : ''}" id="roster-${Fmt.esc(ev.id)}">
        <h3>${Fmt.esc(ev.name)}</h3>
        ${ev.group ? `<p class="card-meta">${Fmt.esc(ev.group)}</p>` : ''}
        <p class="card-meta">${Fmt.esc([ev.start === ev.end ? Fmt.shortDate(ev.start) : `${Fmt.shortDate(ev.start)} – ${Fmt.shortDate(ev.end)}`, Fmt.timeRange(ev), ev.location].filter(Boolean).join('・'))}</p>
        ${ev.dress ? `<p class="card-meta">服裝：${Fmt.esc(ev.dress)}</p>` : ''}
        ${ev.deadline ? `<p class="deadline${ev.closed ? ' is-closed' : ''}">${ev.closed ? `已經過了截止日期（${md(ev.deadline)}）${isRegion ? '，要改名單請找分壇' : '，組長不能再改，總管理者還可以改'}` : `名單 ${Fmt.esc(Fmt.shortDate(ev.deadline))} 截止`}</p>` : ''}
        ${ev.note ? `<p class="hint">${Fmt.esc(ev.note)}</p>` : ''}
        ${Fmt.datesBetween(ev.start, ev.end).map((d) => `
          <div class="roster-date">
            ${ev.start !== ev.end ? `<p class="roster-day"><strong>${Fmt.esc(Fmt.shortDate(d))}</strong></p>` : ''}
            ${fields(ev).map((p) => {
              const names = ((ev.roster || {})[d] || {})[p.id] || [];
              return `<form class="roster-fill" data-id="${Fmt.esc(ev.id)}" data-date="${d}" data-key="${Fmt.esc(p.id)}" data-max="${p.max || ''}">
                <label class="form-row"><span><strong>${Fmt.esc(p.name)}</strong>${need(p) ? `（${Fmt.esc(need(p))}）` : ''}：已填 <b data-count>${names.length}</b> 人</span>
                  <textarea class="input textarea" name="names" rows="2"${ev.closed && isRegion ? ' readonly' : ''} placeholder="名字之間空一格或用、隔開，例：王小明、測試甲">${Fmt.esc(names.join('、'))}</textarea></label>
                <div class="name-preview" data-preview aria-live="polite"></div>
                <div class="roster-fill-actions"><button type="submit" class="btn btn-primary btn-small"${ev.closed && isRegion ? ' disabled' : ''}>儲存</button><span class="muted" data-msg></span></div>
              </form>`;
            }).join('')}
          </div>`).join('')}
      </article>`;
    view.innerHTML = head + (notice ? `<div class="notice notice-error"><p>${Fmt.esc(notice)}</p></div>` : '') + `
      ${isRegion ? '' : `<label class="form-row"><span>看哪一區</span><select class="input" data-f="unit">${regions.map((u) => `<option${u === unit ? ' selected' : ''}>${Fmt.esc(u)}</option>`).join('')}</select></label>`}
      <p class="hint">這裡是分壇派給${Fmt.esc(unit)}的勤務（7 天前到之後 4 個月）。每一欄填會去的人的名字，按「儲存」，大家打開分壇行事曆的活動就看得到。</p>
      ${(data.attend || []).map(attendHtml).join('')}
      ${data.events.length ? data.events.map(evHtml).join('') : (data.attend || []).length ? '' : '<p class="panel-empty">目前沒有分壇派給這一區的勤務</p>'}`;
    bindCommon();
    // 從活動頁來的：捲到那一筆勤務，游標放在第一欄
    const focusCard = focusId && view.querySelector('.roster-card.is-focus');
    if (focusCard) {
      focusCard.scrollIntoView({ block: 'start' });
      const ta = focusCard.querySelector('textarea');
      if (ta) ta.focus({ preventScroll: true });
    }
    const sel = view.querySelector('[data-f="unit"]');
    if (sel) sel.addEventListener('change', () => { location.hash = '#/admin/roster/' + encodeURIComponent(sel.value); });
    // 邊打邊預覽：拆好的名字一個一個顯示（和存檔後一樣），太長、超過人數當場提醒
    const preview = (f) => { f.querySelector('[data-preview]').innerHTML = previewHtml(f.names.value, Number(f.dataset.max) || 0); };
    // 名字預覽（填名單、出席名單都用）：拆好的名字一個一個顯示，太長紅色、超過 4 個字黃色
    function previewHtml(text, max) {
      const names = Fmt.splitNames(text);
      const long = names.filter((n) => n.length > 20);
      const odd = names.filter((n) => n.length > 4 && n.length <= 20);
      return names.length ? `
        <span class="name-count">會存成 ${names.length} 人：</span>${names.map((n) => `<span class="name-chip${n.length > 20 ? ' is-bad' : n.length > 4 ? ' is-odd' : ''}">${Fmt.esc(n)}</span>`).join('')}
        ${long.length ? '<p class="form-error">標紅色的太長了（最多 20 字），是不是兩個名字中間忘了空格或「、」？</p>' : ''}
        ${odd.length ? `<p class="name-warn">${odd.map((n) => `「${Fmt.esc(n)}」`).join('')}超過 4 個字，確定是一個人的名字嗎？如果是兩個人，中間加空格或「、」。</p>` : ''}
        ${max && names.length > max ? `<p class="form-error">超過最多 ${max} 人</p>` : ''}` : '';
    }
    view.querySelectorAll('.roster-fill').forEach((f) => {
      preview(f);
      f.names.addEventListener('input', () => { preview(f); f.querySelector('[data-msg]').textContent = '還沒儲存'; });
    });
    view.querySelectorAll('.attend-fill').forEach((f) => {
      let count = () => ['names', 'escort', 'traffic'].forEach((k) => {
        f.querySelector(`[data-count="${k}"]`).textContent = Fmt.splitNames(f[k].value).length;
        f.querySelector(`[data-preview="${k}"]`).innerHTML = previewHtml(f[k].value, 0);
      });
      // 同一個人寫在出席、陪班兩邊
      const both = () => {
        const seen = Fmt.splitNames(f.names.value);
        ['escort', 'traffic'].forEach((k) => {
          const list = Fmt.splitNames(f[k].value);
          const dup = list.filter((n) => seen.indexOf(n) !== -1);
          if (dup.length) f.querySelector(`[data-preview="${k}"]`).insertAdjacentHTML('beforeend', `<p class="name-warn">${dup.map((n) => `「${Fmt.esc(n)}」`).join('')}上面已經寫過了，會算兩次，請只留一個地方。</p>`);
          list.forEach((n) => seen.push(n));
        });
      };
      const count0 = count;
      count = () => { count0(); both(); };
      count();
      f.addEventListener('input', () => { count(); f.querySelector('[data-msg]').textContent = '還沒儲存'; });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = f.querySelector('[data-msg]');
        const odd = Fmt.splitNames(f.names.value + '、' + f.escort.value + '、' + f.traffic.value).filter((n) => n.length > 4 && n.length <= 20);
        if (odd.length && !window.confirm(`${odd.map((n) => `「${n}」`).join('')}超過 4 個字，確定是一個人的名字嗎？

按「確定」照這樣儲存；按「取消」回去把名字拆開（中間加空格或「、」）。`)) {
          f.names.focus();
          return;
        }
        msg.textContent = '儲存中⋯';
        try {
          const res = await Api.admin('adminAttendSave', { id: f.dataset.id, row: f.dataset.row, names: f.names.value, escort: f.escort.value, traffic: f.traffic.value });
          const d = Object.assign({ names: [], escort: [], traffic: [] }, (res.event.attend || {})[f.dataset.row] || {});
          f.names.value = d.names.join('、');
          f.escort.value = d.escort.join('、');
          f.traffic.value = d.traffic.join('、');
          count();
          msg.textContent = '已儲存';
          CalendarPage.refresh(true);
        } catch (x) {
          if (x.code === 'UNAUTHORIZED' && /登入/.test(x.message)) return renderLogin(x.message);
          msg.textContent = x.message;
        }
      });
    });
    view.querySelectorAll('.roster-fill').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = f.querySelector('[data-msg]');
      const odd = Fmt.splitNames(f.names.value).filter((n) => n.length > 4 && n.length <= 20);
      if (odd.length && !window.confirm(`${odd.map((n) => `「${n}」`).join('')}超過 4 個字，確定是一個人的名字嗎？\n\n按「確定」照這樣儲存；按「取消」回去把名字拆開（中間加空格或「、」）。`)) {
        f.names.focus();
        return;
      }
      msg.textContent = '儲存中⋯';
      try {
        const res = await Api.admin('adminRosterSave', { id: f.dataset.id, date: f.dataset.date, key: f.dataset.key, names: f.names.value });
        const names = ((res.event.roster || {})[f.dataset.date] || {})[f.dataset.key] || [];
        f.names.value = names.join('、');
        f.querySelector('[data-count]').textContent = names.length;
        preview(f);
        msg.textContent = `已儲存（${md(f.dataset.date)}）`;
        CalendarPage.refresh(true);
      } catch (x) {
        if (x.code === 'UNAUTHORIZED' && /登入/.test(x.message)) return renderLogin(x.message);
        msg.textContent = x.message;
      }
    }));
  }

  // ---------- 活動列表 ----------

  async function loadEvents() {
    const data = await Api.admin('adminList');
    events = data.events;
    units = data.units;
  }

  async function renderList() {
    view.innerHTML = tabs('list') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    await loadEvents();
    drawList();
  }

  function drawList() {
    const today = CalendarPage.today();
    const unitOpts = ['全部'].concat(editableUnits());
    if (unitOpts.indexOf(filter.unit) === -1) filter.unit = '全部';
    view.innerHTML = tabs('list') + `
      <div class="admin-actions">
        <a class="btn btn-primary" href="#/admin/new">＋ 新增活動</a>
        <button type="button" class="btn" data-act="backup">⬇ 下載備份</button>
      </div>
      <div class="list-filter">
        <select class="input" data-f="unit" aria-label="單位">${unitOpts.map((u) => `<option${u === filter.unit ? ' selected' : ''}>${Fmt.esc(u)}</option>`).join('')}</select>
        <input class="input" type="search" data-f="q" placeholder="搜尋活動名稱、地點" value="${Fmt.esc(filter.q)}">
      </div>
      <div class="seg" role="group" aria-label="時間">
        <button type="button" data-past="0" class="${filter.past ? '' : 'is-active'}">今天起</button>
        <button type="button" data-past="1" class="${filter.past ? 'is-active' : ''}">已過去的</button>
      </div>
      <p class="hint">${Fmt.esc(window.SITE.jiaoquan.unit)}的活動會自動從教全區的系統讀進來，這裡看不到也不用輸入。</p>
      <div id="admin-list"></div>`;
    bindCommon();
    const listBox = view.querySelector('#admin-list');
    const draw = () => {
      const q = filter.q.trim();
      const list = events.filter((e) =>
        (filter.unit === '全部' || e.unit === filter.unit) &&
        (filter.past ? e.end < today : e.end >= today) &&
        (!q || (e.name + ' ' + (e.location || '')).indexOf(q) !== -1));
      if (filter.past) list.reverse();
      listBox.innerHTML = list.length
        ? `<p class="muted">共 ${list.length} 筆</p><ul class="admin-list">${list.map(rowHtml).join('')}</ul>`
        : `<p class="panel-empty">${filter.past ? '沒有已過去的活動' : '今天起沒有活動'}${q || filter.unit !== '全部' ? '（符合篩選的）' : ''}</p>`;
    };
    draw();
    view.querySelector('[data-f="unit"]').addEventListener('change', (ev) => {
      filter.unit = ev.target.value;
      try { localStorage.setItem(UNIT_KEY, filter.unit); } catch (e) { /* 忽略 */ }
      draw();
    });
    view.querySelector('[data-f="q"]').addEventListener('input', (ev) => { filter.q = ev.target.value; draw(); });
    view.querySelectorAll('[data-past]').forEach((b) => b.addEventListener('click', () => {
      filter.past = b.dataset.past === '1';
      view.querySelectorAll('[data-past]').forEach((x) => x.classList.toggle('is-active', x === b));
      draw();
    }));
    view.querySelector('[data-act="backup"]').addEventListener('click', backup);
    listBox.addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-del]');
      if (del) remove(del.dataset.del);
    });
  }

  function rowHtml(e) {
    const when = e.start === e.end ? Fmt.shortDate(e.start) : `${Fmt.shortDate(e.start)} – ${Fmt.shortDate(e.end)}`;
    const meta = [Fmt.timeRange(e), e.location].filter(Boolean).join('・');
    const id = encodeURIComponent(e.id);
    return `
      <li class="admin-row">
        <div class="admin-row-main">
          <span class="admin-row-date">${Fmt.esc(when)}</span>
          ${Fmt.tagsHtml(e)}${e.unit !== window.SITE.fentan ? `<span class="card-meta">${e.kind === '區活動' ? '區自己的活動（不帶到各區報名系統）' : '分壇分配' + (e.positions && e.positions.length ? '：' + e.positions.map((p) => Fmt.esc(p.name) + (p.max !== null ? ' 最多 ' + p.max : '')).join('、') : '')}</span>` : ''}
          <strong>${Fmt.esc(e.name)}</strong>
          ${meta && e.start === e.end ? `<span class="card-meta">${Fmt.esc(meta)}</span>` : e.location ? `<span class="card-meta">${Fmt.esc(e.location)}</span>` : ''}
        </div>
        <div class="admin-row-actions">
          <a class="btn btn-small" href="#/admin/edit/${id}">修改</a>
          <a class="btn btn-small" href="#/admin/copy/${id}">另存新的</a>
          <button type="button" class="btn btn-small btn-quiet-danger" data-del="${Fmt.esc(e.id)}">刪除</button>
        </div>
      </li>`;
  }

  async function remove(id) {
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    const kids = events.filter((e) => e.parentId === id);
    if (!window.confirm(`確定要刪除「${ev.name}」（${Fmt.shortDate(ev.start)}）嗎？${kids.length ? `\n在這個活動裡排的 ${kids.length} 筆分工（各區勤務和名單）也會一起刪除。` : ''}\n刪除後不能還原。`)) return;
    busy(true, '刪除中⋯');
    try {
      await Api.admin('adminDelete', { id });
      events = events.filter((e) => e.id !== id && e.parentId !== id);
      busy(false);
      CalendarPage.refresh(true);
      drawList();
    } catch (err) {
      busy(false);
      if (err.code === 'UNAUTHORIZED') return renderLogin(err.message);
      window.alert(err.message);
    }
  }

  async function backup() {
    busy(true, '準備備份⋯');
    try {
      const data = await Api.admin('adminBackup');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fentan-calendar-backup-${CalendarPage.today().replace(/-/g, '')}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      busy(false);
    } catch (err) {
      busy(false);
      if (err.code === 'UNAUTHORIZED') return renderLogin(err.message);
      window.alert(err.message);
    }
  }

  // ---------- 新增／修改／另存新的 ----------

  /** 時間只給整點、半點（05:00～23:30）；原本存的時間不是整點半點的，也列出來 */
  function timeOptions(value) {
    const list = [];
    for (let h = 5; h <= 23; h++) ['00', '30'].forEach((m) => list.push(String(h).padStart(2, '0') + ':' + m));
    if (value && list.indexOf(value) === -1) { list.push(value); list.sort(); }
    return '<option value="">不填</option>' + list.map((t) => `<option${t === value ? ' selected' : ''}>${t}</option>`).join('');
  }

  const newDutyId = () => 'D-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // 以前用名稱掛在分壇活動下的各區勤務（規則同 worker/src/logic.js 的 coreName、parentKey）
  const coreName = (n) => String(n || '').replace(/（[^）]*）|\([^)]*\)/g, '').replace(/第\s*\d+\s*次\s*$/, '').replace(/[\s:：・、,，]/g, '');
  function legacyChildren(parent) {
    const key = coreName(String(parent.name || '').split(/[：:]/)[0]);
    if (key.length < 2) return [];
    return events.filter((e) => e.unit !== window.SITE.fentan && e.kind !== '區活動' && !e.parentId && e.start <= parent.end && e.end >= parent.start && coreName(e.name).indexOf(key) !== -1);
  }

  /** 前端先檢查一次（伺服器也會檢查），回傳錯誤清單 */
  function check(ev) {
    const errs = [];
    if (!ev.name) errs.push('請填活動名稱');
    if (!ev.start) errs.push('請選開始日期');
    if (ev.end && ev.start && ev.end < ev.start) errs.push('結束日期不能早於開始日期');
    if (ev.endTime && !ev.startTime) errs.push('有結束時間就要填開始時間');
    if (ev.link && !/^https:\/\/\S+$/.test(ev.link)) errs.push('相關連結要以 https:// 開頭');
    if (ev.deadline && ev.deadline > (ev.end || ev.start)) errs.push('截止日期不能晚於活動的最後一天');
    return errs;
  }

  // 新增／另存新的：單位可以選「分壇」或勾好幾區（每區各一筆）；修改：一次一筆（規格第 9-2 節）
  function renderForm(src, mode) {
    const ev = src ? JSON.parse(JSON.stringify(src)) : { unit: filter.unit !== '全部' ? filter.unit : window.SITE.fentan, category: '勤務', start: CalendarPage.today() };
    if (mode === 'copy') ev.positions = (ev.positions || []).map((p) => ({ name: p.name, min: p.min, max: p.max }));
    const multi = mode !== 'edit';
    const fentan = window.SITE.fentan;
    // 派給區的勾選不列測試區（已經是測試區的那筆，修改時仍可用單位選單）
    const regions = editableUnits().filter((u) => u !== fentan && u !== window.SITE.testRegion);
    const title = mode === 'edit' ? '修改活動' : mode === 'copy' ? '另存成新的活動' : '新增活動';
    const opt = (list, value, label) => list.map((v) => `<option value="${Fmt.esc(v)}"${v === value ? ' selected' : ''}>${Fmt.esc(label ? label(v) : v)}</option>`).join('');
    const isRegion = ev.unit && ev.unit !== fentan;
    const posRow = (p) => `
      <div class="pos-row">
        <input type="hidden" name="pid" value="${Fmt.esc(p.id || '')}">
        <label><span>了愿項目</span><input class="input" name="pname" maxlength="20" value="${Fmt.esc(p.name || '')}" placeholder="例：烹飪"></label>
        <label><span>最少</span><input class="input" name="pmin" inputmode="numeric" value="${p.min === null || p.min === undefined ? '' : p.min}" placeholder="空白"></label>
        <label><span>最多</span><input class="input" name="pmax" inputmode="numeric" value="${p.max === null || p.max === undefined ? '' : p.max}" placeholder="不限"></label>
        <button type="button" class="btn btn-small btn-quiet-danger" data-rm aria-label="拿掉這個項目">✕</button>
      </div>`;
    // ---------- 分工（分壇活動用；規格第 9-5 節）：跟出席名單表一樣，固定幾行，按「安排」選 ----------
    const teams = window.SITE.teams || [];
    const isFentanEv = !ev.unit || ev.unit === fentan;
    const findGroup = (pick) => { const [, tn, gk] = pick.split(':'); const t = teams.find((x) => x.name === tn); const g = t && t.groups.find((x) => x[0] === gk); return t && g ? { t, g } : null; };
    // 原本的分工（duties），加上以前用名稱掛上的各區勤務（照工作名稱合成一行）
    const myChildren = src && mode !== 'new' && events ? events.filter((e) => e.parentId === src.id) : [];
    const legacy = src && mode !== 'new' && events && isFentanEv ? legacyChildren(src) : [];
    const dutySaved = isFentanEv ? (ev.duties || []).map((d) => ({ id: d.id, work: d.work, min: d.min, posId: d.posId, text: d.text || '', picks: Fmt.normPicks(d.picks),
      ids: Object.fromEntries(myChildren.filter((c) => c.dutyId === d.id).map((c) => [c.unit, c.id])), oldGroup: {} })) : [];
    const byWork = {};
    legacy.forEach((c) => {
      const work = (c.name.split(/[：:]/)[0] || c.name).slice(0, 20);
      const row = byWork[work] || (byWork[work] = { id: newDutyId(), work, min: ((c.positions || [])[0] || {}).min || null, posId: '', text: '', picks: [], ids: {}, oldGroup: {} });
      if (row.picks.indexOf('u:' + c.unit) === -1) row.picks.push('u:' + c.unit);
      row.ids[c.unit] = c.id;
      row.oldGroup[c.unit] = c.group || '';
    });
    const dutyAll = dutySaved.concat(Object.values(byWork));
    // 固定的幾行：有排過就用排過的，沒有就空白；其他工作接在後面
    let dutyRows = (window.SITE.works || []).map((w) => {
      const i = dutyAll.findIndex((r) => r.work === w);
      return i === -1 ? { id: newDutyId(), work: w, min: null, posId: '', text: '', picks: [], ids: {}, oldGroup: {}, fixed: true } : Object.assign(dutyAll.splice(i, 1)[0], { fixed: true });
    }).concat(dutyAll);
    if (mode === 'copy') dutyRows.forEach((r) => { r.ids = {}; r.posId = ''; });
    const pickChip = (r, val, label, sub) => `<label class="check-chip"><input type="checkbox" data-pick="${Fmt.esc(val)}"${r.picks.indexOf(val) !== -1 ? ' checked' : ''}> <span class="team-no">${Fmt.esc(label)}</span>${sub ? `<small>（${Fmt.esc(sub)}）</small>` : ''}</label>`;
    const dutyRow = (r) => `
      <div class="duty-row" data-id="${Fmt.esc(r.id)}" data-pos="${Fmt.esc(r.posId || '')}"${r.fixed ? ' data-fixed="1"' : ''}>
        <div class="duty-line">
          ${r.fixed ? `<span class="duty-name">${Fmt.esc(r.work)}</span><input type="hidden" data-f="work" value="${Fmt.esc(r.work)}">`
            : `<input class="input duty-name-input" data-f="work" maxlength="20" value="${Fmt.esc(r.work || '')}" placeholder="工作名稱" aria-label="工作名稱">`}
          <div class="duty-sum"></div>
          <button type="button" class="btn btn-small" data-act="open-duty" aria-expanded="false">安排</button>
        </div>
        <div class="duty-edit" hidden>
          <p class="team-title">區<span class="muted">（按下面的組會自動選好那幾區，也可以自己加選、取消）</span></p>
          <div class="push-units">${regions.map((u) => pickChip(r, 'u:' + u, u)).join('')}</div>
          ${teams.map((t) => `<p class="team-title">${Fmt.esc(t.name)}</p>
          <div class="push-units team-units">${t.groups.map((g) => pickChip(r, 't:' + t.name + ':' + g[0], t.pre + g[0] + t.post.replace(/（併區）$/, ''), g[1].join('、') + (g[2] ? '・' + g[2] : ''))).join('')}</div>`).join('')}
          <div class="form-row-pair duty-more">
            <label><span>每區需要幾人（可以不填）</span><input class="input" data-f="min" inputmode="numeric" value="${r.min === null || r.min === undefined ? '' : r.min}"></label>
            <label><span>備註（可以不填，例：本次無上課）</span><input class="input" data-f="text" maxlength="40" value="${Fmt.esc(r.text || '')}"></label>
          </div>
          <div class="duty-edit-actions">
            <button type="button" class="btn btn-small btn-primary" data-act="close-duty">好了</button>
            <button type="button" class="btn btn-small btn-quiet-danger" data-act="${r.fixed ? 'clear-duty' : 'rm-duty'}">${r.fixed ? '清空這行' : '✕ 拿掉這行'}</button>
          </div>
        </div>
      </div>`;
    const dutyBlock = `
        <fieldset class="form-block duty-block">
          <legend>分工</legend>
          <p class="hint">跟出席名單表下面那幾行一樣。按「安排」選派給哪幾區、哪幾組；存檔後每一區自動建一筆勤務（「工作：活動名稱」），掛在這個活動下面，各區組長填名單。沒排的行不會建。改了這個活動的日期、地點，各區的勤務會跟著改。</p>
          <div class="duty-list">${dutyRows.map(dutyRow).join('')}</div>
          <button type="button" class="btn" data-act="add-duty">＋ 加一行分工</button>
        </fieldset>`;
    const unitBlock = multi ? `
      <label class="radio-row"><input type="radio" name="scope" value="fentan"${isRegion ? '' : ' checked'}> 分壇自己的活動</label>
      <label class="radio-row"><input type="radio" name="scope" value="regions"${isRegion ? ' checked' : ''}> 派給區（可以選好幾區，每區各一筆）</label>
      <div class="unit-checks"${isRegion ? '' : ' hidden'}>
        <div class="check-all"><button type="button" class="btn btn-small" data-act="check-all">全選（${window.SITE.units.length} 區）</button><button type="button" class="btn btn-small" data-act="check-none">全不選</button></div>
        <div class="push-units">${regions.map((u) => `<label class="check-chip"><input type="checkbox" name="units" value="${Fmt.esc(u)}"${u === ev.unit ? ' checked' : ''}> ${Fmt.esc(u)}</label>`).join('')}</div>
        ${(window.SITE.teams || []).map((t, ti) => `
          <p class="team-title">${Fmt.esc(t.name)}<span class="muted">（按一組，會自動選好那幾區）</span></p>
          <div class="push-units team-units">${t.groups.map((g, gi) => `<label class="check-chip"><input type="checkbox" name="team" data-t="${ti}" data-g="${gi}"> <span class="team-no">${Fmt.esc(t.pre + g[0] + t.post)}</span><small>（${Fmt.esc(g[1].join('、') + (g[2] ? '・' + g[2] : ''))}）</small></label>`).join('')}</div>`).join('')}
      </div>`
      : `<label class="form-row"><span>單位</span><select class="input" name="unit">${opt(editableUnits(), ev.unit)}</select></label>
        <label class="form-row group-row"><span>組別（可以不填，例：志工團第 3 組）</span><input class="input" name="group" maxlength="60" value="${Fmt.esc(ev.group || '')}"></label>`;
    view.innerHTML = tabs(mode === 'new' ? 'new' : '') + `
      <form class="admin-form" novalidate>
        <h2 class="admin-sub">${title}</h2>
        ${mode === 'copy' ? '<p class="hint">從「' + Fmt.esc(src.name) + '」複製過來，改好日期再存，原本那筆不會變。</p>' : ''}
        <fieldset class="form-block">
          <legend>哪一個單位、哪一類</legend>
          ${unitBlock}
          ${ev.kind === '區活動' ? '<p class="hint kind-note">這筆是「區自己的活動」（例如範例資料），只記在後台，行事曆上不顯示。</p>' : '<p class="hint kind-note">派給區的是「分壇分配的勤務」，由各區組長在分壇行事曆填名單。</p>'}
          <label class="form-row"><span>類別</span><select class="input" name="category">${opt(window.SITE.categories, ev.category, Fmt.catLabel)}</select></label>
        </fieldset>
        <fieldset class="form-block">
          <legend>活動</legend>
          <label class="form-row"><span>活動名稱</span><input class="input" name="name" maxlength="60" required value="${Fmt.esc(ev.name || '')}" placeholder="例：分壇法會"></label>
          <div class="form-row-pair">
            <label><span>開始日期</span><input class="input" type="date" name="start" required value="${Fmt.esc(ev.start || '')}"></label>
            <label><span>結束日期（一天的留空）</span><input class="input" type="date" name="end" value="${ev.end && ev.end !== ev.start ? Fmt.esc(ev.end) : ''}"></label>
          </div>
          <div class="form-row-pair">
            <label><span>開始時間（可以不填）</span><select class="input" name="startTime">${timeOptions(ev.startTime)}</select></label>
            <label><span>結束時間（可以不填）</span><select class="input" name="endTime">${timeOptions(ev.endTime)}</select></label>
          </div>
          <label class="form-row"><span>地點</span><input class="input" name="location" maxlength="60" value="${Fmt.esc(ev.location || '')}"></label>
          <div class="form-row-pair">
            <label><span>截止日期（可以不填）</span><input class="input" type="date" name="deadline" value="${Fmt.esc(ev.deadline || '')}"></label>
            <label><span>服裝（可以不填）</span><input class="input" name="dress" maxlength="60" value="${Fmt.esc(ev.dress || '')}" placeholder="例：白上衣、深色長褲"></label>
          </div>
          <label class="check-row signup-row"><input type="checkbox" name="signup"${ev.signup ? ' checked' : ''}> <span>各區報名出席<small class="muted">（各區組長填出席、陪班，活動頁出「出席名單表」）</small></span></label>
          <p class="hint">截止日期是各區組長填名單的最後一天，過了那天組長就不能改（總管理者還可以改）。分壇活動填了，掛在下面的各區勤務沒填的也照這一天。</p>
          <label class="form-row"><span>說明（可以不填）</span><textarea class="input textarea" name="note" rows="4" maxlength="1000">${Fmt.esc(ev.note || '')}</textarea></label>
          <label class="form-row"><span>相關連結（可以不填，要 https:// 開頭）</span><input class="input" type="url" name="link" maxlength="500" value="${Fmt.esc(ev.link || '')}" placeholder="https://"></label>
        </fieldset>
        <fieldset class="form-block pos-block">
          <legend>了愿項目與名額（各區報名用，可以不填）</legend>
          <p class="hint">不填：各區報名時是一個「參加」、不限人數。「最少」留空：勤務預設 2 人。「最多」留空＝不限，到了就額滿。</p>
          <div class="pos-list">${(ev.positions || []).map(posRow).join('')}</div>
          <button type="button" class="btn" data-act="add-pos">＋ 加一個了愿項目</button>
        </fieldset>
        ${dutyBlock}
        <p class="form-error" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">${mode === 'edit' ? '儲存修改' : '新增'}</button>
        <a class="btn btn-block back-btn" href="#/admin">取消</a>
      </form>`;
    bindCommon();
    const form = view.querySelector('form');
    const errBox = form.querySelector('.form-error');
    const sync = () => {
      const region = multi ? form.querySelector('[name="scope"]:checked').value === 'regions' : form.unit.value !== fentan;
      if (multi) form.querySelector('.unit-checks').hidden = !region;
      else form.querySelector('.group-row').hidden = !region;
      form.querySelector('.kind-note').hidden = !region;
      form.querySelector('.pos-block').hidden = !region || ev.kind === '區活動';
      form.querySelector('.duty-block').hidden = region;
      form.querySelector('.signup-row').hidden = region;
    };
    // 一行分工：派給的區（u:）、按了的組（t:，寫組別用）
    const rowData = (el) => {
      const picks = [...el.querySelectorAll('[data-pick]:checked')].map((c) => c.dataset.pick);
      const order = editableUnits();
      const units = picks.filter((p) => p.indexOf('u:') === 0).map((p) => p.slice(2)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const label = (u) => {
        const per = {};
        picks.filter((p) => p.indexOf('t:') === 0).forEach((p) => { const fg = findGroup(p); if (fg && fg.g[1].indexOf(u) !== -1) (per[fg.t.name] ||= []).push(fg.g[0]); });
        return Object.keys(per).map((tn) => { const t = teams.find((x) => x.name === tn); return (t.label !== undefined ? t.label : t.name) + t.pre + per[tn].join('、') + t.post; }).join('、');
      };
      return { picks, units, label };
    };
    const drawSum = (el) => {
      const d = rowData(el);
      const min = el.querySelector('[data-f="min"]').value.trim();
      const text = el.querySelector('[data-f="text"]').value.trim();
      const parts = [Fmt.esc(Fmt.dutyText(d.picks)) + (d.units.length && min ? `<small>（每區 ${Fmt.esc(min)} 人）</small>` : ''), Fmt.esc(text)].filter(Boolean);
      el.querySelector('.duty-sum').innerHTML = d.units.length || text ? parts.join('，') : '<span class="muted">—</span>';
    };
    form.querySelectorAll('.duty-row').forEach(drawSum);
    // 按組＝選那幾區；取消組＝取消那幾區（同一行別的組還要的區留著）
    form.addEventListener('change', (e) => {
      const r = e.target.closest('.duty-row');
      if (!r) return;
      const c = e.target.closest('[data-pick^="t:"]');
      if (c) {
        const fg = findGroup(c.dataset.pick);
        const still = new Set([...r.querySelectorAll('[data-pick^="t:"]:checked')].flatMap((x) => (findGroup(x.dataset.pick) || { g: [0, []] }).g[1]));
        if (fg) fg.g[1].forEach((u) => { const box = r.querySelector(`[data-pick="u:${u}"]`); if (box) box.checked = c.checked || still.has(u); });
      }
      drawSum(r);
    });
    form.addEventListener('input', (e) => { const r = e.target.closest('.duty-row'); if (r) drawSum(r); });
    const openRow = (row, open) => {
      row.querySelector('.duty-edit').hidden = !open;
      row.classList.toggle('is-open', open);
      row.querySelector('[data-act="open-duty"]').setAttribute('aria-expanded', String(open));
    };
    form.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const row = b.closest('.duty-row');
      if (b.dataset.act === 'add-duty') {
        const list = form.querySelector('.duty-list');
        if (list.children.length >= 20) return;
        list.insertAdjacentHTML('beforeend', dutyRow({ id: newDutyId(), work: '', min: null, posId: '', text: '', picks: [], ids: {}, oldGroup: {} }));
        const added = list.lastElementChild;
        drawSum(added);
        openRow(added, true);
        added.querySelector('[data-f="work"]').focus();
      }
      if (b.dataset.act === 'open-duty') openRow(row, row.querySelector('.duty-edit').hidden);
      if (b.dataset.act === 'close-duty') { openRow(row, false); row.scrollIntoView({ block: 'nearest' }); }
      if (b.dataset.act === 'rm-duty') row.remove();
      if (b.dataset.act === 'clear-duty') {
        row.querySelectorAll('[data-pick]').forEach((c) => { c.checked = false; });
        row.querySelector('[data-f="min"]').value = '';
        row.querySelector('[data-f="text"]').value = '';
        drawSum(row);
      }
    });
    sync();
    form.addEventListener('change', sync);
    // 勾組＝勾那幾區；取消組＝取消那幾區（別的組還要的區留著）
    const teamUnits = (c) => window.SITE.teams[c.dataset.t].groups[c.dataset.g][1];
    form.addEventListener('change', (e) => {
      const c = e.target.closest('[name="team"]');
      if (!c) return;
      const still = new Set([...form.querySelectorAll('[name="team"]:checked')].flatMap(teamUnits));
      teamUnits(c).forEach((u) => {
        const box = form.querySelector(`[name="units"][value="${u}"]`);
        if (box) box.checked = c.checked || still.has(u);
      });
    });
    form.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'add-pos') {
        const list = form.querySelector('.pos-list');
        if (list.children.length < 10) list.insertAdjacentHTML('beforeend', posRow({}));
      }
      if (b.hasAttribute('data-rm')) b.closest('.pos-row').remove();
      // 全選＝16 區（測試區不算）；全不選＝全部取消
      if (b.dataset.act === 'check-all' || b.dataset.act === 'check-none') {
        form.querySelectorAll('[name="units"]').forEach((c) => { c.checked = b.dataset.act === 'check-all'; });
        if (b.dataset.act === 'check-none') form.querySelectorAll('[name="team"]').forEach((c) => { c.checked = false; });
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const data = {};
      ['category', 'name', 'group', 'start', 'end', 'startTime', 'endTime', 'location', 'dress', 'deadline', 'note', 'link'].forEach((k) => { data[k] = String(f.get(k) || '').trim(); });
      if (!data.end) data.end = data.start;
      const errs = [];
      if (multi) {
        if (f.get('scope') === 'regions') {
          data.units = f.getAll('units').map(String);
          if (!data.units.length) errs.push('請勾選要派給哪幾區');
          // 每區的組別：勾了哪幾組（例：教美區 → 志工團第 3、4、13 組）
          const picked = {};
          form.querySelectorAll('[name="team"]:checked').forEach((c) => {
            const t = window.SITE.teams[c.dataset.t];
            const g = t.groups[c.dataset.g];
            g[1].forEach((u) => { ((picked[u] ||= {})[c.dataset.t] ||= []).push(g[0]); });
          });
          data.groupOf = {};
          data.units.forEach((u) => {
            const byTeam = picked[u] || {};
            data.groupOf[u] = Object.keys(byTeam).map((ti) => { const t = window.SITE.teams[ti]; return (t.label !== undefined ? t.label : t.name) + t.pre + byTeam[ti].join('、') + t.post; }).join('、');
          });
          data.unit = data.units[0] || '';
        } else data.unit = fentan;
      } else data.unit = String(f.get('unit'));
      if (data.unit !== fentan) {
        data.kind = ev.kind === '區活動' ? '區活動' : '分壇分配'; // 後台派給區的一律是分壇分配；範例資料（區活動）修改時維持原樣
        data.positions = data.kind === '分壇分配' ? [...form.querySelectorAll('.pos-row')].map((r) => ({
          id: r.querySelector('[name="pid"]').value || undefined,
          name: r.querySelector('[name="pname"]').value.trim(),
          min: r.querySelector('[name="pmin"]').value.trim(),
          max: r.querySelector('[name="pmax"]').value.trim()
        })) : [];
      }
      // 分壇活動：分工（每一項、每一區一筆）
      let lost = [];
      if (data.unit === fentan) data.signup = !!form.signup.checked;
      if (data.unit === fentan) {
        data.duties = [];
        data.assign = [];
        const sent = new Set();
        form.querySelectorAll('.duty-row').forEach((el, i) => {
          const old = dutyRows.find((r) => r.id === el.dataset.id) || { ids: {}, oldGroup: {} };
          const work = el.querySelector('[data-f="work"]').value.trim();
          const text = el.querySelector('[data-f="text"]').value.trim();
          const d = rowData(el);
          if (!d.units.length && !text) return; // 沒排的行：略過
          if (!work) { errs.push(`第 ${i + 1} 行分工沒有填工作名稱`); return; }
          data.duties.push({ id: el.dataset.id, work, picks: d.picks, min: el.querySelector('[data-f="min"]').value.trim(), text, posId: el.dataset.pos || undefined });
          d.units.forEach((u) => {
            const id = old.ids[u];
            if (id) sent.add(id);
            data.assign.push({ id, unit: u, dutyId: el.dataset.id, group: d.label(u) || old.oldGroup[u] || '' });
          });
        });
        if (mode === 'edit') {
          const gone = myChildren.concat(legacy).filter((c) => !sent.has(c.id));
          data.drop = legacy.filter((c) => !sent.has(c.id)).map((c) => c.id);
          lost = gone.filter((c) => Object.values(c.roster || {}).some((day) => Object.values(day).some((n) => n.length)));
        }
      }
      if (mode === 'edit') data.id = src.id;
      errs.push(...check(data));
      if (errs.length) {
        errBox.textContent = errs.join('；');
        errBox.hidden = false;
        errBox.scrollIntoView({ block: 'center' });
        return;
      }
      errBox.hidden = true;
      if (lost.length && !window.confirm(`拿掉的這幾區，組長已經填了名單，存檔後名單會一起刪掉：\n${lost.map((c) => `・${c.unit} ${c.name}`).join('\n')}\n\n確定要存檔嗎？`)) return;
      busy(true, '儲存中⋯');
      try {
        const res = await Api.admin('adminSave', { event: data });
        if (res.children) events = null; // 各區勤務也變了：回列表時重新讀
        busy(false);
        const saved = res.events || [res.event];
        if (events) {
          const ids = new Set(saved.map((x) => x.id));
          events = events.filter((x) => !ids.has(x.id)).concat(saved)
            .sort((a, b) => a.start.localeCompare(b.start) || (a.startTime || '').localeCompare(b.startTime || ''));
        }
        CalendarPage.refresh(true);
        location.hash = '#/admin';
      } catch (err) {
        busy(false);
        if (err.code === 'UNAUTHORIZED') return renderLogin(err.message);
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });
  }

  function renderMissing() {
    view.innerHTML = tabs('') + '<div class="notice notice-error"><p>找不到這筆活動，可能已經被刪除。</p></div><a class="btn" href="#/admin">回活動列表</a>';
    bindCommon();
  }

  // ---------- 批次匯入 ----------
  // 匯入檔由 Claude 整理（JSON：{ title, events: [{ unit, category, name, start, end, startTime, endTime, location, note, link }] }），
  // 管理者上傳 → 預覽（有錯標紅、和現有重複的會跳過）→ 匯入。同一次匯入是一批，可以整批刪除。

  const dupKey = (e) => [e.unit, e.name, e.start, e.startTime || ''].join('|');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  /** 匯入的一筆：整理欄位並檢查（和伺服器同樣的規則，伺服器還會再檢查一次） */
  function checkImportRow(raw) {
    const v = (k) => (raw && raw[k] !== undefined && raw[k] !== null ? String(raw[k]).trim() : '');
    const ev = { unit: v('unit'), category: v('category'), name: v('name'), start: v('start'), end: v('end') || v('start'), startTime: v('startTime'), endTime: v('endTime'), location: v('location'), dress: v('dress'), deadline: v('deadline'), note: v('note'), link: v('link'), kind: v('kind'), positions: Array.isArray(raw && raw.positions) ? raw.positions : [] };
    const errs = [];
    if (ev.unit === window.SITE.jiaoquan.unit && ev.kind === '區活動') errs.push('教全區自己的活動會自動讀進來，不用匯入');
    else if (editableUnits().indexOf(ev.unit) === -1) errs.push('單位不對');
    if (window.SITE.categories.indexOf(ev.category) === -1) errs.push('類別要是勤務、道務、教育');
    if (!ev.name) errs.push('沒有名稱');
    if (!DATE_RE.test(ev.start)) errs.push('開始日期格式不對');
    if (!DATE_RE.test(ev.end)) errs.push('結束日期格式不對');
    else if (ev.end < ev.start) errs.push('結束日期早於開始日期');
    if (ev.startTime && !TIME_RE.test(ev.startTime)) errs.push('開始時間格式不對');
    if (ev.endTime && !TIME_RE.test(ev.endTime)) errs.push('結束時間格式不對');
    if (ev.endTime && !ev.startTime) errs.push('有結束時間卻沒有開始時間');
    if (ev.link && !/^https:\/\/\S+$/.test(ev.link)) errs.push('連結要 https:// 開頭');
    if (ev.deadline && !DATE_RE.test(ev.deadline)) errs.push('截止日期格式不對');
    if (ev.name.length > 60) errs.push('名稱超過 60 字');
    return { ev, errs };
  }

  async function renderImport() {
    view.innerHTML = tabs('import') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    await loadEvents();
    view.innerHTML = tabs('import') + `
      <h2 class="admin-sub">批次匯入</h2>
      <p class="hint">選 Claude 整理好的匯入檔（.json），先預覽，確認沒問題再匯入。同一次匯入算「一批」，匯錯了可以在下面整批刪除。</p>
      <label class="btn btn-primary btn-block import-pick">📂 選匯入檔<input type="file" accept=".json,application/json" hidden></label>
      <div id="import-preview"></div>
      <h2 class="admin-sub import-batches-title">最近匯入的批次</h2>
      <div id="import-batches"></div>`;
    bindCommon();
    view.querySelector('.import-pick input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (err) {
        showPreviewError('這個檔案打不開（不是正確的匯入檔）');
        return;
      }
      const rows = Array.isArray(data) ? data : data && Array.isArray(data.events) ? data.events : null;
      if (!rows || !rows.length) return showPreviewError('匯入檔裡沒有活動');
      drawPreview(file.name, (data && data.title) || '', rows);
    });
    drawBatches();
  }

  function showPreviewError(msg) {
    view.querySelector('#import-preview').innerHTML = `<p class="form-error">${Fmt.esc(msg)}</p>`;
  }

  function drawPreview(fileName, title, rows) {
    const box = view.querySelector('#import-preview');
    const existing = new Set(events.map(dupKey));
    const seen = new Set();
    const items = rows.map((raw) => {
      const r = checkImportRow(raw);
      const key = dupKey(r.ev);
      r.dup = !r.errs.length && (existing.has(key) || seen.has(key));
      seen.add(key);
      return r;
    });
    const bad = items.filter((r) => r.errs.length).length;
    const dup = items.filter((r) => r.dup).length;
    const ok = items.length - bad - dup;
    const row = (r, i) => {
      const e = r.ev;
      const when = DATE_RE.test(e.start) ? (e.start === e.end || !DATE_RE.test(e.end) ? Fmt.shortDate(e.start) : `${Fmt.shortDate(e.start)} – ${Fmt.shortDate(e.end)}`) : e.start;
      const meta = [e.startTime ? Fmt.timeRange(e) : '', e.location].filter(Boolean).join('・');
      const state = r.errs.length ? `<span class="imp-state is-bad">✗ ${Fmt.esc(r.errs.join('、'))}</span>`
        : r.dup ? '<span class="imp-state is-dup">已經有了，會跳過</span>' : '<span class="imp-state is-ok">✓</span>';
      return `<li class="imp-row${r.errs.length ? ' is-bad' : r.dup ? ' is-dup' : ''}">
          <span class="imp-n">${i + 1}</span>
          <div class="imp-main"><span class="admin-row-date">${Fmt.esc(when)}</span>
            <span><span class="unit-tag">${Fmt.esc(e.unit || '（沒有單位）')}</span> <strong>${Fmt.esc(e.name || '（沒有名稱）')}</strong></span>
            ${meta ? `<span class="card-meta">${Fmt.esc(meta)}</span>` : ''}
            ${state}</div></li>`;
    };
    box.innerHTML = `
      <div class="import-summary">
        <p><strong>${Fmt.esc(title || fileName)}</strong>（共 ${items.length} 筆）</p>
        <p>可以匯入 <strong>${ok}</strong> 筆${dup ? `，重複 ${dup} 筆會跳過` : ''}${bad ? `，<span class="imp-bad-text">有錯 ${bad} 筆</span>` : ''}</p>
        ${bad ? '<p class="imp-bad-text">有錯的要先改好才能匯入，請把錯誤告訴 Claude 重新整理。</p>' : !ok ? '<p>沒有新的活動要匯入（都已經匯入過了）。</p>' : ''}
      </div>
      <ol class="imp-list">${items.map(row).join('')}</ol>
      ${!bad && ok ? `<button type="button" class="btn btn-primary btn-block" data-act="do-import">匯入 ${ok} 筆</button>` : ''}`;
    const btn = box.querySelector('[data-act="do-import"]');
    if (btn) btn.addEventListener('click', async () => {
      busy(true, `匯入 ${ok} 筆⋯`);
      try {
        const res = await Api.admin('adminImport', { events: items.filter((r) => !r.dup).map((r) => r.ev) });
        busy(false);
        await loadEvents();
        CalendarPage.refresh(true);
        box.innerHTML = `<div class="notice notice-success"><p><strong>已匯入 ${res.added} 筆</strong>${res.skipped ? `（重複 ${res.skipped} 筆跳過）` : ''}</p><p>家人們大約 1 分鐘內看得到。</p></div>`;
        drawBatches();
      } catch (err) {
        busy(false);
        if (err.code === 'UNAUTHORIZED') return renderLogin(err.message);
        showPreviewError(err.message);
      }
    });
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function drawBatches() {
    const box = view.querySelector('#import-batches');
    const groups = new Map();
    events.forEach((e) => {
      if (!e.batch) return;
      if (!groups.has(e.batch)) groups.set(e.batch, []);
      groups.get(e.batch).push(e);
    });
    const list = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 20);
    if (!list.length) {
      box.innerHTML = '<p class="panel-empty">還沒有匯入過</p>';
      return;
    }
    box.innerHTML = `<ul class="admin-list">${list.map(([batch, evs]) => {
      const order = editableUnits();
      const units = [...new Set(evs.map((e) => e.unit))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const starts = evs.map((e) => e.start).sort();
      const at = evs.map((e) => e.createdAt).sort()[0] || '';
      return `<li class="admin-row">
          <div class="admin-row-main">
            <span class="admin-row-date">${Fmt.esc(at.slice(0, 16))} 匯入</span>
            <strong>${evs.length} 筆：${Fmt.esc(units.slice(0, 6).join('、'))}${units.length > 6 ? ` 等 ${units.length} 個單位` : ''}</strong>
            <span class="card-meta">${Fmt.esc(Fmt.shortDate(starts[0]))} – ${Fmt.esc(Fmt.shortDate(starts[starts.length - 1]))}</span>
          </div>
          <div class="admin-row-actions"><button type="button" class="btn btn-small btn-quiet-danger" data-batch="${Fmt.esc(batch)}" data-n="${evs.length}">刪除這批（${evs.length} 筆）</button></div>
        </li>`;
    }).join('')}</ul>`;
    box.querySelectorAll('[data-batch]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm(`確定要刪除這一批的 ${b.dataset.n} 筆活動嗎？\n（匯入後修改過的也會一起刪除，不能還原）`)) return;
      busy(true, '刪除中⋯');
      try {
        await Api.admin('adminDeleteBatch', { batch: b.dataset.batch });
        busy(false);
        await loadEvents();
        CalendarPage.refresh(true);
        drawBatches();
      } catch (err) {
        busy(false);
        if (err.code === 'UNAUTHORIZED') return renderLogin(err.message);
        window.alert(err.message);
      }
    }));
  }

  // ---------- 發通知（手機提醒，規格第 10-1 節） ----------

  const pad = (n) => String(n).padStart(2, '0');
  function localInput(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function stampOf(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const unitName = (u) => (u === window.SITE.fentan ? '分壇' : u);
  const targetText = (t) => (t === 'all' ? '全部' : t.map(unitName).join('、'));

  async function renderPush() {
    view.innerHTML = tabs('push') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const [stats, list] = await Promise.all([Api.admin('adminPushStats'), Api.admin('adminPushList')]);
    const counts = stats.counts || {};
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const units = stats.units;
    const opened = units.filter((u) => counts[u]).map((u) => `${Fmt.esc(unitName(u))} ${counts[u]}`).join('、');
    view.innerHTML = tabs('push') + `
      <h2 class="admin-sub">發通知到家人的手機</h2>
      <p class="hint">只會送到有開啟「🔔 手機提醒」的手機。目前共 <strong>${total}</strong> 支${opened ? '：' + opened : '，還沒有人開啟'}。每天早上 7 點、晚上 8 點的活動提醒是自動送的，不用在這裡發。</p>
      <form class="admin-form" novalidate>
        <fieldset class="form-block">
          <legend>內容</legend>
          <label class="form-row"><span>標題（最多 40 字）</span><input class="input" name="title" maxlength="40" placeholder="例：統班改地點"></label>
          <label class="form-row"><span>內容（最多 200 字）</span><textarea class="input textarea" name="body" rows="3" maxlength="200" placeholder="例：這週日的統班改在彌勒山，時間不變 🙏"></textarea></label>
        </fieldset>
        <fieldset class="form-block">
          <legend>發給誰</legend>
          <label class="radio-row"><input type="radio" name="who" value="all" checked> 全部（${total} 支）</label>
          <label class="radio-row"><input type="radio" name="who" value="pick"> 選單位</label>
          <div class="push-units" hidden>${units.map((u) => `<label class="check-chip"><input type="checkbox" name="unit" value="${Fmt.esc(u)}"> ${Fmt.esc(unitName(u))}<small>${counts[u] || 0}</small></label>`).join('')}</div>
          <p class="hint">「分壇」是送給選分壇的手機；某一區是送給選那一區的手機。</p>
        </fieldset>
        <fieldset class="form-block">
          <legend>什麼時候發</legend>
          <label class="radio-row"><input type="radio" name="when" value="now" checked> 馬上發</label>
          <label class="radio-row"><input type="radio" name="when" value="later"> 排定時間</label>
          <input class="input" type="datetime-local" name="sendAt" hidden>
        </fieldset>
        <p class="form-error" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">發出通知</button>
      </form>
      <h2 class="admin-sub import-batches-title">最近發的通知</h2>
      <div id="push-list"></div>`;
    bindCommon();
    const form = view.querySelector('form');
    const errBox = form.querySelector('.form-error');
    const unitsBox = form.querySelector('.push-units');
    form.sendAt.value = localInput(Date.now() + 3600e3 - (Date.now() % 600e3));
    form.addEventListener('change', () => {
      unitsBox.hidden = form.who.value !== 'pick';
      form.sendAt.hidden = form.when.value !== 'later';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const target = form.who.value === 'all' ? 'all' : [...form.querySelectorAll('[name="unit"]:checked')].map((x) => x.value);
      const later = form.when.value === 'later';
      const sendAt = later ? new Date(form.sendAt.value).getTime() : null;
      const title = form.title.value.trim();
      const body = form.body.value.trim();
      const errs = [];
      if (!title) errs.push('請填標題');
      if (!body) errs.push('請填內容');
      if (target !== 'all' && !target.length) errs.push('請勾選要發給哪些單位');
      if (later && !(sendAt > Date.now())) errs.push('請選排定的時間');
      if (errs.length) { errBox.textContent = errs.join('；'); errBox.hidden = false; return; }
      errBox.hidden = true;
      const n = target === 'all' ? total : target.reduce((a, u) => a + (counts[u] || 0), 0);
      if (!window.confirm(`${later ? '排定在 ' + stampOf(sendAt) : '馬上'}發給「${targetText(target)}」，大約 ${n} 支手機：\n\n${title}\n${body}`)) return;
      busy(true, '送出中⋯');
      try {
        await Api.admin('adminPushSend', { title, body, target, sendAt });
        busy(false);
        renderPush();
      } catch (err) {
        busy(false);
        if (err.code === 'UNAUTHORIZED') return renderLogin(err.message);
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });
    const box = view.querySelector('#push-list');
    const msgs = list.messages || [];
    box.innerHTML = msgs.length ? `<ul class="log-list">${msgs.map((m) => `
      <li class="log-item">
        <div class="log-head"><strong>${Fmt.esc(m.title)}</strong><span class="push-status is-${Fmt.esc(m.status)}">${Fmt.esc(m.status)}</span></div>
        <div class="card-meta">${Fmt.esc(stampOf(m.sendAt))}・發給${Fmt.esc(targetText(m.target))}${m.status === '已送出' || m.status === '送出中' ? `・成功 ${m.sent}${m.failed ? '、失敗 ' + m.failed : ''}` : ''}</div>
        <div class="push-body-text">${Fmt.esc(m.body).replace(/\n/g, '<br>')}</div>
        ${m.status === '排定' ? `<button type="button" class="btn btn-small btn-quiet-danger" data-cancel="${Fmt.esc(m.id)}">取消這則</button>` : ''}
      </li>`).join('')}</ul>` : '<p class="panel-empty">還沒有發過通知</p>';
    // 送出中的：過幾秒再看一次（最多 10 次），送完就會變成「已送出」
    if (msgs.some((m) => m.status === '送出中') && (renderPush.polls = (renderPush.polls || 0) + 1) <= 10) {
      setTimeout(() => { if (location.hash === '#/admin/push') renderPush(); }, 3000);
    } else if (!msgs.some((m) => m.status === '送出中')) {
      renderPush.polls = 0;
    }
    box.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm('確定要取消這則排定的通知嗎？')) return;
      busy(true, '取消中⋯');
      try {
        await Api.admin('adminPushCancel', { id: b.dataset.cancel });
        busy(false);
        renderPush();
      } catch (err) {
        busy(false);
        if (err.code === 'UNAUTHORIZED') return renderLogin(err.message);
        window.alert(err.message);
      }
    }));
  }

  // ---------- 操作紀錄 ----------

  async function renderLog() {
    view.innerHTML = tabs('log') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const data = await Api.admin('adminLog');
    const rows = data.log.map((l) => `
      <li class="log-item">
        <div class="log-head"><strong>${Fmt.esc(l.action)}</strong><span class="muted">${Fmt.esc(l.time)}</span></div>
        <div>${Fmt.esc(l.unit)}・${Fmt.esc(l.name)}（${Fmt.esc(l.start === l.end ? Fmt.shortDate(l.start) : Fmt.shortDate(l.start) + ' – ' + Fmt.shortDate(l.end))}）</div>
      </li>`).join('');
    view.innerHTML = tabs('log') + (rows ? `<p class="muted">最近 ${data.log.length} 筆</p><ul class="log-list">${rows}</ul>` : '<p class="panel-empty">還沒有操作紀錄</p>');
    bindCommon();
  }

  window.AdminPage = { show };
})();
