// Worker 的測試：用記憶體版的資料存放、假的教全區 API，不連網。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFront } from '../worker/src/front.js';
import { createStoreApp } from '../worker/src/store-app.js';
import { createMemoryStore } from '../worker/src/store.js';
import { cleanEvent, fromJiaoquan, isDate, taipeiDate, editableUnits } from '../worker/src/logic.js';
import { SITE } from '../worker/src/site.js';

// 假的教全區回應：故意放人名欄位，確認不會傳出去
function jqSample(year) {
  return {
    ok: true,
    data: {
      contact: '測試甲 後學',
      venue: [{ date: `${year}-10-13`, slot: '下午', name: '測試乙', purpose: '測試' }],
      duties: [
        { id: 'D-1', name: '宏宗大掃除', category: '勤務', nature: '勤務', mode: '報名型', start: `${year}-10-24`, end: `${year}-10-24`, startTime: '', endTime: '', location: '宏宗', groupLeader: '測試丙', leaders: '測試丁', teachers: '測試戊', attire: '輕便服裝', positions: [], days: {} },
        { id: 'D-2', name: '初一拜香輪值', category: '道務', mode: '公告型', start: `${year}-11-09`, end: `${year}-11-09`, startTime: '06:30', endTime: '07:30', location: '宏宗', groupLeader: '測試己' },
        { id: 'bad id!', name: '格式錯誤', start: `${year}-01-01`, end: `${year}-01-01` },
        { id: 'D-3', name: '沒有類別的舊資料', start: `${year}-12-01`, end: `${year}-12-02` }
      ]
    }
  };
}

function setup(o = {}) {
  let t = Date.parse('2026-10-12T02:00:00Z'); // 台北 10:00
  const clock = { now: () => t, add: (ms) => { t += ms; } };
  const store = createMemoryStore();
  const storeApp = createStoreApp(store, { password: () => (o.password === undefined ? 'test-pass' : o.password), now: clock.now });
  const calls = { store: 0, jq: [] };
  let jqMode = o.jqMode || 'ok';
  const fakeFetch = async (url) => {
    calls.jq.push(url);
    if (jqMode === 'down') throw new Error('network down');
    const year = new URL(url).searchParams.get('from').slice(0, 4);
    return { ok: true, json: async () => jqSample(year) };
  };
  const front = createFront({
    callStore: async (body) => { calls.store++; return storeApp.call(JSON.parse(JSON.stringify(body))); },
    fetch: fakeFetch,
    now: clock.now
  });
  const get = async (q) => (await front.handle(new Request('http://x/?' + q))).json();
  const post = async (body) => (await front.handle(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }))).json();
  return { clock, store, calls, get, post, setJq: (m) => { jqMode = m; } };
}

async function login(env) {
  const r = await env.post({ action: 'adminLogin', password: 'test-pass' });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data.token;
}

const sampleEvent = (over) => Object.assign({ unit: '分壇', category: '道務', name: '分壇法會', start: '2026-10-20', end: '', startTime: '09:00', endTime: '12:00', location: '測試佛堂', note: '說明', link: '' }, over);

test('台北日期', () => {
  assert.equal(taipeiDate(Date.parse('2026-10-11T16:30:00Z')), '2026-10-12');
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2026-02-28'), true);
});

test('區名：16 區、教全區在裡面、後台不能選教全區', () => {
  assert.equal(SITE.units.length, 16);
  assert.ok(SITE.units.includes('教全區'));
  assert.equal(editableUnits()[0], '分壇');
  assert.ok(!editableUnits().includes('教全區'));
  assert.equal(editableUnits().length, 16);
});

test('cleanEvent：整理欄位、結束日期預設同一天', () => {
  const ev = cleanEvent(sampleEvent({ name: '  分壇法會 ', extra: 'x' }));
  assert.equal(ev.name, '分壇法會');
  assert.equal(ev.end, '2026-10-20');
  assert.equal(ev.extra, undefined);
});

test('cleanEvent：擋掉各種錯誤，一次列出', () => {
  assert.throws(() => cleanEvent(sampleEvent({ unit: '教全區' })), /自動從教全區/);
  assert.throws(() => cleanEvent(sampleEvent({ unit: '不存在區' })), /請選擇單位/);
  assert.throws(() => cleanEvent(sampleEvent({ category: '其他' })), /請選擇類別/);
  assert.throws(() => cleanEvent(sampleEvent({ end: '2026-10-19' })), /不能早於/);
  assert.throws(() => cleanEvent(sampleEvent({ end: '2027-01-30' })), /最長/);
  assert.throws(() => cleanEvent(sampleEvent({ startTime: '25:00' })), /開始時間/);
  assert.throws(() => cleanEvent(sampleEvent({ startTime: '', endTime: '10:00' })), /結束時間就要填開始時間/);
  assert.throws(() => cleanEvent(sampleEvent({ link: 'javascript:alert(1)' })), /https/);
  assert.throws(() => cleanEvent(sampleEvent({ name: '', category: '' })), /請選擇類別；請填活動名稱/);
});

