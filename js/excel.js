// Excel içe/dışa aktarma. Babamın "GENEL İCMAL" formatıyla birebir uyumludur.
import { S, commit } from './store.js';
import { CURS, upper, uid, round2, todayStr, downloadBlob } from './util.js';
import {
  T, DEFAULT_TYPES, DEFAULT_COUNTERS, NON_REPORT_NAMES, ACCOUNT_KINDS,
  emptyAmt, addAmt, roundAmt, amtCurs, balances, guessKind,
} from './model.js';
import { debtStatus } from './debts.js';

let excelP;
function loadExcelJS() {
  return (excelP ||= new Promise((res, rej) => {
    if (window.ExcelJS) return res(window.ExcelJS);
    const s = document.createElement('script');
    s.src = 'vendor/exceljs.min.js';
    s.onload = () => res(window.ExcelJS);
    s.onerror = () => { excelP = null; rej(new Error('Excel modülü yüklenemedi')); };
    document.head.appendChild(s);
  }));
}

const MARKER = 'MUHASEBE UYGULAMASI YEDEĞİ';
const CUR_COLS = [
  ['TRY', 'TL', 'TL'],
  ['USD', 'USD', 'USD'],
  ['EUR', 'EURO', 'EURO'],
  ['XAU', 'ALTIN (GR)', ' (GR)'],
];
const KIND_LABEL = ACCOUNT_KINDS;

/*
 * Cari sayfasında babamın kullanımı: BORÇ = biz o kişiye borçluyuz, ALACAK = o kişi bize borçlu.
 * Uygulama içinde ise eksi tutar = "o kişi bize borçlu" demektir. Bu yüzden cari sayfası
 * okunurken ve yazılırken tutarların işareti ters çevrilir.
 */
const flipAmt = (row) => {
  const amt = emptyAmt();
  for (const c of CURS) amt[c] = -(row.amt?.[c] || 0) || 0;
  return { ...row, amt };
};
const KIND_FROM_LABEL = Object.fromEntries(Object.entries(ACCOUNT_KINDS).map(([k, v]) => [upper(v), k]));

/* ============================ DIŞA AKTARMA ============================ */

const colLetter = (n) => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const xDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F6E5F' } };
const TITLE_FONT = { bold: true, size: 14, color: { argb: 'FF0F6E5F' } };
const NUM_FMT = '#,##0.00;[Red]-#,##0.00';

function limitRows(date) {
  return S.accounts.filter((a) => a.limit).map((a) => {
    let desc = a.limitDesc || `${a.name} LİMİTİ`;
    if (!/LİMİT/.test(desc)) desc += ' LİMİTİ';
    return { date, type: a.limitType || (a.kind === 'kart' ? T.KKARTI : T.KMH), counter: 'BANKA', account: a.name, desc, amt: { ...emptyAmt(), TRY: a.limit } };
  });
}

