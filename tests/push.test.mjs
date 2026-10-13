// 手機提醒的測試：記憶體版的資料存放、假的推播服務與教全區，不連網。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFront } from '../worker/src/front.js';
import { createStoreApp } from '../worker/src/store-app.js';
import { createMemoryStore } from '../worker/src/store.js';
import { validEndpoint, vapidJwt, generateVapidKeys, pushIdOf, dailyContent, eventsForUnit } from '../worker/src/push.js';
import { BATCH } from '../worker/src/push-app.js';

const EP = (n) => `https://fcm.googleapis.com/fcm/send/test-device-${String(n).padStart(4, '0')}`;

function setup(o = {}) {
  let t = Date.parse('2026-10-13T11:00:00Z'); // 台北 19:00
  const clock = { now: () => t, add: (ms) => { t += ms; } };
  const pushed = [];
  const alarms = [];
  let pushStatus = o.pushStatus || (() => 201);
  const fakeFetch = async (url, init) => {
    if (url.startsWith('https://duty-calendar-api')) {
      const date = new URL(url).searchParams.get('from');
      return { ok: true, json: async () => ({ ok: true, data: { contact: '測試甲', duties: [{ id: 'D-9', name: '教全區打掃', category: '勤務', mode: '報名型', start: date, end: date, startTime: '08:00', location: '區中心', groupLeader: '測試乙' }] } }) };
    }
    pushed.push({ url, headers: init.headers });
    return { status: pushStatus(url) };
  };
  const store = createMemoryStore();
  const app = createStoreApp(store, { password: () => 'test-pass', now: clock.now, fetch: fakeFetch, setAlarm: (ms) => alarms.push(ms) });
  const front = createFront({ callStore: (b) => app.call(JSON.parse(JSON.stringify(b))), fetch: fakeFetch, now: clock.now });
  const post = async (body) => (await front.handle(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }))).json();
  const get = async (q) => (await front.handle(new Request('http://x/?' + q))).json();
  const login = async () => (await post({ action: 'adminLogin', password: 'test-pass' })).data.token;
  const runAlarms = async () => { let n = 0; while (alarms.length && n < 50) { alarms.length = 0; await app.alarm(); n++; } return n; };
  return { clock, store, app, pushed, alarms, post, get, login, runAlarms, setPushStatus: (f) => { pushStatus = f; } };
}

