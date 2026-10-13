// 在 Durable Object 裡執行的部分：手動活動的讀寫、管理者登入。所有請求依序處理，不會兩筆同時改。
// call(body) 回傳 { ok: true, data } 或 { ok: false, error: { code, message } }。
import { AppError, cleanEvent, newEventId, publicEvent, taipeiStamp, editableUnits } from './logic.js';

const MAX_IMPORT = 300; // 一次最多匯入幾筆
const SESSION_TTL_MS = 12 * 3600e3; // 登入 12 小時有效
const MAX_FAILS = 10; // 連續輸錯幾次就暫停登入
const LOCK_MS = 15 * 60e3; // 暫停多久

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function randomHex(bytes) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * @param store createSqlStore / createMemoryStore
 * @param opts.password () => 管理密碼（Worker secret ADMIN_PASSWORD）
 * @param opts.now () => 現在的毫秒（測試可以換）
 */
export function createStoreApp(store, opts) {
  const now = opts.now || (() => Date.now());
  const password = opts.password;

  async function requireAdmin(body) {
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token) throw new AppError('UNAUTHORIZED', '請先登入');
    const hash = await sha256(token);
    const exp = store.getSession(hash);
    if (!exp || exp <= now()) {
      if (exp) store.deleteSession(hash);
      throw new AppError('UNAUTHORIZED', '登入已過期，請重新登入');
    }
  }

  function readFails() {
    try { return JSON.parse(store.getProp('loginFails') || 'null') || { count: 0, lockUntil: 0 }; } catch (e) { return { count: 0, lockUntil: 0 }; }
  }

  async function adminLogin(body) {
    const pw = password();
    if (!pw) throw new AppError('NOT_CONFIGURED', '管理密碼還沒設定（Worker secret ADMIN_PASSWORD）');
    const fails = readFails();
    if (fails.lockUntil > now()) {
      const min = Math.ceil((fails.lockUntil - now()) / 60e3);
      throw new AppError('LOCKED', `密碼輸錯太多次，請 ${min} 分鐘後再試`);
    }
    const given = typeof body.password === 'string' ? body.password : '';
    // 比雜湊（長度固定），不直接比字串
    if (!given || (await sha256(given)) !== (await sha256(pw))) {
      fails.count += 1;
      if (fails.count >= MAX_FAILS) { fails.count = 0; fails.lockUntil = now() + LOCK_MS; }
      store.setProp('loginFails', JSON.stringify(fails));
      throw new AppError('UNAUTHORIZED', '密碼不對');
    }
    store.setProp('loginFails', JSON.stringify({ count: 0, lockUntil: 0 }));
    store.purgeSessions(now());
    const token = randomHex(32);
    store.putSession(await sha256(token), now() + SESSION_TTL_MS);
    return { token, expiresInSec: SESSION_TTL_MS / 1000 };
  }

  async function adminLogout(body) {
    if (typeof body.token === 'string' && body.token) store.deleteSession(await sha256(body.token));
    return {};
  }

  function log(action, ev) {
    store.addLog({ time: taipeiStamp(now()), action, unit: ev.unit, name: ev.name, start: ev.start, end: ev.end, id: ev.id });
  }

  function adminSave(body) {
    const clean = cleanEvent(body.event);
    const id = body.event && typeof body.event.id === 'string' ? body.event.id : '';
    const stamp = taipeiStamp(now());
    let saved;
    if (id) {
      const old = store.getEvent(id);
      if (!old) throw new AppError('NOT_FOUND', '找不到這筆活動，可能已經被刪除');
      saved = Object.assign({ id, createdAt: old.createdAt }, clean, old.batch ? { batch: old.batch } : {}, { updatedAt: stamp });
      store.putEvent(saved);
      log('修改', saved);
    } else {
      saved = Object.assign({ id: newEventId(now(), randomHex(4)) }, clean, { createdAt: stamp, updatedAt: stamp });
      store.putEvent(saved);
      log('新增', saved);
    }
    return { event: saved };
  }

  function adminDelete(body) {
    const old = typeof body.id === 'string' ? store.getEvent(body.id) : null;
    if (!old) throw new AppError('NOT_FOUND', '找不到這筆活動，可能已經被刪除');
    store.deleteEvent(old.id);
    log('刪除', old);
    return {};
  }

  /** 同一筆活動的判斷：同單位、同名稱、同開始日期與時間 */
  const dupKey = (e) => [e.unit, e.name, e.start, e.startTime || ''].join('|');

  /**
   * 批次匯入（Claude 整理好的匯入檔，管理者在後台上傳）。全部檢查通過才寫入，有一筆錯就整批不存。
   * 和現有活動重複的（同單位、名稱、開始日期與時間）跳過不重複新增。同一批有同一個 batch 代號，可以整批刪除。
   */
  function adminImport(body) {
    const list = Array.isArray(body.events) ? body.events : null;
    if (!list || !list.length) throw new AppError('BAD_REQUEST', '匯入檔裡沒有活動');
    if (list.length > MAX_IMPORT) throw new AppError('BAD_REQUEST', `一次最多匯入 ${MAX_IMPORT} 筆`);
    const errs = [];
    const cleaned = list.map((ev, i) => {
      try { return cleanEvent(ev); } catch (err) { errs.push(`第 ${i + 1} 筆：${err.message}`); return null; }
    });
    if (errs.length) throw new AppError('BAD_REQUEST', errs.slice(0, 20).join('\n') + (errs.length > 20 ? `\n⋯共 ${errs.length} 筆有錯` : ''));
    const seen = new Set(store.allEvents().map(dupKey));
    const stamp = taipeiStamp(now());
    const batch = 'B-' + stamp.replace(/\D/g, '').slice(0, 14) + '-' + randomHex(2);
    const added = [];
    let skipped = 0;
    cleaned.forEach((ev) => {
      const key = dupKey(ev);
      if (seen.has(key)) { skipped++; return; }
      seen.add(key);
      const saved = Object.assign({ id: newEventId(now(), randomHex(4)) }, ev, { batch, createdAt: stamp, updatedAt: stamp });
      store.putEvent(saved);
      added.push(saved);
    });
    if (added.length) logBatch('匯入', batch, added);
    return { batch, added: added.length, skipped };
  }

  /** 整批刪除（匯錯了、或是試用的假資料） */
  function adminDeleteBatch(body) {
    const batch = typeof body.batch === 'string' ? body.batch : '';
    const list = batch ? store.allEvents().filter((e) => e.batch === batch) : [];
    if (!list.length) throw new AppError('NOT_FOUND', '找不到這一批活動，可能已經刪除');
    list.forEach((e) => store.deleteEvent(e.id));
    logBatch('整批刪除', batch, list);
    return { deleted: list.length };
  }

  function logBatch(action, batch, list) {
    const units = [...new Set(list.map((e) => e.unit))];
    const starts = list.map((e) => e.start).sort();
    const ends = list.map((e) => e.end).sort();
    store.addLog({ time: taipeiStamp(now()), action, unit: units.join('、'), name: `${list.length} 筆活動`, start: starts[0], end: ends[ends.length - 1], batch });
  }

  const sortEvents = (list) => list.sort((a, b) => a.start.localeCompare(b.start) || (a.startTime || '').localeCompare(b.startTime || ''));

  const actions = {
    // 家人們看的：全部手動活動（Worker 快取 60 秒）
    snapshot: () => ({ events: store.allEvents().map(publicEvent) }),
    adminLogin,
    adminLogout,
    adminList: () => ({ events: sortEvents(store.allEvents()), units: editableUnits() }),
    adminSave,
    adminDelete,
    adminImport,
    adminDeleteBatch,
    adminLog: () => ({ log: store.listLog(200) }),
    adminBackup: () => ({ exportedAt: taipeiStamp(now()), events: sortEvents(store.allEvents()), log: store.listLog(2000) })
  };
  const needsLogin = { adminList: 1, adminSave: 1, adminDelete: 1, adminImport: 1, adminDeleteBatch: 1, adminLog: 1, adminBackup: 1 };

  async function call(body) {
    try {
      const fn = body && actions[body.action];
      if (!fn) throw new AppError('BAD_REQUEST', '未知的 action：' + (body && body.action ? String(body.action).slice(0, 30) : '（空白）'));
      if (needsLogin[body.action]) await requireAdmin(body);
      return { ok: true, data: await fn(body) };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
      console.error(err);
      return { ok: false, error: { code: 'INTERNAL', message: '伺服器發生錯誤，請稍後再試' } };
    }
  }

  return { call };
}
