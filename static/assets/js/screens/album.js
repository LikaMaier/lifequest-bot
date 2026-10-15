// Воспоминания: фотокалендарь месяца (дни с фото — миниатюрами), фото
// выбранного дня, «фото месяца» и журнальная сетка всех фото месяца;
// фильтры по типу, «Мой год в фото» и полноэкранный просмотр.

import { h, append, clear, fmtDay, plural } from '../dom.js';
import { api } from '../api.js';
import { haptic } from '../tg.js';
import { myMascot } from '../mascot.js';
import { skeleton, emptyState, sheet, toast, toastError } from '../ui.js';
import { lazyThumb, openViewer, yearShareCard } from '../photoui.js';
import { openDaySheet, todayIso } from '../planui.js';

const MONTH_COLORS = ['lav', 'blue', 'pink', 'lime', 'yellow', 'orange'];
const SHORT_MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const FILTERS = [['all', 'Все'], ['quest', 'Квесты'], ['plan', 'Планы'], ['day', 'Дни'], ['board', 'Цели']];
const KIND = { quest: 'Квест', plan: 'План', day: 'День', board: 'Цели месяца' };

const DOODLES = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l2.6 6.5L21 9l-5 4.4L17.5 21 12 17.3 6.5 21 8 13.4 3 9l6.4-.5z" fill="#FFD23F" stroke="#C99A00" stroke-width="1.2" stroke-linejoin="round"/></svg>',
};
const ICONS = {
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3c4 0 6 10 10 10h5M18 14l3 3-3 3M3 17h3c1.5 0 2.6-1.4 3.6-3M14.4 10C15.4 8.4 16.5 7 18 7h3M18 4l3 3-3 3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
};
const icon = name => h('span', { class: 'memo-ico', 'aria-hidden': 'true', html: ICONS[name] });
const iconBtn = (name, label, dark) => h('button', { type: 'button', class: `memo-icon-btn ${dark ? 'dark' : ''}`, 'aria-label': label }, icon(name));

let filter = 'all';
let month = null;   // 'YYYY-MM', который показан
let selected = null; // выбранный день 'YYYY-MM-DD'

