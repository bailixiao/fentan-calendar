// 不碰資料庫、不連網的邏輯：日期、欄位檢查、整理教全區的資料。測試直接呼叫這裡。
import { SITE } from './site.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_DAYS = 60; // 一筆活動最長幾天
const LIMITS = { name: 60, location: 60, note: 1000, link: 500 };

export class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** 台北時間的 'yyyy-MM-dd'、'yyyy-MM-dd HH:mm:ss' */
export function taipeiDate(ms) {
  return new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
}
export function taipeiStamp(ms) {
  return new Date(ms + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
}

/** 是真的存在的日期（擋掉 2026-02-30 這種） */
export function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

export function isTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
}

/** 可以在後台新增的單位：分壇＋16 區＋測試區（只在後台）。教全區只能是「分壇分配」（教全區自己的活動從教全區系統讀進來） */
export function editableUnits() {
  return [SITE.fentan].concat(SITE.units, SITE.testRegion);
}

export const KINDS = ['分壇分配', '區活動']; // 單位是某一區時：分壇分配（帶到各區報名系統）／區活動（只記在分壇行事曆）
const MAX_POSITIONS = 10;

function intOrNull(v, label, errs) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 999) { errs.push(`${label}要是 0～999 的整數`); return null; }
  return n;
}

/** 了愿項目與名額（選填，規則同各區報名系統）：沿用舊的 id，新的給新 id */
function cleanPositions(list, newId, errs) {
  const out = [];
  if (!Array.isArray(list)) return out;
  if (list.length > MAX_POSITIONS) errs.push(`了愿項目最多 ${MAX_POSITIONS} 個`);
  const names = new Set();
  list.slice(0, MAX_POSITIONS).forEach((p, i) => {
    const name = str(p && p.name);
    if (!name && !str(p && p.min) && !str(p && p.max)) return; // 整列空白：略過
    if (!name) { errs.push(`第 ${i + 1} 個了愿項目沒有名稱`); return; }
    if (name.length > 20) errs.push(`了愿項目「${name}」名稱最多 20 字`);
    if (names.has(name)) errs.push(`了愿項目「${name}」重複了`);
    names.add(name);
    const min = intOrNull(p.min, `「${name}」的最少人數`, errs);
    const max = intOrNull(p.max, `「${name}」的最多人數`, errs);
    if (min !== null && max !== null && max < min) errs.push(`「${name}」的最多人數不能少於最少人數`);
    if (max === 0) errs.push(`「${name}」的最多人數不能是 0`);
    const id = typeof p.id === 'string' && /^P-[\w-]{1,40}$/.test(p.id) ? p.id : newId();
    out.push({ id, name, min, max });
  });
  return out;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
}

/**
 * 檢查並整理後台送來的活動。回傳只含允許欄位的新物件；有錯丟 AppError('BAD_REQUEST')，訊息列出所有問題。
 */
