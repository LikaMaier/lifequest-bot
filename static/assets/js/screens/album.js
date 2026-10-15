// Доска воспоминаний: все фото по месяцам — полароиды на цветном скотче
// в палитре приложения, «случайное воспоминание» и «в этот день»;
// полноэкранный просмотр со свайпом и зумом.

import { h, clear, fmtMonth, plural } from '../dom.js';
import { api } from '../api.js';
import { haptic } from '../tg.js';
import { myMascot } from '../mascot.js';
import { skeleton, emptyState } from '../ui.js';
import { memoryBoard, polaroid, openViewer } from '../photoui.js';
import { openDaySheet, todayIso, addDays } from '../planui.js';

const DECOR = ['✨', '⭐', '💛', '🌸', '🎈', '🍀', '🌈', '💫'];

export async function render(el, ctx) {
  clear(el);
  const st = ctx.state.photos;
  if (!st.enabled) {
    el.append(h('header', { class: 'page-head' }, myMascot('sad', { size: 56 }), h('div', null, h('h1', null, 'Альбом'))),
      h('div', { class: 'card' }, emptyState('Фото пока недоступны — скоро всё заработает.', { expr: 'sad' })));
    return;
  }
  const body = h('div');
  el.append(body);
  body.append(skeleton(170), h('div', { style: { height: '12px' } }), skeleton(260));
  let data;
  try {
    data = await api.photos();
  } catch (e) {
    clear(body).append(h('p', { class: 'muted bold' }, e.message));
    return;
  }
  clear(body);
  const list = data.photos;
  const reload = () => render(el, ctx);
  const addToday = h('button', { type: 'button', class: 'btn small ghost' }, '📷 Фото дня');
  addToday.addEventListener('click', () => { haptic.tap(); openDaySheet(todayIso(), { onChange: reload }); });

  if (!list.length) {
    body.append(hero(ctx, 0, 0, null, addToday),
      h('div', { class: 'card', style: { marginTop: '14px' } },
        emptyState('Здесь будут твои воспоминания: фото с квестов, планов и просто хороших дней. Добавь первое!', { expr: 'love' })));
    return;
  }

  const byMonth = new Map();
  for (const p of list) {
    const key = p.day.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(p);
  }
  const random = h('button', { type: 'button', class: 'btn small colored c-lav' }, '🎲 Случайное');
  random.addEventListener('click', () => { haptic.tap('medium'); openViewer(list, Math.floor(Math.random() * list.length), { onDelete: reload }); });
  body.append(hero(ctx, list.length, byMonth.size, random, addToday));

  const memories = onThisDay(list);
  if (memories) body.append(memories.section(reload));

  let i = 0;
  for (const [key, photos] of byMonth) {
    const deco = DECOR[i % DECOR.length];
    body.append(
      h('div', { class: 'memo-month' },
        h('span', { class: `memo-month-label c-${['pink', 'blue', 'lime', 'lav', 'yellow', 'orange'][i % 6]}` }, fmtMonth(`${key}-01`)),
        h('span', { class: 'memo-month-count' }, `${photos.length} ${plural(photos.length, 'фото', 'фото', 'фото')} ${deco}`)),
      memoryBoard(photos, { onDelete: reload }));
    i++;
  }
  body.append(h('p', { class: 'tiny muted bold center', style: { margin: '18px 0 4px' } },
    `${data.count} из ${data.limit} фото · видишь их только ты 🔒`));
}

function hero(ctx, count, months, random, addToday) {
  return h('section', { class: 'memo-hero card tinted c-pink' },
    h('div', { class: 'row', style: { gap: '12px', alignItems: 'center' } },
      myMascot('love', { size: 70, cls: 'jump' }),
      h('div', { class: 'grow' },
        h('h1', { style: { fontSize: '24px' } }, 'Воспоминания'),
        h('p', { class: 'small bold', style: { marginTop: '4px' } },
          count ? `${count} ${plural(count, 'фото', 'фото', 'фото')} · ${months} ${plural(months, 'месяц', 'месяца', 'месяцев')} приключений` : 'Твоя доска пока пустая'))),
    h('div', { class: 'row', style: { gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, random, addToday));
}

/** «Неделю / месяц / год назад» — если в тот день были фото. */
function onThisDay(list) {
  const today = todayIso();
  const marks = [
    [addDays(today, -7), 'Неделю назад'],
    [shiftMonths(today, -1), 'Месяц назад'],
    [shiftMonths(today, -12), 'Год назад'],
  ];
  for (const [day, label] of marks) {
    const photos = list.filter(p => p.day === day);
    if (photos.length) {
      return {
        section: reload => h('section', { class: 'memo-flash card tinted c-yellow' },
          h('div', { class: 'bold' }, `🕰️ ${label} в этот день`),
          h('div', { class: 'memo-flash-row' }, photos.slice(0, 3).map((p, i) =>
            polaroid(p, { small: true, onOpen: () => openViewer(photos, i, { onDelete: reload }) })))),
      };
    }
  }
  return null;
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