export async function render(el, ctx) {
  clear(el);
  const st = ctx.state.photos;
  if (!st.enabled) {
    el.append(h('header', { class: 'page-head' }, myMascot('sad', { size: 56 }), h('div', null, h('h1', null, 'Альбом'))),
      h('div', { class: 'card' }, emptyState('Фото пока недоступны — скоро всё заработает.', { expr: 'sad' })));
    return;
  }
  const body = h('div', { class: 'memo-page' });
  el.append(body);
  body.append(skeleton(120), h('div', { style: { height: '12px' } }), skeleton(320));
  let data;
  try {
    data = await api.photos();
  } catch (e) {
    clear(body).append(h('p', { class: 'muted bold' }, e.message));
    return;
  }
  clear(body);
  const all = data.photos;
  const reload = () => render(el, ctx);
  const today = todayIso();
  const thisMonth = today.slice(0, 7);

  const random = iconBtn('shuffle', 'Случайное фото');
  random.disabled = !all.length;
  random.addEventListener('click', () => { haptic.tap('medium'); openViewer(all, Math.floor(Math.random() * all.length), { onDelete: reload }); });
  const add = iconBtn('plus', 'Добавить фото дня', true);
  add.addEventListener('click', () => { haptic.tap(); openDaySheet(selected || today, { onChange: reload }); });

  const months = new Set(all.map(p => p.day.slice(0, 7)));
  const quests = new Set(all.filter(p => p.target === 'quest').map(p => p.quest_history_id)).size;
  const first = all.length ? all.reduce((m, p) => (p.day < m ? p.day : m), all[0].day) : today;
  const sub = all.length
    ? [`${all.length} ${plural(all.length, 'фото', 'фото', 'фото')}`, quests ? `${quests} ${plural(quests, 'квест', 'квеста', 'квестов')}` : null,
      `с ${MONTHS_GEN[+first.slice(5, 7) - 1]}`].filter(Boolean).join(' · ')
    : 'Твоя доска пока пустая';
  body.append(h('header', { class: 'memo-head' }, h('h1', null, 'Воспоминания'),
    h('div', { class: 'memo-head-row' }, h('p', null, sub), h('div', { class: 'memo-head-actions' }, random, add))));

  if (!all.length) {
    body.append(h('div', { class: 'card', style: { marginTop: '14px' } },
      emptyState('Здесь будут твои воспоминания: фото с квестов, планов и просто хороших дней. Добавь первое!', { expr: 'love' })));
    return;
  }

  const firstMonth = first.slice(0, 7);
  if (!month || month < firstMonth || month > thisMonth) month = months.has(thisMonth) ? thisMonth : [...months].sort().pop();

  const present = new Set(all.map(p => p.target));
  if (!present.has(filter)) filter = 'all';
  const view = h('div');
  const draw = () => {
    clear(view);
    const list = filter === 'all' ? all : all.filter(p => p.target === filter);
    const inMonth = list.filter(p => p.day.startsWith(month));
    const byDay = new Map();
    for (const p of inMonth) {
      if (!byDay.has(p.day)) byDay.set(p.day, []);
      byDay.get(p.day).push(p);
    }
    if (!selected || !selected.startsWith(month)) selected = [...byDay.keys()].sort().pop() || null;

    const go = step => {
      haptic.select();
      const [y, m] = month.split('-').map(Number);
      const d = new Date(y, m - 1 + step, 1);
      month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      selected = null;
      draw();
    };
    const prev = iconBtn('left', 'Предыдущий месяц');
    const next = iconBtn('right', 'Следующий месяц');
    prev.disabled = month <= firstMonth;
    next.disabled = month >= thisMonth;
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    const [y, m] = month.split('-').map(Number);
    const daysWith = byDay.size;

    const grid = h('div', { class: 'memo-cal-grid' });
    const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) grid.append(h('span', { class: 'memo-cal-cell blank', 'aria-hidden': 'true' }));
    const last = new Date(y, m, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      const photos = byDay.get(iso) || [];
      const future = iso > today;
      const cell = h('button', { type: 'button', disabled: future,
        class: `memo-cal-cell ${photos.length ? 'has' : ''} ${future ? 'future' : ''} ${iso === today ? 'today' : ''} ${iso === selected ? 'on' : ''}`,
        'aria-label': `${fmtDay(iso)}${photos.length ? `, ${photos.length} фото` : ''}`, 'aria-pressed': String(iso === selected) },
        photos.length ? lazyThumb(photos[0]) : null,
        h('span', { class: 'memo-cal-num' }, String(d)));
      cell.addEventListener('click', () => { haptic.select(); selected = iso; draw(); });
      grid.append(cell);
    }
    view.append(h('section', { class: 'memo-cal' },
      h('div', { class: 'memo-cal-head' }, prev,
        h('div', { class: 'center' }, h('div', { class: 'memo-cal-title' }, `${MONTHS[m - 1]} ${y}`),
          h('div', { class: 'memo-cal-sub' }, daysWith ? `${daysWith} ${plural(daysWith, 'день', 'дня', 'дней')} с фото` : 'Пока без фото')),
        next),
      h('div', { class: 'memo-cal-grid wd', 'aria-hidden': 'true' }, WEEKDAYS.map(w => h('span', null, w))),
      grid));

    if (selected) view.append(dayPanel(selected, byDay.get(selected) || [], reload));
    if (!inMonth.length) return;

    const hero = pickHero(inMonth);
    const heroBtn = h('button', { type: 'button', class: 'memo-hero-photo', style: { aspectRatio: String(ratio(hero, 0.8, 1.5)) }, 'aria-label': `Фото месяца: ${hero.label || fmtDay(hero.day)}` },
      h('img', { src: hero.url, alt: '', decoding: 'async' }),
      h('span', { class: 'memo-pill' }, 'Фото месяца'),
      h('span', { class: 'memo-hero-cap' },
        h('span', { class: 'memo-hero-kicker' }, `${MONTHS[m - 1]} ${y}`),
        h('span', { class: 'memo-hero-title' }, hero.label || fmtDay(hero.day))));
    heroBtn.addEventListener('click', () => { haptic.tap(); openViewer(inMonth, inMonth.indexOf(hero), { onDelete: reload }); });

    // Две колонки «кирпичиками»: каждое фото в своих пропорциях, без обрезки
    // лиц; очередное фото уходит в более короткую колонку.
    const cols = [h('div', { class: 'memo-col' }), h('div', { class: 'memo-col' })];
    const heights = [0, 0];
    inMonth.forEach((p, i) => {
      const r = ratio(p);
      const t = h('button', { type: 'button', class: 'memo-tile', style: { aspectRatio: String(r) }, 'aria-label': p.label || fmtDay(p.day) },
        lazyThumb(p), p.label ? h('span', { class: 'memo-pill small' }, p.label) : null);
      t.addEventListener('click', () => { haptic.tap(); openViewer(inMonth, i, { onDelete: reload }); });
      const c = heights[0] <= heights[1] ? 0 : 1;
      cols[c].append(t);
      heights[c] += 1 / r;
    });
    const tiles = h('div', { class: 'memo-grid' }, cols);
    view.append(heroBtn,
      h('div', { class: 'memo-sec-head' }, h('h2', null, MONTHS[m - 1]), h('span', null, `${inMonth.length} ${plural(inMonth.length, 'фото', 'фото', 'фото')}`)),
      tiles);
  };

  const chips = h('div', { class: 'memo-chips', role: 'tablist', 'aria-label': 'Фильтр фото' });
  const drawChips = () => {
    clear(chips);
    for (const [key, label] of FILTERS) {
      if (key !== 'all' && !present.has(key)) continue;
      const b = h('button', { type: 'button', role: 'tab', class: `memo-chip ${filter === key ? 'on' : ''}`, 'aria-selected': String(filter === key) }, label);
      b.addEventListener('click', () => { haptic.select(); filter = key; drawChips(); draw(); });
      chips.append(b);
    }
  };
  const yearBtn = h('button', { type: 'button', class: 'memo-year-btn' }, icon('grid'), 'Мой год в фото');
  yearBtn.addEventListener('click', () => { haptic.tap(); openYear(all, key => { month = key; selected = null; filter = 'all'; drawChips(); draw(); }); });
  drawChips();
  draw();
  body.append(chips, view, yearBtn, h('p', { class: 'memo-foot' }, `🔒 ${data.count} из ${data.limit} фото · видишь их только ты`));
}