export function cleanEvent(input, newId) {
  if (!input || typeof input !== 'object') throw new AppError('BAD_REQUEST', '活動資料格式錯誤');
  const makeId = newId || (() => 'P-' + Math.random().toString(16).slice(2, 10));
  const ev = {
    unit: str(input.unit),
    category: str(input.category),
    name: str(input.name),
    start: str(input.start),
    end: str(input.end) || str(input.start),
    startTime: str(input.startTime),
    endTime: str(input.endTime),
    location: str(input.location),
    note: str(input.note).replace(/\r\n?/g, '\n'),
    link: str(input.link)
  };
  const errs = [];
  // 單位是某一區：分壇分配（預設）或區活動；了愿項目選填
  if (ev.unit && ev.unit !== SITE.fentan) {
    ev.kind = str(input.kind) || KINDS[0];
    if (KINDS.indexOf(ev.kind) === -1) errs.push('種類要是「分壇分配」或「區活動」');
  }
  ev.positions = cleanPositions(input.positions, makeId, errs);
  if (editableUnits().indexOf(ev.unit) === -1) errs.push('請選擇單位');
  if (ev.unit === SITE.jiaoquan.unit && ev.kind !== '分壇分配') errs.push('教全區自己的活動會自動從教全區的系統讀進來，這裡只能派分壇分配的勤務給教全區');
  if (SITE.categories.indexOf(ev.category) === -1) errs.push('請選擇類別');
  if (!ev.name) errs.push('請填活動名稱');
  if (!isDate(ev.start)) errs.push('開始日期格式不對');
  if (!isDate(ev.end)) errs.push('結束日期格式不對');
  if (isDate(ev.start) && isDate(ev.end)) {
    if (ev.end < ev.start) errs.push('結束日期不能早於開始日期');
    else if (daysBetween(ev.start, ev.end) >= MAX_DAYS) errs.push(`一筆活動最長 ${MAX_DAYS} 天`);
  }
  if (ev.startTime && !isTime(ev.startTime)) errs.push('開始時間格式不對（例：09:30）');
  if (ev.endTime && !isTime(ev.endTime)) errs.push('結束時間格式不對（例：17:00）');
  if (ev.endTime && !ev.startTime) errs.push('有結束時間就要填開始時間');
  if (ev.link && !/^https:\/\/[^\s]+$/.test(ev.link)) errs.push('相關連結要以 https:// 開頭');
  Object.keys(LIMITS).forEach((k) => {
    if (ev[k].length > LIMITS[k]) errs.push(`${({ name: '活動名稱', location: '地點', note: '說明', link: '相關連結' })[k]}最多 ${LIMITS[k]} 字`);
  });
  if (errs.length) throw new AppError('BAD_REQUEST', errs.join('；'));
  return ev;
}

/** 新活動的代號：E-yyyyMMdd-六碼亂數 */
export function newEventId(ms, randomHex) {
  return 'E-' + taipeiDate(ms).replace(/-/g, '') + '-' + randomHex.slice(0, 6);
}

/** 給家人們看的欄位（手動輸入的活動） */
export function publicEvent(ev) {
  return {
    id: ev.id, source: 'local', unit: ev.unit, category: ev.category, name: ev.name,
    start: ev.start, end: ev.end, startTime: ev.startTime || '', endTime: ev.endTime || '',
    location: ev.location || '', note: ev.note || '', link: ev.link || '',
    kind: ev.unit === SITE.fentan ? '' : ev.kind || KINDS[0],
    positions: Array.isArray(ev.positions) ? ev.positions : []
  };
}

// ---------- 教全區的報名狀態（規格第 9-1 節，算法同教全區 js/format.js 的 dayState） ----------

const DEFAULT_MIN_PEOPLE = 2;
function effectiveMin(p) {
  if (p.min !== null && p.min !== undefined) return p.min;
  return p.max !== null && p.max !== undefined ? Math.min(DEFAULT_MIN_PEOPLE, p.max) : DEFAULT_MIN_PEOPLE;
}

/** 教全區某勤務某一天的狀態：{ kind: notice|full|short|ok, label } */
export function dayStatus(duty, day) {
  if (duty.mode === '公告型') return { kind: 'notice', label: duty.group ? `輪值：${str(duty.group).slice(0, 20)}` : '公告' };
  const d = day || { total: 0, shortage: 0, full: false, counts: {} };
  const total = Number(d.total) || 0;
  const counts = d.counts || {};
  const positions = Array.isArray(duty.positions) ? duty.positions : [];
  if (duty.category === '道務' || duty.category === '教育') { // 自由參加、鼓勵為主：不算缺人
    return d.full ? { kind: 'full', label: '額滿' } : { kind: 'ok', label: `已報 ${total} 人` };
  }
  const people = d.people !== undefined ? Number(d.people) || 0 : total;
  const shortage = duty.totalNeed
    ? Math.max(duty.totalNeed - people, 0)
    : positions.reduce((sum, p) => sum + Math.max(effectiveMin(p) - (Number(counts[p.id]) || 0), 0), 0);
  if (d.full) return { kind: 'full', label: '額滿' };
  if (shortage > 0) return { kind: 'short', label: `缺 ${shortage} 人` };
  const unlimited = positions.length > 0 && positions.every((p) => p.max === null || p.max === undefined);
  return { kind: 'ok', label: unlimited ? `已報 ${total} 人` : `人數足・${total} 人` };
}

