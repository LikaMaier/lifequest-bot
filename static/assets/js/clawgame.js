// Приз дня — автомат с хваталкой. В витрине цветные капсулы с маскотами в
// шапочках и нарядах, которых у игрока ещё нет, и золотые капсулы XP; двигаешь лапу
// ◀ ▶, жмёшь «Хватай!». Вещь или звёздочка (30/70), решает сервер
// (api.openChest); если вещь — это ровно та капсула, что под лапой.

import { h } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { store, refreshState } from './store.js';
import { mascotSVG } from './mascot.js';
import { modal, toastError, confetti, busy, toast } from './ui.js';
import { showLevelUp } from './celebrate.js';

// Запас для витрины, если почти вся коллекция уже собрана
const DECOYS = ['cap', 'witch', 'beanie', 'crown', 'scarf', 'bow', 'cowboy', 'knithat', 'party', 'sunglasses', 'tophat', 'flower', 'leafwreath', 'beret'];
const SHELLS = ['#F48AB5', '#8DB4F5', '#A6D96A', '#F7C84A', '#C9A2F2', '#FF9F6B'];
const GLASS_W = 280, GLASS_H = 250, CAP = 52;

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

const STAR_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="clawStar" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#FFF3B0"/><stop offset=".55" stop-color="#FFD23F"/><stop offset="1" stop-color="#E0A800"/></linearGradient></defs>
  <path d="M20 2l5.3 11.2 12.2 1.6-9 8.4 2.3 12.1L20 29.4 9.2 35.3l2.3-12.1-9-8.4 12.2-1.6z" fill="url(#clawStar)" stroke="#2C2A22" stroke-width="2.4" stroke-linejoin="round"/>
  <ellipse cx="15" cy="14" rx="3.2" ry="2" fill="#fff" opacity=".85" transform="rotate(-30 15 14)"/></svg>`;

/** Золотая капсула со звёздочкой XP. */
function starCapsule() {
  return h('div', { class: 'claw-cap gold', style: { '--shell': '#FFD23F' } }, h('span', { class: 'claw-cap-star', html: STAR_SVG }));
}

export function openClawGame() {
  const u = store.state ? store.state.user : { mascot: 'cat-purple' };
  // витрина — плотная горка одинаковых капсул, как в настоящем автомате:
  // 4 цветные с маскотом в обновке и 8 золотых со звёздочкой XP (как шансы 30/70)
  const caps = [], stars = [];
  const pile = h('div', { class: 'claw-pile' });
  // в цветных — вещи, которых ещё нет (их и можно выиграть); не хватает — добиваем витрину
  const fresh = ((store.state && store.state.chest && store.state.chest.machine) || []).slice().sort(() => Math.random() - 0.5);
  const shown = [...fresh, ...DECOYS.filter(a => !fresh.includes(a)).sort(() => Math.random() - 0.5)].slice(0, 4);
  const y0 = GLASS_H - CAP - 4, dy = CAP - 8;
  const SPOTS = [...[30, 84, 138, 192, 246].map(x => [x, y0]), ...[57, 111, 165, 219].map(x => [x, y0 - dy]),
    ...[84, 138, 192].map(x => [x, y0 - 2 * dy])];
  // цветные капсулы лежат сверху (2 в верхнем ряду, 2 во втором), золотые — вокруг и на дне
  const pick = (row, n) => row.slice().sort(() => Math.random() - 0.5).slice(0, n);
  const petSpots = new Set([...pick([9, 10, 11], 2), ...pick([5, 6, 7, 8], 2)].slice(0, shown.length));
  let p = 0;
  SPOTS.forEach(([x, y], i) => {
    const pet = petSpots.has(i);
    const c = pet ? capsule(shown[p], p, u.mascot) : starCapsule();
    if (pet) { c.dataset.acc = shown[p]; p++; }
    Object.assign(c.style, { left: `${x - CAP / 2 + ((i * 5) % 5) - 2}px`, top: `${y}px`, transform: `rotate(${((i * 37) % 25) - 12}deg)` });
    Object.assign(c.dataset, { x: String(x), y: String(y) });
    (pet ? caps : stars).push(c);
    pile.append(c);
  });
  const rope = h('div', { class: 'claw-rope' });
  const head = h('div', { class: 'claw-head', html: CLAW_SVG });
  const arm = h('div', { class: 'claw-arm' }, rope, head);
  const glass = h('div', { class: 'claw-glass' }, h('div', { class: 'claw-rail' }), pile, arm);
  const bulbs = h('div', { class: 'claw-bulbs', 'aria-hidden': 'true' }, Array.from({ length: 9 }, () => h('i')));
  const left = h('button', { type: 'button', class: 'claw-btn', 'aria-label': 'Лапу влево' }, '◀');
  const right = h('button', { type: 'button', class: 'claw-btn', 'aria-label': 'Лапу вправо' }, '▶');
  const grab = h('button', { type: 'button', class: 'claw-grab' }, 'Хватай!');
  const hint = h('p', { class: 'claw-hint' }, 'Цветная капсула — обновка для маскота, золотая — XP. Подведи лапу и жми «Хватай!»');
  const machine = h('div', { class: 'claw-machine' },
    h('div', { class: 'claw-top' }, bulbs, h('b', null, '🎁 Приз дня')),
    glass,
    h('div', { class: 'claw-panel' }, left, grab, right));
  const stage = h('div', { class: 'stack center claw-modal' }, machine, hint);
  const m = modal(stage, { label: 'Приз дня' });

  // положение лапы
  let x = GLASS_W / 2, busyNow = false;
  const min = 30, max = GLASS_W - 30;
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
    // капсула под лапой — её вещь и достанется, если сервер скажет «вещь»;
    // иначе лапа берёт ближайшую золотую капсулу XP
    // лапа достаёт только из двух верхних рядов — сквозь горку не проходит
    const reachable = pool => pool.filter(c => +c.dataset.y < GLASS_H - CAP - 10);
    const nearest = pool => reachable(pool).sort((a, b) =>
      Math.abs(+a.dataset.x - x) + +a.dataset.y / 1.5 - (Math.abs(+b.dataset.x - x) + +b.dataset.y / 1.5))[0];
    const aimed = nearest(caps);
    const res = await api.openChest(aimed.dataset.acc).catch(e => ({ error: e }));
    if (res.error) { toastError(res.error); m.close(); return; }
    const r = res.reward;
    const merch = r.kind === 'accessory' || r.kind === 'theme';
    const target = merch ? aimed : nearest(stars);
    x = +target.dataset.x; place(); // лапа чуть подруливает к добыче
    await wait(450);
    rope.style.height = `${+target.dataset.y - 22}px`;
    await wait(900);
    head.classList.add('closed');
    haptic.tap('heavy');
    await wait(350);
    if (merch) { // схваченная капсула — настоящий приз
      const pet = target.querySelector('.claw-cap-pet');
      if (r.kind === 'accessory') pet.innerHTML = mascotSVG(u.mascot, 'love', r.id);
      else pet.replaceChildren(h('span', { class: 'claw-cap-emoji' }, '🌌'));
    }
    target.classList.add('held');
    target.style.transform = 'rotate(0deg)';
    target.style.left = `${30 - CAP / 2}px`;
    target.style.top = '38px';
    head.append(target);
    rope.style.height = '8px';
    hint.textContent = merch ? 'Есть! Тянем капсулу…' : 'Золотая капсула! Тянем…';
    await wait(900);
    target.classList.add('pop');
    haptic.success();
    await wait(450);
    reveal(stage, r, res, u, m);
  }));
  return m;
}

function reveal(stage, r, res, u, m) {
  const title = r.kind === 'accessory' ? 'Обновка для маскота!' : r.kind === 'theme' ? 'Новый стиль!' : r.jackpot ? 'Джекпот!' : 'Приз дня!';
  const text = r.kind === 'accessory' ? `«${r.name}» — теперь твоя`
    : r.kind === 'theme' ? `Стиль «${r.name}» открыт навсегда — включи в Профиле`
    : r.kind === 'freeze' ? 'Заморозка серии — спасёт пропущенный день'
    : `+${r.amount} XP — звёздочка в копилку ⭐`;
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
