// Grafikli raporlar: aylık gelir-gider, türe / karşı hesaba / hesaba göre dağılım.
import { html, useState, useMemo, useRef, useEffect } from '../../vendor/preact-htm.js';
import { S } from '../store.js';
import { PERIODS, periodRange, MONTHS_SHORT, money, todayStr } from '../util.js';
import { flowRows, sumFlow, groupFlow, monthlyFlow, toDisplay, hasRates } from '../model.js';
import { Icon, Seg, Empty } from '../components.js';
import { DisplayMoney } from './home.js';
import { go } from '../router.js';

let chartP;
function loadChart() {
  return (chartP ||= new Promise((res, rej) => {
    if (window.Chart) return res(window.Chart);
    const s = document.createElement('script');
    s.src = 'vendor/chart.umd.js';
    s.onload = () => res(window.Chart);
    s.onerror = () => { chartP = null; rej(new Error('Grafik modülü yüklenemedi')); };
    document.head.appendChild(s);
  }));
}

function ChartBox({ config, height = 280 }) {
  const ref = useRef();
  const key = JSON.stringify(config.data);
  useEffect(() => {
    let chart, dead = false;
    loadChart().then((Chart) => {
      if (dead || !ref.current) return;
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.font.size = 13;
      Chart.defaults.color = '#5b6763';
      chart = new Chart(ref.current, config);
    });
    return () => { dead = true; chart?.destroy(); };
  }, [key]);
  return html`<div class="chart-box" style=${`height:${height}px`}><canvas ref=${ref}></canvas></div>`;
}

const fmtShort = (v) => new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

function Breakdown({ title, items, field, range, color }) {
  const total = items.reduce((s, i) => s + i.total, 0);
  if (!items.length) return null;
  const top = items.slice(0, 12);
  const cur = S.settings.displayCur;
  return html`<section class="card pad report-sec">
    <h3>${title}</h3>
    <${ChartBox} height=${Math.max(160, top.length * 34 + 30)} config=${{
      type: 'bar',
      data: { labels: top.map((i) => i.name), datasets: [{ data: top.map((i) => Math.round(toDisplay(i.total))), backgroundColor: color, borderRadius: 6, maxBarThickness: 26 }] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.raw, cur) } } },
        scales: { x: { ticks: { callback: fmtShort }, grid: { color: '#eef1f0' } }, y: { grid: { display: false } } },
      },
    }} />
    <table class="rep-table">
      <tbody>${items.map((i) => html`<tr onClick=${() => go('kayitlar', { [field]: i.name, period: 'custom', from: range[0], to: range[1] })}>
        <td>${i.name}</td>
        <td class="pct"><span class="pbar"><span style=${`width:${(i.total / total) * 100}%;background:${color}`}></span></span>${((i.total / total) * 100).toFixed(1)}%</td>
        <td class="num"><${DisplayMoney} tl=${i.total} color=${false} /></td>
        <td class="go"><${Icon} name="right" size=${16} /></td>
      </tr>`)}</tbody>
      <tfoot><tr><td>Toplam</td><td></td><td class="num"><${DisplayMoney} tl=${total} color=${false} /></td><td></td></tr></tfoot>
    </table>
  </section>`;
}

export function Reports() {
  const [period, setPeriod] = useState('thisMonth');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const years = useMemo(() => {
    const ys = new Set(S.tx.map((t) => t.date.slice(0, 4)));
    ys.add(todayStr().slice(0, 4));
    return [...ys].sort().reverse();
  }, [S.version]);
  const [year, setYear] = useState(years[0]);
  const range = periodRange(period, custom);
  const rows = useMemo(() => flowRows(range), [S.version, range[0], range[1]]);
  const sum = sumFlow(rows);
  const months = useMemo(() => monthlyFlow(year), [S.version, year]);
  const cur = S.settings.displayCur;

  if (!S.tx.length) return html`<div class="page"><${Empty} icon="chart" title="Rapor için kayıt yok" text="Kayıt ekledikçe grafikler burada oluşur." /></div>`;

  return html`<div class="page">
    <div class="period-bar">
      <select value=${period} onChange=${(e) => setPeriod(e.target.value)} class="period-select">
        ${PERIODS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
      </select>
      ${period === 'custom' && html`<input type="date" value=${custom.from} onInput=${(e) => setCustom({ ...custom, from: e.target.value })} />
        <span>–</span><input type="date" value=${custom.to} onInput=${(e) => setCustom({ ...custom, to: e.target.value })} />`}
    </div>
    ${!hasRates() && html`<div class="alert warn"><${Icon} name="info" /> Döviz ve altın kayıtları, kur bilgisi olmadığı için raporlarda 0 sayılıyor.</div>`}
    <div class="kpis three">
      <div class="kpi"><small>Gelir</small><${DisplayMoney} tl=${sum.gelir} cls="lg pos" color=${false} /></div>
      <div class="kpi"><small>Gider</small><${DisplayMoney} tl=${sum.gider} cls="lg neg" color=${false} /></div>
      <div class="kpi"><small>Fark</small><${DisplayMoney} tl=${sum.net} cls="lg" /></div>
    </div>

    <section class="card pad report-sec">
      <h3 class="row">Aylık gelir – gider <span class="grow"></span>
        <select value=${year} onChange=${(e) => setYear(e.target.value)} class="year-select">${years.map((y) => html`<option value=${y}>${y}</option>`)}</select></h3>
      <${ChartBox} config=${{
        type: 'bar',
        data: {
          labels: MONTHS_SHORT,
          datasets: [
            { label: 'Gelir', data: months.map((m) => Math.round(toDisplay(m.gelir))), backgroundColor: '#2e9b5f', borderRadius: 5 },
            { label: 'Gider', data: months.map((m) => Math.round(toDisplay(m.gider))), backgroundColor: '#d4553f', borderRadius: 5 },
          ],
        },
        options: {
          maintainAspectRatio: false, animation: false,
          plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw, cur)}` } } },
          scales: { y: { ticks: { callback: fmtShort }, grid: { color: '#eef1f0' } }, x: { grid: { display: false } } },
        },
      }} />
    </section>

    ${!rows.length && html`<${Empty} icon="chart" title="Bu dönemde gelir/gider kaydı yok" />`}
    <div class="report-grid">
      <${Breakdown} title="Giderler – türe göre" items=${groupFlow(rows, 'type', 'gider')} field="type" range=${range} color="#d4553f" />
      <${Breakdown} title="Giderler – kim / ne için" items=${groupFlow(rows, 'counter', 'gider')} field="counter" range=${range} color="#c27a2d" />
      <${Breakdown} title="Giderler – hangi hesap / kartla" items=${groupFlow(rows, 'account', 'gider')} field="account" range=${range} color="#2f6fb3" />
      <${Breakdown} title="Gelirler – türe göre" items=${groupFlow(rows, 'type', 'gelir')} field="type" range=${range} color="#2e9b5f" />
    </div>
    <p class="muted small">Not: Transfer, kart ödemesi, devreden, döviz alım-satım ve cari gibi türler gelir/gider sayılmaz. Hangi türlerin rapora gireceğini Ayarlar > Listeler bölümünden değiştirebilirsiniz.${cur !== 'TRY' ? ' USD tutarlar güncel kurla hesaplanır.' : ''}</p>
  </div>`;
}