/** Фото месяца: последнее фото с квеста, иначе последнее с подписью, иначе последнее. */
function pickHero(list) {
  return list.find(p => p.target === 'quest') || list.find(p => p.label) || list[0];
}

/** Фото выбранного дня под календарём. */
function dayPanel(day, photos, reload) {
  const add = h('button', { type: 'button', class: 'memo-btn light small' }, icon('camera'), photos.length ? 'Ещё фото' : 'Добавить фото');
  add.addEventListener('click', () => { haptic.tap(); openDaySheet(day, { onChange: reload }); });
  const head = h('div', { class: 'memo-sec-head' }, h('h2', null, fmtDay(day)), add);
  if (!photos.length) return h('section', { class: 'memo-day' }, head, h('p', { class: 'memo-day-empty' }, 'В этот день фото нет'));
  const pics = h('div', { class: `memo-day-pics ${photos.length === 1 ? 'one' : ''}` }, photos.map((p, i) => {
    const b = h('button', { type: 'button', class: 'memo-tile', style: { aspectRatio: String(ratio(p, photos.length === 1 ? 0.8 : 0.6, 1.6)) },
      'aria-label': p.label || 'Фото' }, lazyThumb(p));
    b.addEventListener('click', () => { haptic.tap(); openViewer(photos, i, { onDelete: reload }); });
    return b;
  }));
  const labels = [...new Map(photos.filter(p => p.label).map(p => [p.label, p])).values()].slice(0, 3);
  return h('section', { class: 'memo-day' }, head, pics, labels.map(p => h('div', { class: 'memo-day-item' },
    h('span', { class: `memo-day-ico k-${p.target}`, 'aria-hidden': 'true' }, p.target === 'quest' ? '✓' : '•'),
    h('div', { class: 'grow' }, h('div', { class: 'bold' }, p.label), h('div', { class: 'tiny muted bold' }, KIND[p.target] || 'Фото')))));
}

