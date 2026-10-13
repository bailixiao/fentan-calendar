// 管理後台（#/admin）：登入、活動列表、新增／修改／另存新的／刪除、批次匯入（可整批刪除）、發通知（手機提醒）、操作紀錄、下載備份。
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
      <nav class="admin-tabs">${t('#/admin', '活動', 'list')}${t('#/admin/new', '＋ 新增活動', 'new')}${t('#/admin/import', '匯入', 'import')}${t('#/admin/push', '📣 發通知', 'push')}${t('#/admin/log', '操作紀錄', 'log')}</nav>`;
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

  // ---------- 批次匯入 ----------
  // 匯入檔由 Claude 整理（JSON：{ title, events: [{ unit, category, name, start, end, startTime, endTime, location, note, link }] }），
  // 管理者上傳 → 預覽（有錯標紅、和現有重複的會跳過）→ 匯入。同一次匯入是一批，可以整批刪除。

  const dupKey = (e) => [e.unit, e.name, e.start, e.startTime || ''].join('|');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  /** 匯入的一筆：整理欄位並檢查（和伺服器同樣的規則，伺服器還會再檢查一次） */
  function checkImportRow(raw) {
    const v = (k) => (raw && raw[k] !== undefined && raw[k] !== null ? String(raw[k]).trim() : '');
    const ev = { unit: v('unit'), category: v('category'), name: v('name'), start: v('start'), end: v('end') || v('start'), startTime: v('startTime'), endTime: v('endTime'), location: v('location'), note: v('note'), link: v('link') };
    const errs = [];
    if (ev.unit === window.SITE.jiaoquan.unit) errs.push('教全區的活動會自動讀進來，不用匯入');
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
