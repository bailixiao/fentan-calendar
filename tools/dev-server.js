// 本機預覽用的靜態伺服器（不需安裝套件）。執行：node tools/dev-server.js，連接埠用環境變數 PORT（沒有就 5180）。
// 加上 --mock（教慈區組長帳號 ci-pass、測試區 test-area）：不連正式 API，改跑和正式相同的 Worker 程式（資料放記憶體、管理密碼 test-pass），
// 教全區的活動用假資料，另外放幾筆示範活動。適合在部署前測試，不會動到真的資料。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const mock = process.argv.includes('--mock');
const port = Number(process.env.PORT) || 5180;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

// 以今天為準的日期（示範資料都在今天前後）
function day(offset) {
  const d = new Date(Date.now() + 8 * 3600e3 + offset * 86400e3);
  return d.toISOString().slice(0, 10);
}

/** 假的教全區 getEvents 回應（故意放人名欄位，確認分壇不會轉出去） */
function fakeJiaoquan(year) {
  const inYear = (d) => d.slice(0, 4) === String(year);
  const duties = [
    { id: 'D-demo1', name: '宏宗大掃除', category: '勤務', nature: '勤務', mode: '報名型', start: day(3), end: day(3), startTime: '08:30', endTime: '11:30', location: '宏宗', attire: '輕便服裝', groupLeader: '測試甲' },
    { id: 'D-demo2', name: '初一十五班', category: '道務', nature: '課程', mode: '報名型', start: day(6), end: day(6), startTime: '07:30', endTime: '', location: '宏宗', attire: '' },
    { id: 'D-demo3', name: '拜香輪值', category: '道務', nature: '法會', mode: '公告型', start: day(6), end: day(6), startTime: '06:30', endTime: '07:30', location: '宏宗', attire: '道服', leaders: '測試乙' },
    { id: 'D-demo4', name: '青少年班', category: '教育', nature: '課程', mode: '報名型', start: day(10), end: day(10), startTime: '14:00', endTime: '16:00', location: '區中心', attire: '' },
    { id: 'D-demo5', name: '彌勒山志工輪值', category: '勤務', nature: '勤務', mode: '報名型', start: day(17), end: day(19), startTime: '09:00', endTime: '17:00', location: '彌勒山', attire: '' }
  ].filter((d) => inYear(d.start) || inYear(d.end));
  return { ok: true, data: { contact: '測試丙', venue: [{ date: day(2), slot: '晚上', name: '測試丁', purpose: '讀書會' }], duties: duties.map(withSignups) } };
}

