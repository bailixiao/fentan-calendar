// 各區報名連動（規格第 9-1 節）：教全區的報名狀態與名單。用假的教全區，不連網。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFront } from '../worker/src/front.js';

const duty = (id, extra) => Object.assign({
  id, name: '宏宗打掃', category: '勤務', mode: '報名型', start: '2026-10-24', end: '2026-10-25', startTime: '08:00', location: '宏宗',
  groupLeader: '測試甲', contact: '測試乙',
  positions: [{ id: 'P1', name: '打掃', min: 2, max: null }, { id: 'P2', name: '茶水', min: 1, max: 1 }],
  days: { '2026-10-24': { total: 2, people: 2, counts: { P1: 1, P2: 1 } }, '2026-10-25': { total: 3, people: 3, counts: { P1: 2, P2: 1 }, full: false } },
  signups: [
    { id: 'S1', date: '2026-10-24', positionId: 'P1', name: '王小明', temple: '某佛堂', note: '測試備註' },
    { id: 'S2', date: '2026-10-24', positionId: 'P2', name: '測試丙', accompany: true },
    { id: 'S3', date: '2026-10-25', positionId: 'P1', name: '測試丁' }
  ]
}, extra);

function setup() {
  let t = Date.parse('2026-10-13T02:00:00Z');
  const calls = [];
  const fetchFn = async (url) => {
    const q = new URL(url).searchParams;
    calls.push(q.get('action'));
    if (q.get('action') === 'getBundle') return { ok: true, json: async () => ({ ok: true, data: { contact: '測試乙', venue: [], duties: [], details: { 'D-1': duty('D-1'), 'D-2': duty('D-2', { name: '研究班', category: '道務', days: { '2026-12-30': { total: 0 } } }) } } }) };
    if (q.get('action') === 'getDuty') {
      if (q.get('id') === 'D-9') return { ok: true, json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: '找不到' } }) };
      return { ok: true, json: async () => ({ ok: true, data: duty(q.get('id')) }) };
    }
    return { ok: true, json: async () => ({ ok: true, data: { duties: [duty('D-1')] } }) };
  };
  const front = createFront({ callStore: async () => ({ ok: true, data: { events: [] } }), fetch: fetchFn, now: () => t });
  const get = async (q) => (await front.handle(new Request('http://x/?' + q))).json();
  return { get, calls, add: (ms) => { t += ms; } };
}

test('行事曆的教全區活動帶每天的狀態', async () => {
  const env = setup();
  const r = await env.get('action=getEvents&from=2026-10-01&to=2026-10-31');
  const ev = r.data.events.find((e) => e.id === 'jq-D-1');
  assert.deepEqual(ev.status, { '2026-10-24': { kind: 'short', label: '缺 1 人' }, '2026-10-25': { kind: 'ok', label: '人數足・3 人' } });
});

test('報名狀況：30 天內的教全區活動，每天的狀態與名單，只留名字；快取 5 分鐘', async () => {
  const env = setup();
  const r = await env.get('action=getSignups');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.from, '2026-10-13');
  assert.equal(r.data.to, '2026-11-12');
  assert.equal(r.data.items.length, 1); // D-2 的日期在 30 天以後
  const it = r.data.items[0];
  assert.equal(it.id, 'jq-D-1');
  assert.equal(it.unit, '教全區');
  assert.deepEqual(it.days[0], {
    date: '2026-10-24', status: { kind: 'short', label: '缺 1 人' },
    positions: [{ name: '打掃', people: [{ name: '王小明' }] }, { name: '茶水', people: [{ name: '測試丙' }] }]
  });
  const text = JSON.stringify(r);
  ['測試甲', '測試乙', '某佛堂', '測試備註'].forEach((x) => assert.ok(!text.includes(x), x));
  await env.get('action=getSignups');
  assert.equal(env.calls.filter((c) => c === 'getBundle').length, 1);
  env.add(301e3);
  await env.get('action=getSignups');
  assert.equal(env.calls.filter((c) => c === 'getBundle').length, 2);
});

test('單一活動的名單：檢查代號、教全區找不到就回找不到、快取 2 分鐘', async () => {
  const env = setup();
  let r = await env.get('action=getRoster&id=jq-D-5');
  assert.equal(r.data.days.length, 2);
  assert.deepEqual(r.data.days[1].positions[0].people, [{ name: '測試丁' }]);
  await env.get('action=getRoster&id=jq-D-5');
  assert.equal(env.calls.filter((c) => c === 'getDuty').length, 1);
  r = await env.get('action=getRoster&id=E-20261012-abcdef');
  assert.equal(r.error.code, 'BAD_REQUEST');
  r = await env.get('action=getRoster&id=' + encodeURIComponent('jq-../x'));
  assert.equal(r.error.code, 'BAD_REQUEST');
  r = await env.get('action=getRoster&id=jq-D-9');
  assert.equal(r.error.code, 'NOT_FOUND');
});

test('報名統計也讀各區報名系統的 feed（只有名字）；test=1 才連測試的區；讀不到時教全區照常', async () => {
  let t = Date.parse('2026-10-13T02:00:00Z');
  const seen = [];
  let regionDown = false;
  const fetchFn = async (url) => {
    const u = new URL(url);
    const q = u.searchParams;
    if (u.hostname.startsWith('region-signup-api')) {
      seen.push(q.get('test') || '0');
      if (regionDown) throw new Error('down');
      const regions = [{ region: '教真區', events: [{ id: 'E-1', name: '研究班', category: '道務', mode: '報名型', start: '2026-10-22', end: '2026-10-22', startTime: '19:30', days: [{ date: '2026-10-22', status: { kind: 'ok', label: '已報 1 人' }, positions: [{ name: '參加', people: [{ name: '王小明', phone: 'x' }] }] }] }] }];
      if (q.get('test') === '1') regions.push({ region: '測試區', events: [] });
      return { ok: true, json: async () => ({ ok: true, data: { from: q.get('from'), to: q.get('to'), regions } }) };
    }
    if (q.get('action') === 'getBundle') return { ok: true, json: async () => ({ ok: true, data: { details: { 'D-1': duty('D-1') } } }) };
    return { ok: true, json: async () => ({ ok: true, data: { duties: [] } }) };
  };
  const front = createFront({ callStore: async () => ({ ok: true, data: { events: [] } }), fetch: fetchFn, now: () => t });
  const get = async (q) => (await front.handle(new Request('http://x/?' + q))).json();
  let r = await get('action=getSignups');
  const rs = r.data.items.find((x) => x.id === 'rs-E-1');
  assert.equal(rs.unit, '教真區');
  assert.equal(rs.link, 'https://bailixiao.github.io/region-signup/#/r/%E6%95%99%E7%9C%9F%E5%8D%80/e/E-1');
  assert.deepEqual(rs.days[0].positions[0].people, [{ name: '王小明' }]); // 多的欄位丟掉
  assert.ok(r.data.items.some((x) => x.id === 'jq-D-1'));
  r = await get('action=getSignups&test=1');
  assert.deepEqual(seen, ['0', '1']);
  regionDown = true;
  t += 200e3;
  r = await get('action=getSignups');
  assert.equal(r.ok, true);
  assert.ok(r.data.items.some((x) => x.id === 'jq-D-1'));
});
