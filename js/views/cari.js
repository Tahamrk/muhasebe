// Cariler: babamın "Cariler" Excel'i düzeninde firma bazında borç / alacak defteri.
import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { S } from '../store.js';
import { CURS, CUR_LABEL, money, num, fmtDate, todayStr, parseNum, round2, upper, daysBetween } from '../util.js';
import {
  people, getFirm, saveFirm, deleteFirm, firmLedger, cariOpen, cariDue, saveCari, deleteCari, markCariPaid,
  amtCurs, emptyAmt, ranked, activeAccounts, T, RISKS, FIS_TYPES,
} from '../model.js';
import { Icon, Sheet, Field, AmountField, CurSeg, Seg, Picker, Empty, Toggle } from '../components.js';
import { openSheet, closeSheet, replaceSheet, toast, ask } from '../ui.js';

const GROUP_LABEL = { alacak: 'Alacak carisi', borc: 'Borç carisi' };
const fmtIn = (n) => (n ? num(Math.abs(n)) : '');

/* Firma grubuna göre "ne oldu?" seçenekleri. verdim = ALACAK sütunu, aldim = BORÇ sütunu. */
const DIRS = {
  alacak: [['verdim', 'Alacak yaz (fatura kestim / borç verdim)'], ['aldim', 'Tahsilat (bana ödedi)']],
  borc: [['aldim', 'Borç yaz (fatura geldi / borç aldım)'], ['verdim', 'Ödeme yaptım']],
};
const AUTO_FIS = { alacak: { verdim: 'FATURA', aldim: 'TAHSİLAT' }, borc: { aldim: 'FATURA', verdim: 'ÖDEME' } };
const ACTION = {
  alacak: [['verdim', 'Alacak yaz', 'plus'], ['aldim', 'Tahsilat', 'in']],
  borc: [['aldim', 'Borç yaz', 'plus'], ['verdim', 'Ödeme yaptım', 'out']],
};

/** Kalan süre rozeti (vadesi olan ve kapanmamış satırlar için). */
export function remainBadge(c, today = todayStr()) {
  if (!cariOpen(c)) return null;
  const d = daysBetween(today, c.due);
  if (d < 0) return html`<span class="due-badge late">${-d} gün geçti</span>`;
  if (d === 0) return html`<span class="due-badge soon">Bugün</span>`;
  return html`<span class=${'due-badge ' + (d <= 7 ? 'soon' : '')}>${d} gün</span>`;
}

const statusOf = (c) => c.status || (c.due ? 'ÖDENMEDİ' : '');
const statusCls = (s) => (s === 'ÖDENDİ' || s === 'MAHSUP' ? 'pos' : s === 'ÖDENMEDİ' ? 'neg' : '');
const riskTag = (risk) => html`<span class=${'kind-tag ' + (risk === 'SIKINTILI' ? 'borc' : 'ok')}>${risk || 'NORMAL'}</span>`;
const groupTag = (g) => html`<span class=${'kind-tag ' + g}>${GROUP_LABEL[g]}</span>`;

/** Bakiye: artı = firma bize borçlu, eksi = biz borçluyuz (babamın Excel'indeki gibi). */
function BalText({ v, cur }) {
  if (Math.abs(v) < 0.005) return html`<span class="muted">${money(0, cur)}</span>`;
  return html`<span class=${v > 0 ? 'pos' : 'neg'}>${money(v, cur)}</span>`;
}

/* =============================== Hareket formu =============================== */

