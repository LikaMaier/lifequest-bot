// Календарь: месяц-стикербук (эмодзи дел, полароиды дней с фото, праздники
// лентой, маскот на сегодняшнем дне); неделя кольцами с
// настроением дня; день — лента по часам: свайп плана вправо — сделано,
// влево — на завтра, долгое нажатие — перетащить время, ручка — длительность.

import { h, clear, plural, fmtDay, parseDate } from '../dom.js';
import { api } from '../api.js';
import { haptic } from '../tg.js';
import { myMascot, jump } from '../mascot.js';
import { skeleton, toastError, toast, sectionTitle, emptyState, sheet, busy } from '../ui.js';
import { refreshState } from '../store.js';
import { planRow, openPlanSheet, openDaySheet, openQuestPicker, completePlan, todayIso, addDays, dayTitle } from '../planui.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const WD_ACC = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
const REPEAT = { none: 'Не повторять', daily: 'Каждый день', weekdays: 'По будням', weekly: 'Раз в неделю' };
const REPEAT_SHORT = { daily: 'каждый день', weekdays: 'по будням', weekly: 'раз в неделю' };
const FREE_FROM = 9, FREE_TO = 22, FREE_MIN_HOURS = 3;

const cache = new Map(); // 'YYYY-MM' -> summary
const view = { month: null, mode: 'month', day: null };

const HOLIDAYS = {
  '01-01': '🎄 Новый год', '01-07': '⭐ Рождество', '02-14': '💝 14 февраля', '02-23': '🎖 23 февраля',
  '03-08': '🌷 8 Марта', '05-01': '🌼 1 мая', '05-09': '🎗 9 мая', '06-12': '🇷🇺 12 июня',
  '09-01': '📚 1 сентября', '10-31': '🎃 Хэллоуин', '11-04': '🤝 4 ноября', '12-31': '🎄 Новый год',
};
const MOODS = [['sad', '😞', 'Тяжело'], ['ok', '🙂', 'Нормально'], ['good', '😊', 'Хорошо'], ['great', '🤩', 'Отлично']];
const MOOD_EMOJI = Object.fromEntries(MOODS.map(([k, e]) => [k, e]));
const seasonDecor = m => (m >= 9 && m <= 11 ? ['🍂', '🍁'] : m === 12 || m <= 2 ? ['❄️', '⛄'] : m <= 5 ? ['🌸', '🌱'] : ['☀️', '🌿']);


const ICONS = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l2.6 6.5L21 9l-5 4.4L17.5 21 12 17.3 6.5 21 8 13.4 3 9l6.4-.5z" fill="#FFD23F" stroke="#C99A00" stroke-width="1.5"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.2 5.4L20 9l-4.4 3.8L17 18.5 12 15.5 7 18.5l1.4-5.7L4 9l5.8-.6z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
};
const ico = (name, cls = '') => h('span', { class: `cal2-ico ${cls}`, 'aria-hidden': 'true', html: ICONS[name] });
const iconBtn = (name, label, cls = '') => h('button', { type: 'button', class: `cal2-icon-btn ${cls}`, 'aria-label': label }, ico(name));

const monthKey = iso => iso.slice(0, 7);
const wdIndex = iso => (parseDate(iso).getDay() + 6) % 7;
const mondayOf = iso => addDays(iso, -wdIndex(iso));
function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const longDay = iso => `${WD_FULL[wdIndex(iso)]}, ${parseDate(iso).getDate()} ${MONTHS_GEN[parseDate(iso).getMonth()]}`;
const toMin = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
const visiblePlans = list => list.filter(o => o.status === 'planned' || o.status === 'done')
  .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));

function refresh(el, ctx) {
  cache.clear();
  render(el, ctx);
}

export function update(el, ctx) {
  cache.clear();
  render(el, ctx);
}

export function render(el, ctx) {
  const today = todayIso();
  view.month = view.month || monthKey(today);
  view.day = view.day || today;
  clear(el);
  const onChange = () => refresh(el, ctx);

  // шапка: маскот, сводка на сегодня и «+»
  const summary = h('p', { class: 'cal2-sub' }, 'Планы и дела по дням');
  api.plans(today, today).then(res => {
    const list = visiblePlans(res.plans);
    const done = list.filter(o => o.status === 'done').length;
    summary.textContent = list.length
      ? `${list.length} ${plural(list.length, 'план', 'плана', 'планов')} сегодня · ${done} ${plural(done, 'выполнен', 'выполнено', 'выполнено')}`
      : 'Сегодня свободный день';
  }).catch(() => {});
  const add = iconBtn('plus', 'Добавить план', 'dark big');
  add.addEventListener('click', () => { haptic.tap(); openQuickAdd(view.day >= today ? view.day : today, { onChange }); });
  const [s1, s2] = seasonDecor(parseDate(today).getMonth() + 1);
  el.append(h('header', { class: 'cal2-head' }, myMascot(ctx.state.plans_overdue ? 'wink' : 'happy', { size: 54 }),
    h('div', { class: 'grow' }, h('h1', null, 'Календарь'), summary),
    h('span', { class: 'cal2-season', 'aria-hidden': 'true' }, h('i', null, s1), h('i', null, s2)), add));

  const seg = h('div', { class: 'cal2-seg', role: 'group', 'aria-label': 'Вид календаря' },
    [['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц'], ['list', 'Список']].map(([k, label]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(view.mode === k) }, label);
      b.addEventListener('click', () => { haptic.select(); view.mode = k; render(el, ctx); });
      return b;
    }));
  el.append(seg);

  const overdue = ctx.state.plans_overdue;
  if (overdue) {
    const move = h('button', { type: 'button', class: 'cal2-pill dark' }, 'На сегодня');
    move.addEventListener('click', busy(move, async () => {
      haptic.tap();
      try {
        const res = await api.plans(addDays(today, -30), addDays(today, -1));
        const late = res.plans.filter(o => o.overdue);
        for (const o of late) await api.movePlan(o.id, o.date, today);
        haptic.success();
        toast(`📅 Перенесено на сегодня: ${late.length}`, 'good');
        refreshState().catch(() => {});
        onChange();
      } catch (e) { toastError(e); }
    }));
    el.append(h('div', { class: 'cal2-banner' },
      h('div', { class: 'grow' }, h('div', { class: 'bold' }, `${overdue} ${plural(overdue, 'план ждёт', 'плана ждут', 'планов ждут')} решения`),
        h('div', { class: 'cal2-banner-sub' }, 'Без чувства вины — просто перенеси')), move));
  }

  const body = h('div');
  el.append(body);
  if (view.mode === 'day') drawDayTab(body, el, ctx);
  else if (view.mode === 'month') drawMonth(body, el, ctx);
  else if (view.mode === 'week') drawWeek(body, el, ctx);
  else drawList(body, el, ctx);
  el.append(goalsCard(ctx));
}

