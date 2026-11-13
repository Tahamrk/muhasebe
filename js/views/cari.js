// Cari borç / alacak: kişilere verilen borçlar ve alınacaklar.
import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { S } from '../store.js';
import { CURS, CUR_LABEL, money, fmtDate, todayStr, parseNum, round2, upper } from '../util.js';
import { people, cariBalances, saveCari, deleteCari, amtCurs, emptyAmt, ranked, activeAccounts, T } from '../model.js';
import { Icon, Sheet, Field, AmountField, CurSeg, Seg, Picker, Empty, Money, Toggle } from '../components.js';
import { openSheet, closeSheet, toast, ask } from '../ui.js';

function CariForm({ entry, person, dir: initDir }) {
  const c0 = entry ? amtCurs(entry.amt)[0] || 'TRY' : 'TRY';
  const [f, setF] = useState(() => ({
    person: entry?.counter || person || '',
    dir: entry ? (entry.amt[c0] < 0 ? 'verdim' : 'aldim') : initDir || 'verdim',
    amount: entry ? String(Math.abs(entry.amt[c0])).replace('.', ',') : '',
    cur: c0, date: entry?.date || todayStr(), desc: entry?.desc || '',
    link: !!entry?.link, account: entry?.link ? entry.account : '',
  }));
  const [err, setErr] = useState({});
  const set = (patch) => setF((o) => ({ ...o, ...patch }));
  const names = useMemo(() => [...new Set([...people(), ...S.counters])].sort((a, b) => a.localeCompare(b, 'tr')), []);

  const save = () => {
    const e = {};
    const amt = round2(parseNum(f.amount));
    if (!f.person) e.person = 'Kişi seçin ya da yazın';
    if (!(amt > 0)) e.amount = 'Tutar girin';
    if (f.link && !f.account) e.account = 'Hesap seçin';
    setErr(e);
    if (Object.keys(e).length) return;
    saveCari({
      id: entry?.id, link: entry?.link, date: f.date, type: T.CARI, counter: f.person,
      account: f.link ? f.account : '', desc: f.desc || (f.dir === 'verdim' ? 'BORÇ VERİLDİ' : 'TAHSİL EDİLDİ / BORÇ ALINDI'),
      amt: { [f.cur]: f.dir === 'verdim' ? -amt : amt },
    }, { linkAccount: f.link ? f.account : null });
    toast('Cari hareket kaydedildi');
    closeSheet();
  };
  const remove = async () => {
    if (!(await ask({ title: 'Hareket silinsin mi?', text: entry.link ? 'Ana kasaya işlenen kaydı da silinecek.' : '', ok: 'Sil', danger: true }))) return;
    deleteCari(entry);
    closeSheet();
  };

  const footer = html`${entry && html`<button class="btn danger-ghost" onClick=${remove}><${Icon} name="trash" /> Sil</button>`}
    <span class="grow"></span><button class="btn primary big" onClick=${save}><${Icon} name="check" /> Kaydet</button>`;

  return html`<${Sheet} title=${entry ? 'Cari hareketi düzenle' : 'Yeni cari hareket'} footer=${footer}>
    <div class="form">
      <${Picker} label="Kişi" items=${names} value=${f.person} onChange=${(v) => set({ person: v })} error=${err.person} top=${12} newLabel="Yeni kişi" />
      <${Field} label="Ne oldu?">
        <${Seg} value=${f.dir} onChange=${(v) => set({ dir: v })} cls="seg-lg"
          options=${[['verdim', 'Ben verdim (bana borçlandı)'], ['aldim', 'Ben aldım (ödedi / borç aldım)']]} />
      </${Field}>
      <div class="grid2">
        <${AmountField} value=${f.amount} cur=${f.cur} onChange=${(v) => set({ amount: v })} error=${err.amount} autofocus=${!entry} />
        <${Field} label="Para birimi"><${CurSeg} value=${f.cur} onChange=${(v) => set({ cur: v })} /></${Field}>
      </div>
      <${Field} label="Açıklama"><input type="text" class="upper" value=${f.desc} placeholder="Örn: ARABA İÇİN BORÇ" onInput=${(e) => set({ desc: e.target.value })} /></${Field}>
      <${Field} label="Tarih"><input type="date" value=${f.date} onInput=${(e) => set({ date: e.target.value || todayStr() })} /></${Field}>
      <${Toggle} label="Ana kasaya da işle" hint="Para bir hesaptan çıktıysa ya da bir hesaba girdiyse açın; o hesabın bakiyesi de değişir."
        checked=${f.link} onChange=${(v) => set({ link: v })} />
      ${f.link && html`<${Picker} label=${f.dir === 'verdim' ? 'Para hangi hesaptan çıktı?' : 'Para hangi hesaba girdi?'}
        items=${ranked('account', activeAccounts())} value=${f.account} onChange=${(v) => set({ account: v })} error=${err.account} top=${12} allowNew=${false} />`}
    </div>
  </${Sheet}>`;
}

