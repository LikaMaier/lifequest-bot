// Графики на чистом SVG: столбики, линия, горизонтальные полосы, тепловая карта.
// Одна серия — один цвет; подписи — цветом текста, не цветом серии;
// у каждого графика есть подсказка по нажатию и скрытая таблица для скринридеров.

import { h, svgEl, esc, fmtDay, weekday, parseDate } from './dom.js';
import { haptic } from './tg.js';

const INK = '#2C2A22';
const MUTED = '#8A8365';
const GRID = '#E9DFB8';

function srTable(caption, headers, rows) {
  return h('table', { class: 'sr-only' }, h('caption', null, caption),
    h('thead', null, h('tr', null, headers.map(t => h('th', { scope: 'col' }, t)))),
    h('tbody', null, rows.map(r => h('tr', null, r.map(c => h('td', null, String(c)))))));
}

/** Подсказка над графиком: показывается по наведению или нажатию на метку. */
function withTooltip(container, svgWrap, describe) {
  const tip = h('div', { class: 'chart-tip', role: 'status', 'aria-live': 'polite', hidden: true });
  container.append(tip);
  let active = null;
  const show = target => {
    const i = Number(target.dataset.i);
    if (Number.isNaN(i)) return;
    if (active) active.classList.remove('is-active');
    active = target;
    target.classList.add('is-active');
    tip.textContent = describe(i);
    tip.hidden = false;
    const cb = container.getBoundingClientRect();
    const tb = target.getBoundingClientRect();
    const x = Math.min(Math.max(tb.left + tb.width / 2 - cb.left, 50), cb.width - 50);
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(tb.top - cb.top - 8, 0)}px`;
  };
  const hide = () => { tip.hidden = true; if (active) active.classList.remove('is-active'); active = null; };
  svgWrap.addEventListener('pointerover', e => { const t = e.target.closest('[data-i]'); if (t) show(t); });
  svgWrap.addEventListener('pointerleave', hide);
  svgWrap.addEventListener('click', e => { const t = e.target.closest('[data-i]'); if (t) { haptic.select(); show(t); } });
}

/** Столбики по дням. data: [{date, count}] */
export function barChart(data, { height = 150, color = 'var(--accent-deep)', compact = false, label = 'Выполнено по дням' } = {}) {
  const W = 320, H = height, padB = compact ? 20 : 24, padT = 14;
  const max = Math.max(1, ...data.map(d => d.count));
  const n = data.length;
  const slot = W / n;
  const bw = Math.max(3, Math.min(compact ? 22 : 16, slot - 4));
  const plotH = H - padB - padT;
  let bars = '';
  data.forEach((d, i) => {
    const x = i * slot + (slot - bw) / 2;
    const bh = d.count ? Math.max(4, (d.count / max) * plotH) : 0;
    const y = H - padB - bh;
    // невидимая зона нажатия выше и шире столбика
    bars += `<g data-i="${i}" class="hit"><rect x="${i * slot}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent"/>`;
    if (bh) bars += `<path d="M${x} ${H - padB} V${y + 4} q0 -4 4 -4 h${bw - 8} q4 0 4 4 V${H - padB} Z" fill="${color}"/>`;
    else bars += `<rect x="${x}" y="${H - padB - 2}" width="${bw}" height="2" rx="1" fill="${GRID}"/>`;
    bars += '</g>';
  });
  const step = n <= 7 ? 1 : n <= 14 ? 2 : n <= 31 ? 5 : Math.ceil(n / 6);
  let labels = '';
  data.forEach((d, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const t = n <= 7 ? weekday(d.date) : String(parseDate(d.date).getDate());
    labels += `<text x="${i * slot + slot / 2}" y="${H - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="${MUTED}">${esc(t)}</text>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}">
    <line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="${GRID}" stroke-width="1"/>
    ${data.some(d => d.count) ? `<text x="0" y="10" font-size="10" font-weight="700" fill="${MUTED}">макс. ${max}</text>` : ""}
    ${bars}${labels}</svg>`;
  const wrap = svgEl(svg, 'chart-svg');
  const box = h('div', { class: 'chart' }, wrap,
    srTable(label, ['Дата', 'Выполнено'], data.map(d => [fmtDay(d.date), d.count])));
  withTooltip(box, wrap, i => `${fmtDay(data[i].date)}: ${data[i].count} ${data[i].count === 1 ? 'задание' : 'заданий'}`);
  return box;
}

/** Линия накопленного итога. data: [{date, count}] */
export function lineChart(data, { height = 150, color = 'var(--accent-deep)', label = 'Всего выполнено, накопительно' } = {}) {
  const W = 320, H = height, padB = 24, padT = 16, padX = 6;
  let acc = 0;
  const pts = data.map(d => (acc += d.count));
  const max = Math.max(1, acc);
  const n = data.length;
  const x = i => padX + (n === 1 ? 0 : (i * (W - padX * 2)) / (n - 1));
  const y = v => H - padB - (v / max) * (H - padB - padT);
  const path = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(n - 1).toFixed(1)} ${H - padB} L${x(0).toFixed(1)} ${H - padB} Z`;
  let hits = '';
  const slot = (W - padX * 2) / Math.max(1, n - 1);
  pts.forEach((v, i) => {
    hits += `<g data-i="${i}" class="hit"><rect x="${x(i) - slot / 2}" y="0" width="${slot}" height="${H - padB}" fill="transparent"/>`
      + `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="5" fill="${color}" stroke="#FFFDF5" stroke-width="2"/></g>`;
  });
  const step = n <= 7 ? 1 : n <= 14 ? 2 : n <= 31 ? 5 : Math.ceil(n / 6);
  let labels = '';
  data.forEach((d, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const t = n <= 7 ? weekday(d.date) : String(parseDate(d.date).getDate());
    labels += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="${MUTED}">${esc(t)}</text>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}">
    <line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="${GRID}" stroke-width="1"/>
    <path d="${area}" fill="${color}" opacity=".12"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="${x(n - 1)}" y="${Math.max(12, y(acc) - 10)}" text-anchor="end" font-size="11" font-weight="800" fill="${INK}">${acc}</text>
    ${hits}${labels}</svg>`;
  const wrap = svgEl(svg, 'chart-svg line');
  const box = h('div', { class: 'chart' }, wrap,
    srTable(label, ['Дата', 'Всего'], data.map((d, i) => [fmtDay(d.date), pts[i]])));
  withTooltip(box, wrap, i => `${fmtDay(data[i].date)}: всего ${pts[i]} (+${data[i].count} за день)`);
  return box;
}

/** Горизонтальные полосы: [{label, value, tag}] — tag: DOM-метка слева. */
export function hbars(rows, { label = 'Распределение' } = {}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  const box = h('div', { class: 'hbars', role: 'list', 'aria-label': label },
    rows.map(r => h('div', { class: 'hbar-row', role: 'listitem', 'aria-label': `${r.label}: ${r.value}` },
      h('div', { class: 'hbar-label' }, r.tag || r.label),
      h('div', { class: 'hbar-track', 'aria-hidden': 'true' },
        h('span', { style: { width: `${r.value ? Math.max(3, (r.value / max) * 100) : 0}%` } })),
      h('div', { class: 'hbar-value num' }, String(r.value)))));
  return box;
}

/** Тепловая карта месяца (пн–вс). data: [{date, count}] */
export function heatmap(data, { label = 'Активность за месяц', today = '' } = {}) {
  const first = parseDate(data[0].date);
  const offset = (first.getDay() + 6) % 7; // понедельник = 0
  const levels = c => (c <= 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : c <= 4 ? 3 : 4);
  const grid = h('div', { class: 'heat-grid', role: 'grid', 'aria-label': label },
    ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(d => h('div', { class: 'heat-head', 'aria-hidden': 'true' }, d)),
    Array.from({ length: offset }, () => h('div', { 'aria-hidden': 'true' })),
    data.map(d => h('div', {
      class: `heat-cell l${levels(d.count)} ${d.date === today ? 'today' : ''}`, role: 'gridcell', tabindex: '0',
      'aria-label': `${fmtDay(d.date)}: ${d.count}`, title: `${fmtDay(d.date)}: ${d.count}`,
    }, String(parseDate(d.date).getDate()))));
  const legend = h('div', { class: 'heat-legend', 'aria-hidden': 'true' }, 'меньше',
    [0, 1, 2, 3, 4].map(l => h('span', { class: `heat-cell l${l}` })), 'больше');
  return h('div', null, grid, legend);
}
