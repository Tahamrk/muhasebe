// Borç / Alacak sekmesi: taksitli borç ve alacakların detaylı takibi.
import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { S } from '../store.js';
import { CURS, CUR_LABEL, money, num, fmtDate, todayStr, parseNum, round2, addMonths } from '../util.js';
import { ranked, typeNames, activeAccounts, people, T, getAccount, amtCurs } from '../model.js';
import {
  KIND_LABEL, PAY_WORD, debtStatus, debtTotals, upcomingInstallments, fixedRows, equalRows,
  findDebt, saveDebt, savePlanPayment, deletePlanPayment, deleteDebt, defaultPayDesc,
} from '../debts.js';
import { Icon, Sheet, Field, AmountField, CurSeg, Seg, Picker, Empty, Toggle } from '../components.js';
import { openSheet, closeSheet, replaceSheet, toast, ask } from '../ui.js';

// Kutulara "100.000,00" biçiminde yazılır; parseNum bunu doğru okur.
const fmtIn = (n) => (n ? num(Math.abs(n)) : '');
const sumStr = (arr) => round2(arr.reduce((s, x) => s + parseNum(x.amount), 0));

export function dueBadge(r, kind) {
  if (r.status === 'paid') return html`<span class="due-badge ok">${kind === 'alacak' ? 'Tahsil edildi' : 'Ödendi'}</span>`;
  if (r.days === null) return html`<span class="due-badge">Vade yok</span>`;
  if (r.days < 0) return html`<span class="due-badge late">${-r.days} gün gecikti</span>`;
  if (r.days === 0) return html`<span class="due-badge soon">Bugün</span>`;
  return html`<span class=${'due-badge ' + (r.days <= 7 ? 'soon' : '')}>${r.days} gün kaldı</span>`;
}

const kindTag = (kind) => html`<span class=${'kind-tag ' + kind}>${kind === 'borc' ? 'Borcum' : 'Alacağım'}</span>`;

/* =============================== Ödeme formu =============================== */

