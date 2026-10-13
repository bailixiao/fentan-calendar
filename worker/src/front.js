// Worker 前門：接 HTTP 請求。
//   - getEvents：合併「手動活動（Durable Object）」和「教全區的活動（教全區的公開 API）」，兩邊都在記憶體快取，
//     人再多也不會每次都問資料庫或教全區（規格第 6 節）。各區報名系統也讀這個（分壇分配的勤務）。
//   - getCalendar：分壇行事曆畫面用（只有分壇的活動，各區的勤務掛在下面，附各區已報幾人）；getLinked：一個活動各區的名單（規格第 9-3 節）。
//   - 管理動作（POST）：轉給 Durable Object。
import { SITE } from './site.js';
import { AppError, buildCalendar, checkRange, fromJiaoquan, inRange, isDate, parentKey, signupDays, taipeiDate, yearsOf } from './logic.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_BODY = 400000; // 批次匯入最多 300 筆
const PUBLIC_POST = { adminLogin: 1, adminLogout: 1, adminList: 1, adminSave: 1, adminDelete: 1, adminImport: 1, adminDeleteBatch: 1, adminLog: 1, adminBackup: 1,
  pushSubscribe: 1, pushUnsubscribe: 1, pushTest: 1, adminPushStats: 1, adminPushList: 1, adminPushSend: 1, adminPushCancel: 1 };

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS)
  });
}

function fail(err) {
  if (err instanceof AppError) return json({ ok: false, error: { code: err.code, message: err.message } });
  console.error(err);
  return json({ ok: false, error: { code: 'INTERNAL', message: '伺服器發生錯誤，請稍後再試' } });
}

/**
 * @param opts.callStore (body) => Promise<{ ok, data | error }>（正式：Durable Object；測試：直接呼叫 store-app）
 * @param opts.fetch 讀教全區用的 fetch（測試可以換成假的）
 * @param opts.now () => 毫秒
 */
