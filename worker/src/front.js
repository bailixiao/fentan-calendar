// Worker 前門：接 HTTP 請求（規格第 11 節）。
//   - getBoard：主畫面（開放的班、每一堂、報名人數），記憶體快取 15 秒，人再多也不用每次問資料庫。報名、改課之後馬上失效。
//   - getSession：那一堂的頁面（含報名名單）；getUnit：區的報名（那一區接下來每一堂報了誰）。都不快取。
//   - 其他 POST：轉給 Durable Object。
import { AppError, taipeiDate } from './logic.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_BODY = 100000;
// 可以從外面呼叫的 POST action（權限由 Durable Object 檢查）
const PUBLIC_POST = {
  adminLogin: 1, adminLogout: 1, adminAccounts: 1, adminSetAccount: 1, adminLog: 1, adminBackup: 1, adminOldCount: 1, adminPurgeOld: 1,
  signup: 1, cancelSignup: 1, adminSignup: 1, adminCancelSignup: 1,
  adminRoll: 1, adminRollSet: 1, adminRollAdd: 1, adminAttendance: 1,
  adminCourses: 1, adminCourseSave: 1, adminCourseDelete: 1, adminSessionSave: 1, adminSessionDelete: 1, adminSessionsMake: 1,
  pushSubscribe: 1, pushUnsubscribe: 1, pushTest: 1, adminPushStats: 1, adminPushList: 1, adminPushSend: 1, adminPushCancel: 1
};
// 會改到主畫面的：成功後快取馬上失效
const CHANGES_BOARD = /^(signup|cancelSignup|adminSignup|adminCancelSignup|adminRollAdd|adminCourseSave|adminCourseDelete|adminSessionSave|adminSessionDelete|adminSessionsMake)$/;

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
 * @param opts.now () => 毫秒
 * @param opts.boardTtl 主畫面快取幾毫秒（預設 15 秒；測試可以給 0）
 */
export function createFront(opts) {
  const now = opts.now || (() => Date.now());
  const boardTtl = opts.boardTtl !== undefined ? opts.boardTtl : 15e3;
  let pushKey = null;
  const board = { at: 0, data: null, promise: null };

  async function storeCall(body) {
    const res = await opts.callStore(body);
    if (!res || !res.ok) throw new AppError(res && res.error ? res.error.code : 'INTERNAL', res && res.error ? res.error.message : '伺服器發生錯誤');
    return res.data;
  }

  function getBoard(fresh) {
    if (!fresh && board.data && now() - board.at < boardTtl) return Promise.resolve(board.data);
    if (!fresh && board.promise) return board.promise;
    const p = storeCall({ action: 'getBoard' }).then((data) => {
      board.data = data;
      board.at = now();
      return data;
    }).finally(() => { if (board.promise === p) board.promise = null; });
    if (!fresh) board.promise = p;
    return p;
  }

  async function handle(request) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const url = new URL(request.url);
      if (request.method === 'GET') {
        const action = url.searchParams.get('action') || '';
        if (action === 'getBoard') return json({ ok: true, data: await getBoard(url.searchParams.get('fresh') === '1') });
        if (action === 'getSession') return json(await opts.callStore({ action: 'getSession', id: url.searchParams.get('id') || '', token: url.searchParams.get('t') || '' }));
        if (action === 'getUnit') return json(await opts.callStore({ action: 'getUnit', unit: url.searchParams.get('unit') || '', token: url.searchParams.get('t') || '' }));
        if (action === 'ping') return json({ ok: true, data: { today: taipeiDate(now()) } });
        if (action === 'loginAccounts') return json(await opts.callStore({ action: 'loginAccounts' }));
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
      if (res && res.ok && CHANGES_BOARD.test(body.action)) board.at = 0; // 這個 Worker 的快取馬上失效
      return json(res);
    } catch (err) {
      return fail(err);
    }
  }

  return { handle };
}
