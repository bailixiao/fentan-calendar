// 分壇教育組報名（規格第 4～7、9 節）：班、每一堂、報名、點名。在 Durable Object 裡執行，寫入依序處理。
// 資料：store 的 docs 表，kind＝course／session／signup。點名存在 signup 上（roll：到／請假／缺席）。
import { SITE } from './site.js';
import { AppError, addDays, cleanNames, isDate, isTime, isUnit, str, taipeiDate, taipeiStamp, unitOrder } from './logic.js';

export const ROLL = ['到', '請假', '缺席'];
const MAX_SESSIONS = 200; // 一個班最多幾堂
const MAX_SIGNUPS = 300; // 一堂最多幾人

/** 第一堂之後每 14 天（隔週六），排到 until（含） */
export function biweekly(first, until) {
  const out = [];
  if (!isDate(first) || !isDate(until) || until < first) return out;
  for (let d = first; d <= until && out.length < MAX_SESSIONS; d = addDays(d, 14)) out.push(d);
  return out;
}

/** 第一堂是那個月的第幾個星期幾（1～5；第 5 個＝最後一個） */
export function nthWeekday(date) {
  return Math.ceil(Number(date.slice(8, 10)) / 7);
}

/**
 * 一個月一次：每個月的「第 n 個星期幾」（n＝1～4，5＝最後一個；wd＝0 星期日～6 星期六），從 first 排到 until（含）。
 * 沒給 n、wd 就照 first 那一天算。
 */
export function monthly(first, until, nth, weekday) {
  const out = [];
  if (!isDate(first) || !isDate(until) || until < first) return out;
  const wd = Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : new Date(first + 'T00:00:00Z').getUTCDay();
  const n = Number.isInteger(nth) && nth >= 1 && nth <= 5 ? nth : nthWeekday(first);
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7)) - 1;
  for (let k = 0; k < 24 && out.length < MAX_SESSIONS; k++, m++) {
    const firstDay = new Date(Date.UTC(y, m, 1));
    const offset = (wd - firstDay.getUTCDay() + 7) % 7;
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let day = 1 + offset + (Math.min(n, 5) - 1) * 7;
    if (n >= 5 || day > days) { day = 1 + offset; while (day + 7 <= days) day += 7; } // 最後一個
    const d = new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
    if (d > until) break;
    if (d >= first) out.push(d);
  }
  return out;
}

/** 報名截止：每堂自己填的，沒填＝上課前一天 */
export const deadlineOf = (s) => s.deadline || addDays(s.date, -1);

function limit(v, n, label, errs) {
  if (v.length > n) errs.push(`${label}最多 ${n} 字`);
  return v;
}

function cleanTime(v, label, errs) {
  const t = str(v);
  if (t && !isTime(t)) errs.push(`${label}格式不對（例：09:30）`);
  return t;
}

/** 班：名稱、顏色、介紹、預設時間地點、開放、排序 */
export function cleanCourse(input) {
  if (!input || typeof input !== 'object') throw new AppError('BAD_REQUEST', '班的資料格式錯誤');
  const errs = [];
  const c = {
    name: limit(str(input.name), 30, '班的名稱', errs),
    color: SITE.colors.indexOf(input.color) !== -1 ? input.color : SITE.colors[0],
    intro: limit(str(input.intro).replace(/\r\n?/g, '\n'), 1000, '介紹', errs),
    startTime: cleanTime(input.startTime, '開始時間', errs),
    endTime: cleanTime(input.endTime, '結束時間', errs),
    location: limit(str(input.location), 60, '地點', errs),
    open: input.open !== false,
    order: Number.isInteger(Number(input.order)) ? Number(input.order) : 0
  };
  if (!c.name) errs.push('請填班的名稱');
  if (c.endTime && !c.startTime) errs.push('有結束時間就要填開始時間');
  if (errs.length) throw new AppError('BAD_REQUEST', errs.join('；'));
  return c;
}