test('fromJiaoquan：只留允許的欄位，丟掉人名與借場地', () => {
  const list = fromJiaoquan(jqSample(2026).data);
  assert.equal(list.length, 3); // 格式錯的那筆跳過
  const text = JSON.stringify(list);
  ['測試甲', '測試乙', '測試丙', '測試丁', '測試戊', '測試己'].forEach((n) => assert.ok(!text.includes(n), n));
  const a = list.find((e) => e.id === 'jq-D-1');
  assert.deepEqual(Object.keys(a).sort(), ['attire', 'category', 'end', 'endTime', 'id', 'link', 'location', 'mode', 'name', 'nature', 'note', 'source', 'start', 'startTime', 'unit'].sort());
  assert.equal(a.unit, '教全區');
  assert.equal(a.link, 'https://bailixiao.github.io/duty-calendar/#/duty/D-1');
  assert.equal(list.find((e) => e.id === 'jq-D-2').mode, '公告型');
  assert.equal(list.find((e) => e.id === 'jq-D-3').category, '勤務');
});

test('登入：密碼不對、正確、登出後失效', async () => {
  const env = setup();
  let r = await env.post({ action: 'adminLogin', password: 'wrong' });
  assert.equal(r.error.code, 'UNAUTHORIZED');
  const token = await login(env);
  r = await env.post({ action: 'adminList', token });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.units, editableUnits());
  await env.post({ action: 'adminLogout', token });
  r = await env.post({ action: 'adminList', token });
  assert.equal(r.error.code, 'UNAUTHORIZED');
});

test('登入：沒設定密碼時不能登入', async () => {
  const env = setup({ password: '' });
  const r = await env.post({ action: 'adminLogin', password: '' });
  assert.equal(r.error.code, 'NOT_CONFIGURED');
});

test('登入：12 小時後過期', async () => {
  const env = setup();
  const token = await login(env);
  env.clock.add(12 * 3600e3 + 1);
  const r = await env.post({ action: 'adminList', token });
  assert.equal(r.error.code, 'UNAUTHORIZED');
});

test('登入：連續輸錯 10 次暫停 15 分鐘，連正確密碼也擋', async () => {
  const env = setup();
  for (let i = 0; i < 10; i++) await env.post({ action: 'adminLogin', password: 'wrong' });
  let r = await env.post({ action: 'adminLogin', password: 'test-pass' });
  assert.equal(r.error.code, 'LOCKED');
  env.clock.add(15 * 60e3 + 1);
  r = await env.post({ action: 'adminLogin', password: 'test-pass' });
  assert.equal(r.ok, true);
});

test('沒登入不能改資料', async () => {
  const env = setup();
  for (const action of ['adminList', 'adminSave', 'adminDelete', 'adminLog', 'adminBackup']) {
    const r = await env.post({ action, event: sampleEvent(), id: 'x' });
    assert.equal(r.error.code, 'UNAUTHORIZED', action);
  }
});

test('不能從外面呼叫 snapshot 等內部動作', async () => {
  const env = setup();
  const r = await env.post({ action: 'snapshot' });
  assert.equal(r.error.code, 'BAD_REQUEST');
});

test('新增、修改、刪除，寫入操作紀錄，備份含全部', async () => {
  const env = setup();
  const token = await login(env);
  let r = await env.post({ action: 'adminSave', token, event: sampleEvent() });
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = r.data.event.id;
  assert.match(id, /^E-20261012-[0-9a-f]{6}$/);
  r = await env.post({ action: 'adminSave', token, event: Object.assign(sampleEvent({ name: '分壇法會（改）' }), { id }) });
  assert.equal(r.data.event.name, '分壇法會（改）');
  assert.equal(r.data.event.createdAt, '2026-10-12 10:00:00');
  r = await env.post({ action: 'adminSave', token, event: Object.assign(sampleEvent(), { id: 'E-不存在' }) });
  assert.equal(r.error.code, 'NOT_FOUND');
  await env.post({ action: 'adminSave', token, event: sampleEvent({ unit: '教真區', name: '教真區活動' }) });
  r = await env.post({ action: 'adminBackup', token });
  assert.equal(r.data.events.length, 2);
  r = await env.post({ action: 'adminDelete', token, id });
  assert.equal(r.ok, true);
  r = await env.post({ action: 'adminLog', token });
  assert.deepEqual(r.data.log.map((l) => l.action), ['刪除', '新增', '修改', '新增']);
  assert.equal(r.data.log[0].name, '分壇法會（改）');
});