function PayForm({ debtId, payId, preset = {} }) {
  const d = findDebt(debtId);
  const p = payId ? d?.payments.find((x) => x.id === payId) : null;
  const st = d ? debtStatus(d) : null;
  const lastAcc = d?.payments.slice().reverse().find((x) => x.account)?.account || '';
  const [f, setF] = useState(() => ({
    date: p?.date || todayStr(),
    amount: p ? fmtIn(p.amount) : fmtIn(preset.amount),
    account: p ? p.account : preset.account ?? lastAcc,
    link: p ? !!p.account : true,
    desc: p?.desc || '',
  }));
  const [err, setErr] = useState({});
  const set = (patch) => setF((o) => ({ ...o, ...patch }));
  if (!d) return html`<${Sheet} title="Bulunamadı"><p>Bu kayıt silinmiş.</p></${Sheet}>`;
  const word = PAY_WORD[d.kind];

  const save = () => {
    const e = {};
    const amount = round2(parseNum(f.amount));
    if (!(amount > 0)) e.amount = 'Tutar girin';
    if (f.link && !f.account) e.account = 'Hesap seçin';
    setErr(e);
    if (Object.keys(e).length) return;
    savePlanPayment(d.id, { id: p?.id, txId: p?.txId, date: f.date, amount, account: f.link ? f.account : '', desc: f.desc });
    toast(`${word} kaydedildi`);
    closeSheet();
  };
  const remove = async () => {
    const ok = await ask({ title: `${word} silinsin mi?`, text: p.txId ? 'Ana kasaya işlenen kaydı da silinecek ve tutar tekrar borç/alacak bakiyesine eklenecek.' : '', ok: 'Sil', danger: true });
    if (!ok) return;
    deletePlanPayment(d.id, p.id);
    toast(`${word} silindi`);
    closeSheet();
  };

  const footer = html`${p && html`<button class="btn danger-ghost" onClick=${remove}><${Icon} name="trash" /> Sil</button>`}
    <span class="grow"></span><button class="btn primary big" onClick=${save}><${Icon} name="check" /> Kaydet</button>`;

  return html`<${Sheet} title=${`${p ? 'Düzenle: ' : ''}${word} – ${d.person}`} footer=${footer}>
    <div class="form">
      <div class="card pad">
        <b>${d.title}</b>
        <div class="muted">Kalan: <b>${money(st.remaining, d.cur)}</b>${st.next ? html` · Sıradaki taksit: <b>${money(st.next.rest, d.cur)}</b> (${fmtDate(st.next.due)})` : ''}</div>
      </div>
      <${AmountField} label=${`${word} tutarı (${CUR_LABEL[d.cur]})`} value=${f.amount} cur=${d.cur} onChange=${(v) => set({ amount: v })} error=${err.amount} autofocus=${!p} />
      <div class="chips">
        ${st.next && html`<button type="button" class="chip" onClick=${() => set({ amount: fmtIn(st.next.rest) })}>Sıradaki taksit: ${money(st.next.rest, d.cur)}</button>`}
        ${st.remaining > 0 && html`<button type="button" class="chip" onClick=${() => set({ amount: fmtIn(st.remaining) })}>Kalanın tamamı: ${money(st.remaining, d.cur)}</button>`}
      </div>
      <${Field} label="Tarih"><input type="date" value=${f.date} onInput=${(e) => set({ date: e.target.value || todayStr() })} /></${Field}>
      <${Toggle} label="Kasaya / hesaba işle" checked=${f.link} onChange=${(v) => set({ link: v })}
        hint=${d.kind === 'borc' ? 'Seçtiğiniz hesaptan düşer. Kredi kartı seçerseniz kartın borcuna eklenir.' : 'Seçtiğiniz hesaba girer.'} />
      ${f.link && html`<${Picker} label=${d.kind === 'borc' ? 'Hangi hesaptan / karttan ödendi?' : 'Para hangi hesaba girdi?'}
        items=${ranked('account', activeAccounts())} value=${f.account} onChange=${(v) => set({ account: v })} error=${err.account} top=${12} allowNew=${false} />`}
      ${f.link && d.cur !== 'TRY' && html`<p class="muted small">Not: Tutar ${CUR_LABEL[d.cur]} olarak işlenir; seçtiğiniz hesabın ${CUR_LABEL[d.cur]} bakiyesinden düşer.</p>`}
      <${Field} label="Açıklama (isteğe bağlı)"><input type="text" class="upper" value=${f.desc} placeholder=${defaultPayDesc(d)} onInput=${(e) => set({ desc: e.target.value })} /></${Field}>
    </div>
  </${Sheet}>`;
}

export const openPay = (debtId, payId = null, preset = {}) => openSheet(() => html`<${PayForm} debtId=${debtId} payId=${payId} preset=${preset} />`);

/* =============================== Plan formu =============================== */

