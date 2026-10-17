// Сундук дня: копится за привычки (3 на сегодня или все, если их меньше),
// внутри — XP или заморозка серии.

import { h, plural } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { refreshState } from './store.js';
import { modal, toastError, confetti, busy } from './ui.js';
import { showLevelUp } from './celebrate.js';

const INK = '#2C2A22';
const CHEST_CLOSED = `<svg viewBox="0 0 64 58" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M6 27V19C6 9 16 5 32 5s26 4 26 14v8z" fill="#C9772E" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M11 13c5-3 12-4 21-4" stroke="#E39A52" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  <rect x="6" y="27" width="52" height="26" rx="4" fill="#A85C22" stroke="${INK}" stroke-width="2.5"/>
  <path d="M8 40h48" stroke="#8A4818" stroke-width="2"/>
  <rect x="13" y="5.5" width="6" height="47" fill="#F2C230" stroke="${INK}" stroke-width="2"/>
  <rect x="45" y="5.5" width="6" height="47" fill="#F2C230" stroke="${INK}" stroke-width="2"/>
  <rect x="5" y="24.5" width="54" height="5" rx="1.5" fill="#F2C230" stroke="${INK}" stroke-width="2"/>
  <rect x="26.5" y="24" width="11" height="14" rx="3" fill="#FFD84A" stroke="${INK}" stroke-width="2.2"/>
  <circle cx="32" cy="30" r="2" fill="${INK}"/><path d="M32 31v4" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
</svg>`;
const CHEST_OPEN = `<svg viewBox="0 0 64 58" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M9 24L14 3h36l5 21z" fill="#B86A28" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M12 21l4-15h32l4 15z" fill="#6B3812"/>
  <rect x="17" y="3.5" width="5" height="20" fill="#F2C230" stroke="${INK}" stroke-width="1.8"/>
  <rect x="42" y="3.5" width="5" height="20" fill="#F2C230" stroke="${INK}" stroke-width="1.8"/>
  <ellipse cx="32" cy="27" rx="25" ry="6" fill="#FFE27A" opacity=".9"/>
  <circle cx="22" cy="26" r="4" fill="#FFD84A" stroke="${INK}" stroke-width="1.8"/><circle cx="31" cy="24" r="4.5" fill="#FFD84A" stroke="${INK}" stroke-width="1.8"/>
  <circle cx="41" cy="26" r="4" fill="#FFD84A" stroke="${INK}" stroke-width="1.8"/><path d="M50 18l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z" fill="#FFF"/>
  <rect x="6" y="27" width="52" height="26" rx="4" fill="#A85C22" stroke="${INK}" stroke-width="2.5"/>
  <path d="M8 40h48" stroke="#8A4818" stroke-width="2"/>
  <rect x="13" y="27" width="6" height="25.5" fill="#F2C230" stroke="${INK}" stroke-width="2"/>
  <rect x="45" y="27" width="6" height="25.5" fill="#F2C230" stroke="${INK}" stroke-width="2"/>
  <rect x="26.5" y="27" width="11" height="11" rx="3" fill="#FFD84A" stroke="${INK}" stroke-width="2.2"/>
</svg>`;

/** Картинка сундука: закрытый или открытый с золотом. */
export function chestIcon(open = false, cls = '') {
  return h('span', { class: `chest-svg ${cls}`, 'aria-hidden': 'true', html: open ? CHEST_OPEN : CHEST_CLOSED });
}

export function rewardText(r) {
  if (!r) return '';
  return r.kind === 'freeze' ? 'заморозка серии 🧊' : `+${r.amount} XP${r.jackpot ? ' — джекпот!' : ''}`;
}

/** Строка сундука в карточке «Привычки сегодня». */
export function chestRow(chest) {
  if (!chest || !chest.need) return null;
  if (chest.opened) {
    return h('div', { class: 'chest-row opened' }, chestIcon(true, 'chest-ico'),
      h('span', { class: 'grow' }, h('b', null, 'Сундук дня открыт'), h('span', null, `Внутри было: ${rewardText(chest.reward)}`)));
  }
  if (chest.ready) {
    const b = h('button', { type: 'button', class: 'chest-row ready' }, chestIcon(false, 'chest-ico shake'),
      h('span', { class: 'grow' }, h('b', null, 'Сундук дня готов!'), h('span', null, 'Нажми, чтобы открыть')),
      h('span', { class: 'chest-go' }, 'Открыть'));
    b.addEventListener('click', () => { haptic.tap('medium'); openChest(); });
    return b;
  }
  const left = chest.need - chest.have;
  return h('div', { class: 'chest-row', 'aria-label': `Сундук дня: ${chest.have} из ${chest.need}` },
    chestIcon(false, 'chest-ico locked'),
    h('span', { class: 'grow' }, h('b', null, 'Сундук дня'),
      h('span', null, `Ещё ${left} ${plural(left, 'привычка', 'привычки', 'привычек')} — и он откроется`)),
    h('span', { class: 'chest-dots', 'aria-hidden': 'true' },
      Array.from({ length: chest.need }, (_, i) => h('i', { class: i < chest.have ? 'on' : '' }))));
}

export function openChest() {
  const box = h('div', { class: 'chest-big', 'aria-hidden': 'true' }, chestIcon(false));
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
      box.replaceChildren(h('span', { class: 'chest-prize' }, res.reward.kind === 'freeze' ? '🧊' : res.reward.jackpot ? '💎' : '⭐'), chestIcon(true));
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
