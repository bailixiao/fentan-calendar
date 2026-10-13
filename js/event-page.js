// 活動詳情（#/event/<id>?date=yyyy-MM-dd）：單位、類別、日期（含農曆）、時間、地點、說明、相關連結。
// 教全區的活動有大按鈕「到教全區報名」，另開教全區的報名頁。
(function () {
  'use strict';

  let token = 0;

  function row(label, value) {
    return value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : '';
  }

  function dateText(ev, date) {
    const lunar = (d) => LunarUtil.lunarOf(d).full;
    if (ev.start === ev.end) return `${Fmt.rocDate(ev.start)}　<span class="muted">農曆${lunar(ev.start)}</span>`;
    const total = Fmt.datesBetween(ev.start, ev.end).length;
    const nth = date && date >= ev.start && date <= ev.end ? Fmt.datesBetween(ev.start, date).length : 0;
    return `${Fmt.rocDate(ev.start)} – ${Fmt.shortDate(ev.end)}，共 ${total} 天` +
      (nth ? `<br><span class="muted">${Fmt.shortDate(date)}是第 ${nth} 天</span>` : '');
  }

  function timeText(ev) {
    if (ev.start !== ev.end) {
      return [ev.startTime ? `第一天 ${ev.startTime} 開始` : '', ev.endTime ? `最後一天 ${ev.endTime} 結束` : ''].filter(Boolean).join('，');
    }
    return Fmt.timeRange(ev);
  }

  function noteHtml(text) {
    return Fmt.esc(text).replace(/\n/g, '<br>');
  }

  function html(ev, date) {
    const jq = ev.source === 'jiaoquan';
    const jqDate = date && date >= ev.start && date <= ev.end ? date : ev.start;
    const jqUrl = jq ? `${ev.link}?date=${jqDate}` : '';
    const action = jq
      ? `<a class="btn btn-primary btn-block btn-go" href="${Fmt.esc(jqUrl)}" target="_blank" rel="noopener">${ev.mode === '公告型' ? '到教全區看詳情' : '到教全區報名'} ↗</a>
         <p class="hint">報名、取消、改期都在教全區的系統裡做。</p>`
      : '';
    const link = !jq && ev.link
      ? `<a class="btn btn-block btn-go" href="${Fmt.esc(ev.link)}" target="_blank" rel="noopener">打開相關連結 ↗</a>`
      : '';
    return `
      <div class="detail-head">
        ${Fmt.tagsHtml(ev)}
        <h1 class="detail-title">${Fmt.esc(ev.name)}</h1>
      </div>
      <dl class="detail-info">
        ${row('日期', dateText(ev, date))}
        ${row('時間', Fmt.esc(timeText(ev)))}
        ${ev.status && ev.status[date] ? row('報名', Fmt.statusBadge(ev.status[date])) : ''}
        ${row('地點', Fmt.esc(ev.location))}
        ${row('服裝', Fmt.esc(ev.attire))}
        ${row('單位', Fmt.esc(ev.unit))}
      </dl>
      ${ev.note ? `<section class="detail-section"><h2>說明</h2><p class="detail-desc">${noteHtml(ev.note)}</p></section>` : ''}
      ${jq && ev.mode !== '公告型' ? '<section class="detail-section"><h2>報名名單</h2><div id="roster-box"><p class="panel-empty">載入中⋯</p></div></section>' : ''}
      <div class="detail-actions">${action}${link}</div>
      ${jq ? '<p class="hint">這筆活動是從教全區的行事曆自動讀進來的。</p>' : ''}
      <a class="btn btn-block back-btn" href="#/">‹ 回行事曆</a>`;
  }

  /** 教全區的活動：讀名單（這一天放最上面，多天的其他日子收在下面） */
  async function loadRoster(view, ev, date, t) {
    const box = view.querySelector('#roster-box');
    if (!box) return;
    try {
      const r = await Api.getRoster(ev.id);
      if (t !== token) return;
      const day = r.days.find((d) => d.date === date) || r.days[0];
      if (!day) { box.innerHTML = '<p class="panel-empty">還沒有報名資料</p>'; return; }
      const others = r.days.filter((d) => d !== day);
      const dayHead = (d) => `<p class="roster-day"><strong>${Fmt.esc(Fmt.shortDate(d.date))}</strong>${Fmt.statusBadge(d.status)}</p>`;
      box.innerHTML = dayHead(day) + Fmt.rosterHtml(day) +
        (others.length ? `<details class="roster-more"><summary>其他 ${others.length} 天的名單</summary>${others.map((d) => dayHead(d) + Fmt.rosterHtml(d)).join('')}</details>` : '') +
        '<p class="hint">名單從教全區的系統自動讀進來（約 2 分鐘更新一次）。</p>';
    } catch (err) {
      if (t !== token) return;
      box.innerHTML = `<p class="panel-empty">${Fmt.esc(err.message || '名單暫時讀不到')}</p>`;
    }
  }

  async function show(view, id, date) {
    const t = ++token;
    const ev = CalendarPage.findEvent(id);
    if (ev) {
      view.innerHTML = html(ev, date);
      loadRoster(view, ev, date, t);
      return;
    }
    view.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    try {
      const found = await CalendarPage.fetchEvent(id, date);
      if (t !== token) return;
      if (found) {
        view.innerHTML = html(found, date);
        loadRoster(view, found, date, t);
        return;
      }
      view.innerHTML = '<div class="notice notice-error"><p>找不到這個活動，可能已經取消或改了日期。</p></div><a class="btn btn-block back-btn" href="#/">‹ 回行事曆</a>';
    } catch (err) {
      if (t !== token) return;
      view.innerHTML = `<div class="notice notice-error"><p>${Fmt.esc(err.message || '無法載入')}</p></div><a class="btn btn-block back-btn" href="#/">‹ 回行事曆</a>`;
    }
  }

  window.EventPage = { show };
})();
