// 手機提醒在 Durable Object 裡的部分：訂閱、收件匣、管理者發的通知、每日提醒、分批送出（規格第 10-1 節）。
// 送出流程：工作（job）放進 jobs 表 → alarm 每次送一批（40 支）→ 還有就再排下一次 alarm，直到送完。
import { SITE } from './site.js';
import { AppError, taipeiDate, taipeiStamp } from './logic.js';
import { dailyContent, eventsForUnit, generateVapidKeys, pushIdOf, sendEmptyPush, validEndpoint } from './push.js';

export const BATCH = 40; // 一批送幾支（Cloudflare 免費方案一次執行最多對外連 50 次）
const INBOX_TTL_MS = 12 * 3600e3;
const TEST_WAIT_MS = 30e3;
const MAX_SUBS = 50000;
const TITLE_MAX = 40;
const BODY_MAX = 200;
const ALL_UNITS = [SITE.fentan].concat(SITE.units);

/** ms 之後的下一次每日提醒：台北 07:00 提醒今天（today）、20:00 提醒明天（tomorrow） */
export function nextDaily(ms) {
  const TPE = 8 * 3600e3;
  const dayStart = Math.floor((ms + TPE) / 86400e3) * 86400e3 - TPE; // 台北當天 00:00
  const list = [];
  [0, 1].forEach((d) => {
    list.push({ at: dayStart + d * 86400e3 + 7 * 3600e3, when: 'today' });
    list.push({ at: dayStart + d * 86400e3 + 20 * 3600e3, when: 'tomorrow' });
  });
  return list.filter((x) => x.at > ms).sort((a, b) => a.at - b.at)[0];
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param store 資料存放
 * @param opts.now () => 毫秒
 * @param opts.fetch 對外連線（送推播、讀教全區）
 * @param opts.setAlarm (ms) => void（Durable Object 的 alarm；測試用假的）
 * @param opts.classesOn (date) => 那一天有上課的班（每日提醒用；規格第 10 節）
 * @param opts.log (action, entry) => void 寫操作紀錄
 */
export function createPushApp(store, opts) {
  const now = opts.now;
  const fetchFn = opts.fetch;

  async function keys() {
    const saved = store.getProp('vapid');
    if (saved) return JSON.parse(saved);
    const k = await generateVapidKeys();
    store.setProp('vapid', JSON.stringify(k));
    return k;
  }

  function checkUnit(unit) {
    if (ALL_UNITS.indexOf(unit) === -1) throw new AppError('BAD_REQUEST', '請選擇要收哪個單位的提醒');
    return unit;
  }

  async function subFromBody(body) {
    if (!validEndpoint(body.endpoint)) throw new AppError('BAD_REQUEST', '這支手機的提醒網址不正確，請關閉後重新開啟');
    return { id: await pushIdOf(body.endpoint), endpoint: body.endpoint };
  }

  // ---------- 排下一次 alarm ----------
  // 每日提醒也用 alarm（Cloudflare 免費方案整個帳號最多 5 個 cron，教全區已經用掉了）：
  // 「下一次每日提醒」記在 props 的 daily，alarm 設在它和送出工作之中比較早的那個。

  function readDaily() {
    try { return JSON.parse(store.getProp('daily') || 'null'); } catch (e) { return null; }
  }

  function schedule() {
    const daily = readDaily();
    const job = store.nextJobTime();
    const times = [job, daily && daily.at].filter((t) => t !== null && t !== undefined);
    if (times.length) opts.setAlarm(Math.max(Math.min(...times), now()));
  }

  /** 每個請求都會呼叫：還沒排每日提醒就排上（第一次部署後、資料被清掉時） */
  function ensureDaily() {
    if (readDaily()) return;
    store.setProp('daily', JSON.stringify(nextDaily(now())));
    schedule();
  }

  // ---------- 家人們 ----------

  const actions = {
    pushKey: async () => ({ publicKey: (await keys()).publicKey }),

    async pushSubscribe(body) {
      const { id, endpoint } = await subFromBody(body);
      const unit = checkUnit(body.unit);
      const old = store.getSub(id);
      if (!old) {
        const total = Object.values(store.subCounts()).reduce((a, b) => a + b, 0);
        if (total >= MAX_SUBS) throw new AppError('BUSY', '開啟提醒的手機太多了，請聯絡管理者');
      }
      store.putSub({ id, endpoint, unit, createdAt: old ? old.createdAt : taipeiStamp(now()), lastTest: old ? old.lastTest || 0 : 0 });
      return { unit };
    },

    async pushUnsubscribe(body) {
      const { id } = await subFromBody(body);
      store.deleteSub(id);
      return {};
    },

    async pushTest(body) {
      const { id } = await subFromBody(body);
      const sub = store.getSub(id);
      if (!sub) throw new AppError('NOT_FOUND', '這支手機還沒開啟提醒');
      if (now() - (sub.lastTest || 0) < TEST_WAIT_MS) throw new AppError('BUSY', '剛剛才傳過，請等 30 秒再試');
      sub.lastTest = now();
      store.putSub(sub);
      store.addInbox(id, { title: '🔔 測試通知', body: `已經可以收到${SITE.name}的提醒了 😊\n（教育組的課）`, url: '#/' }, now() + INBOX_TTL_MS);
      const [res] = await sendEmptyPush(fetchFn, await keys(), [sub], Math.floor(now() / 1000));
      if (res.gone) {
        store.deleteSub(id);
        throw new AppError('GONE', '這支手機的提醒已失效，請關閉後重新開啟');
      }
      if (!res.ok) throw new AppError('PUSH', `推播服務暫時無法使用（${res.code}），請稍後再試`);
      return {};
    },

    /** sw.js 收到推播後來問要顯示什麼（id＝推播網址雜湊的前 16 碼） */
    pushSummary(body) {
      const id = typeof body.id === 'string' && /^[0-9a-f]{16}$/.test(body.id) ? body.id : '';
      const content = id ? store.takeInbox(id, now()) : null;
      return { message: content };
    },

    // ---------- 管理者 ----------

    adminPushStats: () => ({ counts: store.subCounts(), units: ALL_UNITS }),

    adminPushList: () => ({ messages: store.listMsgs(50) }),

    adminPushSend(body) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const text = typeof body.body === 'string' ? body.body.trim().replace(/\r\n?/g, '\n') : '';
      const errs = [];
      if (!title) errs.push('請填標題');
      if (title.length > TITLE_MAX) errs.push(`標題最多 ${TITLE_MAX} 字`);
      if (!text) errs.push('請填內容');
      if (text.length > BODY_MAX) errs.push(`內容最多 ${BODY_MAX} 字`);
      let target;
      if (body.target === 'all') target = 'all';
      else if (Array.isArray(body.target) && body.target.length && body.target.every((u) => ALL_UNITS.indexOf(u) !== -1)) target = [...new Set(body.target)];
      else errs.push('請選擇要發給誰');
      let sendAt = now();
      if (body.sendAt !== undefined && body.sendAt !== null && body.sendAt !== '') {
        sendAt = Number(body.sendAt);
        if (!isFinite(sendAt) || sendAt < now() + 10 * 60e3 - 60e3 || sendAt > now() + 30 * 86400e3) errs.push('排定時間要在 10 分鐘後到 30 天內');
      }
      if (errs.length) throw new AppError('BAD_REQUEST', errs.join('；'));
      const id = 'M-' + taipeiStamp(now()).replace(/\D/g, '').slice(0, 14) + '-' + randomHex(2);
      const scheduled = sendAt > now() + 30e3;
      const msg = { id, title, body: text, target, sendAt, createdAt: taipeiStamp(now()), status: scheduled ? '排定' : '送出中', sent: 0, failed: 0 };
      store.putMsg(msg);
      store.putJob({ id: 'J-' + id, kind: 'msg', msgId: id, runAt: sendAt, cursor: '' });
      opts.log(scheduled ? '排定通知' : '發通知', { unit: target === 'all' ? '全部' : target.join('、'), name: title, start: taipeiDate(sendAt), end: taipeiDate(sendAt) });
      schedule();
      return { message: msg };
    },

    adminPushCancel(body) {
      const msg = typeof body.id === 'string' ? store.getMsg(body.id) : null;
      if (!msg) throw new AppError('NOT_FOUND', '找不到這則通知');
      if (msg.status !== '排定') throw new AppError('BAD_REQUEST', '只有還沒送出的通知可以取消');
      msg.status = '已取消';
      store.putMsg(msg);
      store.deleteJob('J-' + msg.id);
      opts.log('取消通知', { unit: msg.target === 'all' ? '全部' : msg.target.join('、'), name: msg.title, start: taipeiDate(msg.sendAt), end: taipeiDate(msg.sendAt) });
      return { message: msg };
    }
  };

  // ---------- 每日提醒（cron 觸發） ----------

  /** when：'today'（早上 7 點）| 'tomorrow'（晚上 8 點） */
  async function enqueueDaily(when) {
    const date = taipeiDate(now() + (when === 'tomorrow' ? 86400e3 : 0));
    const all = opts.classesOn(date);
    const contents = {};
    ALL_UNITS.forEach((u) => {
      const c = dailyContent(eventsForUnit(all, u), when, date);
      if (c) contents[u] = c;
    });
    const units = Object.keys(contents);
    if (!units.length) return { units: 0 };
    store.putJob({ id: `J-daily-${date}-${when}`, kind: 'daily', contents, units, runAt: now(), cursor: '' });
    schedule();
    return { units: units.length };
  }

  // ---------- alarm：一次送一批 ----------

  async function alarm() {
    // 每日提醒的時間到了：排下一次，再把這次的工作放進去（遲到超過 2 小時就不送了）
    const daily = readDaily();
    if (daily && daily.at <= now()) {
      store.setProp('daily', JSON.stringify(nextDaily(now())));
      if (now() - daily.at < 2 * 3600e3) await enqueueDaily(daily.when);
    }
    let budget = BATCH;
    const k = await keys();
    for (const job of store.dueJobs(now())) {
      if (budget <= 0) break;
      const msg = job.kind === 'msg' ? store.getMsg(job.msgId) : null;
      if (job.kind === 'msg' && (!msg || msg.status === '已取消')) { store.deleteJob(job.id); continue; }
      const units = job.kind === 'daily' ? job.units : msg.target === 'all' ? null : msg.target;
      const want = budget;
      const subs = store.subsAfter(job.cursor, units, want);
      if (msg && msg.status === '排定') msg.status = '送出中';
      subs.forEach((s) => {
        const content = job.kind === 'daily' ? job.contents[s.unit] : { title: msg.title, body: msg.body, url: '#/' };
        store.addInbox(s.id, content, now() + INBOX_TTL_MS);
      });
      const results = subs.length ? await sendEmptyPush(fetchFn, k, subs, Math.floor(now() / 1000)) : [];
      results.forEach((r) => { if (r.gone) store.deleteSub(r.id); });
      budget -= subs.length;
      if (msg) {
        msg.sent += results.filter((r) => r.ok).length;
        msg.failed += results.filter((r) => !r.ok).length;
      }
      if (subs.length < want) {
        // 拿到的比要的少：這個工作送完了
        store.deleteJob(job.id);
        if (msg) msg.status = '已送出';
      } else {
        job.cursor = subs[subs.length - 1].id;
        job.runAt = now();
        store.putJob(job);
      }
      if (msg) store.putMsg(msg);
    }
    schedule();
  }

  return { actions, enqueueDaily, alarm, ensureDaily, needsLogin: { adminPushStats: 1, adminPushList: 1, adminPushSend: 1, adminPushCancel: 1 } };
}
