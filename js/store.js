// Uygulama durumu: tüm veriler bellekte tutulur ve tabletin IndexedDB'sine kaydedilir.
import { useState, useEffect } from '../vendor/preact-htm.js';
import { DEFAULT_TYPES, DEFAULT_COUNTERS } from './model.js';

const DB_NAME = 'muhasebe';
const STORE = 'kv';
let dbp;

function openDB() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function idb(mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
const idbGet = (k) => idb('readonly', (s) => s.get(k));
const idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k));

export const DEFAULT_SETTINGS = {
  bigText: false,
  displayCur: 'TRY',
  autoRates: true,
  rates: { USD: 0, EUR: 0, XAU: 0, at: null, source: '' },
  pinHash: null,
  lastBackup: null,
  lockMinutes: 5,
};

const KEYS = ['tx', 'accounts', 'types', 'counters', 'payments', 'cari', 'settings'];

export const S = {
  tx: [],        // ana kasa kayıtları
  accounts: [],  // sorumluluk merkezleri (kasa, banka, kart...)
  types: [],     // gelir/gider türleri
  counters: [],  // karşı hesaplar
  payments: [],  // yaklaşan ödemeler
  cari: [],      // cari borç/alacak hareketleri
  settings: { ...DEFAULT_SETTINGS },
  ready: false,
  version: 0,
};

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
function emit() {
  S.version++;
  listeners.forEach((f) => f());
}

const dirty = new Set();
let timer;
let saveError = null;
export const getSaveError = () => saveError;

/** Değişen koleksiyonları kaydet ve ekranı yenile. */
export function commit(...keys) {
  (keys.length ? keys : KEYS).forEach((k) => dirty.add(k));
  emit();
  clearTimeout(timer);
  timer = setTimeout(flush, 120);
}

export async function flush() {
  clearTimeout(timer);
  const ks = [...dirty];
  dirty.clear();
  try {
    for (const k of ks) await idbSet(k, S[k]);
    saveError = null;
  } catch (e) {
    console.error(e);
    saveError = e;
    ks.forEach((k) => dirty.add(k));
    emit();
  }
}

document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', () => flush());

export async function load() {
  try {
    for (const k of KEYS) {
      const v = await idbGet(k);
      if (v !== undefined) S[k] = v;
    }
  } catch (e) {
    console.error('Veri okunamadı', e);
    saveError = e;
  }
  S.settings = { ...DEFAULT_SETTINGS, ...S.settings, rates: { ...DEFAULT_SETTINGS.rates, ...(S.settings?.rates || {}) } };
  if (!S.types.length) S.types = DEFAULT_TYPES.map((t) => ({ ...t }));
  if (!S.counters.length) S.counters = [...DEFAULT_COUNTERS];
  if (!S.accounts.length) S.accounts = [{ name: 'KASA', kind: 'kasa', limit: 0, archived: false }];
  S.ready = true;
  // Tarayıcının verileri kendiliğinden silmemesi için kalıcı depolama iste.
  try { await navigator.storage?.persist?.(); } catch {}
  emit();
}

/** Tüm veri koleksiyonlarını değiştir (içe aktarma / sıfırlama). */
export function replaceAll(data) {
  for (const k of ['tx', 'accounts', 'types', 'counters', 'payments', 'cari']) {
    if (data[k]) S[k] = data[k];
  }
  if (data.settings) S.settings = { ...S.settings, ...data.settings };
  commit();
}

export function setSetting(patch) {
  S.settings = { ...S.settings, ...patch };
  commit('settings');
}

/** Bileşenin veri değiştiğinde yeniden çizilmesini sağlar. */
export function useStore() {
  const [, set] = useState(0);
  useEffect(() => subscribe(() => set((v) => v + 1)), []);
  return S;
}
