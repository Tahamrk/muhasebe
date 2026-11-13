// Borç / alacak takibi: toplam tutar, taksit planı, yapılan ödemeler.
// Ödemeler ana kasaya kayıt olarak işlenir (hesaptan düşer / hesaba girer).
import { S, commit } from './store.js';
import { uid, round2, upper, todayStr, addMonths, daysBetween } from './util.js';
import { saveTx, deleteTx, T, emptyAmt } from './model.js';

export const KIND_LABEL = { borc: 'Borç', alacak: 'Alacak' };
export const PAY_WORD = { borc: 'Ödeme', alacak: 'Tahsilat' };

const sum = (arr, f = (x) => x.amount) => round2(arr.reduce((s, x) => s + (f(x) || 0), 0));

/**
 * Bir borç/alacak dosyasının durumunu hesaplar.
 * Yapılan ödemeler taksitlere vade sırasıyla dağıtılır (önce en eski vade kapanır).
 */
export function debtStatus(d, today = todayStr()) {
  const paid = sum(d.payments);
  const remaining = round2(d.total - paid);
  const sched = d.schedule.map((s, i) => ({ ...s, _i: i })).sort((a, b) => (a.due || '').localeCompare(b.due || '') || a._i - b._i);
  let left = paid;
  const rows = sched.map((s, n) => {
    const p = round2(Math.min(s.amount, Math.max(0, left)));
    left = round2(left - p);
    const rest = round2(s.amount - p);
    const days = s.due ? daysBetween(today, s.due) : null;
    let status = 'open';
    if (rest <= 0.004) status = 'paid';
    else if (days !== null && days < 0) status = 'late';
    else if (p > 0) status = 'partial';
    return { ...s, no: n + 1, paid: p, rest, days, status };
  });
  const planned = sum(d.schedule);
  const next = rows.find((r) => r.rest > 0.004) || null;
  return {
    paid,
    remaining,
    planned,
    unplanned: round2(d.total - planned), // plana bağlanmamış tutar
    rows,
    next,
    closed: remaining <= 0.004,
    overpaid: remaining < -0.004 ? -remaining : 0,
    lateCount: rows.filter((r) => r.status === 'late').length,
  };
}

/** Vadesi yaklaşan / geçen taksitler (açık dosyalar). */
export function upcomingInstallments(withinDays = 10) {
  const out = [];
  for (const d of S.debts) {
    const st = debtStatus(d);
    if (st.closed) continue;
    for (const r of st.rows) {
      if (r.rest > 0.004 && r.days !== null && r.days <= withinDays) out.push({ d, r });
    }
  }
  return out.sort((a, b) => a.r.due.localeCompare(b.r.due));
}

export function debtTotals() {
  const borc = emptyAmt(), alacak = emptyAmt();
  for (const d of S.debts) {
    const st = debtStatus(d);
    if (st.remaining <= 0) continue;
    (d.kind === 'borc' ? borc : alacak)[d.cur] += st.remaining;
  }
  return { borc, alacak };
}

/* ---------------- Taksit planı yardımcıları ---------------- */

/** count adet, her biri amount olan aylık taksit üretir. */
export function fixedRows(count, amount, firstDue) {
  return Array.from({ length: count }, (_, i) => ({ id: uid(), due: addMonths(firstDue, i), amount: round2(amount), label: '' }));
}

/** total tutarı count eşit aylık taksite böler (kuruş farkı son taksite). */
export function equalRows(total, count, firstDue) {
  const each = Math.floor((total / count) * 100) / 100;
  const rows = fixedRows(count, each, firstDue);
  rows[rows.length - 1].amount = round2(total - each * (count - 1));
  return rows;
}

/* ---------------- Kayıt işlemleri ---------------- */

export const findDebt = (id) => S.debts.find((d) => d.id === id);

export function saveDebt(d) {
  const row = {
    id: d.id || uid(),
    kind: d.kind === 'alacak' ? 'alacak' : 'borc',
    person: upper(d.person),
    title: upper(d.title) || (d.kind === 'alacak' ? 'ALACAK' : 'BORÇ'),
    cur: d.cur || 'TRY',
    total: round2(d.total),
    date: d.date || todayStr(),
    type: upper(d.type) || T.CARI,
    note: d.note || '',
    schedule: (d.schedule || []).filter((s) => s.amount > 0).map((s) => ({ id: s.id || uid(), due: s.due || '', amount: round2(s.amount), label: upper(s.label || '') })),
    payments: d.payments || [],
    created: d.created || Date.now(),
  };
  const i = S.debts.findIndex((x) => x.id === row.id);
  if (i >= 0) {
    // Plan değiştiyse bağlı kasa kayıtlarının tür / kişi bilgisini de güncelle.
    const old = S.debts[i];
    S.debts[i] = row;
    if (old.type !== row.type || old.person !== row.person) row.payments.forEach((p) => p.txId && syncTx(row, p));
  } else S.debts.push(row);
  if (row.person && !S.counters.includes(row.person)) S.counters.push(row.person);
  commit('debts', 'counters');
  return row;
}

export function defaultPayDesc(d) {
  return `${d.title} ${d.kind === 'borc' ? 'ÖDEMESİ' : 'TAHSİLATI'}`;
}

function syncTx(d, p) {
  const existing = p.txId && S.tx.find((t) => t.id === p.txId);
  if (!p.account) {
    if (existing) deleteTx(existing);
    p.txId = null;
    return;
  }
  const id = existing ? existing.id : uid();
  const sign = d.kind === 'borc' ? -1 : 1;
  saveTx([{
    id, date: p.date, type: d.type || T.CARI, counter: d.person, account: p.account,
    desc: p.desc || defaultPayDesc(d), amt: { [d.cur]: sign * p.amount },
  }], existing || undefined);
  p.txId = id;
}

/**
 * Ödeme / tahsilat kaydeder. Hesap seçildiyse ana kasaya da işlenir:
 * borçta hesaptan çıkar (kart seçilirse kart borcu artar), alacakta hesaba girer.
 */
export function savePlanPayment(debtId, pay) {
  const d = findDebt(debtId);
  if (!d) return;
  const p = {
    id: pay.id || uid(), date: pay.date || todayStr(), amount: round2(pay.amount),
    account: upper(pay.account || ''), desc: upper(pay.desc || ''), txId: pay.txId || null,
  };
  syncTx(d, p);
  const i = d.payments.findIndex((x) => x.id === p.id);
  if (i >= 0) d.payments[i] = p; else d.payments.push(p);
  d.payments.sort((a, b) => a.date.localeCompare(b.date));
  commit('debts');
  return p;
}

export function deletePlanPayment(debtId, payId) {
  const d = findDebt(debtId);
  if (!d) return;
  const p = d.payments.find((x) => x.id === payId);
  if (p?.txId) {
    const t = S.tx.find((x) => x.id === p.txId);
    if (t) deleteTx(t);
  }
  d.payments = d.payments.filter((x) => x.id !== payId);
  commit('debts');
}

export function deleteDebt(id, { withTx = false } = {}) {
  const d = findDebt(id);
  if (!d) return;
  if (withTx) {
    for (const p of d.payments) {
      const t = p.txId && S.tx.find((x) => x.id === p.txId);
      if (t) deleteTx(t);
    }
  }
  S.debts = S.debts.filter((x) => x.id !== id);
  commit('debts');
}

/** Bir ana kasa kaydı bir borç ödemesine bağlı mı? */
export function paymentForTx(txId) {
  for (const d of S.debts) {
    const p = d.payments.find((x) => x.txId === txId);
    if (p) return { d, p };
  }
  return null;
}
