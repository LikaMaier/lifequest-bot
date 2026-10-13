// Альбом: все фото по месяцам на «доске воспоминаний» — полароиды на скотче
// и кнопках; полноэкранный просмотр со свайпом и зумом.

import { h, clear, fmtMonth } from '../dom.js';
import { api } from '../api.js';
import { haptic } from '../tg.js';
import { myMascot } from '../mascot.js';
import { skeleton, emptyState, sectionTitle } from '../ui.js';
import { memoryBoard } from '../photoui.js';

export async function render(el, ctx) {
  clear(el);
  el.append(h('header', { class: 'page-head' }, myMascot('love', { size: 56 }),
    h('div', null, h('h1', null, 'Альбом'), h('p', null, 'Фото-воспоминания твоих приключений. Видишь их только ты.'))));
  const st = ctx.state.photos;
  if (!st.enabled) {
    el.append(h('div', { class: 'card' }, emptyState('Фото пока недоступны — скоро всё заработает.', { kind: 'cat-blue', expr: 'sad' })));
    return;
  }
  const body = h('div');
  el.append(body);
  body.append(skeleton(120), h('div', { style: { height: '10px' } }), skeleton(120));
  let data;
  try {
    data = await api.photos();
  } catch (e) {
    clear(body).append(h('p', { class: 'muted bold' }, e.message));
    return;
  }
  clear(body);
  body.append(h('p', { class: 'tiny muted bold', style: { margin: '0 2px 10px' } }, `${data.count} из ${data.limit} фото`));
  if (!data.photos.length) {
    const go = h('button', { type: 'button', class: 'btn' }, 'Открыть календарь');
    go.addEventListener('click', () => { haptic.tap(); ctx.go('calendar'); });
    body.append(h('div', { class: 'card' }, emptyState('Здесь появятся фото, которые ты прикрепишь к заданиям, планам и дням.', { kind: 'heart', expr: 'love', action: go })));
    return;
  }
  const byMonth = new Map();
  for (const p of data.photos) {
    const key = p.day.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(p);
  }
  for (const [key, list] of byMonth) {
    body.append(sectionTitle(fmtMonth(`${key}-01`)), memoryBoard(list, { onDelete: () => render(el, ctx) }));
  }
}
