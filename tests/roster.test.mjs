// 各區組長在分壇行事曆填名單（規格第 9-3、9-4 節）：帳號、權限、填名單、行事曆上的顯示。記憶體版，不連網。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFront } from '../worker/src/front.js';
import { createStoreApp } from '../worker/src/store-app.js';
import { createMemoryStore } from '../worker/src/store.js';
import { buildCalendar, cleanRosterNames } from '../worker/src/logic.js';

function setup() {
  let t = Date.parse('2026-10-13T02:00:00Z'); // 台北 10/13 10:00
  const clock = { now: () => t, add: (ms) => { t += ms; } };
  const app = createStoreApp(createMemoryStore(), { password: () => 'test-pass', now: clock.now, fetch: async () => { throw new Error('不連網'); } });
  const front = createFront({ callStore: (b) => app.call(JSON.parse(JSON.stringify(b))), fetch: async () => { throw new Error('不連網'); }, now: clock.now, localTtl: 0 });
  const post = async (body) => (await front.handle(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }))).json();
  const get = async (q) => (await front.handle(new Request('http://x/?' + q))).json();
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  return { clock, post, get, ok };
}

const E = (o) => Object.assign({ category: '勤務', start: '2026-10-24' }, o);

async function ready(env) {
  const sup = env.ok(await env.post({ action: 'adminLogin', password: 'test-pass' })).token;
  env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '分壇', category: '道務', name: '統班' }) }));
  const cook = env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '教慈區', name: '烹飪：統班', positions: [{ name: '烹飪', min: 15 }, { name: '洗碗', max: 3 }] }) })).event;
  const vol = env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '教全區', name: '志工團：統班' }) })).event;
  env.ok(await env.post({ action: 'adminSetAccount', token: sup, unit: '教慈區', password: 'ci-pass' }));
  env.ok(await env.post({ action: 'adminSetAccount', token: sup, unit: '教全區', password: 'quan-pass' }));
  return { sup, cook, vol };
}

test('組長的名字：逗號、頓號、空白都可以隔開，去掉重複；太長擋下', () => {
  assert.deepEqual(cleanRosterNames('王小明、測試甲, 測試乙  王小明\n李小華'), ['王小明', '測試甲', '測試乙', '李小華']);
  assert.deepEqual(cleanRosterNames(['測試甲', ' ', '測試甲']), ['測試甲']);
  assert.deepEqual(cleanRosterNames('測試甲。測試乙/測試丙／測試丁・測試戊|測試己；測試庚，'), ['測試甲', '測試乙', '測試丙', '測試丁', '測試戊', '測試己', '測試庚']);
  assert.throws(() => cleanRosterNames('一二三四五六七八九十一二三四五六七八九十一'), /太長/);
});

test('帳號：總管理者設密碼、登入選單只列有密碼的；組長只能填名單、不能做別的', async () => {
  const env = setup();
  const { sup } = await ready(env);
  assert.deepEqual(env.ok(await env.get('action=loginAccounts')).accounts, ['總管理者', '教慈區', '教全區']);
  const accts = env.ok(await env.post({ action: 'adminAccounts', token: sup })).accounts;
  assert.equal(accts.find((a) => a.unit === '教慈區').hasPassword, true);
  assert.equal(accts.find((a) => a.unit === '教真區').hasPassword, false);
  assert.ok(accts.some((a) => a.unit === '測試區'));
  let r = await env.post({ action: 'adminSetAccount', token: sup, unit: '教善區', password: '123' });
  assert.match(r.error.message, /至少 6 個字/);
  r = await env.post({ action: 'adminLogin', account: '教真區', password: 'x' });
  assert.match(r.error.message, /還沒有設定密碼/);
  r = await env.post({ action: 'adminLogin', account: '教慈區', password: 'wrong' });
  assert.equal(r.error.code, 'UNAUTHORIZED');
  const login = env.ok(await env.post({ action: 'adminLogin', account: '教慈區', password: 'ci-pass' }));
  assert.equal(login.role, 'region');
  assert.equal(login.account, '教慈區');
  for (const action of ['adminList', 'adminSave', 'adminLog', 'adminAccounts', 'adminBackup', 'adminPushSend']) {
    r = await env.post({ action, token: login.token, event: E({ unit: '教慈區', name: 'x' }) });
    assert.match(r.error.message, /組長帳號只能填名單/, action);
  }
  // 改密碼：組長已經登入的登出
  env.ok(await env.post({ action: 'adminSetAccount', token: sup, unit: '教慈區', password: 'ci-pass-2' }));
  r = await env.post({ action: 'adminRosterList', token: login.token });
  assert.equal(r.error.code, 'UNAUTHORIZED');
  // 刪除帳號
  env.ok(await env.post({ action: 'adminSetAccount', token: sup, unit: '教慈區', remove: true }));
  assert.deepEqual(env.ok(await env.get('action=loginAccounts')).accounts, ['總管理者', '教全區']);
});

