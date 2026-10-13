// 各區報名連動（規格第 9-1、9-3 節）：教全區的狀態與名單、分壇活動掛各區勤務、各區報名系統的名單。用假的服務，不連網。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFront } from '../worker/src/front.js';
import { buildCalendar } from '../worker/src/logic.js';

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

const L = (o) => Object.assign({ source: 'local', category: '勤務', start: '2026-10-24', end: '2026-10-24', startTime: '', endTime: '', location: '', note: '', link: '', kind: '分壇分配', positions: [] }, o);

test('分壇行事曆的項目：分壇活動掛各區勤務（名稱含分壇活動的名字）、沒掛上的同名同日合成一張、區活動與測試區不出現', () => {
  const events = [
    L({ id: 'E-1', unit: '分壇', kind: '', category: '道務', name: '統班' }),
    L({ id: 'E-2', unit: '教全區', name: '志工團：統班' }),
    L({ id: 'E-3', unit: '教慈區', name: '烹飪：統班' }),
    L({ id: 'jq-D-9', source: 'jiaoquan', unit: '教全區', name: '烹飪團輪值：統班烹飪' }),
    L({ id: 'jq-D-8', source: 'jiaoquan', unit: '教全區', name: '區中心打掃' }),
    L({ id: 'E-4', unit: '教力區', name: '宏宗獻供拜香（大典）' }),
    L({ id: 'E-5', unit: '教發區', name: '宏宗獻供拜香（大典）' }),
    L({ id: 'E-6', unit: '教美區', kind: '區活動', name: '研究班（範例）' }),
    L({ id: 'E-7', unit: '測試區', name: '測試勤務' }),
    L({ id: 'E-8', unit: '分壇', kind: '', name: '人才班（第一年）第 3 次', start: '2026-10-27', end: '2026-10-27' }),
    L({ id: 'E-9', unit: '教美區', name: '人才班勤務', start: '2026-10-27', end: '2026-10-27' }),
    L({ id: 'E-10', unit: '分壇', kind: '', name: '專修苑修道實驗班：宏教分壇負責', start: '2026-10-28', end: '2026-10-30' }),
    L({ id: 'E-11', unit: '教慧區', name: '志工團：專修苑修道實驗班', start: '2026-10-28', end: '2026-10-28' })
  ];
  const items = buildCalendar(events, false);
  const byName = (n) => items.find((x) => x.name === n);
  assert.deepEqual(byName('統班').links.map((l) => l.unit + ' ' + l.name), ['教慈區 烹飪：統班', '教全區 志工團：統班', '教全區 烹飪團輪值：統班烹飪']); // 照區的順序
  const g = byName('宏宗獻供拜香（大典）');
  assert.equal(g.id, 'G-E-4');
  assert.equal(g.source, 'group');
  assert.deepEqual(g.links.map((l) => l.unit), ['教力區', '教發區']);
  assert.deepEqual(byName('人才班（第一年）第 3 次').links.map((l) => l.unit), ['教美區']);
  assert.deepEqual(byName('專修苑修道實驗班：宏教分壇負責').links.map((l) => l.unit), ['教慧區']);
  ['研究班（範例）', '測試勤務', '區中心打掃', '烹飪：統班', '志工團：統班'].forEach((n) => assert.ok(!byName(n), n));
  assert.ok(buildCalendar(events, true).some((x) => x.name === '測試勤務'), '測試模式才看得到測試區');
});

function setup() {
  const t = Date.parse('2026-10-13T02:00:00Z');
  const calls = [];
  const F = (o) => Object.assign({ source: 'local', category: '勤務', start: '2026-10-24', end: '2026-10-24', startTime: '', endTime: '', location: '', note: '', link: '', positions: [] }, o);
  const fentanEvents = [
    F({ id: 'E-1', unit: '分壇', kind: '', category: '道務', name: '統班' }),
    F({ id: 'E-3', unit: '教慈區', kind: '分壇分配', name: '烹飪：統班' }),
    F({ id: 'E-4', unit: '教善區', kind: '分壇分配', name: '志工團：統班' }),
    F({ id: 'E-5', unit: '教全區', kind: '分壇分配', name: '志工團：統班' }), // 教全區系統已經有「…統班…」：不重複列
    F({ id: 'E-6', unit: '分壇', kind: '', category: '道務', name: '明道班', start: '2026-10-25', end: '2026-10-25' }),
    F({ id: 'E-7', unit: '教全區', kind: '分壇分配', name: '烹飪：明道班', start: '2026-10-25', end: '2026-10-25' }) // 教全區系統還沒有：提示
  ];
  const ok = (data) => ({ ok: true, json: async () => ({ ok: true, data }) });
  const fetchFn = async (url) => {
    const u = new URL(url);
    const q = u.searchParams;
    calls.push(u.hostname.split('.')[0] + ':' + q.get('action'));
    if (u.hostname.startsWith('region-signup-api')) {
      if (q.get('action') === 'regions') return ok({ regions: [{ name: '教慈區', status: '開放' }] });
      if (q.get('action') === 'feed') return ok({ regions: [{ region: '教慈區', events: [{ id: 'F-E-3', name: '烹飪：統班', category: '勤務', mode: '報名型', start: '2026-10-24', end: '2026-10-24', days: [{ date: '2026-10-24', status: { kind: 'short', label: '缺 13 人' }, positions: [{ name: '烹飪', people: [{ name: '王小明' }, { name: '測試甲' }] }] }] }] }] });
      if (q.get('action') === 'getEvent') {
        if (q.get('region') !== '教慈區') return { ok: true, json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: '還沒有開設' } }) };
        return ok({ event: {}, days: [{ date: '2026-10-24', status: { kind: 'short', label: '缺 13 人' }, positions: [{ id: 'P', name: '烹飪', count: 2, people: [{ name: '王小明', phone: 'x' }, { name: '測試甲' }] }] }] });
      }
    }
    if (q.get('action') === 'getDuty') return ok(duty(q.get('id'), { name: '烹飪團輪值：統班烹飪', start: '2026-10-24', end: '2026-10-24' }));
    return ok({ duties: [duty('D-1'), duty('D-2', { name: '烹飪團輪值：統班烹飪', start: '2026-10-24', end: '2026-10-24', days: { '2026-10-24': { total: 4, counts: { P1: 3, P2: 1 } } } })] });
  };
  const front = createFront({ callStore: async () => ({ ok: true, data: { events: fentanEvents } }), fetch: fetchFn, now: () => t, localTtl: 0 });
  const get = async (q) => (await front.handle(new Request('http://x/?' + q))).json();
  return { get, calls };
}

