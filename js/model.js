// İş kuralları: bakiyeler, raporlar, kayıt ekleme/silme, liste yönetimi.
import { S, commit } from './store.js';
import { CURS, round2, upper, uid, inRange, todayStr, addMonths, addDays } from './util.js';

export const T = {
  DEVREDEN: 'DEVREDEN',
  VIRMAN: 'VİRMAN',
  KKODEME: 'KK.ÖDEME',
  KKARTI: 'K.KARTI',
  KMH: 'KMH',
  CARI: 'CARİ',
  DOVIZ_SATIS: 'DÖVİZ SATIŞ',
  DOVIZ_ALIS: 'DÖVİZ ALIŞ',
  ALTIN_SATIS: 'ALTIN SATIŞ',
  ALTIN_ALIS: 'ALTIN ALIŞ',
};

// report:false olan türler gelir/gider raporlarına girmez (para bir hesaptan diğerine geçer).
export const DEFAULT_TYPES = [
  ['GIDA', true], ['ARABA', true], ['SAĞLIK', true], ['EĞİTİM', true], ['GİYSİ', true],
  ['İLETİŞİM', true], ['ELEKTRİK', true], ['SU', true], ['DOĞALGAZ', true], ['VERGİ', true],
  ['HAYIR', true], ['MUHTELİF', true], ['EK BİNA', true], ['GİRDİ', true],
  [T.DEVREDEN, false], [T.VIRMAN, false], [T.KKODEME, false], [T.DOVIZ_SATIS, false],
  [T.DOVIZ_ALIS, false], [T.ALTIN_SATIS, false], [T.ALTIN_ALIS, false], [T.CARI, false],
].map(([name, report]) => ({ name, report }));
export const NON_REPORT_NAMES = new Set([T.DEVREDEN, T.VIRMAN, T.KKODEME, T.KKARTI, T.KMH, T.CARI,
  T.DOVIZ_SATIS, T.DOVIZ_ALIS, T.ALTIN_SATIS, T.ALTIN_ALIS]);
export const DEFAULT_COUNTERS = ['EV', 'BANKA', 'DÜKKAN', 'YATIRIM', 'KASA'];

export const ACCOUNT_KINDS = {
  kasa: 'Kasa',
  banka: 'Banka',
  kart: 'Kredi Kartı',
  yatirim: 'Yatırım',
  diger: 'Diğer',
};

export const emptyAmt = () => ({ TRY: 0, USD: 0, EUR: 0, XAU: 0 });
export function addAmt(a, b, f = 1) {
  for (const c of CURS) a[c] += (b?.[c] || 0) * f;
  return a;
}
export const roundAmt = (a) => (CURS.forEach((c) => (a[c] = round2(a[c]))), a);
export const amtCurs = (a) => CURS.filter((c) => round2(a?.[c] || 0) !== 0);

export function toTRY(amt, rates = S.settings.rates) {
  return (amt.TRY || 0) + (amt.USD || 0) * (rates.USD || 0) + (amt.EUR || 0) * (rates.EUR || 0) + (amt.XAU || 0) * (rates.XAU || 0);
}
export const hasRates = (r = S.settings.rates) => r.USD > 0 && r.EUR > 0 && r.XAU > 0;

/** TL tutarını seçilen gösterim para birimine çevirir. */
export function toDisplay(tl, cur = S.settings.displayCur, rates = S.settings.rates) {
  if (cur === 'TRY') return tl;
  return rates[cur] ? tl / rates[cur] : 0;
}

/* ---------------- Bakiyeler ---------------- */

export function balances(tx = S.tx) {
  const m = new Map();
  for (const t of tx) {
    let b = m.get(t.account);
    if (!b) m.set(t.account, (b = emptyAmt()));
    addAmt(b, t.amt);
  }
  m.forEach(roundAmt);
  return m;
}

export function getAccount(name) {
  return S.accounts.find((a) => a.name === name) || { name, kind: 'diger', limit: 0, archived: false };
}

export function accountSummary() {
  const bal = balances();
  const names = [...new Set([...S.accounts.map((a) => a.name), ...bal.keys()])];
  const rows = names.map((name) => {
    const acc = getAccount(name);
    const b = bal.get(name) || emptyAmt();
    const tl = toTRY(b);
    return {
      acc,
      bal: b,
      tl,
      debt: Math.max(0, -b.TRY),
      available: acc.limit ? round2(acc.limit + b.TRY) : null,
      empty: amtCurs(b).length === 0,
    };
  }).filter((r) => !(r.acc.archived && r.empty));

  const total = emptyAmt();
  rows.forEach((r) => addAmt(total, r.bal));
  roundAmt(total);
  let assets = 0, debts = 0;
  for (const r of rows) {
    // Bir hesaptaki her para birimini ayrı değerlendir: eksi bakiye borçtur.
    for (const c of CURS) {
      const v = toTRY({ [c]: r.bal[c] });
      if (v >= 0) assets += v; else debts += v;
    }
  }
  return { rows, total, assets, debts, net: toTRY(total) };
}

