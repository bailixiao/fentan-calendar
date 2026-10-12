// 在 Durable Object 裡執行的部分：手動活動的讀寫、管理者登入。所有請求依序處理，不會兩筆同時改。
// call(body) 回傳 { ok: true, data } 或 { ok: false, error: { code, message } }。
import { AppError, cleanEvent, newEventId, publicEvent, taipeiStamp, editableUnits } from './logic.js';

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
      saved = Object.assign({ id, createdAt: old.createdAt }, clean, { updatedAt: stamp });
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

  const sortEvents = (list) => list.sort((a, b) => a.start.localeCompare(b.start) || (a.startTime || '').localeCompare(b.startTime || ''));

  const actions = {
    // 家人們看的：全部手動活動（Worker 快取 60 秒）
    snapshot: () => ({ events: store.allEvents().map(publicEvent) }),
    adminLogin,
    adminLogout,
    adminList: () => ({ events: sortEvents(store.allEvents()), units: editableUnits() }),
    adminSave,
    adminDelete,
    adminLog: () => ({ log: store.listLog(200) }),
    adminBackup: () => ({ exportedAt: taipeiStamp(now()), events: sortEvents(store.allEvents()), log: store.listLog(2000) })
  };
  const needsLogin = { adminList: 1, adminSave: 1, adminDelete: 1, adminLog: 1, adminBackup: 1 };

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