// ---------- Месяц ----------
async function drawMonth(body, el, ctx) {
  const key = view.month;
  const [y, m] = key.split('-').map(Number);
  const onChange = () => refresh(el, ctx);
  const go = n => { haptic.select(); view.month = shiftMonth(view.month, n); view.day = null; render(el, ctx); };
  const prev = iconBtn('left', 'Предыдущий месяц', 'soft');
  const next = iconBtn('right', 'Следующий месяц', 'soft');
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  const sub = h('div', { class: 'cal2-month-sub' }, ' ');
  const card = h('section', { class: 'cal2-card' },
    h('div', { class: 'cal2-month-head' }, prev,
      h('div', { class: 'center' }, h('div', { class: 'cal2-month-title', 'aria-live': 'polite' }, `${MONTHS[m - 1]} ${y}`), sub), next));
  const gridHost = h('div', null, skeleton(260));
  card.append(gridHost);
  const dayHost = h('div');
  body.append(card, dayHost);

  let summary = cache.get(key);
  if (!summary) {
    try {
      summary = await api.calendarSummary(key);
      cache.set(key, summary);
      for (const k of [shiftMonth(key, -1), shiftMonth(key, 1)]) {
        if (!cache.has(k)) api.calendarSummary(k).then(s => cache.set(k, s)).catch(() => {});
      }
    } catch (e) {
      clear(gridHost).append(h('p', { class: 'muted bold' }, e.message));
      return;
    }
    if (view.month !== key || view.mode !== 'month') return;
  }
  const today = summary.today;
  if (!view.day || monthKey(view.day) !== key) view.day = monthKey(today) === key ? today : `${key}-01`;
  const total = summary.days.reduce((s, d) => s + d.planned + d.done, 0);
  const done = summary.days.reduce((s, d) => s + d.done, 0);
  sub.textContent = total ? `${total} ${plural(total, 'план', 'плана', 'планов')} · ${done} ${plural(done, 'выполнен', 'выполнено', 'выполнено')}` : 'Пока без планов';

  const grid = h('div', { class: 'cal2-grid sticker', role: 'grid', 'aria-label': `${MONTHS[m - 1]} ${y}` });
  WD.forEach((w, i) => grid.append(h('div', { class: `cal2-wd ${i > 4 ? 'weekend' : ''}`, 'aria-hidden': 'true' }, w)));
  const offset = wdIndex(summary.days[0].date);
  for (let i = 0; i < offset; i++) grid.append(h('div', { 'aria-hidden': 'true' }));
  const cells = new Map();
  for (const d of summary.days) {
    const n = d.planned + d.done;
    const who = d.special ? d.special.replace(/^(🎂\s*)?(день рождения|др)\s*/i, '') : '';
    const ribbon = d.special ? `🎂 ${who ? who[0].toUpperCase() + who.slice(1) : 'праздник'}` : HOLIDAYS[d.date.slice(5)];
    const label = [dayTitle(d.date), n ? `${n} ${plural(n, 'план', 'плана', 'планов')}` : 'нет планов',
      d.done ? `выполнено ${d.done}` : null, d.quests_done ? 'был квест' : null, d.photo ? 'есть фото' : null,
      d.mood ? `настроение ${MOOD_EMOJI[d.mood]}` : null, ribbon].filter(Boolean).join(', ');
    const isToday = d.date === today;
    const cls = ['cal2-day', isToday ? 'today' : '', wdIndex(d.date) > 4 ? 'weekend' : '', d.complete ? 'complete' : '',
      d.date < today && !n ? 'quiet' : '', d.overdue ? 'overdue' : '', d.date === view.day ? 'on' : ''];
    let inner;
    if (d.photo_thumb) {
      cls.push('photo', parseDate(d.date).getDate() % 2 ? 'tilt-l' : 'tilt-r');
      inner = [h('img', { src: d.photo_thumb, alt: '', loading: 'lazy', decoding: 'async' }),
        h('span', { class: 'cal2-num' }, String(parseDate(d.date).getDate()))];
    } else {
      const shown = d.emojis || [];
      const more = n - shown.length;
      inner = [h('span', { class: 'cal2-num' }, String(parseDate(d.date).getDate())),
        shown.length ? h('span', { class: 'cal2-emojis', 'aria-hidden': 'true' }, shown.join(''))
          : h('span', { class: 'cal2-dots', 'aria-hidden': 'true' }, Array.from({ length: Math.min(3, n) }, () => h('i'))),
        shown.length && more > 0 ? h('span', { class: 'cal2-more', 'aria-hidden': 'true' }, `+${more}`) : null,
        d.quests_done ? ico('star', 'cal2-star') : null];
    }
    const cell = h('button', { type: 'button', role: 'gridcell', 'aria-label': label, class: cls.filter(Boolean).join(' ') },
      ...inner, ribbon ? h('span', { class: 'cal2-ribbon', 'aria-hidden': 'true' }, ribbon) : null,
      isToday ? h('span', { class: 'cal2-day-pet', 'aria-hidden': 'true' }, myMascot('love', { size: 30 })) : null);
    cell.addEventListener('click', () => {
      haptic.select();
      cells.get(view.day)?.classList.remove('on');
      view.day = d.date;
      cell.classList.add('on');
      const pet = cell.querySelector('.cal2-day-pet .mascot');
      if (pet) jump(pet);
      drawDay(dayHost, d.date, today, onChange, ctx, el);
    });
    cells.set(d.date, cell);
    grid.append(cell);
  }
  // свайп между месяцами
  let sx = null, sy = null;
  grid.addEventListener('touchstart', e => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } else sx = null; }, { passive: true });
  grid.addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  });
  const legend = h('div', { class: 'cal2-legend', 'aria-hidden': 'true' },
    h('span', null, '🏃 дела'), h('span', null, h('i', { class: 'done' }), 'всё сделано'), h('span', null, ico('star'), 'квест'));
  clear(gridHost).append(grid, legend);
  if (monthKey(today) === key) gridHost.append(mascotTip(summary, today, onChange));
  drawDay(dayHost, view.day, today, onChange, ctx, el);
}

