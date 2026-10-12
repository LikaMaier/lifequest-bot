// Календарь планов: сетка месяца (свайп между месяцами), неделя крупно (планы
// и фото-полароиды по дням) или лента ближайших дней. Щипок двумя пальцами:
// развести на месяце — открыть неделю, свести на неделе — вернуться к месяцу.

import { h, clear, plural, fmtDay, parseDate } from '../dom.js';
import { api } from '../api.js';
import { haptic, tg } from '../tg.js';
import { mascot } from '../mascot.js';
import { skeleton, toastError, sectionTitle, emptyState } from '../ui.js';
import { memoryBoard, photosEnabled } from '../photoui.js';
import { PLAN_MODES, planRow, openDaySheet, todayIso, addDays, dayTitle } from '../planui.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const cache = new Map(); // 'YYYY-MM' -> summary: календарь открывается мгновенно
const view = { month: null, mode: 'month', week: null };
const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WEEKDAY_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const mondayOf = iso => addDays(iso, -((parseDate(iso).getDay() + 6) % 7));

// Щипок двумя пальцами: onSpread — развели (приближение), onPinch — свели.
function pinchZoom(node, { onSpread, onPinch }) {
  let start = null, mid = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  node.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      start = dist(e.touches);
      mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    }
  }, { passive: true });
  node.addEventListener('touchmove', e => {
    if (start === null || e.touches.length !== 2) return;
    const ratio = dist(e.touches) / start;
    if (ratio > 1.3 && onSpread) { start = null; haptic.select(); onSpread(mid); }
    else if (ratio < 0.75 && onPinch) { start = null; haptic.select(); onPinch(mid); }
  }, { passive: true });
  node.addEventListener('touchend', e => { if (e.touches.length < 2) start = null; }, { passive: true });
}

function openWeek(iso, el, ctx) {
  view.week = mondayOf(iso);
  view.mode = 'week';
  render(el, ctx);
}

const monthKey = iso => iso.slice(0, 7);
function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function render(el, ctx) {
  view.month = view.month || monthKey(todayIso());
  clear(el);
  const overdue = ctx.state.plans_overdue;
  el.append(h('header', { class: 'page-head' }, mascot('cat-blue', overdue ? 'wink' : 'happy', { size: 56 }),
    h('div', { class: 'grow' }, h('h1', null, 'Календарь'), h('p', null, 'Планируй задания и дела на конкретные дни'))));

  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Вид календаря' },
    [['month', 'Месяц'], ['week', 'Неделя'], ['list', 'Список']].map(([k, label]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(view.mode === k) }, label);
      b.addEventListener('click', () => {
        haptic.select();
        if (k === 'week' && !view.week) view.week = mondayOf(view.month === monthKey(todayIso()) ? todayIso() : `${view.month}-01`);
        if (k === 'month' && view.week) view.month = monthKey(addDays(view.week, 3));
        view.mode = k;
        render(el, ctx);
      });
      return b;
    }));
  const add = h('button', { type: 'button', class: 'btn small' }, '＋ План');
  add.addEventListener('click', () => { haptic.tap(); openDaySheet(todayIso(), { onChange: () => refresh(el, ctx) }); });
  el.append(h('div', { class: 'row', style: { marginBottom: '14px' } }, h('div', { class: 'grow' }, seg), add));

  if (overdue) {
    el.append(h('div', { class: 'card soft c-paleyellow row', style: { marginBottom: '14px' } },
      h('span', { style: { fontSize: '24px' }, 'aria-hidden': 'true' }, '🌿'),
      h('div', { class: 'grow small bold' }, `${overdue} ${plural(overdue, 'план ждёт', 'плана ждут', 'планов ждут')} решения — перенеси или отпусти, без чувства вины.`)));
  }
  const body = h('div');
  el.append(body);
  if (view.mode === 'month') drawMonth(body, el, ctx);
  else if (view.mode === 'week') drawWeek(body, el, ctx);
  else drawList(body, el, ctx);
}