/** Ana kasa ve cari sayfalarındaki ortak defter düzeni (formüllü). */
function writeLedger(ws, title, rows) {
  const lastCol = 5 + CUR_COLS.length * 3;
  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = TITLE_FONT;
  ws.getCell(1, 1).alignment = { horizontal: 'center' };

  const headers = ['TARIH', 'GELİR/GİDER TÜRÜ', 'KARŞI HESAP', 'SORUMLULUK MERKEZİ', 'AÇIKLAMA'];
  CUR_COLS.forEach(([, lbl, kalan]) => headers.push(`BORÇ ${lbl}`, `ALACAK ${lbl}`, `KALAN ${kalan}`));
  const hr = ws.getRow(3);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = HEADER_FILL;
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  hr.height = 30;
  // Gizli sütun: geri yüklemede kayıtların kimliği korunur (borç ödemeleri ile bağ kopmaz).
  hr.getCell(lastCol + 1).value = 'KAYIT NO';
  ws.getColumn(lastCol + 1).hidden = true;

  const first = 4;
  const last = Math.max(first, first + rows.length - 1);
  const running = emptyAmt();
  const sums = CUR_COLS.map(() => ({ b: 0, a: 0 }));

  rows.forEach((t, i) => {
    const r = first + i;
    const row = ws.getRow(r);
    row.getCell(1).value = xDate(t.date);
    row.getCell(1).numFmt = 'dd.mm.yyyy';
    row.getCell(2).value = t.type || null;
    row.getCell(3).value = t.counter || null;
    row.getCell(4).value = t.account || null;
    row.getCell(5).value = t.desc || null;
    if (t.id) row.getCell(lastCol + 1).value = t.id;
    CUR_COLS.forEach(([cur], k) => {
      const cb = 6 + k * 3;
      const v = round2(t.amt[cur] || 0);
      const B = colLetter(cb), A = colLetter(cb + 1), K = colLetter(cb + 2);
      if (v < 0) { row.getCell(cb).value = -v; sums[k].b += -v; }
      if (v > 0) { row.getCell(cb + 1).value = v; sums[k].a += v; }
      running[cur] = round2(running[cur] + v);
      row.getCell(cb + 2).value = {
        formula: r === first ? `${A}${r}-${B}${r}` : `${K}${r - 1}+${A}${r}-${B}${r}`,
        result: running[cur],
      };
      [cb, cb + 1, cb + 2].forEach((c) => (row.getCell(c).numFmt = NUM_FMT));
    });
  });

  // 2. satır: filtreye göre değişen ara toplamlar (Excel'deki SUBTOTAL gibi)
  const tr = ws.getRow(2);
  CUR_COLS.forEach((_, k) => {
    const cb = 6 + k * 3;
    const B = colLetter(cb), A = colLetter(cb + 1);
    tr.getCell(cb).value = { formula: `SUBTOTAL(9,${B}${first}:${B}${last})`, result: round2(sums[k].b) };
    tr.getCell(cb + 1).value = { formula: `SUBTOTAL(9,${A}${first}:${A}${last})`, result: round2(sums[k].a) };
    tr.getCell(cb + 2).value = { formula: `${A}2-${B}2`, result: round2(sums[k].a - sums[k].b) };
    [cb, cb + 1, cb + 2].forEach((c) => { tr.getCell(c).numFmt = NUM_FMT; tr.getCell(c).font = { bold: true }; });
  });

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: last, column: lastCol } };
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  const widths = [12, 18, 18, 20, 42];
  for (let c = 1; c <= lastCol; c++) ws.getColumn(c).width = widths[c - 1] || 14;
}

function writeSimple(ws, headers, rows, widths = []) {
  const hr = ws.getRow(1);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = HEADER_FILL;
  });
  rows.forEach((vals, i) => {
    const row = ws.getRow(i + 2);
    vals.forEach((v, j) => {
      const c = row.getCell(j + 1);
      if (v && typeof v === 'object' && v.date) { c.value = xDate(v.date); c.numFmt = 'dd.mm.yyyy'; }
      else { c.value = v ?? null; if (typeof v === 'number') c.numFmt = NUM_FMT; }
    });
  });
  headers.forEach((_, i) => (ws.getColumn(i + 1).width = widths[i] || 18));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * Excel çalışma kitabı üretir.
 * year verilmezse: tam yedek (tüm yıllar + ayarlar; geri yüklemede birebir döner).
 * year verilirse: o yılın Excel'i (başında DEVREDEN satırları ile), babamın kullandığı biçimde.
 */