/** Пропорции фото (ширина / высота), чтобы показывать его без обрезки;
 *  слишком вытянутые слегка подрезаются до разумных рамок. */
function ratio(p, min = 0.62, max = 1.6) {
  const r = p.w && p.h ? p.w / p.h : 1;
  return Math.min(max, Math.max(min, Math.round(r * 1000) / 1000));
}

function groupByMonth(list) {
  const byMonth = new Map();
  for (const p of list) {
    const key = p.day.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(p);
  }
  return byMonth;
}

function openYear(all, jump) {
  const years = [...new Set(all.map(p => p.day.slice(0, 4)))].sort().reverse();
  let year = years[0];
  const content = h('div', { class: 'stack' });
  const s = sheet(content, { label: 'Мой год в фото' });
  const draw = () => {
    clear(content);
    const list = all.filter(p => p.day.startsWith(year));
    const byMonth = groupByMonth(list);
    let best = null;
    for (const [k, v] of byMonth) if (!best || v.length > byMonth.get(best).length) best = k;
    const quests = new Set(list.filter(p => p.target === 'quest').map(p => p.quest_history_id)).size;
    const yearTabs = years.length > 1 ? h('div', { class: 'memo-chips' }, years.map(y => {
      const b = h('button', { type: 'button', class: `memo-chip ${y === year ? 'on' : ''}` }, y);
      b.addEventListener('click', () => { haptic.select(); year = y; draw(); });
      return b;
    })) : null;
    const grid = h('div', { class: 'memo-year-grid' });
    for (let m = 0; m < 12; m++) {
      const key = `${year}-${String(m + 1).padStart(2, '0')}`;
      const photos = byMonth.get(key) || [];
      const color = MONTH_COLORS[m % MONTH_COLORS.length];
      const tile = h(photos.length ? 'button' : 'div', { type: photos.length ? 'button' : undefined,
        class: `memo-year-tile ${photos.length ? `c-${color}` : 'empty'}` },
        photos.slice(0, 2).map((p, i) => h('span', { class: `memo-year-pic p${i}` }, h('img', { src: p.thumb, alt: '', loading: 'lazy' }))),
        h('span', { class: 'memo-year-name' }, SHORT_MONTHS[m]),
        h('span', { class: 'memo-year-count' }, photos.length ? `${photos.length}` : '—'),
        key === best ? h('span', { class: 'memo-doodle star best', 'aria-label': 'Лучший месяц', html: DOODLES.star }) : null);
      if (photos.length) {
        tile.addEventListener('click', () => {
          haptic.tap();
          s.close();
          jump(key);
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      }
      grid.append(tile);
    }
    const cardBtn = h('button', { type: 'button', class: 'memo-btn lime block' }, icon('grid'), 'Собрать карточку года');
    cardBtn.addEventListener('click', async () => {
      haptic.tap();
      cardBtn.disabled = true;
      try {
        await api.share(await yearShareCard(year, byMonth, list.length, quests));
        haptic.success();
        toast('📬 Карточка года уже в чате с ботом — перешли друзьям!', 'good', 3200);
      } catch (e) { toastError(e); }
      cardBtn.disabled = false;
    });
    append(content, [
      h('div', null, h('div', { class: 'memo-hand pink' }, year), h('h2', { style: { margin: 0 } }, 'Мой год в фото')),
      yearTabs,
      h('div', { class: 'memo-year-stats' },
        h('div', { class: 'c-pink' }, h('b', null, String(list.length)), plural(list.length, 'фото', 'фото', 'фото')),
        h('div', { class: 'c-lav' }, h('b', null, String(quests)), plural(quests, 'квест', 'квеста', 'квестов')),
        h('div', { class: 'c-yellow' }, h('b', null, best ? SHORT_MONTHS[+best.slice(5) - 1].toLowerCase() : '—'), 'самый яркий')),
      grid, cardBtn]);
  };
  draw();
}
