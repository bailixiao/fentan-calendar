// 在 Durable Object 裡執行的部分：登入、帳號、教育組報名（edu.js）、手機提醒、操作紀錄。所有請求依序處理，不會兩筆同時改。
// call(body) 回傳 { ok: true, data } 或 { ok: false, error: { code, message } }。
import { AppError, taipeiStamp } from './logic.js';
import { SITE } from './site.js';
import { createEduApp } from './edu.js';
import { createPushApp } from './push-app.js';

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

const SUPER = '總管理者';
const PBKDF2_ITER = 100000; // Workers 的 PBKDF2 上限

/** 點名、各區組長帳號的密碼只存加鹽雜湊 */
async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256));
}

/** 每個 action 誰可以用（規格第 8 節）：super＝總管理者、roll＝點名帳號、region＝各區組長；沒列的不用登入 */
const PERM = {
  adminSignup: ['super', 'region'], adminCancelSignup: ['super', 'region'],
  adminRoll: ['super', 'roll'], adminRollSet: ['super', 'roll'], adminRollAdd: ['super', 'roll'], adminAttendance: ['super', 'roll'],
  adminCourses: ['super', 'roll'],
  adminCourseSave: ['super'], adminCourseDelete: ['super'], adminSessionSave: ['super'], adminSessionDelete: ['super'], adminSessionsMake: ['super'],
  adminAccounts: ['super'], adminSetAccount: ['super'], adminLog: ['super'], adminBackup: ['super'], adminOldCount: ['super'], adminPurgeOld: ['super'],
  adminPushStats: ['super'], adminPushList: ['super'], adminPushSend: ['super'], adminPushCancel: ['super']
};

/**
 * @param store createSqlStore / createMemoryStore
 * @param opts.password () => 總管理者密碼（Worker secret ADMIN_PASSWORD）
 * @param opts.now () => 現在的毫秒（測試可以換）
 * @param opts.fetch 對外連線（手機提醒）
 * @param opts.setAlarm (ms) => void（Durable Object 的 alarm，分批送通知用）
 */
