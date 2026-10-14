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

  const today = () => Fmt.toDateStr(new Date());

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
        ${row('服裝', Fmt.esc(ev.dress))}
        ${row('截止', ev.deadline ? `${Fmt.esc(Fmt.shortDate(ev.deadline))}${today() > ev.deadline ? '　<span class="muted">已截止</span>' : ''}` : '')}
      </dl>
      ${ev.note ? `<section class="detail-section"><h2>說明</h2><p class="detail-desc">${Fmt.esc(ev.note).replace(/\n/g, '<br>')}</p></section>` : ''}
      ${ev.signup ? attendHtml(ev) : ''}
      ${hasLinks ? foldHtml(ev, date) : ''}
      ${ev.link ? `<div class="detail-actions"><a class="btn btn-block btn-go" href="${Fmt.esc(ev.link)}" target="_blank" rel="noopener">打開相關連結 ↗</a></div>` : ''}
      <a class="btn btn-block back-btn" href="#/">‹ 回行事曆</a>`;
  }

  /** 出席名單表（規格第 9-6 節）：上面一區一行（併區合成一行），下面是分工，最後合計、備註。回傳 { rows, duty, total, title } */
  function sheetOf(ev, date) {
    const rows = window.SITE.attendRows.map(([label, units]) => {
      const d = Object.assign({ names: [], escort: [], traffic: [], note: '' }, (ev.attend || {})[label] || {});
      const text = [d.names.join('、'), d.escort.length ? '陪班：' + d.escort.join('、') : '', d.traffic.length ? '交通：' + d.traffic.join('、') : '', d.note].filter(Boolean).join('，');
      return { label, units, text, n: d.names.length + d.escort.length + d.traffic.length };
    });
    const duties = ev.duties || [];
    const works = (window.SITE.works || []).slice(); // 照長青班出席名單的順序
    duties.forEach((d) => { if (works.indexOf(d.work) === -1) works.push(d.work); });
    const duty = works.map((w) => {
      const mine = duties.filter((d) => d.work === w);
      const text = mine.map((d) => [Fmt.dutyText(Fmt.normPicks(d.picks), true), d.text || ''].filter(Boolean).join('，')).join('；');
      const ids = mine.map((d) => d.id);
      const n = (ev.links || []).filter((l) => ids.indexOf(l.dutyId) !== -1).reduce((s, l) => s + ((l.counts || {})[date] || 0), 0);
      return { label: w, text, n };
    });
    const total = rows.concat(duty).reduce((s, r) => s + r.n, 0);
    const ymd = date.split('-');
    const title = `${Number(ymd[0]) - 1911}/${ymd[1]}/${ymd[2]} ${ev.name}出席名單`;
    return { rows, duty, total, title };
  }

  function sheetText(ev, date) {
    const s = sheetOf(ev, date);
    const line = (r) => `${r.label}：${r.text}${r.n ? `（${r.n}）` : ''}`;
    return [s.title, ...s.rows.map(line), '', ...s.duty.map(line), '', `合計 ${s.total} 人`].concat(ev.note ? ['', ev.note] : []).join('\n');
  }

  function attendHtml(ev) {
    const date = ev.start;
    const s = sheetOf(ev, date);
    const closed = ev.deadline && today() > ev.deadline;
    const tr = (r, fill) => `<tr><th scope="row">${Fmt.esc(r.label)}</th><td>${fill && !closed ? `<div class="sheet-cell"><span>${r.text ? Fmt.esc(r.text) : '<span class="muted">—</span>'}</span><a class="btn btn-small sheet-fill" href="#/admin/fill/${encodeURIComponent(r.units[0])}/${encodeURIComponent(ev.id)}" aria-label="${Fmt.esc(r.label)}報名">報名</a></div>` : r.text ? Fmt.esc(r.text) : '<span class="muted">—</span>'}</td><td class="num">${r.n || ''}</td></tr>`;
    return `
      <section class="detail-section sheet">
        <h2>出席名單<span class="h2-sub">共 ${s.total} 人</span></h2>
        <div class="sheet-wrap"><table class="sheet-table">
          <caption>${Fmt.esc(s.title)}</caption>
          <tbody>${s.rows.map((r) => tr(r, true)).join('')}</tbody>
          <tbody class="sheet-duty">${s.duty.map((r) => tr(r, false)).join('')}</tbody>
          <tfoot><tr><th scope="row">合計</th><td></td><td class="num">${s.total}</td></tr></tfoot>
        </table></div>
        ${ev.note ? `<p class="sheet-note">${Fmt.esc(ev.note).replace(/\n/g, '<br>')}</p>` : ''}
        <div class="sheet-actions"><button type="button" class="btn" data-act="copy-sheet">📋 複製文字（貼到 LINE）</button><span class="muted" data-copied></span></div>
        <p class="hint">${closed ? '名單已截止。' : '各區組長按自己那一行的「報名」填出席、陪班、交通名單。'}</p>
      </section>`;
  }

  /** 已分配給各區的名單：先收起來（一行寫派了幾區、填了幾人），要看、要填再打開 */
  function foldHtml(ev, date) {
    const links = linksOn(ev, date);
    const units = [...new Set(links.flatMap((l) => (l.units && l.units.length ? l.units : [l.unit])))];
    const filled = links.reduce((n, l) => n + ((l.counts || {})[date] || 0), 0);
    return `<section class="detail-section">
        <details class="linked-fold">
          <summary><span class="fold-title">已分配區的名單<span class="h2-sub">${Fmt.esc(Fmt.shortDate(date))}</span></span>
            <span class="fold-sub">${units.length} 區・已填 ${filled} 人：${Fmt.esc(units.join('、'))}</span></summary>
          ${linkedHtml(ev, date)}
        </details>
      </section>`;
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
            <span><span class="unit-tag">${Fmt.esc(l.units && l.units.length > 1 || l.group ? l.group || l.units.join('、') : l.unit)}</span> <strong>${Fmt.esc(l.name)}</strong></span>
            ${total ? `<span class="badge badge-ok">已填 ${total} 人</span>` : '<span class="badge badge-full">還沒填名單</span>'}
          </div>
          ${l.dress || (l.deadline && l.deadline !== ev.deadline) ? `<p class="card-meta">${Fmt.esc([l.dress ? '服裝：' + l.dress : '', l.deadline && l.deadline !== ev.deadline ? Fmt.shortDate(l.deadline) + ' 截止' : ''].filter(Boolean).join('・'))}</p>` : ''}
          <ul class="roster">${rows}</ul>
          ${l.deadline && today() > l.deadline ? '<p class="hint">名單已截止</p>' : `<a class="btn btn-small fill-btn" href="#/admin/fill/${encodeURIComponent(l.unit)}/${encodeURIComponent(l.id)}">✏️ 填寫名單</a>`}
        </article>`;
    }).join('') + '<p class="hint">名單由各區組長在分壇行事曆填寫。</p>';
  }

  async function show(view, id, date) {
    const t = ++token;
    const render = (ev) => {
      const d = date && date >= ev.start && date <= ev.end ? date : ev.start;
      view.innerHTML = html(ev, d);
      view.onclick = async (e) => {
        const b = e.target.closest('[data-act="copy-sheet"]');
        if (!b) return;
        const text = sheetText(ev, ev.start);
        const msg = view.querySelector('[data-copied]');
        try { await navigator.clipboard.writeText(text); msg.textContent = '已複製，可以貼到 LINE'; } catch (x) {
          window.prompt('請長按全選、複製：', text);
        }
      };
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