export function update(el, ctx) {
  cache.delete(view.month);
  render(el, ctx);
}

// ---------- Неделя ----------
async function drawWeek(body, el, ctx) {
  const from = view.week || mondayOf(todayIso());
  view.week = from;
  const to = addDays(from, 6);
  const a = parseDate(from), b = parseDate(to);
  const range = a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS_GEN[a.getMonth()]} – ${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`;
  const prev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Предыдущая неделя' }, '‹');
  const next = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Следующая неделя' }, '›');
  const todayBtn = h('button', { type: 'button', class: 'chip c-yellow' }, 'Сегодня');
  const go = n => { haptic.select(); view.week = addDays(view.week, 7 * n); render(el, ctx); };
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  todayBtn.addEventListener('click', () => { haptic.select(); view.week = mondayOf(todayIso()); render(el, ctx); });
  body.append(h('div', { class: 'spread', style: { marginBottom: '10px' } }, prev,
    h('h2', { 'aria-live': 'polite', class: 'center', style: { fontSize: '15px', lineHeight: '1.25' } }, range), h('div', { class: 'row', style: { gap: '6px' } }, todayBtn, next)));

  const host = h('div', { class: 'week-list' });
  body.append(host, h('p', { class: 'tiny muted bold center', style: { marginTop: '12px' } }, 'Сведи два пальца — вернёшься к месяцу'));
  host.append(skeleton(110), h('div', { style: { height: '10px' } }), skeleton(110));
  let plans, photos = [];
  try {
    const [p, ph] = await Promise.all([api.plans(from, to),
      photosEnabled() ? api.photos({ from, to }).catch(() => ({ photos: [] })) : Promise.resolve({ photos: [] })]);
    plans = p.plans;
    photos = ph.photos || [];
  } catch (e) {
    clear(host).append(h('p', { class: 'muted bold' }, e.message));
    return;
  }
  if (view.week !== from || view.mode !== 'week') return;
  clear(host);
  const today = todayIso();
  const onChange = () => refresh(el, ctx);
  for (let i = 0; i < 7; i++) {
    const date = addDays(from, i);
    const dayPlans = plans.filter(o => o.date === date);
    const dayPhotos = photos.filter(p => p.day === date);
    const add = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Добавить план на ${dayTitle(date)}` }, '＋');
    add.addEventListener('click', e => { e.stopPropagation(); haptic.tap(); openDaySheet(date, { onChange }); });
    const head = h('button', { type: 'button', class: 'week-day-head', 'aria-label': `Открыть день: ${dayTitle(date)}` },
      h('span', { class: 'week-num num' }, String(parseDate(date).getDate())),
      h('span', { class: 'grow' }, h('span', { class: 'bold' }, WEEKDAY_FULL[i]),
        h('span', { class: 'tiny muted bold', style: { display: 'block' } },
          date === today ? 'сегодня' : dayPlans.length ? `${dayPlans.length} ${plural(dayPlans.length, 'план', 'плана', 'планов')}` : 'свободно')));
    head.addEventListener('click', () => { haptic.tap(); openDaySheet(date, { onChange }); });
    host.append(h('section', { class: `card week-day ${date === today ? 'today' : ''} ${date < today ? 'past' : ''}` },
      h('div', { class: 'row', style: { gap: '8px' } }, head, add),
      dayPlans.length ? h('div', { class: 'stack-sm', style: { marginTop: '10px' } }, dayPlans.map(o => planRow(o, { onChange, compact: true }))) : null,
      dayPhotos.length ? memoryBoard(dayPhotos, { small: true, onDelete: onChange }) : null));
  }
  // свайп — соседняя неделя, щипок — назад к месяцу
  let sx = null, sy = null;
  host.addEventListener('touchstart', e => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } else sx = null; }, { passive: true });
  host.addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) go(dx < 0 ? 1 : -1);
  });
  pinchZoom(host, { onPinch: () => { view.month = monthKey(addDays(from, 3)); view.mode = 'month'; render(el, ctx); } });
}

