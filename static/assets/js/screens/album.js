// Доска воспоминаний: скрапбук по месяцам — полароиды на скотче и кнопках,
// стикеры-месяцы, дудлы и заметки; «в этот день», фильтры по типу,
// «Мой год в фото» и полноэкранный просмотр-полароид.

import { h, append, clear, fmtMonth, plural } from '../dom.js';
import { api } from '../api.js';
import { haptic } from '../tg.js';
import { myMascot } from '../mascot.js';
import { skeleton, emptyState, sheet, toast, toastError } from '../ui.js';
import { polaroid, openViewer, yearShareCard } from '../photoui.js';
import { openDaySheet, todayIso, addDays } from '../planui.js';

const MONTH_COLORS = ['lav', 'blue', 'pink', 'lime', 'yellow', 'orange'];
const SHORT_MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const FILTERS = [['all', 'Все'], ['quest', 'Квесты'], ['plan', 'Планы'], ['day', 'Дни'], ['board', 'Цели']];
const PER_MONTH = 7;

const DOODLES = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l2.6 6.5L21 9l-5 4.4L17.5 21 12 17.3 6.5 21 8 13.4 3 9l6.4-.5z" fill="#FFD23F" stroke="#C99A00" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" fill="#F3619C"/></svg>',
  arrow: '<svg viewBox="0 0 70 40"><path d="M4 30 C 18 6, 30 36, 44 14 S 60 10, 64 22" fill="none" stroke="#6B4B9E" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="1 6"/><path d="M58 16 l7 6 -9 3" fill="none" stroke="#6B4B9E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v6M12 15v6M3 12h6M15 12h6" stroke="#93ABD8" stroke-width="2.6" stroke-linecap="round"/></svg>',
};
const ICONS = {
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
};
const icon = name => h('span', { class: 'memo-ico', 'aria-hidden': 'true', html: ICONS[name] });