/** 一堂：日期、時間地點、主題、講師、內容、截止、名額、停課 */
export function cleanSession(input) {
  if (!input || typeof input !== 'object') throw new AppError('BAD_REQUEST', '課的資料格式錯誤');
  const errs = [];
  const capText = str(input.cap);
  const s = {
    date: str(input.date),
    startTime: cleanTime(input.startTime, '開始時間', errs),
    endTime: cleanTime(input.endTime, '結束時間', errs),
    location: limit(str(input.location), 60, '地點', errs),
    topic: limit(str(input.topic), 60, '主題', errs),
    teacher: limit(str(input.teacher), 40, '講師', errs),
    content: limit(str(input.content).replace(/\r\n?/g, '\n'), 1000, '課程內容', errs),
    deadline: str(input.deadline),
    cap: capText === '' ? null : Number(capText),
    cancelled: input.cancelled === true
  };
  if (!isDate(s.date)) errs.push('日期格式不對');
  if (s.deadline && !isDate(s.deadline)) errs.push('報名截止日期格式不對');
  else if (s.deadline && isDate(s.date) && s.deadline > s.date) errs.push('報名截止不能晚於上課那天');
  if (s.cap !== null && (!Number.isInteger(s.cap) || s.cap < 1 || s.cap > MAX_SIGNUPS)) errs.push(`名額要是 1～${MAX_SIGNUPS} 的整數`);
  if (s.endTime && !s.startTime) errs.push('有結束時間就要填開始時間');
  if (errs.length) throw new AppError('BAD_REQUEST', errs.join('；'));
  return s;
}

/**
 * @param store 資料存放（docs 表）
 * @param opts.now () => 毫秒
 * @param opts.randomHex (bytes) => 亂數
 * @param opts.sha256 (text) => Promise<雜湊>
 * @param opts.log (action, entry) => void 寫操作紀錄
 */
