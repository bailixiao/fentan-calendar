// 共用的小工具：錯誤、台灣時間、日期、姓名整理。
import { SITE } from './site.js';

export class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const TPE = 8 * 3600e3;

/** 台灣時間的 'yyyy-MM-dd' */
export function taipeiDate(ms) {
  return new Date(ms + TPE).toISOString().slice(0, 10);
}

/** 台灣時間的 'yyyy-MM-dd HH:mm:ss' */
export function taipeiStamp(ms) {
  return new Date(ms + TPE).toISOString().slice(0, 19).replace('T', ' ');
}

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

export function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400e3);
}

/** 文字欄位：去掉前後空白；不是字串就當空的 */
export function str(v) {
  return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
}

/** 名字之間的分隔：逗號、頓號、分號、句號、斜線、間隔號、直線、空白、換行（前端 js/format.js 的 splitNames 要一樣） */
export const NAME_SEP = /[,，、;；。．.\/／・·|｜\s　]+/;

/** 姓名：字串（NAME_SEP 隔開）或陣列 → 去掉空白、重複；每個最多 20 字、最多 30 個 */
export function cleanNames(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(NAME_SEP);
  const out = [];
  list.forEach((n) => {
    const name = String(n || '').replace(/[\s　]/g, '');
    if (!name) return;
    if (name.length > 20) throw new AppError('BAD_REQUEST', `名字「${name.slice(0, 20)}⋯」太長了（最多 20 字），是不是兩個名字中間忘了空格？`);
    if (out.indexOf(name) === -1) out.push(name);
  });
  if (out.length > 30) throw new AppError('BAD_REQUEST', '一次最多報 30 人');
  return out;
}

export const isUnit = (u) => SITE.units.indexOf(u) !== -1;
export const unitOrder = (u) => { const i = SITE.units.indexOf(u); return i === -1 ? 99 : i; };
