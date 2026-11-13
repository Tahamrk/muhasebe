// Kayıt ekleme / düzenleme formu.
import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { S } from '../store.js';
import { CURS, CUR_LABEL, parseNum, round2, todayStr, addDays, upper, numRate, money } from '../util.js';
import {
  T, ranked, typeNames, activeAccounts, lastByDesc, counterForType, descSuggestions,
  saveTx, deleteTx, groupRows, txMode, amtCurs, balances, getAccount, emptyAmt, isReportType,
} from '../model.js';
import { Sheet, Seg, Field, AmountField, CurSeg, Picker, Icon, Money } from '../components.js';
import { openSheet, closeSheet, toast, ask } from '../ui.js';

const MODES = [
  ['gider', 'Gider', 'out'],
  ['gelir', 'Gelir', 'in'],
  ['transfer', 'Transfer', 'swap'],
  ['kkodeme', 'Kart Ödemesi', 'card'],
  ['doviz', 'Döviz / Altın', 'coins'],
];
const TITLES = { gider: 'Gider', gelir: 'Gelir', transfer: 'Hesaplar Arası Transfer', kkodeme: 'Kredi Kartı Ödemesi', doviz: 'Döviz / Altın Alım-Satım', serbest: 'Kayıt' };

/** Formu açar. tx: düzenlenecek kayıt, preset: başlangıç değerleri */
export function openEntry({ mode = 'gider', tx = null, preset = {} } = {}) {
  openSheet(() => html`<${EntryForm} initMode=${tx ? txMode(tx) : mode} tx=${tx} preset=${preset} />`);
}

const fmtIn = (n) => (n ? String(round2(Math.abs(n))).replace('.', ',') : '');

function initialState(mode, tx, preset) {
  const base = {
    date: todayStr(), amount: '', cur: 'TRY', type: '', counter: '', account: '', desc: '',
    from: '', to: '', side: 'sat', fxCur: 'USD', fxAmount: '', rate: '', tlAmount: '',
    grid: Object.fromEntries(CURS.map((c) => [c, { out: '', in: '' }])),
    ...preset,
  };
  if (!tx) {
    if (mode === 'transfer') base.desc ||= 'HESAPLARARASI TRANSFER';
    if (mode === 'kkodeme') base.desc ||= 'KREDİ KART ÖDEMESİ';
    if (mode === 'doviz') base.rate = base.rate || fmtIn(S.settings.rates.USD);
    return base;
  }
  const rows = groupRows(tx);
  const s = { ...base, date: tx.date, type: tx.type, counter: tx.counter, account: tx.account, desc: tx.desc };
  if (mode === 'gider' || mode === 'gelir') {
    const c = amtCurs(tx.amt)[0];
    s.cur = c; s.amount = fmtIn(tx.amt[c]);
  } else if (mode === 'transfer' || mode === 'kkodeme') {
    const out = rows.find((r) => amtCurs(r.amt).some((c) => r.amt[c] < 0)) || rows[0];
    const inn = rows.find((r) => r !== out) || rows[1];
    const c = amtCurs(out.amt)[0] || 'TRY';
    s.cur = c; s.amount = fmtIn(out.amt[c]); s.from = out.account; s.to = inn.account;
  } else if (mode === 'doviz') {
    const fx = amtCurs(tx.amt).find((c) => c !== 'TRY');
    s.fxCur = fx; s.side = tx.amt[fx] < 0 ? 'sat' : 'al';
    s.fxAmount = fmtIn(tx.amt[fx]); s.tlAmount = fmtIn(tx.amt.TRY);
    s.rate = fmtIn(Math.abs(tx.amt.TRY / tx.amt[fx]));
  } else {
    for (const c of CURS) {
      const v = tx.amt[c] || 0;
      s.grid[c] = { out: v < 0 ? fmtIn(v) : '', in: v > 0 ? fmtIn(v) : '' };
    }
  }
  return s;
}

