// Приз дня: копится за привычки (3 на сегодня или все, если их меньше),
// достаётся из автомата с хваталкой (clawgame.js). Сундук — старое окно открытия.

import { h, plural } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { store, refreshState } from './store.js';
import { mascot } from './mascot.js';
import { modal, toastError, confetti, busy } from './ui.js';
import { showLevelUp } from './celebrate.js';
import { openClawGame, MACHINE_ICON } from './clawgame.js';

const INK = '#2C2A22';
// Сундук с сокровищами: выпуклая крышка из досок, кованые полосы с
// заклёпками, замок с замочной скважиной, ручки по бокам. viewBox 120×104.
const CHEST_DEFS = `<defs>
  <linearGradient id="lqcWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C67532"/><stop offset="1" stop-color="#8A4519"/></linearGradient>
  <linearGradient id="lqcLid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E0904A"/><stop offset="1" stop-color="#A65A22"/></linearGradient>
  <linearGradient id="lqcGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE68A"/><stop offset=".55" stop-color="#F5BE2E"/><stop offset="1" stop-color="#C98A12"/></linearGradient>
  <linearGradient id="lqcInner" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5A2C0E"/><stop offset="1" stop-color="#7A3D15"/></linearGradient>
  <radialGradient id="lqcGlow" cx=".5" cy=".6" r=".5"><stop offset="0" stop-color="#FFF6B8"/><stop offset=".6" stop-color="#FFE066" stop-opacity=".55"/><stop offset="1" stop-color="#FFE066" stop-opacity="0"/></radialGradient>
  <clipPath id="lqcLidClip"><path d="M10 50V37C10 16 32 7 60 7s50 9 50 30v13z"/></clipPath>
  <clipPath id="lqcBodyClip"><rect x="12" y="50" width="96" height="45" rx="6"/></clipPath>
</defs>`;
const CHEST_BODY = `
  <rect x="5" y="62" width="9" height="14" rx="4" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.5"/>
  <rect x="106" y="62" width="9" height="14" rx="4" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.5"/>
  <rect x="12" y="50" width="96" height="45" rx="6" fill="url(#lqcWood)"/>
  <g clip-path="url(#lqcBodyClip)" fill="none" stroke-linecap="round">
    <path d="M12 65h96M12 80h96" stroke="#713712" stroke-width="2.4"/>
    <path d="M40 57c6 1.5 12 1.5 18 0M66 72c6 1.5 11 1.5 17 0M30 87c6 1.5 12 1.5 18 0" stroke="#A35A24" stroke-width="1.6"/>
    <rect x="22" y="48" width="12" height="50" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.2"/>
    <rect x="86" y="48" width="12" height="50" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.2"/>
    <path d="M12 91h96" stroke="#5E2D0E" stroke-width="5" opacity=".35"/>
  </g>
  <g fill="#8C5A08"><circle cx="28" cy="58" r="1.8"/><circle cx="28" cy="87" r="1.8"/><circle cx="92" cy="58" r="1.8"/><circle cx="92" cy="87" r="1.8"/></g>
  <rect x="12" y="50" width="96" height="45" rx="6" fill="none" stroke="${INK}" stroke-width="3"/>`;
const CHEST_CLOSED = `<svg viewBox="0 0 120 104" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${CHEST_DEFS}
  <ellipse cx="60" cy="99" rx="50" ry="4.5" fill="#000" opacity=".14"/>
  ${CHEST_BODY}
  <path d="M10 50V37C10 16 32 7 60 7s50 9 50 30v13z" fill="url(#lqcLid)"/>
  <g clip-path="url(#lqcLidClip)" fill="none" stroke-linecap="round">
    <path d="M10 36C14 22 34 16 60 16s46 6 50 20M10 44c6-9 26-14 50-14s44 5 50 14" stroke="#8E4A1A" stroke-width="2.2"/>
    <rect x="22" y="0" width="12" height="52" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.2"/>
    <rect x="86" y="0" width="12" height="52" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.2"/>
    <path d="M20 29C25 18 40 13 56 12" stroke="#FFF" stroke-width="4" opacity=".35"/>
  </g>
  <g fill="#8C5A08"><circle cx="28" cy="20" r="1.8"/><circle cx="28" cy="38" r="1.8"/><circle cx="92" cy="20" r="1.8"/><circle cx="92" cy="38" r="1.8"/></g>
  <path d="M10 50V37C10 16 32 7 60 7s50 9 50 30v13z" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <rect x="7" y="45" width="106" height="9" rx="3.5" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.6"/>
  <path d="M49 41h22v14c0 7-5 12-11 14-6-2-11-7-11-14z" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
  <circle cx="60" cy="52" r="3.4" fill="${INK}"/><path d="M58.4 54h3.2l1 6.5h-5.2z" fill="${INK}"/>
  <path d="M52 45h7" stroke="#FFF6C8" stroke-width="2" stroke-linecap="round"/>
</svg>`;
const CHEST_OPEN = `<svg viewBox="0 0 120 104" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${CHEST_DEFS}
  <ellipse cx="60" cy="99" rx="50" ry="4.5" fill="#000" opacity=".14"/>
  <ellipse cx="60" cy="40" rx="58" ry="34" fill="url(#lqcGlow)"/>
  <path d="M14 46L22 6h76l8 40z" fill="url(#lqcInner)" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M24 42l5-29h62l5 29" fill="none" stroke="#3E1C07" stroke-width="2" opacity=".6"/>
  <path d="M27 6l-6 40h11l5-40zM83 6l5 40h11l-6-40z" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M15 52c6-14 24-20 45-20s39 6 45 20z" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
  <g stroke="${INK}" stroke-width="2" fill="#FFD84A">
    <ellipse cx="34" cy="40" rx="7" ry="4.5"/><ellipse cx="50" cy="34" rx="7" ry="4.5"/><ellipse cx="72" cy="35" rx="7" ry="4.5"/>
    <ellipse cx="86" cy="42" rx="7" ry="4.5"/><ellipse cx="60" cy="42" rx="7" ry="4.5"/>
  </g>
  <path d="M60 18l7 7-7 10-7-10z" fill="#5BD0F5" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M53 25h14M60 18l-2.5 7 2.5 10" stroke="#B9F0FF" stroke-width="1.4" fill="none"/>
  <path d="M40 22l5 4-3 6-6-3z" fill="#FF5C93" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
  <g fill="#FFF"><path d="M93 14l1.6 3.4 3.4 1.6-3.4 1.6L93 24l-1.6-3.4-3.4-1.6 3.4-1.6z"/><path d="M24 22l1.2 2.5 2.5 1.2-2.5 1.2L24 29.4l-1.2-2.5-2.5-1.2 2.5-1.2z"/><circle cx="78" cy="20" r="1.6"/></g>
  ${CHEST_BODY}
  <rect x="7" y="46" width="106" height="8" rx="3.5" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.6"/>
  <path d="M51 50h18v10c0 5-4 9-9 10.5-5-1.5-9-5.5-9-10.5z" fill="url(#lqcGold)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
  <circle cx="60" cy="57" r="2.8" fill="${INK}"/><path d="M58.7 58.5h2.6l.8 5h-4.2z" fill="${INK}"/>
</svg>`;

