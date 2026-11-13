// Ana sayfa: net varlık, bu ayın özeti, hızlı işlemler, hesaplar, uyarılar.
import { html, useMemo } from '../../vendor/preact-htm.js';
import { S, setSetting, getSaveError } from '../store.js';
import { CURS, CUR_LABEL, money, numRate, todayStr, daysBetween, periodRange, longDate, fmtDate } from '../util.js';
import { accountSummary, flowRows, sumFlow, toDisplay, hasRates, amtCurs, ACCOUNT_KINDS, cariDue } from '../model.js';
import { openFirm } from './cari.js';
import { Icon, Money, Seg, Empty } from '../components.js';
import { openEntry } from './entryForm.js';
import { TxRow } from './entries.js';
import { refreshRates } from '../rates.js';
import { toast } from '../ui.js';
import { openBackup } from './settings.js';
import { go } from '../router.js';
import { upcomingInstallments } from '../debts.js';
import { openDebt } from './debts.js';

export function DisplayMoney({ tl, cls = '', color = true, sign = false }) {
  const cur = S.settings.displayCur;
  return html`<${Money} v=${toDisplay(tl)} cur=${cur} color=${color} sign=${sign} cls=${cls} />`;
}

export function RatesBar() {
  const r = S.settings.rates;
  const doRefresh = async () => {
    try { await refreshRates({ force: true }); toast('Kurlar güncellendi'); }
    catch (e) { toast('Kurlar alınamadı: ' + e.message, 'err'); }
  };
  return html`<div class="rates">
    ${hasRates() ? html`
      <span>USD <b>${numRate(r.USD)}</b></span>
      <span>EUR <b>${numRate(r.EUR)}</b></span>
      <span>Gr Altın <b>${money(r.XAU, 'TRY', { short: true })}</b></span>
      <small>${r.at ? new Date(r.at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</small>`
      : html`<span class="warn-text">Kur bilgisi yok</span>`}
    <button class="icon-btn sm" onClick=${doRefresh} aria-label="Kurları güncelle"><${Icon} name="refresh" size=${18} /></button>
  </div>`;
}

function accountIcon(kind) {
  return { kasa: 'safe', banka: 'bank', kart: 'card', yatirim: 'trend' }[kind] || 'wallet';
}

function AccountCard({ r }) {
  const { acc, bal } = r;
  const curs = amtCurs(bal);
  const isCard = acc.kind === 'kart';
  const used = acc.limit ? Math.min(100, Math.max(0, (r.debt / acc.limit) * 100)) : 0;
  return html`<button class="acc-card" onClick=${() => go('kayitlar', { account: acc.name })}>
    <span class="acc-head"><${Icon} name=${accountIcon(acc.kind)} size=${20} /><b>${acc.name}</b></span>
    ${isCard ? html`
      <span class="acc-line"><small>Borç</small><span class=${r.debt > 0 ? 'neg' : ''}>${money(r.debt)}</span></span>
      ${acc.limit ? html`<span class="bar"><span style=${`width:${used}%`} class=${used > 85 ? 'hot' : ''}></span></span>
        <span class="acc-line"><small>Kullanılabilir</small><span>${money(r.available)}</span></span>` : null}
      ${bal.TRY > 0 ? html`<span class="acc-line"><small>Fazla ödeme</small><span class="pos">${money(bal.TRY)}</span></span>` : null}`
    : html`
      ${curs.length ? curs.map((c) => html`<span class="acc-line"><small>${CUR_LABEL[c]}</small><${Money} v=${bal[c]} cur=${c} color=${bal[c] < 0} /></span>`)
        : html`<span class="acc-line"><small>Bakiye</small><span>${money(0)}</span></span>`}
      ${acc.limit ? html`<span class="acc-line"><small>KMH limiti</small><span>${money(acc.limit)}</span></span>` : null}`}
  </button>`;
}

export function Home() {
  const sum = useMemo(() => accountSummary(), [S.version]);
  const month = useMemo(() => sumFlow(flowRows(periodRange('thisMonth'))), [S.version]);
  const today = todayStr();
  // Yaklaşan ödemeler + borç/alacak taksitleri tek listede
  const payments = [
    ...S.payments.filter((p) => !p.paid && p.due && daysBetween(today, p.due) <= 10)
      .map((p) => ({ key: p.id, name: p.name, sub: fmtDate(p.due), due: p.due, amount: p.amount, cur: p.cur, open: () => go('odemeler') })),
    ...upcomingInstallments(10).map(({ d, r }) => ({
      key: d.id + r.id, name: d.person, due: r.due, amount: r.rest, cur: d.cur, kind: d.kind,
      sub: `${fmtDate(r.due)} · ${d.title} · ${r.no}. taksit · ${d.kind === 'borc' ? 'Ödenecek' : 'Tahsil edilecek'}`,
      open: () => openDebt(d.id),
    })),
    ...cariDue(10, today).map((c) => {
      const cur = amtCurs(c.amt)[0] || 'TRY';
      const kind = c.amt[cur] < 0 ? 'alacak' : 'borc';
      return {
        key: c.id, name: c.counter, due: c.due, amount: Math.abs(c.amt[cur]), cur, kind,
        sub: `${fmtDate(c.due)} · Cari${c.fis ? ' · ' + c.fis : ''} · ${c.desc}`,
        open: () => openFirm(c.counter),
      };
    }),
  ].sort((a, b) => a.due.localeCompare(b.due));
  const lastBackupDays = S.settings.lastBackup ? daysBetween(S.settings.lastBackup.slice(0, 10), today) : null;
  const needBackup = S.tx.length > 0 && (lastBackupDays === null || lastBackupDays >= 30);
  const saveErr = getSaveError();
  const cur = S.settings.displayCur;

  const groups = [
    ['Kasa ve Bankalar', sum.rows.filter((r) => ['kasa', 'banka', 'diger'].includes(r.acc.kind))],
    ['Yatırım', sum.rows.filter((r) => r.acc.kind === 'yatirim')],
    ['Kredi Kartları', sum.rows.filter((r) => r.acc.kind === 'kart')],
  ].filter(([, rows]) => rows.length);

  return html`<div class="page home">
    <div class="home-top">
      <div>
        <h1>Hoş geldiniz</h1>
        <p class="muted">${longDate(today)}</p>
      </div>
      <div class="home-top-right">
        <${Seg} value=${cur} onChange=${(v) => setSetting({ displayCur: v })} options=${[['TRY', '₺ TL göster'], ['USD', '$ USD göster']]} />
        <${RatesBar} />
      </div>
    </div>

    ${saveErr && html`<div class="alert err"><${Icon} name="alert" /> Veriler kaydedilemedi! Lütfen hemen yedek alın. (${String(saveErr.message || saveErr)})</div>`}
    ${needBackup && html`<div class="alert warn">
      <${Icon} name="download" />
      <span class="grow">${lastBackupDays === null ? 'Henüz hiç yedek alınmadı.' : `Son yedekten bu yana ${lastBackupDays} gün geçti.`} Verilerin kaybolmaması için ayda bir Excel yedeği alın.</span>
      <button class="btn primary" onClick=${openBackup}>Yedek al</button>
    </div>`}
    ${cur !== 'TRY' && !hasRates() && html`<div class="alert warn"><${Icon} name="alert" /> USD gösterimi için kur bilgisi gerekli. Ayarlar'dan kurları girin ya da internete bağlanın.</div>`}

    <div class="kpis">
      <div class="kpi main">
        <small>Net varlık ${hasRates() ? '' : '(sadece TL)'}</small>
        <${DisplayMoney} tl=${hasRates() ? sum.net : sum.total.TRY} cls="xl" />
        <div class="kpi-sub">
          <span>Varlıklar <${DisplayMoney} tl=${sum.assets} color=${false} /></span>
          <span>Borçlar <${DisplayMoney} tl=${sum.debts} /></span>
        </div>
        <div class="cur-chips">
          ${CURS.filter((c) => sum.total[c]).map((c) => html`<span class="cur-chip"><small>${CUR_LABEL[c]}</small><${Money} v=${sum.total[c]} cur=${c} /></span>`)}
        </div>
      </div>
      <div class="kpi"><small>Bu ay gelir</small><${DisplayMoney} tl=${month.gelir} cls="lg pos" color=${false} /></div>
      <div class="kpi"><small>Bu ay gider</small><${DisplayMoney} tl=${month.gider} cls="lg neg" color=${false} /></div>
    </div>

    <div class="quick">
      <button class="q q-gider" onClick=${() => openEntry({ mode: 'gider' })}><${Icon} name="out" size=${28} /><span>Gider Ekle</span></button>
      <button class="q q-gelir" onClick=${() => openEntry({ mode: 'gelir' })}><${Icon} name="in" size=${28} /><span>Gelir Ekle</span></button>
      <button class="q" onClick=${() => openEntry({ mode: 'transfer' })}><${Icon} name="swap" size=${28} /><span>Transfer</span></button>
      <button class="q" onClick=${() => openEntry({ mode: 'kkodeme' })}><${Icon} name="card" size=${28} /><span>Kart Ödemesi</span></button>
      <button class="q" onClick=${() => openEntry({ mode: 'doviz' })}><${Icon} name="coins" size=${28} /><span>Döviz / Altın</span></button>
    </div>

    ${payments.length > 0 && html`<section>
      <h3 class="sec-title"><${Icon} name="bell" /> Yaklaşan ödeme ve tahsilatlar (10 gün)
        <button class="link" onClick=${() => go('odemeler')}>Ödemeler</button><button class="link" style="margin-left:0" onClick=${() => go('borclar')}>Borç / Alacak</button><button class="link" style="margin-left:0" onClick=${() => go('cari')}>Cariler</button></h3>
      <div class="card list">${payments.map((p) => {
        const d = daysBetween(today, p.due);
        return html`<button class="pay-row" key=${p.key} onClick=${p.open}>
          <span class=${'due-badge ' + (d < 0 ? 'late' : d <= 3 ? 'soon' : '')}>${d < 0 ? `${-d} gün gecikti` : d === 0 ? 'Bugün' : `${d} gün`}</span>
          <span class="grow"><b>${p.name}</b><small>${p.sub}</small></span>
          <b class=${p.kind === 'alacak' ? 'pos' : ''}>${p.kind === 'alacak' ? '+' : ''}${money(p.amount, p.cur)}</b>
        </button>`;
      })}</div>
    </section>`}

    ${groups.map(([title, rows]) => html`<section>
      <h3 class="sec-title">${title}</h3>
      <div class="acc-grid">${rows.map((r) => html`<${AccountCard} r=${r} />`)}</div>
    </section>`)}

    <section>
      <h3 class="sec-title">Son kayıtlar <button class="link" onClick=${() => go('kayitlar')}>Tümü</button></h3>
      ${S.tx.length ? html`<div class="card list">${S.tx.slice(-8).reverse().map((t) => html`<${TxRow} t=${t} showDate />`)}</div>`
        : html`<${Empty} icon="list" title="Henüz kayıt yok" text="Yukarıdaki düğmelerle ilk kaydınızı ekleyin ya da Ayarlar > Yedekleme bölümünden Excel dosyanızı içe aktarın.">
            <button class="btn primary" onClick=${() => go('ayarlar')}>Excel'den içe aktar</button></${Empty}>`}
    </section>
  </div>`;
}
