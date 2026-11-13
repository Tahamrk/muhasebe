// PIN kilidi: açılış ekranı ve PIN belirleme.
import { html, useState } from '../../vendor/preact-htm.js';
import { S, setSetting, replaceAll } from '../store.js';
import { Icon, Sheet } from '../components.js';
import { openSheet, closeSheet, toast, ask } from '../ui.js';
import { DEFAULT_TYPES, DEFAULT_COUNTERS } from '../model.js';

export async function hashPin(pin) {
  const text = 'kisisel-muhasebe:' + pin;
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0;
  for (const ch of text) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return 'x' + h;
}

function PinPad({ value, onChange, onDone, length = 4, error }) {
  const press = (d) => {
    if (value.length >= length) return;
    const v = value + d;
    onChange(v);
    if (v.length === length) setTimeout(() => onDone(v), 120);
  };
  return html`<div class="pinpad">
    <div class=${'pin-dots' + (error ? ' shake' : '')}>${Array.from({ length }, (_, i) => html`<span class=${i < value.length ? 'on' : ''}></span>`)}</div>
    <div class="pin-keys">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => html`<button type="button" onClick=${() => press(String(d))}>${d}</button>`)}
      <span></span>
      <button type="button" onClick=${() => press('0')}>0</button>
      <button type="button" class="pin-del" onClick=${() => onChange(value.slice(0, -1))} aria-label="Sil"><${Icon} name="left" /></button>
    </div>
  </div>`;
}

export function LockScreen({ onUnlock }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState(false);
  const check = async (pin) => {
    if ((await hashPin(pin)) === S.settings.pinHash) onUnlock();
    else { setErr(true); setTimeout(() => { setErr(false); setV(''); }, 500); }
  };
  const forgot = async () => {
    const v = await ask({
      title: 'PIN\'i unuttum',
      text: 'PIN sıfırlanamaz; tek yol uygulamayı sıfırlamaktır. Bu işlem tabletteki TÜM verileri siler. Sonra son Excel yedeğinizi geri yükleyebilirsiniz. Devam etmek için kutuya SIFIRLA yazın.',
      input: '', ok: 'Uygulamayı sıfırla', danger: true,
    });
    if (v === false) return;
    if (v.toLocaleUpperCase('tr-TR') !== 'SIFIRLA') return toast('SIFIRLA yazılmadığı için iptal edildi', 'err');
    replaceAll({ tx: [], cari: [], payments: [], debts: [], accounts: [{ name: 'KASA', kind: 'kasa', limit: 0, archived: false }], types: DEFAULT_TYPES.map((t) => ({ ...t })), counters: [...DEFAULT_COUNTERS], settings: { pinHash: null, lastBackup: null } });
    onUnlock();
  };
  return html`<div class="lock">
    <div class="lock-box">
      <div class="lock-logo"><${Icon} name="lock" size=${34} /></div>
      <h2>Kişisel Muhasebe</h2>
      <p class="muted">PIN kodunuzu girin</p>
      <${PinPad} value=${v} onChange=${setV} onDone=${check} error=${err} />
      <button class="link mt16" onClick=${forgot}>PIN'i unuttum</button>
    </div>
  </div>`;
}

function PinSetup() {
  const [step, setStep] = useState(1);
  const [first, setFirst] = useState('');
  const [v, setV] = useState('');
  const [err, setErr] = useState(false);
  const done = async (pin) => {
    if (step === 1) { setFirst(pin); setV(''); setStep(2); return; }
    if (pin !== first) {
      setErr(true);
      setTimeout(() => { setErr(false); setV(''); setStep(1); setFirst(''); }, 600);
      toast('PIN\'ler aynı değil, tekrar deneyin', 'err');
      return;
    }
    setSetting({ pinHash: await hashPin(pin) });
    toast('PIN kaydedildi');
    closeSheet();
  };
  return html`<${Sheet} title="PIN belirle">
    <div class="lock-box">
      <p><b>${step === 1 ? 'Yeni 4 haneli PIN girin' : 'PIN\'i tekrar girin'}</b></p>
      <${PinPad} value=${v} onChange=${setV} onDone=${done} error=${err} />
      <p class="muted small">PIN'i unutursanız uygulama sıfırlanmak zorunda kalır; verileri Excel yedeğinden geri yüklersiniz. Bu yüzden düzenli yedek alın.</p>
    </div>
  </${Sheet}>`;
}

export const openPinSetup = () => openSheet(() => html`<${PinSetup} />`);