test('推播網址：只接受各家推播服務', () => {
  assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(validEndpoint('https://web.push.apple.com/QGx'));
  assert.ok(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(validEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x'));
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://push.apple.com.evil.io/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'javascript:alert(1)', '', null]) {
    assert.equal(validEndpoint(bad), false, String(bad));
  }
});

test('VAPID：簽章用公鑰驗得過', async () => {
  const k = await generateVapidKeys();
  const jwt = await vapidJwt('https://fcm.googleapis.com', k.privateJwk, 1800000000);
  const [h, p, sig] = jwt.split('.');
  const dec = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const payload = JSON.parse(new TextDecoder().decode(dec(p)));
  assert.equal(payload.aud, 'https://fcm.googleapis.com');
  assert.equal(payload.exp, 1800000000 + 12 * 3600);
  const pub = await crypto.subtle.importKey('raw', dec(k.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, dec(sig), new TextEncoder().encode(h + '.' + p)));
  assert.equal(dec(k.publicKey).length, 65);
});

test('每日提醒內容：選區＝那一區＋分壇；選分壇＝只有分壇；最多列 4 項', () => {
  const ev = [
    { unit: '分壇', name: '分壇法會', start: '2026-10-14', end: '2026-10-14', startTime: '09:00', location: '分壇佛堂' },
    { unit: '教真區', name: '研究班', start: '2026-10-14', end: '2026-10-14', startTime: '19:30', location: '' },
    { unit: '教善區', name: '讀經班', start: '2026-10-14', end: '2026-10-14', startTime: '', location: '' }
  ];
  assert.deepEqual(eventsForUnit(ev, '分壇').map((e) => e.name), ['分壇法會']);
  assert.deepEqual(eventsForUnit(ev, '教真區').map((e) => e.name), ['分壇法會', '研究班']);
  const c = dailyContent(eventsForUnit(ev, '教真區'), 'tomorrow', '2026-10-14');
  assert.equal(c.title, '🙏 明天的活動（10/14 三）');
  assert.equal(c.body, '09:00 分壇法會（分壇佛堂）\n19:30 研究班');
  assert.equal(dailyContent([], 'today', '2026-10-14'), null);
  const many = Array.from({ length: 6 }, (_, i) => ({ unit: '分壇', name: '活動' + i, start: '2026-10-14', end: '2026-10-14' }));
  assert.match(dailyContent(many, 'today', '2026-10-14').body, /⋯還有 2 項$/);
});

test('開啟、改單位、關閉；不接受怪網址和不存在的單位', async () => {
  const env = setup();
  let r = await env.post({ action: 'pushSubscribe', endpoint: EP(1), unit: '教真區' });
  assert.equal(r.ok, true);
  r = await env.post({ action: 'pushSubscribe', endpoint: EP(1), unit: '分壇' });
  assert.equal(env.store.getSub(await pushIdOf(EP(1))).unit, '分壇');
  r = await env.post({ action: 'pushSubscribe', endpoint: 'https://evil.example.com/x', unit: '分壇' });
  assert.equal(r.error.code, 'BAD_REQUEST');
  r = await env.post({ action: 'pushSubscribe', endpoint: EP(2), unit: '不存在區' });
  assert.equal(r.error.code, 'BAD_REQUEST');
  await env.post({ action: 'pushUnsubscribe', endpoint: EP(1) });
  assert.equal(env.store.getSub(await pushIdOf(EP(1))), null);
});

test('測試通知：送空的推播（VAPID 標頭）、手機拿得到內容一次、30 秒內不能再傳、失效的刪掉', async () => {
  const env = setup();
  await env.post({ action: 'pushSubscribe', endpoint: EP(1), unit: '教善區' });
  let r = await env.post({ action: 'pushTest', endpoint: EP(1) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(env.pushed.length, 1);
  assert.equal(env.pushed[0].url, EP(1));
  assert.match(env.pushed[0].headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
  assert.equal(env.pushed[0].headers['Content-Length'], '0');
  const key = (await env.get('action=pushKey')).data.publicKey;
  assert.ok(env.pushed[0].headers.Authorization.endsWith('k=' + key));
  const id = await pushIdOf(EP(1));
  r = await env.get('action=pushSummary&id=' + id);
  assert.equal(r.data.message.title, '🔔 測試通知');
  assert.match(r.data.message.body, /教善區＋分壇/);
  r = await env.get('action=pushSummary&id=' + id);
  assert.equal(r.data.message, null); // 拿過就沒了
  r = await env.post({ action: 'pushTest', endpoint: EP(1) });
  assert.equal(r.error.code, 'BUSY');
  env.clock.add(31e3);
  env.setPushStatus(() => 410);
  r = await env.post({ action: 'pushTest', endpoint: EP(1) });
  assert.equal(r.error.code, 'GONE');
  assert.equal(env.store.getSub(id), null);
});

test('每日提醒：依單位送、沒有活動的單位不送、教全區包含教全區的活動、分批送完', async () => {
  const env = setup();
  const token = await env.login();
  await env.post({ action: 'adminSave', token, event: { unit: '分壇', category: '道務', name: '分壇法會', start: '2026-10-14', startTime: '09:00', location: '分壇佛堂' } });
  await env.post({ action: 'adminSave', token, event: { unit: '教真區', category: '道務', name: '教真區研究班', start: '2026-10-14', startTime: '19:30' } });
  // 95 支選教真區、3 支選教全區、2 支選分壇、1 支選教善區
  for (let i = 0; i < 95; i++) await env.post({ action: 'pushSubscribe', endpoint: EP(i), unit: '教真區' });
  for (let i = 95; i < 98; i++) await env.post({ action: 'pushSubscribe', endpoint: EP(i), unit: '教全區' });
  for (let i = 98; i < 100; i++) await env.post({ action: 'pushSubscribe', endpoint: EP(i), unit: '分壇' });
  await env.post({ action: 'pushSubscribe', endpoint: EP(100), unit: '教善區' });
  const r = await env.app.enqueueDaily('tomorrow');
  assert.equal(r.units, 17); // 分壇有活動 → 每個單位都有東西
  const rounds = await env.runAlarms();
  assert.equal(env.pushed.length, 101);
  assert.ok(rounds >= Math.ceil(101 / BATCH), '分批送：' + rounds);
  const summary = async (n) => (await env.get('action=pushSummary&id=' + await pushIdOf(EP(n)))).data.message;
  const zhen = await summary(0);
  assert.equal(zhen.title, '🙏 明天的活動（10/14 三）');
  assert.equal(zhen.body, '09:00 分壇法會（分壇佛堂）\n19:30 教真區研究班');
  assert.equal((await summary(98)).body, '09:00 分壇法會（分壇佛堂）');
  const jq = await summary(95);
  assert.match(jq.body, /教全區打掃（區中心）/);
  assert.ok(!JSON.stringify(jq).includes('測試乙'));
});

test('每日提醒：那天完全沒有活動就不送', async () => {
  const env = setup();
  await env.post({ action: 'pushSubscribe', endpoint: EP(1), unit: '教善區' });
  const r = await env.app.enqueueDaily('today');
  assert.equal(r.units, 1); // 只有教全區（假的教全區每天都有）
  await env.runAlarms();
  assert.equal(env.pushed.length, 0);
});

test('管理者發通知：發給某幾區、全部；排定、取消；沒登入不行', async () => {
  const env = setup();
  for (let i = 0; i < 3; i++) await env.post({ action: 'pushSubscribe', endpoint: EP(i), unit: '教真區' });
  for (let i = 3; i < 5; i++) await env.post({ action: 'pushSubscribe', endpoint: EP(i), unit: '教善區' });
  await env.post({ action: 'pushSubscribe', endpoint: EP(5), unit: '分壇' });
  let r = await env.post({ action: 'adminPushSend', title: 'x', body: 'y', target: 'all' });
  assert.equal(r.error.code, 'UNAUTHORIZED');
  const token = await env.login();
  r = await env.post({ action: 'adminPushStats', token });
  assert.deepEqual(r.data.counts, { 教真區: 3, 教善區: 2, 分壇: 1 });
  r = await env.post({ action: 'adminPushSend', token, title: '', body: '', target: [] });
  assert.match(r.error.message, /請填標題；請填內容；請選擇要發給誰/);
  r = await env.post({ action: 'adminPushSend', token, title: '統班改地點', body: '這週統班改在彌勒山', target: ['教善區', '分壇'] });
  assert.equal(r.data.message.status, '送出中');
  await env.runAlarms();
  assert.deepEqual(env.pushed.map((p) => p.url).sort(), [EP(3), EP(4), EP(5)]);
  assert.equal((await env.get('action=pushSummary&id=' + await pushIdOf(EP(3)))).data.message.title, '統班改地點');
  r = await env.post({ action: 'adminPushList', token });
  assert.equal(r.data.messages[0].status, '已送出');
  assert.equal(r.data.messages[0].sent, 3);
  // 發給全部
  env.pushed.length = 0;
  await env.post({ action: 'adminPushSend', token, title: '全部', body: '大家好', target: 'all' });
  await env.runAlarms();
  assert.equal(env.pushed.length, 6);
  // 排定：時間太近不行；排好後時間到才送；取消後不送
  r = await env.post({ action: 'adminPushSend', token, title: '排定', body: '明天見', target: 'all', sendAt: env.clock.now() + 60e3 });
  assert.match(r.error.message, /10 分鐘後/);
  r = await env.post({ action: 'adminPushSend', token, title: '排定', body: '明天見', target: ['教真區'], sendAt: env.clock.now() + 3600e3 });
  assert.equal(r.data.message.status, '排定');
  const scheduledId = r.data.message.id;
  env.pushed.length = 0;
  await env.app.alarm();
  assert.equal(env.pushed.length, 0); // 時間還沒到
  env.clock.add(3600e3);
  await env.app.alarm();
  assert.equal(env.pushed.length, 3);
  r = await env.post({ action: 'adminPushCancel', token, id: scheduledId });
  assert.equal(r.error.code, 'BAD_REQUEST'); // 已經送出了
  r = await env.post({ action: 'adminPushSend', token, title: '要取消的', body: '不會送', target: 'all', sendAt: env.clock.now() + 3600e3 });
  await env.post({ action: 'adminPushCancel', token, id: r.data.message.id });
  env.pushed.length = 0;
  env.clock.add(3600e3);
  await env.app.alarm();
  assert.equal(env.pushed.length, 0);
  r = await env.post({ action: 'adminLog', token });
  assert.deepEqual(r.data.log.slice(0, 4).map((l) => l.action), ['取消通知', '排定通知', '排定通知', '發通知']);
});

test('每日提醒的時間：台北 07:00（今天）、20:00（明天）', async () => {
  const { nextDaily } = await import('../worker/src/push-app.js');
  const tpe = (s) => Date.parse(s + '+08:00');
  assert.deepEqual(nextDaily(tpe('2026-10-13T06:59:59')), { at: tpe('2026-10-13T07:00:00'), when: 'today' });
  assert.deepEqual(nextDaily(tpe('2026-10-13T07:00:00')), { at: tpe('2026-10-13T20:00:00'), when: 'tomorrow' });
  assert.deepEqual(nextDaily(tpe('2026-10-13T20:00:00')), { at: tpe('2026-10-14T07:00:00'), when: 'today' });
  assert.deepEqual(nextDaily(tpe('2026-10-13T23:30:00')), { at: tpe('2026-10-14T07:00:00'), when: 'today' });
  assert.deepEqual(nextDaily(tpe('2026-10-14T01:00:00')), { at: tpe('2026-10-14T07:00:00'), when: 'today' });
});

test('每日提醒不用 cron：第一個請求就排好 alarm，時間到自己送、再排下一次；遲到太久不送', async () => {
  const env = setup(); // 台北 19:00
  const token = await env.login();
  await env.post({ action: 'adminSave', token, event: { unit: '分壇', category: '道務', name: '分壇法會', start: '2026-10-14', startTime: '09:00' } });
  await env.post({ action: 'pushSubscribe', endpoint: EP(1), unit: '教真區' });
  const at20 = Date.parse('2026-10-13T20:00:00+08:00');
  assert.ok(env.alarms.includes(at20), '排好今晚 8 點');
  env.alarms.length = 0;
  env.clock.add(at20 - env.clock.now());
  await env.app.alarm(); // 20:00 響：排明天的提醒並送出
  await env.runAlarms();
  assert.equal(env.pushed.length, 1);
  assert.equal((await env.get('action=pushSummary&id=' + await pushIdOf(EP(1)))).data.message.title, '🙏 明天的活動（10/14 三）');
  // 下一次是明天早上 7 點：那天分壇有法會 → 今天的提醒
  env.pushed.length = 0;
  env.clock.add(Date.parse('2026-10-14T07:00:00+08:00') - env.clock.now());
  await env.app.alarm();
  await env.runAlarms();
  assert.equal(env.pushed.length, 1);
  assert.equal((await env.get('action=pushSummary&id=' + await pushIdOf(EP(1)))).data.message.title, '🙏 今天的活動（10/14 三）');
  // 遲到 3 小時才響：不送，直接排下一次
  env.pushed.length = 0;
  env.clock.add(Date.parse('2026-10-14T23:00:00+08:00') - env.clock.now());
  await env.app.alarm();
  await env.runAlarms();
  assert.equal(env.pushed.length, 0);
});
