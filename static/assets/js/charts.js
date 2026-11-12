// Графики на чистом SVG: столбики, линия, горизонтальные полосы, тепловая карта.
// Одна серия — один цвет; подписи — цветом текста, не цветом серии;
// у каждого графика есть подсказка по нажатию и скрытая таблица для скринридеров.

import { h, svgEl, esc, fmtDay, weekday, parseDate } from './dom.js';
import { haptic } from './tg.js';

const INK = 'var(--ink)';
const MUTED = 'var(--muted)';
const GRID = 'var(--line)';

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
    const half = tip.offsetWidth / 2 + 2;
    const x = Math.min(Math.max(tb.left + tb.width / 2 - cb.left, half), cb.width - half);
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
      + `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="5" fill="${color}" stroke="var(--white)" stroke-width="2"/></g>`;
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

/** Столбики «что сделано по дням»: привычки, дела и квесты стопкой разными цветами.
 *  data: [{date, habits, plans, quests}]. Длинные периоды складываются по неделям. */
export const ACTIVITY_COLORS = { habits: '#8CC63F', plans: '#5B7FD1', quests: '#F3619C' };
export const ACTIVITY_LABELS = { habits: 'привычки', plans: 'дела', quests: 'квесты' };

export function stackedBars(data, { height = 150, label = 'Сделано по дням' } = {}) {
  let cols = data.map(d => ({ ...d, from: d.date }));
  if (cols.length > 31) { // по неделям
    const weeks = [];
    for (let i = 0; i < cols.length; i += 7) {
      const part = cols.slice(i, i + 7);
      weeks.push({ date: part[0].date, from: part[0].date, to: part[part.length - 1].date,
        habits: part.reduce((s, x) => s + x.habits, 0), plans: part.reduce((s, x) => s + x.plans, 0), quests: part.reduce((s, x) => s + x.quests, 0) });
    }
    cols = weeks;
  }
  const keys = ['habits', 'plans', 'quests'];
  const total = c => keys.reduce((s, k) => s + c[k], 0);
  const W = 320, H = height, padB = 24, padT = 14;
  const max = Math.max(1, ...cols.map(total));
  const n = cols.length, slot = W / n;
  const bw = Math.max(4, Math.min(22, slot - 4));
  const plotH = H - padB - padT;
  let bars = '';
  cols.forEach((c, i) => {
    const x = i * slot + (slot - bw) / 2;
    bars += `<g data-i="${i}" class="hit"><rect x="${i * slot}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent"/>`;
    const t = total(c);
    if (!t) bars += `<rect x="${x}" y="${H - padB - 2}" width="${bw}" height="2" rx="1" fill="${GRID}"/>`;
    let y = H - padB;
    const full = Math.max(5, (t / max) * plotH);
    keys.forEach(k => {
      if (!c[k]) return;
      const hh = full * c[k] / t;
      y -= hh;
      bars += `<rect x="${x}" y="${y}" width="${bw}" height="${hh}" fill="${ACTIVITY_COLORS[k]}"/>`;
    });
    if (t) bars += `<rect x="${x}" y="${y}" width="${bw}" height="${full}" rx="4" fill="none" stroke="var(--ink)" stroke-width="1.5"/>`;
    bars += '</g>';
  });
  const step = n <= 7 ? 1 : n <= 14 ? 2 : n <= 31 ? 5 : Math.ceil(n / 6);
  let labels = '';
  cols.forEach((c, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const t = n <= 7 ? weekday(c.date) : String(parseDate(c.date).getDate());
    labels += `<text x="${i * slot + slot / 2}" y="${H - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="${MUTED}">${esc(t)}</text>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}">
    <line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="${GRID}" stroke-width="1"/>${bars}${labels}</svg>`;
  const wrap = svgEl(svg, 'chart-svg');
  const box = h('div', { class: 'chart' }, wrap,
    srTable(label, ['Дата', 'Привычки', 'Дела', 'Квесты'], cols.map(c => [fmtDay(c.date), c.habits, c.plans, c.quests])));
  withTooltip(box, wrap, i => {
    const c = cols[i];
    const when = c.to ? `${fmtDay(c.from)} – ${fmtDay(c.to)}` : fmtDay(c.date);
    return `${when}: 🌱 ${c.habits} · 📅 ${c.plans} · 🎯 ${c.quests}`;
  });
  return box;
}

/** Банка с конфетками: каждое сделанное за период — конфета в обёртке цвета своей
 *  плашки (привычки, дела, квесты), XP — золотые звёздочки (одна за 20 XP).
 *  Конфеты ложатся по дням снизу вверх, при открытии экрана сыплются в банку. */
const CANDY = { habits: '#8CC63F', plans: '#5B7FD1', quests: '#F3619C', xp: '#E0B300' };
const XP_PER_STAR = 20, MAX_STARS = 15, JAR_MAX = 140;

function mix(hex, t) { // смешать цвет с белым: t=0 — цвет, t=1 — белый
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * t));
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function candySVG(kind, cx, cy, r, rot, i) {
  const c = CANDY[kind];
  const fill = `url(#cnd-${kind})`, edge = mix(c, 0.25), deep = mix(c, -0) ;
  if (kind === 'xp') { // звёздочка-мармеладка
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.5 : r * 1.05;
      pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
    }
    return `<g transform="rotate(${rot} ${cx} ${cy})"><polygon points="${pts.join(' ')}" fill="${fill}" stroke="${edge}" stroke-width="1.6" stroke-linejoin="round"/>`
      + `<circle cx="${cx - r * 0.25}" cy="${cy - r * 0.3}" r="${r * 0.16}" fill="#fff" opacity=".9"/></g>`;
  }
  const w = r * 1.25, hgt = r * 0.82; // тело конфеты
  const tw = r * 0.62; // хвостики обёртки
  return `<g transform="rotate(${rot} ${cx} ${cy})">`
    + `<path d="M${cx - w} ${cy} l${-tw} ${-hgt * 0.8} q${-2} ${hgt * 0.8} 0 ${hgt * 1.6} z" fill="${mix(c, 0.45)}" stroke="${edge}" stroke-width="1.5" stroke-linejoin="round"/>`
    + `<path d="M${cx + w} ${cy} l${tw} ${-hgt * 0.8} q${2} ${hgt * 0.8} 0 ${hgt * 1.6} z" fill="${mix(c, 0.45)}" stroke="${edge}" stroke-width="1.5" stroke-linejoin="round"/>`
    + `<ellipse cx="${cx}" cy="${cy}" rx="${w}" ry="${hgt}" fill="${fill}" stroke="${edge}" stroke-width="1.7"/>`
    + `<path d="M${cx - w * 0.55} ${cy - hgt * 0.45} q${w * 0.5} ${-hgt * 0.35} ${w * 1.05} 0" stroke="#fff" stroke-width="${Math.max(1.4, r * 0.18)}" fill="none" stroke-linecap="round" opacity=".9"/>`
    + (i % 3 === 0 ? `<path d="M${cx + w * 0.35} ${cy + hgt * 0.15} l${r * 0.12} ${r * 0.28} l${r * 0.28} ${r * 0.12} l${-r * 0.28} ${r * 0.12} l${-r * 0.12} ${r * 0.28} l${-r * 0.12} ${-r * 0.28} l${-r * 0.28} ${-r * 0.12} l${r * 0.28} ${-r * 0.12} z" fill="#fff" opacity=".85"/>` : '')
    + '</g>';
}

