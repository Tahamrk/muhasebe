// Excel içe/dışa aktarma. Babamın "GENEL İCMAL" formatıyla birebir uyumludur.
import { S, commit } from './store.js';
import { CURS, upper, uid, round2, todayStr, downloadBlob, daysBetween } from './util.js';
import {
  T, DEFAULT_TYPES, DEFAULT_COUNTERS, NON_REPORT_NAMES, ACCOUNT_KINDS,
  emptyAmt, addAmt, roundAmt, amtCurs, balances, guessKind,
  people, getFirm, firmLedger, cariOpen,
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
    // Cari firma bilgileri ve satırların fiş türü / vade / durum bilgileri
    const cw = wb.addWorksheet('_CARİ_EK', { state: 'hidden' });
    cw.getCell('A1').value = 'TÜR';
    cw.getCell('B1').value = 'KAYIT NO';
    cw.getCell('C1').value = 'BİLGİ (JSON)';
    let r = 2;
    for (const f of S.firms) { cw.getCell(r, 1).value = 'FİRMA'; cw.getCell(r++, 3).value = JSON.stringify(f); }
    for (const c of S.cari) {
      if (!c.fis && !c.due && !c.status && !c.paidOn) continue;
      cw.getCell(r, 1).value = 'SATIR';
      cw.getCell(r, 2).value = c.id;
      cw.getCell(r++, 3).value = JSON.stringify({ fis: c.fis || '', due: c.due || '', status: c.status || '', paidOn: c.paidOn || '' });
    }
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

/* -------------------- Cariler (babamın "Cariler" Excel düzeni) -------------------- */

const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const THIN = { style: 'thin', color: { argb: 'FFBFCBC7' } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function sheetName(n, used) {
  const base = (n.replace(/[[\]*?/\\:']/g, ' ').replace(/\s+/g, ' ').trim() || 'FİRMA').slice(0, 31);
  let s = base, k = 2;
  while (used.has(upper(s))) { const suf = ` (${k++})`; s = base.slice(0, 31 - suf.length) + suf; }
  used.add(upper(s));
  return s;
}
const q = (s) => `'${s.replace(/'/g, "''")}'`;

function headerRow(ws, r, values) {
  const row = ws.getRow(r);
  values.forEach((h, i) => {
    const c = row.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = HEADER_FILL;
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = BOX;
  });
  row.height = 28;
}

/** Tek firmanın sayfası. Döner: para birimi başına bakiye hücresi. */
function writeFirmSheet(ws, name, backLink) {
  const firm = getFirm(name);
  const today = todayStr();
  let blocks = firmLedger(name);
  if (!blocks.length) blocks = [{ cur: firm.cur, rows: [], borc: 0, alacak: 0, bal: 0 }];
  ws.mergeCells(1, 1, 1, 8);
  const t = ws.getCell(1, 1);
  t.value = name;
  t.font = TITLE_FONT;
  ws.getRow(1).height = 24;
  ws.getCell(1, 9).value = firm.group === 'borc' ? 'BORÇ CARİLER' : 'ALACAK CARİLER';
  ws.getCell(1, 9).font = { bold: true };
  if (backLink) {
    ws.getCell(1, 10).value = { text: 'ANA SAYFA', hyperlink: "#'ANA SAYFA'!A1" };
    ws.getCell(1, 10).font = { color: { argb: 'FF1D4A7A' }, underline: true };
  }
  const out = [];
  let r = 2;
  for (const b of blocks) {
    const lbl = CUR_COLS.find(([c]) => c === b.cur)[1];
    headerRow(ws, r, ['TARİH', 'FİŞ TÜRÜ', 'AÇIKLAMA', `BORÇ ${lbl}`, `ALACAK ${lbl}`, `BAKİYE ${lbl}`, 'ÖDEME VADE', 'ÖDENEN TARİH', 'KALAN SÜRE (GÜN)', 'DURUM']);
    const first = r + 1;
    b.rows.forEach(({ r: c, borc, alacak, bal }, i) => {
      const n = first + i;
      const row = ws.getRow(n);
      row.getCell(1).value = xDate(c.date);
      row.getCell(2).value = c.fis || null;
      row.getCell(3).value = c.desc || null;
      if (borc) row.getCell(4).value = borc;
      if (alacak) row.getCell(5).value = alacak;
      row.getCell(6).value = { formula: n === first ? `E${n}-D${n}` : `F${n - 1}+E${n}-D${n}`, result: bal };
      if (c.due) row.getCell(7).value = xDate(c.due);
      if (c.paidOn) row.getCell(8).value = xDate(c.paidOn);
      if (cariOpen(c)) row.getCell(9).value = { formula: `G${n}-TODAY()`, result: daysBetween(today, c.due) };
      row.getCell(10).value = c.status || (c.due ? 'ÖDENMEDİ' : null);
      [1, 7, 8].forEach((k) => (row.getCell(k).numFmt = 'dd.mm.yyyy'));
      [4, 5, 6].forEach((k) => (row.getCell(k).numFmt = NUM_FMT));
      row.getCell(9).numFmt = '0;[Red]-0';
      for (let k = 1; k <= 10; k++) row.getCell(k).border = BOX;
      row.getCell(10).font = { bold: true, color: { argb: c.status === 'ÖDENDİ' || c.status === 'MAHSUP' ? 'FF0F7B3F' : 'FFC0392B' } };
    });
    const last = Math.max(first, first + b.rows.length - 1);
    const tr = b.rows.length ? first + b.rows.length : first;
    const row = ws.getRow(tr);
    row.getCell(3).value = 'TOPLAM';
    row.getCell(4).value = { formula: b.rows.length ? `SUM(D${first}:D${last})` : '0', result: b.borc };
    row.getCell(5).value = { formula: b.rows.length ? `SUM(E${first}:E${last})` : '0', result: b.alacak };
    row.getCell(6).value = { formula: `E${tr}-D${tr}`, result: b.bal };
    row.getCell(7).value = b.bal > 0.004 ? 'BİZE BORÇLU' : b.bal < -0.004 ? 'BİZ BORÇLUYUZ' : 'KAPANDI';
    for (let k = 1; k <= 10; k++) {
      const c = row.getCell(k);
      c.font = { bold: true };
      c.border = { top: { style: 'medium', color: { argb: 'FF0F6E5F' } } };
      if (k >= 4 && k <= 6) c.numFmt = NUM_FMT;
    }
    out.push({ cur: b.cur, ref: `${q(ws.name)}!F${tr}`, bal: b.bal });
    r = tr + 2;
  }
  if (blocks.length === 1) ws.views = [{ state: 'frozen', ySplit: 2 }];
  [12, 12, 46, 16, 16, 16, 13, 13, 12, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  return out;
}

/** names verilirse sadece o firmalar; verilmezse tüm cariler (ANA SAYFA + listeler + firma sayfaları). */
export async function buildCariWorkbook(names) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kişisel Muhasebe';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true; // açılınca formüller (KALAN SÜRE, toplamlar) yeniden hesaplansın
  const all = !names;
  const list = (names || people()).map((n) => ({ name: n, firm: getFirm(n) }));
  const used = new Set();
  if (!all) {
    for (const { name } of list) writeFirmSheet(wb.addWorksheet(sheetName(name, used)), name, false);
    return wb;
  }
  ['ANA SAYFA', 'ALACAK CARİLER', 'BORÇ CARİLER'].forEach((n) => used.add(upper(n)));
  const main = wb.addWorksheet('ANA SAYFA');
  const groups = [['alacak', wb.addWorksheet('ALACAK CARİLER')], ['borc', wb.addWorksheet('BORÇ CARİLER')]];
  const sorted = [...list].sort((a, b) => (a.firm.group === b.firm.group ? a.name.localeCompare(b.name, 'tr') : a.firm.group === 'alacak' ? -1 : 1));
  const refs = new Map();
  for (const { name } of sorted) {
    const ws = wb.addWorksheet(sheetName(name, used));
    refs.set(name, { sheet: ws.name, cells: writeFirmSheet(ws, name, true) });
  }

  const usedCurs = new Set();
  for (const [g, ws] of groups) {
    const title = g === 'alacak' ? 'ALACAK CARİLER' : 'BORÇ CARİLER';
    ws.getCell(1, 1).value = title;
    ws.getCell(1, 1).font = TITLE_FONT;
    ws.getCell(1, 7).value = { text: 'ANA SAYFA', hyperlink: "#'ANA SAYFA'!A1" };
    ws.getCell(1, 7).font = { color: { argb: 'FF1D4A7A' }, underline: true };
    headerRow(ws, 2, ['FİRMA', 'TOPLAM', 'PARA BİRİMİ', 'AÇIKLAMA', 'DURUM', 'NOT']);
    let r = 3;
    for (const { name, firm } of sorted.filter((x) => x.firm.group === g)) {
      const { sheet, cells } = refs.get(name);
      const closed = cells.every((c) => Math.abs(c.bal) < 0.005);
      for (const c of cells) {
        usedCurs.add(c.cur);
        const row = ws.getRow(r++);
        row.getCell(1).value = { text: name, hyperlink: `#${q(sheet)}!A1` };
        row.getCell(1).font = { bold: true, color: { argb: 'FF1D4A7A' }, underline: true };
        row.getCell(2).value = { formula: c.ref, result: c.bal };
        row.getCell(2).numFmt = NUM_FMT;
        row.getCell(3).value = CUR_COLS.find(([k]) => k === c.cur)[1];
        row.getCell(4).value = firm.risk || 'NORMAL';
        row.getCell(5).value = closed ? 'ÖDENDİ' : 'ÖDENMEDİ';
        row.getCell(5).font = { bold: true, color: { argb: closed ? 'FF0F7B3F' : 'FFC0392B' } };
        row.getCell(6).value = firm.note || null;
        for (let k = 1; k <= 6; k++) row.getCell(k).border = BOX;
      }
    }
    [30, 18, 12, 14, 12, 30].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: 'frozen', ySplit: 2 }];
  }

  // ANA SAYFA: grup toplamları (para birimine göre)
  const curs = CUR_COLS.filter(([c]) => usedCurs.has(c));
  if (!curs.length) curs.push(CUR_COLS[0]);
  main.getCell(1, 1).value = 'CARİLER ÖZETİ';
  main.getCell(1, 1).font = TITLE_FONT;
  main.getCell(1, 3).value = `Tarih: ${todayStr().split('-').reverse().join('.')}`;
  headerRow(main, 2, ['', ...curs.map(([, l]) => `TOPLAM ${l}`)]);
  const sums = { alacak: emptyAmt(), borc: emptyAmt() };
  for (const { name, firm } of list) for (const c of refs.get(name).cells) sums[firm.group][c.cur] = round2(sums[firm.group][c.cur] + c.bal);
  [['ALACAK CARİLER', 'alacak'], ['BORÇ CARİLER', 'borc']].forEach(([title, g], i) => {
    const row = main.getRow(3 + i);
    row.getCell(1).value = { text: title, hyperlink: `#${q(title)}!A1` };
    row.getCell(1).font = { bold: true, color: { argb: 'FF1D4A7A' }, underline: true };
    curs.forEach(([cur, l], k) => {
      const c = row.getCell(2 + k);
      c.value = { formula: `SUMIF(${q(title)}!C:C,"${l}",${q(title)}!B:B)`, result: sums[g][cur] };
      c.numFmt = NUM_FMT;
    });
  });
  const tr = main.getRow(5);
  tr.getCell(1).value = 'TOPLAM';
  tr.getCell(1).font = { bold: true };
  curs.forEach(([cur], k) => {
    const L = colLetter(2 + k);
    const c = tr.getCell(2 + k);
    c.value = { formula: `${L}3+${L}4`, result: round2(sums.alacak[cur] + sums.borc[cur]) };
    c.numFmt = NUM_FMT;
    c.font = { bold: true };
  });
  for (let r = 3; r <= 5; r++) for (let k = 1; k <= curs.length + 1; k++) main.getRow(r).getCell(k).border = BOX;
  main.getCell(7, 1).value = 'Artı tutar: firma bize borçlu (alacaklıyız). Eksi tutar: biz borçluyuz.';
  main.getCell(7, 1).font = { italic: true, color: { argb: 'FF5B6B66' } };
  [24, 18, 18, 18, 18].forEach((w, i) => (main.getColumn(i + 1).width = w));
  return wb;
}

export async function exportCari(names, { share = false } = {}) {
  const wb = await buildCariWorkbook(names);
  const safe = (s) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
  const name = names?.length === 1 ? `Cari_${safe(names[0])}_${todayStr()}.xlsx` : `Cariler_${todayStr()}.xlsx`;
  return saveWorkbook(wb, name, share);
}

async function saveWorkbook(wb, name, share) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: xlsxType });
  if (share) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return { name, shared: true };
      } catch (e) {
        if (e.name === 'AbortError') return { cancelled: true };
        throw e;
      }
    }
  }
  downloadBlob(blob, name);
  return { name, shared: false };
}