/** Подсказка маскота под месяцем: сколько дел сегодня и ближайший свободный выходной. */
function mascotTip(summary, today, onChange) {
  const t = summary.days.find(d => d.date === today) || { planned: 0, done: 0 };
  const left = t.planned;
  const freeWeekend = summary.days.find(d => d.date > today && wdIndex(d.date) > 4 && !(d.planned + d.done));
  const parts = [left ? `Сегодня ${left} ${plural(left, 'дело', 'дела', 'дел')}` : t.done ? 'На сегодня всё сделано 🎉' : 'Сегодня свободно'];
  if (freeWeekend) parts.push(`${WD_ACC[wdIndex(freeWeekend.date)] === 'субботу' ? 'суббота' : 'воскресенье'}, ${parseDate(freeWeekend.date).getDate()}-е, пока свободно — запланируем что-нибудь приятное? ✨`);
  const b = h('button', { type: 'button', class: 'cal2-tip' }, h('span', { class: 'cal2-tip-pet' }, myMascot('wink', { size: 46 })),
    h('span', { class: 'grow' }, parts.join(', а ')));
  b.addEventListener('click', () => { haptic.tap(); openQuickAdd(freeWeekend ? freeWeekend.date : today, { onChange }); });
  return b;
}

/** Месяц: краткий список выбранного дня и переход к ленте по часам. */
async function drawDay(host, date, today, onChange, ctx, el) {
  clear(host).append(skeleton(120));
  let plans;
  try {
    plans = visiblePlans((await api.plans(date, date)).plans);
  } catch (e) {
    clear(host).append(h('p', { class: 'muted bold' }, e.message));
    return;
  }
  if (view.day !== date) return;
  clear(host);
  const done = plans.filter(o => o.status === 'done').length;
  const open = h('button', { type: 'button', class: 'cal2-icon-btn soft', 'aria-label': 'Заметки и фото дня' }, ico('dots'));
  open.addEventListener('click', () => { haptic.tap(); openDaySheet(date, { onChange }); });
  host.append(h('div', { class: 'cal2-sec-head' },
    h('h2', null, date === today ? `Сегодня, ${parseDate(date).getDate()} ${MONTHS_GEN[parseDate(date).getMonth()]}` : longDay(date)),
    plans.length ? h('span', { class: 'cal2-count' }, `${done} из ${plans.length}`) : null, open));
  if (plans.length) {
    host.append(h('div', { class: 'cal2-mini-list' }, byTime(plans).map(o => miniPlan(o, { onChange }))));
  } else {
    host.append(h('p', { class: 'cal2-empty' }, date < today ? 'В этот день планов не было' : 'Пока свободно — самое время что-нибудь придумать'));
  }
  const toDay = h('button', { type: 'button', class: 'cal2-open-day' }, '🕒 Открыть день по часам', h('span', { 'aria-hidden': 'true' }, '›'));
  toDay.addEventListener('click', () => { haptic.tap(); view.mode = 'day'; render(el, ctx); });
  host.append(toDay);
  if (date >= today) host.append(quickInput(date, onChange));
}

/** Дела по времени; без времени — в конце. */
const byTime = list => [...list].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));

/** Строка плана в «Месяце» и «Неделе»: время, название, отметка. */
function miniPlan(o, { onChange } = {}) {
  const b = h('button', { type: 'button', class: `cal2-mini ${o.status === 'done' ? 'done' : ''} ${o.focus ? 'focus' : ''}` },
    h('span', { class: 'cal2-mini-time' }, o.time ? (o.end_time ? `${o.time}–${o.end_time}` : o.time) : 'весь день'),
    h('span', { class: 'grow' }, o.focus ? '🎯 ' : '', o.title),
    h('span', { class: 'cal2-mini-dot', 'aria-hidden': 'true' }, o.status === 'done' ? '✓' : ''));
  b.addEventListener('click', () => { haptic.tap(); openPlanSheet(o, { onChange }); });
  return b;
}

/** День: лента по часам с переключением дней. */
async function drawDayTab(body, el, ctx) {
  const today = todayIso();
  const onChange = () => refresh(el, ctx);
  const date = view.day || today;
  const go = n => { haptic.select(); view.day = addDays(date, n); render(el, ctx); };
  // лента дней недели: тап — день, свайп по ленте — соседняя неделя
  body.append(dayStrip(date, today, d => { haptic.select(); view.day = d; render(el, ctx); },
    n => { haptic.select(); view.day = addDays(date, 7 * n); render(el, ctx); }));
  const host = h('div');
  body.append(host);
  host.append(skeleton(160));
  let plans;
  try {
    plans = visiblePlans((await api.plans(date, date)).plans);
  } catch (e) {
    clear(host).append(h('p', { class: 'muted bold' }, e.message));
    return;
  }
  if (view.mode !== 'day' || view.day !== date) return;
  drawTimeline(host, date, plans, today, onChange); // привычки в календаре не показываем — они на «Привычках» и Главной
  // свайп влево/вправо — соседний день
  let sx = null, sy = null;
  host.addEventListener('touchstart', e => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
  host.addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (e.target.closest('.cal2-swipe')) return; // это был свайп по плану
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) go(dx < 0 ? 1 : -1);
  });
}