function AccountHint({ name }) {
  if (!name) return null;
  const b = balances().get(name) || emptyAmt();
  const acc = getAccount(name);
  const parts = amtCurs(b).map((c) => money(b[c], c));
  if (acc.kind === 'kart') {
    return html`<span class="fhint">Kart borcu: <b>${money(Math.max(0, -b.TRY))}</b>
      ${acc.limit ? html` · Kullanılabilir limit: <b>${money(acc.limit + b.TRY)}</b>` : null}</span>`;
  }
  return html`<span class="fhint">Bakiye: <b>${parts.length ? parts.join(' · ') : '0,00 ₺'}</b></span>`;
}

function EntryForm({ initMode, tx, preset }) {
  const [mode, setMode] = useState(initMode);
  const [f, setF] = useState(() => initialState(initMode, tx, preset));
  const [err, setErr] = useState({});
  const [descTouched, setDescTouched] = useState(!!tx);
  const set = (patch) => setF((o) => ({ ...o, ...patch }));

  const accounts = useMemo(() => ranked('account', activeAccounts()), []);
  // Gelir/gider türleri önce; transfer, döviz gibi rapor dışı türler listenin sonunda ("Tümü" içinde).
  const types = useMemo(() => {
    const all = typeNames().filter((t) => ![T.VIRMAN, T.KKODEME, T.DEVREDEN].includes(t));
    return [...ranked('type', all.filter(isReportType)), ...ranked('type', all.filter((t) => !isReportType(t)))];
  }, []);
  const counters = useMemo(() => ranked('counter', S.counters), []);
  const descs = useMemo(() => descSuggestions(), []);
  const cards = accounts.filter((a) => getAccount(a).kind === 'kart');
  const nonCards = accounts.filter((a) => getAccount(a).kind !== 'kart');

  const switchMode = (m) => {
    if (m === mode) return;
    setErr({});
    setMode(m);
    setF((o) => {
      const n = { ...o };
      if (m === 'transfer' && !descTouched) n.desc = 'HESAPLARARASI TRANSFER';
      else if (m === 'kkodeme' && !descTouched) n.desc = 'KREDİ KART ÖDEMESİ';
      else if ((m === 'gider' || m === 'gelir') && !descTouched) n.desc = '';
      if (m === 'doviz' && !n.rate) n.rate = fmtIn(S.settings.rates[n.fxCur]);
      return n;
    });
  };

  const onDesc = (v) => {
    setDescTouched(true);
    const patch = { desc: v };
    const prev = lastByDesc(v);
    if (prev && !tx && (mode === 'gider' || mode === 'gelir')) {
      if (!f.type) patch.type = prev.type;
      if (!f.counter) patch.counter = prev.counter;
      if (!f.account) patch.account = prev.account;
    }
    set(patch);
  };
  const onType = (v) => {
    const patch = { type: v };
    if (!f.counter) patch.counter = counterForType(v);
    set(patch);
  };

  // Döviz hesapları
  const fxN = parseNum(f.fxAmount), rateN = parseNum(f.rate), tlN = parseNum(f.tlAmount);
  const onFx = (patch) => {
    const n = { ...f, ...patch };
    if ('fxCur' in patch) n.rate = fmtIn(S.settings.rates[patch.fxCur]);
    const a = parseNum(n.fxAmount), r = parseNum(n.rate);
    if (!('tlAmount' in patch)) n.tlAmount = a && r ? fmtIn(a * r) : '';
    else if (a) n.rate = fmtIn(parseNum(patch.tlAmount) / a);
    setF(n);
  };
  const fxType = f.fxCur === 'XAU' ? (f.side === 'sat' ? T.ALTIN_SATIS : T.ALTIN_ALIS) : (f.side === 'sat' ? T.DOVIZ_SATIS : T.DOVIZ_ALIS);
  const fxDesc = `${fxType} KUR ${numRate(rateN)}`;

  function buildRows() {
    const e = {};
    const amt = round2(parseNum(f.amount));
    const base = { date: f.date, desc: f.desc };
    let rows = [];
    if (mode === 'gider' || mode === 'gelir') {
      if (!(amt > 0)) e.amount = 'Tutar girin';
      if (!f.type) e.type = 'Tür seçin';
      if (!f.account) e.account = 'Hangi hesaptan/karttan?';
      rows = [{ ...base, type: f.type, counter: f.counter, account: f.account, amt: { [f.cur]: mode === 'gider' ? -amt : amt } }];
    } else if (mode === 'transfer' || mode === 'kkodeme') {
      if (!(amt > 0)) e.amount = 'Tutar girin';
      if (!f.from) e.from = 'Seçin';
      if (!f.to) e.to = 'Seçin';
      if (f.from && f.from === f.to) e.to = 'Aynı hesap olamaz';
      const type = mode === 'transfer' ? T.VIRMAN : T.KKODEME;
      rows = [
        { ...base, type, counter: 'BANKA', account: f.from, amt: { [f.cur]: -amt } },
        { ...base, type, counter: 'BANKA', account: f.to, amt: { [f.cur]: amt } },
      ];
    } else if (mode === 'doviz') {
      if (!(fxN > 0)) e.fxAmount = 'Miktar girin';
      if (!(tlN > 0)) e.tlAmount = 'TL tutarını girin';
      if (!f.account) e.account = 'Hesap seçin';
      const s = f.side === 'sat' ? 1 : -1;
      rows = [{ ...base, desc: descTouched && f.desc ? f.desc : fxDesc, type: fxType, counter: f.counter || 'BANKA', account: f.account,
        amt: { TRY: s * round2(tlN), [f.fxCur]: -s * round2(fxN) } }];
    } else {
      const a = {};
      for (const c of CURS) a[c] = round2(parseNum(f.grid[c].in) - parseNum(f.grid[c].out));
      if (!amtCurs(a).length) e.grid = 'En az bir tutar girin';
      if (!f.account) e.account = 'Hesap seçin';
      if (!f.type) e.type = 'Tür seçin';
      rows = [{ ...base, type: f.type, counter: f.counter, account: f.account, amt: a }];
    }
    setErr(e);
    return Object.keys(e).length ? null : rows;
  }

  function save(again = false) {
    const rows = buildRows();
    if (!rows) return;
    saveTx(rows, tx);
    toast(tx ? 'Kayıt güncellendi' : 'Kayıt eklendi');
    if (again) {
      setF((o) => ({ ...o, amount: '', desc: mode === 'gider' || mode === 'gelir' ? '' : o.desc, fxAmount: '', tlAmount: '' }));
      setDescTouched(false);
      setErr({});
    } else closeSheet();
  }

  async function remove() {
    const n = groupRows(tx).length;
    const ok = await ask({ title: 'Kayıt silinsin mi?', text: n > 1 ? `Bu işleme bağlı ${n} satır birlikte silinecek.` : 'Bu işlem geri alınamaz.', ok: 'Sil', danger: true });
    if (!ok) return;
    deleteTx(tx);
    toast('Kayıt silindi');
    closeSheet();
  }

  const showModeTabs = !tx || mode === 'gider' || mode === 'gelir';
  const tabs = tx ? MODES.filter(([m]) => m === 'gider' || m === 'gelir') : MODES;

  const DateRow = html`<${Field} label="Tarih">
    <div class="row gap wrap">
      <input type="date" value=${f.date} onInput=${(e) => set({ date: e.target.value || todayStr() })} class="date-in" />
      <button type="button" class=${'chip' + (f.date === todayStr() ? ' on' : '')} onClick=${() => set({ date: todayStr() })}>Bugün</button>
      <button type="button" class=${'chip' + (f.date === addDays(todayStr(), -1) ? ' on' : '')} onClick=${() => set({ date: addDays(todayStr(), -1) })}>Dün</button>
    </div>
  </${Field}>`;

  const DescRow = html`<${Field} label="Açıklama" hint=${mode === 'gider' && !tx ? 'Daha önce yazdığınız bir açıklamayı seçerseniz tür ve hesap kendiliğinden dolar.' : ''}>
    <input type="text" list="desc-list" class="upper" placeholder="Örn: BİM ALIŞVERİŞ" value=${f.desc}
      onInput=${(e) => onDesc(e.target.value)} />
    <datalist id="desc-list">${descs.map((d) => html`<option value=${d} />`)}</datalist>
  </${Field}>`;

  let body;
  if (mode === 'gider' || mode === 'gelir') {
    body = html`
      <div class="grid2">
        <${AmountField} value=${f.amount} cur=${f.cur} onChange=${(v) => set({ amount: v })} autofocus=${!tx} error=${err.amount} />
        <${Field} label="Para birimi"><${CurSeg} value=${f.cur} onChange=${(v) => set({ cur: v })} /></${Field}>
      </div>
      ${DescRow}
      <${Picker} label=${mode === 'gider' ? 'Gider türü' : 'Gelir türü'} items=${types} value=${f.type} onChange=${onType} error=${err.type} />
      <${Picker} label="Karşı hesap (kim / ne için)" items=${counters} value=${f.counter} onChange=${(v) => set({ counter: v })} top=${8} />
      <${Picker} label=${mode === 'gider' ? 'Ödeme nereden yapıldı?' : 'Para nereye girdi?'} items=${accounts} value=${f.account}
        onChange=${(v) => set({ account: v })} error=${err.account} top=${12} newLabel="Yeni hesap" />
      <${AccountHint} name=${f.account} />
      ${DateRow}`;
  } else if (mode === 'transfer' || mode === 'kkodeme') {
    const isCard = mode === 'kkodeme';
    const debt = isCard && f.to ? Math.max(0, -(balances().get(f.to)?.TRY || 0)) : 0;
    body = html`
      <${Picker} label=${isCard ? 'Ödeme yapılan hesap' : 'Hangi hesaptan?'} items=${isCard ? nonCards : accounts} value=${f.from}
        onChange=${(v) => set({ from: v })} error=${err.from} top=${12} allowNew=${!isCard} />
      <${AccountHint} name=${f.from} />
      <${Picker} label=${isCard ? 'Hangi kart ödendi?' : 'Hangi hesaba?'} items=${isCard ? cards : accounts} value=${f.to}
        onChange=${(v) => set({ to: v })} error=${err.to} top=${12} allowNew=${!isCard} />
      <${AccountHint} name=${f.to} />
      ${isCard && debt > 0 && html`<div class="row gap"><button type="button" class="chip" onClick=${() => set({ amount: fmtIn(debt), cur: 'TRY' })}>
        Borcun tamamı: ${money(debt)}</button></div>`}
      <div class="grid2">
        <${AmountField} value=${f.amount} cur=${f.cur} onChange=${(v) => set({ amount: v })} error=${err.amount} />
        ${!isCard && html`<${Field} label="Para birimi"><${CurSeg} value=${f.cur} onChange=${(v) => set({ cur: v })} /></${Field}>`}
      </div>
      ${DescRow}
      ${DateRow}`;
  } else if (mode === 'doviz') {
    body = html`
      <${Field} label="İşlem"><${Seg} value=${f.side} onChange=${(v) => set({ side: v })}
        options=${[['sat', 'Sattım (TL aldım)'], ['al', 'Aldım (TL verdim)']]} /></${Field}>
      <${Field} label="Ne?"><${Seg} value=${f.fxCur} onChange=${(v) => onFx({ fxCur: v })}
        options=${[['USD', '$ Dolar'], ['EUR', '€ Euro'], ['XAU', 'Altın (gr)']]} /></${Field}>
      <div class="grid3">
        <${AmountField} label=${f.fxCur === 'XAU' ? 'Miktar (gram)' : 'Miktar'} value=${f.fxAmount} cur=${f.fxCur} onChange=${(v) => onFx({ fxAmount: v })} error=${err.fxAmount} />
        <${Field} label="Kur (1 birim kaç TL)" hint=${S.settings.rates[f.fxCur] ? `Güncel: ${numRate(S.settings.rates[f.fxCur])}` : ''}>
          <input type="text" inputmode="decimal" value=${f.rate} onInput=${(e) => onFx({ rate: e.target.value })} />
        </${Field}>
        <${AmountField} label="TL karşılığı" value=${f.tlAmount} cur="TRY" onChange=${(v) => onFx({ tlAmount: v })} error=${err.tlAmount} />
      </div>
      <${Picker} label="Hangi hesapta?" items=${accounts} value=${f.account} onChange=${(v) => set({ account: v })} error=${err.account} top=${12} />
      <${AccountHint} name=${f.account} />
      <${Picker} label="Karşı hesap" items=${counters} value=${f.counter || 'BANKA'} onChange=${(v) => set({ counter: v })} top=${6} />
      <${Field} label="Açıklama" hint=${!descTouched ? 'Boş bırakırsanız: ' + fxDesc : ''}>
        <input type="text" class="upper" value=${descTouched ? f.desc : ''} placeholder=${fxDesc}
          onInput=${(e) => { setDescTouched(true); set({ desc: e.target.value }); }} />
      </${Field}>
      ${DateRow}`;
  } else {
    body = html`
      <p class="muted">Bu kayıtta birden fazla para birimi var. Her para birimi için giriş/çıkış tutarlarını düzenleyebilirsiniz.</p>
      <table class="grid-table">
        <thead><tr><th></th><th>Çıkış (Borç)</th><th>Giriş (Alacak)</th></tr></thead>
        <tbody>${CURS.map((c) => html`<tr><th>${CUR_LABEL[c]}</th>
          <td><input type="text" inputmode="decimal" value=${f.grid[c].out} onInput=${(e) => set({ grid: { ...f.grid, [c]: { ...f.grid[c], out: e.target.value } } })} /></td>
          <td><input type="text" inputmode="decimal" value=${f.grid[c].in} onInput=${(e) => set({ grid: { ...f.grid, [c]: { ...f.grid[c], in: e.target.value } } })} /></td></tr>`)}
        </tbody></table>
      ${err.grid && html`<span class="ferr">${err.grid}</span>`}
      ${DescRow}
      <${Picker} label="Tür" items=${ranked('type', typeNames())} value=${f.type} onChange=${(v) => set({ type: v })} error=${err.type} />
      <${Picker} label="Karşı hesap" items=${counters} value=${f.counter} onChange=${(v) => set({ counter: v })} top=${8} />
      <${Picker} label="Hesap" items=${accounts} value=${f.account} onChange=${(v) => set({ account: v })} error=${err.account} top=${12} />
      ${DateRow}`;
  }

  const footer = html`
    ${tx && html`<button type="button" class="btn danger-ghost" onClick=${remove}><${Icon} name="trash" /> Sil</button>`}
    <span class="grow"></span>
    ${!tx && html`<button type="button" class="btn" onClick=${() => save(true)}>Kaydet + Yeni</button>`}
    <button type="button" class="btn primary big" onClick=${() => save(false)}><${Icon} name="check" /> Kaydet</button>`;

  return html`<${Sheet} title=${(tx ? 'Düzenle: ' : 'Yeni ') + TITLES[mode]} footer=${footer}>
    ${showModeTabs && html`<div class="mode-tabs">
      ${tabs.map(([m, label, icon]) => html`<button type="button" class=${'mode-tab m-' + m + (mode === m ? ' on' : '')} onClick=${() => switchMode(m)}>
        <${Icon} name=${icon} /> ${label}</button>`)}
    </div>`}
    <form class="form" onSubmit=${(e) => { e.preventDefault(); save(false); }}>${body}</form>
  </${Sheet}>`;
}