export async function exportExcel({ year, share = false } = {}) {
  const wb = await buildWorkbook({ year });
  const buf = await wb.xlsx.writeBuffer();
  const name = year ? `Genel_Kasa_${year}.xlsx` : `Muhasebe_Yedek_${todayStr()}.xlsx`;
  const blob = new Blob([buf], { type: xlsxType });
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
    if (ws.name.startsWith('_')) continue; // gizli yardımcı sayfalar aşağıda okunur
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

  // Cari firma bilgileri ve satır ekleri (sadece uygulama yedeğinde bulunur)
  const firms = [];
  const extras = new Map();
  const cxWs = wb.worksheets.find((w) => w.name === '_CARİ_EK');
  if (cxWs) {
    for (let r = 2; r <= cxWs.rowCount; r++) {
      const kind = cellVal(cxWs.getCell(r, 1));
      try {
        const v = JSON.parse(cellVal(cxWs.getCell(r, 3)) || 'null');
        if (!v) continue;
        if (kind === 'FİRMA' && v.name) firms.push(v);
        else if (kind === 'SATIR') extras.set(String(cellVal(cxWs.getCell(r, 2))), v);
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
      cari: (cari || []).map((c) => ({ ...flipAmt(c), link: null, fis: '', due: '', status: '', paidOn: '', ...(extras.get(c.id) || {}) })),
      firms,
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
    S.firms = d.firms || [];
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
    for (const c of d.cari) c.id = uid() + Math.random().toString(36).slice(2, 5);
    S.cari = [...S.cari, ...d.cari].sort((a, b) => a.date.localeCompare(b.date));
    for (const f of d.firms || []) if (!S.firms.some((x) => x.name === f.name)) S.firms.push(f);
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