/** Лента из 7 дней недели (как в макете): выбранный — тёмный, сегодня — розовый. */
function dayStrip(sel, today, onPick, onWeek) {
  const from = mondayOf(sel);
  const strip = h('div', { class: 'cal2-daystrip', role: 'group', 'aria-label': 'Дни недели' });
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    const b = h('button', { type: 'button', class: `${d === sel ? 'on' : ''} ${d === today ? 'today' : ''}`, 'aria-pressed': String(d === sel),
      'aria-label': `${WD_FULL[i]}, ${parseDate(d).getDate()} ${MONTHS_GEN[parseDate(d).getMonth()]}` },
      h('span', null, WD[i]), h('b', null, String(parseDate(d).getDate())));
    b.addEventListener('click', () => onPick(d));
    strip.append(b);
  }
  let sx = null;
  strip.addEventListener('touchstart', e => { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  strip.addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) onWeek(dx < 0 ? 1 : -1);
  });
  const title = h('div', { class: 'cal2-daystrip-title' },
    h('span', null, `${MONTHS[parseDate(sel).getMonth()]} ${parseDate(sel).getFullYear()}`),
    sel !== today ? (() => {
      const t = h('button', { type: 'button', class: 'cal2-pill small' }, 'Сегодня');
      t.addEventListener('click', () => onPick(today));
      return t;
    })() : null);
  return h('div', null, title, strip);
}

/** «Как прошёл день?» — 4 эмодзи; повторный тап снимает отметку. */
function moodPicker(date, current, onSet) {
  let mood = current || null;
  const row = h('div', { class: 'cal2-mood', role: 'group', 'aria-label': 'Как прошёл день?' });
  const draw = () => {
    clear(row).append(h('span', { class: 'grow' }, 'Как прошёл день?'), ...MOODS.map(([k, e, label]) => {
      const b = h('button', { type: 'button', class: mood === k ? 'on' : '', 'aria-pressed': String(mood === k), 'aria-label': label }, e);
      b.addEventListener('click', busy(b, async () => {
        const next = mood === k ? null : k;
        try {
          await api.setDayMood(date, next);
          mood = next;
          haptic.success();
          cache.clear();
          draw();
          onSet && onSet(next);
        } catch (e) { toastError(e); }
      }));
      return b;
    }));
  };
  draw();
  return row;
}

