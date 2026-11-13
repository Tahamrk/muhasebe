// Ayarlar: görünüm, kurlar, PIN, yedekleme/Excel, hesaplar, listeler.
import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { S, setSetting, replaceAll, commit, DEFAULT_SETTINGS } from '../store.js';
import { money, numRate, parseNum, fmtDate, todayStr, daysBetween, upper } from '../util.js';
import {
  ACCOUNT_KINDS, balances, amtCurs, emptyAmt, usageCount, renameItem, removeItem, addItem,
  updateAccount, updateType, DEFAULT_TYPES, DEFAULT_COUNTERS, ranked,
} from '../model.js';
import { Icon, Sheet, Field, Seg, Toggle, Empty } from '../components.js';
import { openSheet, closeSheet, replaceSheet, toast, ask } from '../ui.js';
import { exportExcel, parseExcel, applyImport } from '../excel.js';
import { refreshRates, setManualRates } from '../rates.js';
import { openPinSetup } from './lock.js';

export const APP_VERSION = '1.0.1';

/* ------------------------------ Yedekleme ------------------------------ */

function BackupSheet() {
  const [busy, setBusy] = useState(false);
  const years = useMemo(() => [...new Set(S.tx.map((t) => t.date.slice(0, 4)))].sort().reverse(), [S.version]);
  const [year, setYear] = useState(years[0] || todayStr().slice(0, 4));
  const run = async (opts) => {
    setBusy(true);
    try {
      const r = await exportExcel(opts);
      if (r.cancelled) return;
      toast(r.shared ? 'Yedek paylaşıldı' : `${r.name} indirildi`);
    } catch (e) {
      toast('Excel oluşturulamadı: ' + e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const last = S.settings.lastBackup;
  return html`<${Sheet} title="Yedek al">
    <p>Tüm kayıtlarınız, hesaplarınız, cari ve ödemeleriniz tek bir Excel dosyasına yazılır. Bu dosyayla verilerinizi istediğiniz zaman geri yükleyebilirsiniz.</p>
    <p class="muted">Son yedek: <b>${last ? `${fmtDate(last.slice(0, 10))} (${daysBetween(last.slice(0, 10), todayStr())} gün önce)` : 'hiç alınmadı'}</b></p>
    <div class="big-actions">
      <button class="btn primary big" disabled=${busy} onClick=${() => run({ share: true })}>
        <${Icon} name="share" /> Yedeği gönder <small>Google Drive, WhatsApp, e-posta…</small></button>
      <button class="btn big" disabled=${busy} onClick=${() => run({})}>
        <${Icon} name="download" /> Tablete indir <small>"İndirilenler" klasörüne kaydedilir</small></button>
    </div>
    <div class="alert info mt16"><${Icon} name="info" />
      <span>Öneri: Yedeği "Yedeği gönder" ile Google Drive'a ya da kendinize WhatsApp'tan gönderin. Tablet kaybolsa ya da bozulsa bile veriler kurtarılır.</span></div>
    <h3 class="sec-title">Yıllık Excel (eski formatta)</h3>
    <p class="muted">Seçilen yılın kayıtlarını, başında devreden bakiyelerle, alıştığınız "GENEL İCMAL" düzeninde verir.</p>
    <div class="row gap">
      <select value=${year} onChange=${(e) => setYear(e.target.value)}>${(years.length ? years : [year]).map((y) => html`<option value=${y}>${y}</option>`)}</select>
      <button class="btn" disabled=${busy} onClick=${() => run({ year: Number(year), share: false })}><${Icon} name="download" /> ${year} Excel'ini indir</button>
    </div>
    ${busy && html`<p class="muted">Hazırlanıyor…</p>`}
  </${Sheet}>`;
}
export const openBackup = () => openSheet(() => html`<${BackupSheet} />`);

function ImportPreview({ parsed, fileName }) {
  const has = S.tx.length > 0;
  const [mode, setMode] = useState(has ? 'replace' : 'replace');
  const s = parsed.stats;
  const apply = async () => {
    if (has && mode === 'replace') {
      const ok = await ask({ title: 'Mevcut veriler silinsin mi?', text: `Tablette şu an ${S.tx.length} kayıt var. Bunların yerine dosyadaki ${s.tx} kayıt gelecek. Emin değilseniz önce yedek alın.`, ok: 'Evet, değiştir', danger: true });
      if (!ok) return;
    }
    applyImport(parsed, mode);
    toast(`${s.tx} kayıt içe aktarıldı`);
    closeSheet();
  };
  return html`<${Sheet} title="Excel'den içe aktar" footer=${html`<span class="grow"></span>
      <button class="btn primary big" onClick=${apply}><${Icon} name="check" /> İçe aktar</button>`}>
    <p><b>${fileName}</b> ${parsed.isBackup ? html`<span class="tag">Uygulama yedeği</span>` : ''}</p>
    <div class="stat-grid">
      <div><small>Kayıt</small><b>${s.tx}</b></div>
      <div><small>Tarih aralığı</small><b>${s.from ? `${fmtDate(s.from)} – ${fmtDate(s.to)}` : '—'}</b></div>
      <div><small>Hesap</small><b>${s.accounts}</b></div>
      <div><small>Kart / KMH limiti</small><b>${s.limits}</b></div>
      <div><small>Cari hareket</small><b>${s.cari}</b></div>
      <div><small>Yaklaşan ödeme</small><b>${s.payments}</b></div>
    </div>
    ${s.skipped > 0 && html`<p class="muted">Tutarı olmayan ${s.skipped} satır atlandı.</p>`}
    ${has && html`<${Field} label="Tablette zaten veri var. Ne yapılsın?">
      <${Seg} value=${mode} onChange=${setMode} cls="seg-lg"
        options=${[['replace', 'Mevcut verinin yerine koy'], ['append', 'Mevcut verinin sonuna ekle']]} />
    </${Field}>`}
    <p class="muted small">Kredi kartı ve KMH limit satırları (K.KARTI / KMH türünde "LİMİTİ" yazan satırlar) kayıt olarak değil, hesabın limiti olarak alınır. Hesap türlerini sonradan Ayarlar > Hesaplar'dan düzeltebilirsiniz.</p>
  </${Sheet}>`;
}

async function pickAndImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    toast('Dosya okunuyor…');
    try {
      const parsed = await parseExcel(await file.arrayBuffer());
      openSheet(() => html`<${ImportPreview} parsed=${parsed} fileName=${file.name} />`);
    } catch (e) {
      console.error(e);
      toast('Dosya okunamadı: ' + e.message, 'err');
    }
  };
  input.click();
}

/* ------------------------------ Hesaplar ------------------------------ */

function AccountSheet({ name }) {
  const acc = S.accounts.find((a) => a.name === name);
  const isNew = !acc;
  const [f, setF] = useState(() => ({ name: acc?.name || '', kind: acc?.kind || 'banka', limit: acc?.limit ? String(acc.limit).replace('.', ',') : '', archived: !!acc?.archived }));
  const set = (p) => setF((o) => ({ ...o, ...p }));
  const used = acc ? usageCount('account', acc.name) : 0;
  const b = acc ? balances().get(acc.name) || emptyAmt() : emptyAmt();

  const save = async () => {
    const n = upper(f.name);
    if (!n) return toast('Hesap adı yazın', 'err');
    if (isNew) {
      if (S.accounts.some((a) => a.name === n)) return toast('Bu adda hesap zaten var', 'err');
      addItem('account', n, { kind: f.kind, limit: parseNum(f.limit) });
    } else {
      if (n !== acc.name && S.accounts.some((a) => a.name === n)) {
        const ok = await ask({ title: `"${n}" zaten var`, text: `"${acc.name}" hesabının tüm kayıtları "${n}" hesabına taşınıp ikisi birleştirilsin mi?`, ok: 'Birleştir' });
        if (!ok) return;
      }
      updateAccount(acc.name, { kind: f.kind, limit: parseNum(f.limit), archived: f.archived });
      if (n !== acc.name) renameItem('account', acc.name, n);
    }
    toast('Hesap kaydedildi');
    closeSheet();
  };
  const remove = async () => {
    if (!(await ask({ title: 'Hesap silinsin mi?', ok: 'Sil', danger: true }))) return;
    removeItem('account', acc.name);
    closeSheet();
  };

  return html`<${Sheet} title=${isNew ? 'Yeni hesap' : acc.name} footer=${html`
      ${!isNew && used === 0 && html`<button class="btn danger-ghost" onClick=${remove}><${Icon} name="trash" /> Sil</button>`}
      <span class="grow"></span><button class="btn primary big" onClick=${save}><${Icon} name="check" /> Kaydet</button>`}>
    <div class="form">
      <${Field} label="Hesap adı (Sorumluluk merkezi)" hint=${!isNew && used ? `${used} kayıtta kullanılıyor; adı değiştirirseniz hepsi güncellenir.` : ''}>
        <input type="text" class="upper" value=${f.name} onInput=${(e) => set({ name: e.target.value })} placeholder="Örn: ZİRAAT BANKASI" />
      </${Field}>
      <${Field} label="Hesap türü"><${Seg} value=${f.kind} onChange=${(v) => set({ kind: v })} options=${Object.entries(ACCOUNT_KINDS)} /></${Field}>
      ${(f.kind === 'kart' || f.kind === 'banka') && html`<${Field} label=${f.kind === 'kart' ? 'Kart limiti (TL)' : 'KMH limiti (TL, varsa)'}>
        <input type="text" inputmode="decimal" value=${f.limit} onInput=${(e) => set({ limit: e.target.value })} placeholder="0" />
      </${Field}>`}
      ${!isNew && html`<${Toggle} label="Arşivle" hint="Kapanan hesaplar seçim listelerinde görünmez; bakiyesi sıfırsa ana sayfada da gizlenir." checked=${f.archived} onChange=${(v) => set({ archived: v })} />`}
      ${!isNew && html`<div class="card pad"><small class="muted">Güncel bakiye</small><div>
        ${amtCurs(b).length ? amtCurs(b).map((c) => html`<div><b>${money(b[c], c)}</b></div>`) : money(0)}</div></div>`}
    </div>
  </${Sheet}>`;
}

/* ------------------------------ Listeler ------------------------------ */

function ListSheet({ kind }) {
  const [q, setQ] = useState('');
  const [nv, setNv] = useState('');
  const isType = kind === 'type';
  const items = isType ? S.types.map((t) => t.name) : S.counters;
  const list = ranked(kind, items).filter((i) => !q || i.includes(upper(q)));

  const rename = async (name) => {
    const v = await ask({ title: `"${name}" yeni adı`, input: name, ok: 'Kaydet' });
    if (!v || upper(v) === name) return;
    const n = upper(v);
    if (items.includes(n)) {
      const ok = await ask({ title: `"${n}" zaten var`, text: `"${name}" kayıtları "${n}" ile birleştirilsin mi?`, ok: 'Birleştir' });
      if (!ok) return;
    }
    renameItem(kind, name, n);
    toast('Güncellendi');
  };
  const remove = async (name) => {
    if (!(await ask({ title: `"${name}" silinsin mi?`, ok: 'Sil', danger: true }))) return;
    removeItem(kind, name);
  };

  return html`<${Sheet} title=${isType ? 'Gelir / gider türleri' : 'Karşı hesaplar'}>
    <div class="row gap">
      <input type="text" class="upper grow" placeholder="Yeni ekle…" value=${nv} onInput=${(e) => setNv(e.target.value)} />
      <button class="btn primary" onClick=${() => { if (addItem(kind, nv)) { setNv(''); toast('Eklendi'); } }}><${Icon} name="plus" /> Ekle</button>
    </div>
    <input type="search" class="mt8" placeholder="Ara…" value=${q} onInput=${(e) => setQ(e.target.value)} />
    ${isType && html`<p class="muted small">"Raporda" kapalı olan türler gelir/gider sayılmaz (transfer, kart ödemesi gibi).</p>`}
    <div class="card list mt8">
      ${list.map((name) => {
        const n = usageCount(kind, name);
        const t = isType && S.types.find((x) => x.name === name);
        return html`<div class="list-item">
          <span class="grow"><b>${name}</b><small>${n} kayıt</small></span>
          ${isType && html`<label class="mini-toggle"><input type="checkbox" class="switch" checked=${t.report !== false}
            onChange=${(e) => updateType(name, { report: e.target.checked })} /> Raporda</label>`}
          <button class="icon-btn" onClick=${() => rename(name)} aria-label="Adını değiştir"><${Icon} name="edit" size=${20} /></button>
          ${n === 0 && html`<button class="icon-btn" onClick=${() => remove(name)} aria-label="Sil"><${Icon} name="trash" size=${20} /></button>`}
        </div>`;
      })}
    </div>
  </${Sheet}>`;
}

/* ------------------------------ Ana ekran ------------------------------ */

function RatesCard() {
  const r = S.settings.rates;
  const [f, setF] = useState({ USD: '', EUR: '', XAU: '' });
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { await refreshRates({ force: true }); toast('Kurlar güncellendi'); }
    catch (e) { toast('Kurlar alınamadı: ' + e.message, 'err'); }
    finally { setBusy(false); }
  };
  const saveManual = () => {
    const patch = {};
    for (const k of ['USD', 'EUR', 'XAU']) if (parseNum(f[k]) > 0) patch[k] = parseNum(f[k]);
    if (!Object.keys(patch).length) return toast('Kur girin', 'err');
    setManualRates(patch);
    setF({ USD: '', EUR: '', XAU: '' });
    toast('Kurlar kaydedildi');
  };
  return html`<section class="card pad set-sec">
    <h3><${Icon} name="coins" /> Döviz ve altın kurları</h3>
    <div class="stat-grid">
      <div><small>1 USD</small><b>${r.USD ? numRate(r.USD) + ' ₺' : '—'}</b></div>
      <div><small>1 EURO</small><b>${r.EUR ? numRate(r.EUR) + ' ₺' : '—'}</b></div>
      <div><small>1 gr altın</small><b>${r.XAU ? money(r.XAU) : '—'}</b></div>
    </div>
    <p class="muted small">${r.at ? `Son güncelleme: ${new Date(r.at).toLocaleString('tr-TR')} · ${r.source}` : 'Henüz kur alınmadı.'}</p>
    <div class="row gap wrap">
      <button class="btn primary" disabled=${busy} onClick=${refresh}><${Icon} name="refresh" /> ${busy ? 'Alınıyor…' : 'İnternetten güncelle'}</button>
    </div>
    <${Toggle} label="Uygulama açılınca kurları otomatik güncelle" hint="İnternet varsa yarım saatte bir güncellenir." checked=${S.settings.autoRates} onChange=${(v) => setSetting({ autoRates: v })} />
    <details class="mt8"><summary>Kurları elle gir</summary>
      <div class="grid3 mt8">
        <${Field} label="1 USD (TL)"><input type="text" inputmode="decimal" value=${f.USD} placeholder=${r.USD ? numRate(r.USD) : ''} onInput=${(e) => setF({ ...f, USD: e.target.value })} /></${Field}>
        <${Field} label="1 EURO (TL)"><input type="text" inputmode="decimal" value=${f.EUR} placeholder=${r.EUR ? numRate(r.EUR) : ''} onInput=${(e) => setF({ ...f, EUR: e.target.value })} /></${Field}>
        <${Field} label="1 gr altın (TL)"><input type="text" inputmode="decimal" value=${f.XAU} placeholder=${r.XAU ? numRate(r.XAU) : ''} onInput=${(e) => setF({ ...f, XAU: e.target.value })} /></${Field}>
      </div>
      <button class="btn" onClick=${saveManual}>Elle girilen kurları kaydet</button>
    </details>
  </section>`;
}