function DebtForm({ id, preset = {} }) {
  const d = id ? findDebt(id) : null;
  const [f, setF] = useState(() => ({
    kind: d?.kind || preset.kind || 'borc', person: d?.person || preset.person || '', title: d?.title || '',
    cur: d?.cur || 'TRY', total: d ? fmtIn(d.total) : '', date: d?.date || todayStr(),
    type: d?.type || T.CARI, note: d?.note || '',
    down: [],
    schedule: d ? d.schedule.map((s) => ({ ...s, amount: fmtIn(s.amount) })) : [],
  }));
  const [gen, setGen] = useState({ count: '5', amount: '', first: addMonths(todayStr(), 1) });
  const [err, setErr] = useState({});
  const set = (patch) => setF((o) => ({ ...o, ...patch }));
  const names = useMemo(() => [...new Set([...people(), ...S.counters, ...S.debts.map((x) => x.person)])].sort((a, b) => a.localeCompare(b, 'tr')), []);
  const accounts = useMemo(() => ranked('account', activeAccounts()), []);
  const types = useMemo(() => ranked('type', typeNames().filter((t) => ![T.VIRMAN, T.KKODEME, T.DEVREDEN].includes(t))), []);

  const totalN = round2(parseNum(f.total));
  const downSum = sumStr(f.down);
  const schedSum = sumStr(f.schedule);
  const diff = round2(totalN - downSum - schedSum);
  const lastDue = f.schedule.map((s) => s.due).filter(Boolean).sort().pop();
  const toStr = (rows) => rows.map((r) => ({ ...r, amount: fmtIn(r.amount) }));
  const setSched = (rows) => set({ schedule: rows.slice().sort((a, b) => (a.due || '').localeCompare(b.due || '')) });

  const genEqual = () => {
    const n = parseInt(gen.count, 10);
    if (!(n > 0)) return toast('Taksit sayısı girin', 'err');
    const kept = f.schedule.filter((s) => s.due && s.due < gen.first);
    const base = round2(totalN - downSum - sumStr(kept));
    if (!(base > 0)) return toast('Bölünecek kalan tutar yok', 'err');
    setSched([...kept, ...toStr(equalRows(base, n, gen.first))]);
  };
  const genFixed = () => {
    const n = parseInt(gen.count, 10), a = parseNum(gen.amount);
    if (!(n > 0) || !(a > 0)) return toast('Taksit sayısı ve tutarı girin', 'err');
    const start = lastDue && lastDue >= gen.first ? addMonths(lastDue, 1) : gen.first;
    setSched([...f.schedule, ...toStr(fixedRows(n, a, start))]);
  };
  const addRest = () => {
    if (!(diff > 0)) return toast('Plana eklenecek kalan tutar yok', 'err');
    setSched([...f.schedule, ...toStr(fixedRows(1, diff, lastDue ? addMonths(lastDue, 1) : gen.first))]);
  };
  const addRow = () => setSched([...f.schedule, { id: '', due: lastDue ? addMonths(lastDue, 1) : gen.first, amount: '', label: '' }]);
  const updRow = (i, patch) => set({ schedule: f.schedule.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const delRow = (i) => set({ schedule: f.schedule.filter((_, j) => j !== i) });
  const updDown = (i, patch) => set({ down: f.down.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const save = async () => {
    const e = {};
    if (!(totalN > 0)) e.total = 'Toplam tutarı girin';
    if (!f.person) e.person = 'Kişi / firma seçin';
    setErr(e);
    if (Object.keys(e).length) return toast('Eksik bilgileri doldurun', 'err');
    if (Math.abs(diff) > 0.009) {
      const ok = await ask({
        title: 'Plan toplamı tutmuyor',
        text: diff > 0 ? `${money(diff, f.cur)} plana bağlanmamış (vadesi yok). Yine de kaydedilsin mi?` : `Plan, toplam tutardan ${money(-diff, f.cur)} fazla. Yine de kaydedilsin mi?`,
        ok: 'Yine de kaydet',
      });
      if (!ok) return;
    }
    const downRows = f.down.filter((x) => parseNum(x.amount) > 0);
    const schedule = [
      ...downRows.map((x) => ({ due: f.date, amount: parseNum(x.amount), label: 'PEŞİNAT' })),
      ...f.schedule.map((s) => ({ ...s, amount: parseNum(s.amount) })),
    ];
    const row = saveDebt({ ...(d || {}), ...f, total: totalN, schedule, payments: d?.payments || [] });
    for (const x of downRows) savePlanPayment(row.id, { date: f.date, amount: parseNum(x.amount), account: x.account });
    toast(d ? 'Kaydedildi' : `${KIND_LABEL[row.kind]} kaydedildi`);
    if (d) closeSheet();
    else replaceSheet(() => html`<${DebtSheet} id=${row.id} />`);
  };

  const footer = html`<span class="grow"></span><button class="btn primary big" onClick=${save}><${Icon} name="check" /> Kaydet</button>`;

  return html`<${Sheet} title=${d ? 'Borç / alacak düzenle' : 'Yeni borç / alacak'} footer=${footer}>
    <div class="form">
      ${!d && html`<${Field} label="Ne kaydediyorsunuz?">
        <${Seg} cls="seg-lg" value=${f.kind} onChange=${(v) => set({ kind: v })}
          options=${[['borc', 'Borcum var (ben ödeyeceğim)'], ['alacak', 'Alacağım var (bana ödenecek)']]} />
      </${Field}>`}
      <${Picker} label=${f.kind === 'borc' ? 'Kime borçlusunuz? (kişi / firma)' : 'Kim size borçlu? (kişi / firma)'} items=${names}
        value=${f.person} onChange=${(v) => set({ person: v })} error=${err.person} top=${10} newLabel="Yeni kişi / firma" />
      <${Field} label="Konu / açıklama" hint="Örn: FATURA 2026/145, ARABA ALIMI, ÇATI İŞİ">
        <input type="text" class="upper" value=${f.title} onInput=${(e) => set({ title: e.target.value })} />
      </${Field}>
      <div class="grid2">
        <${AmountField} label="Toplam tutar" value=${f.total} cur=${f.cur} onChange=${(v) => set({ total: v })} error=${err.total} autofocus=${!d} />
        <${Field} label="Para birimi"><${CurSeg} value=${f.cur} onChange=${(v) => set({ cur: v })} /></${Field}>
      </div>
      <${Field} label="Tarih"><input type="date" value=${f.date} onInput=${(e) => set({ date: e.target.value || todayStr() })} /></${Field}>

      ${!d && html`<section class="plan-box">
        <h4>Şimdi yapılan ödemeler / peşinat <small class="muted">(isteğe bağlı)</small></h4>
        <p class="muted small">Örn: 200.000 nakit (KASA) ve 100.000 kredi kartı ile ödendiyse iki satır ekleyin. Seçilen hesaptan düşülür.</p>
        ${f.down.map((x, i) => html`<div class="plan-row">
          <input type="text" inputmode="decimal" placeholder="Tutar" value=${x.amount} onInput=${(e) => updDown(i, { amount: e.target.value })} />
          <select value=${x.account} onChange=${(e) => updDown(i, { account: e.target.value })}>
            <option value="">— Hesaba işleme —</option>
            ${accounts.map((a) => html`<option value=${a}>${a}</option>`)}
          </select>
          <button type="button" class="icon-btn" onClick=${() => set({ down: f.down.filter((_, j) => j !== i) })} aria-label="Sil"><${Icon} name="x" /></button>
        </div>`)}
        <button type="button" class="btn sm" onClick=${() => set({ down: [...f.down, { amount: '', account: 'KASA' }] })}><${Icon} name="plus" /> Ödeme ekle</button>
      </section>`}

      <section class="plan-box">
        <h4>Taksit / vade planı</h4>
        <div class="plan-sum">
          <span>Toplam <b>${money(totalN, f.cur)}</b></span>
          ${downSum > 0 && html`<span>Peşinat <b>${money(downSum, f.cur)}</b></span>`}
          <span>Planlanan <b>${money(schedSum, f.cur)}</b></span>
          <span class=${Math.abs(diff) > 0.009 ? 'warn-text' : 'pos'}>${Math.abs(diff) <= 0.009 ? 'Plan tamam ✓' : diff > 0 ? `Plansız kalan: ${money(diff, f.cur)}` : `Fazla: ${money(-diff, f.cur)}`}</span>
        </div>
        <div class="gen-box">
          <div class="grid3">
            <${Field} label="Taksit sayısı"><input type="text" inputmode="numeric" value=${gen.count} onInput=${(e) => setGen({ ...gen, count: e.target.value })} /></${Field}>
            <${Field} label="Taksit tutarı"><input type="text" inputmode="decimal" placeholder="Sabit taksit için" value=${gen.amount} onInput=${(e) => setGen({ ...gen, amount: e.target.value })} /></${Field}>
            <${Field} label="İlk taksit tarihi"><input type="date" value=${gen.first} onInput=${(e) => setGen({ ...gen, first: e.target.value || addMonths(todayStr(), 1) })} /></${Field}>
          </div>
          <div class="row gap wrap">
            <button type="button" class="btn sm" onClick=${genFixed}><${Icon} name="plus" /> Sabit taksitleri ekle</button>
            <button type="button" class="btn sm" onClick=${genEqual}><${Icon} name="calendar" /> Kalanı eşit böl</button>
            <button type="button" class="btn sm" onClick=${addRest} disabled=${!(diff > 0)}>Kalanı son ödeme yap</button>
            <button type="button" class="btn sm ghost" onClick=${addRow}>Elle satır ekle</button>
          </div>
          <p class="muted small">Örnek: 5 taksit × 100.000 için "Sabit taksitleri ekle", sonra kalan 200.000'i son aya koymak için "Kalanı son ödeme yap".</p>
        </div>
        ${f.schedule.length > 0 && html`<div class="plan-list">
          ${f.schedule.map((s, i) => html`<div class="plan-row">
            <span class="plan-no">${i + 1}</span>
            <input type="date" value=${s.due} onInput=${(e) => updRow(i, { due: e.target.value })} />
            <input type="text" inputmode="decimal" value=${s.amount} onInput=${(e) => updRow(i, { amount: e.target.value })} />
            <button type="button" class="icon-btn" onClick=${() => delRow(i)} aria-label="Sil"><${Icon} name="x" /></button>
          </div>`)}
          <button type="button" class="btn sm ghost" onClick=${() => set({ schedule: [] })}>Planı temizle</button>
        </div>`}
      </section>

      <${Picker} label="Ödemeler kasaya hangi türle işlensin?" items=${types} value=${f.type} onChange=${(v) => set({ type: v })} top=${8}
        hint="CARİ türü gelir/gider raporlarına girmez. Örn. inşaat borcu ise EK BİNA seçerseniz ödemeler gider raporunda görünür." />
      <${Field} label="Not"><textarea rows="2" value=${f.note} onInput=${(e) => set({ note: e.target.value })}></textarea></${Field}>
    </div>
  </${Sheet}>`;
}

export const openDebtForm = (id = null, preset = {}) => openSheet(() => html`<${DebtForm} id=${id} preset=${preset} />`);

/* =============================== Detay =============================== */

function DebtSheet({ id }) {
  const d = findDebt(id);
  if (!d) return html`<${Sheet} title="Bulunamadı"><p>Bu kayıt silinmiş.</p></${Sheet}>`;
  const st = debtStatus(d);
  const word = PAY_WORD[d.kind];
  const pct = d.total ? Math.min(100, (st.paid / d.total) * 100) : 0;

  const remove = async () => {
    const ok = await ask({ title: 'Bu borç / alacak silinsin mi?', text: 'Plan ve ödeme geçmişi silinir.', ok: 'Sil', danger: true });
    if (!ok) return;
    const linked = d.payments.filter((p) => p.txId).length;
    const withTx = linked > 0 && await ask({
      title: `Kasaya işlenen ${linked} ödeme kaydı da silinsin mi?`,
      text: '"Hayır" derseniz ödemeler Kayıtlar\'da kalır ve hesap bakiyeleri değişmez.', ok: 'Evet, onları da sil', cancel: 'Hayır, kalsın',
    });
    deleteDebt(d.id, { withTx });
    toast('Silindi');
    closeSheet();
  };

  const footer = html`<button class="btn danger-ghost" onClick=${remove}><${Icon} name="trash" /> Sil</button>
    <span class="grow"></span>
    <button class="btn" onClick=${() => openDebtForm(d.id)}><${Icon} name="edit" /> Düzenle</button>
    ${!st.closed && html`<button class="btn primary big" onClick=${() => openPay(d.id, null, { amount: st.next?.rest ?? st.remaining })}>
      <${Icon} name=${d.kind === 'borc' ? 'out' : 'in'} /> ${d.kind === 'borc' ? 'Öde' : 'Tahsil et'}</button>`}`;

  return html`<${Sheet} title=${`${d.person}`} footer=${footer}>
    <div class="card pad debt-head">
      <div class="row gap">${kindTag(d.kind)}<b class="grow">${d.title}</b><small class="muted">${fmtDate(d.date)}</small></div>
      <div class="debt-big">
        <small>${st.closed ? (st.overpaid ? 'Fazla ödendi' : 'Kapandı') : 'Kalan'}</small>
        <span class=${d.kind === 'borc' ? 'neg' : 'pos'}>${money(st.closed ? st.overpaid : st.remaining, d.cur)}</span>
      </div>
      <span class="bar big"><span style=${`width:${pct}%`} class=${d.kind === 'alacak' ? 'green' : ''}></span></span>
      <div class="plan-sum">
        <span>Toplam <b>${money(d.total, d.cur)}</b></span>
        <span>${d.kind === 'borc' ? 'Ödenen' : 'Tahsil edilen'} <b>${money(st.paid, d.cur)}</b></span>
        ${st.unplanned > 0.004 && html`<span class="warn-text">Plansız: ${money(st.unplanned, d.cur)}</span>`}
      </div>
      ${d.note && html`<p class="muted">${d.note}</p>`}
    </div>

    <h3 class="sec-title">Taksitler / vadeler</h3>
    ${st.rows.length ? html`<div class="card list">
      ${st.rows.map((r) => html`<div class="inst-row">
        <span class="plan-no">${r.no}</span>
        <span class="grow"><b>${fmtDate(r.due) || '—'}</b>${r.label && html` <span class="tag">${r.label}</span>`}
          <small>${money(r.amount, d.cur)}${r.paid > 0 && r.rest > 0.004 ? ` · ${money(r.paid, d.cur)} ödendi, ${money(r.rest, d.cur)} kaldı` : ''}</small></span>
        ${dueBadge(r, d.kind)}
        ${st.next && st.next.id === r.id && html`<button class="btn primary sm" onClick=${() => openPay(d.id, null, { amount: r.rest })}>${d.kind === 'borc' ? 'Öde' : 'Tahsil et'}</button>`}
      </div>`)}
    </div>` : html`<p class="muted">Vade planı yok. "Düzenle" ile taksit ekleyebilirsiniz.</p>`}

    <h3 class="sec-title">${d.kind === 'borc' ? 'Yapılan ödemeler' : 'Yapılan tahsilatlar'}</h3>
    ${d.payments.length ? html`<div class="card list">
      ${d.payments.slice().reverse().map((p) => html`<button class="tx-row" onClick=${() => openPay(d.id, p.id)}>
        <span class=${'tx-badge' + (d.kind === 'alacak' ? ' in' : '')}><${Icon} name=${d.kind === 'borc' ? 'out' : 'in'} size=${18} /></span>
        <span class="tx-main"><span class="tx-desc">${p.desc || defaultPayDesc(d)}</span>
          <span class="tx-meta"><b>${fmtDate(p.date)}</b> · ${p.account ? p.account + (d.kind === 'borc' ? ' hesabından' : ' hesabına') : 'Kasaya işlenmedi'}</span></span>
        <span class="tx-amt"><span class=${d.kind === 'borc' ? 'neg' : 'pos'}>${money(p.amount, d.cur)}</span></span>
      </button>`)}
    </div>` : html`<p class="muted">Henüz ${word.toLocaleLowerCase('tr-TR')} yok.</p>`}
  </${Sheet}>`;
}

export const openDebt = (id) => openSheet(() => html`<${DebtSheet} id=${id} />`);

/* =============================== Sekme =============================== */

function DebtCard({ d, st }) {
  const pct = d.total ? Math.min(100, (st.paid / d.total) * 100) : 0;
  return html`<button class="acc-card debt-card" onClick=${() => openDebt(d.id)}>
    <span class="row gap">${kindTag(d.kind)}<b class="grow ellipsis">${d.person}</b></span>
    <span class="muted ellipsis">${d.title}</span>
    <span class="acc-line"><small>${st.closed ? 'Kapandı' : 'Kalan'}</small>
      <b class=${st.closed ? '' : d.kind === 'borc' ? 'neg' : 'pos'}>${money(st.closed ? 0 : st.remaining, d.cur)}</b></span>
    <span class="bar"><span style=${`width:${pct}%`} class=${d.kind === 'alacak' ? 'green' : ''}></span></span>
    <span class="acc-line"><small>Toplam ${money(d.total, d.cur)}</small>
      ${st.next?.due ? html`<small class=${st.next.days < 0 ? 'neg' : ''}>Sıradaki: ${fmtDate(st.next.due)}</small>` : null}</span>
  </button>`;
}

export function Debts() {
  const [show, setShow] = useState('open');
  const [kind, setKind] = useState('all');
  const all = useMemo(() => S.debts.map((d) => ({ d, st: debtStatus(d) })), [S.version]);
  const list = all.filter((x) => (show === 'open' ? !x.st.closed : x.st.closed) && (kind === 'all' || x.d.kind === kind))
    .sort((a, b) => (a.st.next?.due || '9999').localeCompare(b.st.next?.due || '9999'));
  const totals = useMemo(() => debtTotals(), [S.version]);
  const upcoming = useMemo(() => upcomingInstallments(30), [S.version]);
  const openCount = all.filter((x) => !x.st.closed).length;

  return html`<div class="page">
    <div class="toolbar">
      <${Seg} value=${kind} onChange=${setKind} options=${[['all', 'Tümü'], ['borc', 'Borçlarım'], ['alacak', 'Alacaklarım']]} />
      <${Seg} value=${show} onChange=${setShow} options=${[['open', `Açık (${openCount})`], ['closed', `Kapanan (${all.length - openCount})`]]} />
      <span class="grow"></span>
      <button class="btn primary" onClick=${() => openDebtForm()}><${Icon} name="plus" /> Yeni borç / alacak</button>
    </div>

    <div class="kpis two">
      <div class="kpi"><small>Toplam borcum (kalan)</small>
        ${amtCurs(totals.borc).length ? amtCurs(totals.borc).map((c) => html`<span class="lg neg">${money(totals.borc[c], c)}</span>`) : html`<span class="lg">—</span>`}</div>
      <div class="kpi"><small>Toplam alacağım (kalan)</small>
        ${amtCurs(totals.alacak).length ? amtCurs(totals.alacak).map((c) => html`<span class="lg pos">${money(totals.alacak[c], c)}</span>`) : html`<span class="lg">—</span>`}</div>
    </div>

    ${upcoming.length > 0 && html`<section>
      <h3 class="sec-title"><${Icon} name="bell" /> Önümüzdeki 30 gün ve gecikenler</h3>
      <div class="card list">${upcoming.map(({ d, r }) => html`<div class="pay-row">
        ${dueBadge(r, d.kind)}
        <button class="grow plain" onClick=${() => openDebt(d.id)}>
          <b>${d.person}</b><small>${d.title} · ${r.no}. taksit · ${fmtDate(r.due)} · ${d.kind === 'borc' ? 'Ödenecek' : 'Tahsil edilecek'}</small>
        </button>
        <b class=${'pay-amt ' + (d.kind === 'borc' ? 'neg' : 'pos')}>${money(r.rest, d.cur)}</b>
        <button class="btn primary" onClick=${() => openPay(d.id, null, { amount: r.rest })}>${d.kind === 'borc' ? 'Öde' : 'Tahsil et'}</button>
      </div>`)}</div>
    </section>`}

    ${list.length ? html`<h3 class="sec-title">${show === 'open' ? 'Açık borç ve alacaklar' : 'Kapanan borç ve alacaklar'}</h3>
      <div class="person-grid">${list.map(({ d, st }) => html`<${DebtCard} d=${d} st=${st} />`)}</div>`
      : html`<${Empty} icon="file" title=${show === 'open' ? 'Açık borç / alacak yok' : 'Kapanan kayıt yok'}
          text="Fatura, taksitli borç ya da birinden alacağınızı buraya ekleyin. Peşinatı, taksit planını ve ödemeleri ayrı ayrı takip edin; vadesi yaklaşınca ana sayfada hatırlatılır." >
          ${show === 'open' && html`<button class="btn primary" onClick=${() => openDebtForm()}><${Icon} name="plus" /> Yeni borç / alacak</button>`}
        </${Empty}>`}
  </div>`;
}