/** Карточка плана: время, название, повтор/напоминание и круглая галочка. */
const durText = m => (m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`);

function planCard(o, today, onChange) {
  const done = o.status === 'done';
  const subs = o.subtasks || [];
  const subsDone = subs.filter(x => x.done).length;
  const meta = [o.quest ? 'Квест' : null, o.end_time ? `до ${o.end_time}` : null, o.duration ? durText(o.duration) : null,
    subs.length ? `${subsDone} из ${subs.length} ${plural(subs.length, 'пункта', 'пунктов', 'пунктов')}` : null,
    REPEAT_SHORT[o.repeat_rule], o.remind === 'hour_before' ? 'напомню за час' : o.remind === 'at_time' ? 'напомню вовремя' : null,
    o.photos ? `📷 ${o.photos}` : null].filter(Boolean).join(' · ');
  const info = h('button', { type: 'button', class: 'cal2-plan-info', 'aria-label': `${o.title}${o.time ? `, ${o.time}` : ''}. Открыть` },
    h('span', { class: `cal2-time ${o.time ? '' : 'none'}` }, o.time || (o.quest ? o.quest.emoji : '—')),
    h('span', { class: 'grow' }, o.focus ? h('span', { class: 'cal2-focus-kicker' }, '🎯 Главное сегодня') : null,
      h('span', { class: 'cal2-plan-title' }, o.title), meta ? h('span', { class: 'cal2-plan-meta' }, meta) : null));
  info.addEventListener('click', () => { haptic.tap(); openPlanSheet(o, { onChange }); });
  const card = h('div', { class: `cal2-plan ${done ? 'done' : ''} ${o.overdue ? 'overdue' : ''} ${o.focus ? 'focus' : ''}` }, info);
  if (o.date <= today) {
    const check = h('button', { type: 'button', class: 'cal2-check', 'aria-pressed': String(done),
      'aria-label': done ? `Снять отметку: ${o.title}` : `Выполнено: ${o.title}`, disabled: done && Boolean(o.quest_key) }, ico('check'));
    check.addEventListener('click', busy(check, async () => {
      try {
        if (done) { haptic.tap(); await api.uncompletePlan(o.id, o.date); refreshState().catch(() => {}); onChange(); }
        else { card.classList.add('done'); await completePlan(o, onChange); }
      } catch (e) { card.classList.toggle('done', done); toastError(e); }
    }));
    card.append(check);
  }
  if (subs.length) {
    card.append(h('div', { class: 'cal2-subs' }, subs.map((sub, i) => {
      const b = h('button', { type: 'button', class: `cal2-step ${sub.done ? 'on' : ''}`, 'aria-pressed': String(sub.done) },
        h('span', { class: 'box', 'aria-hidden': 'true' }, sub.done ? '✓' : ''), h('span', null, sub.t));
      b.addEventListener('click', busy(b, async () => {
        haptic.select();
        try {
          const res = await api.subtaskPlan(o.id, i, !sub.done);
          o.subtasks = res.subtasks;
          card.replaceWith(planCard(o, today, onChange));
        } catch (e) { toastError(e); }
      }));
      return b;
    })));
  }
  return card;
}

/** Входящие: дела без даты — на выбранный день одним нажатием. */
function inboxBlock(date, onChange) {
  const host = h('div');
  const draw = items => {
    clear(host);
    if (!items.length) return;
    host.append(h('section', { class: 'cal2-inbox' },
      h('div', { class: 'cal2-inbox-head' }, h('b', null, `📥 Входящие · ${items.length}`), h('span', null, 'без даты')),
      items.slice(0, 6).map(it => {
        const to = h('button', { type: 'button', class: 'cal2-pill dark small' }, 'На этот день');
        to.addEventListener('click', busy(to, async () => {
          try { await api.scheduleInbox(it.id, { date }); haptic.success(); toast(`📅 «${it.title}» — в план`, 'good'); onChange(); } catch (e) { toastError(e); }
        }));
        const del = h('button', { type: 'button', class: 'cal2-inbox-del', 'aria-label': `Удалить: ${it.title}` }, '✕');
        del.addEventListener('click', busy(del, async () => {
          try { draw((await api.deleteInbox(it.id)).inbox); } catch (e) { toastError(e); }
        }));
        return h('div', { class: 'cal2-inbox-item' }, h('span', { class: 'grow' }, it.title), to, del);
      })));
  };
  api.inbox().then(r => draw(r.inbox)).catch(() => {});
  return host;
}

/** «Вечер свободен» — если сегодня/потом нет планов с 19:00. */
function freeEvening(plans, date, today) {
  if (date < today) return null;
  const busyEvening = plans.some(o => o.status === 'planned' && o.time && toMin(o.time) >= 18 * 60 + 30);
  if (busyEvening) return null;
  return onChange => {
    const btn = h('button', { type: 'button', class: 'cal2-pill lav' }, 'Подкинь');
    btn.addEventListener('click', () => { haptic.tap(); openQuestPicker(date, { onChange }); });
    return h('div', { class: 'cal2-free' }, h('div', { class: 'grow' }, h('div', { class: 'bold' }, 'Вечер свободен с 19:00'),
      h('div', { class: 'cal2-free-sub' }, 'Подкинуть квест на это время?')), btn);
  };
}

/** Строка «Добавить на этот день…». */
function quickInput(date, onChange) {
  const input = h('input', { class: 'cal2-quick-input', type: 'text', maxlength: '80', placeholder: 'Добавить на этот день…', 'aria-label': `Быстро добавить план на ${dayTitle(date)}` });
  const add = iconBtn('plus', 'Добавить', 'pink');
  const submit = async () => {
    const title = input.value.trim();
    if (!title) { openQuickAdd(date, { onChange }); return; }
    try {
      await api.createPlan({ title, date, color: 'yellow', repeat_rule: 'none', remind: 'none', time: null });
      haptic.success();
      input.value = '';
      refreshState().catch(() => {});
      onChange();
    } catch (e) { toastError(e); }
  };
  add.addEventListener('click', busy(add, submit));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  return h('div', { class: 'cal2-quick' }, input, add);
}

// ---------- Неделя ----------
async function drawWeek(body, el, ctx) {
  const today = todayIso();
  const onChange = () => refresh(el, ctx);
  const sel = view.day || today;
  view.day = sel;
  const from = mondayOf(sel);
  const to = addDays(from, 6);
  const go = n => { haptic.select(); view.day = addDays(sel, 7 * n); render(el, ctx); };
  const prev = iconBtn('left', 'Предыдущая неделя', 'soft');
  const next = iconBtn('right', 'Следующая неделя', 'soft');
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  const a = parseDate(from), b = parseDate(to);
  const range = a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS_GEN[a.getMonth()]} – ${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`;
  const todayBtn = h('button', { type: 'button', class: 'cal2-pill' }, 'Сегодня');
  todayBtn.addEventListener('click', () => { haptic.select(); view.day = today; render(el, ctx); });
  body.append(h('div', { class: 'cal2-week-nav' }, prev, h('div', { class: 'cal2-week-range', 'aria-live': 'polite' }, range), todayBtn, next));
  const rings = h('div', { class: 'cal2-rings' }, skeleton(84));
  const dayHost = h('div');
  body.append(rings, dayHost);
  let plans, moods;
  try {
    [plans, moods] = await Promise.all([api.plans(from, to).then(r => r.plans), api.dayMoods(from, to).then(r => r.moods).catch(() => ({}))]);
  } catch (e) {
    clear(rings).append(h('p', { class: 'muted bold' }, e.message));
    return;
  }
  if (view.mode !== 'week') return;
  const byDay = d => visiblePlans(plans.filter(o => o.date === d));
  const full = Array.from({ length: 7 }, (_, i) => byDay(addDays(from, i))).filter(l => l.length && l.every(o => o.status === 'done')).length;
  const drawRings = () => {
    clear(rings);
    for (let i = 0; i < 7; i++) {
      const date = addDays(from, i);
      const list = byDay(date);
      const doneN = list.filter(o => o.status === 'done').length;
      const pct = list.length ? Math.round((doneN / list.length) * 100) : 0;
      const color = pct === 100 ? 'lime' : pct ? 'yellow' : 'lav';
      const b = h('button', { type: 'button', class: `cal2-ring-day ${date === sel ? 'on' : ''} ${date === today ? 'today' : ''}`,
        'aria-pressed': String(date === sel), 'aria-label': `${WD_FULL[i]}, ${parseDate(date).getDate()}: сделано ${doneN} из ${list.length}${moods[date] ? `, настроение ${MOOD_EMOJI[moods[date]]}` : ''}` },
        h('span', { class: `cal2-ring c-${color}`, style: { '--p': pct } }, h('i', null, moods[date] ? MOOD_EMOJI[moods[date]] : list.length ? `${doneN}/${list.length}` : '')),
        h('small', null, WD[i]), h('b', null, String(parseDate(date).getDate())));
      b.addEventListener('click', () => { haptic.select(); view.day = date; drawRings(); drawSel(); });
      rings.append(b);
    }
  };
  const drawSel = () => {
    const date = view.day;
    const list = byTime(byDay(date));
    const doneN = list.filter(o => o.status === 'done').length;
    const toDay = h('button', { type: 'button', class: 'cal2-open-day' }, '🕒 Открыть день по часам', h('span', { 'aria-hidden': 'true' }, '›'));
    toDay.addEventListener('click', () => { haptic.tap(); view.mode = 'day'; render(el, ctx); });
    clear(dayHost).append(h('section', { class: 'cal2-card cal2-weekday' },
      h('div', { class: 'cal2-sec-head' }, h('h2', null, date === today ? 'Сегодня' : `${WD_FULL[wdIndex(date)]}, ${parseDate(date).getDate()}`),
        list.length ? h('span', { class: 'cal2-count lime' }, `${doneN} из ${list.length}`) : null),
      list.length ? h('div', { class: 'cal2-checklist' }, list.map(o => weekRow(o, today, onChange)))
        : h('p', { class: 'cal2-empty' }, date < today ? 'В этот день планов не было' : 'Пока свободно — самое время что-нибудь придумать'),
      date <= today ? moodPicker(date, moods[date], m => { moods[date] = m; drawRings(); }) : null,
      toDay),
      date >= today ? quickInput(date, onChange) : null);
  };
  drawRings();
  drawSel();
  // свайп по кольцам — соседняя неделя
  let sx = null;
  rings.addEventListener('touchstart', e => { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  rings.addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  });
  if (full) body.insertBefore(h('p', { class: 'cal2-week-note' }, `🔥 ${full} ${plural(full, 'день закрыт', 'дня закрыто', 'дней закрыто')} полностью`), rings);
}