export async function buildWorkbook({ year } = {}) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kişisel Muhasebe';
  wb.created = new Date();

  let rows, title;
  const firstDate = S.tx[0]?.date || todayStr();
  if (year) {
    const from = `${year}-01-01`, to = `${year}-12-31`;
    const before = balances(S.tx.filter((t) => t.date < from));
    const opening = [];
    for (const [acc, b] of before) {
      if (!amtCurs(b).length) continue;
      opening.push({ date: from, type: T.DEVREDEN, counter: 'BANKA', account: acc, desc: `${acc} ${year - 1} DEVREDEN BAKİYE`, amt: b });
    }
    rows = [...limitRows(from), ...opening, ...S.tx.filter((t) => t.date >= from && t.date <= to)];
    title = `${year} ŞAHSİ GENEL KASA`;
  } else {
    rows = [...limitRows(firstDate), ...S.tx];
    title = 'ŞAHSİ GENEL KASA';
  }

  writeLedger(wb.addWorksheet('GENEL İCMAL'), title, rows);
  writeLedger(wb.addWorksheet('CARİ BORÇ ALACAK'), 'CARİ BORÇ ALACAK', S.cari.map(flipAmt));

  writeSimple(wb.addWorksheet('YAKLAŞAN ÖDEMELER'),
    ['ÖDEME ADI', 'MİKTAR', 'PARA BİRİMİ', 'SON ÖDEME TARİHİ', 'TEKRAR', 'DURUM', 'BAĞLI HESAP', 'NOT'],
    S.payments.map((p) => [p.name, p.amount, p.cur, p.due ? { date: p.due } : null, p.repeat === 'monthly' ? 'HER AY' : 'TEK SEFER', p.paid ? 'ÖDENDİ' : 'BEKLİYOR', p.account || null, p.note || null]),
    [24, 14, 12, 18, 12, 12, 18, 30]);

  // Borç / alacak takibi: özet + taksitler (okunabilir), _PLANLAR (birebir geri yükleme için)
  const debts = S.debts.map((d) => ({ d, st: debtStatus(d) }));
  writeSimple(wb.addWorksheet('BORÇ ALACAK TAKİBİ'),
    ['TÜR', 'KİŞİ / FİRMA', 'KONU', 'TARİH', 'PARA BİRİMİ', 'TOPLAM', 'ÖDENEN / TAHSİL EDİLEN', 'KALAN', 'SIRADAKİ VADE', 'SIRADAKİ TUTAR', 'DURUM', 'NOT'],
    debts.map(({ d, st }) => [d.kind === 'borc' ? 'BORÇ' : 'ALACAK', d.person, d.title, { date: d.date }, d.cur, d.total, st.paid, st.remaining,
      st.next?.due ? { date: st.next.due } : null, st.next ? st.next.rest : null, st.closed ? 'KAPANDI' : st.lateCount ? 'GECİKMEDE' : 'AÇIK', d.note || null]),
    [10, 22, 26, 12, 10, 16, 18, 16, 14, 16, 12, 30]);
  const inst = [];
  for (const { d, st } of debts) for (const r of st.rows) {
    inst.push([d.kind === 'borc' ? 'BORÇ' : 'ALACAK', d.person, d.title, r.no, r.label || null, r.due ? { date: r.due } : null, d.cur, r.amount, r.paid, r.rest,
      r.status === 'paid' ? 'ÖDENDİ' : r.status === 'late' ? 'GECİKTİ' : r.status === 'partial' ? 'KISMEN' : 'BEKLİYOR']);
  }
  writeSimple(wb.addWorksheet('TAKSİTLER'),
    ['TÜR', 'KİŞİ / FİRMA', 'KONU', 'TAKSİT NO', 'ETİKET', 'VADE', 'PARA BİRİMİ', 'TUTAR', 'ÖDENEN', 'KALAN', 'DURUM'],
    inst, [10, 22, 26, 10, 12, 12, 10, 16, 16, 16, 12]);
  if (!year) {
    const pw = wb.addWorksheet('_PLANLAR', { state: 'hidden' });
    pw.getCell('A1').value = 'PLAN (JSON)';
    S.debts.forEach((d, i) => (pw.getCell(i + 2, 1).value = JSON.stringify(d)));
  }

  const bal = balances();
  writeSimple(wb.addWorksheet('HESAPLAR'),
    ['HESAP ADI', 'HESAP TÜRÜ', 'LİMİT', 'ARŞİV', 'BAKİYE TL', 'BAKİYE USD', 'BAKİYE EURO', 'BAKİYE ALTIN (GR)'],
    S.accounts.map((a) => {
      const b = bal.get(a.name) || emptyAmt();
      return [a.name, KIND_LABEL[a.kind] || 'Diğer', a.limit || 0, a.archived ? 'EVET' : 'HAYIR', b.TRY, b.USD, b.EUR, b.XAU];
    }), [24, 14, 14, 8, 16, 14, 14, 16]);

  const lists = wb.addWorksheet('LİSTELER');
  const n = Math.max(S.types.length, S.counters.length);
  writeSimple(lists, ['GELİR/GİDER TÜRÜ', 'RAPORA DAHİL', '', 'KARŞI HESAP'],
    Array.from({ length: n }, (_, i) => [S.types[i]?.name ?? null, S.types[i] ? (S.types[i].report !== false ? 'EVET' : 'HAYIR') : null, null, S.counters[i] ?? null]),
    [22, 14, 4, 22]);

  if (!year) {
    const st = wb.addWorksheet('AYARLAR', { state: 'hidden' });
    const { displayCur, bigText, autoRates, rates, lockMinutes } = S.settings;
    st.getCell('A1').value = MARKER;
    st.getCell('A2').value = 2; // 2: cari sayfası BORÇ = biz borçluyuz
    st.getCell('A3').value = new Date().toISOString();
    st.getCell('A4').value = JSON.stringify({ displayCur, bigText, autoRates, rates, lockMinutes });
  }
  return wb;
}

