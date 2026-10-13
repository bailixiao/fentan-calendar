// 手機提醒（Web Push）的工具：推播網址檢查、VAPID 金鑰與簽章、每日提醒的內容、送出。
// 通知不帶內容（不用加密）：手機收到後由 sw.js 回來問 pushSummary 再顯示（做法同教全區）。
import { SITE } from './site.js';

export const PUSH_SUBJECT = 'https://bailixiao.github.io/fentan-calendar/'; // 推播服務聯絡用（網站網址，不放 email）
export const PUSH_TTL_SEC = 43200;
const ALLOWED_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 只接受各家推播服務的網址（避免伺服器被拿去連任意網站） */
export function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let u;
  try { u = new URL(endpoint); } catch (e) { return false; }
  return u.protocol === 'https:' && !u.port && !u.username && ALLOWED_HOSTS.some((re) => re.test(u.hostname));
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function b64url(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 手機的代號：推播網址 SHA-256 的前 16 個十六進位字（sw.js 也用同樣的算法） */
export async function pushIdOf(endpoint) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))).slice(0, 16);
}

/** 產生新的 VAPID 金鑰：{ publicKey（給瀏覽器的 base64url）, privateJwk } */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64url(raw), privateJwk: jwk };
}

/** VAPID 的 JWT（ES256；WebCrypto 簽出來就是 JWT 要的 r||s 格式） */
export async function vapidJwt(audience, privateJwk, nowSec) {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: audience, exp: nowSec + 12 * 3600, sub: PUSH_SUBJECT });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return unsigned + '.' + b64url(sig);
}

/** 送空的推播給 subs（[{ id, endpoint }]）；回傳 [{ id, ok, gone, code }] */
export async function sendEmptyPush(fetchFn, keys, subs, nowSec) {
  const jwts = {};
  return Promise.all(subs.map(async (s) => {
    const aud = new URL(s.endpoint).origin;
    if (!jwts[aud]) jwts[aud] = await vapidJwt(aud, keys.privateJwk, nowSec);
    let code = 0;
    try {
      const res = await fetchFn(s.endpoint, {
        method: 'POST',
        headers: { Authorization: `vapid t=${jwts[aud]}, k=${keys.publicKey}`, TTL: String(PUSH_TTL_SEC), Urgency: 'high', 'Content-Length': '0' },
        body: ''
      });
      code = res.status;
    } catch (e) {
      code = 0;
    }
    return { id: s.id, ok: code >= 200 && code < 300, gone: code === 404 || code === 410, code };
  }));
}

/** 某個單位的手機要提醒的活動：選某一區＝那一區＋分壇；選分壇＝只有分壇 */
export function eventsForUnit(events, unit) {
  return events.filter((e) => e.unit === unit || (unit !== SITE.fentan && e.unit === SITE.fentan));
}

/**
 * 每日提醒的內容；沒有活動回傳 null。
 * events：那一天的活動（已經篩好單位）；when：'today' | 'tomorrow'；date：'yyyy-MM-dd'
 */
export function dailyContent(events, when, date) {
  if (!events.length) return null;
  const list = [...events].sort((a, b) =>
    (a.unit === SITE.fentan ? 0 : 1) - (b.unit === SITE.fentan ? 0 : 1) || (a.startTime || '').localeCompare(b.startTime || ''));
  const [, m, d] = date.split('-').map(Number);
  const wd = WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()];
  const lines = list.slice(0, 4).map((e) => {
    const time = e.start === e.end ? e.startTime : '';
    return `${time ? time + ' ' : ''}${e.name}${e.location ? '（' + e.location + '）' : ''}`;
  });
  if (list.length > 4) lines.push(`⋯還有 ${list.length - 4} 項`);
  return {
    title: `🙏 ${when === 'today' ? '今天' : '明天'}的活動（${m}/${d} ${wd}）`,
    body: lines.join('\n'),
    url: '#/'
  };
}
