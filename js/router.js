// Basit adres (hash) yönlendirmesi: #/kayitlar?account=KASA
import { useState, useEffect } from '../vendor/preact-htm.js';

export const ROUTES = ['anasayfa', 'kayitlar', 'odemeler', 'borclar', 'cari', 'raporlar', 'ayarlar'];

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const route = ROUTES.includes(path) ? path : 'anasayfa';
  return { route, params: Object.fromEntries(new URLSearchParams(qs || '')), key: h };
}

export function go(route, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  location.hash = `#/${route}${qs ? '?' + qs : ''}`;
}

export function useRoute() {
  const [r, set] = useState(parseHash);
  useEffect(() => {
    const f = () => { set(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}