function refresh(el, ctx) {
  cache.clear();
  render(el, ctx);
}

// ---------- Месяц ----------
async function drawMonth(body, el, ctx) {
  const key = view.month;
  const [y, m] = key.split('-').map(Number);
  const prev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Предыдущий месяц' }, '‹');
  const next = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Следующий месяц' }, '›');
  const todayBtn = h('button', { type: 'button', class: 'chip c-yellow' }, 'Сегодня');
  const go = n => { haptic.select(); view.month = shiftMonth(view.month, n); render(el, ctx); };
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  todayBtn.addEventListener('click', () => { haptic.select(); view.month = monthKey(todayIso()); render(el, ctx); });
  body.append(h('div', { class: 'spread', style: { marginBottom: '10px' } }, prev,
    h('h2', { 'aria-live': 'polite' }, `${MONTHS[m - 1]} ${y}`), h('div', { class: 'row', style: { gap: '6px' } }, todayBtn, next)));

  const gridHost = h('div', { class: 'card cal-card' });
  body.append(gridHost);
  let summary = cache.get(key);
  if (!summary) {
    gridHost.append(skeleton(300));
    try {
      summary = await api.calendarSummary(key);
      cache.set(key, summary);
      // заранее подгружаем соседние месяцы — свайп будет мгновенным
      for (const k of [shiftMonth(key, -1), shiftMonth(key, 1)]) {
        if (!cache.has(k)) api.calendarSummary(k).then(s => cache.set(k, s)).catch(() => {});
      }
    } catch (e) {
      clear(gridHost).append(h('p', { class: 'muted bold' }, e.message));
      return;
    }
    if (view.month !== key) return;
  }
  clear(gridHost);
  const first = parseDate(summary.days[0].date);
  const offset = (first.getDay() + 6) % 7;
  const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': `${MONTHS[m - 1]} ${y}` },
    WEEKDAY_SHORT.map(d => h('div', { class: 'cal-head', 'aria-hidden': 'true' }, d)),
    Array.from({ length: offset }, () => h('div', { 'aria-hidden': 'true' })),
    summary.days.map(d => dayCell(d, summary.today, el, ctx)));
  // свайп между месяцами
  let sx = null, sy = null;
  grid.addEventListener('touchstart', e => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } else sx = null; }, { passive: true });
  grid.addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  });
  pinchZoom(grid, { onSpread: mid => {
    const hit = document.elementFromPoint(mid.x, mid.y);
    const cell = hit && hit.closest('[data-date]');
    openWeek(cell ? cell.dataset.date : (key === monthKey(todayIso()) ? todayIso() : `${key}-01`), el, ctx);
  } });
  gridHost.append(grid, legend(),
    h('p', { class: 'tiny muted bold center', style: { marginTop: '8px' } }, 'Разведи двумя пальцами — откроется неделя крупно'));

  const exportBtn = h('button', { type: 'button', class: 'btn ghost block', style: { marginTop: '14px' } }, '📲 Добавить месяц в календарь телефона');
  exportBtn.addEventListener('click', () => exportIcs(summary.days[0].date, summary.days[summary.days.length - 1].date));
  body.append(exportBtn);
}

