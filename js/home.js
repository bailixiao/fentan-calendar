// 家人看的畫面（規格第 5、6 節）：主畫面（班的卡片）、班的頁面（一整年每一堂）、那一堂的頁面（報名、名單）。
(function () {
  'use strict';

  const UNIT_KEY = 'fentan-calendar:my-unit'; // 上次報名選的區（下次預設）
  let board = null; // 主畫面的資料（記在記憶體，回上一頁不用再等）
  let token = 0; // 換頁時，舊的請求回來就不畫

  const today = () => (board && board.today) || Fmt.toDateStr(new Date());
  const readUnit = () => { try { return localStorage.getItem(UNIT_KEY) || ''; } catch (e) { return ''; } };
  const saveUnit = (u) => { try { localStorage.setItem(UNIT_KEY, u); } catch (e) { /* 忽略 */ } };

  async function loadBoard(fresh) {
    board = await Api.getBoard(fresh);
    return board;
  }

  function busy(on, text) {
    const box = document.getElementById('busy');
    box.querySelector('.busy-text').textContent = text || '';
    box.hidden = !on;
  }

  function errorHtml(err) {
    return `<div class="notice notice-error"><p>${Fmt.esc(err.message || '讀取失敗')}</p></div><button type="button" class="btn" onclick="location.reload()">重新整理</button>`;
  }

  /** 一堂的狀態字：停課、截止、額滿、還可以報（寫截止日） */
  function stateText(s) {
    if (s.cancelled) return '<span class="state state-off">停課</span>';
    if (s.date < today()) return '<span class="state state-past">已經上過</span>';
    if (s.closed) return '<span class="state state-off">報名已截止</span>';
    if (s.full) return '<span class="state state-off">已額滿</span>';
    return `<span class="state">${Fmt.esc(Fmt.md(s.deadline))} 截止</span>`;
  }

  const when = (s, c) => [Fmt.shortDate(s.date), Fmt.timeRange(s)].filter(Boolean).join(' ') || '';
  const nextOf = (c) => c.sessions.find((s) => s.date >= today() && !s.cancelled);

  // ---------- 主畫面 ----------

  function cardHtml(c) {
    const next = nextOf(c);
    const skipped = c.sessions.filter((s) => s.cancelled && s.date >= today() && (!next || s.date < next.date));
    const single = c.sessions.length === 1; // 臨時活動：只有一堂
    const head = `<a class="course-head" href="#/${single && next ? 's/' + encodeURIComponent(next.id) : 'c/' + encodeURIComponent(c.id)}"><span class="course-name">${Fmt.esc(c.name)}</span>${single ? '' : '<span class="course-all">全部課程 ›</span>'}</a>`;
    if (!next) return `<article class="course-card c-${Fmt.esc(c.color)}">${head}<p class="course-done">這期的課都上完了</p></article>`;
    return `
      <article class="course-card c-${Fmt.esc(c.color)}">
        ${head}
        <a class="next" href="#/s/${encodeURIComponent(next.id)}">
          <span class="next-label">${single ? '活動' : `下一堂${next.no ? `・第 ${next.no} 堂` : ''}`}</span>
          <span class="next-date">${Fmt.esc(when(next))}</span>
          ${next.location ? `<span class="next-meta">📍 ${Fmt.esc(next.location)}</span>` : ''}
          ${next.topic || next.teacher ? `<span class="next-meta">${next.topic ? `主題：${Fmt.esc(next.topic)}` : ''}${next.topic && next.teacher ? '　' : ''}${next.teacher ? `講師：${Fmt.esc(next.teacher)}` : ''}</span>` : ''}
        </a>
        ${skipped.length ? `<p class="next-skip">${skipped.map((s) => Fmt.esc(Fmt.shortDate(s.date))).join('、')} 停課</p>` : ''}
        <div class="next-foot">
          <span class="next-count">已報名 <b>${next.count}</b> 人${next.cap ? `／名額 ${next.cap}` : ''}　${stateText(next)}</span>
          <a class="btn ${next.canSignup ? 'btn-primary' : ''}" href="#/s/${encodeURIComponent(next.id)}">${next.canSignup ? '報名' : '看名單'}</a>
        </div>
      </article>`;
  }

  async function showHome(view) {
    const t = ++token;
    const draw = (b) => {
      view.querySelector('#board').innerHTML = b.courses.length ? b.courses.map(cardHtml).join('')
        : '<p class="panel-empty">目前沒有開放報名的班</p>';
    };
    if (board) draw(board);
    else view.querySelector('#board').innerHTML = '<p class="panel-empty">載入中⋯</p>';
    try {
      const b = await loadBoard(false);
      if (t === token) draw(b);
    } catch (err) {
      if (t === token && !board) view.querySelector('#board').innerHTML = errorHtml(err);
    }
  }

  // ---------- 班的頁面 ----------

  function rowHtml(s) {
    return `
      <a class="session-row${s.cancelled ? ' is-off' : ''}" href="#/s/${encodeURIComponent(s.id)}">
        <span class="session-date">${Fmt.esc(Fmt.shortDate(s.date))}<small>${s.cancelled ? '停課' : `第 ${s.no} 堂`}</small></span>
        <span class="session-main">${s.topic ? `<strong>${Fmt.esc(s.topic)}</strong>` : '<span class="muted">主題還沒排</span>'}${s.teacher ? `<small>講師：${Fmt.esc(s.teacher)}</small>` : ''}</span>
        <span class="session-side">${s.cancelled ? '' : `${s.count} 人`}${s.cancelled ? '' : stateText(s)}</span>
      </a>`;
  }

  async function showCourse(view, id) {
    const t = ++token;
    view.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    let b;
    try { b = board || await loadBoard(false); } catch (err) { view.innerHTML = errorHtml(err); return; }
    if (t !== token) return;
    let c = b.courses.find((x) => x.id === id);
    if (!c) {
      try { b = await loadBoard(true); } catch (err) { /* 用手上的 */ }
      c = b.courses.find((x) => x.id === id);
    }
    if (!c) { view.innerHTML = '<div class="notice notice-error"><p>找不到這個班，可能已經收起來了。</p></div><a class="btn btn-block back-btn" href="#/">‹ 回首頁</a>'; return; }
    const upcoming = c.sessions.filter((s) => s.date >= today());
    const past = c.sessions.filter((s) => s.date < today());
    view.innerHTML = `
      <div class="page-head c-${Fmt.esc(c.color)}"><h1>${Fmt.esc(c.name)}</h1>
        <p>${Fmt.esc([c.startTime ? `${Fmt.timeRange(c)}` : '', c.location].filter(Boolean).join('・'))}</p></div>
      ${c.intro ? `<p class="intro">${Fmt.esc(c.intro).replace(/\n/g, '<br>')}</p>` : ''}
      <h2 class="section-title">接下來的課</h2>
      <div class="session-list">${upcoming.length ? upcoming.map(rowHtml).join('') : '<p class="panel-empty">這期的課都上完了</p>'}</div>
      ${past.length ? `<details class="past"><summary>已經上過的課（${past.length} 堂）</summary><div class="session-list">${past.map(rowHtml).join('')}</div></details>` : ''}
      <a class="btn btn-block back-btn" href="#/">‹ 回首頁</a>`;
  }

  // ---------- 那一堂的頁面：報名、名單 ----------

  function listHtml(data, who) {
    const by = {};
    data.signups.forEach((r) => { (by[r.unit] ||= []).push(r); });
    const units = window.SITE.units.filter((u) => by[u]);
    if (!units.length) return '<p class="panel-empty">還沒有人報名，歡迎第一個報名 🙂</p>';
    return units.map((u) => `
      <div class="unit-group">
        <p class="unit-group-head"><span class="unit-tag">${Fmt.esc(u)}</span><span class="muted">${by[u].length} 人</span></p>
        <div class="name-list">${by[u].map((r) => `<span class="person${r.mine ? ' is-mine' : ''}">${Fmt.esc(r.name)}${r.walkin ? '<small>現場</small>' : ''}</span>`).join('')}</div>
      </div>`).join('');
  }

  function formHtml(data, who) {
    const s = data.session;
    const region = who && who.role === 'region';
    const helper = who && (who.role === 'super' || region);
    if (s.cancelled) return '<div class="notice"><p>這堂課停課。</p></div>';
    if (!s.canSignup && !helper) return `<div class="notice"><p>${s.full ? '這堂課已經額滿了。' : '這堂課的報名已經截止了。'}要報名請找自己區的組長。</p></div>`;
    const unit = region ? who.account : readUnit();
    return `
      <form class="signup-form" novalidate>
        <h2 class="section-title">報名</h2>
        ${helper ? `<p class="hint">${region ? `你是${Fmt.esc(who.account)}的組長，可以幫${Fmt.esc(who.account)}的人報名（截止後也可以）。` : '總管理者：可以幫任何一區報名。'}</p>` : ''}
        <label class="form-row"><span>姓名（好幾個人一起報，名字中間空一格或用「、」）</span>
          <input class="input" name="names" autocomplete="name" placeholder="例：王小明 測試甲"></label>
        <div class="name-preview" data-preview aria-live="polite"></div>
        <label class="form-row"><span>區</span>${region ? `<input class="input" value="${Fmt.esc(unit)}" disabled><input type="hidden" name="unit" value="${Fmt.esc(unit)}">` : `<select class="input" name="unit">${Fmt.unitOptions(unit, '請選擇區')}</select>`}</label>
        <p class="form-error" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">報名</button>
      </form>`;
  }

  async function showSession(view, id) {
    const t = ++token;
    view.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    let data;
    try { data = await Api.getSession(id); } catch (err) { if (t === token) view.innerHTML = errorHtml(err); return; }
    if (t !== token) return;
    const who = Api.isAdmin() ? Api.who() : null;
    const s = data.session;
    const c = data.course;
    view.innerHTML = `
      <a class="crumb" href="#/c/${encodeURIComponent(c.id)}">‹ ${Fmt.esc(c.name)}・全部課程</a>
      <div class="page-head c-${Fmt.esc(c.color)}">
        <h1>${Fmt.esc(c.name)}${s.cancelled ? '・停課' : s.no ? `・第 ${s.no} 堂` : ''}</h1>
        ${s.topic ? `<p class="page-topic">${Fmt.esc(s.topic)}</p>` : ''}
      </div>
      <dl class="detail-info">
        <div><dt>日期</dt><dd>${Fmt.esc(Fmt.rocDate(s.date))}</dd></div>
        ${Fmt.timeRange(s) ? `<div><dt>時間</dt><dd>${Fmt.esc(Fmt.timeRange(s))}</dd></div>` : ''}
        ${s.location ? `<div><dt>地點</dt><dd>${Fmt.esc(s.location)}</dd></div>` : ''}
        ${s.teacher ? `<div><dt>講師</dt><dd>${Fmt.esc(s.teacher)}</dd></div>` : ''}
        ${s.cancelled ? '' : `<div><dt>報名截止</dt><dd>${Fmt.esc(Fmt.shortDate(s.deadline))}${s.cap ? `　名額 ${s.cap} 人` : ''}</dd></div>`}
      </dl>
      ${s.content ? `<section class="detail-section"><h2 class="section-title">課程內容</h2><p class="detail-desc">${Fmt.esc(s.content).replace(/\n/g, '<br>')}</p></section>` : ''}
      <div id="signup-msg" class="notice notice-success" hidden></div>
      ${formHtml(data, who)}
      <section class="detail-section">
        <h2 class="section-title">報名名單<span class="h2-sub">共 ${data.signups.length} 人</span></h2>
        ${listHtml(data, who)}
        <p class="hint">標顏色的是用這支手機報的。要取消報名，請到首頁的「📋 區的報名」選自己的區。</p>
        <a class="btn btn-block" href="#/u/${encodeURIComponent(readUnit() || '')}">📋 區的報名（查看、取消）</a>
      </section>
      ${who && (who.role === 'super' || who.role === 'roll') ? `<a class="btn btn-block" href="#/admin/roll/${encodeURIComponent(s.id)}">✅ 點名</a>` : ''}
      <a class="btn btn-block back-btn" href="#/">‹ 回首頁</a>`;
    bind(view, id, data, who);
  }

  function bind(view, id, data, who) {
    const form = view.querySelector('.signup-form');
    const msgBox = view.querySelector('#signup-msg');
    const done = async (text) => {
      await showSession(view, id);
      const box = view.querySelector('#signup-msg');
      box.innerHTML = `<p>${Fmt.esc(text)}</p>`;
      box.hidden = false;
      board = null; // 主畫面的人數要重讀
    };
    if (form) {
      const preview = () => { form.querySelector('[data-preview]').innerHTML = Fmt.namesPreview(form.names.value); };
      form.names.addEventListener('input', preview);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = form.querySelector('.form-error');
        const names = form.names.value.trim();
        const unit = form.unit.value;
        const problems = [];
        if (!names) problems.push('請填姓名');
        if (!unit) problems.push('請選擇區');
        if (problems.length) { err.textContent = problems.join('；'); err.hidden = false; return; }
        if (!Fmt.confirmOdd(names)) { form.names.focus(); return; }
        err.hidden = true;
        busy(true, '報名中⋯');
        try {
          const helper = who && (who.role === 'super' || who.role === 'region');
          const res = helper ? await Api.admin('adminSignup', { sessionId: id, names, unit }) : await Api.signup(id, names, unit);
          if (!helper) saveUnit(unit);
          busy(false);
          const parts = [];
          if (res.added.length) parts.push(`已報名：${res.added.map((r) => r.name).join('、')}（${unit}）`);
          if (res.skipped.length) parts.push(`${res.skipped.join('、')} 已經報過了`);
          await done(parts.join('。'));
        } catch (x) {
          busy(false);
          err.textContent = x.message;
          err.hidden = false;
        }
      });
    }
    msgBox.hidden = true;
  }

  // ---------- 區的報名：選區，看這一區接下來每一堂報了誰；取消在這裡 ----------

  async function showUnit(view, unit) {
    const t = ++token;
    const who = Api.isAdmin() ? Api.who() : null;
    if (!unit && who && who.role === 'region') unit = who.account;
    if (!unit) unit = readUnit();
    const head = `
      <div class="page-head"><h1>📋 區的報名</h1><p>選自己的區，看接下來每一堂報了誰。報錯了在這裡取消。</p></div>
      <label class="form-row"><span>哪一區</span><select class="input" data-f="unit">${Fmt.unitOptions(unit, '請選擇區')}</select></label>
      <div id="unit-msg" class="notice notice-success" hidden></div>
      <div id="unit-list"></div>
      <a class="btn btn-block back-btn" href="#/">‹ 回首頁</a>`;
    view.innerHTML = head;
    view.querySelector('[data-f="unit"]').addEventListener('change', (e) => { location.hash = '#/u/' + encodeURIComponent(e.target.value); });
    const box = view.querySelector('#unit-list');
    if (!unit) { box.innerHTML = '<p class="panel-empty">請先選區</p>'; return; }
    box.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    let data;
    try { data = await Api.getUnit(unit); } catch (err) { if (t === token) box.innerHTML = errorHtml(err); return; }
    if (t !== token) return;
    const canCancel = (r, s) => (who && (who.role === 'super' || (who.role === 'region' && who.account === unit))) || (r.mine && !s.closed);
    box.innerHTML = data.items.length ? data.items.map(({ course: c, session: s, signups }) => `
      <section class="unit-item">
        <a class="unit-item-head" href="#/s/${encodeURIComponent(s.id)}">
          <span class="course-tag c-${Fmt.esc(c.color)}">${Fmt.esc(c.name)}</span>
          <strong>${Fmt.esc(Fmt.shortDate(s.date))}${s.startTime ? ' ' + Fmt.esc(s.startTime) : ''}</strong>
          <span class="muted">${s.no ? `第 ${s.no} 堂` : ''}${s.topic ? '・' + Fmt.esc(s.topic) : ''}</span>
        </a>
        <p class="unit-item-meta">${unit} ${signups.length} 人・${s.closed ? '報名已截止' : `${Fmt.esc(Fmt.md(s.deadline))} 截止`}</p>
        <div class="name-list">${signups.map((r) => `<span class="person${r.mine ? ' is-mine' : ''}">${Fmt.esc(r.name)}${canCancel(r, s) ? `<button type="button" class="person-x" data-cancel="${Fmt.esc(r.id)}" data-admin="${r.mine && !s.closed ? '' : '1'}" aria-label="取消${Fmt.esc(r.name)}的報名">取消</button>` : ''}</span>`).join('')}</div>
      </section>`).join('') + '<p class="hint">標顏色的是用這支手機報的，截止前可以自己取消。換了手機、或已經截止，請找組長幫忙。</p>'
      : `<p class="panel-empty">${Fmt.esc(unit)}在接下來的課還沒有人報名</p>`;
    box.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
      const name = b.parentNode.firstChild.textContent;
      if (!window.confirm(`確定要取消「${name}」的報名嗎？`)) return;
      busy(true, '取消中⋯');
      try {
        if (b.dataset.admin) await Api.admin('adminCancelSignup', { id: b.dataset.cancel });
        else await Api.cancelSignup(b.dataset.cancel);
        busy(false);
        board = null;
        await showUnit(view, unit);
        const msg = view.querySelector('#unit-msg');
        msg.innerHTML = `<p>已取消「${Fmt.esc(name)}」的報名</p>`;
        msg.hidden = false;
      } catch (x) {
        busy(false);
        window.alert(x.message);
      }
    }));
  }

  window.HomePage = {
    showHome, showCourse, showSession, showUnit,
    refresh: () => { board = null; }
  };
})();