export function jarChart(series, { total = null, label = 'Банка сделанного' } = {}) {
  // Банка показывает уровень «примерно», а не точное число: полная банка — это
  // ~5 дел и привычек в день за период. Цвета — в тех же долях, что на самом деле.
  const all = [];
  let xpTotal = 0;
  for (const d of series) {
    for (const k of ['habits', 'plans', 'quests']) for (let n = 0; n < (d[k] || 0); n++) all.push(k);
    xpTotal += d.xp || 0;
  }
  const count = total ?? all.length;
  const fullAt = Math.max(5, series.length * 5);
  const FULL = 46; // столько конфет помещается в полную банку
  const want = all.length ? Math.max(3, Math.round(FULL * Math.min(1, all.length / fullAt))) : 0;
  const items = want ? Array.from({ length: want }, (_, i) => all[Math.floor(i * all.length / want)]) : [];
  const stars = Math.min(MAX_STARS, Math.round(want / 6), Math.floor(xpTotal / XP_PER_STAR));
  for (let i = 0; i < stars; i++) items.splice(Math.floor((i + 1) * items.length / (stars + 1)), 0, 'xp');
  const shown = items;
  const jx = 70, jw = 180, jy = 46, jh = 190;
  const ix = jx + 10, iw = jw - 20, ibottom = jy + jh - 10, itop = jy + 18;
  // размер: самые крупные конфеты, при которых все помещаются
  let r = 14;
  const cell = rr => ({ cw: rr * 3.3, ch: rr * 1.55 });
  for (; r > 4; r -= 0.5) {
    const { cw, ch } = cell(r);
    const cols = Math.max(1, Math.floor(iw / cw)), rows = Math.floor((ibottom - itop) / ch);
    if (cols * rows >= shown.length) break;
  }
  const { cw, ch } = cell(r);
  const cols = Math.max(1, Math.floor(iw / cw));
  let defs = '<defs>';
  for (const [k, c] of Object.entries(CANDY)) {
    defs += `<linearGradient id="cnd-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(c, 0.55)}"/><stop offset=".55" stop-color="${mix(c, 0.2)}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
  }
  defs += `<clipPath id="jar-in"><rect x="${jx + 4}" y="${jy + 4}" width="${jw - 8}" height="${jh - 8}" rx="26"/></clipPath></defs>`;
  let pile = '';
  shown.forEach((k, n) => {
    const row = Math.floor(n / cols), col = n % cols;
    const used = cols * cw;
    const cx = ix + (iw - used) / 2 + cw / 2 + col * cw + (row % 2 ? cw * 0.25 : -cw * 0.1) + (((n * 37) % 7) - 3) * 0.6;
    const cy = ibottom - ch / 2 - row * ch;
    const rot = ((n * 53) % 41) - 20; // как насыпались
    const delay = Math.min(n, 60) * 18;
    pile += `<g class="jar-ball" style="animation-delay:${delay}ms">${candySVG(k, cx, cy, r, rot, n)}</g>`;
  });
  // рамка рисунка — по банке, без пустых полей, чтобы банка была крупной
  const svg = `<svg viewBox="${jx - 8} ${jy - 30} ${jw + 16} ${jh + 44}" width="100%" role="img" aria-label="${esc(label)}: ${count}">${defs}
    <ellipse cx="${jx + jw / 2}" cy="${jy + jh + 4}" rx="${jw / 2 + 6}" ry="7" fill="rgba(44,42,34,.1)"/>
    <rect x="${jx}" y="${jy}" width="${jw}" height="${jh}" rx="30" fill="#F6F3FF" stroke="#2C2A22" stroke-width="3"/>
    <g clip-path="url(#jar-in)">${pile}</g>
    <path d="M${jx + 18} ${jy + 26} v58" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".85"/>
    <path d="M${jx + 18} ${jy + 96} v10" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".85"/>
    <rect x="${jx + 18}" y="${jy - 26}" width="${jw - 36}" height="24" rx="8" fill="#F2C94C" stroke="#2C2A22" stroke-width="3"/>
    <path d="M${jx + 30} ${jy - 18} h${jw - 60}" stroke="#FFE59A" stroke-width="3" stroke-linecap="round"/>
    <rect x="${jx + 10}" y="${jy - 4}" width="${jw - 20}" height="10" rx="5" fill="#E2D9B8" stroke="#2C2A22" stroke-width="2.5"/>
  </svg>`;
  const box = h('div', { class: 'chart jar-chart' }, svgEl(svg, 'chart-svg'),
    srTable(label, ['Что', 'Сколько'], ['habits', 'plans', 'quests'].map(k => [ACTIVITY_LABELS[k], all.filter(x => x === k).length])));
  // конфеты сыплются, когда банка показалась на экране
  const start = () => box.classList.add('go');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { start(); io.disconnect(); } }, { threshold: 0.35 });
    requestAnimationFrame(() => io.observe(box));
  } else start();
  return box;
}

/** Колесо баланса: сферы — лепестки по кругу, у каждого светящаяся дуга по доле сделанного
 *  относительно самой активной сферы; в центре — оценка баланса от 0 до 10
 *  (10 — все сферы прокачаны одинаково). spheres: [{key, name, count, color, emoji}]. */
export function balanceWheel(spheres, { label = 'Колесо баланса' } = {}) {
  const items = spheres.filter(x => x).slice(0, 8);
  const n = items.length;
  // Классическое «колесо жизни»: сектор заполняется от центра на долю, кольца-уровни, подписи снаружи
  const W = 360, C = 180, R1 = 100, R0 = 28, GAP = 0.045, CHIP = R1 + 28;
  const maxv = Math.max(1, ...items.map(x => x.count || 0));
  const fr = items.map(x => Math.min(1, (x.count || 0) / maxv));
  const score = n ? Math.round(10 * fr.reduce((a, b) => a + b, 0) / n * 10) / 10 : 0;
  const pol = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)];
  const f = v => v.toFixed(1);
  const wedge = (a0, a1, r0, r1) => {
    const [x0, y0] = pol(r1, a0), [x1, y1] = pol(r1, a1), [x2, y2] = pol(r0, a1), [x3, y3] = pol(r0, a0);
    const big = a1 - a0 > Math.PI ? 1 : 0;
    return `M${f(x0)} ${f(y0)} A${r1} ${r1} 0 ${big} 1 ${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} A${r0} ${r0} 0 ${big} 0 ${f(x3)} ${f(y3)} Z`;
  };
  let defs = `<radialGradient id="bwBg" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="var(--white)" stop-opacity=".95"/><stop offset="1" stop-color="var(--white)" stop-opacity=".55"/></radialGradient>
    <filter id="bwSoft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#2B2140" flood-opacity=".14"/></filter>
    <filter id="bwGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  let back = '', fill = '', chips = '';
  items.forEach((sp, i) => {
    const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2 + GAP / 2, a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2 - GAP / 2;
    const mid = (a0 + a1) / 2, key = sp.color || 'lav', col = `var(--${key})`, deep = `var(--${key}-deep)`;
    const [gx0, gy0] = pol(R0, mid), [gx1, gy1] = pol(R1, mid);
    defs += `<linearGradient id="bwg${i}" gradientUnits="userSpaceOnUse" x1="${f(gx0)}" y1="${f(gy0)}" x2="${f(gx1)}" y2="${f(gy1)}"><stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="${deep}"/></linearGradient>`;
    back += `<path d="${wedge(a0, a1, R0, R1)}" class="bw-bg" style="--c:${col}"/>`;
    const r = R0 + (R1 - R0) * fr[i];
    if (fr[i] > 0.02) fill += `<path d="${wedge(a0, a1, R0, r)}" class="bw-fill" fill="url(#bwg${i})" style="--c:${col};--d:${(i * 0.08).toFixed(2)}s"/>`;
    // кончик лепестка — светлая кромка
    if (fr[i] > 0.1) { const [tx0, ty0] = pol(r - 1, a0 + 0.02), [tx1, ty1] = pol(r - 1, a1 - 0.02); fill += `<path d="M${f(tx0)} ${f(ty0)} A${r - 1} ${r - 1} 0 0 1 ${f(tx1)} ${f(ty1)}" class="bw-tip-line"/>`; }
    const [cx, cy] = pol(CHIP, mid);
    const above = Math.sin(mid) < -0.3;
    const lx = cx, ly = above ? cy - 24 : cy + 31;
    const anchor = 'middle';
    chips += `<g class="bw-chip" style="--c:${col};--d:${(0.4 + i * 0.06).toFixed(2)}s"><circle cx="${f(cx)}" cy="${f(cy)}" r="17" class="bw-chip-c"/><text x="${f(cx)}" y="${f(cy + 6)}" text-anchor="middle" class="bw-emoji">${sp.emoji || '⭐'}</text>
      <text x="${f(lx)}" y="${f(ly)}" text-anchor="${anchor}" class="bw-label">${escBw(sp.name || sp.key)}</text>
      <text x="${f(lx)}" y="${f(ly + 12)}" text-anchor="${anchor}" class="bw-count">${sp.count || 0}</text></g>`;
  });
  const rings = [0.25, 0.5, 0.75].map(k => `<circle cx="${C}" cy="${C}" r="${f(R0 + (R1 - R0) * k)}" class="bw-ring"/>`).join('');
  const svg = `<svg viewBox="0 0 ${W} ${W}" class="bw-svg" role="img" aria-label="${label}: ${score} из 10"><defs>${defs}</defs>
    <circle cx="${C}" cy="${C}" r="${R1 + 8}" fill="url(#bwBg)" filter="url(#bwSoft)"/>
    ${back}${rings}${fill}
    <circle cx="${C}" cy="${C}" r="${R1}" class="bw-outer"/>
    <circle cx="${C}" cy="${C}" r="${R0 - 3}" class="bw-core" filter="url(#bwSoft)"/>
    <text x="${C}" y="${C + 5}" text-anchor="middle" class="bw-score"><tspan class="bw-score-n">${String(score).replace('.', ',')}</tspan></text>
    <text x="${C}" y="${C + 16}" text-anchor="middle" class="bw-score-l">из 10</text>
    ${chips}</svg>`;
  const wrap = document.createElement('div'); wrap.className = 'bw'; wrap.innerHTML = svg;
  const tip = n ? (score >= 8 ? 'Сферы в балансе — редкость, горжусь! ✨' : score >= 5 ? 'Хороший баланс. Подтяни самые тихие лепестки 🌱'
    : 'Перекос в одну сторону — возьми квест из тихой сферы 🎲') : 'Сделай первый квест — колесо оживёт';
  wrap.append(Object.assign(document.createElement('p'), { className: 'bw-tip', textContent: tip }));
  return wrap;
}
function escBw(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

/** Год одним взглядом: 53 недели × 7 дней, чем больше сделано — тем ярче. days: {iso: total}. */
export function yearHeatmap({ start, end, days = {} }, { label = 'Активность за год' } = {}) {
  const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
  const first = new Date(s); first.setDate(s.getDate() - ((s.getDay() + 6) % 7)); // с понедельника
  const weeks = Math.ceil(((e - first) / 864e5 + 1) / 7);
  const cell = 11, gap = 3, left = 26, top = 18;
  const W = left + weeks * (cell + gap), H = top + 7 * (cell + gap);
  const max = Math.max(1, ...Object.values(days));
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  let rects = '', months = '', lastM = -1;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const dt = new Date(first); dt.setDate(first.getDate() + w * 7 + d);
      if (dt < s || dt > e) continue;
      const iso = dt.toISOString().slice(0, 10);
      const v = days[iso] || 0;
      const lvl = !v ? 0 : v >= max * 0.75 ? 4 : v >= max * 0.5 ? 3 : v >= max * 0.25 ? 2 : 1;
      rects += `<rect x="${left + w * (cell + gap)}" y="${top + d * (cell + gap)}" width="${cell}" height="${cell}" rx="2.5" class="yh-c l${lvl}"><title>${iso}: ${v}</title></rect>`;
      if (d === 0 && dt.getMonth() !== lastM && dt.getDate() <= 7) { lastM = dt.getMonth(); months += `<text x="${left + w * (cell + gap)}" y="11" class="yh-m">${MONTHS[lastM]}</text>`; }
    }
  }
  const wd = ['пн', '', 'ср', '', 'пт', '', 'вс'].map((t, i) => t ? `<text x="0" y="${top + i * (cell + gap) + 9}" class="yh-m">${t}</text>` : '').join('');
  const wrap = document.createElement('div'); wrap.className = 'yh';
  wrap.innerHTML = `<div class="yh-scroll"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">${months}${wd}${rects}</svg></div>
    <div class="yh-legend" aria-hidden="true"><span>меньше</span>${[0, 1, 2, 3, 4].map(i => `<i class="yh-c l${i}"></i>`).join('')}<span>больше</span></div>`;
  requestAnimationFrame(() => { const sc = wrap.querySelector('.yh-scroll'); if (sc) sc.scrollLeft = sc.scrollWidth; });
  return wrap;
}

