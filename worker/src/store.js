// 資料存放：Durable Object 內建的 SQLite（正式）或記憶體（測試、本機預覽）。兩種的用法完全相同。
//   docs：教育組報名的資料（kind＝course／session／signup，一筆一列 JSON；規格第 11 節）。
//   events：第一版的活動（只剩「刪除舊資料」會用到）；log：操作紀錄；sessions：登入通行碼（只存雜湊）；props：其他小設定。
//   手機提醒：subs（推播訂閱：代號、推播網址、單位）、inbox（每支手機待顯示的通知）、msgs（管理者發的通知）、jobs（送出工作，分批送）。

const LOG_KEEP = 2000; // 操作紀錄最多留幾筆

/** 測試、本機預覽用：全部放記憶體 */
export function createMemoryStore() {
  const events = new Map();
  const docs = new Map(); // kind → Map(id → 資料)
  const log = [];
  const sessions = new Map();
  const props = new Map();
  const subs = new Map();
  let inbox = [];
  let inboxSeq = 0;
  const msgs = new Map();
  const jobs = new Map();
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    allDocs: (kind) => [...(docs.get(kind) || new Map()).values()].map((d) => JSON.parse(JSON.stringify(d))),
    getDoc: (kind, id) => { const m = docs.get(kind); return m && m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null; },
    putDoc: (kind, doc) => { if (!docs.has(kind)) docs.set(kind, new Map()); docs.get(kind).set(doc.id, JSON.parse(JSON.stringify(doc))); },
    deleteDoc: (kind, id) => { const m = docs.get(kind); if (m) m.delete(id); },
    allEvents: () => [...events.values()].map((e) => ({ ...e })),
    getEvent: (id) => (events.has(id) ? { ...events.get(id) } : null),
    putEvent: (ev) => { events.set(ev.id, { ...ev }); },
    deleteEvent: (id) => { events.delete(id); },
    addLog: (entry) => { log.push({ ...entry }); if (log.length > LOG_KEEP) log.splice(0, log.length - LOG_KEEP); },
    listLog: (limit) => log.slice(-limit).reverse(),
    // who：''＝總管理者，區名＝那一區的組長帳號
    putSession: (hash, exp, who) => { sessions.set(hash, { exp, who: who || '' }); },
    getSession: (hash) => (sessions.has(hash) ? sessions.get(hash).exp : null),
    getSessionWho: (hash) => (sessions.has(hash) ? sessions.get(hash).who : null),
    deleteSession: (hash) => { sessions.delete(hash); },
    deleteSessionsOf: (who) => { sessions.forEach((v, k) => { if (v.who === who) sessions.delete(k); }); },
    purgeSessions: (now) => { sessions.forEach((v, k) => { if (v.exp <= now) sessions.delete(k); }); },
    getProp: (k) => (props.has(k) ? props.get(k) : null),
    setProp: (k, v) => { props.set(k, v); },
    putSub: (sub) => { subs.set(sub.id, { ...sub }); },
    getSub: (id) => (subs.has(id) ? { ...subs.get(id) } : null),
    deleteSub: (id) => { subs.delete(id); },
    subsAfter: (cursor, units, limit) => [...subs.values()].filter((x) => x.id > cursor && (!units || units.indexOf(x.unit) !== -1)).sort(byId).slice(0, limit).map((x) => ({ ...x })),
    subCounts: () => { const c = {}; subs.forEach((x) => { c[x.unit] = (c[x.unit] || 0) + 1; }); return c; },
    addInbox: (dev, content, exp) => { inbox.push({ seq: ++inboxSeq, dev, content: { ...content }, exp }); },
    takeInbox: (dev, now) => {
      inbox = inbox.filter((x) => x.exp > now);
      const i = inbox.findIndex((x) => x.dev === dev);
      return i === -1 ? null : inbox.splice(i, 1)[0].content;
    },
    putMsg: (m) => { msgs.set(m.id, { ...m }); },
    getMsg: (id) => (msgs.has(id) ? { ...msgs.get(id) } : null),
    listMsgs: (limit) => [...msgs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.id < a.id ? -1 : 1)).slice(0, limit).map((x) => ({ ...x })),
    putJob: (j) => { jobs.set(j.id, JSON.parse(JSON.stringify(j))); },
    deleteJob: (id) => { jobs.delete(id); },
    dueJobs: (now) => [...jobs.values()].filter((j) => j.runAt <= now).sort((a, b) => a.runAt - b.runAt).map((j) => JSON.parse(JSON.stringify(j))),
    nextJobTime: () => { let t = null; jobs.forEach((j) => { if (t === null || j.runAt < t) t = j.runAt; }); return t; }
  };
}