/** Строка плана в неделе: галочка (сегодня и раньше) и название. */
function weekRow(o, today, onChange) {
  const done = o.status === 'done';
  const row = h('div', { class: `cal2-check-row ${done ? 'done' : ''}` });
  const box = h('button', { type: 'button', class: 'cal2-box', 'aria-pressed': String(done), disabled: o.date > today || (done && Boolean(o.quest_key)),
    'aria-label': done ? `Снять отметку: ${o.title}` : `Выполнено: ${o.title}` }, done ? '✓' : '');
  box.addEventListener('click', busy(box, async () => {
    try {
      if (done) { haptic.tap(); await api.uncompletePlan(o.id, o.date); refreshState().catch(() => {}); onChange(); }
      else { row.classList.add('done'); box.textContent = '✓'; await completePlan(o, onChange); }
    } catch (e) { toastError(e); }
  }));
  const info = h('button', { type: 'button', class: 'cal2-check-title' }, o.title);
  info.addEventListener('click', () => { haptic.tap(); openPlanSheet(o, { onChange }); });
  row.append(box, info, h('span', { class: 'cal2-check-time' }, o.time || ''));
  return row;
}

/** Лента дня: планы по времени и свободные окна между ними. */
const HABIT_AT = { morning: '08:00', day: '13:00', evening: '21:00' };

/** Привычки «делать» на этот день — с временем (напоминание или время дня). */
function habitChip(x, onChange) {
  const b = h('button', { type: 'button', class: `cal2-habit ${x.done ? 'done' : ''}`, disabled: !x.today, 'aria-pressed': String(x.done),
    'aria-label': `Привычка: ${x.hb.title}${x.done ? ', сделано' : ''}` },
    h('span', { class: 'tag' }, 'привычка'), h('span', { class: 'grow' }, `${x.hb.emoji} ${x.hb.title}`),
    h('span', { class: 'dot', 'aria-hidden': 'true' }, x.done ? '✓' : ''));
  b.addEventListener('click', busy(b, async () => {
    haptic.tap();
    try {
      await api.logHabit(x.hb.id, x.done ? { delta: -1 } : { count: x.hb.target });
      await refreshState();
      onChange();
    } catch (e) { toastError(e); }
  }));
  return b;
}

function drawTimeline(host, date, plans, today, onChange, habitItems = []) {
  clear(host);
  const done = plans.filter(o => o.status === 'done').length;
  const open = h('button', { type: 'button', class: 'cal2-icon-btn soft', 'aria-label': 'Заметки и фото дня' }, ico('dots'));
  open.addEventListener('click', () => { haptic.tap(); openDaySheet(date, { onChange }); });
  host.append(h('div', { class: 'cal2-sec-head' },
    h('h2', null, date === today ? `Сегодня, ${parseDate(date).getDate()} ${MONTHS_GEN[parseDate(date).getMonth()]}` : longDay(date)),
    plans.length ? h('span', { class: 'cal2-count lime' }, `${done} из ${plans.length}`) : null, open));
  const untimed = plans.filter(o => !o.time);
  const anyHabits = habitItems.filter(x => !x.time);
  // планы и привычки со временем — одной лентой
  const timed = [...plans.filter(o => o.time).map(o => ({ time: o.time, plan: o })),
    ...habitItems.filter(x => x.time).map(x => ({ time: x.time, habit: x }))].sort((a, b) => a.time.localeCompare(b.time));
  const line = h('div', { class: 'cal2-line' });
  if (untimed.length || anyHabits.length) {
    line.append(h('div', { class: 'cal2-slot' }, h('span', { class: 'cal2-hour' }, 'весь день'),
      h('div', { class: 'cal2-slot-body' }, untimed.map(o => swipeable(o, today, onChange)), anyHabits.map(x => habitChip(x, onChange)))));
  }
  // свободные окна от FREE_FROM до FREE_TO (только сегодня и дальше)
  let cursor = FREE_FROM * 60;
  if (date === today) {
    const now = new Date();
    cursor = Math.max(cursor, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30);
  }
  const freeSlot = (fromMin, toMin) => {
    const hours = Math.floor((toMin - fromMin) / 60);
    const btn = h('button', { type: 'button', class: 'cal2-window' }, ico('spark'),
      h('span', { class: 'grow' }, h('span', { class: 'bold', style: { display: 'block' } }, `Свободно ${hours} ${plural(hours, 'час', 'часа', 'часов')}`),
        h('span', { class: 'cal2-window-sub' }, 'Нажми — подберём квест на это окно')));
    btn.addEventListener('click', () => { haptic.tap(); openQuestPicker(date, { onChange }); });
    return h('div', { class: 'cal2-slot' }, h('span', { class: 'cal2-hour' }, hhmm(fromMin)), h('div', { class: 'cal2-slot-body' }, btn));
  };
  for (const it of timed) {
    const start = toMin(it.time);
    if (date >= today && start - cursor >= FREE_MIN_HOURS * 60) line.append(freeSlot(cursor, start));
    line.append(h('div', { class: 'cal2-slot' }, h('span', { class: 'cal2-hour' }, it.time),
      h('div', { class: 'cal2-slot-body' }, it.plan ? swipeable(it.plan, today, onChange) : habitChip(it.habit, onChange))));
    cursor = Math.max(cursor, start + (it.plan ? (it.plan.duration || 60) : 15));
  }
  if (date >= today && FREE_TO * 60 - cursor >= FREE_MIN_HOURS * 60) line.append(freeSlot(cursor, FREE_TO * 60));
  if (!line.childElementCount) line.append(h('p', { class: 'cal2-empty' }, date < today ? 'В этот день планов не было' : 'Пока пусто'));
  host.append(h('section', { class: 'cal2-card cal2-timeline' }, line));
  if (plans.length) host.append(h('p', { class: 'cal2-gesture-hint' }, '👉 вправо — сделано · 👈 влево — на завтра · зажми — другое время · ручка снизу — длительность'));
  if (date <= today) {
    const moodHost = h('div');
    host.append(moodHost);
    api.dayMoods(date, date).then(r => moodHost.append(moodPicker(date, r.moods[date]))).catch(() => {});
  }
  if (date >= today) host.append(quickInput(date, onChange), inboxBlock(date, onChange));
}

