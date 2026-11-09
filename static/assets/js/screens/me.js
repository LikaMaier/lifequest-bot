// «Я»: уровень и всё личное — прогресс, награды, альбом, цели месяца,
// заметки, магазин, стиль и настройки.

import { h, clear } from '../dom.js';
import { haptic } from '../tg.js';
import { mascot } from '../mascot.js';
import { progressBar } from '../ui.js';

export function render(el, ctx) {
  const { state, go } = ctx;
  clear(el);
  const u = state.user, lv = state.level, st = state;
  const head = h('button', { type: 'button', class: 'me-head' },
    mascot(u.mascot, 'happy', { size: 72, acc: u.accessory }),
    h('span', { class: 'grow' },
      h('b', null, u.first_name || 'Искатель приключений'),
      h('span', { class: 'me-lv' }, `Уровень ${lv.level} · ${lv.name}${u.is_premium ? ' · 👑' : ''}`),
      progressBar(lv.progress, 'purple'),
      h('span', { class: 'me-xp' }, `${lv.xp} / ${lv.next} XP · 🔥 ${st.streak.current}`)),
    h('span', { class: 'me-go', 'aria-hidden': 'true' }, '⚙️'));
  head.addEventListener('click', () => { haptic.tap(); go('profile'); });
  el.append(head);

  const tile = (emoji, title, sub, color, route) => {
    const b = h('button', { type: 'button', class: `hub-tile c-${color}` }, h('span', { class: 'hub-emoji', 'aria-hidden': 'true' }, emoji),
      h('b', null, title), h('span', null, sub));
    b.addEventListener('click', () => { haptic.tap(); go(route); });
    return b;
  };
  el.append(h('div', { class: 'hub-grid me-grid' },
    tile('📊', 'Прогресс', 'графики и рекорды', 'blue', 'progress'),
    tile('🏆', 'Награды', `${st.badges.unlocked} из ${st.badges.total}`, 'yellow', 'awards'),
    tile('🎯', 'Цели месяца', 'бинго из 9 целей', 'lav', 'board'),
    tile('💧', 'Привычки', st.habits.total ? `${st.habits.total} на сегодня` : 'заведи первые', 'lime', 'habits'),
    tile('🗓️', 'Календарь', 'месяц и планы', 'orange', 'calendar'),
    tile('📝', 'Заметки', 'мысли и дневник', 'pink', 'notes')));

  const album = h('button', { type: 'button', class: 'hub-album' },
    h('span', { class: 'hub-album-pics', 'aria-hidden': 'true' },
      h('span', { class: 'pic p1' }, '🌅'), h('span', { class: 'pic p2' }, '🌸'), h('span', { class: 'pic p3' }, '📷')),
    h('span', { class: 'grow' }, h('b', null, 'Альбом воспоминаний'),
      h('span', null, st.photos.enabled ? (st.photos.count ? `${st.photos.count} фото — листай свои полароиды` : 'Добавь первое фото дня') : 'Скоро здесь будут фото')),
    h('span', { class: 'hub-album-go', 'aria-hidden': 'true' }, '›'));
  album.addEventListener('click', () => { haptic.tap(); go('album'); });
  el.append(album);

  const row = (emoji, title, sub, route) => {
    const b = h('button', { type: 'button', class: 'home2-link-row me-row' }, h('span', null, `${emoji} ${title}`, sub ? h('small', null, sub) : null), h('span', null, '›'));
    b.addEventListener('click', () => { haptic.tap(); go(route); });
    return b;
  };
  el.append(h('div', { class: 'stack-sm' },
    row('🛍️', 'Магазин', `${u.balance} XP`, 'shop'),
    row('👑', 'Premium', u.is_premium ? 'активен' : 'больше наборов и стилей', 'premium'),
    row('🎨', 'Стиль, маскот и напоминания', '', 'profile')));
  el.append(h('div', { style: { height: '80px' }, 'aria-hidden': 'true' }));
}