export async function exportExcel({ year, share = false } = {}) {
  const wb = await buildWorkbook({ year });
  const buf = await wb.xlsx.writeBuffer();
  const name = year ? `Genel_Kasa_${year}.xlsx` : `Muhasebe_Yedek_${todayStr()}.xlsx`;
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  let shared = false;
  if (share) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        shared = true;
      } catch (e) {
        if (e.name === 'AbortError') return { cancelled: true };
        throw e;
      }
    }
  }
  if (!shared) downloadBlob(blob, name);
  if (!year) {
    S.settings = { ...S.settings, lastBackup: new Date().toISOString() };
    commit('settings');
  }
  return { name, shared };
}

/* ============================ İÇE AKTARMA ============================ */

const norm = (s) => upper(s).replace(/[^A-ZÇĞİIÖŞÜ0-9]/g, '');

function cellVal(c) {
  let v = c?.value;
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if (v.richText) v = v.richText.map((r) => r.text).join('');
    else if ('text' in v) v = v.text;
    else if (v.error) v = null;
    else if ('sharedFormula' in v || 'formula' in v) v = null;
  }
  return v ?? null;
}

function toDateStr(v) {
  if (v == null || v === '') return null;
  const p = (n) => String(n).padStart(2, '0');
  if (v instanceof Date) {
    if (isNaN(v)) return null;
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  if (typeof v === 'number' && v > 1000 && v < 100000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return toDateStr(d);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${p(m[2])}-${p(m[1])}`;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${p(m[2])}-${p(m[3])}`;
  return null;
}

function toNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[\s₺$€]|TL/gi, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
const toText = (v) => (v == null ? '' : upper(v instanceof Date ? toDateStr(v) : String(v)));

/** Başlık satırını bulur ve sütunları eşleştirir. */
function findLedgerHeader(ws) {
  const maxR = Math.min(ws.rowCount, 15);
  for (let r = 1; r <= maxR; r++) {
    const row = ws.getRow(r);
    const cols = {};
    const amounts = [];
    for (let c = 1; c <= Math.min(row.cellCount || 30, 40); c++) {
      const h = norm(cellVal(row.getCell(c)) ?? '');
      if (!h) continue;
      if (h === 'KAYITNO') cols.id = c;
      else if (h === 'TARIH' || h === 'TARİH') cols.date = c;
      else if (h.includes('TÜR')) cols.type = c;
      else if (h.includes('KARŞI')) cols.counter = c;
      else if (h.includes('SORUMLULUK') || h === 'HESAP') cols.account = c;
      else if (h.includes('AÇIKLAMA')) cols.desc = c;
      else if (h.startsWith('BORÇ') || h.startsWith('ALACAK')) {
        const sign = h.startsWith('BORÇ') ? -1 : 1;
        const cur = h.includes('USD') ? 'USD' : h.includes('EUR') ? 'EUR' : h.includes('ALTIN') || h.includes('GR') ? 'XAU' : 'TRY';
        amounts.push({ c, cur, sign });
      }
    }
    if (cols.date && amounts.length && (cols.account || cols.counter)) return { row: r, cols, amounts };
  }
  return null;
}

function readLedger(ws) {
  const h = findLedgerHeader(ws);
  if (!h) return null;
  const out = [];
  let lastDate = null, skipped = 0;
  for (let r = h.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (k) => (h.cols[k] ? cellVal(row.getCell(h.cols[k])) : null);
    const amt = emptyAmt();
    for (const a of h.amounts) amt[a.cur] += toNum(cellVal(row.getCell(a.c))) * a.sign;
    roundAmt(amt);
    const type = toText(get('type')), counter = toText(get('counter')), account = toText(get('account')), desc = toText(get('desc'));
    const hasAmt = amtCurs(amt).length > 0;
    if (!hasAmt) {
      if (type || desc) skipped++;
      continue;
    }
    const date = toDateStr(get('date')) || lastDate;
    if (!date) { skipped++; continue; }
    lastDate = date;
    const rid = get('id');
    out.push({ id: rid ? String(rid) : uid(), date, type, counter, account, desc, amt, group: null, created: Date.now() + r });
  }
  return { rows: out, skipped };
}

/** Aynı gün içindeki karşılıklı virman / kart ödemesi satırlarını eşleştirir. */
function pairGroups(rows) {
  const pending = [];
  for (const r of rows) {
    if (r.type !== T.VIRMAN && r.type !== T.KKODEME) continue;
    const i = pending.findIndex((p) => p.date === r.date && p.type === r.type && p.account !== r.account
      && amtCurs(roundAmt(addAmt(addAmt(emptyAmt(), p.amt), r.amt))).length === 0);
    if (i >= 0) {
      const g = uid();
      pending[i].group = g;
      r.group = g;
      pending.splice(i, 1);
    } else pending.push(r);
  }
}

function readPayments(ws) {
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const row = ws.getRow(r);
    const cols = {};
    for (let c = 1; c <= Math.min(row.cellCount || 12, 20); c++) {
      const h = norm(cellVal(row.getCell(c)) ?? '');
      if (!h) continue;
      if (h.includes('SONÖDEME')) cols.due = c;
      else if (h.includes('MİKTAR') || h.includes('TUTAR')) cols.amount = c;
      else if (h.includes('PARA')) cols.cur = c;
      else if (h.includes('TEKRAR')) cols.repeat = c;
      else if (h.includes('DURUM')) cols.status = c;
      else if (h.includes('HESAP')) cols.account = c;
      else if (h === 'NOT') cols.note = c;
      else if (h.includes('ADI') || h.includes('ÖDEME')) cols.name = c;
    }
    if (!cols.due || !cols.amount) continue;
    cols.name ||= 1;
    const out = [];
    for (let i = r + 1; i <= ws.rowCount; i++) {
      const row2 = ws.getRow(i);
      const g = (k) => (cols[k] ? cellVal(row2.getCell(cols[k])) : null);
      const name = toText(g('name'));
      if (!name) continue;
      const cur = toText(g('cur'));
      out.push({
        id: uid(), name, amount: round2(toNum(g('amount'))),
        cur: ['TRY', 'USD', 'EUR', 'XAU'].includes(cur) ? cur : 'TRY',
        due: toDateStr(g('due')) || '',
        repeat: toText(g('repeat')).includes('AY') ? 'monthly' : 'none',
        paid: toText(g('status')).includes('ÖDENDİ'),
        account: toText(g('account')), note: g('note') ? String(g('note')) : '', paidAt: null,
      });
    }
    return out;
  }
  return null;
}

/** Excel dosyasını okur; uygulama verisine çevirir ama henüz kaydetmez. */
export async function parseExcel(arrayBuffer) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);

  const settingsWs = wb.worksheets.find((w) => upper(w.name) === 'AYARLAR');
  const isBackup = settingsWs && cellVal(settingsWs.getCell('A1')) === MARKER;

  let main = null, cari = null, payments = null, skipped = 0;
  for (const ws of wb.worksheets) {
    const name = upper(ws.name);
    if (name.includes('CARİ') || name.includes('CARI')) {
      const r = readLedger(ws);
      if (r) { cari = (cari || []).concat(r.rows); skipped += r.skipped; }
      continue;
    }
    if (!main) {
      const r = readLedger(ws);
      if (r) { main = r.rows; skipped += r.skipped; continue; }
    }
    if (!payments) payments = readPayments(ws);
  }
  if (!main) throw new Error('Dosyada "TARIH / SORUMLULUK MERKEZİ / BORÇ / ALACAK" başlıklarını taşıyan bir sayfa bulunamadı.');

  // Kart / KMH limit satırları kayıt değil, hesap özelliğidir.
  const limits = new Map();
  const tx = [];
  for (const r of main) {
    if ((r.type === T.KKARTI || r.type === T.KMH) && /LİMİT/.test(r.desc)) {
      const l = limits.get(r.account) || { limit: 0, type: r.type, desc: r.desc };
      l.limit = round2(l.limit + r.amt.TRY);
      limits.set(r.account, l);
    } else tx.push(r);
  }
  tx.sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  pairGroups(tx);

  // Hesaplar
  const accMap = new Map();
  const addAcc = (name) => {
    if (!name || accMap.has(name)) return;
    const l = limits.get(name);
    accMap.set(name, {
      name, kind: l?.type === T.KKARTI ? 'kart' : guessKind(name),
      limit: l?.limit || 0, limitType: l?.type, limitDesc: l?.desc, archived: false,
    });
  };
  tx.forEach((t) => addAcc(t.account));
  limits.forEach((_, k) => addAcc(k));
  const accWs = wb.worksheets.find((w) => upper(w.name) === 'HESAPLAR');
  if (accWs) {
    for (let r = 2; r <= accWs.rowCount; r++) {
      const row = accWs.getRow(r);
      const name = toText(cellVal(row.getCell(1)));
      if (!name) continue;
      addAcc(name);
      const a = accMap.get(name);
      a.kind = KIND_FROM_LABEL[toText(cellVal(row.getCell(2)))] || a.kind;
      a.archived = toText(cellVal(row.getCell(4))) === 'EVET';
    }
  }
  if (!accMap.size) addAcc('KASA');

  // Türler ve karşı hesaplar
  const types = new Map(DEFAULT_TYPES.map((t) => [t.name, { ...t }]));
  const counters = new Set(DEFAULT_COUNTERS);
  for (const t of [...tx, ...(cari || [])]) {
    if (t.type && !types.has(t.type)) types.set(t.type, { name: t.type, report: !NON_REPORT_NAMES.has(t.type) });
  }
  // Cari sayfasındaki kişiler karşı hesap listesine eklenmez; sadece ana kasadakiler.
  for (const t of tx) if (t.counter) counters.add(t.counter);
  const listWs = wb.worksheets.find((w) => upper(w.name) === 'LİSTELER');
  if (listWs) {
    for (let r = 2; r <= listWs.rowCount; r++) {
      const row = listWs.getRow(r);
      const tn = toText(cellVal(row.getCell(1)));
      if (tn) types.set(tn, { name: tn, report: toText(cellVal(row.getCell(2))) !== 'HAYIR' });
      const cn = toText(cellVal(row.getCell(4)));
      if (cn) counters.add(cn);
    }
  }

  let settings = null;
  if (isBackup) {
    try { settings = JSON.parse(cellVal(settingsWs.getCell('A4')) || '{}'); } catch { settings = null; }
  }

  // Borç / alacak planları (sadece uygulama yedeğinde bulunur)
  const debts = [];
  const planWs = wb.worksheets.find((w) => w.name === '_PLANLAR');
  if (planWs) {
    for (let r = 2; r <= planWs.rowCount; r++) {
      const v = cellVal(planWs.getCell(r, 1));
      if (!v) continue;
      try {
        const d = JSON.parse(v);
        if (d && d.id && Array.isArray(d.schedule) && Array.isArray(d.payments)) debts.push(d);
      } catch { /* bozuk satır atlanır */ }
    }
  }

  const dates = tx.map((t) => t.date);
  return {
    isBackup,
    data: {
      tx,
      accounts: [...accMap.values()],
      types: [...types.values()],
      counters: [...counters],
      payments: payments || [],
      cari: (cari || []).map((c) => ({ ...flipAmt(c), link: null })),
      debts,
    },
    settings,
    stats: {
      tx: tx.length,
      accounts: accMap.size,
      limits: limits.size,
      cari: (cari || []).length,
      payments: (payments || []).length,
      debts: debts.length,
      skipped,
      from: dates[0],
      to: dates[dates.length - 1],
    },
  };
}

