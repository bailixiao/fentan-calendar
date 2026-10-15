// 本機預覽用的靜態伺服器（不需安裝套件）。執行：node tools/dev-server.js，連接埠用環境變數 PORT（沒有就 5180）。
// 加上 --mock：不連正式 API，改跑和正式相同的 Worker 程式（資料放記憶體、管理密碼 test-pass、點名 roll-pass、教慈區組長 ci-pass），
// 放幾個示範的班和假名報名。適合在部署前測試，不會動到真的資料。
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

let worker = null;
async function startMock() {
  const { createFront } = await import('../worker/src/front.js');
  const { createStoreApp } = await import('../worker/src/store-app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  // 假的對外連線：推播不真的送（只印出來）
  const fakeFetch = async (url) => {
    console.log('（假）送推播', String(url).slice(0, 60));
    return { ok: true, status: 201, json: async () => ({}) };
  };
  let alarmTimer = null;
  const storeApp = createStoreApp(createMemoryStore(), {
    password: () => 'test-pass',
    fetch: fakeFetch,
    setAlarm: (ms) => { clearTimeout(alarmTimer); alarmTimer = setTimeout(() => storeApp.alarm(), Math.max(0, ms - Date.now())); }
  });
  const front = createFront({ callStore: (body) => storeApp.call(body), boardTtl: 0 });
  // 示範資料：兩個班（隔週六）、一個臨時活動，幾個假名報名
  const token = (await storeApp.call({ action: 'adminLogin', password: 'test-pass' })).data.token;
  const sat = (() => { const d = new Date(Date.now() + 8 * 3600e3); d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7)); return d.toISOString().slice(0, 10); })();
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mk = async (course, plan) => (await storeApp.call({ action: 'adminCourseSave', token, course, plan })).data.course;
  const high = await mk({ name: '高大班', color: 'blue', startTime: '10:00', endTime: '12:00', location: '分壇教室', intro: '給高中、大學的班員。隔週六上課，每一堂都要各自報名。', order: 1 }, { first: addDays(sat, -28), until: addDays(sat, 140) });
  const teen = await mk({ name: '青少年班', color: 'green', startTime: '14:00', endTime: '16:00', location: '分壇佛堂', intro: '給國中的班員。', order: 2 }, { first: addDays(sat, 7), until: addDays(sat, 147) });
  await mk({ name: '親子讀書會', color: 'orange', startTime: '19:30', endTime: '21:00', location: '分壇教室', order: 3 }, { dates: [addDays(sat, 3)] });
  const board = (await storeApp.call({ action: 'getBoard' })).data;
  const sessions = (c) => board.courses.find((x) => x.id === c.id).sessions;
  const topics = [['感恩的心', '測試甲'], ['做人的道理', '王小明'], ['讀經分享', '測試乙'], ['團隊合作', '李小華']];
  for (const c of [high, teen]) {
    const list = sessions(c);
    for (let n = 0; n < list.length; n++) {
      const [topic, teacher] = topics[n % topics.length];
      await storeApp.call({ action: 'adminSessionSave', token, session: Object.assign({}, list[n], { topic, teacher, deadline: list[n].setDeadline, content: n % 2 ? '' : '帶筆記本。' }) });
    }
  }
  const FAKE = [['教真區', '王小明 測試甲'], ['教善區', '測試乙'], ['教慈區', '李小華、陳大同'], ['教全區', '林小美']];
  const next = sessions(high).find((s) => s.date >= board.today);
  for (const [unit, names] of FAKE) await storeApp.call({ action: 'signup', sessionId: next.id, names, unit, token: 'mock-device-0000000000' });
  const past = sessions(high).filter((s) => s.date < board.today);
  for (const s of past) {
    await storeApp.call({ action: 'adminSignup', token, sessionId: s.id, names: '王小明 測試甲', unit: '教真區' });
  }
  // 帳號（本機測試用密碼）：點名 roll-pass、教慈區組長 ci-pass
  await storeApp.call({ action: 'adminSetAccount', token, name: '點名', password: 'roll-pass' });
  await storeApp.call({ action: 'adminSetAccount', token, name: '教慈區', password: 'ci-pass' });
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
