// Yaklaşan ödemeler: kart son ödeme tarihleri, kira, taksitler...
import { html, useState } from '../../vendor/preact-htm.js';
import { S } from '../store.js';
import { money, fmtDate, todayStr, daysBetween, parseNum, round2, addMonths, CUR_LABEL } from '../util.js';
import { savePayment, markPaid, deletePayment, getAccount, activeAccounts, ranked } from '../model.js';
import { Icon, Sheet, Field, AmountField, CurSeg, Seg, Empty } from '../components.js';
import { openSheet, closeSheet, replaceSheet, toast, ask } from '../ui.js';
import { openEntry } from './entryForm.js';

function PaymentForm({ p }) {
  const [f, setF] = useState(() => ({
    name: p?.name || '', amount: p?.amount ? String(p.amount).replace('.', ',') : '', cur: p?.cur || 'TRY',
    due: p?.due || todayStr(), repeat: p?.repeat || 'none', note: p?.note || '', account: p?.account || '',
  }));
  const [err, setErr] = useState({});
  const set = (patch) => setF((o) => ({ ...o, ...patch }));

  const save = () => {
    const e = {};
    if (!f.name.trim()) e.name = 'Ödeme adını yazın';
    setErr(e);
    if (Object.keys(e).length) return;
    savePayment({ ...p, ...f, amount: round2(parseNum(f.amount)), paid: p?.paid && f.due === p.due ? p.paid : false });
    toast('Ödeme kaydedildi');
    closeSheet();
  };
  const remove = async () => {
    if (!(await ask({ title: 'Ödeme silinsin mi?', ok: 'Sil', danger: true }))) return;
    deletePayment(p);
    closeSheet();
  };

  const footer = html`${p && html`<button class="btn danger-ghost" onClick=${remove}><${Icon} name="trash" /> Sil</button>`}
    <span class="grow"></span><button class="btn primary big" onClick=${save}><${Icon} name="check" /> Kaydet</button>`;

  return html`<${Sheet} title=${p ? 'Ödemeyi düzenle' : 'Yeni ödeme'} footer=${footer}>
    <div class="form">
      <${Field} label="Ödeme adı" error=${err.name}>
        <input type="text" class="upper" placeholder="Örn: WINGS KART, EV KİRA, SİNPAŞ TAKSİT" value=${f.name} onInput=${(e) => set({ name: e.target.value })} />
      </${Field}>
      <div class="grid2">
        <${AmountField} label="Miktar" value=${f.amount} cur=${f.cur} onChange=${(v) => set({ amount: v })} />
        <${Field} label="Para birimi"><${CurSeg} value=${f.cur} onChange=${(v) => set({ cur: v })} /></${Field}>
      </div>
      <div class="grid2">
        <${Field} label="Son ödeme tarihi"><input type="date" value=${f.due} onInput=${(e) => set({ due: e.target.value })} /></${Field}>
        <${Field} label="Tekrar"><${Seg} value=${f.repeat} onChange=${(v) => set({ repeat: v })} options=${[['none', 'Tek sefer'], ['monthly', 'Her ay']]} /></${Field}>
      </div>
      <${Field} label="Bağlı kart / hesap (isteğe bağlı)" hint="Kart seçerseniz 'Ödendi' dediğinizde kart ödemesi formu hazır gelir.">
        <select value=${f.account} onChange=${(e) => set({ account: e.target.value })}>
          <option value="">— Yok —</option>
          ${ranked('account', activeAccounts()).map((a) => html`<option value=${a}>${a}</option>`)}
        </select>
      </${Field}>
      <${Field} label="Not"><textarea rows="2" value=${f.note} onInput=${(e) => set({ note: e.target.value })}></textarea></${Field}>
    </div>
  </${Sheet}>`;
}

export const openPayment = (p) => openSheet(() => html`<${PaymentForm} p=${p} />`);

async function pay(p) {
  const ok = await ask({
    title: `${p.name} ödendi olarak işaretlensin mi?`,
    text: p.repeat === 'monthly' ? `Son ödeme tarihi bir sonraki aya (${fmtDate(addMonths(p.due, 1))}) taşınacak.` : '',
    ok: 'Ödendi',
  });
  if (!ok) return;
  markPaid(p);
  const addTx = await ask({ title: 'Bu ödemeyi kasaya da işleyelim mi?', text: 'Ödeme kaydını şimdi ekleyebilirsiniz.', ok: 'Evet, kayıt ekle', cancel: 'Hayır' });
  if (!addTx) return toast('Ödendi olarak işaretlendi');
  const amount = p.amount ? String(p.amount).replace('.', ',') : '';
  if (p.account && getAccount(p.account).kind === 'kart') openEntry({ mode: 'kkodeme', preset: { to: p.account, amount, cur: p.cur } });
  else openEntry({ mode: 'gider', preset: { amount, cur: p.cur, desc: p.name } });
}

export function Payments() {
  const [show, setShow] = useState('open');
  const today = todayStr();
  const open = S.payments.filter((p) => !p.paid).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const done = S.payments.filter((p) => p.paid).sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || ''));
  const list = show === 'open' ? open : done;
  const totals = {};
  open.forEach((p) => (totals[p.cur] = (totals[p.cur] || 0) + p.amount));

  return html`<div class="page">
    <div class="toolbar">
      <${Seg} value=${show} onChange=${setShow} options=${[['open', `Bekleyen (${open.length})`], ['done', `Ödenenler (${done.length})`]]} />
      <span class="grow"></span>
      <button class="btn primary" onClick=${() => openPayment(null)}><${Icon} name="plus" /> Yeni ödeme</button>
    </div>
    ${show === 'open' && open.length > 0 && html`<div class="totals card">
      <div><small>Bekleyen ödeme toplamı</small>${Object.entries(totals).map(([c, v]) => html`<b>${money(v, c)}</b>`)}</div>
    </div>`}
    ${!list.length ? html`<${Empty} icon="calendar" title=${show === 'open' ? 'Bekleyen ödeme yok' : 'Ödenen yok'}
      text="Kart son ödeme tarihlerini, kira ve taksitleri buraya ekleyin; tarihi yaklaşınca ana sayfada uyarı görürsünüz." />` : null}
    <div class="card list">
      ${list.map((p) => {
        const d = p.due ? daysBetween(today, p.due) : null;
        return html`<div class="pay-row">
          ${!p.paid ? html`<span class=${'due-badge ' + (d === null ? '' : d < 0 ? 'late' : d <= 3 ? 'soon' : '')}>
            ${d === null ? 'Tarih yok' : d < 0 ? `${-d} gün gecikti` : d === 0 ? 'Bugün' : `${d} gün kaldı`}</span>`
            : html`<span class="due-badge ok">Ödendi</span>`}
          <button class="grow plain" onClick=${() => openPayment(p)}>
            <b>${p.name}</b>
            <small>${p.due ? fmtDate(p.due) : ''}${p.repeat === 'monthly' ? ' · Her ay' : ''}${p.account ? ' · ' + p.account : ''}${p.paidAt ? ' · Son ödeme: ' + fmtDate(p.paidAt) : ''}</small>
            ${p.note && html`<small class="note">${p.note}</small>`}
          </button>
          <b class="pay-amt">${p.amount ? money(p.amount, p.cur) : '—'}</b>
          ${!p.paid && html`<button class="btn primary" onClick=${() => pay(p)}><${Icon} name="check" /> Ödendi</button>`}
        </div>`;
      })}
    </div>
  </div>`;
}
