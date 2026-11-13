// Genel yardımcılar: para/tarih biçimlendirme, sayı ayrıştırma, dönem hesapları.

export const CURS = ['TRY', 'USD', 'EUR', 'XAU'];
export const CUR_LABEL = { TRY: 'TL', USD: 'USD', EUR: 'EURO', XAU: 'Altın' };
export const CUR_SYM = { TRY: '₺', USD: '$', EUR: '€', XAU: 'gr' };

export const upper = (s) =>
  (s ?? '').toString().toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ').trim();

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const round2 = (n) => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;

const nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const nf4 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const num = (n) => nf2.format(round2(n));
export const numRate = (n) => nf4.format(n || 0);

export function money(n, cur = 'TRY', { sign = false, short = false } = {}) {
  const v = round2(n);
  const body = short ? nf0.format(v) : nf2.format(v);
  const s = (sign && v > 0 ? '+' : '') + body;
  return cur === 'XAU' ? `${s} gr` : `${s} ${CUR_SYM[cur] || cur}`;
}

/** Kullanıcının yazdığı tutarı sayıya çevirir. "1.500" -> 1500, "12,5" -> 12.5, "1.234,56" -> 1234.56 */
export function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v ?? '').trim().replace(/[\s₺$€]|TL/gi, '');
  if (!s) return 0;
  const neg = s.startsWith('-');
  s = s.replace(/^[-+]/, '');
  const hasC = s.includes(','), hasD = s.includes('.');
  if (hasC && hasD) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasC) {
    s = s.replace(/,(?=.*,)/g, '').replace(',', '.');
  } else if (hasD) {
    const parts = s.split('.');
    const thousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && /^\d{1,3}$/.test(parts[0]));
    if (thousands) s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return isFinite(n) ? (neg ? -n : n) : 0;
}

/* ---------- Tarihler (YYYY-MM-DD metin olarak saklanır) ---------- */

export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => toISO(new Date());
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}
export function longDate(s) {
  const d = parseISO(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${DAYS[d.getDay()]}`;
}
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export function addMonths(s, n) {
  const d = parseISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
const ym = (y, m) => {
  const d = new Date(y, m, 1);
  return [d.getFullYear(), d.getMonth()];
};

export const PERIODS = [
  ['thisMonth', 'Bu ay'],
  ['lastMonth', 'Geçen ay'],
  ['last3', 'Son 3 ay'],
  ['thisYear', 'Bu yıl'],
  ['lastYear', 'Geçen yıl'],
  ['all', 'Tümü'],
  ['custom', 'Tarih aralığı'],
];

/** Dönem anahtarını [başlangıç, bitiş] tarih aralığına çevirir. */
export function periodRange(p, custom = {}) {
  const t = new Date();
  const Y = t.getFullYear(), M = t.getMonth();
  const range = (y1, m1, y2, m2) => [`${y1}-${pad(m1 + 1)}-01`, `${y2}-${pad(m2 + 1)}-${pad(lastDay(y2, m2))}`];
  switch (p) {
    case 'thisMonth': return range(Y, M, Y, M);
    case 'lastMonth': { const [y, m] = ym(Y, M - 1); return range(y, m, y, m); }
    case 'last3': { const [y, m] = ym(Y, M - 2); return range(y, m, Y, M); }
    case 'thisYear': return [`${Y}-01-01`, `${Y}-12-31`];
    case 'lastYear': return [`${Y - 1}-01-01`, `${Y - 1}-12-31`];
    case 'custom': return [custom.from || '0000-01-01', custom.to || '9999-12-31'];
    default: return ['0000-01-01', '9999-12-31'];
  }
}

export const inRange = (d, [a, b]) => d >= a && d <= b;

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