/** 正式：Durable Object 的 SQLite（ctx.storage.sql） */
export function createSqlStore(storage) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS log (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS docs (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (kind, id))');
  sql.exec('CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, exp INTEGER NOT NULL)');
  // 2026/10/13：加上 who（''＝總管理者、區名＝組長帳號）；舊的表沒有這一欄就補上
  if (!sql.exec('PRAGMA table_info(sessions)').toArray().some((c) => c.name === 'who')) sql.exec("ALTER TABLE sessions ADD COLUMN who TEXT NOT NULL DEFAULT ''");
  sql.exec('CREATE TABLE IF NOT EXISTS props (k TEXT PRIMARY KEY, v TEXT)');
  sql.exec('CREATE TABLE IF NOT EXISTS subs (id TEXT PRIMARY KEY, unit TEXT NOT NULL, data TEXT NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS subs_unit ON subs (unit, id)');
  sql.exec('CREATE TABLE IF NOT EXISTS inbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, dev TEXT NOT NULL, content TEXT NOT NULL, exp INTEGER NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS inbox_dev ON inbox (dev, seq)');
  sql.exec('CREATE TABLE IF NOT EXISTS msgs (id TEXT PRIMARY KEY, created TEXT NOT NULL, data TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, run_at INTEGER NOT NULL, data TEXT NOT NULL)');
  const one = (cursor) => { const r = cursor.toArray(); return r.length ? r[0] : null; };

  return {
    allDocs: (kind) => sql.exec('SELECT data FROM docs WHERE kind = ?', kind).toArray().map((r) => JSON.parse(r.data)),
    getDoc: (kind, id) => { const r = one(sql.exec('SELECT data FROM docs WHERE kind = ? AND id = ?', kind, id)); return r ? JSON.parse(r.data) : null; },
    putDoc: (kind, doc) => { sql.exec('INSERT INTO docs (kind, id, data) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data', kind, doc.id, JSON.stringify(doc)); },
    deleteDoc: (kind, id) => { sql.exec('DELETE FROM docs WHERE kind = ? AND id = ?', kind, id); },
    allEvents: () => sql.exec('SELECT data FROM events').toArray().map((r) => JSON.parse(r.data)),
    getEvent: (id) => { const r = one(sql.exec('SELECT data FROM events WHERE id = ?', id)); return r ? JSON.parse(r.data) : null; },
    putEvent: (ev) => { sql.exec('INSERT INTO events (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', ev.id, JSON.stringify(ev)); },
    deleteEvent: (id) => { sql.exec('DELETE FROM events WHERE id = ?', id); },
    addLog: (entry) => {
      sql.exec('INSERT INTO log (data) VALUES (?)', JSON.stringify(entry));
      sql.exec('DELETE FROM log WHERE seq <= (SELECT MAX(seq) FROM log) - ?', LOG_KEEP);
    },
    listLog: (limit) => sql.exec('SELECT data FROM log ORDER BY seq DESC LIMIT ?', limit).toArray().map((r) => JSON.parse(r.data)),
    putSession: (hash, exp, who) => { sql.exec('INSERT INTO sessions (hash, exp, who) VALUES (?, ?, ?) ON CONFLICT(hash) DO UPDATE SET exp = excluded.exp, who = excluded.who', hash, exp, who || ''); },
    getSession: (hash) => { const r = one(sql.exec('SELECT exp FROM sessions WHERE hash = ?', hash)); return r ? r.exp : null; },
    getSessionWho: (hash) => { const r = one(sql.exec('SELECT who FROM sessions WHERE hash = ?', hash)); return r ? r.who : null; },
    deleteSession: (hash) => { sql.exec('DELETE FROM sessions WHERE hash = ?', hash); },
    deleteSessionsOf: (who) => { sql.exec('DELETE FROM sessions WHERE who = ?', who); },
    purgeSessions: (now) => { sql.exec('DELETE FROM sessions WHERE exp <= ?', now); },
    getProp: (k) => { const r = one(sql.exec('SELECT v FROM props WHERE k = ?', k)); return r ? r.v : null; },
    setProp: (k, v) => { sql.exec('INSERT INTO props (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v); },
    putSub: (sub) => { sql.exec('INSERT INTO subs (id, unit, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET unit = excluded.unit, data = excluded.data', sub.id, sub.unit, JSON.stringify(sub)); },
    getSub: (id) => { const r = one(sql.exec('SELECT data FROM subs WHERE id = ?', id)); return r ? JSON.parse(r.data) : null; },
    deleteSub: (id) => { sql.exec('DELETE FROM subs WHERE id = ?', id); },
    subsAfter: (cursor, units, limit) => {
      const rows = units
        ? sql.exec(`SELECT data FROM subs WHERE id > ? AND unit IN (${units.map(() => '?').join(',')}) ORDER BY id LIMIT ?`, cursor, ...units, limit)
        : sql.exec('SELECT data FROM subs WHERE id > ? ORDER BY id LIMIT ?', cursor, limit);
      return rows.toArray().map((r) => JSON.parse(r.data));
    },
    subCounts: () => { const c = {}; sql.exec('SELECT unit, COUNT(*) AS n FROM subs GROUP BY unit').toArray().forEach((r) => { c[r.unit] = r.n; }); return c; },
    addInbox: (dev, content, exp) => { sql.exec('INSERT INTO inbox (dev, content, exp) VALUES (?, ?, ?)', dev, JSON.stringify(content), exp); },
    takeInbox: (dev, now) => {
      sql.exec('DELETE FROM inbox WHERE exp <= ?', now);
      const r = one(sql.exec('SELECT seq, content FROM inbox WHERE dev = ? ORDER BY seq LIMIT 1', dev));
      if (!r) return null;
      sql.exec('DELETE FROM inbox WHERE seq = ?', r.seq);
      return JSON.parse(r.content);
    },
    putMsg: (m) => { sql.exec('INSERT INTO msgs (id, created, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', m.id, m.createdAt, JSON.stringify(m)); },
    getMsg: (id) => { const r = one(sql.exec('SELECT data FROM msgs WHERE id = ?', id)); return r ? JSON.parse(r.data) : null; },
    listMsgs: (limit) => sql.exec('SELECT data FROM msgs ORDER BY created DESC, id DESC LIMIT ?', limit).toArray().map((r) => JSON.parse(r.data)),
    putJob: (j) => { sql.exec('INSERT INTO jobs (id, run_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET run_at = excluded.run_at, data = excluded.data', j.id, j.runAt, JSON.stringify(j)); },
    deleteJob: (id) => { sql.exec('DELETE FROM jobs WHERE id = ?', id); },
    dueJobs: (now) => sql.exec('SELECT data FROM jobs WHERE run_at <= ? ORDER BY run_at', now).toArray().map((r) => JSON.parse(r.data)),
    nextJobTime: () => { const r = one(sql.exec('SELECT MIN(run_at) AS t FROM jobs')); return r && r.t !== null ? r.t : null; }
  };
}