/** План в ленте дня с жестами: свайп вправо — сделано, влево — на завтра;
 *  долгое нажатие — перетащить на другое время; ручка снизу — длительность.
 *  Время и длительность меняются только у разовых планов (у повторов — в карточке). */
function swipeable(o, today, onChange) {
  const card = planCard(o, today, onChange);
  const canDone = o.date <= today && o.status !== 'done';
  const canTime = Boolean(o.time) && (o.repeat_rule || 'none') === 'none' && o.status !== 'done';
  const wrap = h('div', { class: 'cal2-swipe' },
    h('div', { class: 'cal2-swipe-bg done', 'aria-hidden': 'true' }, canDone ? '✓ Готово!' : ''),
    h('div', { class: 'cal2-swipe-bg move', 'aria-hidden': 'true' }, 'На завтра →'), card);
  const tip = h('span', { class: 'cal2-drag-tip', 'aria-hidden': 'true' });
  card.append(tip);
  let handle = null;
  if (canTime) {
    handle = h('span', { class: 'cal2-resize', role: 'slider', 'aria-label': `Длительность: ${o.title}` });
    card.append(handle);
  }
  const STEP = 15, PX = 9; // 9 px движения = 15 минут
  let sx = 0, sy = 0, mode = null, timer = null, dx = 0, dy = 0;
  const reset = () => {
    clearTimeout(timer);
    mode = null;
    card.style.transform = '';
    card.classList.remove('dragging');
    wrap.classList.remove('to-done', 'to-move');
    tip.textContent = '';
  };
  const shift = () => Math.round(dy / PX) * STEP;
  const start = (x, y, target) => {
    sx = x; sy = y; dx = dy = 0; mode = null;
    if (target.closest('.cal2-check, .cal2-step')) { mode = 'skip'; return; }
    if (handle && target === handle) { mode = 'resize'; card.classList.add('dragging'); return; }
    if (canTime) timer = setTimeout(() => { mode = 'drag'; haptic.tap('medium'); card.classList.add('dragging'); }, 450);
  };
  const move = (x, y, ev) => {
    dx = x - sx; dy = y - sy;
    if (mode === 'skip' || mode === 'scroll') return;
    if (!mode) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) { clearTimeout(timer); mode = 'swipe'; }
      else if (Math.abs(dy) > 10) { clearTimeout(timer); mode = 'scroll'; return; }
      else return;
    }
    if (ev && ev.cancelable) ev.preventDefault();
    if (mode === 'swipe') {
      card.style.transform = `translateX(${dx}px)`;
      wrap.classList.toggle('to-done', dx > 0 && canDone);
      wrap.classList.toggle('to-move', dx < 0);
    } else if (mode === 'drag') {
      card.style.transform = `translateY(${dy}px) rotate(-1.5deg) scale(1.02)`;
      const t = Math.max(0, Math.min(23 * 60 + 45, toMin(o.time) + shift()));
      tip.textContent = `→ ${hhmm(t)}`;
    } else if (mode === 'resize') {
      const dur = Math.max(STEP, Math.min(23 * 60 + 59 - toMin(o.time), (o.duration || 60) + shift()));
      tip.textContent = `до ${endOf(o.time, dur)}`;
    }
  };
  const end = async () => {
    const m = mode, ddx = dx, mins = shift();
    reset();
    try {
      if (m === 'swipe' && ddx > 90 && canDone) {
        card.classList.add('done');
        await completePlan(o, onChange);
      } else if (m === 'swipe' && ddx < -90) {
        haptic.success();
        await api.movePlan(o.id, o.date, addDays(o.date, 1));
        toast(`📅 «${o.title}» — на завтра`, 'good');
        refreshState().catch(() => {});
        onChange();
      } else if (m === 'drag' && mins) {
        const t = Math.max(0, Math.min(23 * 60 + 45, toMin(o.time) + mins));
        await api.patchPlan(o.id, { time: hhmm(t) });
        haptic.success();
        toast(`🕒 Теперь в ${hhmm(t)}`, 'good');
        onChange();
      } else if (m === 'resize' && mins) {
        const dur = Math.max(STEP, Math.min(23 * 60 + 59 - toMin(o.time), (o.duration || 60) + mins));
        await api.patchPlan(o.id, { duration: dur });
        haptic.success();
        toast(`⏱ До ${endOf(o.time, dur)}`, 'good');
        onChange();
      }
    } catch (e) { toastError(e); onChange(); }
  };
  wrap.addEventListener('touchstart', e => { if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY, e.target); }, { passive: true });
  wrap.addEventListener('touchmove', e => { if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY, e); }, { passive: false });
  wrap.addEventListener('touchend', () => { if (mode && mode !== 'skip' && mode !== 'scroll') end(); else reset(); });
  wrap.addEventListener('touchcancel', reset);
  // мышь (веб-версия)
  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    start(e.clientX, e.clientY, e.target);
    const mm = ev => move(ev.clientX, ev.clientY, ev);
    const up = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', up);
      if (mode && mode !== 'skip' && mode !== 'scroll') end(); else reset(); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', up);
  });
  // после свайпа/перетаскивания не открываем карточку
  wrap.addEventListener('click', e => { if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { e.stopPropagation(); e.preventDefault(); dx = dy = 0; } }, true);
  return wrap;
}
const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** «10:00» + 90 мин → «11:30» (не дальше 23:59). */
export const endOf = (time, dur) => hhmm(Math.min(23 * 60 + 59, toMin(time) + dur));
/** Длительность от начала до окончания в минутах; null — если окончание не позже начала. */
export function durationTo(start, end) {
  if (!start || !end) return null;
  const d = toMin(end) - toMin(start);
  return d > 0 ? d : null;
}