export function createFront(opts) {
  const now = opts.now || (() => Date.now());
  const fetchFn = opts.fetch || ((...a) => fetch(...a));
  const localTtl = opts.localTtl !== undefined ? opts.localTtl : 60e3;
  const jqTtl = opts.jqTtl !== undefined ? opts.jqTtl : 60e3; // 2026/10/13：5 分鐘改 1 分鐘，報名後更快看到
  const jqTimeout = opts.jqTimeout || 8000;

  let pushKey = null;

  // ---------- 手動活動：整份快取 60 秒 ----------
  const local = { at: 0, events: null, promise: null };

  async function storeCall(body) {
    const res = await opts.callStore(body);
    if (!res || !res.ok) throw new AppError(res && res.error ? res.error.code : 'INTERNAL', res && res.error ? res.error.message : '伺服器發生錯誤');
    return res.data;
  }

  function localEvents(fresh) {
    if (!fresh && local.events && now() - local.at < localTtl) return Promise.resolve(local.events);
    if (!fresh && local.promise) return local.promise;
    const p = storeCall({ action: 'snapshot' }).then((data) => {
      local.events = data.events;
      local.at = now();
      return data.events;
    }).finally(() => { if (local.promise === p) local.promise = null; });
    if (!fresh) local.promise = p;
    return p;
  }

  // ---------- 教全區：依年份快取 5 分鐘；讀不到就用上次的 ----------
  const jq = new Map(); // year → { at, events, promise }

  /** 讀教全區的公開 API，回傳 data（讀不到丟錯） */
  async function jqGet(params) {
    const url = SITE.jiaoquan.api + '?' + new URLSearchParams(params);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), jqTimeout);
    try {
      const res = await fetchFn(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      if (!body || !body.ok) throw new AppError(body && body.error && body.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UPSTREAM', '教全區的資料暫時讀不到');
      return body.data;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- 教全區的報名名單（規格第 9-1 節） ----------
  const rosters = new Map(); // getDuty：id → { at, data }，2 分鐘

  function summaryOf(detail, from, to) {
    const ev = fromJiaoquan({ duties: [detail] })[0];
    if (!ev) return null;
    const { id, name, category, mode, start, end, startTime, endTime, location, link } = ev;
    return { id, unit: ev.unit, name, category, mode, start, end, startTime, endTime, location, link, days: signupDays(detail, from, to) };
  }

  // ---------- 各區報名系統的報名（規格第 9-1 節）：feed 快取 2 分鐘 ----------
  const regionFeed = new Map(); // 'test' | 'open' → { at, items, promise }

  /** 各區報名系統的 feed → 報名統計的格式（名單只有名字；點活動打開該區的報名頁） */
  function itemsFromFeed(data) {
    const out = [];
    const site = SITE.regionSystem.site;
    (data && Array.isArray(data.regions) ? data.regions : []).forEach((r) => {
      (Array.isArray(r.events) ? r.events : []).forEach((ev) => {
        const days = (Array.isArray(ev.days) ? ev.days : []).map((d) => ({
          date: d.date,
          status: d.status,
          positions: (d.positions || []).map((p) => ({ name: String(p.name || '').slice(0, 40), people: (p.people || []).map((x) => ({ name: String(x.name || '').slice(0, 20) })) }))
        }));
        if (!days.length) return;
        out.push({
          id: 'rs-' + ev.id, unit: r.region, name: ev.name, category: ev.category, mode: ev.mode,
          start: ev.start, end: ev.end, startTime: ev.startTime || '', endTime: ev.endTime || '', location: ev.location || '',
          link: `${site}#/r/${encodeURIComponent(r.region)}/e/${encodeURIComponent(ev.id)}`, days
        });
      });
    });
    return out;
  }

  async function regionSignups(from, to, test) {
    const key = test ? 'test' : 'open';
    let e = regionFeed.get(key);
    if (!e) { e = { at: 0, items: null, promise: null }; regionFeed.set(key, e); }
    if (e.items && now() - e.at < 60e3) return e.items;
    if (!e.promise) {
      const url = SITE.regionSystem.api + '?' + new URLSearchParams(Object.assign({ action: 'feed', from, to }, test ? { test: '1' } : {}));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), jqTimeout);
      e.promise = fetchFn(url, { signal: ctrl.signal }).then((res) => res.json()).then((body) => {
        if (!body || !body.ok) throw new Error('各區報名系統回錯誤');
        e.items = itemsFromFeed(body.data);
        e.at = now();
      }).finally(() => { clearTimeout(timer); e.promise = null; });
    }
    try { await e.promise; } catch (err) { console.warn('各區報名系統讀不到', String(err && err.message)); }
    return e.items || [];
  }

  // ---------- 各區報名系統：單一活動（名單）、開放的區；快取 1～2 分鐘 ----------
  const regionCache = new Map(); // key → { at, data }

  async function regionGet(params, maxAge) {
    const key = JSON.stringify(params);
    const hit = regionCache.get(key);
    if (hit && now() - hit.at < maxAge) return hit.data;
    const url = SITE.regionSystem.api + '?' + new URLSearchParams(params);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), jqTimeout);
    try {
      const body = await (await fetchFn(url, { signal: ctrl.signal })).json();
      if (!body || !body.ok) throw new AppError(body && body.error ? body.error.code : 'UPSTREAM', body && body.error ? body.error.message : '各區報名系統暫時讀不到');
      if (regionCache.size > 500) regionCache.clear();
      regionCache.set(key, { at: now(), data: body.data });
      return body.data;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- 分壇行事曆畫面（規格第 9-3 節） ----------

  /** 只有分壇的活動，各區的勤務掛在下面；每個掛著的附「那天報了幾人」（各區報名系統：今天起 60 天；教全區：行事曆的人數） */
  async function getCalendar(params, waitUntil) {
    const test = params.get('test') === '1';
    const raw = await getEvents(params, waitUntil);
    const items = buildCalendar(raw.events, test);
    const feed = await regionSignups(taipeiDate(now()), taipeiDate(now() + 60 * 86400e3), test);
    const fromRegion = new Map();
    feed.forEach((it) => { if (it.id.indexOf('rs-F-') === 0) fromRegion.set(it.id.slice(5), it); });
    const jqById = new Map(raw.events.filter((e) => e.source === 'jiaoquan').map((e) => [e.id, e]));
    items.forEach((it) => {
      it.links = it.links.map((l) => {
        const counts = {};
        if (l.source === 'jiaoquan') {
          const ev = jqById.get(l.id);
          Object.keys((ev && ev.status) || {}).forEach((d) => { counts[d] = ev.status[d].total || 0; });
        } else {
          const r = fromRegion.get(l.id);
          if (r) r.days.forEach((d) => { counts[d.date] = d.positions.reduce((n, q) => n + q.people.length, 0); });
        }
        return Object.assign({}, l, { counts });
      });
    });
    return { from: raw.from, to: raw.to, today: raw.today, events: items, sources: raw.sources };
  }

  /** 一個分壇活動（或合成的卡片）某一天，掛在下面的各區勤務的狀態與名單（只有名字） */
  async function getLinked(params) {
    const id = params.get('id') || '';
    const date = params.get('date') || '';
    const test = params.get('test') === '1';
    if (!isDate(date)) throw new AppError('BAD_REQUEST', '日期不對');
    const cal = await getCalendar(new URLSearchParams(Object.assign({ from: date, to: date }, test ? { test: '1' } : {})));
    const item = cal.events.find((e) => e.id === id);
    if (!item) throw new AppError('NOT_FOUND', '找不到這個活動');
    let open = null; // 開放的區（test 時不檢查，讓各區報名系統自己判斷）
    if (!test) {
      try { open = new Set(((await regionGet({ action: 'regions' }, 120e3)).regions || []).map((r) => r.name)); } catch (e) { open = new Set(); }
    }
    const site = SITE.regionSystem.site;
    const onDay = item.links.filter((l) => l.start <= date && l.end >= date);
    const jqThere = onDay.some((l) => l.source === 'jiaoquan');
    // 派給教全區的：名單來自教全區系統裡同名的勤務；那邊已經有就不重複列，還沒有就提示教全區去建
    const list = onDay.filter((l) => !(l.source === 'local' && l.unit === SITE.jiaoquan.unit && jqThere));
    const links = await Promise.all(list.map(async (l) => {
      const base = { unit: l.unit, name: l.name, source: l.source };
      if (l.source === 'local' && l.unit === SITE.jiaoquan.unit) return Object.assign(base, { open: false, hint: 'jiaoquan', key: item.source === 'group' ? item.name : parentKey(item.name) });
      try {
        if (l.source === 'jiaoquan') {
          const r = await getRoster(new URLSearchParams({ id: l.id }));
          const day = r.days.find((d) => d.date === date);
          return Object.assign(base, { open: true, day: day || null, link: `${SITE.jiaoquan.site}#/duty/${encodeURIComponent(l.id.slice(3))}?date=${date}` });
        }
        if (open && !open.has(l.unit)) return Object.assign(base, { open: false });
        const ev = await regionGet({ action: 'getEvent', region: l.unit, id: 'F-' + l.id }, 30e3);
        const d = (ev.days || []).find((x) => x.date === date);
        return Object.assign(base, {
          open: true,
          day: d ? { date, status: d.status, positions: (d.positions || []).map((q) => ({ name: String(q.name || '').slice(0, 40), people: (q.people || []).map((x) => ({ name: String(x.name || '').slice(0, 20) })) })) } : null,
          link: `${site}#/r/${encodeURIComponent(l.unit)}/e/${encodeURIComponent('F-' + l.id)}?date=${date}`
        });
      } catch (err) {
        if (err instanceof AppError && err.code === 'NOT_FOUND') return Object.assign(base, { open: false });
        return Object.assign(base, { open: true, error: '暫時讀不到，請稍後再試' });
      }
    }));
    return { id, date, links };
  }

  async function getRoster(params) {
    const id = params.get('id') || '';
    const m = id.match(/^jq-([\w-]{1,60})$/);
    if (!m) throw new AppError('BAD_REQUEST', '活動代號不對');
    const hit = rosters.get(m[1]);
    if (hit && now() - hit.at < 30e3) return hit.data;
    const detail = await jqGet({ action: 'getDuty', id: m[1] });
    const data = summaryOf(detail);
    if (rosters.size > 500) rosters.clear();
    rosters.set(m[1], { at: now(), data });
    return data;
  }

  async function fetchJiaoquanYear(year) {
    const url = SITE.jiaoquan.api + '?' + new URLSearchParams({ action: 'getEvents', from: `${year}-01-01`, to: `${year}-12-31` });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), jqTimeout);
    try {
      const res = await fetchFn(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      if (!body || !body.ok) throw new Error('教全區回錯誤');
      return fromJiaoquan(body.data);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 回傳 { events, ok, stale }：ok＝有資料可用；stale＝最近一次沒讀到，用的是更早的。
   * 已經有資料（就算超過 5 分鐘）：先回手上的，背景再更新，不讓家人等。
   * 讀不到：1 分鐘內不再去試，不要每個請求都等 8 秒。
   */
  async function jiaoquanYear(year, waitUntil) {
    let entry = jq.get(year);
    if (!entry) { entry = { at: 0, events: null, promise: null, failedAt: 0 }; jq.set(year, entry); }
    const expired = !entry.events || now() - entry.at >= jqTtl;
    if (expired && !entry.promise && now() - entry.failedAt >= 60e3) {
      entry.promise = fetchJiaoquanYear(year).then((events) => {
        entry.events = events;
        entry.at = now();
        entry.failedAt = 0;
      }, (err) => {
        console.warn('教全區讀不到', year, String(err && err.message));
        entry.failedAt = now();
      }).finally(() => { entry.promise = null; });
      if (entry.events && waitUntil) waitUntil(entry.promise);
    }
    if (!entry.events && entry.promise) await entry.promise;
    if (!entry.events) return { events: [], ok: false, stale: false };
    return { events: entry.events, ok: true, stale: entry.failedAt > 0 };
  }

  async function getEvents(params, waitUntil) {
    const from = params.get('from');
    const to = params.get('to');
    checkRange(from, to);
    const fresh = params.get('fresh') === '1';
    const [mine, ...jqYears] = await Promise.all([localEvents(fresh)].concat(yearsOf(from, to).map((y) => jiaoquanYear(y, waitUntil))));
    const jqOk = jqYears.every((r) => r.ok);
    const jqStale = jqYears.some((r) => r.stale);
    const all = mine.concat(...jqYears.map((r) => r.events));
    return {
      from, to,
      today: taipeiDate(now()),
      events: inRange(all, from, to),
      sources: { [SITE.jiaoquan.unit]: { ok: jqOk, stale: jqStale } }
    };
  }

  /** ctx：Worker 的 ExecutionContext（背景更新用 waitUntil；測試可以不給） */
  async function handle(request, ctx) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const url = new URL(request.url);
      if (request.method === 'GET') {
        const action = url.searchParams.get('action') || '';
        const waitUntil = ctx && ctx.waitUntil ? (p) => ctx.waitUntil(p) : null;
        if (action === 'getEvents') return json({ ok: true, data: await getEvents(url.searchParams, waitUntil) });
        if (action === 'ping') return json({ ok: true, data: { today: taipeiDate(now()) } });
        if (action === 'getCalendar') return json({ ok: true, data: await getCalendar(url.searchParams, waitUntil) });
        if (action === 'getLinked') return json({ ok: true, data: await getLinked(url.searchParams) });
        if (action === 'getRoster') return json({ ok: true, data: await getRoster(url.searchParams) });
        // 手機提醒：公鑰（不會變，記在這個 Worker）、手機收到推播後來問要顯示什麼
        if (action === 'pushKey') {
          if (!pushKey) pushKey = await storeCall({ action: 'pushKey' });
          return json({ ok: true, data: pushKey });
        }
        if (action === 'pushSummary') return json(await opts.callStore({ action: 'pushSummary', id: url.searchParams.get('id') || '' }));
        throw new AppError('BAD_REQUEST', '未知的 action：' + (action.slice(0, 30) || '（空白）'));
      }
      if (request.method !== 'POST') throw new AppError('BAD_REQUEST', '不支援的方法');
      const text = await request.text();
      if (text.length > MAX_BODY) throw new AppError('BAD_REQUEST', '資料太大');
      let body;
      try { body = JSON.parse(text); } catch (e) { throw new AppError('BAD_REQUEST', '資料格式錯誤'); }
      if (!body || !PUBLIC_POST[body.action]) throw new AppError('BAD_REQUEST', '未知的 action：' + (body && body.action ? String(body.action).slice(0, 30) : '（空白）'));
      const res = await opts.callStore(body);
      if (res && res.ok && /^admin(Save|Delete|Import|DeleteBatch)$/.test(body.action)) local.at = 0; // 這個 Worker 的快取馬上失效
      return json(res);
    } catch (err) {
      return fail(err);
    }
  }

  return { handle };
}