test('組長填名單：只看得到、只能填自己區的；每個了愿項目一欄；總管理者也可以填', async () => {
  const env = setup();
  const { sup, cook, vol } = await ready(env);
  const ci = env.ok(await env.post({ action: 'adminLogin', account: '教慈區', password: 'ci-pass' })).token;
  const list = env.ok(await env.post({ action: 'adminRosterList', token: ci }));
  assert.deepEqual(list.events.map((e) => e.name), ['烹飪：統班']);
  const [p1, p2] = cook.positions.map((x) => x.id);
  env.ok(await env.post({ action: 'adminRosterSave', token: ci, id: cook.id, date: '2026-10-24', key: p1, names: '王小明、測試甲' }));
  env.ok(await env.post({ action: 'adminRosterSave', token: ci, id: cook.id, date: '2026-10-24', key: p2, names: ['測試乙'] }));
  let r = await env.post({ action: 'adminRosterSave', token: ci, id: vol.id, date: '2026-10-24', key: '_', names: '測試丙' });
  assert.match(r.error.message, /只能填自己區/);
  r = await env.post({ action: 'adminRosterSave', token: ci, id: cook.id, date: '2026-10-25', key: p1, names: '測試丙' });
  assert.match(r.error.message, /日期不在/);
  r = await env.post({ action: 'adminRosterSave', token: ci, id: cook.id, date: '2026-10-24', key: '_', names: '測試丙' });
  assert.match(r.error.message, /了愿項目不對/);
  // 總管理者幫教全區填（沒有了愿項目：欄位是 _）
  env.ok(await env.post({ action: 'adminRosterSave', token: sup, id: vol.id, date: '2026-10-24', key: '_', names: '測試丁' }));
  // 清空一欄
  env.ok(await env.post({ action: 'adminRosterSave', token: ci, id: cook.id, date: '2026-10-24', key: p2, names: '' }));
  // 行事曆：統班下面掛兩區，附名單與人數
  const cal = env.ok(await env.get('action=getCalendar&from=2026-10-01&to=2026-10-31'));
  const tb = cal.events.find((e) => e.name === '統班');
  assert.deepEqual(tb.links.map((l) => [l.unit, l.name, l.counts['2026-10-24']]), [['教慈區', '烹飪：統班', 2], ['教全區', '志工團：統班', 1]]);
  assert.deepEqual(tb.links[0].roster, { '2026-10-24': { [p1]: ['王小明', '測試甲'] } });
  assert.equal(cal.events.length, 1, '各區的勤務不單獨出現');
  // 總管理者修改活動：名單保留
  const again = Object.assign({}, cook, { name: '烹飪：統班', location: '彌勒山' });
  const saved = env.ok(await env.post({ action: 'adminSave', token: sup, event: again })).event;
  assert.deepEqual(saved.roster, { '2026-10-24': { [p1]: ['王小明', '測試甲'] } });
  const log = env.ok(await env.post({ action: 'adminLog', token: sup })).log;
  assert.ok(log.some((l) => l.action === '填名單' && /教慈區組長/.test(l.name)));
});

