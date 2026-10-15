// Календарь: месяц с планом выбранного дня прямо под сеткой, неделя лентой
// по часам со свободными окнами (в них можно подкинуть квест) и список.
// Быстрое добавление — кнопками «когда / во сколько», без лишних полей.

import { h, clear, plural, fmtDay, parseDate } from '../dom.js';
import { api } from '../api.js';
import { haptic } from '../tg.js';
import { myMascot } from '../mascot.js';
import { skeleton, toastError, toast, sectionTitle, emptyState, sheet, busy } from '../ui.js';
import { refreshState } from '../store.js';
import { planRow, openPlanSheet, openDaySheet, openQuestPicker, completePlan, pickDate, todayIso, addDays, dayTitle } from '../planui.js';

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
  el.append(h('header', { class: 'cal2-head' }, myMascot(ctx.state.plans_overdue ? 'wink' : 'happy', { size: 54 }),
    h('div', { class: 'grow' }, h('h1', null, 'Календарь'), summary), add));

  const seg = h('div', { class: 'cal2-seg', role: 'group', 'aria-label': 'Вид календаря' },
    [['month', 'Месяц'], ['week', 'Неделя'], ['list', 'Список']].map(([k, label]) => {
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
  if (view.mode === 'month') drawMonth(body, el, ctx);
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

  const grid = h('div', { class: 'cal2-grid', role: 'grid', 'aria-label': `${MONTHS[m - 1]} ${y}` });
  WD.forEach((w, i) => grid.append(h('div', { class: `cal2-wd ${i > 4 ? 'weekend' : ''}`, 'aria-hidden': 'true' }, w)));
  const offset = wdIndex(summary.days[0].date);
  for (let i = 0; i < offset; i++) grid.append(h('div', { 'aria-hidden': 'true' }));
  const cells = new Map();
  for (const d of summary.days) {
    const n = d.planned + d.done;
    const label = [dayTitle(d.date), n ? `${n} ${plural(n, 'план', 'плана', 'планов')}` : 'нет планов',
      d.done ? `выполнено ${d.done}` : null, d.quests_done ? 'был квест' : null, d.photo ? 'есть фото' : null].filter(Boolean).join(', ');
    const cell = h('button', { type: 'button', role: 'gridcell', 'aria-label': label,
      class: `cal2-day ${d.date === today ? 'today' : ''} ${d.complete ? 'complete' : ''} ${d.date < today && !n ? 'quiet' : ''} ${d.overdue ? 'overdue' : ''} ${d.date === view.day ? 'on' : ''}` },
      h('span', { class: 'cal2-num' }, String(parseDate(d.date).getDate())),
      h('span', { class: 'cal2-dots', 'aria-hidden': 'true' }, Array.from({ length: Math.min(3, n) }, () => h('i'))),
      d.quests_done ? ico('star', 'cal2-star') : null);
    cell.addEventListener('click', () => {
      haptic.select();
      cells.get(view.day)?.classList.remove('on');
      view.day = d.date;
      cell.classList.add('on');
      drawDay(dayHost, d.date, today, onChange);
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
    h('span', null, h('i', { class: 'dot' }), 'планы'), h('span', null, h('i', { class: 'done' }), 'всё сделано'),
    h('span', null, ico('star'), 'квест'));
  clear(gridHost).append(grid, legend);
  drawDay(dayHost, view.day, today, onChange);
}

/** План выбранного дня под календарём. */
async function drawDay(host, date, today, onChange) {
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
    host.append(h('div', { class: 'cal2-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(plans.length), 'aria-valuenow': String(done) },
      h('i', { style: { width: `${Math.round((done / plans.length) * 100)}%` } })));
  }
  host.append(h('div', { class: 'cal2-plans' }, plans.map(o => planCard(o, today, onChange))));
  if (!plans.length) host.append(h('p', { class: 'cal2-empty' }, date < today ? 'В этот день планов не было' : 'Пока свободно — самое время что-нибудь придумать'));
  const free = freeEvening(plans, date, today);
  if (free) host.append(free(onChange));
  if (date >= today) host.append(quickInput(date, onChange));
}

/** Карточка плана: время, название, повтор/напоминание и круглая галочка. */
function planCard(o, today, onChange) {
  const done = o.status === 'done';
  const meta = [o.quest ? 'Квест' : null, REPEAT_SHORT[o.repeat_rule], o.remind === 'hour_before' ? 'напомню за час' : o.remind === 'at_time' ? 'напомню вовремя' : null,
    o.photos ? `📷 ${o.photos}` : null].filter(Boolean).join(' · ');
  const info = h('button', { type: 'button', class: 'cal2-plan-info', 'aria-label': `${o.title}${o.time ? `, ${o.time}` : ''}. Открыть` },
    h('span', { class: `cal2-time ${o.time ? '' : 'none'}` }, o.time || (o.quest ? o.quest.emoji : '—')),
    h('span', { class: 'grow' }, h('span', { class: 'cal2-plan-title' }, o.title), meta ? h('span', { class: 'cal2-plan-meta' }, meta) : null));
  info.addEventListener('click', () => { haptic.tap(); openPlanSheet(o, { onChange }); });
  const card = h('div', { class: `cal2-plan ${done ? 'done' : ''} ${o.overdue ? 'overdue' : ''}` }, info);
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
  return card;
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
  const strip = h('div', { class: 'cal2-strip' });
  const dayHost = h('div');
  const statsHost = h('div');
  body.append(strip, dayHost, statsHost);
  strip.append(skeleton(84));
  let plans;
  try {
    plans = (await api.plans(from, to)).plans;
  } catch (e) {
    clear(strip).append(h('p', { class: 'muted bold' }, e.message));
    return;
  }
  if (view.mode !== 'week') return;
  clear(strip);
  const byDay = d => visiblePlans(plans.filter(o => o.date === d));
  const buttons = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(from, i);
    const list = byDay(date);
    const btn = h('button', { type: 'button', class: `cal2-strip-day ${date === today ? 'today' : ''} ${date === sel ? 'on' : ''}`,
      'aria-label': `${WD_FULL[i]}, ${parseDate(date).getDate()} ${MONTHS_GEN[parseDate(date).getMonth()]}: ${list.length} ${plural(list.length, 'план', 'плана', 'планов')}`, 'aria-pressed': String(date === sel) },
      h('span', { class: 'wd' }, WD[i]), h('span', { class: 'n' }, String(parseDate(date).getDate())),
      h('span', { class: 'load', 'aria-hidden': 'true' }, Array.from({ length: Math.min(3, list.length) }, () => h('i'))));
    btn.addEventListener('click', () => {
      haptic.select();
      view.day = date;
      buttons.forEach(x => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('on');
      btn.setAttribute('aria-pressed', 'true');
      drawTimeline(dayHost, date, byDay(date), today, onChange);
    });
    buttons.push(btn);
    strip.append(btn);
  }
  drawTimeline(dayHost, sel, byDay(sel), today, onChange);
  // свайп по ленте дней — соседняя неделя
  let sx = null;
  strip.addEventListener('touchstart', e => { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  strip.addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  });

  // итог недели
  const counts = Array.from({ length: 7 }, (_, i) => {
    const list = byDay(addDays(from, i));
    return { all: list.length, done: list.filter(o => o.status === 'done').length };
  });
  const all = counts.reduce((s, c) => s + c.all, 0), doneAll = counts.reduce((s, c) => s + c.done, 0);
  if (all) {
    const max = Math.max(1, ...counts.map(c => c.all));
    statsHost.append(h('section', { class: 'cal2-stats' },
      h('div', { class: 'cal2-stats-head' }, h('span', { class: 'bold' }, 'Итог недели'), h('span', { class: 'cal2-count' }, `${doneAll} из ${all}`)),
      h('div', { class: 'cal2-bars', 'aria-hidden': 'true' }, counts.map((c, i) => h('div', null,
        h('span', { class: 'track' }, h('i', { class: c.all && c.done === c.all ? 'full' : '', style: { height: `${Math.max(c.all ? 8 : 4, Math.round((c.done / max) * 64))}px` } })),
        h('span', { class: 'wd' }, WD[i]))))));
  }
}

/** Лента дня: планы по времени и свободные окна между ними. */
function drawTimeline(host, date, plans, today, onChange) {
  clear(host);
  const done = plans.filter(o => o.status === 'done').length;
  const open = h('button', { type: 'button', class: 'cal2-icon-btn soft', 'aria-label': 'Заметки и фото дня' }, ico('dots'));
  open.addEventListener('click', () => { haptic.tap(); openDaySheet(date, { onChange }); });
  host.append(h('div', { class: 'cal2-sec-head' }, h('h2', null, longDay(date)),
    plans.length ? h('span', { class: 'cal2-count lime' }, `${done} из ${plans.length}`) : null, open));
  const untimed = plans.filter(o => !o.time);
  const timed = plans.filter(o => o.time);
  const line = h('div', { class: 'cal2-line' });
  if (untimed.length) {
    line.append(h('div', { class: 'cal2-slot' }, h('span', { class: 'cal2-hour' }, 'весь день'),
      h('div', { class: 'cal2-slot-body' }, untimed.map(o => planCard(o, today, onChange)))));
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
  for (const o of timed) {
    const start = toMin(o.time);
    if (date >= today && start - cursor >= FREE_MIN_HOURS * 60) line.append(freeSlot(cursor, start));
    line.append(h('div', { class: 'cal2-slot' }, h('span', { class: 'cal2-hour' }, o.time), h('div', { class: 'cal2-slot-body' }, planCard(o, today, onChange))));
    cursor = Math.max(cursor, start + 60);
  }
  if (date >= today && FREE_TO * 60 - cursor >= FREE_MIN_HOURS * 60) line.append(freeSlot(cursor, FREE_TO * 60));
  if (!line.childElementCount) line.append(h('p', { class: 'cal2-empty' }, date < today ? 'В этот день планов не было' : 'Пока пусто'));
  host.append(h('section', { class: 'cal2-card cal2-timeline' }, line));
  if (date >= today) host.append(quickInput(date, onChange));
}
const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

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
const IDEAS = ['Прогулка', 'Звонок маме', 'Спортзал', 'Свидание', 'Кино', 'Уборка'];
const TIMES = [['morning', 'Утро', '09:00'], ['day', 'День', '14:00'], ['evening', 'Вечер', '19:00'], ['own', 'Своё', '']];
const REPEAT_ORDER = ['none', 'daily', 'weekdays', 'weekly'];

export function openQuickAdd(date, { onChange } = {}) {
  const today = todayIso();
  const sat = addDays(today, (5 - wdIndex(today) + 7) % 7);
  const form = { title: '', date: date || today, time: '', timeKey: '', repeat_rule: 'none', remind: 'none' };
  const s = sheet(h('div'), { label: 'Новый план' });
  const chip = (text, on, fn, cls = '') => {
    const b = h('button', { type: 'button', class: `cal2-chip ${cls} ${on ? 'on' : ''}`, 'aria-pressed': String(on) }, text);
    b.addEventListener('click', () => { haptic.select(); fn(); draw(); });
    return b;
  };
  const title = h('input', { class: 'cal2-title-input', type: 'text', maxlength: '80', placeholder: 'Например: пикник в парке', 'aria-label': 'Что планируем' });
  title.addEventListener('input', () => { form.title = title.value; });
  const draw = () => {
    title.value = form.title;
    const when = [['Сегодня', today], ['Завтра', addDays(today, 1)], ['Выходные', sat]];
    const isCustom = !when.some(([, d]) => d === form.date);
    const timeIn = h('input', { class: 'input', type: 'time', value: form.time, 'aria-label': 'Своё время' });
    timeIn.addEventListener('change', () => { form.time = timeIn.value; if (!form.time) form.remind = 'none'; draw(); });
    const save = h('button', { type: 'button', class: 'cal2-save' },
      `Добавить в ${WD_ACC[wdIndex(form.date)]}, ${parseDate(form.date).getDate()}-го`);
    save.addEventListener('click', busy(save, async () => {
      const t = form.title.trim();
      if (!t) { title.focus(); toast('Напиши, что планируем ✍️'); return; }
      try {
        await api.createPlan({ title: t, date: form.date, time: form.time || null, repeat_rule: form.repeat_rule,
          remind: form.time ? form.remind : 'none', color: 'yellow', note: '' });
        haptic.success();
        toast(`📅 Запланировано на ${fmtDay(form.date)}`, 'good');
        s.close();
        refreshState().catch(() => {});
        onChange && onChange();
      } catch (e) { toastError(e); }
    }));
    const quest = h('button', { type: 'button', class: 'cal2-link' }, '🎯 Или выбрать задание из банка LifeQuest');
    quest.addEventListener('click', () => { haptic.tap(); s.close(); openQuestPicker(form.date, { onChange }); });
    const repeatBtn = h('button', { type: 'button', class: `cal2-toggle ${form.repeat_rule !== 'none' ? 'on' : ''}` }, ico('repeat'), REPEAT[form.repeat_rule]);
    repeatBtn.addEventListener('click', () => {
      haptic.select();
      form.repeat_rule = REPEAT_ORDER[(REPEAT_ORDER.indexOf(form.repeat_rule) + 1) % REPEAT_ORDER.length];
      draw();
    });
    const remindBtn = h('button', { type: 'button', class: `cal2-toggle ${form.remind === 'hour_before' ? 'on lime' : ''}`, disabled: !form.time },
      ico('bell'), form.time ? (form.remind === 'hour_before' ? 'Напомню за час' : 'Без напоминания') : 'Напомнить (нужно время)');
    remindBtn.addEventListener('click', () => { haptic.select(); form.remind = form.remind === 'hour_before' ? 'none' : 'hour_before'; draw(); });
    s.setContent(h('div', { class: 'stack cal2-add' },
      h('h2', null, 'Новый план'),
      h('div', null, h('div', { class: 'cal2-label' }, 'Что планируем'), title,
        h('div', { class: 'cal2-chips', style: { marginTop: '8px' } }, IDEAS.map(t => chip(t, false, () => { form.title = t; }, 'idea')))),
      h('div', null, h('div', { class: 'cal2-label' }, 'Когда'),
        h('div', { class: 'cal2-chips' },
          when.map(([label, d]) => chip(label, form.date === d, () => { form.date = d; })),
          pickChip(isCustom))),
      h('div', null, h('div', { class: 'cal2-label' }, 'Время'),
        h('div', { class: 'cal2-times' }, TIMES.map(([k, label, t]) => {
          const on = form.timeKey === k;
          const b = h('button', { type: 'button', class: `cal2-time-btn ${on ? 'on' : ''}`, 'aria-pressed': String(on) },
            h('b', null, label), h('small', null, k === 'own' ? (on && form.time ? form.time : '--:--') : t));
          b.addEventListener('click', () => {
            haptic.select();
            if (on) { form.timeKey = ''; form.time = ''; form.remind = 'none'; }
            else { form.timeKey = k; form.time = t; if (!t) form.remind = 'none'; }
            draw();
          });
          return b;
        })),
        form.timeKey === 'own' ? h('div', { style: { marginTop: '8px' } }, timeIn) : null),
      h('div', { class: 'cal2-toggles' }, repeatBtn, remindBtn),
      save, quest));
  };
  const pickChip = isCustom => {
    const b = h('button', { type: 'button', class: `cal2-chip ${isCustom ? 'on' : ''}`, 'aria-pressed': String(isCustom) },
      isCustom ? fmtDay(form.date) : 'Выбрать дату');
    b.addEventListener('click', async () => {
      haptic.select();
      const d = await pickDate(form.date, 'Выбери дату');
      if (d) { form.date = d < today ? today : d; draw(); }
    });
    return b;
  };
  draw();
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