// 假的報名（只有假名）：了愿項目、每天人數、名單
const FAKE_NAMES = ['王小明', '測試甲', '測試乙', '測試丙', '李小華', '陳大同', '林小美'];
function withSignups(d) {
  if (d.mode === '公告型') return Object.assign({ positions: [], days: {}, signups: [] }, d);
  const positions = d.category === '勤務'
    ? [{ id: d.id + '-P1', name: d.name.includes('打掃') ? '打掃' : '勤務', min: 3, max: null }, { id: d.id + '-P2', name: '茶水', min: 1, max: 1 }]
    : [{ id: d.id + '-P1', name: '參加', min: 0, max: null }];
  const days = {};
  const signups = [];
  let k = d.id.length;
  for (let t = Date.parse(d.start); t <= Date.parse(d.end); t += 86400e3) {
    const date = new Date(t).toISOString().slice(0, 10);
    const counts = {};
    positions.forEach((p, i) => {
      const n = (k++ % 3) + (i ? 0 : 1);
      counts[p.id] = Math.min(n, p.max === null ? n : p.max);
      for (let j = 0; j < counts[p.id]; j++) signups.push({ id: 'S' + signups.length, date, positionId: p.id, name: FAKE_NAMES[(k + j) % FAKE_NAMES.length], temple: '（假）', accompany: j === 2, note: '' });
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    days[date] = { total, people: total, shortage: 0, full: false, counts };
  }
  return Object.assign({}, d, { positions, days, signups });
}

let worker = null;
async function startMock() {
  const { createFront } = await import('../worker/src/front.js');
  const { createStoreApp } = await import('../worker/src/store-app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  // 假的對外連線：教全區給假資料；推播不真的送（只印出來）
  const fakeFetch = async (url) => {
    if (url.startsWith('https://duty-calendar-api')) {
      const q = new URL(url).searchParams;
      const all = fakeJiaoquan(Number(day(0).slice(0, 4))).data.duties.concat(fakeJiaoquan(Number(day(0).slice(0, 4)) + 1).data.duties);
      if (q.get('action') === 'getBundle') {
        const details = {};
        all.filter((d) => d.start <= q.get('to') && d.end >= q.get('from')).forEach((d) => { details[d.id] = d; });
        return { ok: true, json: async () => ({ ok: true, data: { duties: [], details } }) };
      }
      if (q.get('action') === 'getDuty') {
        const d = all.find((x) => x.id === q.get('id'));
        return { ok: true, json: async () => (d ? { ok: true, data: d } : { ok: false, error: { code: 'NOT_FOUND', message: '找不到' } }) };
      }
      return { ok: true, json: async () => fakeJiaoquan(Number(q.get('from').slice(0, 4))) };
    }
    console.log('（假）送推播', url.slice(0, 60));
    return { ok: true, status: 201, json: async () => ({}) };
  };
  let alarmTimer = null;
  const storeApp = createStoreApp(createMemoryStore(), {
    password: () => 'test-pass',
    fetch: fakeFetch,
    setAlarm: (ms) => { clearTimeout(alarmTimer); alarmTimer = setTimeout(() => storeApp.alarm(), Math.max(0, ms - Date.now())); }
  });
  const front = createFront({ callStore: (body) => storeApp.call(body), fetch: fakeFetch, localTtl: 0 });
  // 示範活動
  const token = (await storeApp.call({ action: 'adminLogin', password: 'test-pass' })).data.token;
  const demo = [
    { unit: '分壇', category: '道務', name: '統班', start: day(11), startTime: '08:00', location: '彌勒山', note: '由人才團負責。' },
    { unit: '教慈區', category: '勤務', name: '烹飪：統班', start: day(11), location: '彌勒山', positions: [{ name: '烹飪', min: 15 }] },
    { unit: '教真區', category: '勤務', name: '志工團：統班', start: day(11), location: '彌勒山' },
    { unit: '教力區', category: '道務', name: '宏宗獻供拜香（大典）', start: day(12), location: '宏宗' },
    { unit: '教發區', category: '道務', name: '宏宗獻供拜香（大典）', start: day(12), location: '宏宗' },
    { unit: '分壇', category: '道務', name: '分壇法會', start: day(1), startTime: '09:00', endTime: '12:00', location: '分壇佛堂', note: '歡迎各區家人一起參加。\n請穿道服。' },
    { unit: '分壇', category: '勤務', name: '分壇大型勤務：場地布置', start: day(8), end: day(9), startTime: '08:00', endTime: '17:00', location: '分壇佛堂' },
    { unit: '分壇', category: '教育', name: '分壇講師研習', start: day(15), startTime: '19:30', endTime: '21:30', location: '分壇教室', link: 'https://example.com/' },
    { unit: '教真區', kind: '區活動', category: '道務', name: '教真區研究班', start: day(1), startTime: '19:30', location: '教真區佛堂' },
    { unit: '教善區', kind: '區活動', category: '教育', name: '教善區讀經班', start: day(4), startTime: '10:00', endTime: '11:30', location: '教善區中心' },
    { unit: '教慈區', kind: '區活動', category: '勤務', name: '教慈區打掃', start: day(6), startTime: '08:00', location: '教慈區佛堂' },
    { unit: '教理區', kind: '區活動', category: '道務', name: '教理區法會', start: day(12), startTime: '09:00', location: '教理區佛堂' }
  ];
  const made = [];
  for (const ev of demo) made.push((await storeApp.call({ action: 'adminSave', token, event: ev })).data.event);
  // 組長帳號（本機測試用密碼）與示範名單（假名）
  await storeApp.call({ action: 'adminSetAccount', token, unit: '教慈區', password: 'ci-pass' });
  await storeApp.call({ action: 'adminSetAccount', token, unit: '測試區', password: 'test-area' });
  const cook = made.find((e) => e.name === '烹飪：統班');
  await storeApp.call({ action: 'adminRosterSave', token, id: cook.id, date: cook.start, key: cook.positions[0].id, names: '王小明、測試甲、李小華' });
  await storeApp.call({ action: 'adminLogout', token });
  worker = front;
}

async function handleApi(req, res, url) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await worker.handle(new Request('http://localhost/' + url.search, req.method === 'POST' ? { method: 'POST', body: Buffer.concat(chunks) } : { method: req.method }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const urlPath = decodeURIComponent(url.pathname);
  if (mock && urlPath === '/api') return handleApi(req, res, url);
  if (mock && urlPath === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' });
    res.end(`window.APP_CONFIG = { API_URL: '/api' };`);
    return;
  }
  const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
(mock ? startMock() : Promise.resolve()).then(() => server.listen(port, () => console.log(`http://localhost:${port}${mock ? '（模擬 API，跑 Worker 程式）' : ''}`)));
