// Worker 前門：接 HTTP 請求。
//   - getEvents：合併「手動活動（Durable Object）」和「教全區的活動（教全區的公開 API）」，兩邊都在記憶體快取，
//     人再多也不會每次都問資料庫或教全區（規格第 6 節）。
//   - 管理動作（POST）：轉給 Durable Object。
import { SITE } from './site.js';
import { AppError, checkRange, fromJiaoquan, inRange, signupDays, taipeiDate, yearsOf } from './logic.js';

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
  const jqTtl = opts.jqTtl !== undefined ? opts.jqTtl : 300e3;
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
  const bundle = { at: 0, data: null, promise: null }; // getBundle：今天起 30 天，5 分鐘
  const rosters = new Map(); // getDuty：id → { at, data }，2 分鐘

  function summaryOf(detail, from, to) {
    const ev = fromJiaoquan({ duties: [detail] })[0];
    if (!ev) return null;
    const { id, name, category, mode, start, end, startTime, endTime, location, link } = ev;
    return { id, unit: ev.unit, name, category, mode, start, end, startTime, endTime, location, link, days: signupDays(detail, from, to) };
  }

  async function getSignups() {
    if (!(bundle.data && now() - bundle.at < jqTtl)) {
      if (!bundle.promise) {
        const from = taipeiDate(now());
        const to = taipeiDate(now() + 30 * 86400e3);
        bundle.promise = jqGet({ action: 'getBundle', from, to }).then((data) => {
          const items = Object.values(data.details || {}).map((d) => summaryOf(d, from, to)).filter((x) => x && x.days.length);
          bundle.data = { from, to, items };
          bundle.at = now();
        }).finally(() => { bundle.promise = null; });
      }
      try {
        await bundle.promise;
      } catch (err) {
        if (!bundle.data) throw new AppError('UPSTREAM', '教全區的報名資料暫時讀不到，請稍後再試');
      }
    }
    return Object.assign({ today: taipeiDate(now()) }, bundle.data);
  }

  async function getRoster(params) {
    const id = params.get('id') || '';
    const m = id.match(/^jq-([\w-]{1,60})$/);
    if (!m) throw new AppError('BAD_REQUEST', '活動代號不對');
    const hit = rosters.get(m[1]);
    if (hit && now() - hit.at < 120e3) return hit.data;
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
        if (action === 'getSignups') return json({ ok: true, data: await getSignups() });
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
