// 前端 js/site.js 和後端 worker/src/site.js 的共同欄位要一致；Service Worker 的快取名稱要帶網站路徑。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE } from '../worker/src/site.js';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

function frontSite() {
  const ctx = { window: {} };
  vm.runInNewContext(read('js/site.js'), ctx);
  return ctx.window.SITE;
}

test('前後端的名稱、區名、顏色一致', () => {
  const f = frontSite();
  assert.equal(f.name, SITE.name);
  assert.equal(f.fentan, SITE.fentan);
  assert.equal(f.roll, SITE.roll);
  assert.deepEqual([...f.units], SITE.units);
  assert.deepEqual([...f.colors], SITE.colors);
  assert.deepEqual(Object.keys(f.colorNames), SITE.colors);
});

test('16 區不重複', () => {
  assert.equal(new Set(SITE.units).size, 16);
});

test('Service Worker：快取名稱帶網站路徑，只清自己的', () => {
  const sw = read('sw.js');
  assert.match(sw, /const PREFIX = 'fentan-calendar:' \+ new URL\('\.\/', self\.location\)\.pathname/);
  assert.match(sw, /k\.indexOf\(PREFIX\) === 0 && k !== CACHE/);
});

test('index.html 的 js、css 版本號都一樣（改了要一起換）', () => {
  const html = read('index.html');
  const versions = new Set([...html.matchAll(/\?v=(\w+)/g)].map((m) => m[1]));
  assert.equal(versions.size, 1, [...versions].join(', '));
});

test('公開檔案裡沒有手機號碼', () => {
  const files = ['index.html', 'js/site.js', 'js/help.js', 'docs/spec.md', 'tools/dev-server.js'];
  files.forEach((f) => assert.doesNotMatch(read(f), /09\d{2}-?\d{3}-?\d{3}/, f));
});
