// Сундук дня: копится за привычки (3 на сегодня или все, если их меньше),
// внутри — XP или заморозка серии.

import { h, plural } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { refreshState } from './store.js';
import { modal, toastError, confetti, busy } from './ui.js';
import { showLevelUp } from './celebrate.js';

export function rewardText(r) {
  if (!r) return '';
  return r.kind === 'freeze' ? 'заморозка серии 🧊' : `+${r.amount} XP${r.jackpot ? ' — джекпот!' : ''}`;
}

/** Строка сундука в карточке «Привычки сегодня». */
export function chestRow(chest) {
  if (!chest || !chest.need) return null;
  if (chest.opened) {
    return h('div', { class: 'chest-row opened' }, h('span', { class: 'chest-ico', 'aria-hidden': 'true' }, '🎁'),
      h('span', { class: 'grow' }, h('b', null, 'Сундук дня открыт'), h('span', null, `Внутри было: ${rewardText(chest.reward)}`)));
  }
  if (chest.ready) {
    const b = h('button', { type: 'button', class: 'chest-row ready' }, h('span', { class: 'chest-ico shake', 'aria-hidden': 'true' }, '🎁'),
      h('span', { class: 'grow' }, h('b', null, 'Сундук дня готов!'), h('span', null, 'Нажми, чтобы открыть')),
      h('span', { class: 'chest-go' }, 'Открыть'));
    b.addEventListener('click', () => { haptic.tap('medium'); openChest(); });
    return b;
  }
  const left = chest.need - chest.have;
  return h('div', { class: 'chest-row', 'aria-label': `Сундук дня: ${chest.have} из ${chest.need}` },
    h('span', { class: 'chest-ico locked', 'aria-hidden': 'true' }, '🎁'),
    h('span', { class: 'grow' }, h('b', null, 'Сундук дня'),
      h('span', null, `Ещё ${left} ${plural(left, 'привычка', 'привычки', 'привычек')} — и он откроется`)),
    h('span', { class: 'chest-dots', 'aria-hidden': 'true' },
      Array.from({ length: chest.need }, (_, i) => h('i', { class: i < chest.have ? 'on' : '' }))));
}

export function openChest() {
  const box = h('div', { class: 'chest-big', 'aria-hidden': 'true' }, '🎁');
  const title = h('h2', null, 'Сундук дня');
  const text = h('p', { class: 'bold muted' }, 'Привычки сделаны — держи награду!');
  const btn = h('button', { type: 'button', class: 'btn block' }, 'Открыть');
  const m = modal(h('div', { class: 'stack center chest-modal' }, box, title, text, btn), { label: 'Сундук дня' });
  let opened = false, levelUp = null;
  btn.addEventListener('click', busy(btn, async () => {
    if (opened) { m.close(); if (levelUp) await showLevelUp(levelUp); return; }
    try {
      box.classList.add('shake');
      const [res] = await Promise.all([api.openChest(), new Promise(r => setTimeout(r, 900))]);
      opened = true;
      box.classList.remove('shake');
      box.classList.add('pop');
      box.textContent = res.reward.kind === 'freeze' ? '🧊' : res.reward.jackpot ? '💎' : '⭐';
      title.textContent = res.reward.jackpot ? 'Джекпот!' : 'Награда!';
      text.textContent = res.reward.kind === 'freeze' ? 'Заморозка серии — спасёт пропущенный день' : `+${res.reward.amount} XP`;
      btn.textContent = 'Забрать';
      haptic.success();
      confetti(res.reward.jackpot ? 160 : 80);
      refreshState().catch(() => {});
      levelUp = res.level_up;
    } catch (e) { box.classList.remove('shake'); toastError(e); m.close(); }
  }));
  return m;
}