test('截止日期、服裝：勤務沒填就用分壇活動的；過了截止組長不能改，總管理者可以', async () => {
  const env = setup();
  const sup = env.ok(await env.post({ action: 'adminLogin', password: 'test-pass' })).token;
  let r = await env.post({ action: 'adminSave', token: sup, event: E({ unit: '分壇', name: '統班', deadline: '2026-10-25' }) });
  assert.match(r.error.message, /截止日期不能晚於/);
  env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '分壇', category: '道務', name: '統班', deadline: '2026-10-20', dress: '白上衣' }) }));
  const cook = env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '教慈區', name: '烹飪：統班', dress: '圍裙' }) })).event;
  env.ok(await env.post({ action: 'adminSetAccount', token: sup, unit: '教慈區', password: 'ci-pass' }));
  const ci = env.ok(await env.post({ action: 'adminLogin', account: '教慈區', password: 'ci-pass' })).token;
  const cal = env.ok(await env.get('action=getCalendar&from=2026-10-01&to=2026-10-31'));
  const tb = cal.events.find((e) => e.name === '統班');
  assert.equal(tb.dress, '白上衣');
  assert.deepEqual([tb.links[0].dress, tb.links[0].deadline], ['圍裙', '2026-10-20']);
  let list = env.ok(await env.post({ action: 'adminRosterList', token: ci })).events;
  assert.deepEqual([list[0].deadline, list[0].closed], ['2026-10-20', false]);
  env.ok(await env.post({ action: 'adminRosterSave', token: ci, id: cook.id, date: '2026-10-24', key: '_', names: '測試甲' }));
  env.clock.add(8 * 86400e3); // 10/21（登入過期，重新登入）
  const ci2 = env.ok(await env.post({ action: 'adminLogin', account: '教慈區', password: 'ci-pass' })).token;
  const sup2 = env.ok(await env.post({ action: 'adminLogin', password: 'test-pass' })).token;
  list = env.ok(await env.post({ action: 'adminRosterList', token: ci2 })).events;
  assert.equal(list[0].closed, true);
  r = await env.post({ action: 'adminRosterSave', token: ci2, id: cook.id, date: '2026-10-24', key: '_', names: '測試乙' });
  assert.match(r.error.message, /已經過了截止日期（10\/20）/);
  env.ok(await env.post({ action: 'adminRosterSave', token: sup2, id: cook.id, date: '2026-10-24', key: '_', names: '測試乙' }));
});

test('勾志工團、烹飪團的組派的：每區記自己的組別，掛在分壇活動下也看得到', async () => {
  const env = setup();
  const sup = env.ok(await env.post({ action: 'adminLogin', password: 'test-pass' })).token;
  env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '分壇', category: '道務', name: '敦化班', group: '不該存' }) }));
  const res = env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ units: ['教美區', '教理區'], name: '志工團：敦化班', groupOf: { 教美區: '志工團第 3、13 組', 教理區: '志工團第 13 組' } }) }));
  assert.deepEqual(res.events.map((e) => [e.unit, e.group]), [['教美區', '志工團第 3、13 組'], ['教理區', '志工團第 13 組']]);
  const cal = env.ok(await env.get('action=getCalendar&from=2026-10-01&to=2026-10-31'));
  const item = cal.events.find((e) => e.name === '敦化班');
  assert.equal(item.group, '');
  assert.deepEqual(item.links.map((l) => l.group), ['志工團第 3、13 組', '志工團第 13 組']);
});

