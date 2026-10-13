// 行事曆首頁（沿用教全區的看法）：年／月檢視用 FullCalendar，週、近期是自製的直向列表。
// 格子顯示國曆、農曆與色點（顏色依類別；分壇的活動外面多一圈金框）；點日期在下方列出當天活動卡片。
// 上方的單位篩選：分壇（預設，只看分壇的）／某一區；選某一區時可以勾「也顯示分壇的活動」。沒有「全部」。
(function () {
  'use strict';

  const FC_VIEWS = { year: 'multiMonthYear', month: 'dayGridMonth' };
  const KEY = 'fentan-calendar:';
  const DOTS_MAX = { year: 3, month: 4 };
  const RECENT_DAYS = 31; // 近期＝今天起一個月

  const el = {};
  const state = {
    view: 'month',
    anchor: Fmt.toDateStr(new Date()),
    selected: null,
    today: Fmt.toDateStr(new Date()),
    range: null, // { from, to } 目前畫面上的資料區間
    loading: true, // 載入中不顯示舊區間的資料，避免誤判「沒有活動」
    pendingScroll: null, // 年檢視載入完成後要捲到的月份
    showPast: false, // 年檢視是否顯示今年已過的月份（每次開啟預設收起）
    unit: readKey('unit', window.SITE.fentan), // 分壇／某一區
    withFentan: readKey('with-fentan', '1') !== '0' // 選某一區時，也顯示分壇的活動
  };
  const windows = new Map(); // 年份 → { data, fresh, promise }
  const dayMap = new Map(); // 'yyyy-MM-dd' → [event]
  const cells = new Map(); // 'yyyy-MM-dd' → Set<HTMLElement>
  let calendar = null;
  let loadToken = 0;

  function readKey(k, dflt) {
    try { const v = localStorage.getItem(KEY + k); return v === null ? dflt : v; } catch (e) { return dflt; }
  }
  function writeKey(k, v) {
    try { localStorage.setItem(KEY + k, v); } catch (e) { /* 無痕模式：不記住 */ }
  }

  function init() {
    el.fc = document.getElementById('fc');
    el.week = document.getElementById('week');
    el.title = document.getElementById('cal-title');
    el.status = document.getElementById('cal-status');
    el.source = document.getElementById('source-status');
    el.panel = document.getElementById('day-panel');
    el.tabs = Array.from(document.querySelectorAll('[data-view]'));
    el.pastToggle = document.getElementById('past-toggle');
    el.nav = ['cal-prev', 'cal-next', 'cal-today'].map((id) => document.getElementById(id));
    el.unit = document.getElementById('unit-filter');
    el.withFentan = document.getElementById('with-fentan');
    el.withFentanBox = document.getElementById('with-fentan-box');

    state.view = loadSavedView();
    initUnitFilter();

    calendar = new FullCalendar.Calendar(el.fc, {
      locale: 'zh-tw',
      firstDay: 0,
      headerToolbar: false,
      height: 'auto',
      fixedWeekCount: false,
      initialView: FC_VIEWS[state.view] || FC_VIEWS.month,
      initialDate: state.anchor,
      multiMonthMinWidth: 260,
      multiMonthMaxColumns: 3,
      dayHeaderContent: (arg) => Fmt.weekday(Fmt.toDateStr(arg.date)),
      dayCellContent: cellContent,
      dayCellDidMount: onCellMount,
      dayCellWillUnmount: onCellUnmount,
      dateClick: (info) => onDateClick(info.dateStr),
      datesSet: onDatesSet
    });
    calendar.render();

    el.tabs.forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    document.getElementById('cal-prev').addEventListener('click', () => move(-1));
    document.getElementById('cal-next').addEventListener('click', () => move(1));
    document.getElementById('cal-today').addEventListener('click', goToday);
    el.pastToggle.addEventListener('click', () => {
      state.showPast = !state.showPast;
      applyPastMonths();
    });

    applyView();
  }

  // ---------- 單位篩選 ----------

  function initUnitFilter() {
    const opts = [window.SITE.fentan].concat(window.SITE.units);
    if (opts.indexOf(state.unit) === -1) state.unit = window.SITE.fentan; // 以前選過「全部」的也改成分壇
    el.unit.innerHTML = opts.map((u) => `<option value="${Fmt.esc(u)}">${Fmt.esc(u === window.SITE.fentan ? '分壇的活動' : u)}</option>`).join('');
    el.unit.value = state.unit;
    el.withFentan.checked = state.withFentan;
    syncWithFentanBox();
    el.unit.addEventListener('change', () => {
      state.unit = el.unit.value;
      writeKey('unit', state.unit);
      syncWithFentanBox();
      rerender();
    });
    el.withFentan.addEventListener('change', () => {
      state.withFentan = el.withFentan.checked;
      writeKey('with-fentan', state.withFentan ? '1' : '0');
      rerender();
    });
  }

  function syncWithFentanBox() {
    el.withFentanBox.hidden = state.unit === window.SITE.fentan;
  }

  function passes(ev) {
    if (ev.unit === state.unit) return true;
    return state.unit !== window.SITE.fentan && state.withFentan && ev.unit === window.SITE.fentan;
  }

  function rerender() {
    if (state.range) load(state.range.from, state.range.to);
  }

  // ---------- 檢視切換與導覽 ----------

  function switchView(view) {
    if (view === state.view) return;
    // 月檢視選了某天後切換，以那天為準（例如切到週檢視就顯示那一週）
    if (state.view === 'month' && state.selected) state.anchor = state.selected;
    state.view = view;
    writeKey('view', view);
    applyView();
  }

  function applyView() {
    el.tabs.forEach((btn) => {
      const on = btn.dataset.view === state.view;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const isList = isListView();
    el.fc.hidden = isList;
    if (isList) el.pastToggle.hidden = true;
    el.week.hidden = !isList;
    el.panel.hidden = state.view !== 'month';
    // 近期檢視固定是今天起一個月，不需要翻頁
    el.nav.forEach((b) => { b.hidden = state.view === 'recent'; });

    if (state.view === 'recent') {
      loadRecent();
    } else if (isList) {
      loadWeek();
    } else {
      calendar.changeView(FC_VIEWS[state.view], state.anchor);
      calendar.updateSize();
      loadFcRange(); // datesSet 不一定會觸發（區間沒變時），這裡確保資料跟上
      if (state.view === 'year') state.pendingScroll = state.anchor;
    }
  }

  // ---------- 年檢視：今年已過的月份預設收起 ----------

  function pastMonthCount() {
    if (state.view !== 'year' || state.anchor.slice(0, 4) !== state.today.slice(0, 4)) return 0;
    return Number(state.today.slice(5, 7)) - 1;
  }

  function markPastMonth(month) {
    if (!month || !month.dataset.date) return;
    const key = month.dataset.date;
    const hide = !state.showPast && key.slice(0, 4) === state.today.slice(0, 4) && key < state.today.slice(0, 7);
    month.classList.toggle('is-past-month', hide);
  }

  function applyPastMonths() {
    el.fc.querySelectorAll('.fc-multimonth-month').forEach(markPastMonth);
    updatePastToggle();
  }

  function updatePastToggle() {
    const n = pastMonthCount();
    el.pastToggle.hidden = n === 0;
    if (n === 0) return;
    const range = n === 1 ? '1 月' : `1–${n} 月`;
    el.pastToggle.textContent = state.showPast ? '隱藏已過的月份' : `顯示已過的月份（${range}）`;
    el.pastToggle.setAttribute('aria-expanded', state.showPast ? 'true' : 'false');
  }

  /** 年檢視在手機上是 12 個月直向排列，切換過來時捲到目前月份 */
  function scrollToPendingMonth() {
    const dateStr = state.pendingScroll;
    state.pendingScroll = null;
    if (!dateStr || state.view !== 'year') return;
    const month = el.fc.querySelector(`.fc-multimonth-month[data-date="${dateStr.slice(0, 7)}"]`);
    if (!month) return;
    const top = month.getBoundingClientRect().top + window.scrollY - 8;
    if (top > window.innerHeight / 2) window.scrollTo({ top });
  }

  function move(step) {
    if (state.view === 'recent') return;
    if (state.view === 'week') {
      state.anchor = Fmt.addDays(state.anchor, step * 7);
      loadWeek();
    } else if (step < 0) {
      calendar.prev();
    } else {
      calendar.next();
    }
  }

  function goToday() {
    state.anchor = state.today;
    state.selected = state.today;
    if (state.view === 'recent') {
      loadRecent();
    } else if (state.view === 'week') {
      loadWeek();
    } else {
      calendar.gotoDate(state.today);
      markSelected();
      renderPanel();
    }
  }

  function isListView() {
    return state.view === 'week' || state.view === 'recent';
  }

  function onDatesSet() {
    if (isListView()) return;
    loadFcRange();
  }

  function loadFcRange() {
    const view = calendar.view;
    state.anchor = Fmt.toDateStr(calendar.getDate());
    const from = Fmt.toDateStr(view.activeStart);
    const to = Fmt.addDays(Fmt.toDateStr(view.activeEnd), -1);

    if (state.view === 'month') {
      const monthStart = Fmt.toDateStr(view.currentStart);
      const monthEnd = Fmt.addDays(Fmt.toDateStr(view.currentEnd), -1);
      const inMonth = (d) => d && d >= monthStart && d <= monthEnd;
      if (!inMonth(state.selected)) state.selected = inMonth(state.today) ? state.today : monthStart;
    }
    setTitle();
    updatePastToggle();
    load(from, to);
  }

  function weekStart(dateStr) {
    return Fmt.addDays(dateStr, -Fmt.parseDate(dateStr).getDay());
  }

  function loadWeek() {
    const from = weekStart(state.anchor);
    setTitle();
    load(from, Fmt.addDays(from, 6));
  }

  function loadRecent() {
    setTitle();
    load(state.today, Fmt.addDays(state.today, RECENT_DAYS - 1));
  }

  function setTitle() {
    const a = state.anchor;
    let text;
    if (state.view === 'year') {
      text = `${Fmt.rocYear(a)} 年`;
    } else if (state.view === 'month') {
      text = `${Fmt.rocYear(a)} 年 ${Number(a.slice(5, 7))} 月`;
    } else if (state.view === 'recent') {
      text = '近一個月的活動';
    } else {
      const from = weekStart(a);
      const to = Fmt.addDays(from, 6);
      const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
      text = `${Fmt.rocYear(from)} 年 ${md(from)} – ${md(to)}`;
    }
    el.title.textContent = text;
  }

  // ---------- 資料 ----------
  // 一次載入一整年（前後各多 7 天，涵蓋月檢視與跨年的週），之後切換檢視、翻頁都不用再等。
  // 上次的資料存在 localStorage，再次開啟時先顯示，同時在背景更新。

  function windowRange(year) {
    return { from: Fmt.addDays(`${year}-01-01`, -7), to: Fmt.addDays(`${year}-12-31`, 7) };
  }

  /** 涵蓋 from～to 的資料年份 */
  function windowYearFor(from, to) {
    const y = Number(from.slice(0, 4));
    return to <= windowRange(y).to ? y : y + 1;
  }

  function ensureWindow(year, fresh) {
    let entry = windows.get(year);
    if (!entry) {
      entry = { data: readStored(year), fresh: false, promise: null };
      windows.set(year, entry);
    }
    if (!entry.fresh && !entry.promise) {
      const r = windowRange(year);
      entry.promise = Api.getEvents(r.from, r.to, fresh).then((data) => {
        entry.data = data;
        entry.fresh = true;
        if (data.today) state.today = data.today;
        entry.promise = null;
        store(year, data);
        return data;
      }, (err) => {
        entry.promise = null;
        throw err;
      });
    }
    return entry;
  }

  async function load(from, to) {
    const token = ++loadToken;
    state.range = { from, to };
    const year = windowYearFor(from, to);
    const entry = ensureWindow(year);

    if (entry.data) {
      render(entry.data, from, to);
      if (entry.fresh) hideStatus();
      else showStatus('refreshing');
    } else {
      state.loading = true;
      showStatus('loading');
      paintAllCells();
      renderList();
    }

    if (!entry.fresh) {
      try {
        const data = await entry.promise;
        if (token !== loadToken) return;
        render(data, from, to);
        hideStatus();
      } catch (err) {
        if (token !== loadToken) return;
        if (entry.data) showStatus('error', '無法更新，目前顯示的是上次的資料');
        else showStatus('error', err.message || '無法載入行事曆資料');
      }
    }
    prefetchNeighbor(state.anchor);
  }

  function render(data, from, to) {
    indexEvents(data, from, to);
    state.loading = false;
    paintAllCells();
    renderList();
    renderSourceStatus(data);
    scrollToPendingMonth();
  }

  /** 教全區的活動讀不到時提示（只有篩選會看到教全區時才提示） */
  function renderSourceStatus(data) {
    const jq = window.SITE.jiaoquan.unit;
    const src = data.sources && data.sources[jq];
    const relevant = state.unit === jq;
    el.source.hidden = !(src && !src.ok && relevant);
    if (!el.source.hidden) el.source.textContent = `${jq}的活動暫時讀不到，稍後會自動再試（其他活動照常顯示）`;
  }

  /** 看的日期接近年底或年初時，先在背景載入相鄰年份 */
  function prefetchNeighbor(dateStr) {
    const year = Number(dateStr.slice(0, 4));
    const month = Number(dateStr.slice(5, 7));
    const next = month >= 10 ? year + 1 : month <= 2 ? year - 1 : null;
    if (next === null || (windows.get(next) && windows.get(next).fresh)) return;
    const entry = ensureWindow(next);
    if (entry.promise) entry.promise.catch(() => { /* 背景預先載入失敗無妨，用到時會再試 */ });
  }

  function readStored(year) {
    try {
      const data = JSON.parse(localStorage.getItem(KEY + 'events:' + year) || 'null');
      return data && Array.isArray(data.events) ? data : null;
    } catch (e) {
      return null;
    }
  }

  function store(year, data) {
    try {
      localStorage.setItem(KEY + 'events:' + year, JSON.stringify(data));
    } catch (e) { /* 無痕模式或空間不足，忽略 */ }
  }

  function indexEvents(data, from, to) {
    dayMap.clear();
    data.events.forEach((ev) => {
      if (!passes(ev)) return;
      const start = ev.start > from ? ev.start : from;
      const end = ev.end < to ? ev.end : to;
      Fmt.datesBetween(start, end).forEach((date) => {
        if (!dayMap.has(date)) dayMap.set(date, []);
        dayMap.get(date).push(ev);
      });
    });
    // 同一天：分壇的排前面，再依時間、名稱
    const fentan = window.SITE.fentan;
    dayMap.forEach((list) => list.sort((a, b) =>
      (a.unit === fentan ? 0 : 1) - (b.unit === fentan ? 0 : 1) ||
      (a.startTime || '').localeCompare(b.startTime || '') ||
      a.name.localeCompare(b.name, 'zh-Hant')));
  }

  /** 重新向伺服器讀取（管理者存檔後呼叫，fresh＝跳過伺服器的快取） */
  function refresh(fresh) {
    windows.forEach((entry) => { entry.fresh = false; });
    if (fresh && state.range) ensureWindow(windowYearFor(state.range.from, state.range.to), true);
    if (state.range) load(state.range.from, state.range.to);
  }

  // ---------- 格子 ----------

  function cellContent(arg) {
    const date = Fmt.toDateStr(arg.date);
    let html = `<span class="cell-num">${arg.date.getDate()}</span>`;
    if (arg.view.type === FC_VIEWS.month) {
      const lunar = LunarUtil.cellLabel(date);
      html += `<span class="cell-lunar${lunar.highlight ? ' is-hl' : ''}">${lunar.text}</span>`;
    }
    return { html };
  }

  function onCellMount(arg) {
    if (arg.view.type === FC_VIEWS.year) markPastMonth(arg.el.closest('.fc-multimonth-month'));
    if (arg.isOther && arg.view.type === FC_VIEWS.year) return;
    const date = Fmt.toDateStr(arg.date);
    if (!cells.has(date)) cells.set(date, new Set());
    cells.get(date).add(arg.el);
    paintCell(arg.el, date);
  }

  function onCellUnmount(arg) {
    const set = cells.get(Fmt.toDateStr(arg.date));
    if (set) set.delete(arg.el);
  }

  function paintAllCells() {
    cells.forEach((set, date) => set.forEach((cell) => paintCell(cell, date)));
  }

  function dotClass(ev) {
    return `dot dot-${ev.category}${ev.unit === window.SITE.fentan ? ' dot-fentan' : ''}`;
  }

  function paintCell(cell, date) {
    cell.classList.toggle('is-selected', state.view === 'month' && date === state.selected);
    cell.classList.toggle('is-past', date < state.today);
    const frame = cell.querySelector('.fc-daygrid-day-frame');
    if (!frame) return;
    const old = frame.querySelector('.cell-dots');
    if (old) old.remove();

    const items = state.loading ? [] : dayMap.get(date) || [];
    if (!items.length) {
      cell.removeAttribute('aria-label');
      return;
    }
    const max = DOTS_MAX[state.view] || 4;
    const dots = document.createElement('div');
    dots.className = 'cell-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = items.slice(0, max).map((ev) => `<i class="${dotClass(ev)}"></i>`).join('') +
      (items.length > max ? `<span class="cell-more">+${items.length - max}</span>` : '');
    frame.appendChild(dots);
    cell.setAttribute('aria-label', `${Fmt.shortDate(date)} ${items.length} 項活動`);
  }

  function markSelected() {
    cells.forEach((set, date) => set.forEach((cell) =>
      cell.classList.toggle('is-selected', state.view === 'month' && date === state.selected)));
  }

  function onDateClick(date) {
    if (state.view === 'year') {
      state.selected = date;
      state.anchor = date;
      switchView('month');
      return;
    }
    state.selected = date;
    markSelected();
    renderPanel();
    el.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- 活動卡片 ----------

  function cardHtml(ev, date, compact) {
    const meta = [Fmt.cardTime(ev, date), ev.location].filter(Boolean);
    const href = `#/event/${encodeURIComponent(ev.id)}?date=${date}`;
    return `
      <a class="ev-card cat-line-${Fmt.esc(ev.category)}${ev.unit === window.SITE.fentan ? ' is-fentan' : ''}${compact ? ' is-compact' : ''}" href="${href}">
        <span class="card-main">
          ${Fmt.tagsHtml(ev)}
          <span class="card-title">${Fmt.esc(ev.name)}</span>
          ${meta.length ? `<span class="card-meta">${meta.map(Fmt.esc).join('・')}</span>` : ''}
        </span>
        <span class="card-go" aria-hidden="true">›</span>
      </a>`;
  }

  function renderPanel() {
    if (state.view !== 'month' || !state.selected) return;
    const date = state.selected;
    const lunar = LunarUtil.lunarOf(date);
    const head = `
      <h2 class="panel-date">
        ${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日（${Fmt.weekday(date)}）
        <span class="panel-lunar">農曆${lunar.full}</span>
      </h2>`;
    let body;
    if (state.loading) {
      body = '<p class="panel-empty">載入中⋯</p>';
    } else {
      const items = dayMap.get(date) || [];
      body = items.length
        ? `<div class="card-list">${items.map((ev) => cardHtml(ev, date)).join('')}</div>`
        : '<p class="panel-empty">這天沒有活動</p>';
    }
    el.panel.innerHTML = head + body;
  }

  function renderList() {
    if (state.view === 'week') renderWeek();
    else if (state.view === 'recent') renderRecent();
    else renderPanel();
  }

  function dayRow(date, content, extraClass) {
    const lunar = LunarUtil.lunarOf(date);
    const isToday = date === state.today;
    return `
      <li class="week-day${isToday ? ' is-today' : ''}${extraClass || ''}">
        <div class="week-date">
          <span class="week-wd">${isToday ? '今天' : '週' + Fmt.weekday(date)}</span>
          <span class="week-md">${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}</span>
          <span class="week-lunar${lunar.isFirst || lunar.isFifteenth ? ' is-hl' : ''}">${lunar.full}</span>
        </div>
        <div class="week-items">${content}</div>
      </li>`;
  }

  function renderRecent() {
    if (state.loading) {
      el.week.innerHTML = '<p class="panel-empty">載入中⋯</p>';
      return;
    }
    const dates = Fmt.datesBetween(state.range.from, state.range.to).filter((d) => (dayMap.get(d) || []).length);
    if (!dates.length) {
      el.week.innerHTML = '<p class="panel-empty">近一個月沒有活動</p>';
      return;
    }
    el.week.innerHTML = `<ol class="week-list">${dates.map((date) =>
      dayRow(date, dayMap.get(date).map((ev) => cardHtml(ev, date, true)).join(''))).join('')}</ol>`;
  }

  function renderWeek() {
    const from = weekStart(state.anchor);
    el.week.innerHTML = `<ol class="week-list">${Fmt.datesBetween(from, Fmt.addDays(from, 6)).map((date) => {
      const items = dayMap.get(date) || [];
      let content;
      if (state.loading) content = '<p class="week-empty">載入中⋯</p>';
      else if (items.length) content = items.map((ev) => cardHtml(ev, date, true)).join('');
      else content = '<p class="week-empty">沒有活動</p>';
      return dayRow(date, content, date < state.today ? ' is-past' : '');
    }).join('')}</ol>`;
  }

  // ---------- 狀態列 ----------

  function showStatus(kind, message) {
    el.status.hidden = false;
    el.status.className = 'status status-' + kind;
    if (kind === 'loading') {
      el.status.innerHTML = '<span>載入中⋯</span>';
    } else if (kind === 'refreshing') {
      el.status.innerHTML = '<span>更新中⋯（先顯示上次的資料）</span>';
    } else {
      el.status.innerHTML = `<span>${Fmt.esc(message)}</span><button type="button" class="btn btn-small">重試</button>`;
      el.status.querySelector('button').addEventListener('click', () => refresh());
    }
  }

  function hideStatus() {
    el.status.hidden = true;
  }

  function loadSavedView() {
    const v = readKey('view', 'month');
    return v === 'year' || v === 'month' || v === 'week' || v === 'recent' ? v : 'month';
  }

  /** 從其他頁面回到行事曆時呼叫（隱藏時 FullCalendar 量不到尺寸） */
  function onShow() {
    if (!isListView()) calendar.updateSize();
  }

  /** 從已載入的資料找活動（詳情頁用）；找不到回傳 null */
  function findEvent(id) {
    for (const entry of windows.values()) {
      const ev = entry.data && entry.data.events.find((x) => x.id === id);
      if (ev) return ev;
    }
    return null;
  }

  /** 詳情頁直接打開（例如分享的連結）、行事曆還沒載入那一年時：載入那一年再找 */
  async function fetchEvent(id, date) {
    const found = findEvent(id);
    if (found) return found;
    const d = date || state.today;
    const entry = ensureWindow(windowYearFor(d, d));
    if (entry.promise) await entry.promise;
    return findEvent(id);
  }

  window.CalendarPage = { init, refresh, onShow, findEvent, fetchEvent, today: () => state.today, unit: () => state.unit };
})();
