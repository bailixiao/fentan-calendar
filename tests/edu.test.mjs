// 分壇教育組報名（規格第 4～9 節）：班、每一堂、報名、點名、權限。記憶體版，不連網。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFront } from '../worker/src/front.js';
import { createStoreApp } from '../worker/src/store-app.js';
import { createMemoryStore } from '../worker/src/store.js';
import { biweekly, cleanSession, monthly } from '../worker/src/edu.js';
import { cleanNames } from '../worker/src/logic.js';

function setup() {
  let t = Date.parse('2026-10-15T02:00:00Z'); // 台北 10/15（四）10:00
  const clock = { now: () => t, add: (ms) => { t += ms; } };
  const store = createMemoryStore();
  const app = createStoreApp(store, { password: () => 'test-pass', now: clock.now, fetch: async () => ({ status: 201 }) });
  const front = createFront({ callStore: (b) => app.call(JSON.parse(JSON.stringify(b))), now: clock.now, boardTtl: 0 });
  const post = async (body) => (await front.handle(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }))).json();
  const get = async (q) => (await front.handle(new Request('http://x/?' + q))).json();
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const err = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.error.message; };
  return { clock, store, post, get, ok, err };
}

const TOKEN_A = 'device-aaaaaaaaaaaaaaaa';
const TOKEN_B = 'device-bbbbbbbbbbbbbbbb';

async function ready(env) {
  const sup = env.ok(await env.post({ action: 'adminLogin', password: 'test-pass' })).token;
  const res = env.ok(await env.post({ action: 'adminCourseSave', token: sup, course: { name: '高大班', color: 'blue', startTime: '10:00', endTime: '12:00', location: '分壇佛堂' }, plan: { first: '2026-10-17', until: '2026-12-31' } }));
  const board = env.ok(await env.get('action=getBoard'));
  return { sup, course: res.course, sessions: board.courses[0].sessions };
}

test('隔週六排課、名字整理', () => {
  assert.deepEqual(biweekly('2026-10-17', '2026-11-30'), ['2026-10-17', '2026-10-31', '2026-11-14', '2026-11-28']);
  assert.deepEqual(biweekly('2026-10-17', '2026-10-01'), []);
  // 一個月一次：10/24 是第 4 個星期六 → 每月第 4 個星期六；10/31 是第 5 個 → 每月最後一個星期六
  assert.deepEqual(monthly('2026-10-24', '2027-01-31'), ['2026-10-24', '2026-11-28', '2026-12-26', '2027-01-23']);
  assert.deepEqual(monthly('2026-10-31', '2027-01-31'), ['2026-10-31', '2026-11-28', '2026-12-26', '2027-01-30']);
  assert.deepEqual(monthly('2026-10-03', '2026-12-31'), ['2026-10-03', '2026-11-07', '2026-12-05']);
  // 直接指定：每個月第 2 個星期日（從 10/17 開始，10 月的第 2 個星期日 10/11 已經過了）
  assert.deepEqual(monthly('2026-10-17', '2027-01-31', 2, 0), ['2026-11-08', '2026-12-13', '2027-01-10']);
  assert.deepEqual(cleanNames('王小明 測試甲、測試乙，王小明'), ['王小明', '測試甲', '測試乙']);
  assert.throws(() => cleanNames('一二三四五六七八九十一二三四五六七八九十一'), /太長/);
  assert.throws(() => cleanSession({ date: '2026-10-17', deadline: '2026-10-18' }), /不能晚於上課/);
});

