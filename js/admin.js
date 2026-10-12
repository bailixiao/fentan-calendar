// 管理後台（#/admin）：登入、活動列表、新增／修改／另存新的／刪除、操作紀錄、下載備份。
// 只能改分壇與各區手動輸入的活動；教全區的活動自動讀進來，不在這裡改。權限由伺服器檢查。
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
    return units || [window.SITE.fentan].concat(window.SITE.units.filter((u) => u !== window.SITE.jiaoquan.unit));
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
      <nav class="admin-tabs">${t('#/admin', '活動', 'list')}${t('#/admin/new', '＋ 新增活動', 'new')}${t('#/admin/log', '操作紀錄', 'log')}</nav>`;
  }

  // ---------- 路由 ----------

  async function show(el, sub) {
    view = el;
    if (!Api.isAdmin()) return renderLogin();
    const parts = (sub || '').split('/');
    try {
      if (parts[0] === 'new') return renderForm(null, 'new');
      if (parts[0] === 'edit' || parts[0] === 'copy') {
        if (!events) await loadEvents();
        const ev = events.find((e) => e.id === decodeURIComponent(parts[1] || ''));
        if (!ev) return renderMissing();
        return renderForm(ev, parts[0]);
      }
      if (parts[0] === 'log') return renderLog();
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

  function renderLogin(message) {
    view.innerHTML = `
      <form class="admin-login" autocomplete="off">
        <div class="login-head">
          <img class="login-logo" src="icons/icon-192.png" alt="" width="72" height="72">
          <h1 class="login-title">管理後台</h1>
          <p class="login-sub">${Fmt.esc(window.SITE.name)}</p>
        </div>
        ${message ? `<p class="form-error">${Fmt.esc(message)}</p>` : ''}
        <label class="login-field">
          <span>管理密碼</span>
          <span class="login-pw">
            <input class="input login-input" type="password" name="password" required autocomplete="current-password">
            <button type="button" class="login-eye" aria-label="顯示密碼">顯示</button>
          </span>
        </label>
        <p class="form-error" hidden></p>
        <button type="submit" class="btn btn-primary btn-block login-submit">登入</button>
        <p class="login-foot">家人們看行事曆不用登入</p>
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
        await Api.adminLogin(input.value);
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
          ${Fmt.tagsHtml(e)}
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
    if (!window.confirm(`確定要刪除「${ev.name}」（${Fmt.shortDate(ev.start)}）嗎？\n刪除後不能還原。`)) return;
    busy(true, '刪除中⋯');
    try {
      await Api.admin('adminDelete', { id });
      events = events.filter((e) => e.id !== id);
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

  /** 前端先檢查一次（伺服器也會檢查），回傳錯誤清單 */
  function check(ev) {
    const errs = [];
    if (!ev.name) errs.push('請填活動名稱');
    if (!ev.start) errs.push('請選開始日期');
    if (ev.end && ev.start && ev.end < ev.start) errs.push('結束日期不能早於開始日期');
    if (ev.endTime && !ev.startTime) errs.push('有結束時間就要填開始時間');
    if (ev.link && !/^https:\/\/\S+$/.test(ev.link)) errs.push('相關連結要以 https:// 開頭');
    return errs;
  }

  function renderForm(src, mode) {
    const ev = src ? Object.assign({}, src) : { unit: filter.unit !== '全部' ? filter.unit : window.SITE.fentan, category: '勤務', start: CalendarPage.today() };
    const title = mode === 'edit' ? '修改活動' : mode === 'copy' ? '另存成新的活動' : '新增活動';
    const opt = (list, value, label) => list.map((v) => `<option value="${Fmt.esc(v)}"${v === value ? ' selected' : ''}>${Fmt.esc(label ? label(v) : v)}</option>`).join('');
    view.innerHTML = tabs(mode === 'new' ? 'new' : '') + `
      <form class="admin-form" novalidate>
        <h2 class="admin-sub">${title}</h2>
        ${mode === 'copy' ? '<p class="hint">從「' + Fmt.esc(src.name) + '」複製過來，改好日期再存，原本那筆不會變。</p>' : ''}
        <fieldset class="form-block">
          <legend>哪一個單位、哪一類</legend>
          <div class="form-row-pair">
            <label><span>單位</span><select class="input" name="unit">${opt(editableUnits(), ev.unit)}</select></label>
            <label><span>類別</span><select class="input" name="category">${opt(window.SITE.categories, ev.category, Fmt.catLabel)}</select></label>
          </div>
        </fieldset>
        <fieldset class="form-block">
          <legend>活動</legend>
          <label class="form-row"><span>活動名稱</span><input class="input" name="name" maxlength="60" required value="${Fmt.esc(ev.name || '')}" placeholder="例：分壇法會"></label>
          <div class="form-row-pair">
            <label><span>開始日期</span><input class="input" type="date" name="start" required value="${Fmt.esc(ev.start || '')}"></label>
            <label><span>結束日期（一天的留空）</span><input class="input" type="date" name="end" value="${ev.end && ev.end !== ev.start ? Fmt.esc(ev.end) : ''}"></label>
          </div>
          <div class="form-row-pair">
            <label><span>開始時間（可以不填）</span><input class="input" type="time" name="startTime" value="${Fmt.esc(ev.startTime || '')}"></label>
            <label><span>結束時間（可以不填）</span><input class="input" type="time" name="endTime" value="${Fmt.esc(ev.endTime || '')}"></label>
          </div>
          <label class="form-row"><span>地點</span><input class="input" name="location" maxlength="60" value="${Fmt.esc(ev.location || '')}"></label>
          <label class="form-row"><span>說明（可以不填）</span><textarea class="input textarea" name="note" rows="4" maxlength="1000">${Fmt.esc(ev.note || '')}</textarea></label>
          <label class="form-row"><span>相關連結（可以不填，要 https:// 開頭）</span><input class="input" type="url" name="link" maxlength="500" value="${Fmt.esc(ev.link || '')}" placeholder="https://"></label>
        </fieldset>
        <p class="form-error" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">${mode === 'edit' ? '儲存修改' : '新增'}</button>
        <a class="btn btn-block back-btn" href="#/admin">取消</a>
      </form>`;
    bindCommon();
    const form = view.querySelector('form');
    const errBox = form.querySelector('.form-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const data = {};
      ['unit', 'category', 'name', 'start', 'end', 'startTime', 'endTime', 'location', 'note', 'link'].forEach((k) => { data[k] = String(f.get(k) || '').trim(); });
      if (!data.end) data.end = data.start;
      if (mode === 'edit') data.id = src.id;
      const errs = check(data);
      if (errs.length) {
        errBox.textContent = errs.join('；');
        errBox.hidden = false;
        errBox.scrollIntoView({ block: 'center' });
        return;
      }
      errBox.hidden = true;
      busy(true, '儲存中⋯');
      try {
        const res = await Api.admin('adminSave', { event: data });
        busy(false);
        if (events) {
          events = events.filter((x) => x.id !== res.event.id).concat(res.event)
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
