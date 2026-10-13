// 常見問題的截圖：用電腦上的 Chrome（無畫面模式）打開本機測試版（tools/dev-server.js --mock），
// 依下面的步驟操作後截圖，存到 img/help/*.png。截圖裡只有示範資料（沒有真的人名）。（做法同教全區的 tools/help-shots.js）
// 執行：先開測試版，再 SHOT_BASE=http://localhost:<port>/ node tools/help-shots.js [只拍某幾張的名字⋯]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.SHOT_BASE || 'http://localhost:5180/';
const OUT = path.join(__dirname, '..', 'img', 'help');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => fs.existsSync(p));
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  if (!CHROME) throw new Error('找不到 Chrome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir, '--no-first-run', '--hide-scrollbars', '--lang=zh-TW', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, ws: page.webSocketDebuggerUrl };
    } catch (e) { /* 還沒好 */ }
    await sleep(200);
  }
  throw new Error('Chrome 沒有啟動');
}

function client(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let id = 0;
    const waiting = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && waiting.has(msg.id)) {
        const { ok, fail } = waiting.get(msg.id);
        waiting.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
      }
    };
    const send = (method, params = {}) => new Promise((ok, fail) => {
      id += 1;
      waiting.set(id, { ok, fail });
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.onopen = () => resolve({ send, close: () => ws.close() });
  });
}

async function run(c, js) {
  const r = await c.send('Runtime.evaluate', { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}

// 回傳某個元素（或從 a 到 b）的範圍，給截圖用
const BOX = `
  window.__wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__box = (a, b, pad = 8) => {
    const ra = document.querySelector(a).getBoundingClientRect();
    const rb = document.querySelector(b || a).getBoundingClientRect();
    return { x: 0, y: Math.max(0, ra.top - pad) + scrollY, width: innerWidth, height: rb.bottom - ra.top + pad * 2 };
  };
`;

// 每一張：{ name, hash, js（打開後在頁面裡做的事）, clip（回傳截圖範圍） }
const SHOTS = [
  { name: 'filter', hash: '#/', js: `
      const s = document.getElementById('unit-filter'); s.value = '教真區'; s.dispatchEvent(new Event('change')); await __wait(500);`,
    clip: `return __box('#unit-bar', '#fc');` },
  { name: 'month', hash: '#/', js: `
      const s = document.getElementById('unit-filter'); s.value = '教真區'; s.dispatchEvent(new Event('change'));
      document.querySelector('[data-view=month]').click(); await __wait(500);`,
    tap: () => 'document.querySelector(".fc-daygrid-day .cell-dots").closest(".fc-daygrid-day")',
    clip: `return __box('#fc', '#day-panel');` },
  { name: 'detail', hash: '#/event/jq-D-demo5', js: `await __wait(600);`, clip: `return __box('.detail-head', '.detail-actions');` },
  { name: 'admin-list', hash: '#/admin', js: `
      if (!document.querySelector('.admin-row')) {
        const f = document.querySelector('.admin-login'); f.password.value = 'test-pass'; f.requestSubmit(); await __wait(800);
      }`,
    clip: `return __box('.admin-head', '.admin-row:nth-child(2)');` },
  { name: 'admin-import', hash: '#/admin/import', js: `
      if (document.querySelector('.admin-login')) {
        const f = document.querySelector('.admin-login'); f.password.value = 'test-pass'; f.requestSubmit(); await __wait(800);
        location.hash = '#/admin/import'; await __wait(800);
      }
      // 示範用的匯入檔：兩筆可以匯入、一筆有錯
      const events = [
        { unit: '教美區', category: '教育', name: '教美區親子讀經（範例）', start: '2026-11-07', startTime: '09:30', endTime: '11:00', location: '教美區中心' },
        { unit: '教孝區', category: '道務', name: '教孝區研究班（範例）', start: '2026-11-10', startTime: '19:30', location: '教孝區佛堂' },
        { unit: '教全區', category: '勤務', name: '教全區打掃（範例）', start: '2026-11-12' }
      ];
      const input = document.querySelector('.import-pick input');
      const dt = new DataTransfer();
      dt.items.add(new File([JSON.stringify({ title: '十一月各區活動（範例）', events })], 'example.json', { type: 'application/json' }));
      input.files = dt.files; input.dispatchEvent(new Event('change')); await __wait(800);`,
    clip: `await __wait(800); scrollTo({ top: 0, behavior: 'instant' }); return __box('.admin-sub', '.imp-list');` }
];

async function main() {
  const only = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  const { proc, ws } = await launch();
  const c = await client(ws);
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const s of SHOTS) {
      if (only.length && only.indexOf(s.name) === -1) continue;
      await c.send('Page.navigate', { url: BASE + s.hash });
      await sleep(1500);
      await run(c, BOX + s.js);
      if (s.tap) {
        // FullCalendar 的點日期要真的點（滑鼠事件）
        const r = await run(c, `const el = ${s.tap()}; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`);
        for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
        await sleep(400);
      }
      const r = await run(c, BOX + s.clip);
      const clip = { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 1400), scale: 1 };
      const res = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
      fs.writeFileSync(path.join(OUT, s.name + '.png'), Buffer.from(res.data, 'base64'));
      console.log('✓', s.name);
    }
  } finally {
    c.close();
    proc.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
