// Uygulamanın giriş noktası: yerleşim, menü, kilit, paneller.
import { html, render, useState, useEffect } from '../vendor/preact-htm.js';
import { S, load, useStore, flush } from './store.js';
import { useUI, closeAllSheets } from './ui.js';
import { useRoute, go } from './router.js';
import { todayStr, daysBetween } from './util.js';
import { Icon } from './components.js';
import { refreshRates } from './rates.js';
import { Home } from './views/home.js';
import { Entries } from './views/entries.js';
import { Payments } from './views/payments.js';
import { Cari } from './views/cari.js';
import { Debts } from './views/debts.js';
import { upcomingInstallments } from './debts.js';
import { Reports } from './views/reports.js';
import { Settings } from './views/settings.js';
import { LockScreen } from './views/lock.js';

const NAV = [
  ['anasayfa', 'Ana Sayfa', 'home', Home],
  ['kayitlar', 'Kayıtlar', 'list', Entries],
  ['odemeler', 'Ödemeler', 'calendar', Payments],
  ['borclar', 'Borç / Alacak', 'file', Debts],
  ['cari', 'Cari', 'users', Cari],
  ['raporlar', 'Raporlar', 'chart', Reports],
  ['ayarlar', 'Ayarlar', 'settings', Settings],
];

/* ---------- Sürüm güncelleme (service worker) ---------- */
let waitingWorker = null;
const updateSubs = new Set();
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || /[?&]nosw/.test(location.search)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const track = (w) => w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) { waitingWorker = w; updateSubs.forEach((f) => f()); }
    });
    if (reg.waiting && navigator.serviceWorker.controller) { waitingWorker = reg.waiting; }
    reg.addEventListener('updatefound', () => track(reg.installing));
    // Uygulama uzun süre açık kalırsa yeni sürümü ara.
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => console.warn('SW kaydedilemedi', e));
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // İlk kurulumda yenilemeye gerek yok; sadece sürüm güncellemesinde yenile.
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}
async function applyUpdate() {
  await flush();
  waitingWorker?.postMessage('skipWaiting');
}

function Dialog({ d }) {
  const [val, setVal] = useState(d.input ?? '');
  const ok = () => d.resolve(d.input !== null && d.input !== undefined ? val : true);
  return html`<div class="dialog-wrap" onClick=${(e) => e.target === e.currentTarget && d.resolve(false)}>
    <div class="dialog" role="alertdialog">
      <h3>${d.title}</h3>
      ${d.text && html`<p>${d.text}</p>`}
      ${d.input !== null && d.input !== undefined && html`<input type="text" value=${val} autofocus
        onInput=${(e) => setVal(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && ok()} />`}
      <div class="dialog-actions">
        <button class="btn" onClick=${() => d.resolve(false)}>${d.cancel}</button>
        <button class=${'btn ' + (d.danger ? 'danger' : 'primary')} onClick=${ok}>${d.ok}</button>
      </div>
    </div>
  </div>`;
}

function App() {
  const s = useStore();
  const ui = useUI();
  const { route, params, key } = useRoute();
  const [locked, setLocked] = useState(() => !!S.settings.pinHash);
  const [, force] = useState(0);

  useEffect(() => {
    const f = () => force((v) => v + 1);
    updateSubs.add(f);
    return () => updateSubs.delete(f);
  }, []);

  // Büyük yazı modu
  useEffect(() => { document.documentElement.classList.toggle('big', !!s.settings.bigText); }, [s.settings.bigText]);

  // Otomatik kur güncelleme
  useEffect(() => {
    const run = () => { if (S.settings.autoRates) refreshRates().catch(() => {}); };
    run();
    window.addEventListener('online', run);
    const onVis = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('online', run); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // Kullanılmayınca kilitle
  useEffect(() => {
    let hiddenAt = null;
    const onVis = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      const m = S.settings.lockMinutes;
      if (S.settings.pinHash && m > 0 && hiddenAt && Date.now() - hiddenAt > m * 60000) setLocked(true);
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (locked && S.settings.pinHash) return html`<${LockScreen} onUnlock=${() => setLocked(false)} />`;

  const today = todayStr();
  const dueSoon = S.payments.filter((p) => !p.paid && p.due && daysBetween(today, p.due) <= 3).length;
  const debtSoon = upcomingInstallments(3).length;
  const badges = { odemeler: dueSoon, borclar: debtSoon };
  const current = NAV.find((n) => n[0] === route) || NAV[0];
  const Page = current[3];
  const nav = (cls) => html`<nav class=${cls}>
    ${cls === 'side' && html`<div class="brand"><span class="brand-logo">₺</span><span>Kişisel<br/>Muhasebe</span></div>`}
    ${NAV.map(([r, label, icon]) => html`<a href=${'#/' + r} class=${r === route ? 'on' : ''}>
      <span class="nav-ico"><${Icon} name=${icon} size=${cls === 'side' ? 22 : 24} />
        ${badges[r] > 0 && html`<span class="badge">${badges[r]}</span>`}</span>
      <span>${label}</span></a>`)}
  </nav>`;

  return html`<div class="app">
    ${nav('side')}
    <main class="main">
      <header class="topbar">
        <h1>${current[1]}</h1>
        ${route !== 'anasayfa' && html`<button class="btn sm ghost" onClick=${() => go('anasayfa')}><${Icon} name="home" size=${18} /> Ana sayfa</button>`}
      </header>
      ${waitingWorker && html`<div class="alert info update-bar"><${Icon} name="refresh" />
        <span class="grow">Uygulamanın yeni sürümü hazır.</span><button class="btn primary" onClick=${applyUpdate}>Şimdi güncelle</button></div>`}
      <div class="content"><${Page} key=${key} params=${params} /></div>
    </main>
    ${nav('bottom')}
    ${ui.sheets.map((sh) => html`<div key=${sh.id} class="sheet-layer">${sh.render()}</div>`)}
    ${ui.dialog && html`<${Dialog} d=${ui.dialog} key=${ui.dialog.title} />`}
    ${ui.toast && html`<div class=${'toast ' + ui.toast.kind} key=${ui.toast.id}>${ui.toast.text}</div>`}
  </div>`;
}

load().then(() => {
  render(html`<${App} />`, document.getElementById('root'));
  document.getElementById('boot')?.remove();
});
registerSW();