/** Картинка сундука: закрытый или открытый с золотом. */
export function chestIcon(open = false, cls = '') {
  return h('span', { class: `chest-svg ${cls}`, 'aria-hidden': 'true', html: open ? CHEST_OPEN : CHEST_CLOSED });
}

export function rewardText(r) {
  if (!r) return '';
  if (r.kind === 'accessory') return `«${r.name}» для маскота 🎩`;
  if (r.kind === 'theme') return `стиль «${r.name}» 🌌`;
  return r.kind === 'freeze' ? 'заморозка серии 🧊' : `+${r.amount} XP${r.jackpot ? ' — джекпот!' : ''}`;
}

/** Строка «Приз дня» (автомат с хваталкой) в карточке «Привычки сегодня». */
export function chestRow(chest) {
  if (!chest || !chest.need) return null;
  const icon = cls => h('span', { class: `chest-ico machine-ico ${cls}`, 'aria-hidden': 'true', html: MACHINE_ICON });
  if (chest.opened) {
    return h('div', { class: 'chest-row opened' }, icon(''),
      h('span', { class: 'grow' }, h('b', null, 'Приз дня получен'), h('span', null, `Из автомата: ${rewardText(chest.reward)}`)));
  }
  if (chest.ready) {
    const b = h('button', { type: 'button', class: 'chest-row ready' }, icon('shake'),
      h('span', { class: 'grow' }, h('b', null, 'Автомат с призами готов!'), h('span', null, 'Вытащи обновку для маскота')),
      h('span', { class: 'chest-go' }, 'Играть'));
    b.addEventListener('click', () => { haptic.tap('medium'); openClawGame(); });
    return b;
  }
  const left = chest.need - chest.have;
  return h('div', { class: 'chest-row', 'aria-label': `Приз дня: ${chest.have} из ${chest.need}` },
    icon('locked'),
    h('span', { class: 'grow' }, h('b', null, 'Приз дня'),
      h('span', null, `Ещё ${left} ${plural(left, 'привычка', 'привычки', 'привычек')} — и автомат с призами заработает`)),
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
      const r = res.reward;
      const u = store.state && store.state.user;
      const prize = r.kind === 'accessory' && u
        ? h('span', { class: 'chest-prize pet' }, mascot(u.mascot, 'love', { size: 72, acc: r.id }))
        : h('span', { class: 'chest-prize' }, r.kind === 'freeze' ? '🧊' : r.kind === 'theme' ? '🌌' : r.jackpot ? '💎' : '⭐');
      box.replaceChildren(prize, chestIcon(true));
      title.textContent = r.jackpot ? 'Джекпот!' : r.kind === 'accessory' ? 'Обновка для маскота!' : r.kind === 'theme' ? 'Новый стиль!' : 'Награда!';
      text.textContent = r.kind === 'freeze' ? 'Заморозка серии — спасёт пропущенный день'
        : r.kind === 'accessory' ? `«${r.name}» — твоя. Надень в Магазине 🛍️`
        : r.kind === 'theme' ? `Стиль «${r.name}» открыт навсегда — включи в Профиле`
        : `+${r.amount} XP`;
      btn.textContent = 'Забрать';
      haptic.success();
      confetti(res.reward.jackpot ? 160 : 80);
      refreshState().catch(() => {});
      levelUp = res.level_up;
    } catch (e) { box.classList.remove('shake'); toastError(e); m.close(); }
  }));
  return m;
}