function dayCell(d, today, el, ctx) {
  const n = d.planned + d.done;
  const label = [dayTitle(d.date), n ? `${n} ${plural(n, 'план', 'плана', 'планов')}` : 'нет планов',
    d.done ? `выполнено ${d.done}` : null, d.overdue ? 'есть просроченные' : null, d.photo ? 'есть фото' : null].filter(Boolean).join(', ');
  const cell = h('button', { type: 'button', role: 'gridcell', dataset: { date: d.date },
    class: `cal-day ${d.date === today ? 'today' : ''} ${d.complete ? 'complete' : ''} ${d.date < today ? 'past' : ''} ${d.overdue ? 'overdue' : ''}`,
    'aria-label': label },
    h('span', { class: 'cal-num' }, String(parseDate(d.date).getDate())),
    h('span', { class: 'cal-dots', 'aria-hidden': 'true' }, d.modes.slice(0, 4).map(mode => h('i', { class: `c-${PLAN_MODES[mode].color}` }))),
    d.photo ? h('span', { class: 'cal-photo', 'aria-hidden': 'true' }, '📷') : null);
  cell.addEventListener('click', () => { haptic.tap(); openDaySheet(d.date, { onChange: () => refresh(el, ctx) }); });
  return cell;
}

function legend() {
  return h('div', { class: 'cal-legend', 'aria-hidden': 'true' },
    ['solo', 'pair', 'company', 'free'].map(k => h('span', null, h('i', { class: `c-${PLAN_MODES[k].color}` }), PLAN_MODES[k].short)),
    h('span', null, '📷 фото'));
}

// ---------- Список ----------
async function drawList(body, el, ctx) {
  const from = addDays(todayIso(), -7);
  const to = addDays(todayIso(), 30);
  body.append(skeleton(80), h('div', { style: { height: '10px' } }), skeleton(80));
  let items;
  try {
    items = (await api.plans(from, to)).plans;
  } catch (e) {
    clear(body).append(h('p', { class: 'muted bold' }, e.message));
    return;
  }
  clear(body);
  // Повторяющийся план показываем только в ближайший день, чтобы не засорять ленту.
  const seenSeries = new Set();
  const visible = items.filter(o => {
    if (o.overdue) return true;
    if (o.date < todayIso()) return false;
    if (o.repeat_rule === 'none' || o.date === todayIso()) return true;
    if (seenSeries.has(o.id)) return false;
    seenSeries.add(o.id);
    return true;
  });
  if (!visible.length) {
    const add = h('button', { type: 'button', class: 'btn' }, '＋ Запланировать');
    add.addEventListener('click', () => openDaySheet(todayIso(), { onChange: () => refresh(el, ctx) }));
    body.append(h('div', { class: 'card' }, emptyState('Здесь пока пусто. Запланируем что-нибудь приятное?', { kind: 'cat-lav', expr: 'wink', action: add })));
    return;
  }
  const byDay = new Map();
  for (const o of visible) {
    const key = o.overdue ? 'overdue' : o.date;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(o);
  }
  for (const [key, list] of byDay) {
    const title = key === 'overdue' ? '🌿 Не успелось' : key === todayIso() ? `Сегодня, ${fmtDay(key)}` : key === addDays(todayIso(), 1) ? `Завтра, ${fmtDay(key)}` : dayTitle(key);
    body.append(sectionTitle(title), h('div', { class: 'stack-sm' }, list.map(o => planRow(o, { onChange: () => refresh(el, ctx) }))));
  }
  const exportBtn = h('button', { type: 'button', class: 'btn ghost block', style: { marginTop: '18px' } }, '📲 Ближайший месяц — в календарь телефона');
  exportBtn.addEventListener('click', () => exportIcs(todayIso(), addDays(todayIso(), 30)));
  body.append(exportBtn);
}

async function exportIcs(from, to) {
  haptic.tap();
  try {
    const { url } = await api.exportLink(from, to);
    const abs = new URL(url, location.href).href;
    if (tg && tg.downloadFile) {
      try { tg.downloadFile({ url: abs, file_name: `lifequest-${from}.ics` }); return; } catch (e) { /* старый клиент */ }
    }
    if (tg && tg.openLink) tg.openLink(abs); else window.open(abs, '_blank', 'noopener');
  } catch (e) { toastError(e); }
}

export { MONTHS_GEN };