function CariForm({ entry, person, dir: initDir }) {
  const c0 = entry ? amtCurs(entry.amt)[0] || 'TRY' : null;
  const firm0 = (entry?.counter || person) ? getFirm(entry?.counter || person) : null;
  const [f, setF] = useState(() => {
    const group = firm0?.group || 'alacak';
    const dir = entry ? (entry.amt[c0] < 0 ? 'verdim' : 'aldim') : initDir || DIRS[group][0][0];
    return {
      person: entry?.counter || person || '', group, dir,
      amount: entry ? fmtIn(entry.amt[c0]) : '',
      cur: c0 || firm0?.cur || 'TRY', date: entry?.date || todayStr(), desc: entry?.desc || '',
      fis: entry ? entry.fis || '' : AUTO_FIS[group][dir], fisAuto: !entry,
      due: entry?.due || '', status: entry?.status || '', paidOn: entry?.paidOn || '',
      link: !!entry?.link, account: entry?.link ? entry.account : '',
    };
  });
  const [err, setErr] = useState({});
  const set = (patch) => setF((o) => ({ ...o, ...patch }));
  const names = useMemo(() => people(), []);
  const known = S.firms.some((x) => x.name === f.person);
  const group = f.group;
  // Ödeme / tahsilat girilirken kapatılacak vadeli satırlar
  const [closes, setCloses] = useState([]);
  const isPay = f.dir === (group === 'borc' ? 'verdim' : 'aldim');
  const openRows = !entry && isPay && f.person
    ? S.cari.filter((c) => c.counter === f.person && cariOpen(c) && (c.amt[f.cur] || 0) * (group === 'borc' ? 1 : -1) > 0)
    : [];
  const toggleClose = (c) => {
    const next = closes.includes(c.id) ? closes.filter((x) => x !== c.id) : [...closes, c.id];
    setCloses(next);
    const sum = round2(S.cari.filter((x) => next.includes(x.id)).reduce((s, x) => s + Math.abs(x.amt[f.cur] || 0), 0));
    set({ amount: fmtIn(sum) });
  };

  const pickPerson = (v) => {
    const fm = getFirm(v);
    const patch = { person: v, group: fm.group };
    if (!entry) {
      patch.cur = fm.cur;
      patch.dir = DIRS[fm.group].some(([d]) => d === f.dir) ? f.dir : DIRS[fm.group][0][0];
      if (f.fisAuto) patch.fis = AUTO_FIS[fm.group][patch.dir];
    }
    set(patch);
  };
  const setGroup = (g) => set({ group: g, ...(f.fisAuto ? { fis: AUTO_FIS[g][f.dir] } : {}) });
  const setDir = (d) => set({ dir: d, ...(f.fisAuto ? { fis: AUTO_FIS[group][d] } : {}) });

  const save = () => {
    const e = {};
    const amt = round2(parseNum(f.amount));
    if (!f.person) e.person = 'Firma seçin ya da yazın';
    if (!(amt > 0)) e.amount = 'Tutar girin';
    if (f.link && !f.account) e.account = 'Hesap seçin';
    setErr(e);
    if (Object.keys(e).length) return;
    if (!known) saveFirm({ ...getFirm(f.person), group, cur: f.cur });
    const fisWord = f.fis || (f.dir === 'verdim' ? (group === 'borc' ? 'ÖDEME' : 'ALACAK') : (group === 'borc' ? 'BORÇ' : 'TAHSİLAT'));
    const closing = openRows.filter((c) => closes.includes(c.id));
    const autoDesc = closing.length ? `${closing.map((c) => c.desc).join(', ')} ${group === 'borc' ? 'ÖDEMESİ' : 'TAHSİLATI'}` : fisWord;
    saveCari({
      id: entry?.id, link: entry?.link, created: entry?.created, date: f.date, type: entry?.type || T.CARI, counter: f.person,
      account: f.link ? f.account : '', desc: f.desc || autoDesc,
      amt: { [f.cur]: f.dir === 'verdim' ? -amt : amt },
      fis: f.fis, due: f.due, status: f.status || (f.due ? 'ÖDENMEDİ' : ''),
      paidOn: f.status === 'ÖDENDİ' ? f.paidOn || todayStr() : '',
    }, { linkAccount: f.link ? f.account : null });
    if (closing.length) markCariPaid(closing.map((c) => c.id), f.date);
    toast(closing.length ? `Kaydedildi; ${closing.length} vade "ödendi" yapıldı` : 'Cari hareket kaydedildi');
    closeSheet();
  };
  const remove = async () => {
    if (!(await ask({ title: 'Hareket silinsin mi?', text: entry.link ? 'Ana kasaya işlenen kaydı da silinecek.' : '', ok: 'Sil', danger: true }))) return;
    deleteCari(entry);
    closeSheet();
  };

  const footer = html`${entry && html`<button class="btn danger-ghost" onClick=${remove}><${Icon} name="trash" /> Sil</button>`}
    <span class="grow"></span><button class="btn primary big" onClick=${save}><${Icon} name="check" /> Kaydet</button>`;
  const col = f.dir === 'verdim' ? 'ALACAK' : 'BORÇ';

  return html`<${Sheet} title=${entry ? 'Cari hareketi düzenle' : 'Yeni cari hareket'} footer=${footer}>
    <div class="form">
      <${Picker} label="Firma / kişi" items=${names} value=${f.person} onChange=${pickPerson} error=${err.person} top=${12} newLabel="Yeni firma" />
      ${f.person && !known && html`<${Field} label="Bu firma hangi listede dursun?" hint="Sonradan firma bilgilerinden değiştirebilirsiniz.">
        <${Seg} value=${group} onChange=${setGroup} cls="seg-lg"
          options=${[['alacak', 'Alacak carisi (bana borçlu)'], ['borc', 'Borç carisi (ben borçluyum)']]} />
      </${Field}>`}
      <${Field} label="Ne oldu?" hint=${`Excel'de ${col} sütununa yazılır.`}>
        <${Seg} value=${f.dir} onChange=${setDir} cls="seg-lg" options=${DIRS[group]} />
      </${Field}>
      <div class="grid2">
        <${AmountField} value=${f.amount} cur=${f.cur} onChange=${(v) => set({ amount: v })} error=${err.amount} autofocus=${!entry && !!f.person} />
        <${Field} label="Para birimi"><${CurSeg} value=${f.cur} onChange=${(v) => set({ cur: v })} /></${Field}>
      </div>
      ${openRows.length > 0 && html`<${Field} label=${`Hangi vadeyi kapatıyor? (isteğe bağlı)`}
          hint="Seçtiğiniz satırların durumu ÖDENDİ olur ve hatırlatmadan çıkar.">
        <div class="chips">${openRows.map((c) => html`<button type="button" class=${'chip' + (closes.includes(c.id) ? ' on' : '')} onClick=${() => toggleClose(c)}>
          ${fmtDate(c.due)} · ${c.desc} · ${money(Math.abs(c.amt[f.cur]), f.cur)}</button>`)}</div>
      </${Field}>`}
      <${Field} label="Fiş türü">
        <div class="chips">
          ${FIS_TYPES.map((t) => html`<button type="button" class=${'chip' + (f.fis === t ? ' on' : '')}
            onClick=${() => set({ fis: f.fis === t ? '' : t, fisAuto: false })}>${t}</button>`)}
        </div>
        <input type="text" class="upper mt8" value=${f.fis} placeholder="Ya da kendiniz yazın" onInput=${(e) => set({ fis: e.target.value, fisAuto: false })} />
      </${Field}>
      <${Field} label="Açıklama"><input type="text" class="upper" value=${f.desc} placeholder="Örn: GBG032 GRANİT FATURA BEDELİ" onInput=${(e) => set({ desc: e.target.value })} /></${Field}>
      <div class="grid2">
        <${Field} label="Tarih"><input type="date" value=${f.date} onInput=${(e) => set({ date: e.target.value || todayStr() })} /></${Field}>
        <${Field} label="Ödeme vadesi (isteğe bağlı)" hint="Vadesi yaklaşınca ana sayfada hatırlatılır.">
          <div class="row gap"><input class="grow" type="date" value=${f.due} onInput=${(e) => set({ due: e.target.value })} />
            ${f.due && html`<button type="button" class="icon-btn" aria-label="Vadeyi temizle" onClick=${() => set({ due: '' })}><${Icon} name="x" /></button>`}</div>
        </${Field}>
      </div>
      <${Field} label="Durum">
        <${Seg} value=${f.status} onChange=${(v) => set({ status: v, paidOn: v === 'ÖDENDİ' ? f.paidOn || todayStr() : f.paidOn })}
          options=${[['', 'Boş'], ['ÖDENMEDİ', 'Ödenmedi'], ['ÖDENDİ', 'Ödendi'], ['MAHSUP', 'Mahsup']]} />
      </${Field}>
      ${f.status === 'ÖDENDİ' && html`<${Field} label="Ödenen tarih"><input type="date" value=${f.paidOn} onInput=${(e) => set({ paidOn: e.target.value })} /></${Field}>`}
      <${Toggle} label="Ana kasaya da işle" hint="Para bir hesaptan çıktıysa ya da bir hesaba girdiyse açın; o hesabın bakiyesi de değişir."
        checked=${f.link} onChange=${(v) => set({ link: v })} />
      ${f.link && html`<${Picker} label=${f.dir === 'verdim' ? 'Para hangi hesaptan çıktı?' : 'Para hangi hesaba girdi?'}
        items=${ranked('account', activeAccounts())} value=${f.account} onChange=${(v) => set({ account: v })} error=${err.account} top=${12} allowNew=${false} />`}
    </div>
  </${Sheet}>`;
}

export const openCari = (opts = {}) => openSheet(() => html`<${CariForm} ...${opts} />`);

/* =============================== Firma bilgileri =============================== */

function FirmForm({ name }) {
  const firm = name ? getFirm(name) : null;
  const [f, setF] = useState(() => ({
    name: firm?.name || '', group: firm?.group || 'alacak', cur: firm?.cur || 'TRY', risk: firm?.risk || 'NORMAL', note: firm?.note || '',
  }));
  const [err, setErr] = useState({});
  const set = (patch) => setF((o) => ({ ...o, ...patch }));
  const count = name ? S.cari.filter((c) => c.counter === name).length : 0;

  const save = () => {
    const n = upper(f.name);
    if (!n) return setErr({ name: 'Firma adını yazın' });
    if (n !== name && people().includes(n)) return setErr({ name: 'Bu isimde bir firma zaten var' });
    const row = saveFirm({ ...f, name: n }, name);
    toast('Firma kaydedildi');
    if (name) {
      if (row.name !== name) renamed.set(name, row.name);
      closeSheet();
    } else replaceSheet(() => html`<${FirmSheet} name=${row.name} />`);
  };
  const remove = async () => {
    const ok = await ask({
      title: `${name} silinsin mi?`, danger: true, ok: 'Evet, sil',
      text: count ? `Bu firmanın ${count} hareketi de silinecek${S.cari.some((c) => c.counter === name && c.link) ? ' (ana kasaya işlenenler dahil)' : ''}. Bu işlem geri alınamaz.` : '',
    });
    if (!ok) return;
    deleteFirm(name);
    toast('Firma silindi');
    closeSheet();
  };

  const footer = html`${name && html`<button class="btn danger-ghost" onClick=${remove}><${Icon} name="trash" /> Firmayı sil</button>`}
    <span class="grow"></span><button class="btn primary big" onClick=${save}><${Icon} name="check" /> Kaydet</button>`;

  return html`<${Sheet} title=${name ? 'Firma bilgileri' : 'Yeni firma'} footer=${footer}>
    <div class="form">
      <${Field} label="Firma / kişi adı" error=${err.name}>
        <input type="text" class="upper" value=${f.name} autofocus=${!name} placeholder="Örn: GAP İNŞAAT" onInput=${(e) => set({ name: e.target.value })} />
      </${Field}>
      <${Field} label="Hangi listede dursun?">
        <${Seg} value=${f.group} onChange=${(v) => set({ group: v })} cls="seg-lg"
          options=${[['alacak', 'Alacak carisi (bana borçlu)'], ['borc', 'Borç carisi (ben borçluyum)']]} />
      </${Field}>
      <${Field} label="Para birimi" hint="Yeni hareketlerde önce bu seçili gelir."><${CurSeg} value=${f.cur} onChange=${(v) => set({ cur: v })} /></${Field}>
      <${Field} label="Açıklama (durum)">
        <${Seg} value=${f.risk} onChange=${(v) => set({ risk: v })} options=${RISKS.map((r) => [r, r === 'NORMAL' ? 'Normal' : 'Sıkıntılı'])} />
      </${Field}>
      <${Field} label="Not (isteğe bağlı)"><textarea rows="3" value=${f.note} onInput=${(e) => set({ note: e.target.value })}></textarea></${Field}>
    </div>
  </${Sheet}>`;
}

export const openFirmForm = (name) => openSheet(() => html`<${FirmForm} name=${name} />`);

/* =============================== Firma defteri =============================== */

async function downloadFirms(names, share) {
  try {
    const { exportCari } = await import('../excel.js');
    const r = await exportCari(names, { share });
    if (!r.cancelled) toast(r.shared ? 'Excel paylaşıldı' : `${r.name} indirildi`);
  } catch (e) {
    toast('Excel oluşturulamadı: ' + e.message, 'err');
  }
}

function LedgerTable({ block, firm }) {
  const today = todayStr();
  const lbl = CUR_LABEL[block.cur];
  return html`<div class="ledger-wrap card">
    <table class="ledger">
      <thead><tr>
        <th>TARİH</th><th>FİŞ TÜRÜ</th><th class="wide">AÇIKLAMA</th>
        <th class="num">BORÇ ${lbl}</th><th class="num">ALACAK ${lbl}</th><th class="num">BAKİYE</th>
        <th>ÖDEME VADE</th><th>ÖDENEN TARİH</th><th>KALAN SÜRE</th><th>DURUM</th>
      </tr></thead>
      <tbody>${block.rows.map(({ r, borc, alacak, bal }) => html`<tr onClick=${() => openCari({ entry: r })}>
        <td class="nowrap">${fmtDate(r.date)}</td>
        <td>${r.fis || ''}</td>
        <td class="wide">${r.desc}${r.link ? html`<small class="muted"> · ${r.account}</small>` : ''}</td>
        <td class="num">${borc ? num(borc) : ''}</td>
        <td class="num">${alacak ? num(alacak) : ''}</td>
        <td class="num"><${BalText} v=${bal} cur=${block.cur} /></td>
        <td class="nowrap">${fmtDate(r.due)}</td>
        <td class="nowrap">${fmtDate(r.paidOn)}</td>
        <td>${remainBadge(r, today)}</td>
        <td class=${'nowrap b ' + statusCls(statusOf(r))}>${statusOf(r)}</td>
      </tr>`)}
      ${!block.rows.length && html`<tr><td colspan="10" class="muted">Henüz hareket yok. Yukarıdaki düğmelerle ekleyin.</td></tr>`}</tbody>
      <tfoot><tr>
        <td colspan="3">TOPLAM</td>
        <td class="num">${num(block.borc)}</td><td class="num">${num(block.alacak)}</td>
        <td class="num"><${BalText} v=${block.bal} cur=${block.cur} /></td>
        <td colspan="4" class="muted small">${block.bal > 0.004 ? `${firm.name} size borçlu` : block.bal < -0.004 ? `Siz ${firm.name} firmasına borçlusunuz` : 'Hesap kapalı'}</td>
      </tr></tfoot>
    </table>
  </div>`;
}

// Firma adı değişince açık defter ekranı yeni adı bulsun.
const renamed = new Map();

function FirmSheet({ name: name0 }) {
  let name = name0;
  for (let i = 0; i < 20 && renamed.has(name); i++) name = renamed.get(name);
  if (!people().includes(name)) return html`<${Sheet} title="Bulunamadı"><p>Bu firma silinmiş.</p></${Sheet}>`;
  const firm = getFirm(name);
  const blocks = firmLedger(name);
  const shown = blocks.length ? blocks : [{ cur: firm.cur, rows: [], borc: 0, alacak: 0, bal: 0 }];
  const closed = blocks.every((b) => Math.abs(b.bal) < 0.005);

  const footer = html`<button class="btn" onClick=${() => downloadFirms([name], false)}><${Icon} name="download" /> Excel indir</button>
    ${navigator.share && html`<button class="btn" onClick=${() => downloadFirms([name], true)}><${Icon} name="share" /> Paylaş</button>`}
    <span class="grow"></span>
    ${ACTION[firm.group].map(([dir, label, icon], i) => html`<button class=${'btn ' + (i ? 'primary' : '')} onClick=${() => openCari({ person: name, dir })}>
      <${Icon} name=${icon} /> ${label}</button>`)}`;

  return html`<${Sheet} title=${name} footer=${footer} wide>
    <div class="card pad firm-head">
      <div class="row gap wrap">${groupTag(firm.group)} ${riskTag(firm.risk)}
        <b class=${'firm-status ' + (closed ? 'pos' : 'neg')}>${closed ? 'ÖDENDİ' : 'ÖDENMEDİ'}</b>
        <span class="grow"></span>
        <button class="btn sm" onClick=${() => openFirmForm(name)}><${Icon} name="edit" /> Firma bilgileri</button></div>
      <div class="firm-bals">${shown.map((b) => html`<div class="debt-big">
        <small>Bakiye (${CUR_LABEL[b.cur]})</small>
        <span><${BalText} v=${b.bal} cur=${b.cur} /></span>
        <small>${b.bal > 0.004 ? 'Size borçlu' : b.bal < -0.004 ? 'Siz borçlusunuz' : 'Hesap kapalı'}</small>
      </div>`)}</div>
      ${firm.note && html`<p class="muted">${firm.note}</p>`}
    </div>
    ${shown.map((b) => html`<${LedgerTable} block=${b} firm=${firm} />`)}
    <p class="muted small mt8">Satıra dokunarak düzenleyebilirsiniz. Bakiye artı ise firma size borçlu, eksi ise siz borçlusunuz.</p>
  </${Sheet}>`;
}

export const openFirm = (name) => openSheet(() => html`<${FirmSheet} name=${name} />`);

/* =============================== Sekme =============================== */

function firmRows() {
  return people().map((name) => {
    const blocks = firmLedger(name);
    const firm = getFirm(name);
    const bal = emptyAmt();
    blocks.forEach((b) => (bal[b.cur] = b.bal));
    const open = S.cari.filter((c) => c.counter === name && cariOpen(c));
    return { name, firm, bal, closed: !amtCurs(bal).length, open };
  });
}

function sumGroup(rows) {
  const t = emptyAmt();
  rows.forEach((r) => CURS.forEach((c) => (t[c] = round2(t[c] + r.bal[c]))));
  return t;
}

function Totals({ amt }) {
  const cs = amtCurs(amt);
  if (!cs.length) return html`<span class="lg muted">—</span>`;
  return cs.map((c) => html`<span class=${'lg ' + (amt[c] > 0 ? 'pos' : 'neg')}>${money(amt[c], c)}</span>`);
}

function GroupTable({ title, rows }) {
  return html`<section>
    <h3 class="sec-title">${title} (${rows.length})</h3>
    ${rows.length ? html`<div class="card ledger-wrap"><table class="ledger firms">
      <thead><tr><th class="wide">FİRMA</th><th class="num">TOPLAM</th><th>AÇIKLAMA</th><th>DURUM</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr onClick=${() => openFirm(r.name)}>
        <td class="wide"><b>${r.name}</b>${r.open.some((c) => daysBetween(todayStr(), c.due) < 0) ? html` <span class="due-badge late sm">vadesi geçen var</span>` : ''}</td>
        <td class="num">${r.closed ? html`<span class="muted">${money(0, r.firm.cur)}</span>`
          : amtCurs(r.bal).map((c) => html`<div><${BalText} v=${r.bal[c]} cur=${c} /></div>`)}</td>
        <td>${riskTag(r.firm.risk)}</td>
        <td class=${'b ' + (r.closed ? 'pos' : 'neg')}>${r.closed ? 'ÖDENDİ' : 'ÖDENMEDİ'}</td>
      </tr>`)}</tbody>
    </table></div>` : html`<p class="muted">Bu listede firma yok.</p>`}
  </section>`;
}

