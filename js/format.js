// 日期、時間、標籤的顯示格式，以及共用小工具。（日期函式沿用教全區的 js/format.js）
(function () {
  'use strict';

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Date → 'yyyy-MM-dd'（用瀏覽器本地日期） */
  function toDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** 'yyyy-MM-dd' → 本地午夜的 Date */
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(s, n) {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  function datesBetween(start, end) {
    const out = [];
    for (let s = start; s <= end; s = addDays(s, 1)) out.push(s);
    return out;
  }

  function rocYear(s) {
    return Number(s.slice(0, 4)) - 1911;
  }

  function weekday(s) {
    return WEEKDAYS[parseDate(s).getDay()];
  }

  /** '2026-10-10' → '10/10（六）' */
  function shortDate(s) {
    return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}（${weekday(s)}）`;
  }

  /** '2026-10-10' → '115/10/10（六）' */
  function rocDate(s) {
    return `${rocYear(s)}/${shortDate(s)}`;
  }

  /** 類別標籤上的字：勤務寫「總務・勤務」，道務、教育照原樣 */
  function catLabel(category) {
    const labels = (window.SITE && window.SITE.categoryLabels) || {};
    return labels[category] || category || '';
  }

  /** 活動的時間文字；跨日顯示起訖日期，結束早於開始顯示「隔天」 */
  function timeRange(ev) {
    const { start, end, startTime, endTime } = ev;
    const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
    if (start !== end) {
      const a = md(start) + (startTime ? ' ' + startTime : '');
      const b = md(end) + (endTime ? ' ' + endTime : '');
      return `${a} – ${b}`;
    }
    if (startTime && endTime) {
      return endTime <= startTime ? `${startTime} – 隔天 ${endTime}` : `${startTime} – ${endTime}`;
    }
    return startTime || '';
  }

  /**
   * 卡片上某一天的時間（精簡版）。
   * 單日：同 timeRange；多天：「第 3／8 天」，第一天加「14:00 起」、最後一天加「至 14:00」。
   */
  function cardTime(ev, date) {
    if (ev.start === ev.end) return timeRange(ev);
    const total = datesBetween(ev.start, ev.end).length;
    const n = datesBetween(ev.start, date).length;
    let text = `第 ${n}／${total} 天`;
    if (date === ev.start && ev.startTime) text += ` ${ev.startTime} 起`;
    if (date === ev.end && ev.endTime) text += ` 至 ${ev.endTime}`;
    return text;
  }

  /** 單位與類別的小標籤 */
  function tagsHtml(ev) {
    const isFentan = ev.unit === window.SITE.fentan;
    return `<span class="tags"><span class="unit-tag${isFentan ? ' is-fentan' : ''}">${esc(ev.unit)}</span>` +
      `<span class="cat-tag cat-${esc(ev.category)}">${esc(catLabel(ev.category))}</span></span>`;
  }

  /** 報名狀態的小標籤（教全區的活動）：缺人紅、額滿灰、人數足綠、公告藍 */
  function statusBadge(st) {
    return st ? `<span class="badge badge-${esc(st.kind)}">${esc(st.label)}</span>` : '';
  }

  /** 一天的名單：每個了愿項目一行「打掃：王小明、測試甲」（分壇只讀名字） */
  function rosterHtml(day) {
    const rows = day.positions.map((p) => `<li><span class="roster-pos">${esc(p.name)}</span>${p.people.length
      ? p.people.map((x) => esc(x.name)).join('、')
      : '<span class="muted">還沒有人</span>'}</li>`).join('');
    return rows ? `<ul class="roster">${rows}</ul>` : '';
  }

  /** 組長填的名字拆成一個一個、去掉重複（規則同 worker/src/logic.js 的 NAME_SEP、cleanRosterNames） */
  const NAME_SEP = /[,，、;；。．.\/／・·|｜\s　]+/;
  function splitNames(text) {
    const out = [];
    String(text || '').split(NAME_SEP).forEach((n) => { if (n && out.indexOf(n) === -1) out.push(n); });
    return out;
  }

  /** 分工選的（picks）：'u:區名'＝派給一區；'t:團名:組'＝派給一組（或併區），整組一份名單 */
  function findPick(p) {
    const [, tn, gk] = String(p).split(':');
    const t = (window.SITE.teams || []).find((x) => x.name === tn);
    const g = t && t.groups.find((x) => x[0] === gk);
    return t && g ? { t, g } : null;
  }

  /**
   * 舊資料（2026-10-14 以前）按組會順便選那幾區：組在、組裡的區也都在的，那幾區是順便選的，拿掉。
   * 組在、只剩部分的區：當時是把別的區取消，照「整組」算。
   */
  function normPicks(picks) {
    const list = (picks || []).slice();
    const drop = new Set();
    list.filter((p) => p.indexOf('t:') === 0).forEach((p) => { const fg = findPick(p); if (fg) fg.g[1].forEach((u) => drop.add('u:' + u)); });
    return list.filter((p) => !drop.has(p));
  }

  /** 一組（或一區）寫成一段：組名＋（組裡的區）；併區寫「教慈/理（併區）」。short：區名寫一個字（出席名單表用） */
  function pickText(p, short) {
    const name = (u) => (short ? u.replace(/^教|區$/g, '') : u);
    if (p.indexOf('u:') === 0) return p.slice(2);
    const fg = findPick(p);
    if (!fg) return '';
    const { t, g } = fg;
    if (t.post === '（併區）') return g[0] + '（併區）';
    return `${t.label !== undefined ? t.label : t.name}${t.pre}${g[0]}${t.post}（${g[1].map(name).join('、')}${g[2] ? '・' + g[2] : ''}）`;
  }

  /** 分工寫成一句：組放前面、區放後面 */
  function dutyText(picks, short) {
    const list = picks || [];
    return list.filter((p) => p.indexOf('t:') === 0).concat(list.filter((p) => p.indexOf('u:') === 0)).map((p) => pickText(p, short)).filter(Boolean).join('、');
  }

  window.Fmt = { findPick, normPicks, pickText, dutyText, splitNames, statusBadge, rosterHtml, esc, toDateStr, parseDate, addDays, datesBetween, rocYear, weekday, shortDate, rocDate, catLabel, timeRange, cardTime, tagsHtml };
})();
