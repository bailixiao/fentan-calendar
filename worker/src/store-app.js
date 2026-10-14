// 在 Durable Object 裡執行的部分：手動活動的讀寫、管理者登入。所有請求依序處理，不會兩筆同時改。
// call(body) 回傳 { ok: true, data } 或 { ok: false, error: { code, message } }。
import { AppError, cleanEvent, cleanRosterNames, deadlinesOf, newEventId, publicEvent, taipeiDate, taipeiStamp, editableUnits } from './logic.js';
import { SITE } from './site.js';
import { createPushApp } from './push-app.js';

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

const SUPER = '總管理者';
const PBKDF2_ITER = 100000; // Workers 的 PBKDF2 上限

/** 各區組長帳號的密碼只存加鹽雜湊 */
async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256));
}

/**
 * @param store createSqlStore / createMemoryStore
 * @param opts.password () => 管理密碼（Worker secret ADMIN_PASSWORD）
 * @param opts.now () => 現在的毫秒（測試可以換）
 * @param opts.fetch 對外連線（手機提醒、讀教全區）
 * @param opts.setAlarm (ms) => void（Durable Object 的 alarm，分批送通知用）
 */
export function createStoreApp(store, opts) {
  const now = opts.now || (() => Date.now());
  const password = opts.password;

  /** 回傳登入的是誰：''＝總管理者、區名＝那一區的組長帳號 */
  async function requireAdmin(body) {
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

  // 組長帳號：分壇以外的單位（16 區＋測試區）
  const accountUnits = () => editableUnits().filter((u) => u !== SITE.fentan);
  const readAccount = (unit) => { try { return JSON.parse(store.getProp('acct:' + unit) || 'null'); } catch (e) { return null; } };
  const failKey = (account) => (account ? 'loginFails:' + account : 'loginFails');

  function readFails(account) {
    try { return JSON.parse(store.getProp(failKey(account)) || 'null') || { count: 0, lockUntil: 0 }; } catch (e) { return { count: 0, lockUntil: 0 }; }
  }

  /** 登入：「總管理者」（密碼是 Worker secret）或某一區（組長帳號，密碼由總管理者設定）；輸錯 10 次暫停 15 分鐘，每個帳號分開算 */
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
      const acc = accountUnits().indexOf(account) !== -1 ? readAccount(account) : null;
      if (!acc) throw new AppError('UNAUTHORIZED', '這個帳號還沒有設定密碼，請聯絡分壇');
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
    return { token, expiresInSec: SESSION_TTL_MS / 1000, account: account || SUPER, role: account ? 'region' : 'super' };
  }

  // ---------- 各區組長填名單（規格第 9-4 節） ----------

  function adminAccounts() {
    return { accounts: accountUnits().map((unit) => ({ unit, hasPassword: !!readAccount(unit) })) };
  }

  async function adminSetAccount(body) {
    const unit = typeof body.unit === 'string' ? body.unit : '';
    if (accountUnits().indexOf(unit) === -1) throw new AppError('BAD_REQUEST', '單位不對');
    if (body.remove) {
      store.setProp('acct:' + unit, '');
      store.deleteSessionsOf(unit);
      store.addLog({ time: taipeiStamp(now()), action: '刪除帳號', unit, name: unit + '的組長帳號', start: '', end: '' });
      return { unit, hasPassword: false };
    }
    const pw = typeof body.password === 'string' ? body.password : '';
    if (pw.length < 6) throw new AppError('BAD_REQUEST', '密碼至少 6 個字');
    const salt = randomHex(16);
    store.setProp('acct:' + unit, JSON.stringify({ salt, hash: await pbkdf2(pw, salt) }));
    store.deleteSessionsOf(unit); // 改密碼：已經登入的都登出
    store.addLog({ time: taipeiStamp(now()), action: '設定帳號密碼', unit, name: unit + '的組長帳號', start: '', end: '' });
    return { unit, hasPassword: true };
  }

  /** 組長看自己區的分壇分配勤務（今天前 7 天～之後 120 天）；總管理者帶 unit 看任何一區 */
  function adminRosterList(body, who) {
    const unit = who || (typeof body.unit === 'string' ? body.unit : '');
    if (accountUnits().indexOf(unit) === -1) throw new AppError('BAD_REQUEST', '單位不對');
    const from = taipeiDate(now() - 7 * 86400e3);
    const to = taipeiDate(now() + 120 * 86400e3);
    const events = store.allEvents().filter((e) => e.unit === unit && e.kind !== '區活動' && e.end >= from && e.start <= to);
    const dl = deadlinesOf(store.allEvents().map(publicEvent));
    const today = taipeiDate(now());
    return { unit, today, events: sortEvents(events).map((e) => Object.assign(publicEvent(e), { deadline: dl[e.id] || e.deadline || '', closed: !!dl[e.id] && today > dl[e.id] })) };
  }

  function adminRosterSave(body, who) {
    const ev = typeof body.id === 'string' ? store.getEvent(body.id) : null;
    if (!ev) throw new AppError('NOT_FOUND', '找不到這筆勤務，可能已經被刪除');
    if (ev.unit === SITE.fentan || ev.kind === '區活動') throw new AppError('BAD_REQUEST', '這筆不是派給區的勤務');
    if (who && ev.unit !== who) throw new AppError('UNAUTHORIZED', '只能填自己區的名單');
    const deadline = deadlinesOf(store.allEvents().map(publicEvent))[ev.id] || '';
    if (who && deadline && taipeiDate(now()) > deadline) {
      throw new AppError('BAD_REQUEST', `已經過了截止日期（${Number(deadline.slice(5, 7))}/${Number(deadline.slice(8, 10))}），要改名單請找分壇`);
    }
    const date = typeof body.date === 'string' ? body.date : '';
    if (!date || date < ev.start || date > ev.end) throw new AppError('BAD_REQUEST', '日期不在這筆勤務的期間');
    const key = typeof body.key === 'string' ? body.key : '';
    const keys = (ev.positions || []).length ? ev.positions.map((q) => q.id) : ['_'];
    if (keys.indexOf(key) === -1) throw new AppError('BAD_REQUEST', '了愿項目不對');
    const names = cleanRosterNames(body.names);
    const roster = Object.assign({}, ev.roster || {});
    const day = Object.assign({}, roster[date] || {});
    if (names.length) day[key] = names; else delete day[key];
    if (Object.keys(day).length) roster[date] = day; else delete roster[date];
    ev.roster = roster;
    store.putEvent(ev);
    store.addLog({ time: taipeiStamp(now()), action: '填名單', unit: ev.unit, name: `${ev.name}：${names.length} 人（${who ? who + '組長' : SUPER}）`, start: date, end: date, id: ev.id });
    return { event: publicEvent(ev) };
  }

  async function adminLogout(body) {
    if (typeof body.token === 'string' && body.token) store.deleteSession(await sha256(body.token));
    return {};
  }

  function log(action, ev) {
    store.addLog({ time: taipeiStamp(now()), action, unit: ev.unit, name: ev.name, start: ev.start, end: ev.end, id: ev.id });
  }

  const newPositionId = () => 'P-' + taipeiDate(now()).replace(/-/g, '') + '-' + randomHex(3);

  function adminSave(body) {
    const id = body.event && typeof body.event.id === 'string' ? body.event.id : '';
    // 新增時可以一次派給好幾區（units）：每區各一筆，同一個批號（規格第 9-2 節）
    const units = !id && body.event && Array.isArray(body.event.units) ? [...new Set(body.event.units.map(String))] : null;
    // 勾志工團、烹飪團的組派的：每區的組別不一樣（groupOf：區 → 「志工團第 3、4 組」）
    const groupOf = (u) => {
      const map = body.event && body.event.groupOf && typeof body.event.groupOf === 'object' ? body.event.groupOf : {};
      return typeof map[u] === 'string' ? map[u] : (body.event.group || '');
    };
    if (units && units.length > 1) {
      if (units.length > 17) throw new AppError('BAD_REQUEST', '單位太多了');
      const positions = cleanEvent(Object.assign({}, body.event, { unit: units[0] }), newPositionId).positions; // 各區用同一組了愿項目代號
      const cleaned = units.map((u) => Object.assign(cleanEvent(Object.assign({}, body.event, { unit: u, positions, group: groupOf(u) })), { positions }));
      const stamp = taipeiStamp(now());
      const batch = 'B-' + stamp.replace(/\D/g, '').slice(0, 14) + '-' + randomHex(2);
      const list = cleaned.map((c) => Object.assign({ id: newEventId(now(), randomHex(4)) }, c, { batch, createdAt: stamp, updatedAt: stamp }));
      list.forEach((ev) => store.putEvent(ev));
      store.addLog({ time: stamp, action: '新增', unit: units.join('、'), name: list[0].name, start: list[0].start, end: list[0].end, batch });
      return { event: list[0], events: list };
    }
    const clean = cleanEvent(units && units.length === 1 ? Object.assign({}, body.event, { unit: units[0], group: groupOf(units[0]) }) : body.event, newPositionId);
    const stamp = taipeiStamp(now());
    let saved;
    if (id) {
      const old = store.getEvent(id);
      if (!old) throw new AppError('NOT_FOUND', '找不到這筆活動，可能已經被刪除');
      saved = Object.assign({ id, createdAt: old.createdAt }, clean, old.batch ? { batch: old.batch } : {}, old.roster ? { roster: old.roster } : {},
        old.parentId && clean.unit !== SITE.fentan ? { parentId: old.parentId, dutyId: old.dutyId || '' } : {}, { updatedAt: stamp });
      store.putEvent(saved);
      log('修改', saved);
    } else {
      saved = Object.assign({ id: newEventId(now(), randomHex(4)) }, clean, { createdAt: stamp, updatedAt: stamp });
      store.putEvent(saved);
      log('新增', saved);
    }
    const children = saved.unit === SITE.fentan ? syncChildren(saved, body.event, stamp) : null;
    return children ? { event: saved, children } : { event: saved };
  }

  /**
   * 分壇活動的分工 → 各區勤務（規格第 9-5 節）。assign：[{ id?, unit, dutyId, group }]，每一項、每一區一筆；
   * 已經有的（同一個 id，或同一項分工同一區）就改，名單留著；沒列到的這筆活動自己的勤務刪掉；drop 是要拿掉的舊資料（用名稱掛上的）。
   * 沒送 assign（例如匯入）就不動。
   */
  function syncChildren(parent, input, stamp) {
    const assign = input && Array.isArray(input.assign) ? input.assign : null;
    if (!assign) return null;
    if (assign.length > 300) throw new AppError('BAD_REQUEST', '分工太多了');
    const all = store.allEvents();
    const byId = new Map(all.map((e) => [e.id, e]));
    const mine = all.filter((e) => e.parentId === parent.id);
    const units = editableUnits();
    const used = new Set();
    const seen = new Set();
    const saved = [];
    assign.forEach((a) => {
      const unit = a && typeof a.unit === 'string' ? a.unit : '';
      if (unit === SITE.fentan || units.indexOf(unit) === -1) throw new AppError('BAD_REQUEST', '分工的單位不對：' + unit.slice(0, 20));
      const duty = (parent.duties || []).find((d) => d.id === a.dutyId);
      if (!duty) throw new AppError('BAD_REQUEST', '分工資料不對，請重新整理再試一次');
      if (seen.has(duty.id + '|' + unit)) return;
      seen.add(duty.id + '|' + unit);
      let old = typeof a.id === 'string' ? byId.get(a.id) || null : null;
      if (old && (old.unit !== unit || used.has(old.id) || (old.parentId && old.parentId !== parent.id))) old = null;
      if (!old) old = mine.find((e) => e.dutyId === duty.id && e.unit === unit && !used.has(e.id)) || null;
      // 了愿項目：一項（工作名稱、需要人數）；舊資料自己有別的了愿項目就照舊。名單從「_」搬到這一項
      const ours = old && (old.positions || []).length && !(old.positions.length === 1 && old.positions[0].id === duty.posId);
      const roster = old && old.roster ? JSON.parse(JSON.stringify(old.roster)) : {};
      if (!ours) Object.keys(roster).forEach((d) => { if (roster[d]._) { roster[d][duty.posId] = roster[d]._; delete roster[d]._; } });
      const ev = Object.assign({ dress: '', deadline: '', note: '', link: '' }, old || {}, {
        id: old ? old.id : newEventId(now(), randomHex(4)),
        unit, category: '勤務', kind: '分壇分配', name: `${duty.work}：${parent.name}`,
        group: typeof a.group === 'string' ? a.group.trim().slice(0, 60) : '',
        start: parent.start, end: parent.end, startTime: parent.startTime || '', endTime: parent.endTime || '', location: parent.location || '',
        positions: ours ? old.positions : [{ id: duty.posId, name: duty.work, min: duty.min, max: null }],
        roster, parentId: parent.id, dutyId: duty.id, createdAt: old ? old.createdAt : stamp, updatedAt: stamp
      });
      used.add(ev.id);
      store.putEvent(ev);
      saved.push(ev);
    });
    const drop = new Set(Array.isArray(input.drop) ? input.drop.filter((x) => typeof x === 'string') : []);
    const removed = all.filter((e) => !used.has(e.id) && e.unit !== SITE.fentan && (e.parentId === parent.id || (!e.parentId && drop.has(e.id))));
    removed.forEach((e) => store.deleteEvent(e.id));
    if (saved.length || removed.length) {
      store.addLog({ time: stamp, action: '分工', unit: [...new Set(saved.map((e) => e.unit))].join('、') || SITE.fentan,
        name: `${parent.name}：${saved.length} 筆${removed.length ? `，拿掉 ${removed.length} 筆` : ''}`, start: parent.start, end: parent.end, id: parent.id });
    }
    return saved;
  }

  function adminDelete(body) {
    const old = typeof body.id === 'string' ? store.getEvent(body.id) : null;
    if (!old) throw new AppError('NOT_FOUND', '找不到這筆活動，可能已經被刪除');
    store.deleteEvent(old.id);
    log('刪除', old);
    // 分壇活動刪掉：在它裡面排的分工（各區勤務）一起刪
    const children = old.unit === SITE.fentan ? store.allEvents().filter((e) => e.parentId === old.id) : [];
    children.forEach((e) => { store.deleteEvent(e.id); log('刪除', e); });
    return { deleted: 1 + children.length };
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

  const push = createPushApp(store, {
    now,
    fetch: opts.fetch || ((...a) => fetch(...a)),
    setAlarm: opts.setAlarm || (() => {}),
    localEvents: () => store.allEvents().map(publicEvent),
    log: (action, e) => store.addLog(Object.assign({ time: taipeiStamp(now()), action }, e))
  });

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
    adminBackup: () => ({ exportedAt: taipeiStamp(now()), events: sortEvents(store.allEvents()), log: store.listLog(2000) }),
    loginAccounts: () => ({ accounts: [SUPER].concat(accountUnits().filter((u) => readAccount(u))) }),
    adminAccounts,
    adminSetAccount,
    adminRosterList,
    adminRosterSave,
    ...push.actions
  };
  const needsLogin = Object.assign({ adminList: 1, adminSave: 1, adminDelete: 1, adminImport: 1, adminDeleteBatch: 1, adminLog: 1, adminBackup: 1,
    adminAccounts: 1, adminSetAccount: 1, adminRosterList: 1, adminRosterSave: 1 }, push.needsLogin);
  const REGION_OK = { adminRosterList: 1, adminRosterSave: 1 }; // 組長帳號只能做這些

  async function call(body) {
    try {
      const fn = body && actions[body.action];
      if (!fn) throw new AppError('BAD_REQUEST', '未知的 action：' + (body && body.action ? String(body.action).slice(0, 30) : '（空白）'));
      push.ensureDaily();
      let who = '';
      if (needsLogin[body.action]) {
        who = await requireAdmin(body);
        if (who && !REGION_OK[body.action]) throw new AppError('UNAUTHORIZED', '組長帳號只能填名單');
      }
      return { ok: true, data: await fn(body, who) };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
      console.error(err);
      return { ok: false, error: { code: 'INTERNAL', message: '伺服器發生錯誤，請稍後再試' } };
    }
  }

  // cron（每日提醒）、alarm（分批送）：錯誤只記 log，不丟出去
  const quiet = (fn) => async (...a) => { try { return await fn(...a); } catch (err) { console.error(err); return null; } };
  return { call, enqueueDaily: quiet(push.enqueueDaily), alarm: quiet(push.alarm) };
}