/**
 * 教全區 getDuty／getBundle 的一筆詳情 → 名單。只留了愿項目名稱、日期、名字（陪同、佛堂、備註、組長、電話一律丟掉）。
 * 回傳 { id, positions: [{ id, name }], signups: [{ date, positionId, name }] }
 */
export function rosterFrom(detail) {
  const positions = (Array.isArray(detail && detail.positions) ? detail.positions : [])
    .filter((p) => p && typeof p.id === 'string').map((p) => ({ id: p.id, name: str(p.name).slice(0, 40) }));
  const signups = (Array.isArray(detail && detail.signups) ? detail.signups : [])
    .filter((x) => x && isDate(x.date) && typeof x.positionId === 'string' && str(x.name))
    .map((x) => ({ date: x.date, positionId: x.positionId, name: str(x.name).slice(0, 20) }));
  return { id: 'jq-' + detail.id, positions, signups };
}

/**
 * 教全區一筆詳情 → 每一天的狀態與名單（from～to 內的日期）：
 * [{ date, status, positions: [{ name, people: [{ name }] }] }]
 */
export function signupDays(detail, from, to) {
  const r = rosterFrom(detail);
  const days = detail && detail.days && typeof detail.days === 'object' ? detail.days : {};
  return Object.keys(days).filter((d) => isDate(d) && (!from || d >= from) && (!to || d <= to)).sort().map((date) => ({
    date,
    status: dayStatus(detail, days[date]),
    positions: r.positions.map((p) => ({
      name: p.name,
      people: r.signups.filter((x) => x.date === date && x.positionId === p.id).map((x) => ({ name: x.name }))
    }))
  }));
}

/**
 * 教全區 getEvents 的回應 → 分壇的活動格式。
 * 教全區的資料裡有人名（聯絡人、借場地的人、組長、師資⋯），這裡只挑規格第 4 節列的欄位，其他一律丟掉。
 * 借場地（venue）不顯示。格式不對的筆數跳過。
 */
export function fromJiaoquan(data) {
  const list = data && Array.isArray(data.duties) ? data.duties : [];
  const out = [];
  list.forEach((d) => {
    if (!d || typeof d.id !== 'string' || !/^[\w-]{1,60}$/.test(d.id)) return;
    if (!isDate(d.start) || !isDate(d.end) || d.end < d.start) return;
    const category = SITE.categories.indexOf(d.category) !== -1 ? d.category : '勤務'; // 教全區舊資料沒有類別的算勤務
    out.push({
      id: 'jq-' + d.id,
      source: 'jiaoquan',
      unit: SITE.jiaoquan.unit,
      category,
      name: str(d.name).slice(0, 100),
      nature: str(d.nature).slice(0, 20),
      mode: d.mode === '公告型' ? '公告型' : '報名型',
      start: d.start,
      end: d.end,
      startTime: isTime(d.startTime) ? d.startTime : '',
      endTime: isTime(d.endTime) ? d.endTime : '',
      location: str(d.location).slice(0, 60),
      attire: str(d.attire).slice(0, 60),
      note: '',
      link: SITE.jiaoquan.site + '#/duty/' + encodeURIComponent(d.id),
      status: Object.keys(d.days && typeof d.days === 'object' ? d.days : {}).filter(isDate).reduce((o, date) => { o[date] = Object.assign(dayStatus(d, d.days[date]), { total: Number(d.days[date] && d.days[date].total) || 0 }); return o; }, {})
    });
  });
  return out;
}

/** from～to 有重疊的活動，依開始日期、時間、名稱排序 */
export function inRange(events, from, to) {
  return events
    .filter((e) => e.start <= to && e.end >= from)
    .sort((a, b) => a.start.localeCompare(b.start) || (a.startTime || '').localeCompare(b.startTime || '') || a.name.localeCompare(b.name));
}