export const openCari = (opts = {}) => openSheet(() => html`<${CariForm} ...${opts} />`);

function balanceText(b) {
  const parts = amtCurs(b);
  if (!parts.length) return html`<span class="muted">Hesap kapalı</span>`;
  return parts.map((c) => b[c] < 0
    ? html`<span class="pos">Size borçlu: <b>${money(-b[c], c)}</b></span>`
    : html`<span class="neg">Siz borçlusunuz: <b>${money(b[c], c)}</b></span>`);
}

function PersonSheet({ name }) {
  const rows = S.cari.filter((c) => c.counter === name).slice().reverse();
  const b = cariBalances().get(name) || emptyAmt();
  return html`<${Sheet} title=${name}>
    <div class="card pad person-sum">${balanceText(b)}</div>
    <div class="row gap mt8">
      <button class="btn grow" onClick=${() => openCari({ person: name, dir: 'verdim' })}><${Icon} name="out" /> Verdim</button>
      <button class="btn grow" onClick=${() => openCari({ person: name, dir: 'aldim' })}><${Icon} name="in" /> Aldım</button>
    </div>
    <h3 class="sec-title">Hareketler</h3>
    <div class="card list">
      ${rows.map((c) => html`<button class="tx-row" onClick=${() => openCari({ entry: c })}>
        <span class="tx-main"><span class="tx-desc">${c.desc}</span>
          <span class="tx-meta"><b>${fmtDate(c.date)}</b>${c.link ? ' · ' + c.account + ' hesabına işlendi' : ''}</span></span>
        <span class="tx-amt">${amtCurs(c.amt).map((k) => html`<span class=${c.amt[k] < 0 ? 'neg' : 'pos'}>${c.amt[k] < 0 ? 'Verildi ' : 'Alındı '}${money(Math.abs(c.amt[k]), k)}</span>`)}</span>
      </button>`)}
      ${!rows.length && html`<p class="muted pad">Hareket yok.</p>`}
    </div>
  </${Sheet}>`;
}

export function Cari() {
  const [showClosed, setShowClosed] = useState(false);
  const bals = useMemo(() => cariBalances(), [S.version]);
  const list = people().map((name) => ({ name, b: bals.get(name) || emptyAmt() }));
  const openList = list.filter((p) => amtCurs(p.b).length);
  const closed = list.filter((p) => !amtCurs(p.b).length);
  const owed = emptyAmt(), owe = emptyAmt();
  for (const p of list) for (const c of CURS) { if (p.b[c] < 0) owed[c] -= p.b[c]; else owe[c] += p.b[c]; }

  return html`<div class="page">
    <div class="toolbar">
      <span class="grow"></span>
      <button class="btn primary" onClick=${() => openCari()}><${Icon} name="plus" /> Yeni hareket</button>
    </div>
    <div class="kpis two">
      <div class="kpi"><small>Bana borçlu olanlar</small>
        ${amtCurs(owed).length ? amtCurs(owed).map((c) => html`<span class="lg pos">${money(owed[c], c)}</span>`) : html`<span class="lg">—</span>`}</div>
      <div class="kpi"><small>Benim borçlarım</small>
        ${amtCurs(owe).length ? amtCurs(owe).map((c) => html`<span class="lg neg">${money(owe[c], c)}</span>`) : html`<span class="lg">—</span>`}</div>
    </div>
    ${!list.length && html`<${Empty} icon="users" title="Cari hesap yok"
      text="Birine borç verdiğinizde ya da birinden borç aldığınızda 'Yeni hareket' ile kaydedin. Kişi bazında kimin ne kadar borçlu olduğunu buradan takip edersiniz." />`}
    ${openList.length > 0 && html`<h3 class="sec-title">Açık hesaplar (${openList.length})</h3>`}
    <div class="person-grid">
      ${openList.map((p) => html`<button class="acc-card" onClick=${() => openSheet(() => html`<${PersonSheet} name=${p.name} />`)}>
        <span class="acc-head"><${Icon} name="users" size=${20} /><b>${p.name}</b></span>
        <span class="person-bal">${balanceText(p.b)}</span>
      </button>`)}
    </div>
    ${closed.length > 0 && html`<button class="btn mt24" onClick=${() => setShowClosed(!showClosed)}>
      Kapanmış hesaplar (${closed.length}) <${Icon} name=${showClosed ? 'x' : 'down'} /></button>`}
    ${showClosed && html`<div class="person-grid mt8">${closed.map((p) => html`<button class="acc-card" onClick=${() => openSheet(() => html`<${PersonSheet} name=${p.name} />`)}>
      <span class="acc-head"><b>${p.name}</b></span><span class="muted">Hesap kapalı</span></button>`)}</div>`}
  </div>`;
}
