// Açılır paneller (Android geri tuşuyla kapanır), kısa bildirimler ve onay pencereleri.
import { useState, useEffect } from '../vendor/preact-htm.js';
import { uid } from './util.js';

let sheets = [];
let toastState = null;
let dialog = null;
let closing = false;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export function useUI() {
  const [, s] = useState(0);
  useEffect(() => {
    const f = () => s((v) => v + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return { sheets, toast: toastState, dialog };
}

/** Yeni panel açar. render: (close) => vnode */
export function openSheet(render) {
  sheets = [...sheets, { id: uid(), render }];
  history.pushState({ sheets: sheets.length }, '');
  emit();
}

/** En üstteki paneli başka bir panelle değiştirir (geçmişe dokunmadan). */
export function replaceSheet(render) {
  if (!sheets.length) return openSheet(render);
  sheets = [...sheets.slice(0, -1), { id: uid(), render }];
  emit();
}

export function closeSheet() {
  if (!sheets.length || closing) return;
  closing = true;
  history.back();
}

export function closeAllSheets() {
  if (!sheets.length) return;
  const n = sheets.length;
  closing = true;
  history.go(-n);
}

window.addEventListener('popstate', (e) => {
  closing = false;
  const n = e.state?.sheets || 0;
  if (dialog) { dialog.resolve(false); dialog = null; }
  if (sheets.length > n) {
    sheets = sheets.slice(0, n);
    emit();
  }
});

let toastTimer;
export function toast(text, kind = 'ok') {
  toastState = { text, kind, id: uid() };
  emit();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastState = null; emit(); }, 2800);
}

/** Onay penceresi. Promise<boolean> döner. */
export function ask({ title, text = '', ok = 'Tamam', cancel = 'Vazgeç', danger = false, input = null }) {
  return new Promise((resolve) => {
    dialog = {
      title, text, ok, cancel, danger, input,
      resolve: (v) => { dialog = null; emit(); resolve(v); },
    };
    emit();
  });
}