export function Settings() {
  const st = S.settings;
  const accs = [...S.accounts].sort((a, b) => Object.keys(ACCOUNT_KINDS).indexOf(a.kind) - Object.keys(ACCOUNT_KINDS).indexOf(b.kind) || a.name.localeCompare(b.name, 'tr'));

  const wipe = async () => {
    const v = await ask({ title: 'Tüm veriler silinsin mi?', text: 'Bu işlem geri alınamaz. Devam etmek için kutuya SİL yazın.', input: '', ok: 'Tümünü sil', danger: true });
    if (v === false) return;
    if (upper(v) !== 'SİL') return toast('SİL yazılmadığı için silinmedi', 'err');
    replaceAll({ tx: [], cari: [], payments: [], accounts: [{ name: 'KASA', kind: 'kasa', limit: 0, archived: false }], types: DEFAULT_TYPES.map((t) => ({ ...t })), counters: [...DEFAULT_COUNTERS] });
    toast('Tüm veriler silindi');
  };

  return html`<div class="page settings">
    <section class="card pad set-sec">
      <h3><${Icon} name="download" /> Yedekleme ve Excel</h3>
      <p class="muted">Son yedek: <b>${st.lastBackup ? fmtDate(st.lastBackup.slice(0, 10)) : 'hiç alınmadı'}</b>. Ayda bir yedek almanız için ana sayfada hatırlatma çıkar.</p>
      <div class="row gap wrap">
        <button class="btn primary" onClick=${openBackup}><${Icon} name="download" /> Yedek al / Excel'e aktar</button>
        <button class="btn" onClick=${pickAndImport}><${Icon} name="upload" /> Excel'den içe aktar / Yedeği geri yükle</button>
      </div>
    </section>

    <section class="card pad set-sec">
      <h3><${Icon} name="text" /> Görünüm</h3>
      <${Toggle} label="Büyük yazı ve düğmeler" hint="Yazıları ve dokunma alanlarını büyütür." checked=${st.bigText} onChange=${(v) => setSetting({ bigText: v })} />
      <${Field} label="Toplamlar hangi para biriminde gösterilsin?">
        <${Seg} value=${st.displayCur} onChange=${(v) => setSetting({ displayCur: v })} options=${[['TRY', '₺ Türk Lirası'], ['USD', '$ Amerikan Doları']]} />
      </${Field}>
    </section>

    <${RatesCard} />

    <section class="card pad set-sec">
      <h3><${Icon} name="lock" /> Güvenlik</h3>
      <p class="muted">${st.pinHash ? 'PIN kilidi açık. Uygulama açılırken ve bir süre kullanılmayınca PIN sorulur.' : 'PIN kilidi kapalı.'}</p>
      <div class="row gap wrap">
        <button class="btn primary" onClick=${openPinSetup}><${Icon} name="lock" /> ${st.pinHash ? 'PIN değiştir' : 'PIN belirle'}</button>
        ${st.pinHash && html`<button class="btn" onClick=${async () => { if (await ask({ title: 'PIN kilidi kaldırılsın mı?', ok: 'Kaldır' })) { setSetting({ pinHash: null }); toast('PIN kaldırıldı'); } }}>PIN'i kaldır</button>`}
      </div>
      ${st.pinHash && html`<${Field} label="Kullanılmayınca kilitle">
        <${Seg} value=${String(st.lockMinutes)} onChange=${(v) => setSetting({ lockMinutes: Number(v) })} options=${[['1', '1 dk'], ['5', '5 dk'], ['15', '15 dk'], ['0', 'Sadece açılışta']]} />
      </${Field}>`}
    </section>

    <section class="card pad set-sec">
      <h3 class="row"><${Icon} name="bank" /> Hesaplar <span class="grow"></span>
        <button class="btn sm" onClick=${() => openSheet(() => html`<${AccountSheet} name=${null} />`)}><${Icon} name="plus" /> Yeni hesap</button></h3>
      <div class="list">
        ${accs.map((a) => html`<button class="list-item" onClick=${() => openSheet(() => html`<${AccountSheet} name=${a.name} />`)}>
          <span class="grow"><b>${a.name}</b><small>${ACCOUNT_KINDS[a.kind]}${a.limit ? ' · Limit ' + money(a.limit) : ''}${a.archived ? ' · Arşivde' : ''}</small></span>
          <${Icon} name="right" size=${18} />
        </button>`)}
      </div>
    </section>

    <section class="card pad set-sec">
      <h3><${Icon} name="list" /> Listeler</h3>
      <div class="list">
        <button class="list-item" onClick=${() => openSheet(() => html`<${ListSheet} kind="type" />`)}>
          <span class="grow"><b>Gelir / gider türleri</b><small>${S.types.length} tür</small></span><${Icon} name="right" size=${18} /></button>
        <button class="list-item" onClick=${() => openSheet(() => html`<${ListSheet} kind="counter" />`)}>
          <span class="grow"><b>Karşı hesaplar</b><small>${S.counters.length} kayıt</small></span><${Icon} name="right" size=${18} /></button>
      </div>
    </section>

    <section class="card pad set-sec">
      <h3><${Icon} name="info" /> Veriler</h3>
      <p class="muted">Tüm veriler sadece bu tablette saklanır, internete gönderilmez. ${S.tx.length} kayıt, ${S.cari.length} cari hareket, ${S.payments.length} ödeme.</p>
      <button class="btn danger-ghost" onClick=${wipe}><${Icon} name="trash" /> Tüm verileri sil</button>
      <p class="muted small mt16">Kişisel Muhasebe · sürüm ${APP_VERSION}</p>
    </section>
  </div>`;
}
