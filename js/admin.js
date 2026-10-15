// 管理後台（#/admin，規格第 7～9 節）：登入（總管理者、點名、各區組長）。
//   總管理者：班與課程（新增、修改、排一整年、每一堂）、點名、帳號、發通知、操作紀錄、下載備份、刪除舊資料。
//   點名帳號：點名、出席紀錄。組長：到那一堂的頁面幫自己區的人報名、取消。權限由伺服器檢查。
(function () {
  'use strict';

  let view = null;
  let data = null; // adminCourses：全部的班和每一堂（含報名人數）

  function busy(on, text) {
    const box = document.getElementById('busy');
    box.hidden = !on;
    box.querySelector('.busy-text').textContent = text || '處理中⋯';
  }

  const who = () => Api.who() || { role: 'super', account: '總管理者' };

  function tabs(active) {
    const t = (hash, label, key) => `<a class="admin-tab${active === key ? ' is-active' : ''}" href="${hash}">${label}</a>`;
    const w = who();
    const nav = w.role === 'super'
      ? t('#/admin', '班與課程', 'courses') + t('#/admin/roll', '✅ 點名', 'roll') + t('#/admin/accounts', '帳號', 'accounts') + t('#/admin/push', '📣 發通知', 'push') + t('#/admin/log', '操作紀錄', 'log')
      : w.role === 'roll' ? t('#/admin/roll', '✅ 點名', 'roll') : '';
    return `
      <div class="admin-head">
        <h1 class="admin-title">${w.role === 'super' ? '管理後台' : w.role === 'roll' ? '點名' : Fmt.esc(w.account) + '・組長'}</h1>
        <button type="button" class="link-btn" data-act="logout">登出</button>
      </div>
      ${nav ? `<nav class="admin-tabs">${nav}</nav>` : ''}`;
  }

  // ---------- 路由 ----------

  async function show(el, sub) {
    view = el;
    const parts = (sub || '').split('/').map(decodeURIComponent);
    if (!Api.isAdmin()) return renderLogin('');
    const role = who().role;
    try {
      if (role === 'region') return await renderRegion();
      if (parts[0] === 'roll' && parts[1]) return await renderRoll(parts[1]);
      if (parts[0] === 'attendance' && parts[1]) return await renderAttendance(parts[1]);
      if (role === 'roll' || parts[0] === 'roll') return await renderRollPick();
      if (parts[0] === 'course' && parts[1] === 'new') return await renderCourseForm(null);
      if (parts[0] === 'course' && parts[2] === 'edit') return await renderCourseForm(parts[1]);
      if (parts[0] === 'course' && parts[1]) return await renderCourse(parts[1]);
      if (parts[0] === 'session' && parts[1] === 'new') return await renderSessionForm(null, parts[2]);
      if (parts[0] === 'session' && parts[1]) return await renderSessionForm(parts[1]);
      if (parts[0] === 'accounts') return await renderAccounts();
      if (parts[0] === 'push') return await renderPush();
      if (parts[0] === 'log') return await renderLog();
      return await renderCourses();
    } catch (err) {
      handleError(err);
    }
  }

  function handleError(err) {
    if (err.code === 'UNAUTHORIZED' && /登入/.test(err.message)) return renderLogin(err.message);
    view.innerHTML = `<div class="notice notice-error"><p>${Fmt.esc(err.message || '發生錯誤')}</p></div><button type="button" class="btn" onclick="location.reload()">重新整理</button>`;
  }

  function bindCommon() {
    const out = view.querySelector('[data-act="logout"]');
    if (out) out.addEventListener('click', () => {
      Api.adminLogout();
      data = null;
      HomePage.refresh();
      renderLogin('');
    });
  }

  async function load(fresh) {
    if (!data || fresh) data = await Api.admin('adminCourses');
    return data;
  }

  const findSession = (id) => {
    for (const c of data.courses) { const s = c.sessions.find((x) => x.id === id); if (s) return { c, s }; }
    return null;
  };

  // ---------- 登入 ----------

  async function renderLogin(message) {
    let accounts = ['總管理者'];
    try { accounts = (await Api.loginAccounts()).accounts; } catch (e) { /* 讀不到：只列總管理者 */ }
    let last = '';
    try { last = localStorage.getItem('fentan-calendar:last-account') || ''; } catch (e) { /* 忽略 */ }
    view.innerHTML = `
      <form class="admin-login" autocomplete="off">
        <div class="login-head">
          <img class="login-logo" src="icons/icon-192.png" alt="" width="72" height="72">
          <h1 class="login-title">管理者登入</h1>
          <p class="login-sub">${Fmt.esc(window.SITE.name)}</p>
        </div>
        ${message ? `<p class="form-error">${Fmt.esc(message)}</p>` : ''}
        <label class="login-field">
          <span>帳號</span>
          <select class="input login-input" name="account">${accounts.map((a) => `<option${a === last ? ' selected' : ''}>${Fmt.esc(a)}</option>`).join('')}</select>
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
        <p class="login-foot">幹部點名選「點名」；各區組長選自己的區。家人報名不用登入。</p>
      </form>`;
    const form = view.querySelector('form');
    const input = form.password;
    const errBox = form.querySelector('.form-error[hidden]');
    form.querySelector('.login-eye').addEventListener('click', (ev) => {
      const on = input.type === 'password';
      input.type = on ? 'text' : 'password';
      ev.currentTarget.textContent = on ? '隱藏' : '顯示';
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errBox.hidden = true;
      busy(true, '登入中⋯');
      try {
        await Api.adminLogin(input.value, form.account.value === '總管理者' ? '' : form.account.value);
        try { localStorage.setItem('fentan-calendar:last-account', form.account.value); } catch (x) { /* 忽略 */ }
        busy(false);
        HomePage.refresh();
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

  // ---------- 組長：到那一堂的頁面幫自己區報名 ----------

  async function renderRegion() {
    const w = who();
    view.innerHTML = tabs('') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const b = await Api.getBoard(true);
    const rows = b.courses.flatMap((c) => c.sessions.filter((s) => s.date >= b.today && !s.cancelled).slice(0, 4).map((s) => ({ c, s })))
      .sort((x, y) => x.s.date.localeCompare(y.s.date));
    view.innerHTML = tabs('') + `
      <p class="hint">點一堂課，在「報名」可以幫${Fmt.esc(w.account)}的人報名（截止後也可以）；名單上${Fmt.esc(w.account)}的人旁邊有「取消」。</p>
      <div class="session-list">${rows.length ? rows.map(({ c, s }) => `
        <a class="session-row" href="#/s/${encodeURIComponent(s.id)}">
          <span class="session-date">${Fmt.esc(Fmt.shortDate(s.date))}<small>第 ${s.no} 堂</small></span>
          <span class="session-main"><span class="course-tag c-${Fmt.esc(c.color)}">${Fmt.esc(c.name)}</span>${s.topic ? `<strong>${Fmt.esc(s.topic)}</strong>` : ''}</span>
          <span class="session-side">${s.count} 人</span>
        </a>`).join('') : '<p class="panel-empty">目前沒有接下來的課</p>'}</div>`;
    bindCommon();
  }

  // ---------- 班與課程（總管理者） ----------

  async function renderCourses() {
    view.innerHTML = tabs('courses') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const [d, old] = await Promise.all([load(true), Api.admin('adminOldCount')]);
    const next = (c) => c.sessions.find((s) => s.date >= d.today && !s.cancelled);
    view.innerHTML = tabs('courses') + `
      ${old.count ? `<div class="notice"><p>第一版（行事曆）留下的總務、道務活動還有 <strong>${old.count}</strong> 筆。先按「⬇ 下載備份」存一份，再按「刪除舊資料」。</p>
        <div class="admin-actions"><button type="button" class="btn btn-small" data-act="backup">⬇ 下載備份</button><button type="button" class="btn btn-small btn-quiet-danger" data-act="purge">刪除舊資料</button></div></div>` : ''}
      <div class="admin-actions">
        <a class="btn btn-primary" href="#/admin/course/new">＋ 新增班</a>
        <button type="button" class="btn" data-act="backup">⬇ 下載備份</button>
      </div>
      <ul class="admin-list">${d.courses.length ? d.courses.map((c) => {
        const n = next(c);
        return `
        <li class="admin-row${c.open ? '' : ' is-past'}">
          <div class="admin-row-main">
            <span><span class="course-tag c-${Fmt.esc(c.color)}">${Fmt.esc(c.name)}</span>${c.open ? '' : '<span class="muted">（收起來，主畫面看不到）</span>'}</span>
            <span class="card-meta">${c.sessions.length} 堂${n ? `・下一堂 ${Fmt.esc(Fmt.shortDate(n.date))}（第 ${n.no} 堂，${n.count} 人報名）` : '・沒有接下來的課'}</span>
          </div>
          <div class="admin-row-actions">
            <a class="btn btn-small btn-primary" href="#/admin/course/${encodeURIComponent(c.id)}">每一堂</a>
            <a class="btn btn-small" href="#/admin/course/${encodeURIComponent(c.id)}/edit">修改班</a>
          </div>
        </li>`;
      }).join('') : '<li class="panel-empty">還沒有班，按「＋ 新增班」開始</li>'}</ul>`;
    bindCommon();
    view.querySelectorAll('[data-act="backup"]').forEach((b) => b.addEventListener('click', backup));
    const purge = view.querySelector('[data-act="purge"]');
    if (purge) purge.addEventListener('click', async () => {
      if (!window.confirm(`確定要刪除第一版留下的 ${old.count} 筆總務、道務活動嗎？\n刪除後不能還原，請確定已經下載備份。`)) return;
      busy(true, '刪除中⋯');
      try { await Api.admin('adminPurgeOld'); busy(false); renderCourses(); } catch (err) { busy(false); handleError(err); }
    });
  }

  async function backup() {
    busy(true, '準備備份⋯');
    try {
      const b = await Api.admin('adminBackup');
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `education-backup-${Fmt.toDateStr(new Date()).replace(/-/g, '')}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      busy(false);
    } catch (err) {
      busy(false);
      handleError(err);
    }
  }

  /** 時間只給整點、半點（05:00～23:30）；原本存的不是整點半點的也列出來 */
  function timeOptions(value) {
    const list = [];
    for (let h = 5; h <= 23; h++) ['00', '30'].forEach((m) => list.push(String(h).padStart(2, '0') + ':' + m));
    if (value && list.indexOf(value) === -1) { list.push(value); list.sort(); }
    return '<option value="">不填</option>' + list.map((t) => `<option${t === value ? ' selected' : ''}>${t}</option>`).join('');
  }

  /** 下一個星期六（今天是星期六就今天） */
  function nextSaturday() {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
    return Fmt.toDateStr(d);
  }

  async function renderCourseForm(id) {
    const d = await load(false);
    const c = id ? d.courses.find((x) => x.id === id) : { name: '', color: window.SITE.colors[d.courses.length % window.SITE.colors.length], intro: '', startTime: '', endTime: '', location: '', open: true, order: d.courses.length + 1, sessions: [] };
    if (!c) return renderMissing();
    const first = nextSaturday();
    view.innerHTML = tabs('courses') + `
      <form class="admin-form" novalidate>
        <h2 class="admin-sub">${id ? '修改班' : '新增班'}</h2>
        <fieldset class="form-block">
          <legend>班</legend>
          <label class="form-row"><span>班的名稱</span><input class="input" name="name" maxlength="30" value="${Fmt.esc(c.name)}" placeholder="例：高大班"></label>
          <div class="form-row"><span>顏色</span><div class="color-pick">${window.SITE.colors.map((k) => `<label class="color-chip c-${k}"><input type="radio" name="color" value="${k}"${k === c.color ? ' checked' : ''}><span>${window.SITE.colorNames[k]}</span></label>`).join('')}</div></div>
          <label class="form-row"><span>介紹（可以不填）</span><textarea class="input textarea" name="intro" rows="4" maxlength="1000">${Fmt.esc(c.intro)}</textarea></label>
          <div class="form-row-pair">
            <label><span>平常幾點開始</span><select class="input" name="startTime">${timeOptions(c.startTime)}</select></label>
            <label><span>幾點結束</span><select class="input" name="endTime">${timeOptions(c.endTime)}</select></label>
          </div>
          <label class="form-row"><span>平常的地點</span><input class="input" name="location" maxlength="60" value="${Fmt.esc(c.location)}"></label>
          <label class="check-row"><input type="checkbox" name="open"${c.open ? ' checked' : ''}> <span>開放（主畫面看得到、可以報名）</span></label>
          <label class="form-row"><span>主畫面的順序（數字小的在前面）</span><input class="input" name="order" inputmode="numeric" value="${Fmt.esc(c.order)}"></label>
        </fieldset>
        ${id ? '' : `
        <fieldset class="form-block">
          <legend>排課</legend>
          <label class="radio-row"><input type="radio" name="plan" value="year" checked> 隔週六上課，一次排一整年</label>
          <div class="plan-year form-row-pair">
            <label><span>第一堂</span><input class="input" type="date" name="first" value="${first}"></label>
            <label><span>排到哪一天</span><input class="input" type="date" name="until" value="${Fmt.addDays(first, 364)}"></label>
          </div>
          <label class="radio-row"><input type="radio" name="plan" value="one"> 只有一堂（臨時活動）</label>
          <label class="form-row plan-one" hidden><span>日期</span><input class="input" type="date" name="date" value="${first}"></label>
          <label class="radio-row"><input type="radio" name="plan" value="none"> 先不排，之後再加</label>
          <p class="hint">時間、地點會用上面「平常」的；排好以後每一堂都可以再改主題、講師、日期，或標停課。</p>
        </fieldset>`}
        <p class="form-error" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">${id ? '儲存' : '新增'}</button>
        ${id ? '<button type="button" class="btn btn-block btn-quiet-danger" data-act="delete">刪除這個班</button>' : ''}
        <a class="btn btn-block back-btn" href="${id ? `#/admin/course/${encodeURIComponent(id)}` : '#/admin'}">取消</a>
      </form>`;
    bindCommon();
    const form = view.querySelector('form');
    const errBox = form.querySelector('.form-error');
    if (!id) form.addEventListener('change', () => {
      form.querySelector('.plan-year').hidden = form.plan.value !== 'year';
      form.querySelector('.plan-one').hidden = form.plan.value !== 'one';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const course = {
        name: form.name.value.trim(), color: form.color.value, intro: form.intro.value.trim(),
        startTime: form.startTime.value, endTime: form.endTime.value, location: form.location.value.trim(),
        open: form.open.checked, order: form.order.value.trim() || 0
      };
      if (id) course.id = id;
      const errs = [];
      if (!course.name) errs.push('請填班的名稱');
      if (course.endTime && !course.startTime) errs.push('有結束時間就要選開始時間');
      let plan = null;
      if (!id && form.plan.value === 'year') {
        if (!form.first.value) errs.push('請選第一堂的日期');
        plan = { first: form.first.value, until: form.until.value };
      }
      if (!id && form.plan.value === 'one') {
        if (!form.date.value) errs.push('請選日期');
        plan = { dates: [form.date.value] };
      }
      if (errs.length) { errBox.textContent = errs.join('；'); errBox.hidden = false; return; }
      busy(true, '儲存中⋯');
      try {
        const res = await Api.admin('adminCourseSave', { course, plan });
        busy(false);
        HomePage.refresh();
        data = null;
        location.hash = '#/admin/course/' + encodeURIComponent(res.course.id);
      } catch (err) {
        busy(false);
        if (err.code === 'UNAUTHORIZED' && /登入/.test(err.message)) return renderLogin(err.message);
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });
    const del = form.querySelector('[data-act="delete"]');
    if (del) del.addEventListener('click', async () => {
      const n = c.sessions.reduce((a, s) => a + s.count, 0);
      if (!window.confirm(`確定要刪除「${c.name}」嗎？\n${c.sessions.length} 堂課、${n} 筆報名和點名紀錄會一起刪掉，不能還原。\n只是這期結束的話，也可以取消勾選「開放」就好。`)) return;
      busy(true, '刪除中⋯');
      try { await Api.admin('adminCourseDelete', { id }); busy(false); HomePage.refresh(); data = null; location.hash = '#/admin'; } catch (err) { busy(false); handleError(err); }
    });
  }

  function renderMissing() {
    view.innerHTML = tabs('') + '<div class="notice notice-error"><p>找不到，可能已經刪除了。</p></div><a class="btn" href="#/admin">回班與課程</a>';
    bindCommon();
  }

  async function renderCourse(id) {
    view.innerHTML = tabs('courses') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const d = await load(true);
    const c = d.courses.find((x) => x.id === id);
    if (!c) return renderMissing();
    const last = c.sessions.length ? c.sessions[c.sessions.length - 1].date : '';
    const first = last ? Fmt.addDays(last, 14) : nextSaturday();
    view.innerHTML = tabs('courses') + `
      <div class="page-head c-${Fmt.esc(c.color)}"><h1>${Fmt.esc(c.name)}</h1><p>${Fmt.esc([Fmt.timeRange(c), c.location].filter(Boolean).join('・'))}${c.open ? '' : '・收起來（主畫面看不到）'}</p></div>
      <div class="admin-actions">
        <a class="btn btn-small" href="#/admin/course/${encodeURIComponent(c.id)}/edit">修改班</a>
        <a class="btn btn-small" href="#/admin/session/new/${encodeURIComponent(c.id)}">＋ 加一堂</a>
        <a class="btn btn-small" href="#/admin/attendance/${encodeURIComponent(c.id)}">出席紀錄</a>
      </div>
      <p class="hint">點一堂可以改主題、講師、日期，或標停課。</p>
      <div class="session-list">${c.sessions.map((s) => `
        <a class="session-row${s.cancelled ? ' is-off' : s.date < d.today ? ' is-past' : ''}" href="#/admin/session/${encodeURIComponent(s.id)}">
          <span class="session-date">${Fmt.esc(Fmt.shortDate(s.date))}<small>${s.cancelled ? '停課' : `第 ${s.no} 堂`}</small></span>
          <span class="session-main">${s.topic ? `<strong>${Fmt.esc(s.topic)}</strong>` : '<span class="muted">主題還沒排</span>'}${s.teacher ? `<small>講師：${Fmt.esc(s.teacher)}</small>` : ''}</span>
          <span class="session-side">${s.cancelled ? '' : `${s.count} 人`}<small class="muted">修改 ›</small></span>
        </a>`).join('') || '<p class="panel-empty">還沒有課</p>'}</div>
      <form class="admin-form make-form" novalidate>
        <fieldset class="form-block">
          <legend>再排一段（隔週六）</legend>
          <div class="form-row-pair">
            <label><span>從哪一天</span><input class="input" type="date" name="first" value="${first}"></label>
            <label><span>排到哪一天</span><input class="input" type="date" name="until" value="${Fmt.addDays(first, 364)}"></label>
          </div>
          <p class="form-error" hidden></p>
          <button type="submit" class="btn">排課</button>
        </fieldset>
      </form>
      <a class="btn btn-block back-btn" href="#/admin">‹ 回班與課程</a>`;
    bindCommon();
    const form = view.querySelector('.make-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = form.querySelector('.form-error');
      busy(true, '排課中⋯');
      try {
        const res = await Api.admin('adminSessionsMake', { courseId: c.id, plan: { first: form.first.value, until: form.until.value } });
        busy(false);
        HomePage.refresh();
        await renderCourse(id);
        if (!res.made) window.alert('這段日期的課都已經有了');
      } catch (err) {
        busy(false);
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });
  }

  async function renderSessionForm(id, courseId) {
    await load(false);
    let c;
    let s;
    if (id) {
      let f = findSession(id);
      if (!f) { await load(true); f = findSession(id); }
      if (!f) return renderMissing();
      c = f.c; s = f.s;
    } else {
      c = data.courses.find((x) => x.id === courseId);
      if (!c) return renderMissing();
      const last = c.sessions.length ? c.sessions[c.sessions.length - 1].date : '';
      s = { date: last ? Fmt.addDays(last, 14) : nextSaturday(), startTime: c.startTime, endTime: c.endTime, location: c.location, topic: '', teacher: '', content: '', setDeadline: '', cap: null, cancelled: false, count: 0 };
    }
    view.innerHTML = tabs('courses') + `
      <form class="admin-form" novalidate>
        <h2 class="admin-sub"><span class="course-tag c-${Fmt.esc(c.color)}">${Fmt.esc(c.name)}</span> ${id ? (s.cancelled ? '停課的這一堂' : `第 ${s.no} 堂`) : '加一堂'}</h2>
        <fieldset class="form-block">
          <legend>時間地點</legend>
          <label class="form-row"><span>日期</span><input class="input" type="date" name="date" value="${Fmt.esc(s.date)}"></label>
          <div class="form-row-pair">
            <label><span>開始時間</span><select class="input" name="startTime">${timeOptions(s.startTime)}</select></label>
            <label><span>結束時間</span><select class="input" name="endTime">${timeOptions(s.endTime)}</select></label>
          </div>
          <label class="form-row"><span>地點</span><input class="input" name="location" maxlength="60" value="${Fmt.esc(s.location)}"></label>
        </fieldset>
        <fieldset class="form-block">
          <legend>上什麼</legend>
          <label class="form-row"><span>主題</span><input class="input" name="topic" maxlength="60" value="${Fmt.esc(s.topic)}"></label>
          <label class="form-row"><span>講師</span><input class="input" name="teacher" maxlength="40" value="${Fmt.esc(s.teacher)}"></label>
          <label class="form-row"><span>課程內容（可以不填）</span><textarea class="input textarea" name="content" rows="4" maxlength="1000">${Fmt.esc(s.content)}</textarea></label>
        </fieldset>
        <fieldset class="form-block">
          <legend>報名</legend>
          <div class="form-row-pair">
            <label><span>報名截止（不填＝上課前一天）</span><input class="input" type="date" name="deadline" value="${Fmt.esc(s.setDeadline || '')}"></label>
            <label><span>名額（不填＝不限）</span><input class="input" name="cap" inputmode="numeric" value="${s.cap === null || s.cap === undefined ? '' : s.cap}"></label>
          </div>
          <label class="check-row"><input type="checkbox" name="cancelled"${s.cancelled ? ' checked' : ''}> <span>這堂停課（主畫面寫停課、不能報名）</span></label>
        </fieldset>
        <p class="form-error" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">${id ? '儲存' : '加這一堂'}</button>
        ${id ? `<a class="btn btn-block" href="#/s/${encodeURIComponent(id)}">看報名頁（${s.count} 人）</a>${s.cancelled ? '' : `<a class="btn btn-block" href="#/admin/roll/${encodeURIComponent(id)}">✅ 點名</a>`}
        <button type="button" class="btn btn-block btn-quiet-danger" data-act="delete">刪除這一堂</button>` : ''}
        <a class="btn btn-block back-btn" href="#/admin/course/${encodeURIComponent(c.id)}">取消</a>
      </form>`;
    bindCommon();
    const form = view.querySelector('form');
    const errBox = form.querySelector('.form-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const session = {
        courseId: c.id, date: form.date.value, startTime: form.startTime.value, endTime: form.endTime.value, location: form.location.value.trim(),
        topic: form.topic.value.trim(), teacher: form.teacher.value.trim(), content: form.content.value.trim(),
        deadline: form.deadline.value, cap: form.cap.value.trim(), cancelled: form.cancelled.checked
      };
      if (id) session.id = id;
      if (!session.date) { errBox.textContent = '請選日期'; errBox.hidden = false; return; }
      busy(true, '儲存中⋯');
      try {
        await Api.admin('adminSessionSave', { session });
        busy(false);
        HomePage.refresh();
        data = null;
        location.hash = '#/admin/course/' + encodeURIComponent(c.id);
      } catch (err) {
        busy(false);
        if (err.code === 'UNAUTHORIZED' && /登入/.test(err.message)) return renderLogin(err.message);
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });
    const del = form.querySelector('[data-act="delete"]');
    if (del) del.addEventListener('click', async () => {
      if (!window.confirm(`確定要刪除 ${Fmt.shortDate(s.date)} 這一堂嗎？${s.count ? `\n${s.count} 筆報名和點名會一起刪掉。` : ''}\n不上課的話，也可以勾「這堂停課」就好。`)) return;
      busy(true, '刪除中⋯');
      try { await Api.admin('adminSessionDelete', { id }); busy(false); HomePage.refresh(); data = null; location.hash = '#/admin/course/' + encodeURIComponent(c.id); } catch (err) { busy(false); handleError(err); }
    });
  }

  // ---------- 點名（點名帳號、總管理者） ----------

  async function renderRollPick() {
    view.innerHTML = tabs('roll') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const d = await load(true);
    const from = Fmt.addDays(d.today, -21);
    const to = Fmt.addDays(d.today, 21);
    const rows = d.courses.flatMap((c) => c.sessions.filter((s) => !s.cancelled && s.date >= from && s.date <= to).map((s) => ({ c, s })))
      .sort((x, y) => x.s.date.localeCompare(y.s.date) || (x.s.startTime || '').localeCompare(y.s.startTime || ''));
    view.innerHTML = tabs('roll') + `
      <p class="hint">選要點名的那一堂（前後三週）。</p>
      <div class="session-list">${rows.length ? rows.map(({ c, s }) => `
        <a class="session-row${s.date === d.today ? ' is-today' : s.date < d.today ? ' is-past' : ''}" href="#/admin/roll/${encodeURIComponent(s.id)}">
          <span class="session-date">${s.date === d.today ? '今天' : Fmt.esc(Fmt.shortDate(s.date))}<small>第 ${s.no} 堂</small></span>
          <span class="session-main"><span class="course-tag c-${Fmt.esc(c.color)}">${Fmt.esc(c.name)}</span>${s.topic ? `<strong>${Fmt.esc(s.topic)}</strong>` : ''}</span>
          <span class="session-side">${s.count} 人報名</span>
        </a>`).join('') : '<p class="panel-empty">前後三週沒有課</p>'}</div>
      <h2 class="admin-sub">出席紀錄</h2>
      <div class="admin-actions">${d.courses.map((c) => `<a class="btn btn-small" href="#/admin/attendance/${encodeURIComponent(c.id)}"><span class="course-tag c-${Fmt.esc(c.color)}">${Fmt.esc(c.name)}</span></a>`).join('') || '<span class="muted">還沒有班</span>'}</div>`;
    bindCommon();
  }

  async function renderRoll(sid) {
    view.innerHTML = tabs('roll') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const r = await Api.admin('adminRoll', { sessionId: sid });
    const s = r.session;
    const c = r.course;
    const list = r.signups;
    const stats = () => {
      const n = (k) => list.filter((x) => x.roll === k).length;
      return `報名 <b>${list.length}</b>・到 <b>${n('到')}</b>・請假 <b>${n('請假')}</b>・缺席 <b>${n('缺席')}</b>・還沒點 <b>${n('')}</b>`;
    };
    const by = {};
    list.forEach((x) => { (by[x.unit] ||= []).push(x); });
    view.innerHTML = tabs('roll') + `
      <div class="page-head c-${Fmt.esc(c.color)}"><h1>${Fmt.esc(c.name)}${s.no ? `・第 ${s.no} 堂` : ''}</h1><p>${Fmt.esc([Fmt.shortDate(s.date), Fmt.timeRange(s), s.topic].filter(Boolean).join('・'))}</p></div>
      <p class="roll-stats" aria-live="polite">${stats()}</p>
      ${window.SITE.units.filter((u) => by[u]).map((u) => `
        <div class="roll-group">
          <p class="unit-group-head"><span class="unit-tag">${Fmt.esc(u)}</span><span class="muted">${by[u].length} 人</span></p>
          ${by[u].map((x) => `
            <div class="roll-row" data-id="${Fmt.esc(x.id)}">
              <span class="roll-name">${Fmt.esc(x.name)}${x.by === 'walkin' ? '<small>現場加</small>' : ''}</span>
              <span class="roll-btns">${['到', '請假', '缺席'].map((k) => `<button type="button" class="roll-btn roll-${k}${x.roll === k ? ' is-on' : ''}" data-status="${k}" aria-pressed="${x.roll === k}">${k}</button>`).join('')}</span>
            </div>`).join('')}
        </div>`).join('') || '<p class="panel-empty">這堂還沒有人報名</p>'}
      <form class="admin-form walkin-form" novalidate>
        <fieldset class="form-block">
          <legend>＋ 沒報名但來了</legend>
          <label class="form-row"><span>姓名（好幾個人中間空一格）</span><input class="input" name="names"></label>
          <label class="form-row"><span>區</span><select class="input" name="unit">${Fmt.unitOptions('', '請選擇區')}</select></label>
          <p class="form-error" hidden></p>
          <button type="submit" class="btn">加進來（記「到」）</button>
        </fieldset>
      </form>
      <a class="btn btn-block back-btn" href="#/admin/roll">‹ 選別堂</a>`;
    bindCommon();
    view.querySelectorAll('.roll-row').forEach((row) => row.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      const x = list.find((y) => y.id === row.dataset.id);
      const status = x.roll === b.dataset.status ? '' : b.dataset.status; // 再按一次同一個＝取消
      const before = x.roll;
      const paint = () => {
        row.querySelectorAll('[data-status]').forEach((k) => { const on = k.dataset.status === x.roll; k.classList.toggle('is-on', on); k.setAttribute('aria-pressed', String(on)); });
        view.querySelector('.roll-stats').innerHTML = stats();
      };
      x.roll = status;
      paint();
      try { await Api.admin('adminRollSet', { id: x.id, status }); } catch (err) {
        x.roll = before;
        paint();
        if (err.code === 'UNAUTHORIZED' && /登入/.test(err.message)) return renderLogin(err.message);
        window.alert(err.message);
      }
    }));
    const form = view.querySelector('.walkin-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = form.querySelector('.form-error');
      if (!form.names.value.trim() || !form.unit.value) { errBox.textContent = '請填姓名、選區'; errBox.hidden = false; return; }
      busy(true, '加入中⋯');
      try {
        await Api.admin('adminRollAdd', { sessionId: sid, names: form.names.value, unit: form.unit.value });
        busy(false);
        HomePage.refresh();
        renderRoll(sid);
      } catch (err) {
        busy(false);
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });
  }

  async function renderAttendance(cid) {
    view.innerHTML = tabs('roll') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const r = await Api.admin('adminAttendance', { courseId: cid });
    view.innerHTML = tabs('roll') + `
      <div class="page-head c-${Fmt.esc(r.course.color)}"><h1>${Fmt.esc(r.course.name)}・出席紀錄</h1><p>共 ${r.sessions.length} 堂（不算停課）、${r.people.length} 人</p></div>
      <div class="admin-actions"><button type="button" class="btn btn-small" data-act="csv">⬇ 下載（Excel 可以開）</button></div>
      <div class="table-wrap"><table class="admin-table">
        <thead><tr><th>區</th><th>姓名</th><th>報名</th><th>到</th><th>請假</th><th>缺席</th></tr></thead>
        <tbody>${r.people.map((p) => `<tr><td>${Fmt.esc(p.unit)}</td><td>${Fmt.esc(p.name)}</td><td class="num">${p.signups}</td><td class="num">${p.到}</td><td class="num">${p.請假}</td><td class="num">${p.缺席}</td></tr>`).join('') || '<tr><td colspan="6" class="panel-empty">還沒有報名紀錄</td></tr>'}</tbody>
      </table></div>
      <a class="btn btn-block back-btn" href="#/admin/roll">‹ 回點名</a>`;
    bindCommon();
    view.querySelector('[data-act="csv"]').addEventListener('click', () => {
      const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const head = ['區', '姓名', '報名', '到', '請假', '缺席'].concat(r.sessions.map((s) => `${Fmt.md(s.date)} 第${s.no}堂`));
      const lines = [head].concat(r.people.map((p) => [p.unit, p.name, p.signups, p.到, p.請假, p.缺席].concat(r.sessions.map((s) => p.rolls[s.id] || ''))));
      const blob = new Blob(['﻿' + lines.map((l) => l.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${r.course.name}-出席紀錄.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
  }

  // ---------- 帳號 ----------

  async function renderAccounts() {
    view.innerHTML = tabs('accounts') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const d = await Api.admin('adminAccounts');
    const label = (n) => (n === window.SITE.roll ? '點名（幹部共用）' : n + '組長');
    view.innerHTML = tabs('accounts') + `
      <p class="hint">「點名」是幹部共用的一組密碼，只能點名、看出席紀錄。各區組長可以幫自己區的人報名、取消。密碼至少 6 個字；改密碼後，已經登入的會被登出。</p>
      <ul class="admin-list">${d.accounts.map((a) => `
        <li class="admin-row">
          <div class="admin-row-main"><strong>${Fmt.esc(label(a.name))}</strong><span class="card-meta">${a.hasPassword ? '已設密碼' : '還沒有帳號'}</span></div>
          <div class="admin-row-actions">
            <button type="button" class="btn btn-small" data-edit="${Fmt.esc(a.name)}">${a.hasPassword ? '改密碼' : '設密碼'}</button>
            ${a.hasPassword ? `<button type="button" class="btn btn-small btn-quiet-danger" data-remove="${Fmt.esc(a.name)}">刪除帳號</button>` : ''}
          </div>
          <form class="region-form" data-form="${Fmt.esc(a.name)}" hidden>
            <label class="form-row"><span>${Fmt.esc(label(a.name))}的密碼（至少 6 個字）</span><input class="input" type="password" name="password" autocomplete="new-password" minlength="6"></label>
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
      if (!window.confirm(`確定要刪除「${label(b.dataset.remove)}」的帳號？刪除後就不能再登入。`)) return;
      busy(true, '刪除中⋯');
      try { await Api.admin('adminSetAccount', { name: b.dataset.remove, remove: true }); busy(false); renderAccounts(); } catch (err) { busy(false); handleError(err); }
    }));
    view.querySelectorAll('.region-form').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = f.querySelector('.form-error');
      busy(true, '儲存中⋯');
      try {
        await Api.admin('adminSetAccount', { name: f.dataset.form, password: f.password.value });
        busy(false);
        renderAccounts();
      } catch (x) {
        busy(false);
        if (x.code === 'UNAUTHORIZED' && /登入/.test(x.message)) return renderLogin(x.message);
        err.textContent = x.message;
        err.hidden = false;
      }
    }));
  }

  // ---------- 發通知（手機提醒，規格第 10 節） ----------

  const pad = (n) => String(n).padStart(2, '0');
  function localInput(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function stampOf(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const unitName = (u) => (u === window.SITE.fentan ? '不分區' : u);
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
      <p class="hint">只會送到有開啟「🔔 手機提醒」的手機。目前共 <strong>${total}</strong> 支${opened ? '：' + opened : '，還沒有人開啟'}。每天早上 7 點、晚上 8 點的上課提醒是自動送的，不用在這裡發。</p>
      <form class="admin-form" novalidate>
        <fieldset class="form-block">
          <legend>內容</legend>
          <label class="form-row"><span>標題（最多 40 字）</span><input class="input" name="title" maxlength="40" placeholder="例：高大班改地點"></label>
          <label class="form-row"><span>內容（最多 200 字）</span><textarea class="input textarea" name="body" rows="3" maxlength="200" placeholder="例：這週六的高大班改在分壇教室，時間不變 🙏"></textarea></label>
        </fieldset>
        <fieldset class="form-block">
          <legend>發給誰</legend>
          <label class="radio-row"><input type="radio" name="who" value="all" checked> 全部（${total} 支）</label>
          <label class="radio-row"><input type="radio" name="who" value="pick"> 選區</label>
          <div class="push-units" hidden>${units.map((u) => `<label class="check-chip"><input type="checkbox" name="unit" value="${Fmt.esc(u)}"> ${Fmt.esc(unitName(u))}<small>${counts[u] || 0}</small></label>`).join('')}</div>
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
      <h2 class="admin-sub">最近發的通知</h2>
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
      if (target !== 'all' && !target.length) errs.push('請勾選要發給哪些區');
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
        if (err.code === 'UNAUTHORIZED' && /登入/.test(err.message)) return renderLogin(err.message);
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
      try { await Api.admin('adminPushCancel', { id: b.dataset.cancel }); busy(false); renderPush(); } catch (err) { busy(false); handleError(err); }
    }));
  }

  // ---------- 操作紀錄 ----------

  async function renderLog() {
    view.innerHTML = tabs('log') + '<p class="panel-empty">載入中⋯</p>';
    bindCommon();
    const d = await Api.admin('adminLog');
    const when = (l) => (!l.start ? '' : `（${l.start === l.end || !l.end ? Fmt.shortDate(l.start) : Fmt.shortDate(l.start) + ' – ' + Fmt.shortDate(l.end)}）`);
    const rows = d.log.map((l) => `
      <li class="log-item">
        <div class="log-head"><strong>${Fmt.esc(l.action)}</strong><span class="muted">${Fmt.esc(l.time)}</span></div>
        <div>${Fmt.esc(l.unit || '')}${l.unit ? '・' : ''}${Fmt.esc(l.name || '')}${Fmt.esc(when(l))}</div>
      </li>`).join('');
    view.innerHTML = tabs('log') + (rows ? `<p class="muted">最近 ${d.log.length} 筆</p><ul class="log-list">${rows}</ul>` : '<p class="panel-empty">還沒有操作紀錄</p>');
    bindCommon();
  }

  window.AdminPage = { show };
})();