export function Cari() {
  const rows = useMemo(() => firmRows(), [S.version]);
  const due = useMemo(() => cariDue(10), [S.version]);
  const [q, setQ] = useState('');
  const filtered = q ? rows.filter((r) => r.name.includes(upper(q))) : rows;
  const sortRows = (list) => list.slice().sort((a, b) => (a.closed - b.closed) || a.name.localeCompare(b.name, 'tr'));
  const alacak = sortRows(filtered.filter((r) => r.firm.group === 'alacak'));
  const borc = sortRows(filtered.filter((r) => r.firm.group === 'borc'));
  const tA = sumGroup(rows.filter((r) => r.firm.group === 'alacak'));
  const tB = sumGroup(rows.filter((r) => r.firm.group === 'borc'));
  const tAll = sumGroup(rows);
  const today = todayStr();

  return html`<div class="page">
    <div class="toolbar">
      ${rows.length > 6 && html`<label class="search grow"><${Icon} name="search" size=${18} />
        <input type="search" placeholder="Firma ara" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>`}
      <span class="grow"></span>
      ${rows.length > 0 && html`<button class="btn" onClick=${() => downloadFirms(null, false)}><${Icon} name="download" /> Tüm cariler Excel</button>`}
      <button class="btn" onClick=${() => openFirmForm()}><${Icon} name="users" /> Yeni firma</button>
      <button class="btn primary" onClick=${() => openCari()}><${Icon} name="plus" /> Yeni hareket</button>
    </div>

    <div class="kpis three">
      <div class="kpi"><small>Alacak cariler</small><${Totals} amt=${tA} /></div>
      <div class="kpi"><small>Borç cariler</small><${Totals} amt=${tB} /></div>
      <div class="kpi"><small>Toplam (artı: alacaklıyım)</small><${Totals} amt=${tAll} /></div>
    </div>

    ${due.length > 0 && html`<section>
      <h3 class="sec-title"><${Icon} name="bell" /> Vadesi yaklaşan ve geçenler (10 gün)</h3>
      <div class="card list">${due.map((c) => {
        const cur = amtCurs(c.amt)[0] || 'TRY';
        const g = getFirm(c.counter).group;
        return html`<button class="pay-row" onClick=${() => openFirm(c.counter)}>
          ${remainBadge(c, today)}
          <span class="grow"><b>${c.counter}</b><small>${fmtDate(c.due)} · ${c.fis ? c.fis + ' · ' : ''}${c.desc}</small></span>
          <b class=${g === 'alacak' ? 'pos' : 'neg'}>${money(Math.abs(c.amt[cur]), cur)}</b>
        </button>`;
      })}</div>
    </section>`}

    ${!rows.length ? html`<${Empty} icon="users" title="Cari firma yok"
        text="Önce 'Yeni firma' ile firmayı ekleyin (alacak carisi ya da borç carisi). Sonra faturaları, ödemeleri ve tahsilatları firmanın içine yazın. Her firmanın defterini ayrı Excel olarak indirebilirsiniz.">
        <button class="btn primary" onClick=${() => openFirmForm()}><${Icon} name="plus" /> Yeni firma</button></${Empty}>`
      : html`<${GroupTable} title="ALACAK CARİLER" rows=${alacak} />
        <${GroupTable} title="BORÇ CARİLER" rows=${borc} />`}
  </div>`;
}
