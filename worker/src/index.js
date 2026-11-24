// Cloudflare Worker 入口。
//   - 前門（front.js）在每個 Worker 裡跑，讀取有記憶體快取，大部分請求不用進 Durable Object。
//   - 手動活動、登入、手機提醒存在同一個 Durable Object（CalendarStore）的 SQLite，請求依序處理。
//   - 手機提醒：每日提醒（台北 07:00、20:00）和分批送出都用 Durable Object 的 alarm（免費方案整個帳號最多 5 個 cron，教全區已用掉）。
import { DurableObject } from 'cloudflare:workers';
import { createFront } from './front.js';
import { createStoreApp } from './store-app.js';
import { createSqlStore } from './store.js';

export class CalendarStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.app = createStoreApp(createSqlStore(ctx.storage), {
      password: () => env.ADMIN_PASSWORD || '',
      setAlarm: (ms) => ctx.storage.setAlarm(ms)
    });
  }

  /** 前門用 RPC 呼叫：body 同 API 的內容，回傳 { ok, data | error } */
  call(body) {
    return this.app.call(body);
  }

  /** 每日提醒時間到了、或送下一批通知。停用中（PAUSED）：什麼都不送，也不再排下一次 */
  alarm() {
    if (this.env.PAUSED) return null;
    return this.app.alarm();
  }
}

function stub(env) {
  // 第一次建立時放在亞太區（離台灣近）
  return env.STORE.get(env.STORE.idFromName('main'), { locationHint: 'apac' });
}

let front = null; // 同一個 Worker 執行個體重複使用（記憶體快取才有用）

export default {
  fetch(request, env, ctx) {
    // 2026-11-24 專案取消：停用（資料留著）。要恢復就把 wrangler.toml 的 PAUSED 拿掉再部署
    if (env.PAUSED) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'PAUSED', message: '分壇教育組報名已停用' } }), {
        status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }
    if (!front) front = createFront({ callStore: (body) => stub(env).call(body) });
    return front.handle(request, ctx);
  }
};
