// Приз дня — автомат с хваталкой. В витрине капсулы с маскотами в шапочках и
// нарядах; двигаешь лапу ◀ ▶, жмёшь «Хватай!» — лапа достаёт капсулу и несёт
// к окошку выдачи. Что выпадет, решает сервер (api.openChest): схваченная
// капсула всегда оказывается настоящим призом.

import { h } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { store, refreshState } from './store.js';
import { mascotSVG } from './mascot.js';
import { modal, toastError, confetti, busy, toast } from './ui.js';
import { showLevelUp } from './celebrate.js';

// Что лежит в витрине «для красоты» (настоящий приз подменит схваченную капсулу)
const DECOYS = ['cap', 'witch', 'beanie', 'crown', 'scarf', 'bow', 'cowboy', 'knithat', 'party', 'sunglasses', 'tophat', 'flower', 'leafwreath', 'beret'];
const SHELLS = ['#F48AB5', '#8DB4F5', '#A6D96A', '#F7C84A', '#C9A2F2', '#FF9F6B'];
const GLASS_W = 280, GLASS_H = 250, CAP = 56;

const CLAW_SVG = `<svg viewBox="0 0 60 46" aria-hidden="true">
  <rect x="20" y="0" width="20" height="12" rx="4" fill="#B8BCC9" stroke="#2C2A22" stroke-width="2.5"/>
  <g class="claw-l"><path d="M24 11 L10 24 L14 40" fill="none" stroke="#2C2A22" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M24 11 L10 24 L14 40" fill="none" stroke="#D5D9E3" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>
  <g class="claw-r"><path d="M36 11 L50 24 L46 40" fill="none" stroke="#2C2A22" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M36 11 L50 24 L46 40" fill="none" stroke="#D5D9E3" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>
  <circle cx="30" cy="11" r="5" fill="#F3619C" stroke="#2C2A22" stroke-width="2"/>
</svg>`;

/** Маленькая иконка автомата — для строки на главной. */
export const MACHINE_ICON = `<svg viewBox="0 0 40 44" aria-hidden="true">
  <rect x="3" y="2" width="34" height="40" rx="7" fill="#F3619C" stroke="#2C2A22" stroke-width="2.5"/>
  <rect x="8" y="8" width="24" height="20" rx="4" fill="#EAF6FF" stroke="#2C2A22" stroke-width="2"/>
  <path d="M20 8v6" stroke="#2C2A22" stroke-width="2"/><path d="M16 17l4-3 4 3" fill="none" stroke="#2C2A22" stroke-width="2" stroke-linecap="round"/>
  <circle cx="13" cy="25" r="3.5" fill="#F7C84A"/><circle cx="20" cy="25" r="3.5" fill="#8DB4F5"/><circle cx="27" cy="25" r="3.5" fill="#A6D96A"/>
  <rect x="8" y="32" width="10" height="6" rx="2" fill="#2C2A22"/><circle cx="28" cy="35" r="3" fill="#F7C84A" stroke="#2C2A22" stroke-width="1.5"/>
</svg>`;

const wait = ms => new Promise(r => setTimeout(r, ms));

function capsule(acc, i, kind) {
  const shell = SHELLS[i % SHELLS.length];
  return h('div', { class: 'claw-cap', style: { '--shell': shell } },
    h('span', { class: 'claw-cap-pet', html: mascotSVG(kind, 'happy', acc) }));
}