/** Карта пути: уровни — остановки на извилистой тропе, маскот стоит на текущей. */
export function journeyMap(levels, level, petSvg, { label = 'Карта пути' } = {}) {
  const cur = level.level;
  const from = Math.max(1, cur - 2), to = from + 5;
  const stops = [];
  for (let l = from; l <= to; l++) {
    const info = levels.find(x => x.level === l) || { level: l, name: `Уровень ${l}`, xp: null };
    stops.push(info);
  }
  const W = 340, H = 230, n = stops.length;
  const pts = stops.map((_, i) => ({ x: 30 + (i / (n - 1)) * (W - 60), y: i % 2 ? 70 : 160 }));
  let path = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < n; i++) { const a = pts[i - 1], b = pts[i]; const cx = (a.x + b.x) / 2; path += ` C${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`; }
  const curIdx = stops.findIndex(s => s.level === cur);
  const prog = Math.max(0, Math.min(1, level.progress || 0));
  let body = `<path d="${path}" class="jm-road"/><path d="${path}" class="jm-done" pathLength="100" style="--p:${((curIdx + prog) / (n - 1) * 100).toFixed(1)}"/>`;
  stops.forEach((s, i) => {
    const p = pts[i], done = s.level < cur, here = s.level === cur;
    body += `<g class="jm-stop ${done ? 'done' : ''} ${here ? 'here' : ''}" transform="translate(${p.x} ${p.y})"><circle r="15"/><text y="5" text-anchor="middle" class="jm-n">${done ? '✓' : s.level}</text>
      <text y="${here || !(i % 2) ? 34 : -24}" text-anchor="middle" class="jm-name">${s.name}</text></g>`;
  });
  const pp = pts[Math.max(0, curIdx)];
  body += `<g class="jm-pet" transform="translate(${pp.x - 30} ${pp.y - 72})"><foreignObject width="60" height="60"><div xmlns="http://www.w3.org/1999/xhtml" class="jm-pet-in">${petSvg}</div></foreignObject></g>`;
  const next = levels.find(x => x.level === cur + 1);
  const wrap = document.createElement('div'); wrap.className = 'jm';
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="jm-svg" role="img" aria-label="${label}: уровень ${cur}, ${level.xp} из ${level.next} XP">${body}</svg>
    <p class="jm-tip">${next ? `До «${next.name}» — ещё <b>${Math.max(0, level.next - level.xp)} XP</b>. Один квест — и ближе.` : 'Ты на вершине карты — дальше только легенды ✨'}</p>`;
  return wrap;
}