export function createEduApp(store, opts) {
  const now = opts.now;
  const today = () => taipeiDate(now());
  const newId = (prefix) => prefix + '-' + taipeiDate(now()).replace(/-/g, '') + '-' + opts.randomHex(4);
  const courses = () => store.allDocs('course');
  const sessionsOf = (courseId) => store.allDocs('session').filter((s) => s.courseId === courseId).sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''));
  const signupsOf = (sessionId) => store.allDocs('signup').filter((r) => r.sessionId === sessionId);
  const sortCourses = (list) => list.sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || a.order - b.order || a.createdAt.localeCompare(b.createdAt));

  function mustCourse(id) {
    const c = typeof id === 'string' ? store.getDoc('course', id) : null;
    if (!c) throw new AppError('NOT_FOUND', '找不到這個班，可能已經刪除');
    return c;
  }
  function mustSession(id) {
    const s = typeof id === 'string' ? store.getDoc('session', id) : null;
    if (!s) throw new AppError('NOT_FOUND', '找不到這堂課，可能已經刪除或改了日期');
    return s;
  }

  /** 一堂給畫面看的樣子：第幾堂、截止、報名人數、能不能報 */
  function view(s, no, signups) {
    const count = signups.length;
    const deadline = deadlineOf(s);
    const full = s.cap !== null && s.cap !== undefined && count >= s.cap;
    const closed = s.cancelled || today() > deadline;
    return {
      id: s.id, courseId: s.courseId, date: s.date, startTime: s.startTime || '', endTime: s.endTime || '', location: s.location || '',
      topic: s.topic || '', teacher: s.teacher || '', content: s.content || '', cancelled: !!s.cancelled,
      cap: s.cap === undefined ? null : s.cap, deadline, setDeadline: s.deadline || '', no, count, full, closed, canSignup: !closed && !full
    };
  }

  /** 一個班的每一堂（照日期），第幾堂不算停課的 */
  function sessionViews(courseId, signups) {
    let n = 0;
    const by = {};
    signups.forEach((r) => { (by[r.sessionId] ||= []).push(r); });
    return sessionsOf(courseId).map((s) => view(s, s.cancelled ? 0 : ++n, by[s.id] || []));
  }

  const courseView = (c) => ({ id: c.id, name: c.name, color: c.color, intro: c.intro || '', startTime: c.startTime || '', endTime: c.endTime || '', location: c.location || '', open: c.open !== false, order: c.order || 0 });

  /** 報名名單給大家看的：姓名、區（照區排）；mine：這支手機報的可以自己取消 */
  function publicSignups(list, tokenHash) {
    return list.slice().sort((a, b) => unitOrder(a.unit) - unitOrder(b.unit) || a.createdAt.localeCompare(b.createdAt))
      .map((r) => ({ id: r.id, name: r.name, unit: r.unit, walkin: r.by === 'walkin', mine: !!tokenHash && r.owner === tokenHash }));
  }

  // ---------- 家人看的 ----------

  /** 主畫面：開放的班、每一堂（含報名人數） */
  function board() {
    const all = store.allDocs('signup');
    const list = sortCourses(courses().filter((c) => c.open !== false));
    return { today: today(), courses: list.map((c) => Object.assign(courseView(c), { sessions: sessionViews(c.id, all.filter((r) => r.courseId === c.id)) })) };
  }

  /** 那一堂的頁面：班、這一堂、報名名單 */
  async function sessionPage(body) {
    const s = mustSession(body.id);
    const c = mustCourse(s.courseId);
    const views = sessionViews(c.id, store.allDocs('signup').filter((r) => r.courseId === c.id));
    const token = typeof body.token === 'string' && body.token.length >= 16 ? body.token : '';
    return { today: today(), course: courseView(c), session: views.find((v) => v.id === s.id), signups: publicSignups(signupsOf(s.id), token ? await opts.sha256(token) : '') };
  }

  /**
   * 區的報名（規格第 6 節）：這一區在接下來每一堂（開放的班、還沒上完的）報了誰；大家都看得到。
   * mine＝這支手機報的（可以自己取消）。只列有報名的那幾堂。
   */
  async function unitPage(body) {
    const unit = str(body.unit);
    if (!isUnit(unit)) throw new AppError('BAD_REQUEST', '請選擇區');
    const token = typeof body.token === 'string' && body.token.length >= 16 ? body.token : '';
    const hash = token ? await opts.sha256(token) : '';
    const all = store.allDocs('signup');
    const out = [];
    sortCourses(courses().filter((c) => c.open !== false)).forEach((c) => {
      const mine = all.filter((r) => r.courseId === c.id);
      sessionViews(c.id, mine).forEach((v) => {
        if (v.date < today() || v.cancelled) return;
        const list = mine.filter((r) => r.sessionId === v.id && r.unit === unit);
        if (list.length) out.push({ course: courseView(c), session: v, signups: publicSignups(list, hash) });
      });
    });
    out.sort((a, b) => a.session.date.localeCompare(b.session.date) || (a.session.startTime || '').localeCompare(b.session.startTime || ''));
    return { today: today(), unit, items: out };
  }

  /**
   * 報名：names（可以好幾個，空格或、隔開）＋區。by：'self'（家人，token 存雜湊，可以自己取消）、'region'（組長）、'admin'、'walkin'（點名時現場加）。
   * 同一堂、同區、同名的跳過。家人報名要在截止前、沒停課、沒額滿；組長、管理者不受截止限制（停課、額滿還是不行）。
   */
  async function addSignups(s, names, unit, by, owner) {
    if (!isUnit(unit)) throw new AppError('BAD_REQUEST', '請選擇區');
    const list = cleanNames(names);
    if (!list.length) throw new AppError('BAD_REQUEST', '請填姓名');
    if (s.cancelled) throw new AppError('BAD_REQUEST', '這堂課停課，不能報名');
    if (by === 'self' && today() > deadlineOf(s)) throw new AppError('BAD_REQUEST', '這堂課的報名已經截止了，請找組長幫忙');
    const existing = signupsOf(s.id);
    const added = [];
    const skipped = [];
    list.forEach((name) => {
      if (existing.some((r) => r.name === name && r.unit === unit)) { skipped.push(name); return; }
      if (by !== 'walkin' && s.cap && existing.length >= s.cap) throw new AppError('BAD_REQUEST', added.length ? `額滿了，只報到 ${added.map((r) => r.name).join('、')}` : '這堂課已經額滿了');
      if (existing.length >= MAX_SIGNUPS) throw new AppError('BAD_REQUEST', '這堂課報名的人太多了');
      const r = { id: newId('R'), sessionId: s.id, courseId: s.courseId, name, unit, by, owner: owner || '', createdAt: taipeiStamp(now()), roll: by === 'walkin' ? '到' : '', rollAt: by === 'walkin' ? taipeiStamp(now()) : '' };
      store.putDoc('signup', r);
      existing.push(r);
      added.push(r);
    });
    if (added.length) opts.log(by === 'walkin' ? '現場加' : '報名', { unit, name: `${added.map((r) => r.name).join('、')}（${by === 'self' ? '自己報' : by === 'region' ? unit + '組長' : by === 'walkin' ? '點名' : '總管理者'}）`, start: s.date, end: s.date, id: s.id });
    return { added: added.map((r) => ({ id: r.id, name: r.name, unit: r.unit })), skipped };
  }

  /** 家人自己報名（不用登入）。token：手機裡的隨機碼，之後自己取消用 */
  async function signup(body) {
    const s = mustSession(body.sessionId);
    const token = typeof body.token === 'string' ? body.token : '';
    if (token.length < 16 || token.length > 100) throw new AppError('BAD_REQUEST', '報名資料不完整，請重新整理再試一次');
    return addSignups(s, body.names, str(body.unit), 'self', await opts.sha256(token));
  }

  /** 家人自己取消：要是這支手機報的、還沒截止 */
  async function cancelSignup(body) {
    const r = typeof body.id === 'string' ? store.getDoc('signup', body.id) : null;
    if (!r) throw new AppError('NOT_FOUND', '找不到這筆報名，可能已經取消');
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token || !r.owner || (await opts.sha256(token)) !== r.owner) throw new AppError('UNAUTHORIZED', '只能取消這支手機報的，請找組長幫忙');
    const s = mustSession(r.sessionId);
    if (today() > deadlineOf(s)) throw new AppError('BAD_REQUEST', '報名已經截止，不能自己取消了，請找組長幫忙');
    store.deleteDoc('signup', r.id);
    opts.log('取消報名', { unit: r.unit, name: `${r.name}（自己取消）`, start: s.date, end: s.date, id: s.id });
    return { id: r.id };
  }

  // ---------- 組長、總管理者幫忙報名、取消 ----------

  function adminSignup(body, who) {
    const s = mustSession(body.sessionId);
    const unit = who || str(body.unit);
    return addSignups(s, body.names, unit, who ? 'region' : 'admin', '');
  }

  function adminCancelSignup(body, who) {
    const r = typeof body.id === 'string' ? store.getDoc('signup', body.id) : null;
    if (!r) throw new AppError('NOT_FOUND', '找不到這筆報名，可能已經取消');
    if (who && r.unit !== who) throw new AppError('UNAUTHORIZED', '只能取消自己區的報名');
    const s = store.getDoc('session', r.sessionId);
    store.deleteDoc('signup', r.id);
    opts.log('取消報名', { unit: r.unit, name: `${r.name}（${who ? who + '組長' : '總管理者'}）`, start: s ? s.date : '', end: s ? s.date : '', id: r.sessionId });
    return { id: r.id };
  }

  // ---------- 點名（點名帳號、總管理者） ----------

  function adminRoll(body) {
    const s = mustSession(body.sessionId);
    const c = mustCourse(s.courseId);
    const views = sessionViews(c.id, store.allDocs('signup').filter((r) => r.courseId === c.id));
    const list = signupsOf(s.id).sort((a, b) => unitOrder(a.unit) - unitOrder(b.unit) || a.createdAt.localeCompare(b.createdAt))
      .map((r) => ({ id: r.id, name: r.name, unit: r.unit, by: r.by, roll: r.roll || '' }));
    return { course: courseView(c), session: views.find((v) => v.id === s.id), signups: list };
  }

  /** 點一個人：到／請假／缺席；''＝還沒點 */
  function adminRollSet(body) {
    const r = typeof body.id === 'string' ? store.getDoc('signup', body.id) : null;
    if (!r) throw new AppError('NOT_FOUND', '找不到這個人，可能已經取消報名');
    const status = body.status === '' ? '' : ROLL.indexOf(body.status) !== -1 ? body.status : null;
    if (status === null) throw new AppError('BAD_REQUEST', '點名要是到、請假或缺席');
    r.roll = status;
    r.rollAt = status ? taipeiStamp(now()) : '';
    store.putDoc('signup', r);
    return { id: r.id, roll: r.roll };
  }

  /** 沒報名但來了：加進名單，記「到」 */
  function adminRollAdd(body) {
    const s = mustSession(body.sessionId);
    return addSignups(s, body.names, str(body.unit), 'walkin', '');
  }

  /** 一個班一整年的出席：照姓名＋區合在一起 */
  function adminAttendance(body) {
    const c = mustCourse(body.courseId);
    const sessions = sessionViews(c.id, []).filter((s) => !s.cancelled);
    const people = new Map();
    store.allDocs('signup').filter((r) => r.courseId === c.id).forEach((r) => {
      const k = r.unit + '|' + r.name;
      if (!people.has(k)) people.set(k, { name: r.name, unit: r.unit, signups: 0, 到: 0, 請假: 0, 缺席: 0, rolls: {} });
      const p = people.get(k);
      p.signups++;
      if (r.roll) p[r.roll]++;
      p.rolls[r.sessionId] = r.roll || '報名';
    });
    const list = [...people.values()].sort((a, b) => unitOrder(a.unit) - unitOrder(b.unit) || b.到 - a.到 || a.name.localeCompare(b.name));
    return { course: courseView(c), sessions: sessions.map((s) => ({ id: s.id, date: s.date, no: s.no, topic: s.topic })), people: list };
  }

  // ---------- 班與課程（總管理者） ----------

  function adminCourses() {
    const all = store.allDocs('signup');
    return { today: today(), courses: sortCourses(courses()).map((c) => Object.assign(courseView(c), { sessions: sessionViews(c.id, all.filter((r) => r.courseId === c.id)) })) };
  }

  /** 新增或修改班；新增時可以順便排一整年（first、until）或只有一堂（single＋date） */
  function adminCourseSave(body) {
    const input = body.course || {};
    const clean = cleanCourse(input);
    const stamp = taipeiStamp(now());
    let c;
    if (input.id) {
      const old = mustCourse(input.id);
      c = Object.assign({}, old, clean, { updatedAt: stamp });
      opts.log('修改班', { unit: SITE.fentan, name: c.name, start: '', end: '', id: c.id });
    } else {
      c = Object.assign({ id: newId('C') }, clean, { createdAt: stamp, updatedAt: stamp });
      opts.log('新增班', { unit: SITE.fentan, name: c.name, start: '', end: '', id: c.id });
    }
    store.putDoc('course', c);
    let made = [];
    if (!input.id && body.plan) made = makeSessions(c, body.plan);
    return { course: courseView(c), made: made.length };
  }

  /** plan：{ first, until }（隔週六排）或 { dates: [...] } */
  function makeSessions(c, plan) {
    const until = plan.until || (isDate(plan.first) ? addDays(plan.first, 364) : '');
    const dates = Array.isArray(plan.dates) ? plan.dates.filter(isDate) : plan.every === 'month' ? monthly(plan.first, until, Number(plan.nth), Number(plan.weekday)) : biweekly(plan.first, until);
    if (!dates.length) throw new AppError('BAD_REQUEST', '請選第一堂的日期');
    const have = new Set(sessionsOf(c.id).map((s) => s.date));
    if (have.size + dates.length > MAX_SESSIONS) throw new AppError('BAD_REQUEST', `一個班最多 ${MAX_SESSIONS} 堂`);
    const stamp = taipeiStamp(now());
    const made = [];
    dates.forEach((date) => {
      if (have.has(date)) return;
      have.add(date);
      const s = Object.assign({ id: newId('S'), courseId: c.id }, cleanSession({ date, startTime: c.startTime, endTime: c.endTime, location: c.location }), { createdAt: stamp, updatedAt: stamp });
      store.putDoc('session', s);
      made.push(s);
    });
    if (made.length) opts.log('排課', { unit: SITE.fentan, name: `${c.name}：${made.length} 堂`, start: made[0].date, end: made[made.length - 1].date, id: c.id });
    return made;
  }

  function adminSessionsMake(body) {
    const c = mustCourse(body.courseId);
    return { made: makeSessions(c, body.plan || {}).length };
  }

  function adminCourseDelete(body) {
    const c = mustCourse(body.id);
    const sessions = sessionsOf(c.id);
    const signups = store.allDocs('signup').filter((r) => r.courseId === c.id);
    signups.forEach((r) => store.deleteDoc('signup', r.id));
    sessions.forEach((s) => store.deleteDoc('session', s.id));
    store.deleteDoc('course', c.id);
    opts.log('刪除班', { unit: SITE.fentan, name: `${c.name}（${sessions.length} 堂、${signups.length} 筆報名）`, start: '', end: '', id: c.id });
    return { sessions: sessions.length, signups: signups.length };
  }

  /** 新增或修改一堂（改日期的話，報名照舊跟著這一堂） */
  function adminSessionSave(body) {
    const input = body.session || {};
    const clean = cleanSession(input);
    const stamp = taipeiStamp(now());
    let s;
    if (input.id) {
      const old = mustSession(input.id);
      s = Object.assign({}, old, clean, { updatedAt: stamp });
    } else {
      const c = mustCourse(input.courseId);
      if (sessionsOf(c.id).length >= MAX_SESSIONS) throw new AppError('BAD_REQUEST', `一個班最多 ${MAX_SESSIONS} 堂`);
      s = Object.assign({ id: newId('S'), courseId: c.id }, clean, { createdAt: stamp, updatedAt: stamp });
    }
    store.putDoc('session', s);
    const c = store.getDoc('course', s.courseId);
    opts.log(input.id ? '修改課' : '加一堂', { unit: SITE.fentan, name: `${c ? c.name : ''}${s.topic ? '：' + s.topic : ''}${s.cancelled ? '（停課）' : ''}`, start: s.date, end: s.date, id: s.id });
    return { session: s };
  }

  function adminSessionDelete(body) {
    const s = mustSession(body.id);
    const signups = signupsOf(s.id);
    signups.forEach((r) => store.deleteDoc('signup', r.id));
    store.deleteDoc('session', s.id);
    const c = store.getDoc('course', s.courseId);
    opts.log('刪除課', { unit: SITE.fentan, name: `${c ? c.name : ''}（${signups.length} 筆報名）`, start: s.date, end: s.date, id: s.id });
    return { signups: signups.length };
  }

  /** 每天提醒用：那一天有上課的（沒停課），寫成提醒看得懂的樣子 */
  function classesOn(date) {
    const names = {};
    courses().forEach((c) => { names[c.id] = c.name; });
    return store.allDocs('session').filter((s) => s.date === date && !s.cancelled && names[s.courseId])
      .map((s) => ({ name: names[s.courseId] + (s.topic ? '：' + s.topic : ''), startTime: s.startTime || '', location: s.location || '', start: s.date, end: s.date, unit: SITE.fentan }));
  }

  const backup = () => ({ courses: courses(), sessions: store.allDocs('session'), signups: store.allDocs('signup') });

  return {
    actions: {
      getBoard: board, getSession: sessionPage, getUnit: unitPage, signup, cancelSignup,
      adminSignup, adminCancelSignup, adminRoll, adminRollSet, adminRollAdd, adminAttendance,
      adminCourses, adminCourseSave, adminCourseDelete, adminSessionSave, adminSessionDelete, adminSessionsMake
    },
    classesOn,
    backup
  };
}