export function openClawGame() {
  const u = store.state ? store.state.user : { mascot: 'cat-purple' };
  // витрина: два ряда капсул
  const caps = [];
  const pile = h('div', { class: 'claw-pile' });
  const shuffled = [...DECOYS].sort(() => Math.random() - 0.5).slice(0, 8);
  shuffled.forEach((acc, i) => {
    const c = capsule(acc, i, u.mascot);
    const row = i < 4 ? 0 : 1;
    const x = row === 0 ? 96 + i * 44 : 118 + (i - 4) * 44; // слева — окошко выдачи, капсулы правее
    const y = GLASS_H - CAP - 6 - row * 40;
    Object.assign(c.style, { left: `${x - CAP / 2 + ((i * 7) % 9) - 4}px`, top: `${y}px`, transform: `rotate(${((i * 37) % 31) - 15}deg)` });
    c.dataset.x = String(x);
    caps.push(c);
    pile.append(c);
  });
  const rope = h('div', { class: 'claw-rope' });
  const head = h('div', { class: 'claw-head', html: CLAW_SVG });
  const arm = h('div', { class: 'claw-arm' }, rope, head);
  const glass = h('div', { class: 'claw-glass' }, h('div', { class: 'claw-rail' }), pile, arm,
    h('div', { class: 'claw-chute' }, h('span', null, 'ПРИЗ')));
  const bulbs = h('div', { class: 'claw-bulbs', 'aria-hidden': 'true' }, Array.from({ length: 9 }, () => h('i')));
  const left = h('button', { type: 'button', class: 'claw-btn', 'aria-label': 'Лапу влево' }, '◀');
  const right = h('button', { type: 'button', class: 'claw-btn', 'aria-label': 'Лапу вправо' }, '▶');
  const grab = h('button', { type: 'button', class: 'claw-grab' }, 'Хватай!');
  const hint = h('p', { class: 'claw-hint' }, 'Подведи лапу к капсуле и жми «Хватай!»');
  const machine = h('div', { class: 'claw-machine' },
    h('div', { class: 'claw-top' }, bulbs, h('b', null, '🎁 Приз дня')),
    glass,
    h('div', { class: 'claw-panel' }, left, grab, right));
  const stage = h('div', { class: 'stack center claw-modal' }, machine, hint);
  const m = modal(stage, { label: 'Приз дня' });

  // положение лапы
  let x = GLASS_W / 2, busyNow = false;
  const min = 34, max = GLASS_W - 34; // у левого края — окошко выдачи
  const place = () => { arm.style.transform = `translateX(${x - 30}px)`; };
  place();
  const move = dir => { if (busyNow) return; x = Math.max(min, Math.min(max, x + dir * 23)); haptic.select(); place(); };
  for (const [btn, dir] of [[left, -1], [right, 1]]) {
    let timer = null;
    const stop = () => { clearInterval(timer); timer = null; };
    btn.addEventListener('pointerdown', e => { e.preventDefault(); move(dir); stop(); timer = setInterval(() => move(dir), 140); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  }

  grab.addEventListener('click', busy(grab, async () => {
    if (busyNow) return;
    busyNow = true;
    left.disabled = right.disabled = grab.disabled = true;
    hint.textContent = 'Опускаем лапу… 🤞';
    haptic.tap('medium');
    const prizeReq = api.openChest().catch(e => ({ error: e }));
    // ближайшая к лапе капсула (верхний ряд в приоритете)
    const target = caps.slice().sort((a, b) => Math.abs(+a.dataset.x - x) - Math.abs(+b.dataset.x - x)
      + (caps.indexOf(a) >= 4 ? -12 : 0) - (caps.indexOf(b) >= 4 ? -12 : 0))[0];
    const drop = parseFloat(target.style.top) - 20;
    rope.style.height = `${drop}px`;
    await wait(900);
    head.classList.add('closed');
    haptic.tap('heavy');
    await wait(350);
    const res = await prizeReq;
    if (res.error) { toastError(res.error); m.close(); return; }
    const r = res.reward;
    // схваченная капсула становится настоящим призом
    const pet = target.querySelector('.claw-cap-pet');
    if (r.kind === 'accessory') pet.innerHTML = mascotSVG(u.mascot, 'love', r.id);
    else pet.replaceChildren(h('span', { class: 'claw-cap-emoji' }, r.kind === 'freeze' ? '🧊' : r.kind === 'theme' ? '🌌' : '⭐'));
    target.classList.add('held');
    target.style.transform = 'rotate(0deg)';
    target.style.left = '2px';
    target.style.top = '40px';
    head.append(target);
    rope.style.height = '8px';
    await wait(850);
    hint.textContent = 'Несём к окошку…';
    x = min; place();
    await wait(800);
    head.classList.remove('closed');
    target.classList.add('fall');
    haptic.success();
    await wait(650);
    reveal(stage, r, res, u, m);
  }));
  return m;
}

function reveal(stage, r, res, u, m) {
  const title = r.kind === 'accessory' ? 'Обновка для маскота!' : r.kind === 'theme' ? 'Новый стиль!' : r.jackpot ? 'Джекпот!' : 'Приз дня!';
  const text = r.kind === 'accessory' ? `«${r.name}» — теперь твоя`
    : r.kind === 'theme' ? `Стиль «${r.name}» открыт навсегда — включи в Профиле`
    : r.kind === 'freeze' ? 'Заморозка серии — спасёт пропущенный день'
    : `+${r.amount} XP — все шапочки уже в коллекции 👑`;
  const art = r.kind === 'accessory'
    ? h('div', { class: 'claw-win-pet', html: mascotSVG(u.mascot, 'love', r.id) })
    : h('div', { class: 'claw-win-emoji' }, r.kind === 'freeze' ? '🧊' : r.kind === 'theme' ? '🌌' : '⭐');
  const done = h('button', { type: 'button', class: 'btn block ghost' }, 'Забрать');
  const finish = async () => { m.close(); refreshState().catch(() => {}); if (res.level_up) await showLevelUp(res.level_up); };
  done.addEventListener('click', finish);
  const buttons = [done];
  if (r.kind === 'accessory') {
    const wear = h('button', { type: 'button', class: 'btn block' }, '👒 Надеть сейчас');
    wear.addEventListener('click', busy(wear, async () => {
      try { await api.equip(r.id); haptic.success(); toast(`${r.name} — к лицу! ✨`, 'good'); } catch (e) { toastError(e); }
      await finish();
    }));
    buttons.unshift(wear);
  }
  confetti(90);
  stage.replaceChildren(h('div', { class: 'claw-win' }, h('div', { class: 'claw-win-cap' }, art),
    h('h2', null, title), h('p', { class: 'bold muted' }, text), ...buttons));
}