test('getEvents：合併手動與教全區的活動，依日期排序，只回區間內的', async () => {
  const env = setup();
  const token = await login(env);
  await env.post({ action: 'adminSave', token, event: sampleEvent({ start: '2026-10-24', startTime: '08:00' }) });
  await env.post({ action: 'adminSave', token, event: sampleEvent({ start: '2026-12-31', end: '2027-01-02', name: '跨年活動' }) });
  const r = await env.get('action=getEvents&from=2026-10-01&to=2026-10-31');
  assert.equal(r.ok, true);
  assert.equal(r.data.today, '2026-10-12');
  assert.deepEqual(r.data.events.map((e) => e.name), ['宏宗大掃除', '分壇法會']); // 同一天：沒寫時間的排前面
  const mine = r.data.events[1];
  assert.equal(mine.source, 'local');
  assert.equal(mine.createdAt, undefined); // 家人們看不到後台欄位
  assert.deepEqual(r.data.sources['教全區'], { ok: true, stale: false });
  const r2 = await env.get('action=getEvents&from=2027-01-01&to=2027-01-31');
  assert.deepEqual(r2.data.events.map((e) => e.name), ['跨年活動']);
});

test('getEvents：教全區依年份快取 5 分鐘、手動活動快取 60 秒', async () => {
  const env = setup();
  await env.get('action=getEvents&from=2026-01-01&to=2026-12-31');
  await env.get('action=getEvents&from=2026-03-01&to=2026-03-31');
  assert.equal(env.calls.jq.length, 1);
  assert.equal(env.calls.store, 1);
  env.clock.add(61e3);
  await env.get('action=getEvents&from=2026-03-01&to=2026-03-31');
  assert.equal(env.calls.store, 2);
  assert.equal(env.calls.jq.length, 1);
  env.clock.add(300e3);
  await env.get('action=getEvents&from=2026-03-01&to=2026-03-31');
  assert.equal(env.calls.jq.length, 2); // 過期：背景再讀一次
  await env.get('action=getEvents&from=2026-12-20&to=2027-01-10'); // 跨年：多讀 2027
  assert.equal(env.calls.jq.length, 3);
});

test('getEvents：存檔後同一個 Worker 馬上看到；fresh=1 跳過快取', async () => {
  const env = setup();
  const token = await login(env);
  await env.get('action=getEvents&from=2026-10-01&to=2026-10-31');
  await env.post({ action: 'adminSave', token, event: sampleEvent() });
  let r = await env.get('action=getEvents&from=2026-10-01&to=2026-10-31');
  assert.ok(r.data.events.some((e) => e.name === '分壇法會'));
  const before = env.calls.store;
  r = await env.get('action=getEvents&from=2026-10-01&to=2026-10-31&fresh=1');
  assert.equal(env.calls.store, before + 1);
});

test('getEvents：教全區讀不到時，其他活動照常；有上次的就用上次的', async () => {
  const env = setup({ jqMode: 'down' });
  const token = await login(env);
  await env.post({ action: 'adminSave', token, event: sampleEvent() });
  let r = await env.get('action=getEvents&from=2026-10-01&to=2026-10-31');
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.events.map((e) => e.name), ['分壇法會']);
  assert.deepEqual(r.data.sources['教全區'], { ok: false, stale: false });
  // 1 分鐘內不再去試
  await env.get('action=getEvents&from=2026-10-01&to=2026-10-31');
  assert.equal(env.calls.jq.length, 1);
  // 恢復後讀到；之後又斷線：用上次的並標示 stale
  env.setJq('ok');
  env.clock.add(61e3);
  r = await env.get('action=getEvents&from=2026-10-01&to=2026-10-31');
  assert.equal(r.data.sources['教全區'].ok, true);
  env.setJq('down');
  env.clock.add(301e3);
  await env.get('action=getEvents&from=2026-10-01&to=2026-10-31'); // 背景更新失敗
  await new Promise((res) => setTimeout(res, 0));
  r = await env.get('action=getEvents&from=2026-10-01&to=2026-10-31');
  assert.deepEqual(r.data.sources['教全區'], { ok: true, stale: true });
  assert.ok(r.data.events.some((e) => e.name === '宏宗大掃除'));
});

test('getEvents：檢查區間', async () => {
  const env = setup();
  for (const q of ['from=2026-1-1&to=2026-01-31', 'from=2026-02-01&to=2026-01-31', 'from=2025-01-01&to=2026-12-31']) {
    const r = await env.get('action=getEvents&' + q);
    assert.equal(r.error.code, 'BAD_REQUEST', q);
  }
});

test('CORS 與未知動作', async () => {
  const env = setup();
  const front = createFront({ callStore: async () => ({ ok: true, data: {} }), fetch: async () => { throw new Error('x'); } });
  const res = await front.handle(new Request('http://x/', { method: 'OPTIONS' }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  const r = await env.get('action=nope');
  assert.equal(r.error.code, 'BAD_REQUEST');
  const bad = await (await front.handle(new Request('http://x/', { method: 'POST', body: '{not json' }))).json();
  assert.equal(bad.error.code, 'BAD_REQUEST');
});
