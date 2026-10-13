// 活動詳情（#/event/<id>?date=yyyy-MM-dd，規格第 9、9-3 節）：類別、日期（含農曆）、時間、地點、說明、相關連結，
// 下面是「各區名單」：派給各區的勤務，每一筆一段：區、名稱、那一區組長填的名單（規格第 9-4 節）。
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

  function linksOn(ev, date) {
    return (ev.links || []).filter((l) => l.start <= date && l.end >= date);
  }

  function html(ev, date) {
    const hasLinks = linksOn(ev, date).length > 0;
    return `
      <div class="detail-head">
        <span class="tags"><span class="cat-tag cat-${Fmt.esc(ev.category)}">${Fmt.esc(Fmt.catLabel(ev.category))}</span></span>
        <h1 class="detail-title">${Fmt.esc(ev.name)}</h1>
      </div>
      <dl class="detail-info">
        ${row('日期', dateText(ev, date))}
        ${row('時間', Fmt.esc(timeText(ev)))}
        ${row('地點', Fmt.esc(ev.location))}
      </dl>
      ${ev.note ? `<section class="detail-section"><h2>說明</h2><p class="detail-desc">${Fmt.esc(ev.note).replace(/\n/g, '<br>')}</p></section>` : ''}
      ${hasLinks ? `<section class="detail-section"><h2>各區名單<span class="h2-sub">${Fmt.esc(Fmt.shortDate(date))}</span></h2>${linkedHtml(ev, date)}</section>` : ''}
      ${ev.link ? `<div class="detail-actions"><a class="btn btn-block btn-go" href="${Fmt.esc(ev.link)}" target="_blank" rel="noopener">打開相關連結 ↗</a></div>` : ''}
      <a class="btn btn-block back-btn" href="#/">‹ 回行事曆</a>`;
  }

  /** 各區名單：每一筆派給區的勤務一段，名單是那一區組長填的（規格第 9-4 節） */
  function linkedHtml(ev, date) {
    return linksOn(ev, date).map((l) => {
      const fields = l.positions && l.positions.length ? l.positions : [{ id: '_', name: '名單', min: null, max: null }];
      const day = (l.roster || {})[date] || {};
      const total = fields.reduce((n, p) => n + (day[p.id] || []).length, 0);
      const rows = fields.map((p) => {
        const names = day[p.id] || [];
        const need = p.min ? `／需要 ${p.min}` : '';
        const count = names.length || p.min ? `<small class="muted">（${names.length}${need} 人）</small>` : '';
        return `<li><span class="roster-pos">${Fmt.esc(p.name)}</span>${names.length ? names.map(Fmt.esc).join('、') : '<span class="muted">還沒填</span>'}${count}</li>`;
      }).join('');
      return `
        <article class="linked-item">
          <div class="linked-head">
            <span><span class="unit-tag">${Fmt.esc(l.unit)}</span> <strong>${Fmt.esc(l.name)}</strong></span>
            ${total ? `<span class="badge badge-ok">已填 ${total} 人</span>` : '<span class="badge badge-full">還沒填名單</span>'}
          </div>
          <ul class="roster">${rows}</ul>
        </article>`;
    }).join('') + '<p class="hint">名單由各區組長在分壇行事曆填寫。</p>';
  }

  async function show(view, id, date) {
    const t = ++token;
    const render = (ev) => {
      const d = date && date >= ev.start && date <= ev.end ? date : ev.start;
      view.innerHTML = html(ev, d);
    };
    const ev = CalendarPage.findEvent(id);
    if (ev) { render(ev); return; }
    view.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    try {
      const found = await CalendarPage.fetchEvent(id, date);
      if (t !== token) return;
      if (found) { render(found); return; }
      view.innerHTML = '<div class="notice notice-error"><p>找不到這個活動，可能已經取消或改了日期。</p></div><a class="btn btn-block back-btn" href="#/">‹ 回行事曆</a>';
    } catch (err) {
      if (t !== token) return;
      view.innerHTML = `<div class="notice notice-error"><p>${Fmt.esc(err.message || '無法載入')}</p></div><a class="btn btn-block back-btn" href="#/">‹ 回行事曆</a>`;
    }
  }

  window.EventPage = { show };
})();