test('分壇活動裡排分工：自動建各區勤務、改日期跟著改、名單留著、拿掉的刪掉、刪活動一起刪', async () => {
  const env = setup();
  const sup = env.ok(await env.post({ action: 'adminLogin', password: 'test-pass' })).token;
  const duties = [{ id: 'D-a', work: '烹飪', picks: ['t:烹飪團:八'], min: 15 }, { id: 'D-b', work: '交通', picks: ['t:志工團:12', 'u:教真區'] }];
  const assign = [{ unit: '教慈區', dutyId: 'D-a', group: '烹飪團第八組' }, { unit: '教全區', dutyId: 'D-b', group: '志工團第 12 組' }, { unit: '教真區', dutyId: 'D-b', group: '' }];
  let res = env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '分壇', category: '道務', name: '統班', location: '彌勒山', duties, assign }) }));
  const parent = res.event;
  assert.deepEqual(res.children.map((c) => [c.unit, c.name, c.group, c.location, c.positions[0].min]),
    [['教慈區', '烹飪：統班', '烹飪團第八組', '彌勒山', 15], ['教全區', '交通：統班', '志工團第 12 組', '彌勒山', null], ['教真區', '交通：統班', '', '彌勒山', null]]);
  const cook = res.children[0];
  // 組長填名單
  env.ok(await env.post({ action: 'adminRosterSave', token: sup, id: cook.id, date: '2026-10-24', key: cook.positions[0].id, names: '測試甲、測試乙' }));
  let cal = env.ok(await env.get('action=getCalendar&from=2026-10-01&to=2026-10-31'));
  assert.deepEqual(cal.events.find((e) => e.name === '統班').links.map((l) => l.unit), ['教真區', '教慈區', '教全區']);
  // 改名稱、日期，拿掉教真區
  const saved = parent.duties;
  res = env.ok(await env.post({ action: 'adminSave', token: sup, event: Object.assign({}, parent, { name: '統班（第二次）', start: '2026-10-25', end: '2026-10-25', duties: saved,
    assign: [{ id: cook.id, unit: '教慈區', dutyId: 'D-a', group: '烹飪團第八組' }, { unit: '教全區', dutyId: 'D-b', group: '志工團第 12 組' }] }) }));
  assert.deepEqual(res.children.map((c) => [c.unit, c.name, c.start]), [['教慈區', '烹飪：統班（第二次）', '2026-10-25'], ['教全區', '交通：統班（第二次）', '2026-10-25']]);
  assert.equal(res.children[0].id, cook.id);
  assert.deepEqual(res.children[0].roster, { '2026-10-24': { [cook.positions[0].id]: ['測試甲', '測試乙'] } }, '名單留著');
  let list = env.ok(await env.post({ action: 'adminList', token: sup })).events;
  assert.equal(list.filter((e) => e.parentId === parent.id).length, 2);
  // 刪分壇活動：分工一起刪
  const del = env.ok(await env.post({ action: 'adminDelete', token: sup, id: parent.id }));
  assert.equal(del.deleted, 3);
  list = env.ok(await env.post({ action: 'adminList', token: sup })).events;
  assert.equal(list.length, 0);
});

test('以前用名稱掛上的各區勤務：帶進分工後改用 parentId，名單從「_」搬過來；drop 的刪掉', async () => {
  const env = setup();
  const sup = env.ok(await env.post({ action: 'adminLogin', password: 'test-pass' })).token;
  const parent = env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '分壇', category: '道務', name: '統班' }) })).event;
  const a = env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '教慈區', name: '烹飪：統班' }) })).event;
  const b = env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '教理區', name: '烹飪：統班' }) })).event;
  env.ok(await env.post({ action: 'adminRosterSave', token: sup, id: a.id, date: '2026-10-24', key: '_', names: '測試甲' }));
  const res = env.ok(await env.post({ action: 'adminSave', token: sup, event: Object.assign({}, parent, {
    duties: [{ id: 'D-x', work: '烹飪', picks: ['u:教慈區'] }], assign: [{ id: a.id, unit: '教慈區', dutyId: 'D-x' }], drop: [b.id] }) }));
  const c = res.children[0];
  assert.equal(c.id, a.id);
  assert.equal(c.parentId, parent.id);
  assert.deepEqual(c.roster, { '2026-10-24': { [c.positions[0].id]: ['測試甲'] } });
  const list = env.ok(await env.post({ action: 'adminList', token: sup })).events;
  assert.ok(!list.some((e) => e.id === b.id), 'drop 的刪掉');
});

