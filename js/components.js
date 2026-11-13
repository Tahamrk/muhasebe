// Ortak arayüz bileşenleri.
import { html, useState, useRef, useEffect } from '../vendor/preact-htm.js';
import { money, parseNum, CUR_LABEL, upper } from './util.js';
import { closeSheet } from './ui.js';

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-3M12 16V9M17 16V5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  out: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  in: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  swap: '<path d="M4 7h14l-4-4M20 17H6l4 4"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15v4M20 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M16 11h5v6h-5a3 3 0 0 1 0-6z"/>',
  bank: '<path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-7 10 7z"/>',
  safe: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 9V8M7 20v1M17 20v1"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  filter: '<path d="M3 5h18l-7 9v5l-4 2v-7z"/>',
  text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

export function Icon({ name, size = 22, cls = '' }) {
  return html`<svg class=${'ico ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;
}

export function Money({ v, cur = 'TRY', color = true, sign = false, short = false, cls = '' }) {
  const c = color ? (v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : '') : '';
  return html`<span class=${`money ${c} ${cls}`}>${money(v, cur, { sign, short })}</span>`;
}

export function Seg({ value, options, onChange, cls = '' }) {
  return html`<div class=${'seg ' + cls} role="tablist">
    ${options.map(([v, label]) => html`<button type="button" role="tab" aria-selected=${value === v}
      class=${value === v ? 'on' : ''} onClick=${() => onChange(v)}>${label}</button>`)}
  </div>`;
}

export function Field({ label, hint, error, children, cls = '' }) {
  return html`<label class=${'field ' + cls}>
    ${label && html`<span class="flabel">${label}</span>`}
    ${children}
    ${error ? html`<span class="ferr">${error}</span>` : hint ? html`<span class="fhint">${hint}</span>` : null}
  </label>`;
}

export function AmountField({ label = 'Tutar', value, onChange, cur = 'TRY', autofocus = false, error }) {
  const ref = useRef();
  useEffect(() => { if (autofocus) setTimeout(() => ref.current?.focus({ preventScroll: true }), 250); }, []);
  const n = parseNum(value);
  return html`<${Field} label=${label} error=${error}
      hint=${value ? `= ${money(n, cur)}` : CUR_LABEL[cur] === 'Altın' ? 'Gram olarak yazın' : 'Örn: 1.250,50'}>
    <div class="amount-wrap">
      <input ref=${ref} class="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"
        value=${value} onInput=${(e) => onChange(e.target.value)} />
      <span class="amount-cur">${cur === 'XAU' ? 'gr' : cur === 'TRY' ? '₺' : cur === 'USD' ? '$' : '€'}</span>
    </div>
  </${Field}>`;
}

export function CurSeg({ value, onChange }) {
  return html`<${Seg} value=${value} onChange=${onChange}
    options=${[['TRY', '₺ TL'], ['USD', '$ USD'], ['EUR', '€ EURO'], ['XAU', 'Altın gr']]} />`;
}

/**
 * Dokunmatik seçici: en sık kullanılanlar düğme olarak, gerisi "Tümü" listesinde, yenisi eklenebilir.
 */
export function Picker({ label, value, onChange, items, top = 10, allowNew = true, newLabel = 'Yeni ekle', error, hint }) {
  const [more, setMore] = useState(false);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [nv, setNv] = useState('');
  const shown = items.slice(0, top);
  if (value && !shown.includes(value)) shown.push(value);
  const filtered = q ? items.filter((i) => i.includes(upper(q))) : items;

  const choose = (v) => { onChange(v); setMore(false); setQ(''); };
  const addNew = () => {
    const v = upper(nv);
    if (!v) return;
    onChange(v);
    setAdding(false);
    setNv('');
    setMore(false);
  };

  return html`<div class="field">
    ${label && html`<span class="flabel">${label}</span>`}
    <div class="chips">
      ${shown.map((i) => html`<button type="button" class=${'chip' + (i === value ? ' on' : '')} onClick=${() => choose(i)}>${i}</button>`)}
      ${items.length > top && html`<button type="button" class="chip ghost" onClick=${() => setMore(!more)}>
        ${more ? 'Kapat' : `Tümü (${items.length})`} <${Icon} name=${more ? 'x' : 'down'} size=${16} /></button>`}
      ${allowNew && html`<button type="button" class="chip ghost" onClick=${() => setAdding(!adding)}><${Icon} name="plus" size=${16} /> ${newLabel}</button>`}
    </div>
    ${adding && html`<div class="row gap mt8">
      <input class="grow" type="text" placeholder="Yeni ad yazın" value=${nv} autofocus
        onInput=${(e) => setNv(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && (e.preventDefault(), addNew())} />
      <button type="button" class="btn primary" onClick=${addNew}>Ekle</button>
    </div>`}
    ${more && html`<div class="picker-more">
      <input type="search" placeholder="Ara..." value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="chips scroll">
        ${filtered.map((i) => html`<button type="button" class=${'chip' + (i === value ? ' on' : '')} onClick=${() => choose(i)}>${i}</button>`)}
        ${!filtered.length && html`<span class="muted">Bulunamadı</span>`}
      </div>
    </div>`}
    ${error ? html`<span class="ferr">${error}</span>` : hint ? html`<span class="fhint">${hint}</span>` : null}
  </div>`;
}

export function Sheet({ title, children, footer, onClose = closeSheet }) {
  return html`<div class="sheet-wrap" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <section class="sheet" role="dialog" aria-label=${title}>
      <header class="sheet-head">
        <button class="icon-btn" onClick=${onClose} aria-label="Kapat"><${Icon} name="left" /></button>
        <h2>${title}</h2>
      </header>
      <div class="sheet-body">${children}</div>
      ${footer && html`<footer class="sheet-foot">${footer}</footer>`}
    </section>
  </div>`;
}

export function Empty({ icon = 'info', title, text, children }) {
  return html`<div class="empty">
    <${Icon} name=${icon} size=${40} />
    <h3>${title}</h3>
    ${text && html`<p>${text}</p>`}
    ${children}
  </div>`;
}

export function Toggle({ checked, onChange, label, hint }) {
  return html`<label class="toggle-row">
    <span><b>${label}</b>${hint && html`<small>${hint}</small>`}</span>
    <input type="checkbox" class="switch" checked=${checked} onChange=${(e) => onChange(e.target.checked)} />
  </label>`;
}
