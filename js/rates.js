// Döviz ve altın kurlarını internetten çeker. İnternet yoksa son kaydedilen kurlar kullanılır.
import { S, setSetting } from './store.js';

const OZ_GRAM = 31.1034768;

async function getJSON(url, ms = 9000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const n = (v) => {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const x = parseFloat(s);
  return isFinite(x) ? x : 0;
};

/** Türkiye piyasa kurları (gram altın dahil). */
async function fromTruncgil() {
  const j = await getJSON('https://finans.truncgil.com/v4/today.json');
  const pick = (o) => n(o?.Buying ?? o?.Alış ?? o?.alis);
  const USD = pick(j.USD), EUR = pick(j.EUR), XAU = pick(j.GRA || j['gram-altin']);
  if (!(USD > 0 && EUR > 0 && XAU > 0)) throw new Error('eksik veri');
  return { USD, EUR, XAU, source: 'Truncgil Finans' };
}

/** Yedek kaynak: uluslararası kurlar + ons altından gram altın hesabı. */
async function fromGlobal() {
  const [fx, gold] = await Promise.all([
    getJSON('https://open.er-api.com/v6/latest/USD'),
    getJSON('https://api.gold-api.com/price/XAU'),
  ]);
  const USD = n(fx?.rates?.TRY);
  const EUR = USD / n(fx?.rates?.EUR);
  const XAU = (n(gold?.price) / OZ_GRAM) * USD;
  if (!(USD > 0 && EUR > 0 && XAU > 0)) throw new Error('eksik veri');
  return { USD, EUR, XAU, source: 'Uluslararası piyasa' };
}

let running = null;

export function refreshRates({ force = false } = {}) {
  const r = S.settings.rates;
  const fresh = r.at && Date.now() - new Date(r.at).getTime() < 30 * 60 * 1000;
  if (!force && fresh) return Promise.resolve(r);
  if (!navigator.onLine) return Promise.reject(new Error('İnternet bağlantısı yok'));
  return (running ||= (async () => {
    try {
      let res;
      try { res = await fromTruncgil(); } catch { res = await fromGlobal(); }
      const rates = {
        USD: Math.round(res.USD * 10000) / 10000,
        EUR: Math.round(res.EUR * 10000) / 10000,
        XAU: Math.round(res.XAU * 100) / 100,
        at: new Date().toISOString(),
        source: res.source,
      };
      setSetting({ rates });
      return rates;
    } finally {
      running = null;
    }
  })());
}

export function setManualRates(patch) {
  setSetting({ rates: { ...S.settings.rates, ...patch, at: new Date().toISOString(), source: 'Elle girildi' } });
}