test('建班一次排一整年；主畫面只有開放的班；第幾堂不算停課的', async () => {
  const env = setup();
  const { sup, course, sessions } = await ready(env);
  assert.equal(sessions.length, 6); // 10/17、10/31、11/14、11/28、12/12、12/26
  assert.deepEqual(sessions.map((s) => s.no), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([sessions[0].startTime, sessions[0].location, sessions[0].deadline], ['10:00', '分壇佛堂', '2026-10-16']);
  // 第二堂停課：之後的堂數往前
  env.ok(await env.post({ action: 'adminSessionSave', token: sup, session: Object.assign({}, sessions[1], { cancelled: true, topic: '' }) }));
  let board = env.ok(await env.get('action=getBoard'));
  assert.deepEqual(board.courses[0].sessions.map((s) => s.no), [1, 0, 2, 3, 4, 5]);
  assert.equal(board.courses[0].sessions[1].canSignup, false);
  // 收起來：主畫面看不到，後台還在
  env.ok(await env.post({ action: 'adminCourseSave', token: sup, course: Object.assign({}, course, { open: false }) }));
  board = env.ok(await env.get('action=getBoard'));
  assert.equal(board.courses.length, 0);
  assert.equal(env.ok(await env.post({ action: 'adminCourses', token: sup })).courses.length, 1);
});

test('家人自己報名：好幾個人一起報、重複跳過、名單公開照區排、這支手機報的可以自己取消', async () => {
  const env = setup();
  const { sessions } = await ready(env);
  const sid = sessions[0].id;
  let r = env.ok(await env.post({ action: 'signup', sessionId: sid, names: '王小明 測試甲', unit: '教善區', token: TOKEN_A }));
  assert.deepEqual(r.added.map((x) => x.name), ['王小明', '測試甲']);
  r = env.ok(await env.post({ action: 'signup', sessionId: sid, names: '測試甲、測試乙', unit: '教善區', token: TOKEN_B }));
  assert.deepEqual([r.added.map((x) => x.name), r.skipped], [['測試乙'], ['測試甲']]);
  env.ok(await env.post({ action: 'signup', sessionId: sid, names: '測試丙', unit: '教真區', token: TOKEN_B }));
  assert.match(env.err(await env.post({ action: 'signup', sessionId: sid, names: '測試丁', unit: '分壇', token: TOKEN_B })), /請選擇區/);
  assert.match(env.err(await env.post({ action: 'signup', sessionId: sid, names: '測試丁', unit: '教真區', token: 'short' })), /重新整理/);
  const page = env.ok(await env.get('action=getSession&id=' + sid + '&t=' + TOKEN_A));
  assert.deepEqual(page.signups.map((x) => [x.unit, x.name, x.mine]), [['教真區', '測試丙', false], ['教善區', '王小明', true], ['教善區', '測試甲', true], ['教善區', '測試乙', false]]);
  assert.equal(page.session.count, 4);
  assert.ok(!JSON.stringify(page).includes(TOKEN_A), '不回傳手機的碼');
  // 別支手機不能取消；自己的可以
  const mine = page.signups.find((x) => x.name === '王小明');
  assert.match(env.err(await env.post({ action: 'cancelSignup', id: mine.id, token: TOKEN_B })), /這支手機/);
  env.ok(await env.post({ action: 'cancelSignup', id: mine.id, token: TOKEN_A }));
  assert.equal(env.ok(await env.get('action=getBoard')).courses[0].sessions[0].count, 3);
});

test('區的報名：選一區看接下來每一堂報了誰，這支手機報的標 mine', async () => {
  const env = setup();
  const { sessions } = await ready(env);
  env.ok(await env.post({ action: 'signup', sessionId: sessions[0].id, names: '王小明', unit: '教善區', token: TOKEN_A }));
  env.ok(await env.post({ action: 'signup', sessionId: sessions[1].id, names: '測試甲', unit: '教善區', token: TOKEN_B }));
  env.ok(await env.post({ action: 'signup', sessionId: sessions[1].id, names: '測試乙', unit: '教真區', token: TOKEN_B }));
  const page = env.ok(await env.get('action=getUnit&unit=' + encodeURIComponent('教善區') + '&t=' + TOKEN_A));
  assert.deepEqual(page.items.map((x) => [x.session.date, x.signups.map((r) => [r.name, r.mine])]), [['2026-10-17', [['王小明', true]]], ['2026-10-31', [['測試甲', false]]]]);
  assert.match(env.err(await env.get('action=getUnit&unit=x')), /請選擇區/);
});

test('截止、停課、額滿：家人不能報、不能自己取消；組長、總管理者截止後還可以', async () => {
  const env = setup();
  const { sup, sessions } = await ready(env);
  const s = sessions[0]; // 10/17 上課，10/16 截止
  env.ok(await env.post({ action: 'signup', sessionId: s.id, names: '測試甲', unit: '教真區', token: TOKEN_A }));
  env.ok(await env.post({ action: 'adminSetAccount', token: sup, name: '教真區', password: 'zhen-pass' }));
  env.clock.add(2 * 86400e3); // 10/17
  assert.match(env.err(await env.post({ action: 'signup', sessionId: s.id, names: '測試乙', unit: '教真區', token: TOKEN_A })), /截止/);
  const id = env.ok(await env.get('action=getSession&id=' + s.id)).signups[0].id;
  assert.match(env.err(await env.post({ action: 'cancelSignup', id, token: TOKEN_A })), /截止/);
  const zhen = env.ok(await env.post({ action: 'adminLogin', account: '教真區', password: 'zhen-pass' })).token;
  env.ok(await env.post({ action: 'adminSignup', token: zhen, sessionId: s.id, names: '測試乙', unit: '教善區' })); // 組長一律報自己區
  assert.deepEqual(env.ok(await env.get('action=getSession&id=' + s.id)).signups.map((x) => x.unit), ['教真區', '教真區']);
  // 名額
  const s2 = sessions[1];
  const sup2 = env.ok(await env.post({ action: 'adminLogin', password: 'test-pass' })).token; // 過了兩天，重新登入
  env.ok(await env.post({ action: 'adminSessionSave', token: sup2, session: Object.assign({}, s2, { cap: 2 }) }));
  env.ok(await env.post({ action: 'signup', sessionId: s2.id, names: '測試甲 測試乙', unit: '教真區', token: TOKEN_A }));
  assert.match(env.err(await env.post({ action: 'signup', sessionId: s2.id, names: '測試丙', unit: '教真區', token: TOKEN_A })), /額滿/);
  assert.equal(env.ok(await env.get('action=getBoard')).courses[0].sessions[1].full, true);
});

test('組長：只能取消自己區的、不能點名、不能改班；點名帳號：只能點名', async () => {
  const env = setup();
  const { sup, course, sessions } = await ready(env);
  const sid = sessions[0].id;
  env.ok(await env.post({ action: 'signup', sessionId: sid, names: '測試甲', unit: '教善區', token: TOKEN_A }));
  env.ok(await env.post({ action: 'adminSetAccount', token: sup, name: '教真區', password: 'zhen-pass' }));
  env.ok(await env.post({ action: 'adminSetAccount', token: sup, name: '點名', password: 'roll-pass' }));
  assert.deepEqual(env.ok(await env.get('action=loginAccounts')).accounts, ['總管理者', '點名', '教真區']);
  const zhen = env.ok(await env.post({ action: 'adminLogin', account: '教真區', password: 'zhen-pass' }));
  const roll = env.ok(await env.post({ action: 'adminLogin', account: '點名', password: 'roll-pass' }));
  assert.deepEqual([zhen.role, roll.role], ['region', 'roll']);
  const id = env.ok(await env.get('action=getSession&id=' + sid)).signups[0].id;
  assert.match(env.err(await env.post({ action: 'adminCancelSignup', token: zhen.token, id })), /自己區/);
  for (const action of ['adminRoll', 'adminCourseSave', 'adminAccounts']) {
    assert.match(env.err(await env.post({ action, token: zhen.token, sessionId: sid, course })), /組長帳號/, action);
  }
  for (const action of ['adminSignup', 'adminCourseSave', 'adminSessionDelete']) {
    assert.match(env.err(await env.post({ action, token: roll.token, sessionId: sid, course })), /點名帳號只能點名/, action);
  }
});

test('點名：到／請假／缺席、現場加、出席紀錄', async () => {
  const env = setup();
  const { sup, course, sessions } = await ready(env);
  env.ok(await env.post({ action: 'adminSetAccount', token: sup, name: '點名', password: 'roll-pass' }));
  const roll = env.ok(await env.post({ action: 'adminLogin', account: '點名', password: 'roll-pass' })).token;
  const [a, b] = sessions;
  env.ok(await env.post({ action: 'signup', sessionId: a.id, names: '測試甲 測試乙', unit: '教真區', token: TOKEN_A }));
  env.ok(await env.post({ action: 'signup', sessionId: b.id, names: '測試甲', unit: '教真區', token: TOKEN_A }));
  let list = env.ok(await env.post({ action: 'adminRoll', token: roll, sessionId: a.id })).signups;
  env.ok(await env.post({ action: 'adminRollSet', token: roll, id: list[0].id, status: '到' }));
  env.ok(await env.post({ action: 'adminRollSet', token: roll, id: list[1].id, status: '請假' }));
  assert.match(env.err(await env.post({ action: 'adminRollSet', token: roll, id: list[1].id, status: '遲到' })), /到、請假或缺席/);
  env.ok(await env.post({ action: 'adminRollAdd', token: roll, sessionId: a.id, names: '王小明', unit: '教善區' }));
  list = env.ok(await env.post({ action: 'adminRoll', token: roll, sessionId: a.id })).signups;
  assert.deepEqual(list.map((x) => [x.name, x.roll, x.by]), [['測試甲', '到', 'self'], ['測試乙', '請假', 'self'], ['王小明', '到', 'walkin']]);
  const b1 = env.ok(await env.post({ action: 'adminRoll', token: roll, sessionId: b.id })).signups[0];
  env.ok(await env.post({ action: 'adminRollSet', token: roll, id: b1.id, status: '缺席' }));
  const rep = env.ok(await env.post({ action: 'adminAttendance', token: roll, courseId: course.id }));
  const p = rep.people.find((x) => x.name === '測試甲');
  assert.deepEqual([p.signups, p.到, p.請假, p.缺席], [2, 1, 0, 1]);
  // 點名結果不公開
  assert.ok(!JSON.stringify(env.ok(await env.get('action=getSession&id=' + a.id))).includes('請假'));
});

test('刪一堂、刪一個班：報名一起刪；刪除舊資料', async () => {
  const env = setup();
  const { sup, course, sessions } = await ready(env);
  env.ok(await env.post({ action: 'signup', sessionId: sessions[0].id, names: '測試甲', unit: '教真區', token: TOKEN_A }));
  assert.deepEqual(env.ok(await env.post({ action: 'adminSessionDelete', token: sup, id: sessions[0].id })), { signups: 1 });
  env.ok(await env.post({ action: 'signup', sessionId: sessions[1].id, names: '測試乙', unit: '教真區', token: TOKEN_A }));
  assert.deepEqual(env.ok(await env.post({ action: 'adminCourseDelete', token: sup, id: course.id })), { sessions: 5, signups: 1 });
  assert.equal(env.store.allDocs('signup').length, 0);
  env.store.putEvent({ id: 'E-1', unit: '分壇', name: '舊的活動' });
  assert.deepEqual(env.ok(await env.post({ action: 'adminOldCount', token: sup })), { count: 1 });
  assert.deepEqual(env.ok(await env.post({ action: 'adminPurgeOld', token: sup })), { deleted: 1 });
  assert.equal(env.store.allEvents().length, 0);
});