/** 讀取區間的檢查：日期格式正確、from ≤ to、最長 400 天 */
export function checkRange(from, to) {
  if (!isDate(from) || !isDate(to)) throw new AppError('BAD_REQUEST', 'from、to 要是 yyyy-MM-dd');
  if (to < from) throw new AppError('BAD_REQUEST', 'to 不能早於 from');
  if (daysBetween(from, to) > 400) throw new AppError('BAD_REQUEST', '一次最多讀 400 天');
}

/** from～to 跨到的年份 */
export function yearsOf(from, to) {
  const out = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) out.push(y);
  return out;
}

// ---------- 分壇行事曆只看分壇的活動，各區的勤務掛在下面（規格第 9-3 節） ----------

/** 比對用的名字：去掉括號裡的字、「第 N 次」、標點空白；分壇活動取「：」前面那段 */
function coreName(name) {
  return String(name || '').replace(/（[^）]*）|\([^)]*\)/g, '').replace(/第\s*\d+\s*次\s*$/, '').replace(/[\s:：・、,，]/g, '');
}
export function parentKey(name) {
  return coreName(String(name || '').split(/[：:]/)[0]);
}

/** 掛著的各區勤務：照區的順序（教真區⋯教理區），同一區分壇分配的在前、教全區系統的在後 */
function sortLinks(list) {
  const order = (u) => { const i = SITE.units.indexOf(u); return i === -1 ? 99 : i; };
  return list.sort((a, b) => order(a.unit) - order(b.unit) || (a.source === 'jiaoquan') - (b.source === 'jiaoquan'));
}

function linkOf(e) {
  return { id: e.id, unit: e.unit, name: e.name, source: e.source === 'jiaoquan' ? 'jiaoquan' : 'local', start: e.start, end: e.end };
}

/**
 * 分壇行事曆的項目：
 *   1. 單位是分壇的活動，links＝掛在下面的各區勤務（分壇分配、教全區系統的）：日期重疊且名稱含分壇活動的名字。
 *   2. 沒掛上的分壇分配勤務：同名稱、同日期的合成一張卡片（代號 G- 開頭）。
 * 區活動、各區自己的活動、沒掛上的教全區活動都不出現；測試區只有 test 才出現。
 */
export function buildCalendar(events, test) {
  const overlap = (a, b) => a.start <= b.end && a.end >= b.start;
  const fentan = events.filter((e) => e.source === 'local' && e.unit === SITE.fentan);
  const assigned = events.filter((e) => e.source === 'local' && e.unit !== SITE.fentan && e.kind !== '區活動' && (test || e.unit !== SITE.testRegion));
  const jq = events.filter((e) => e.source === 'jiaoquan');
  const used = new Set();
  const items = fentan.map((f) => {
    const key = parentKey(f.name);
    const links = [];
    if (key.length >= 2) {
      assigned.forEach((a) => { if (!used.has(a.id) && overlap(a, f) && coreName(a.name).indexOf(key) !== -1) { links.push(linkOf(a)); used.add(a.id); } });
      jq.forEach((j) => { if (overlap(j, f) && coreName(j.name).indexOf(key) !== -1) links.push(linkOf(j)); });
    }
    return Object.assign({}, f, { links: sortLinks(links) });
  });
  const groups = new Map();
  assigned.filter((a) => !used.has(a.id)).forEach((a) => {
    const k = [a.name, a.start, a.end].join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  });
  groups.forEach((list) => {
    const first = list[0];
    items.push({
      id: 'G-' + first.id, source: 'group', unit: SITE.fentan, category: first.category, name: first.name,
      start: first.start, end: first.end, startTime: first.startTime || '', endTime: first.endTime || '',
      location: first.location || '', note: first.note || '', link: '', links: sortLinks(list.map(linkOf))
    });
  });
  return items.sort((a, b) => a.start.localeCompare(b.start) || (a.startTime || '').localeCompare(b.startTime || '') || a.name.localeCompare(b.name));
}
