// 資料存放：Durable Object 內建的 SQLite（正式）或記憶體（測試、本機預覽）。兩種的用法完全相同。
//   events：手動輸入的活動（一筆一列，內容存 JSON）；log：操作紀錄；sessions：登入通行碼（只存雜湊）；props：其他小設定。

const LOG_KEEP = 2000; // 操作紀錄最多留幾筆

/** 測試、本機預覽用：全部放記憶體 */
export function createMemoryStore() {
  const events = new Map();
  const log = [];
  const sessions = new Map();
  const props = new Map();
  return {
    allEvents: () => [...events.values()].map((e) => ({ ...e })),
    getEvent: (id) => (events.has(id) ? { ...events.get(id) } : null),
    putEvent: (ev) => { events.set(ev.id, { ...ev }); },
    deleteEvent: (id) => { events.delete(id); },
    addLog: (entry) => { log.push({ ...entry }); if (log.length > LOG_KEEP) log.splice(0, log.length - LOG_KEEP); },
    listLog: (limit) => log.slice(-limit).reverse(),
    putSession: (hash, exp) => { sessions.set(hash, exp); },
    getSession: (hash) => (sessions.has(hash) ? sessions.get(hash) : null),
    deleteSession: (hash) => { sessions.delete(hash); },
    purgeSessions: (now) => { sessions.forEach((exp, k) => { if (exp <= now) sessions.delete(k); }); },
    getProp: (k) => (props.has(k) ? props.get(k) : null),
    setProp: (k, v) => { props.set(k, v); }
  };
}

/** 正式：Durable Object 的 SQLite（ctx.storage.sql） */
export function createSqlStore(storage) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS log (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, exp INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS props (k TEXT PRIMARY KEY, v TEXT)');
  const one = (cursor) => { const r = cursor.toArray(); return r.length ? r[0] : null; };

  return {
    allEvents: () => sql.exec('SELECT data FROM events').toArray().map((r) => JSON.parse(r.data)),
    getEvent: (id) => { const r = one(sql.exec('SELECT data FROM events WHERE id = ?', id)); return r ? JSON.parse(r.data) : null; },
    putEvent: (ev) => { sql.exec('INSERT INTO events (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', ev.id, JSON.stringify(ev)); },
    deleteEvent: (id) => { sql.exec('DELETE FROM events WHERE id = ?', id); },
    addLog: (entry) => {
      sql.exec('INSERT INTO log (data) VALUES (?)', JSON.stringify(entry));
      sql.exec('DELETE FROM log WHERE seq <= (SELECT MAX(seq) FROM log) - ?', LOG_KEEP);
    },
    listLog: (limit) => sql.exec('SELECT data FROM log ORDER BY seq DESC LIMIT ?', limit).toArray().map((r) => JSON.parse(r.data)),
    putSession: (hash, exp) => { sql.exec('INSERT INTO sessions (hash, exp) VALUES (?, ?) ON CONFLICT(hash) DO UPDATE SET exp = excluded.exp', hash, exp); },
    getSession: (hash) => { const r = one(sql.exec('SELECT exp FROM sessions WHERE hash = ?', hash)); return r ? r.exp : null; },
    deleteSession: (hash) => { sql.exec('DELETE FROM sessions WHERE hash = ?', hash); },
    purgeSessions: (now) => { sql.exec('DELETE FROM sessions WHERE exp <= ?', now); },
    getProp: (k) => { const r = one(sql.exec('SELECT v FROM props WHERE k = ?', k)); return r ? r.v : null; },
    setProp: (k, v) => { sql.exec('INSERT INTO props (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v); }
  };
}
