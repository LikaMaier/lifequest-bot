// Входная плашка «Челленджи месяца» для вкладок Квест и Друзья.
import { h, plural } from './dom.js';
import { haptic } from './tg.js';
import { openMonthly } from './screens/monthly.js';

export function monthlyEntry(state, go, { friends = false } = {}) {
  const nudges = state.monthly_nudges || [];
  const one = nudges[0];
  let title = 'Челленджи месяца';
  let sub = friends ? 'Месяц чтения, месяц шагов… результаты друзей видно' : 'Одна цель на месяц — и общий топ с друзьями';
  if (one) {
    title = `${one.title}: отметь сегодня`;
    sub = nudges.length > 1 ? `и ещё ${nudges.length - 1} ${plural(nudges.length - 1, 'челлендж', 'челленджа', 'челленджей')} ждут отметки` : 'друзья уже смотрят, как у тебя дела';
  }
  const b = h('button', { type: 'button', class: 'mo-entry' },
    h('span', { class: 'mo-emoji', 'aria-hidden': 'true' }, one ? one.emoji : '🏁'),
    h('span', { class: 'grow' }, h('b', null, title), h('span', { class: 'small' }, sub)),
    h('span', { class: 'turn-go', 'aria-hidden': 'true' }, '›'));
  b.addEventListener('click', () => { haptic.tap(); if (one) openMonthly(go, one.id); else go('challenges'); });
  return b;
}
