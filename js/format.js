// 日期、時間的顯示格式，以及共用小工具。
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

  function weekday(s) {
    return WEEKDAYS[parseDate(s).getDay()];
  }

  /** '2026-10-10' → '10/10（六）' */
  function shortDate(s) {
    return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}（${weekday(s)}）`;
  }

  /** '2026-10-10' → '10/10' */
  function md(s) {
    return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  }

  /** '2026-10-10' → '115/10/10（六）' */
  function rocDate(s) {
    return `${Number(s.slice(0, 4)) - 1911}/${shortDate(s)}`;
  }

  /** '09:00'、'09:00 – 12:00'、'' */
  function timeRange(o) {
    if (!o.startTime) return '';
    return o.endTime ? `${o.startTime} – ${o.endTime}` : o.startTime;
  }

  /** 名字之間的分隔（規則同 worker/src/logic.js 的 NAME_SEP、cleanNames）：拆成一個一個、去掉重複 */
  const NAME_SEP = /[,，、;；。．.\/／・·|｜\s　]+/;
  function splitNames(text) {
    const out = [];
    String(text || '').split(NAME_SEP).forEach((n) => { if (n && out.indexOf(n) === -1) out.push(n); });
    return out;
  }

  /** 名字預覽：拆好的名字一個一個顯示，太長紅色、超過 4 個字黃色 */
  function namesPreview(text) {
    const names = splitNames(text);
    if (!names.length) return '';
    const long = names.filter((n) => n.length > 20);
    const odd = names.filter((n) => n.length > 4 && n.length <= 20);
    return `<span class="name-count">會報 ${names.length} 人：</span>${names.map((n) => `<span class="name-chip${n.length > 20 ? ' is-bad' : n.length > 4 ? ' is-odd' : ''}">${esc(n)}</span>`).join('')}
      ${long.length ? '<p class="form-error">標紅色的太長了（最多 20 字），是不是兩個名字中間忘了空格或「、」？</p>' : ''}
      ${odd.length ? `<p class="name-warn">${odd.map((n) => `「${esc(n)}」`).join('')}超過 4 個字，確定是一個人的名字嗎？如果是兩個人，中間加空格或「、」。</p>` : ''}`;
  }

  /** 超過 4 個字的名字：送出前再問一次。回傳 true＝照送 */
  function confirmOdd(text) {
    const odd = splitNames(text).filter((n) => n.length > 4 && n.length <= 20);
    return !odd.length || window.confirm(`${odd.map((n) => `「${n}」`).join('')}超過 4 個字，確定是一個人的名字嗎？\n\n按「確定」照這樣送出；按「取消」回去把名字拆開（中間加空格或「、」）。`);
  }

  /** 區的下拉選單 */
  function unitOptions(selected, placeholder) {
    return (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
      window.SITE.units.map((u) => `<option${u === selected ? ' selected' : ''}>${esc(u)}</option>`).join('');
  }

  window.Fmt = { esc, toDateStr, parseDate, addDays, weekday, shortDate, md, rocDate, timeRange, splitNames, namesPreview, confirmOdd, unitOptions };
})();