/** Okunan veriyi uygular. mode: 'replace' (mevcut verinin yerine) | 'append' (sonuna ekle) */
export function applyImport(parsed, mode) {
  const d = parsed.data;
  if (mode === 'replace') {
    S.tx = d.tx;
    S.accounts = d.accounts;
    S.types = d.types;
    S.counters = d.counters;
    S.payments = d.payments;
    S.cari = d.cari;
    S.debts = d.debts || [];
  } else {
    // Sonuna eklerken kimlik çakışması olmasın: yeni kimlik ver, borç ödemelerindeki bağları da güncelle.
    const idMap = new Map();
    for (const t of d.tx) { const n = uid() + Math.random().toString(36).slice(2, 5); idMap.set(t.id, n); t.id = n; }
    for (const debt of d.debts || []) {
      debt.id = uid() + Math.random().toString(36).slice(2, 5);
      debt.payments.forEach((p) => { p.id = uid() + Math.random().toString(36).slice(2, 5); p.txId = p.txId ? idMap.get(p.txId) || null : null; });
      debt.schedule.forEach((s) => (s.id = uid() + Math.random().toString(36).slice(2, 5)));
    }
    S.debts = [...S.debts, ...(d.debts || [])];
    S.tx = [...S.tx, ...d.tx].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
    for (const a of d.accounts) {
      const ex = S.accounts.find((x) => x.name === a.name);
      if (!ex) S.accounts.push(a);
      else if (!ex.limit && a.limit) Object.assign(ex, { limit: a.limit, limitType: a.limitType, limitDesc: a.limitDesc, kind: a.kind });
    }
    for (const t of d.types) if (!S.types.some((x) => x.name === t.name)) S.types.push(t);
    S.counters = [...new Set([...S.counters, ...d.counters])];
    S.payments = [...S.payments, ...d.payments];
    S.cari = [...S.cari, ...d.cari].sort((a, b) => a.date.localeCompare(b.date));
  }
  const patch = { lastBackup: new Date().toISOString() };
  if (parsed.settings) {
    const { displayCur, bigText, autoRates, rates, lockMinutes } = parsed.settings;
    Object.assign(patch, { displayCur, bigText, autoRates, lockMinutes });
    if (rates?.USD) patch.rates = rates;
    Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  }
  S.settings = { ...S.settings, ...patch };
  commit();
}
