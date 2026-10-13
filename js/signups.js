// 報名統計（#/signups，規格第 9-1 節）：分壇行事曆是統計端，各區在各區自己的系統報名，這裡自動彙整。
// 最上面是總數（活動數、人次、缺人項目），可依區篩選；下面依日期列出今天起 30 天的活動、狀態和名單。目前只有教全區。
(function () {
  'use strict';

  let token = 0;
  let data = null;
  let unit = '全部';

  function people(day) {
    return day.positions.reduce((n, p) => n + p.people.length, 0);
  }

  function rows() {
    const list = [];
    data.items.forEach((it) => {
      if (unit !== '全部' && it.unit !== unit) return;
      it.days.forEach((day) => list.push({ it, day }));
    });
    return list;
  }

  function render(view) {
    const list = rows();
    const units = [...new Set(data.items.map((it) => it.unit))];
    const short = list.filter((r) => r.day.status.kind === 'short');
    const total = list.reduce((n, r) => n + people(r.day), 0);
    const dates = [...new Set(list.map((r) => r.day.date))].sort();
    const order = { short: 0, full: 1, ok: 2, notice: 3 };
    const body = dates.map((date) => {
      const items = list.filter((r) => r.day.date === date)
        .sort((a, b) => order[a.day.status.kind] - order[b.day.status.kind] || (a.it.startTime || '').localeCompare(b.it.startTime || ''));
      return `
        <section class="sg-day">
          <h2 class="sg-date">${Fmt.esc(Fmt.shortDate(date))}<span class="panel-lunar">農曆${Fmt.esc(LunarUtil.lunarOf(date).full)}</span></h2>
          ${items.map(({ it, day }) => `
            <article class="sg-item kind-${Fmt.esc(day.status.kind)}">
              <a class="sg-head" href="#/event/${encodeURIComponent(it.id)}?date=${date}">
                <span class="card-main">
                  ${Fmt.tagsHtml(it)}
                  <span class="card-title">${Fmt.esc(it.name)}</span>
                  <span class="card-meta">${Fmt.esc([Fmt.cardTime(it, date), it.location].filter(Boolean).join('・'))}</span>
                </span>
                ${Fmt.statusBadge(day.status)}
              </a>
              ${it.mode === '公告型' ? '' : Fmt.rosterHtml(day)}
            </article>`).join('')}
        </section>`;
    }).join('');
    view.innerHTML = `
      <h1 class="admin-title">📊 報名統計</h1>
      <p class="hint">各區在各區自己的系統報名，這裡自動彙整今天起 30 天（${Fmt.esc(Fmt.shortDate(data.from))}–${Fmt.esc(Fmt.shortDate(data.to))}）的報名。目前只有教全區有報名系統，其他區有了之後會自動出現在這裡。</p>
      ${units.length > 1 ? `<label class="unit-pick sg-filter"><span class="unit-label">看哪一區</span><select class="input" data-f="unit">${['全部'].concat(units).map((u) => `<option${u === unit ? ' selected' : ''}>${Fmt.esc(u)}</option>`).join('')}</select></label>` : ''}
      <div class="sg-summary">
        <div><strong>${list.length}</strong><span>個活動（天）</span></div>
        <div><strong>${total}</strong><span>人次報名</span></div>
        <div class="${short.length ? 'is-short' : ''}"><strong>${short.length}</strong><span>項缺人</span></div>
      </div>
      ${short.length ? `<div class="notice notice-error"><p><strong>缺人：</strong>${short.map((r) => `${Fmt.esc(Fmt.shortDate(r.day.date))} ${Fmt.esc(r.it.unit)} ${Fmt.esc(r.it.name)}（${Fmt.esc(r.day.status.label)}）`).join('、')}</p></div>` : ''}
      ${body || '<p class="panel-empty">今天起 30 天沒有報名的活動</p>'}
      <a class="btn btn-block back-btn" href="#/">‹ 回行事曆</a>`;
    const sel = view.querySelector('[data-f="unit"]');
    if (sel) sel.addEventListener('change', () => { unit = sel.value; render(view); });
  }

  async function show(view) {
    const t = ++token;
    if (data) render(view);
    else view.innerHTML = '<h1 class="admin-title">📊 報名統計</h1><p class="panel-empty">載入中⋯</p>';
    try {
      const fresh = await Api.getSignups();
      if (t !== token) return;
      data = fresh;
      render(view);
    } catch (err) {
      if (t !== token || data) return;
      view.innerHTML = `<h1 class="admin-title">📊 報名統計</h1><div class="notice notice-error"><p>${Fmt.esc(err.message || '暫時讀不到')}</p></div><a class="btn btn-block back-btn" href="#/">‹ 回行事曆</a>`;
    }
  }

  window.SignupsPage = { show };
})();