// ---------- Список ----------
async function drawList(body, el, ctx) {
  const onChange = () => refresh(el, ctx);
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
    add.addEventListener('click', () => openQuickAdd(todayIso(), { onChange }));
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
    body.append(sectionTitle(title), h('div', { class: 'stack-sm' }, list.map(o => planRow(o, { onChange, onOpen: x => openDaySheet(x.date, { onChange }) }))));
  }
}

// ---------- Быстрое добавление ----------
// Максимально просто: что, дата и (по желанию) время «с … до …». Повтор,
// напоминание и подпункты — потом, в карточке плана.
export function openQuickAdd(date, { onChange } = {}) {
  const today = todayIso();
  const s = sheet(h('div'), { label: 'Новый план' });
  const title = h('input', { class: 'cal2-title-input', type: 'text', maxlength: '80', placeholder: 'Что планируем?', 'aria-label': 'Что планируем' });
  const day = h('input', { class: 'input', type: 'date', min: today, value: date && date > today ? date : today, 'aria-label': 'Дата' });
  const start = h('input', { class: 'input', type: 'time', 'aria-label': 'Начало' });
  const end = h('input', { class: 'input', type: 'time', 'aria-label': 'До скольки' });
  const save = h('button', { type: 'button', class: 'cal2-save' });
  const label = () => {
    const d = day.value || today;
    save.textContent = `Добавить в ${WD_ACC[wdIndex(d)]}, ${parseDate(d).getDate()}-го`;
  };
  day.addEventListener('change', () => { if (!day.value || day.value < today) day.value = today; label(); });
  label();

  save.addEventListener('click', busy(save, async () => {
    const t = title.value.trim();
    if (!t) { title.focus(); toast('Напиши, что планируем ✍️'); return; }
    let duration = null;
    if (start.value && end.value) {
      duration = durationTo(start.value, end.value);
      if (duration === null) { toast('Окончание должно быть позже начала ⏰'); return; }
    }
    const d = day.value || today;
    try {
      await api.createPlan({ title: t, date: d, time: start.value || null, repeat_rule: 'none', remind: 'none',
        color: 'yellow', note: '', duration, subtasks: [] });
      haptic.success();
      toast(`📅 Запланировано на ${fmtDay(d)}`, 'good');
      s.close();
      refreshState().catch(() => {});
      onChange && onChange();
    } catch (e) { toastError(e); }
  }));
  const toInbox = h('button', { type: 'button', class: 'cal2-link' }, '📥 Пока без даты');
  toInbox.addEventListener('click', busy(toInbox, async () => {
    const t = title.value.trim();
    if (!t) { title.focus(); toast('Напиши, что запомнить ✍️'); return; }
    try { await api.addInbox(t); haptic.success(); toast('📥 Во входящих — разберёшь потом', 'good'); s.close(); onChange && onChange(); } catch (e) { toastError(e); }
  }));

  s.setContent(h('div', { class: 'stack cal2-add' },
    h('h2', null, 'Новый план'),
    title,
    h('label', { class: 'qa-field' }, h('span', { class: 'cal2-label' }, 'Дата'), day),
    h('div', { class: 'qa-field' }, h('span', { class: 'cal2-label' }, 'Время ', h('span', { class: 'qa-opt' }, '· необязательно')),
      h('div', { class: 'qa-range' }, h('span', null, 'с'), start, h('span', null, 'до'), end)),
    save, toInbox));
  setTimeout(() => title.focus(), 250);
  return s;
}

export { MONTHS_GEN };

// «Цели месяца» — под календарём.
function goalsCard(ctx) {
  const card = h('button', { type: 'button', class: 'cal2-goals' },
    h('span', { class: 'cal2-goals-grid', 'aria-hidden': 'true' }, Array.from({ length: 9 }, (_, i) => h('i', { class: i === 4 ? 'mid' : '' }))),
    h('span', { class: 'grow' }, h('span', { class: 'cal2-goals-title' }, 'Цели месяца'),
      h('span', { class: 'cal2-goals-sub' }, '9 целей на месяц: собирай линии и получай XP')),
    ico('right'));
  card.addEventListener('click', () => { haptic.tap(); ctx.go('board'); });
  return card;
}