let filter = 'all';

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
  body.append(skeleton(190), h('div', { style: { height: '12px' } }), skeleton(300));
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
  const addToday = h('button', { type: 'button', class: 'memo-btn light' }, icon('camera'), 'Фото дня');
  addToday.addEventListener('click', () => { haptic.tap(); openDaySheet(todayIso(), { onChange: reload }); });

  if (!all.length) {
    body.append(hero(all, null, addToday),
      h('div', { class: 'card', style: { marginTop: '14px' } },
        emptyState('Здесь будут твои воспоминания: фото с квестов, планов и просто хороших дней. Добавь первое!', { expr: 'love' })));
    return;
  }

  const random = h('button', { type: 'button', class: 'memo-btn dark' }, icon('dice'), 'Случайное');
  random.addEventListener('click', () => { haptic.tap('medium'); openViewer(all, Math.floor(Math.random() * all.length), { onDelete: reload }); });
  body.append(hero(all, random, addToday));

  const flash = onThisDay(all, reload);
  if (flash) body.append(flash);

  const boards = h('div');
  const present = new Set(all.map(p => p.target));
  const chips = h('div', { class: 'memo-chips', role: 'tablist', 'aria-label': 'Фильтр фото' });
  const drawChips = () => {
    clear(chips);
    for (const [key, label] of FILTERS) {
      if (key !== 'all' && !present.has(key)) continue;
      const b = h('button', { type: 'button', role: 'tab', class: `memo-chip ${filter === key ? 'on' : ''}`, 'aria-selected': String(filter === key) }, label);
      b.addEventListener('click', () => { haptic.select(); filter = key; drawChips(); drawBoards(); });
      chips.append(b);
    }
  };
  const yearBtn = h('button', { type: 'button', class: 'memo-year-btn' }, icon('grid'), 'Мой год в фото');
  const jump = key => {
    filter = 'all';
    drawChips();
    drawBoards();
    const target = document.getElementById(`memo-${key}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  yearBtn.addEventListener('click', () => { haptic.tap(); openYear(all, jump); });

  const drawBoards = () => {
    clear(boards);
    const list = filter === 'all' || !present.has(filter) ? all : all.filter(p => p.target === filter);
    const byMonth = groupByMonth(list);
    let i = 0;
    for (const [key, photos] of byMonth) {
      boards.append(monthBlock(key, photos, i++, reload));
    }
  };
  if (!present.has(filter)) filter = 'all';
  drawChips();
  drawBoards();
  body.append(h('div', { class: 'memo-tools' }, chips, yearBtn), boards,
    h('p', { class: 'memo-foot' }, `🔒 ${data.count} из ${data.limit} фото · видишь их только ты`));
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

function hero(all, random, addToday) {
  const months = new Set(all.map(p => p.day.slice(0, 7))).size;
  const quests = new Set(all.filter(p => p.target === 'quest').map(p => p.quest_history_id)).size;
  const chip = (text, dark) => h('span', { class: `memo-stat ${dark ? 'dark' : ''}` }, text);
  return h('section', { class: 'memo-hero' },
    h('div', { class: 'memo-hero-pet' }, myMascot('love', { size: 68, cls: 'jump' })),
    h('div', { class: 'memo-hand light' }, 'моя доска'),
    h('h1', null, 'Воспоминания'),
    all.length
      ? h('div', { class: 'memo-stats' },
        chip(`${all.length} ${plural(all.length, 'фото', 'фото', 'фото')}`),
        chip(`${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}`),
        quests ? chip(`${quests} ${plural(quests, 'квест', 'квеста', 'квестов')}`, true) : null)
      : h('p', { class: 'bold', style: { margin: '4px 0 0' } }, 'Твоя доска пока пустая'),
    h('div', { class: 'memo-hero-actions' }, random, addToday));
}

/** Одна страница месяца: стикер, коллаж из полароидов, дудлы и заметка. */
function monthBlock(key, photos, index, reload) {
  const color = MONTH_COLORS[index % MONTH_COLORS.length];
  const tilt = index % 2 ? 1.5 : -2;
  const board = h('div', { class: 'memo-collage' });
  const head = h('div', { class: 'memo-month', id: `memo-${key}` },
    h('span', { class: `memo-sticker c-${color}`, style: { '--tilt': `${tilt}deg` } }, fmtMonth(`${key}-01`)),
    h('span', { class: 'memo-month-count' }, `${photos.length} ${plural(photos.length, 'фото', 'фото', 'фото')}`));

  const draw = limit => {
    clear(board);
    const shown = photos.slice(0, limit);
    shown.forEach((p, i) => {
      board.append(polaroid(p, { onOpen: () => openViewer(photos, i, { onDelete: reload }) }));
      if (i === 2 || (shown.length < 3 && i === shown.length - 1)) board.append(note(photos, index));
    });
    const doodles = ['star', 'heart', 'arrow', 'spark'];
    const spots = [['47%', '24%', 14], ['88%', '8%', -10], ['8%', '62%', 0], ['50%', '78%', 20]];
    spots.slice(0, Math.min(4, 1 + Math.floor(shown.length / 2))).forEach(([x, y, r], i) => {
      const d = doodles[(i + index) % doodles.length];
      board.append(h('span', { class: `memo-doodle ${d}`, 'aria-hidden': 'true', style: { left: x, top: y, '--r': `${r}deg` }, html: DOODLES[d] }));
    });
    if (photos.length > limit) {
      const more = h('button', { type: 'button', class: 'memo-more' }, `ещё ${photos.length - limit} →`);
      more.addEventListener('click', () => { haptic.tap(); draw(photos.length); });
      board.append(more);
    }
  };
  draw(PER_MONTH);
  return h('section', { class: 'memo-month-block' }, head, board);
}

/** Стикер-заметка месяца: маленький итог от руки. */
function note(photos, index) {
  const quests = new Set(photos.filter(p => p.target === 'quest').map(p => p.quest_history_id)).size;
  const days = new Set(photos.map(p => p.day)).size;
  let text;
  if (quests >= 3) text = `${quests} ${plural(quests, 'квест', 'квеста', 'квестов')} с фото — вот это месяц!`;
  else if (quests) text = `${quests} ${plural(quests, 'квест', 'квеста', 'квестов')} на память ✨`;
  else text = `${days} ${plural(days, 'яркий день', 'ярких дня', 'ярких дней')}`;
  const colors = ['lime', 'yellow', 'pink', 'blue'];
  return h('div', { class: `memo-note c-${colors[index % colors.length]}`, 'aria-hidden': 'true' }, text);
}

/** «Неделю / месяц / год назад» — если в тот день были фото. */
function onThisDay(list, reload) {
  const today = todayIso();
  const marks = [
    [addDays(today, -7), 'Неделю назад'],
    [shiftMonths(today, -1), 'Месяц назад'],
    [shiftMonths(today, -12), 'Год назад'],
  ];
  for (const [day, label] of marks) {
    const photos = list.filter(p => p.day === day);
    if (photos.length) {
      const d = new Date(`${day}T12:00:00`);
      return h('section', { class: 'memo-flash' },
        h('div', { class: 'memo-flash-head' },
          h('div', null, h('div', { class: 'memo-kicker' }, 'В этот день'), h('div', { class: 'memo-flash-title' }, label)),
          h('div', { class: 'memo-stamp', 'aria-hidden': 'true' },
            h('b', null, String(d.getDate())), h('span', null, `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`))),
        h('div', { class: 'memo-flash-row' }, photos.slice(0, 3).map((p, i) =>
          polaroid(p, { small: true, onOpen: () => openViewer(photos, i, { onDelete: reload }) }))));
    }
  }
  return null;
}

/** «Мой год в фото»: 12 месяцев мини-коллажами, лучший месяц со звездой. */
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

function shiftMonths(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
