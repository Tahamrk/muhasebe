// Kayıtlar listesi: arama, filtreler, dönem toplamları.
import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { S } from '../store.js';
import { CURS, CUR_LABEL, PERIODS, periodRange, inRange, longDate, upper, money, fmtDate } from '../util.js';
import { emptyAmt, addAmt, roundAmt, amtCurs, ranked, typeNames, T } from '../model.js';
import { Icon, Money, Seg, Empty } from '../components.js';
import { openEntry } from './entryForm.js';

const KIND_ICON = { [T.VIRMAN]: 'swap', [T.KKODEME]: 'card' };

export function TxRow({ t, showDate = false }) {
  const cs = amtCurs(t.amt);
  return html`<button class="tx-row" onClick=${() => openEntry({ tx: t })}>
    <span class=${'tx-badge' + (cs.some((c) => t.amt[c] > 0) && !cs.some((c) => t.amt[c] < 0) ? ' in' : cs.some((c) => t.amt[c] > 0) ? ' mix' : '')}>
      <${Icon} name=${KIND_ICON[t.type] || (/DÖVİZ|ALTIN/.test(t.type) ? 'coins' : cs.some((c) => t.amt[c] > 0) ? 'in' : 'out')} size=${18} />
    </span>
    <span class="tx-main">
      <span class="tx-desc">${t.desc || t.type}</span>
      <span class="tx-meta">${showDate && html`<b>${fmtDate(t.date)}</b> · `}<span class="tag">${t.type}</span> ${t.counter} · ${t.account}</span>
    </span>
    <span class="tx-amt">${cs.map((c) => html`<${Money} v=${t.amt[c]} cur=${c} sign />`)}</span>
  </button>`;
}

export function Entries({ params }) {
  const [period, setPeriod] = useState(params.period || (params.account || params.type || params.counter ? 'all' : 'thisMonth'));
  const [custom, setCustom] = useState({ from: params.from || '', to: params.to || '' });
  const [q, setQ] = useState('');
  const [type, setType] = useState(params.type || '');
  const [counter, setCounter] = useState(params.counter || '');
  const [account, setAccount] = useState(params.account || '');
  const [limit, setLimit] = useState(150);
  const [showFilters, setShowFilters] = useState(!!(params.type || params.counter || params.account));

  const range = periodRange(period, custom);
  const qq = upper(q);
  const rows = useMemo(() => S.tx.filter((t) => inRange(t.date, range)
    && (!type || t.type === type) && (!counter || t.counter === counter) && (!account || t.account === account)
    && (!qq || t.desc.includes(qq) || t.type.includes(qq) || t.counter.includes(qq) || t.account.includes(qq)
      || String(Math.abs(t.amt.TRY)).includes(q.replace(',', '.')))), [S.version, period, custom.from, custom.to, qq, type, counter, account]);

  const totals = useMemo(() => {
    const out = emptyAmt(), inn = emptyAmt();
    for (const t of rows) for (const c of CURS) { const v = t.amt[c] || 0; if (v < 0) out[c] -= v; else inn[c] += v; }
    roundAmt(out); roundAmt(inn);
    return { out, inn, curs: CURS.filter((c) => out[c] || inn[c]) };
  }, [rows]);

  // En yeni üstte; günlere göre gruplu
  const groups = useMemo(() => {
    const list = rows.slice().reverse().slice(0, limit);
    const g = [];
    for (const t of list) {
      if (!g.length || g[g.length - 1].date !== t.date) g.push({ date: t.date, items: [], sum: emptyAmt() });
      const last = g[g.length - 1];
      last.items.push(t);
      addAmt(last.sum, t.amt);
    }
    return g;
  }, [rows, limit]);

  const active = [type, counter, account].filter(Boolean).length;
  const clear = () => { setType(''); setCounter(''); setAccount(''); setQ(''); };

  return html`<div class="page">
    <div class="toolbar">
      <div class="search grow"><${Icon} name="search" size=${20} />
        <input type="search" placeholder="Ara: açıklama, tür, hesap, tutar..." value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <button class=${'btn' + (active ? ' primary-ghost' : '')} onClick=${() => setShowFilters(!showFilters)}>
        <${Icon} name="filter" /> Filtre${active ? ` (${active})` : ''}</button>
    </div>
    <div class="period-bar">
      <select value=${period} onChange=${(e) => setPeriod(e.target.value)} class="period-select">
        ${PERIODS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
      </select>
      ${period === 'custom' && html`<input type="date" value=${custom.from} onInput=${(e) => setCustom({ ...custom, from: e.target.value })} />
        <span>–</span><input type="date" value=${custom.to} onInput=${(e) => setCustom({ ...custom, to: e.target.value })} />`}
    </div>
    ${showFilters && html`<div class="filters card">
      <label>Tür<select value=${type} onChange=${(e) => setType(e.target.value)}><option value="">Tümü</option>
        ${ranked('type', typeNames()).map((x) => html`<option value=${x}>${x}</option>`)}</select></label>
      <label>Karşı hesap<select value=${counter} onChange=${(e) => setCounter(e.target.value)}><option value="">Tümü</option>
        ${ranked('counter', S.counters).map((x) => html`<option value=${x}>${x}</option>`)}</select></label>
      <label>Hesap<select value=${account} onChange=${(e) => setAccount(e.target.value)}><option value="">Tümü</option>
        ${ranked('account', S.accounts.map((a) => a.name)).map((x) => html`<option value=${x}>${x}</option>`)}</select></label>
      ${(active > 0 || q) && html`<button class="btn" onClick=${clear}><${Icon} name="x" /> Temizle</button>`}
    </div>`}

    <div class="totals card">
      <div><small>Kayıt</small><b>${rows.length}</b></div>
      ${totals.curs.length ? totals.curs.map((c) => html`<div class="tot-cur">
        <small>${CUR_LABEL[c]}</small>
        <span class="neg">Çıkış ${money(totals.out[c], c)}</span>
        <span class="pos">Giriş ${money(totals.inn[c], c)}</span>
        <b>Fark <${Money} v=${totals.inn[c] - totals.out[c]} cur=${c} /></b>
      </div>`) : html`<div><small>Toplam</small><b>—</b></div>`}
    </div>

    ${!rows.length ? html`<${Empty} icon="list" title="Kayıt bulunamadı" text="Seçili dönemde ya da filtrelerde kayıt yok." />` : null}
    ${groups.map((g) => html`<section class="day">
      <h4 class="day-head"><span>${longDate(g.date)}</span>
        <span>${amtCurs(g.sum).map((c) => html`<${Money} v=${g.sum[c]} cur=${c} sign />`)}</span></h4>
      <div class="card list">${g.items.map((t) => html`<${TxRow} t=${t} />`)}</div>
    </section>`)}
    ${rows.length > limit && html`<button class="btn wide" onClick=${() => setLimit(limit + 300)}>Daha fazla göster (${rows.length - limit} kayıt daha)</button>`}

    <button class="fab" onClick=${() => openEntry({ mode: 'gider' })} aria-label="Yeni kayıt"><${Icon} name="plus" size=${30} /></button>
  </div>`;
}