test('各區報名出席：開了才能填；併區兩區都可以填同一行；過了截止不能改', async () => {
  const env = setup();
  const sup = env.ok(await env.post({ action: 'adminLogin', password: 'test-pass' })).token;
  const cls = env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '分壇', category: '教育', name: '長青班', signup: true, deadline: '2026-10-20', note: '上午 10 點上課' }) })).event;
  const other = env.ok(await env.post({ action: 'adminSave', token: sup, event: E({ unit: '分壇', category: '教育', name: '別的班' }) })).event;
  for (const u of ['教慈區', '教理區', '教真區']) env.ok(await env.post({ action: 'adminSetAccount', token: sup, unit: u, password: 'pass-' + u }));
  const ci = env.ok(await env.post({ action: 'adminLogin', account: '教慈區', password: 'pass-教慈區' })).token;
  const li = env.ok(await env.post({ action: 'adminLogin', account: '教理區', password: 'pass-教理區' })).token;
  const list = env.ok(await env.post({ action: 'adminRosterList', token: ci }));
  assert.deepEqual(list.attend.map((a) => [a.name, a.row]), [['長青班', '教慈/理']]);
  env.ok(await env.post({ action: 'adminAttendSave', token: ci, id: cls.id, row: '教慈/理', names: '測試甲 測試乙', escort: '王小明', traffic: '李小華' }));
  const res = env.ok(await env.post({ action: 'adminAttendSave', token: li, id: cls.id, row: '教慈/理', names: '測試甲、測試乙、測試丙', escort: '王小明', traffic: '李小華' }));
  assert.deepEqual(res.event.attend['教慈/理'], { names: ['測試甲', '測試乙', '測試丙'], escort: ['王小明'], traffic: ['李小華'], note: '' });
  let r = await env.post({ action: 'adminAttendSave', token: ci, id: cls.id, row: '教真', names: '測試丁' });
  assert.match(r.error.message, /只能填自己區/);
  r = await env.post({ action: 'adminAttendSave', token: ci, id: other.id, row: '教慈/理', names: '測試丁' });
  assert.match(r.error.message, /沒有開放/);
  // 修改活動：出席名單留著
  const again = env.ok(await env.post({ action: 'adminSave', token: sup, event: Object.assign({}, cls, { location: '致中樓 3 樓' }) })).event;
  assert.equal(again.attend['教慈/理'].names.length, 3);
  const cal = env.ok(await env.get('action=getCalendar&from=2026-10-01&to=2026-10-31'));
  assert.equal(cal.events.find((e) => e.name === '長青班').signup, true);
  env.clock.add(8 * 86400e3);
  const ci2 = env.ok(await env.post({ action: 'adminLogin', account: '教慈區', password: 'pass-教慈區' })).token;
  r = await env.post({ action: 'adminAttendSave', token: ci2, id: cls.id, row: '教慈/理', names: '' });
  assert.match(r.error.message, /截止/);
});

test('行事曆的項目：掛在分壇活動下、沒對應的同名同日合成一張、區活動與測試區不出現', () => {
  const L = (o) => Object.assign({ source: 'local', category: '勤務', start: '2026-10-24', end: '2026-10-24', startTime: '', location: '', note: '', link: '', kind: '分壇分配', positions: [], roster: {} }, o);
  const items = buildCalendar([
    L({ id: 'E-1', unit: '分壇', kind: '', name: '統班' }),
    L({ id: 'E-2', unit: '教全區', name: '志工團：統班' }),
    L({ id: 'E-3', unit: '教慈區', name: '烹飪：統班' }),
    L({ id: 'jq-1', source: 'jiaoquan', unit: '教全區', name: '烹飪團輪值：統班烹飪' }),
    L({ id: 'E-4', unit: '教力區', name: '宏宗獻供拜香（大典）' }),
    L({ id: 'E-5', unit: '教發區', name: '宏宗獻供拜香（大典）' }),
    L({ id: 'E-6', unit: '教美區', kind: '區活動', name: '研究班（範例）' }),
    L({ id: 'E-7', unit: '測試區', name: '測試勤務' }),
    L({ id: 'E-8', unit: '分壇', kind: '', name: '人才班（第一年）第 3 次', start: '2026-10-27', end: '2026-10-27' }),
    L({ id: 'E-9', unit: '教美區', name: '人才班勤務', start: '2026-10-27', end: '2026-10-27' })
  ], false);
  const by = (n) => items.find((x) => x.name === n);
  assert.deepEqual(by('統班').links.map((l) => l.unit), ['教慈區', '教全區']); // 照區的順序；教全區系統的不掛
  assert.deepEqual(by('宏宗獻供拜香（大典）').links.map((l) => l.unit), ['教力區', '教發區']);
  assert.deepEqual(by('人才班（第一年）第 3 次').links.map((l) => l.unit), ['教美區']);
  ['研究班（範例）', '測試勤務', '烹飪團輪值：統班烹飪'].forEach((n) => assert.ok(!by(n), n));
});