/* ---------------- Raporlar ---------------- */

export function isReportType(name) {
  const t = S.types.find((x) => x.name === name);
  if (t) return t.report !== false;
  return !NON_REPORT_NAMES.has(name);
}

/** Dönemdeki gelir/gider niteliğindeki kayıtlar (TL karşılıklarıyla). */
export function flowRows(range, filter = () => true) {
  return S.tx
    .filter((t) => inRange(t.date, range) && isReportType(t.type) && filter(t))
    .map((t) => ({ t, tl: toTRY(t.amt) }));
}

export function sumFlow(rows) {
  let gelir = 0, gider = 0;
  for (const r of rows) {
    if (r.tl > 0) gelir += r.tl; else gider += -r.tl;
  }
  return { gelir, gider, net: gelir - gider };
}

export function groupFlow(rows, field, side = 'gider') {
  const m = new Map();
  for (const r of rows) {
    const v = side === 'gider' ? -r.tl : r.tl;
    if (v <= 0) continue;
    const k = r.t[field] || '—';
    m.set(k, (m.get(k) || 0) + v);
  }
  return [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}

export function monthlyFlow(year) {
  const months = Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${String(i + 1).padStart(2, '0')}`, gelir: 0, gider: 0 }));
  for (const r of flowRows([`${year}-01-01`, `${year}-12-31`])) {
    const m = months[Number(r.t.date.slice(5, 7)) - 1];
    if (r.tl > 0) m.gelir += r.tl; else m.gider += -r.tl;
  }
  return months;
}

/* ---------------- Öneriler ---------------- */

/** Listeyi kullanım sıklığına göre sıralar (son 600 kayıt). */
export function ranked(field, all) {
  const counts = new Map();
  const recent = S.tx.slice(-600);
  for (const t of recent) counts.set(t[field], (counts.get(t[field]) || 0) + 1);
  return [...new Set(all)].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b, 'tr'));
}
export const typeNames = () => S.types.map((t) => t.name);
export const activeAccounts = () => S.accounts.filter((a) => !a.archived).map((a) => a.name);

/** Aynı açıklamayla yapılmış son kaydı bulur (formu otomatik doldurmak için). */
export function lastByDesc(desc) {
  const d = upper(desc);
  if (!d) return null;
  for (let i = S.tx.length - 1; i >= 0; i--) if (S.tx[i].desc === d) return S.tx[i];
  return null;
}
/** Bir tür için en sık kullanılan karşı hesap. */
export function counterForType(type) {
  const c = new Map();
  for (const t of S.tx.slice(-600)) if (t.type === type) c.set(t.counter, (c.get(t.counter) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
export function descSuggestions() {
  const seen = new Map();
  for (let i = S.tx.length - 1; i >= 0 && seen.size < 400; i--) {
    const d = S.tx[i].desc;
    if (d && !seen.has(d)) seen.set(d, 1);
  }
  return [...seen.keys()];
}

/* ---------------- Kayıt işlemleri ---------------- */

export const groupRows = (t) => (t.group ? S.tx.filter((x) => x.group === t.group) : [t]);

/** Bir kaydın hangi formla düzenleneceğini belirler. */
export function txMode(t) {
  const rows = groupRows(t);
  if (rows.length === 2 && t.type === T.VIRMAN) return 'transfer';
  if (rows.length === 2 && t.type === T.KKODEME) return 'kkodeme';
  const cs = amtCurs(t.amt);
  if (rows.length === 1 && cs.length === 2 && cs.includes('TRY') && /DÖVİZ|ALTIN/.test(t.type)) return 'doviz';
  if (rows.length === 1 && cs.length === 1) return t.amt[cs[0]] < 0 ? 'gider' : 'gelir';
  return 'serbest';
}

function ensureLists(rows) {
  for (const r of rows) {
    if (r.type && !S.types.some((x) => x.name === r.type)) S.types.push({ name: r.type, report: !NON_REPORT_NAMES.has(r.type) });
    if (r.counter && !S.counters.includes(r.counter)) S.counters.push(r.counter);
    if (r.account && !S.accounts.some((a) => a.name === r.account)) S.accounts.push(newAccount(r.account));
  }
}

export function newAccount(name, kind) {
  const n = upper(name);
  return { name: n, kind: kind || guessKind(n), limit: 0, archived: false };
}
export function guessKind(name) {
  if (/KART/.test(name)) return 'kart';
  if (/KASA/.test(name)) return 'kasa';
  if (/FON|YATIRIM|BORSA|HİSSE/.test(name)) return 'yatirim';
  return 'banka';
}

function cleanRow(r) {
  const amt = roundAmt(addAmt(emptyAmt(), r.amt));
  return {
    id: r.id || uid(),
    date: r.date || todayStr(),
    type: upper(r.type),
    counter: upper(r.counter),
    account: upper(r.account),
    desc: upper(r.desc),
    amt,
    group: r.group || null,
    created: r.created || Date.now(),
  };
}

/**
 * Bir kaydı ya da birbirine bağlı kayıt grubunu (virman, kart ödemesi) kaydeder.
 * `old` verilirse eski kayıt/grup silinip yenisi aynı konuma yazılır.
 */
export function saveTx(rows, old) {
  const group = rows.length > 1 ? old?.group || uid() : null;
  const clean = rows.map((r) => cleanRow({ ...r, group }));
  ensureLists(clean);
  if (old) {
    const oldRows = groupRows(old);
    const oldIds = new Set(oldRows.map((x) => x.id));
    const idx = S.tx.findIndex((x) => oldIds.has(x.id));
    S.tx = S.tx.filter((x) => !oldIds.has(x.id));
    clean.forEach((c, i) => (c.created = oldRows[i]?.created || c.created));
    // Kayıtları tarih sırasında tutmak için doğru yere yerleştir.
    insertSorted(clean, idx);
  } else {
    insertSorted(clean);
  }
  commit('tx', 'types', 'counters', 'accounts');
}

function insertSorted(rows, hint = -1) {
  const date = rows[0].date;
  let i = S.tx.length;
  // Aynı tarih ya da önceki tarihlerden sonraya ekle.
  while (i > 0 && S.tx[i - 1].date > date) i--;
  if (hint >= 0 && hint <= S.tx.length && (S.tx[hint - 1]?.date ?? '') <= date && (S.tx[hint]?.date ?? '9999') >= date) i = hint;
  S.tx.splice(i, 0, ...rows);
}

export function deleteTx(t) {
  const ids = new Set(groupRows(t).map((x) => x.id));
  S.tx = S.tx.filter((x) => !ids.has(x.id));
  // Bu kayda bağlı cari hareketinin ve borç ödemesinin bağını kopar.
  S.cari.forEach((c) => { if (c.link && ids.has(c.link)) c.link = null; });
  S.debts.forEach((d) => d.payments.forEach((p) => { if (p.txId && ids.has(p.txId)) { p.txId = null; p.account = ''; } }));
  commit('tx', 'cari', 'debts');
}

/* ---------------- Cari ---------------- */

export function people() {
  return [...new Set([...S.firms.map((f) => f.name), ...S.cari.map((c) => c.counter)])].sort((a, b) => a.localeCompare(b, 'tr'));
}

/* Cari firma bilgisi. group: 'alacak' (bize borçlu) | 'borc' (biz borçluyuz) */
export const RISKS = ['NORMAL', 'SIKINTILI'];
export const FIS_TYPES = ['FATURA', 'TAHSİLAT', 'ÖDEME', 'DEVİR', 'MAHSUP', 'ÇEK', 'SENET', 'İADE'];
export const ROW_STATUS = ['ÖDENMEDİ', 'ÖDENDİ', 'MAHSUP'];

export function getFirm(name, bal) {
  const f = S.firms.find((x) => x.name === name);
  if (f) return f;
  // Bilgisi girilmemiş eski kişiler: bakiyesine ve kullandığı para birimine göre tahmin.
  const rows = S.cari.filter((c) => c.counter === name);
  const b = bal || rows.reduce((a, c) => addAmt(a, c.amt), emptyAmt());
  const cur = amtCurs(b)[0] || CURS.find((c) => rows.some((r) => r.amt[c])) || 'TRY';
  return { name, group: (b[cur] || 0) > 0 ? 'borc' : 'alacak', cur, risk: 'NORMAL', note: '', guessed: true };
}

export function saveFirm(f, oldName) {
  const row = { name: upper(f.name), group: f.group === 'borc' ? 'borc' : 'alacak', cur: f.cur || 'TRY', risk: upper(f.risk) || 'NORMAL', note: f.note || '' };
  if (oldName && oldName !== row.name) {
    if (S.firms.some((x) => x.name === row.name)) throw new Error('Bu isimde bir firma zaten var');
    for (const c of S.cari) if (c.counter === oldName) c.counter = row.name;
    S.firms = S.firms.filter((x) => x.name !== oldName);
  }
  const i = S.firms.findIndex((x) => x.name === row.name);
  if (i >= 0) S.firms[i] = row; else S.firms.push(row);
  commit('firms', 'cari');
  return row;
}

export function deleteFirm(name) {
  const linked = new Set(S.cari.filter((c) => c.counter === name && c.link).map((c) => c.link));
  S.tx = S.tx.filter((t) => !linked.has(t.id));
  S.cari = S.cari.filter((c) => c.counter !== name);
  S.firms = S.firms.filter((x) => x.name !== name);
  commit('tx', 'cari', 'firms');
}

/**
 * Firmanın defteri, babamın Excel'indeki gibi: BORÇ / ALACAK / BAKİYE (para birimi başına ayrı).
 * BAKİYE artı = firma bize borçlu (alacaklıyız), eksi = biz firmaya borçluyuz.
 * Uygulama içinde eksi tutar "firma bize borçlandı" demektir; o yüzden ALACAK sütununa yazılır.
 */
export function firmLedger(name) {
  const rows = S.cari.filter((c) => c.counter === name);
  return CURS.filter((k) => rows.some((r) => round2(r.amt[k] || 0) !== 0)).map((cur) => {
    let bal = 0, tb = 0, ta = 0;
    const out = rows.filter((r) => round2(r.amt[cur] || 0) !== 0).map((r) => {
      const v = r.amt[cur];
      const borc = v > 0 ? v : 0, alacak = v < 0 ? -v : 0;
      tb += borc; ta += alacak;
      bal = round2(bal + alacak - borc);
      return { r, borc, alacak, bal };
    });
    return { cur, rows: out, borc: round2(tb), alacak: round2(ta), bal };
  });
}

/** Vadeli satırları ödendi olarak işaretle (ödeme / tahsilat girildiğinde). */
export function markCariPaid(ids, date) {
  for (const c of S.cari) if (ids.includes(c.id)) { c.status = 'ÖDENDİ'; c.paidOn = date; }
  commit('cari');
}

/** Satır açık mı (vadesi takip edilecek mi)? */
export const cariOpen = (c) => !!c.due && c.status !== 'ÖDENDİ' && c.status !== 'MAHSUP';

/** Vadesi verilen gün içinde gelen ya da geçmiş, ödenmemiş cari satırları. */
export function cariDue(withinDays, today = todayStr()) {
  const lim = addDays(today, withinDays);
  return S.cari.filter((c) => cariOpen(c) && c.due <= lim).sort((a, b) => a.due.localeCompare(b.due));
}
export function cariBalances() {
  const m = new Map();
  for (const c of S.cari) {
    let b = m.get(c.counter);
    if (!b) m.set(c.counter, (b = emptyAmt()));
    addAmt(b, c.amt);
  }
  m.forEach(roundAmt);
  return m;
}

export function saveCari(entry, { linkAccount } = {}) {
  const row = cleanRow(entry);
  row.link = entry.link || null;
  row.fis = upper(entry.fis);
  row.due = entry.due || '';
  row.status = ROW_STATUS.includes(entry.status) ? entry.status : '';
  row.paidOn = row.status === 'ÖDENDİ' ? entry.paidOn || '' : '';
  // İstenirse aynı hareketi ana kasaya da işle (ör. kasadan borç verildi).
  if (linkAccount) {
    const main = cleanRow({ ...row, id: row.link || undefined, group: null, account: linkAccount, type: T.CARI });
    const existing = row.link && S.tx.find((x) => x.id === row.link);
    if (existing) saveTx([main], existing); else saveTx([main]);
    row.link = main.id;
  } else if (row.link) {
    const existing = S.tx.find((x) => x.id === row.link);
    if (existing) deleteTx(existing);
    row.link = null;
  }
  const i = S.cari.findIndex((c) => c.id === row.id);
  if (i >= 0) S.cari[i] = row; else S.cari.push(row);
  S.cari.sort((a, b) => a.date.localeCompare(b.date));
  commit('cari');
}

export function deleteCari(entry) {
  if (entry.link) {
    const t = S.tx.find((x) => x.id === entry.link);
    if (t) deleteTx(t);
  }
  S.cari = S.cari.filter((c) => c.id !== entry.id);
  commit('cari');
}

/* ---------------- Ödemeler ---------------- */

export function savePayment(p) {
  const row = { id: p.id || uid(), name: upper(p.name), amount: round2(p.amount || 0), cur: p.cur || 'TRY',
    due: p.due || '', repeat: p.repeat || 'none', paid: !!p.paid, note: p.note || '', account: p.account || '', paidAt: p.paidAt || null };
  const i = S.payments.findIndex((x) => x.id === row.id);
  if (i >= 0) S.payments[i] = row; else S.payments.push(row);
  commit('payments');
  return row;
}
export function markPaid(p) {
  if (p.repeat === 'monthly' && p.due) savePayment({ ...p, due: addMonths(p.due, 1), paidAt: todayStr() });
  else savePayment({ ...p, paid: true, paidAt: todayStr() });
}
export function deletePayment(p) {
  S.payments = S.payments.filter((x) => x.id !== p.id);
  commit('payments');
}

/* ---------------- Liste yönetimi ---------------- */

const FIELD_OF = { type: 'type', counter: 'counter', account: 'account' };

export function usageCount(kind, name) {
  const f = FIELD_OF[kind];
  const inDebts = S.debts.filter((d) => (kind === 'counter' && d.person === name) || (kind === 'type' && d.type === name)
    || (kind === 'account' && d.payments.some((p) => p.account === name))).length;
  return S.tx.filter((t) => t[f] === name).length + S.cari.filter((t) => t[f] === name).length + inDebts;
}

/** Adı değiştirir; yeni ad zaten varsa ikisini birleştirir. */
export function renameItem(kind, oldName, newName) {
  const n = upper(newName);
  if (!n || n === oldName) return;
  const f = FIELD_OF[kind];
  for (const list of [S.tx, S.cari]) for (const t of list) if (t[f] === oldName) t[f] = n;
  for (const d of S.debts) {
    if (kind === 'counter' && d.person === oldName) d.person = n;
    if (kind === 'type' && d.type === oldName) d.type = n;
    if (kind === 'account') d.payments.forEach((p) => { if (p.account === oldName) p.account = n; });
  }
  if (kind === 'type') {
    const exists = S.types.some((t) => t.name === n);
    S.types = exists ? S.types.filter((t) => t.name !== oldName) : S.types.map((t) => (t.name === oldName ? { ...t, name: n } : t));
  } else if (kind === 'counter') {
    S.counters = [...new Set(S.counters.map((c) => (c === oldName ? n : c)))];
    if (!S.firms.some((x) => x.name === n)) S.firms.forEach((x) => { if (x.name === oldName) x.name = n; });
    else S.firms = S.firms.filter((x) => x.name !== oldName);
  } else {
    const exists = S.accounts.some((a) => a.name === n);
    if (exists) {
      const old = S.accounts.find((a) => a.name === oldName);
      S.accounts = S.accounts.filter((a) => a.name !== oldName);
      const target = S.accounts.find((a) => a.name === n);
      if (old?.limit && !target.limit) target.limit = old.limit;
    } else {
      S.accounts = S.accounts.map((a) => (a.name === oldName ? { ...a, name: n } : a));
    }
    S.payments.forEach((p) => { if (p.account === oldName) p.account = n; });
  }
  commit();
}

export function removeItem(kind, name) {
  if (kind === 'type') S.types = S.types.filter((t) => t.name !== name);
  else if (kind === 'counter') S.counters = S.counters.filter((c) => c !== name);
  else S.accounts = S.accounts.filter((a) => a.name !== name);
  commit('types', 'counters', 'accounts');
}

export function addItem(kind, name, extra = {}) {
  const n = upper(name);
  if (!n) return;
  if (kind === 'type' && !S.types.some((t) => t.name === n)) S.types.push({ name: n, report: extra.report ?? true });
  if (kind === 'counter' && !S.counters.includes(n)) S.counters.push(n);
  if (kind === 'account' && !S.accounts.some((a) => a.name === n)) S.accounts.push({ ...newAccount(n, extra.kind), limit: extra.limit || 0 });
  commit('types', 'counters', 'accounts');
  return n;
}

export function updateAccount(name, patch) {
  S.accounts = S.accounts.map((a) => (a.name === name ? { ...a, ...patch } : a));
  commit('accounts');
}
export function updateType(name, patch) {
  S.types = S.types.map((t) => (t.name === name ? { ...t, ...patch } : t));
  commit('types');
}