export function createStoreApp(store, opts) {
  const now = opts.now || (() => Date.now());
  const password = opts.password;
  const log = (action, e) => store.addLog(Object.assign({ time: taipeiStamp(now()), action }, e));

  /** 回傳登入的是誰：''＝總管理者、'點名'、區名＝那一區的組長 */
  async function whoOf(body) {
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token) throw new AppError('UNAUTHORIZED', '請先登入');
    const hash = await sha256(token);
    const exp = store.getSession(hash);
    if (!exp || exp <= now()) {
      if (exp) store.deleteSession(hash);
      throw new AppError('UNAUTHORIZED', '登入已過期，請重新登入');
    }
    return store.getSessionWho(hash) || '';
  }
  const roleOf = (who) => (!who ? 'super' : who === SITE.roll ? 'roll' : 'region');

  // 帳號：點名（共用）＋16 區組長
  const accountNames = () => [SITE.roll].concat(SITE.units);
  const readAccount = (name) => { try { return JSON.parse(store.getProp('acct:' + name) || 'null'); } catch (e) { return null; } };
  const failKey = (account) => (account ? 'loginFails:' + account : 'loginFails');

  function readFails(account) {
    try { return JSON.parse(store.getProp(failKey(account)) || 'null') || { count: 0, lockUntil: 0 }; } catch (e) { return { count: 0, lockUntil: 0 }; }
  }

  /** 登入：總管理者（密碼是 Worker secret）、點名或某一區（密碼由總管理者設定）；輸錯 10 次暫停 15 分鐘，每個帳號分開算 */
  async function adminLogin(body) {
    const account = typeof body.account === 'string' && body.account && body.account !== SUPER ? body.account : '';
    const fails = readFails(account);
    if (fails.lockUntil > now()) {
      const min = Math.ceil((fails.lockUntil - now()) / 60e3);
      throw new AppError('LOCKED', `密碼輸錯太多次，請 ${min} 分鐘後再試`);
    }
    const given = typeof body.password === 'string' ? body.password : '';
    let ok;
    if (!account) {
      const pw = password();
      if (!pw) throw new AppError('NOT_CONFIGURED', '管理密碼還沒設定（Worker secret ADMIN_PASSWORD）');
      ok = !!given && (await sha256(given)) === (await sha256(pw)); // 比雜湊（長度固定），不直接比字串
    } else {
      const acc = accountNames().indexOf(account) !== -1 ? readAccount(account) : null;
      if (!acc) throw new AppError('UNAUTHORIZED', '這個帳號還沒有設定密碼，請聯絡教育組');
      ok = !!given && (await pbkdf2(given, acc.salt)) === acc.hash;
    }
    if (!ok) {
      fails.count += 1;
      if (fails.count >= MAX_FAILS) { fails.count = 0; fails.lockUntil = now() + LOCK_MS; }
      store.setProp(failKey(account), JSON.stringify(fails));
      throw new AppError('UNAUTHORIZED', '密碼不對');
    }
    store.setProp(failKey(account), JSON.stringify({ count: 0, lockUntil: 0 }));
    store.purgeSessions(now());
    const token = randomHex(32);
    store.putSession(await sha256(token), now() + SESSION_TTL_MS, account);
    return { token, expiresInSec: SESSION_TTL_MS / 1000, account: account || SUPER, role: roleOf(account) };
  }

  async function adminLogout(body) {
    if (typeof body.token === 'string' && body.token) store.deleteSession(await sha256(body.token));
    return {};
  }

  function adminAccounts() {
    return { accounts: accountNames().map((name) => ({ name, hasPassword: !!readAccount(name) })) };
  }

  async function adminSetAccount(body) {
    const name = typeof body.name === 'string' ? body.name : '';
    if (accountNames().indexOf(name) === -1) throw new AppError('BAD_REQUEST', '帳號不對');
    const label = name === SITE.roll ? '點名帳號' : name + '的組長帳號';
    if (body.remove) {
      store.setProp('acct:' + name, '');
      store.deleteSessionsOf(name);
      log('刪除帳號', { unit: name, name: label, start: '', end: '' });
      return { name, hasPassword: false };
    }
    const pw = typeof body.password === 'string' ? body.password : '';
    if (pw.length < 6) throw new AppError('BAD_REQUEST', '密碼至少 6 個字');
    const salt = randomHex(16);
    store.setProp('acct:' + name, JSON.stringify({ salt, hash: await pbkdf2(pw, salt) }));
    store.deleteSessionsOf(name); // 改密碼：已經登入的都登出
    log('設定帳號密碼', { unit: name, name: label, start: '', end: '' });
    return { name, hasPassword: true };
  }

  const edu = createEduApp(store, { now, randomHex, sha256, log });

  const push = createPushApp(store, {
    now,
    fetch: opts.fetch || ((...a) => fetch(...a)),
    setAlarm: opts.setAlarm || (() => {}),
    classesOn: (date) => edu.classesOn(date),
    log
  });

  // 第一版留下的活動（總務、道務、各區輪值）：下載備份後一次刪掉（規格第 9 節）
  const adminOldCount = () => ({ count: store.allEvents().length });
  function adminPurgeOld() {
    const list = store.allEvents();
    list.forEach((e) => store.deleteEvent(e.id));
    log('刪除舊資料', { unit: SITE.fentan, name: `第一版的活動 ${list.length} 筆`, start: '', end: '' });
    return { deleted: list.length };
  }

  const actions = Object.assign({
    adminLogin,
    adminLogout,
    loginAccounts: () => ({ accounts: [SUPER].concat(accountNames().filter((n) => readAccount(n))) }),
    adminAccounts,
    adminSetAccount,
    adminLog: () => ({ log: store.listLog(200) }),
    adminBackup: () => Object.assign({ exportedAt: taipeiStamp(now()) }, edu.backup(), { oldEvents: store.allEvents(), log: store.listLog(2000) }),
    adminOldCount,
    adminPurgeOld
  }, edu.actions, push.actions);

  const needsLogin = Object.assign({}, PERM, push.needsLogin);

  async function call(body) {
    try {
      const fn = body && actions[body.action];
      if (!fn) throw new AppError('BAD_REQUEST', '未知的 action：' + (body && body.action ? String(body.action).slice(0, 30) : '（空白）'));
      push.ensureDaily();
      let who = '';
      if (needsLogin[body.action]) {
        who = await whoOf(body);
        const allowed = PERM[body.action] || ['super'];
        if (allowed.indexOf(roleOf(who)) === -1) {
          throw new AppError('UNAUTHORIZED', roleOf(who) === 'roll' ? '點名帳號只能點名' : '組長帳號只能幫自己區的人報名、取消');
        }
      }
      return { ok: true, data: await fn(body, who) };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
      console.error(err);
      return { ok: false, error: { code: 'INTERNAL', message: '伺服器發生錯誤，請稍後再試' } };
    }
  }

  // alarm（每日提醒、分批送）：錯誤只記 log，不丟出去
  const quiet = (fn) => async (...a) => { try { return await fn(...a); } catch (err) { console.error(err); return null; } };
  return { call, enqueueDaily: quiet(push.enqueueDaily), alarm: quiet(push.alarm) };
}