test('行事曆的教全區活動帶每天的狀態與人數', async () => {
  const env = setup();
  const r = await env.get('action=getEvents&from=2026-10-01&to=2026-10-31');
  const ev = r.data.events.find((e) => e.id === 'jq-D-1');
  assert.deepEqual(ev.status, { '2026-10-24': { kind: 'short', label: '缺 1 人', total: 2 }, '2026-10-25': { kind: 'ok', label: '人數足・3 人', total: 3 } });
});

test('getCalendar：只有分壇的活動，掛著的各區勤務附那天報了幾人', async () => {
  const env = setup();
  const r = await env.get('action=getCalendar&from=2026-10-01&to=2026-10-31');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.events.map((e) => e.name), ['統班', '明道班']);
  assert.deepEqual(r.data.events[0].links.map((l) => [l.unit, l.name, l.counts['2026-10-24']]),
    [['教善區', '志工團：統班', undefined], ['教慈區', '烹飪：統班', 2], ['教全區', '志工團：統班', undefined], ['教全區', '烹飪團輪值：統班烹飪', 4]]);
});

test('getLinked：各區的名單（只有名字）、還沒開放的區、教全區的名單', async () => {
  const env = setup();
  const r = await env.get('action=getLinked&id=E-1&date=2026-10-24');
  assert.equal(r.ok, true, JSON.stringify(r));
  const [shan, ci, jq] = r.data.links;
  assert.equal(ci.unit, '教慈區');
  assert.equal(ci.open, true);
  assert.deepEqual(ci.day.positions, [{ name: '烹飪', people: [{ name: '王小明' }, { name: '測試甲' }] }]);
  assert.equal(ci.link, 'https://bailixiao.github.io/region-signup/#/r/%E6%95%99%E6%85%88%E5%8D%80/e/F-E-3?date=2026-10-24');
  assert.equal(shan.open, false); // 教善區還沒開放
  assert.equal(jq.source, 'jiaoquan');
  assert.deepEqual(jq.day.positions.map((p) => p.people.map((x) => x.name)), [['王小明'], ['測試丙']]);
  const text = JSON.stringify(r);
  ['測試乙', '某佛堂', 'phone', 'accompany'].forEach((x) => assert.ok(!text.includes(x), x));
  // test=1：不檢查開放，讓各區報名系統自己回「還沒開設」
  const t = await env.get('action=getLinked&id=E-1&date=2026-10-24&test=1');
  assert.equal(t.data.links[0].open, false);
  assert.ok(!r.data.links.some((x) => x.source === 'local' && x.unit === '教全區'));
  const mdb = await env.get('action=getLinked&id=E-6&date=2026-10-25');
  assert.deepEqual(mdb.data.links, [{ unit: '教全區', name: '烹飪：明道班', source: 'local', open: false, hint: 'jiaoquan', key: '明道班' }]);
  const bad = await env.get('action=getLinked&id=E-404&date=2026-10-24');
  assert.equal(bad.error.code, 'NOT_FOUND');
});

test('單一教全區活動的名單：檢查代號、快取 2 分鐘', async () => {
  const env = setup();
  let r = await env.get('action=getRoster&id=jq-D-5');
  assert.equal(r.ok, true);
  await env.get('action=getRoster&id=jq-D-5');
  assert.equal(env.calls.filter((c) => c.endsWith(':getDuty')).length, 1);
  r = await env.get('action=getRoster&id=' + encodeURIComponent('jq-../x'));
  assert.equal(r.error.code, 'BAD_REQUEST');
});
