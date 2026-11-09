// Домик: тамагочи-приставка на весь экран и всё про маскота —
// автомат с призами, наряды и выбор маскота.

import { h, clear } from '../dom.js';
import { haptic } from '../tg.js';
import { petRoom } from '../petroom.js';
import { chestRow } from '../chest.js';

export function render(el, ctx) {
  const { state, go } = ctx;
  clear(el);
  el.append(h('header', { class: 'page-head plain' },
    h('div', null, h('h1', null, 'Домик'), h('p', null, 'Галочки — еда, серия и квест дня — настроение'))));
  el.append(petRoom(state, { line: petLine(state), onFeed: () => go('home') }));

  const tile = (emoji, title, sub, color, onClick) => {
    const b = h('button', { type: 'button', class: `hub-tile c-${color}` }, h('span', { class: 'hub-emoji', 'aria-hidden': 'true' }, emoji),
      h('b', null, title), h('span', null, sub));
    b.addEventListener('click', () => { haptic.tap(); onClick(); });
    return b;
  };
  const u = state.user;
  const open = (state.unlocks && state.unlocks.mascots || []).filter(m => m.unlocked).length;
  const total = (state.unlocks && state.unlocks.mascots || []).length;
  el.append(h('div', { class: 'hub-grid pet-hub' },
    tile('👒', 'Наряды', `${u.balance} XP на счету`, 'pink', () => go('shop')),
    tile('🐾', 'Маскоты', total ? `${open} из ${total} открыто` : 'выбери друга', 'lav', () => go('profile')),
    tile('🏆', 'Награды', state.badges ? `${state.badges.unlocked} из ${state.badges.total}` : 'ачивки', 'yellow', () => go('awards'))));
  const ch = chestRow(state.chest);
  if (ch) el.append(h('section', { class: 'home2-card', style: { marginTop: '4px' } },
    h('div', { class: 'home2-head' }, h('h2', null, '🎰 Автомат с призами')), ch));
  el.append(h('div', { style: { height: '80px' }, 'aria-hidden': 'true' }));
}

function petLine(state) {
  const hs = state.habits || {};
  if (!hs.total) return 'Заведи привычки — каждая галочка станет едой 🍽';
  if (hs.done === hs.total) return 'Все привычки на сегодня сделаны — я счастлив! 🎉';
  return hs.done ? `Уже ${hs.done} из ${hs.total} — ещё чуть-чуть!` : `Сегодня ${hs.total} привычек — я жду еду 🍽`;
}
