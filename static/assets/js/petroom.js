// Тамагочи «Домик» на главной: комната маскота живёт привычками.
// Галочки — это корм, серия и квест дня — настроение. День — солнце в окне,
// ночью — луна и торшер. Пару дней без галочек — пыль и маскот спит,
// неделю и дольше — всё в паутине, маскот обижен. Отметь привычку — и он простит.

import { h } from './dom.js';
import { haptic } from './tg.js';
import { mascot, mascotSVG, tapMascot } from './mascot.js';
import { toast } from './ui.js';

const K = '#2B2140';
// Сколько дней без галочек → что с комнатой
export const DUSTY_DAYS = 2;
export const WEB_DAYS = 5;

/** Сколько дней подряд не было ни одной галочки (0 — сегодня или вчера были). */
export function awayDays(state) {
  const s = state.streak || {};
  if (s.status === 'done' || (state.today && state.today.done > 0)) return 0;
  return typeof s.missed === 'number' && s.missed >= 0 ? s.missed + 1 : 0;
}

/** Сколько «порций» заработано сегодня (галочки) и сколько маскот уже съел. */
function portions(state) {
  const hs = state.habits || {}, t = state.today || {};
  return hs.total ? { have: hs.done || 0, max: hs.total } : { have: Math.min(t.done || 0, t.goal || 0), max: t.goal || 0 };
}
function foodFor(state, n) {
  const { max } = portions(state);
  return max ? Math.round(18 + 82 * Math.min(1, n / max)) : 40;
}
const fedKey = state => `lq_fed:${state.user && state.user.id}:${state.today && state.today.date}`;
function readFed(state) {
  try { return Math.max(0, parseInt(localStorage.getItem(fedKey(state)), 10) || 0); } catch (e) { return 0; }
}
function saveFed(state, n) {
  try { localStorage.setItem(fedKey(state), String(n)); } catch (e) { /* приватный режим */ }
}
/** Кормим только по кнопке: галочки копятся в миске, сытость растёт, когда маскот поел. */
export function feedInfo(state) {
  const { have } = portions(state);
  const eaten = Math.min(readFed(state), have);
  return { have, eaten, pending: have - eaten };
}

/** Сытость и настроение 0–100 — от галочек сегодня, серии и давности. */
export function petStats(state) {
  const away = awayDays(state);
  if (away >= DUSTY_DAYS) {
    const v = Math.max(4, 44 - away * 6);
    return { food: v, fun: Math.max(4, v - 8), away };
  }
  const hs = state.habits || {};
  const t = state.today || {};
  const { eaten } = feedInfo(state);
  const food = foodFor(state, eaten);
  const streak = (state.streak && state.streak.current) || 0;
  const daily = state.daily && state.daily.status === 'done' ? 20 : 0;
  const fun = Math.min(100, 34 + Math.min(40, streak * 6) + daily + (t.done > 0 ? 10 : 0));
  return { food, fun, away };
}

function scene({ night, dusty, dead }) {
  const W = 400;
  const wall = night ? '#C9B6E4' : '#F9D5E1', wall2 = night ? '#BBA6DA' : '#F4C6D6';
  const floorA = night ? '#7FA0D6' : '#93CDEB', floorB = night ? '#7192CB' : '#83C0E2', grout = night ? '#9AB4E0' : '#B4DEF2';
  // плитка в перспективе: горизонт y=196, пол до 300
  let tiles = '';
  for (let i = 0; i < 6; i++) {
    const y0 = 196 + [0, 14, 31, 52, 77, 106][i], y1 = 196 + [14, 31, 52, 77, 106, 140][i];
    for (let j = -6; j <= 6; j++) {
      const x = (y, k) => 200 + k * 34 * (0.62 + (y - 196) / 104 * 0.9);
      const c = (i + j) % 2 ? floorA : floorB;
      tiles += `<path d="M${x(y0, j)} ${y0} L${x(y0, j + 1)} ${y0} L${x(y1, j + 1)} ${y1} L${x(y1, j)} ${y1} Z" fill="${c}" stroke="${grout}" stroke-width="1.4"/>`;
    }
  }
  const sky = night
    ? `<rect x="40" y="46" width="76" height="92" rx="6" fill="#2C2766"/><circle cx="96" cy="70" r="10" fill="#FFF3C8"/><circle cx="100" cy="66" r="9" fill="#2C2766"/>
       <g fill="#FFF3C8">${[[54, 62], [66, 92], [84, 56], [104, 110], [58, 120]].map(([x, y], i) => `<circle class="pr-star" style="animation-delay:${i * .4}s" cx="${x}" cy="${y}" r="1.6"/>`).join('')}</g>`
    : `<rect x="40" y="46" width="76" height="92" rx="6" fill="#BFE6FA"/><circle cx="96" cy="68" r="11" fill="#FFE68A"/>
       <g fill="#fff" class="pr-clouds" opacity=".95"><ellipse cx="62" cy="80" rx="14" ry="6"/><ellipse cx="72" cy="76" rx="9" ry="7"/></g>
       <path d="M40 122 Q60 108 80 118 Q98 108 116 116 L116 138 L40 138 Z" fill="#9FD88A"/>`;
  const leafy = dusty || dead;
  // книги на стеллаже
  const books = ['#F28AA8', '#FFB7C5', '#E6607F', '#FFD3DC', '#F59AB0', '#FBC4D2'];
  let bk = '', bx = 304;
  books.forEach((c, i) => { const hh = 24 + (i % 3) * 5; bk += `<rect x="${bx}" y="${112 - hh}" width="9" height="${hh}" rx="1.5" fill="${dead ? '#C9BFC3' : c}"/>`; bx += 10; });
  let bk2 = ''; bx = 306;
  books.slice().reverse().forEach((c, i) => { const hh = 22 + (i % 2) * 6; bk2 += `<rect x="${bx}" y="${158 - hh}" width="9" height="${hh}" rx="1.5" fill="${dead ? '#C9BFC3' : c}"/>`; bx += 10; });
  const webs = dead ? (() => {
    const web = (x, y, sx, sy) => {
      let p = '';
      for (let i = 1; i <= 4; i++) { const k = i * 22; p += `<path d="M${x + sx * k} ${y} Q${x + sx * k * .72} ${y + sy * k * .72} ${x} ${y + sy * k}" fill="none" stroke="#fff" stroke-width="1.6" opacity=".9"/>`; }
      for (let a = 0; a <= 4; a++) { const g = a / 4 * Math.PI / 2; p += `<path d="M${x} ${y} L${x + sx * Math.cos(g) * 100} ${y + sy * Math.sin(g) * 100}" stroke="#fff" stroke-width="1.6" opacity=".9"/>`; }
      return p;
    };
    return web(0, 0, 1, 1) + web(W, 0, -1, 1) + web(W, 300, -1, -1)
      + `<path d="M250 0 V108" stroke="#fff" stroke-width="1.2"/><g class="pr-spider" transform="translate(250 116)"><ellipse rx="6" ry="8" fill="#5A4A6A"/><g stroke="#5A4A6A" stroke-width="1.8"><path d="M-5 -3 l-8 -5 M-5 2 l-9 0 M-5 5 l-7 6 M5 -3 l8 -5 M5 2 l9 0 M5 5 l7 6"/></g><circle cx="-2" cy="-3" r="1.5" fill="#fff"/><circle cx="2" cy="-3" r="1.5" fill="#fff"/></g>`;
  })() : '';
  const dust = leafy ? `<g fill="#9E95A8" opacity=".55"><ellipse cx="70" cy="262" rx="20" ry="6"/><ellipse cx="330" cy="276" rx="24" ry="6"/><ellipse cx="250" cy="236" rx="12" ry="4"/></g>
    <g fill="#B8AFC2" opacity=".8"><circle cx="64" cy="258" r="5"/><circle cx="72" cy="256" r="4"/><circle cx="324" cy="272" r="5"/><circle cx="334" cy="270" r="4"/></g>` : '';
  return `<svg class="pr-scene" viewBox="16 14 368 276" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>
   <pattern id="pr-wp" width="18" height="300" patternUnits="userSpaceOnUse"><rect width="18" height="300" fill="${wall}"/><rect width="7" height="300" fill="${wall2}" opacity=".55"/></pattern>
   <radialGradient id="pr-lg"><stop offset="0" stop-color="#FFE9A8" stop-opacity=".9"/><stop offset="1" stop-color="#FFE9A8" stop-opacity="0"/></radialGradient>
   <radialGradient id="pr-rugG" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#FFC2D6"/><stop offset="1" stop-color="#F59DBB"/></radialGradient>
   <linearGradient id="pr-sofaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9CCBF2"/><stop offset="1" stop-color="#78AEE0"/></linearGradient>
   <filter id="pr-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter></defs>
   <rect width="${W}" height="200" fill="url(#pr-wp)"/>
   ${night && !dead ? '<circle cx="62" cy="118" r="90" fill="url(#pr-lg)"/>' : ''}
   <rect y="188" width="${W}" height="10" fill="#FFFFFF" opacity=".9"/><rect y="196" width="${W}" height="3" fill="#E9B9CA"/>
   ${tiles}
   <!-- окно со шторами -->
   <rect x="34" y="40" width="88" height="104" rx="10" fill="#FFFFFF"/>${sky}
   <path d="M78 46 V138 M40 92 H116" stroke="#FFFFFF" stroke-width="4"/>
   <path d="M26 34 H130" stroke="#E7A7BC" stroke-width="5" stroke-linecap="round"/>
   <path d="M30 36 Q44 36 46 36 Q50 80 38 108 Q46 140 42 156 L28 156 Q24 96 30 36 Z" fill="${dead ? '#D8CDD3' : '#FFFFFF'}" opacity=".95"/>
   <path d="M126 36 Q112 36 110 36 Q106 80 118 108 Q110 140 114 156 L128 156 Q132 96 126 36 Z" fill="${dead ? '#D8CDD3' : '#FFFFFF'}" opacity=".95"/>
   <path d="M34 60 Q38 100 34 150 M122 60 Q118 100 122 150" stroke="#F3CCD9" stroke-width="2" fill="none"/>
   <!-- картина-веер над диваном -->
   <g transform="translate(200 60)" opacity="${dead ? .6 : 1}"><path d="M-34 10 A36 36 0 0 1 34 10 L0 26 Z" fill="${dead ? '#D7C9CF' : '#FFC9D8'}"/>
    ${[-28, -14, 0, 14, 28].map(a => `<path d="M0 26 L${Math.sin(a * Math.PI / 180) * 36} ${26 - Math.cos(a * Math.PI / 180) * 36}" stroke="${dead ? '#C2B4BA' : '#F28AA8'}" stroke-width="1.6"/>`).join('')}
    <circle cx="-14" cy="0" r="3" fill="#F28AA8"/><circle cx="10" cy="-4" r="2.5" fill="#F28AA8"/><circle cx="20" cy="6" r="2" fill="#F28AA8"/></g>
   <!-- стеллаж с книгами справа -->
   <ellipse cx="335" cy="200" rx="44" ry="6" fill="#000" opacity=".08" filter="url(#pr-soft)"/>
   <rect x="296" y="72" width="78" height="126" rx="4" fill="#FFFFFF"/><rect x="300" y="112" width="70" height="4" fill="#F1E6EA"/><rect x="300" y="158" width="70" height="4" fill="#F1E6EA"/>
   ${bk}${bk2}
   <g transform="translate(344 180)"><rect x="-10" y="-10" width="20" height="14" rx="3" fill="${dead ? '#D0C6C9' : '#FFD3DC'}"/><circle cx="0" cy="-16" r="7" fill="${dead ? '#BDB3B6' : '#F28AA8'}"/></g>
   <!-- тумба с лампой слева от дивана -->
   <ellipse cx="102" cy="204" rx="30" ry="5" fill="#000" opacity=".08" filter="url(#pr-soft)"/>
   <rect x="76" y="152" width="52" height="50" rx="4" fill="#FFFFFF"/><rect x="82" y="160" width="40" height="34" rx="3" fill="#FBEFF3"/>
   <path d="M84 166 q10 6 0 12 M96 164 q10 8 0 16 M108 166 q10 6 0 12" stroke="#F0D9E1" stroke-width="2" fill="none"/><circle cx="116" cy="177" r="2" fill="#E7C27A"/>
   <path d="M96 152 Q90 138 102 132 Q114 138 108 152 Z" fill="#D8B48A"/>
   <path d="M86 132 L118 132 L112 108 L92 108 Z" fill="${night && !dead ? '#FFE9A8' : dead ? '#D9CDD2' : '#FFB7CC'}"/>
   ${night && !dead ? '<circle cx="102" cy="124" r="40" fill="url(#pr-lg)"/>' : ''}
   <!-- диван -->
   <ellipse cx="208" cy="206" rx="92" ry="9" fill="#000" opacity=".10" filter="url(#pr-soft)"/>
   <g ${dead ? 'opacity=".75"' : ''}>
    <rect x="132" y="128" width="152" height="54" rx="22" fill="url(#pr-sofaG)"/>
    <path d="M140 140 q12 -6 24 0 t24 0 t24 0 t24 0 t24 0 t12 0 M140 156 q12 -6 24 0 t24 0 t24 0 t24 0 t24 0 t12 0" stroke="#6C9FD4" stroke-width="3" fill="none" opacity=".55"/>
    <rect x="124" y="166" width="168" height="30" rx="12" fill="#8CC0EE"/>
    <path d="M132 178 q12 -5 24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t12 0" stroke="#6C9FD4" stroke-width="3" fill="none" opacity=".5"/>
    <rect x="114" y="150" width="26" height="48" rx="12" fill="#7FB4E6"/><rect x="276" y="150" width="26" height="48" rx="12" fill="#7FB4E6"/>
    <rect x="132" y="196" width="8" height="8" rx="2" fill="#8B6A55"/><rect x="276" y="196" width="8" height="8" rx="2" fill="#8B6A55"/>
    <rect x="150" y="146" width="30" height="24" rx="9" fill="#FFC1D3" transform="rotate(-8 165 158)"/>
   </g>
   <!-- бонсай на круглом столике -->
   <ellipse cx="360" cy="246" rx="34" ry="6" fill="#000" opacity=".10" filter="url(#pr-soft)"/>
   <ellipse cx="358" cy="226" rx="32" ry="8" fill="#ECE7EE"/><rect x="354" y="228" width="8" height="16" fill="#D9D2DD"/><ellipse cx="358" cy="244" rx="16" ry="4" fill="#D9D2DD"/>
   <path d="M346 222 L370 222 L366 206 L350 206 Z" fill="#3B3650"/>
   <path d="M358 206 Q354 192 360 182 Q350 176 346 168 M360 182 Q368 176 372 170" stroke="#4A3B3E" stroke-width="4" fill="none" stroke-linecap="round"/>
   ${leafy ? '<g fill="#B9A9AE"><circle cx="346" cy="166" r="9"/><circle cx="372" cy="168" r="8"/></g>'
    : `<g fill="#F58BB0"><circle cx="344" cy="164" r="12"/><circle cx="356" cy="156" r="13"/><circle cx="370" cy="164" r="12"/><circle cx="360" cy="170" r="10"/></g>
       <g fill="#FFB9D0"><circle cx="350" cy="158" r="5"/><circle cx="366" cy="160" r="4"/></g><g fill="#7FB8E8"><ellipse cx="340" cy="172" rx="4" ry="2" transform="rotate(-30 340 172)"/><ellipse cx="376" cy="170" rx="4" ry="2" transform="rotate(30 376 170)"/></g>`}
   <!-- пушистый ковёр -->
   <path d="M108 262 ${Array.from({ length: 18 }, (_, i) => { const a = Math.PI * (1 - i / 17); return `Q${200 + Math.cos(a + .09) * 104} ${250 - Math.sin(a + .09) * 34 - 4} ${200 + Math.cos(a) * 100} ${250 - Math.sin(a) * 32}`; }).join(' ')}
     ${Array.from({ length: 18 }, (_, i) => { const a = -Math.PI * (i / 17); return `Q${200 + Math.cos(a - .09) * 104} ${250 - Math.sin(a - .09) * 26 + 4} ${200 + Math.cos(a) * 100} ${250 - Math.sin(a) * 24}`; }).join(' ')} Z"
     fill="${dead ? '#D6C3CB' : 'url(#pr-rugG)'}"/>
   <ellipse cx="200" cy="250" rx="70" ry="16" fill="#FFFFFF" opacity=".18"/>
   <!-- лежанка -->
   <ellipse cx="320" cy="282" rx="38" ry="11" fill="#E8BE6A"/><ellipse cx="320" cy="279" rx="30" ry="7" fill="#F6D38A"/>
   ${night && !dead ? `<rect width="${W}" height="300" fill="#2A2160" opacity=".16"/>` : ''}
   ${dead ? `<rect width="${W}" height="300" fill="#8D8596" opacity=".28"/>` : dusty ? `<rect width="${W}" height="300" fill="#A79FAF" opacity=".18"/>` : ''}
   ${dust}${webs}
  </svg>`;
}

function meter(icon, label, v, color) {
  return h('div', { class: 'pr-meter', title: `${label}: ${v}%` }, h('span', { class: 'pr-meter-ico', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'pr-bar', role: 'progressbar', 'aria-label': label, 'aria-valuenow': String(v), 'aria-valuemin': '0', 'aria-valuemax': '100' },
      h('i', { style: { width: `${v}%`, background: color } })), h('b', null, `${v}%`));
}

function floatUp(room, emoji, n = 5) {
  for (let i = 0; i < n; i++) {
    const s = h('span', { class: 'pr-float', 'aria-hidden': 'true', style: { left: `${38 + Math.random() * 24}%`, animationDelay: `${i * .12}s` } }, emoji);
    room.append(s);
    setTimeout(() => s.remove(), 1600 + i * 120);
  }
}

const FOOD = { 'cat-purple': '🐟', star: '🍬', frog: '🍓', puppy: '🦴', bear: '🍯', leopard: '🍖', panda: '🎋', pig: '🍎' };
const PURR = { 'cat-purple': 'мрр~', puppy: 'гав! 🐾', frog: 'ква~', pig: 'хрю~', bear: 'урр~', leopard: 'мрр~', panda: 'ммм~', star: '✨~' };
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const anim = (el, frames, opts) => (el.animate ? el.animate(frames, { fill: 'forwards', ...opts }).finished.catch(() => {}) : Promise.resolve());
let busyAnim = false;

function setFace(pet, kind, expr, acc) {
  pet.innerHTML = mascotSVG(kind, expr, acc);
  pet.querySelectorAll('text').forEach(n => n.remove());
}

function sayFor(room, text, ms = 1400) {
  room.querySelector('.pr-bubble')?.classList.add('pr-hide');
  const b = h('div', { class: 'pr-say' }, text);
  room.append(b);
  anim(b, [{ opacity: 0, transform: 'translate(-50%, 8px) scale(.7)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }], { duration: 260, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  setTimeout(() => { b.remove(); if (!busyAnim) room.querySelector('.pr-bubble')?.classList.remove('pr-hide'); }, ms);
}

function crumbs(room, n = 6) {
  for (let i = 0; i < n; i++) {
    const c = h('i', { class: 'pr-crumb', 'aria-hidden': 'true' });
    room.append(c);
    const dx = (Math.random() - .5) * 90, dy = -20 - Math.random() * 40;
    anim(c, [{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 1, offset: .5 },
      { transform: `translate(${dx * 1.3}px, ${dy + 70}px)`, opacity: 0 }], { duration: 700, easing: 'ease-out' }).then(() => c.remove());
  }
}

/** Кормёжка: миска, еда падает, маскот ест — ням-ням, сердечки. from/to — сытость до и после. */
async function playFeed(room, pet, u, { food, treat = false, meter, from, to } = {}) {
  if (busyAnim) return;
  busyAnim = true;
  const emoji = treat ? '🍪' : FOOD[u.mascot] || '🍪';
  const bowl = h('span', { class: 'pr-bowl', 'aria-hidden': 'true' }, h('i', null, ''));
  room.append(bowl);
  const bubble = room.querySelector('.pr-bubble');
  bubble?.classList.add('pr-hide');
  try {
    if (reduced()) { floatUp(room, '😋', 3); setMeter(meter, to); return; }
    await anim(bowl, [{ transform: 'translate(-50%, 30px) scale(.3)', opacity: 0 }, { transform: 'translate(-50%, 0) scale(1)', opacity: 1 }],
      { duration: 320, easing: 'cubic-bezier(.3,1.6,.5,1)' });
    const f = h('span', { class: 'pr-food', 'aria-hidden': 'true' }, emoji);
    room.append(f);
    haptic.tap('light');
    await anim(f, [{ transform: 'translate(120px, -260px) rotate(-40deg) scale(.8)', opacity: 0 },
      { transform: 'translate(60px, -190px) rotate(-10deg) scale(1)', opacity: 1, offset: .25 },
      { transform: 'translate(0, 0) rotate(20deg) scale(1)', opacity: 1, offset: .85 },
      { transform: 'translate(0, -10px) rotate(0) scale(1.1)', opacity: 1 }], { duration: 650, easing: 'cubic-bezier(.5,0,.6,1)' });
    bowl.firstChild.textContent = emoji;
    f.remove();
    setFace(pet, u.mascot, 'surprised', u.accessory);
    await anim(pet, [{ transform: 'translate(0,0) scale(1)' }, { transform: 'translate(0, 14%) scale(1.04, .96) rotate(4deg)' }], { duration: 260, easing: 'ease-in' });
    for (let i = 0; i < 3; i++) {
      haptic.tap('soft');
      setFace(pet, u.mascot, i % 2 ? 'surprised' : 'happy', u.accessory);
      crumbs(room, 4);
      await anim(pet, [{ transform: 'translate(0, 14%) scale(1.04, .96) rotate(4deg)' }, { transform: 'translate(0, 18%) scale(1.12, .86) rotate(-2deg)' },
        { transform: 'translate(0, 14%) scale(1.04, .96) rotate(4deg)' }], { duration: 260, easing: 'ease-in-out' });
      if (i === 0) bowl.firstChild.style.transform = 'scale(.6)';
      if (i === 1) bowl.firstChild.textContent = '';
    }
    setFace(pet, u.mascot, 'love', u.accessory);
    haptic.success();
    sayFor(room, treat ? 'Ням! Вкусняшка за идеальный день 🍪' : 'Ням-ням! Спасибо 💜');
    floatUp(room, '💜', 5);
    setMeter(meter, to, from);
    await anim(pet, [{ transform: 'translate(0, 14%) scale(1.04, .96)' }, { transform: 'translate(0, -12%) scale(.96, 1.06)', offset: .45 },
      { transform: 'translate(0,0) scale(1)' }], { duration: 520, easing: 'cubic-bezier(.3,1.5,.5,1)' });
    await anim(bowl, [{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, 10px) scale(.6)' }], { duration: 300, delay: 600 });
  } finally {
    bowl.remove();
    bubble?.classList.remove('pr-hide');
    pet.getAnimations && pet.getAnimations().forEach(a => a.cancel());
    busyAnim = false;
    setTimeout(() => { if (!busyAnim && !room.querySelector('.pr-say')) room.querySelector('.pr-bubble')?.classList.remove('pr-hide'); }, 600);
  }
}

/** Пустая миска: маскот заглядывает, грустит — и зовёт отметить привычку. */
async function playEmptyBowl(room, pet, u, expr) {
  if (busyAnim) return;
  busyAnim = true;
  const bowl = h('span', { class: 'pr-bowl', 'aria-hidden': 'true' }, h('i', null, ''));
  room.append(bowl);
  try {
    await anim(bowl, [{ transform: 'translate(-50%, 30px) scale(.3)', opacity: 0 }, { transform: 'translate(-50%, 0) scale(1)', opacity: 1 }],
      { duration: 300, easing: 'cubic-bezier(.3,1.6,.5,1)' });
    setFace(pet, u.mascot, 'surprised', u.accessory);
    await anim(pet, [{ transform: 'translate(0,0)' }, { transform: 'translate(0, 12%) rotate(6deg)', offset: .4 }, { transform: 'translate(0, 12%) rotate(-6deg)', offset: .7 },
      { transform: 'translate(0, 6%) rotate(0)' }], { duration: 800, easing: 'ease-in-out' });
    sayFor(room, 'Миска пустая… Отметь привычку — это мой корм 🥺', 1700);
    await wait(1200);
    await anim(pet, [{ transform: 'translate(0, 6%)' }, { transform: 'translate(0,0)' }], { duration: 300 });
    await anim(bowl, [{ opacity: 1 }, { opacity: 0 }], { duration: 250 });
    setFace(pet, u.mascot, expr, u.accessory);
  } finally {
    bowl.remove();
    pet.getAnimations && pet.getAnimations().forEach(a => a.cancel());
    busyAnim = false;
    setTimeout(() => { if (!busyAnim && !room.querySelector('.pr-say')) room.querySelector('.pr-bubble')?.classList.remove('pr-hide'); }, 600);
  }
}

/** Погладить: ладошка гладит по голове, маскот жмурится и мурчит. */
async function playPet(room, pet, u, expr) {
  if (busyAnim) return;
  busyAnim = true;
  const hand = h('span', { class: 'pr-hand', 'aria-hidden': 'true' }, '🤚');
  room.append(hand);
  try {
    if (reduced()) { floatUp(room, '💜', 4); return; }
    await anim(hand, [{ transform: 'translate(40px, -60px) rotate(30deg)', opacity: 0 }, { transform: 'translate(0, 0) rotate(0)', opacity: 1 }],
      { duration: 280, easing: 'ease-out' });
    setFace(pet, u.mascot, 'sleepy', u.accessory);
    pet.querySelector('svg')?.insertAdjacentHTML('beforeend', '<ellipse cx="24" cy="56" rx="7" ry="4" fill="#F3619C" opacity=".55"/><ellipse cx="76" cy="56" rx="7" ry="4" fill="#F3619C" opacity=".55"/>');
    sayFor(room, PURR[u.mascot] || 'мрр~', 1900);
    for (let i = 0; i < 3; i++) {
      haptic.tap('soft');
      const dir = i % 2 ? 1 : -1;
      await Promise.all([
        anim(hand, [{ transform: 'translate(0, 0) rotate(0)' }, { transform: `translate(${dir * 34}px, 10px) rotate(${dir * -14}deg)`, offset: .5 }, { transform: 'translate(0, 0) rotate(0)' }],
          { duration: 520, easing: 'ease-in-out' }),
        anim(pet, [{ transform: 'rotate(0) scale(1)' }, { transform: `rotate(${dir * 7}deg) scale(1.03, .95)`, offset: .5 }, { transform: 'rotate(0) scale(1)' }],
          { duration: 520, easing: 'ease-in-out' }),
      ]);
      floatUp(room, i === 2 ? '💖' : '💜', 2);
    }
    haptic.success();
    await anim(hand, [{ opacity: 1 }, { transform: 'translate(40px, -60px) rotate(30deg)', opacity: 0 }], { duration: 260 });
    await anim(pet, [{ transform: 'scale(1)' }, { transform: 'translateY(-14%) scale(.96, 1.06)', offset: .4 }, { transform: 'scale(1)' }],
      { duration: 480, easing: 'cubic-bezier(.3,1.5,.5,1)' });
    setFace(pet, u.mascot, expr, u.accessory);
  } finally {
    hand.remove();
    pet.getAnimations && pet.getAnimations().forEach(a => a.cancel());
    busyAnim = false;
    setTimeout(() => { if (!busyAnim && !room.querySelector('.pr-say')) room.querySelector('.pr-bubble')?.classList.remove('pr-hide'); }, 600);
  }
}

/** Прибраться: метла проходит по полу, блёстки. */
async function playSweep(room) {
  if (busyAnim) return;
  busyAnim = true;
  const broom = h('span', { class: 'pr-broom', 'aria-hidden': 'true' }, '🧹');
  room.append(broom);
  try {
    haptic.tap();
    await anim(broom, [{ transform: 'translate(0, 0) rotate(-20deg)', opacity: 0 }, { transform: 'translate(40px, 0) rotate(10deg)', opacity: 1, offset: .15 },
      { transform: 'translate(110px, 6px) rotate(-20deg)', offset: .4 }, { transform: 'translate(180px, 0) rotate(10deg)', offset: .65 },
      { transform: 'translate(250px, 6px) rotate(-20deg)', opacity: 1, offset: .9 }, { transform: 'translate(270px, 0) rotate(0)', opacity: 0 }], { duration: 1400, easing: 'ease-in-out' });
    floatUp(room, '✨', 6);
    haptic.success();
    sayFor(room, 'Блестит! Чистота 100% ✨', 1400);
  } finally { broom.remove(); busyAnim = false; }
}

function setMeter(meter, to, from) {
  if (!meter) return;
  const bar = meter.querySelector('.pr-bar i'), num = meter.querySelector('b');
  if (from !== undefined) { bar.style.transition = 'none'; bar.style.width = `${from}%`; void bar.offsetWidth; bar.style.transition = ''; }
  bar.style.width = `${to}%`;
  if (num) num.textContent = `${to}%`;
  meter.classList.remove('pr-gain'); void meter.offsetWidth; meter.classList.add('pr-gain');
}

let shownDead = false; // в этой сессии комната была в паутине — после уборки покажем радость

/** Карточка «Домик» для главной. line — что маскот говорит, onFeed — куда вести за «кормом». */
export function petRoom(state, { line, onFeed } = {}) {
  const u = state.user;
  const hs = state.habits || {};
  const { food, fun, away } = petStats(state);
  const hour = state.today ? state.today.hour : new Date().getHours();
  const night = hour >= 21 || hour < 7;
  const dead = away >= WEB_DAYS, dusty = !dead && away >= DUSTY_DAYS;
  const allDone = hs.total && hs.done === hs.total;
  const sleepNow = hour >= 23 || hour < 6;
  const expr = dead ? 'sad' : dusty || sleepNow ? 'sleepy' : allDone ? 'love' : hs.done || (state.today && state.today.done) ? 'happy' : 'wink';
  const mName = ((state.unlocks && state.unlocks.mascots) || []).find(m => m.id === u.mascot)?.name || 'Маскот';
  const word = n => (n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'дня' : 'дней');
  const say = dead ? `Тебя не было ${away} ${word(away)}! Тут всё в паутине 😾`
    : dusty ? 'Zzz… я тут подожду… разбуди меня галочкой'
    : line;

  const room = h('div', { class: `pr-room ${dead ? 'is-dead' : ''}`, html: scene({ night, dusty, dead }) });
  const pet = mascot(u.mascot, expr, { size: 128, label: mName, acc: u.accessory, cls: `pr-pet ${dusty ? 'is-asleep' : ''}` });
  pet.style.width = ''; pet.style.height = '';
  if (dead) pet.querySelector('svg')?.insertAdjacentHTML('beforeend', `<path d="M24 34 L42 43 M76 34 L58 43" stroke="${K}" stroke-width="5" stroke-linecap="round"/>`);
  if (dusty) pet.querySelectorAll('text').forEach(n => n.remove());
  room.append(pet);
  if (dead) room.append(h('span', { class: 'pr-anger', 'aria-hidden': 'true' }, '💢'));
  if (dusty) room.append(h('span', { class: 'pr-zz', 'aria-hidden': 'true' }, 'z', h('small', null, 'z')));
  if (say) room.append(h('div', { class: 'pr-bubble' }, say));
  if (!dead && shownDead) { floatUp(room, '✨', 7); toast(`🧹 Чисто! ${mName} тебя простил 💜`, 'good'); }
  shownDead = dead;

  pet.addEventListener('click', () => {
    haptic.tap('soft');
    if (dead) { pet.classList.remove('pr-shake'); void pet.offsetWidth; pet.classList.add('pr-shake'); floatUp(room, '💢', 2); return; }
    if (dusty) { floatUp(room, '💤', 3); return; }
    tapMascot(pet, u.mascot, expr, u.accessory);
  });

  const foodMeter = meter('🍖', 'Сытость', food, '#F0606E');
  const clean = dead ? 6 : dusty ? 38 : 100;
  const tool = (icon, label, cls = '') => h('button', { type: 'button', class: `pr-btn ${cls}`, 'aria-label': label, title: label }, h('span', { class: 'pr-tool-ico', 'aria-hidden': 'true' }, icon), h('small', null, label));
  const pat = tool(dead ? '🎁' : dusty ? '⏰' : '🤚', dead ? 'Помириться' : dusty ? 'Разбудить' : 'Погладить');
  pat.addEventListener('click', () => {
    if (dead || dusty) { haptic.tap(); toast(dead ? 'Отметь привычку — паутина исчезнет 🧹' : 'Одна галочка — и я проснусь 🌅'); onFeed && onFeed(); return; }
    playPet(room, pet, u, expr);
  });
  let { pending } = dead || dusty ? { pending: 0 } : feedInfo(state);
  const badge = h('span', { class: 'pr-badge' }, String(pending));
  const feed = tool('🍽', 'Покормить', `main ${pending ? 'has-food' : ''}`);
  if (pending) feed.append(badge);
  feed.addEventListener('click', async () => {
    haptic.tap();
    if (busyAnim) return;
    if (dead || dusty) { toast('Корм — это галочки: отметь привычку 💜'); onFeed && onFeed(); return; }
    const info = feedInfo(state);
    if (info.pending > 0) {
      const from = foodFor(state, info.eaten), to = foodFor(state, info.have);
      saveFed(state, info.have);
      pending = 0;
      feed.classList.remove('has-food'); badge.remove(); room.querySelector('.pr-bowl.idle')?.remove();
      const bub = room.querySelector('.pr-bubble');
      if (bub) { bub.classList.remove('top'); bub.replaceChildren(line || 'Сыт и доволен 💜'); }
      await playFeed(room, pet, u, { meter: foodMeter, from, to, portions: info.pending });
      return;
    }
    if (allDone) { playFeed(room, pet, u, { treat: true, meter: foodMeter, from: food, to: food }); return; }
    await playEmptyBowl(room, pet, u, expr);
    onFeed && onFeed();
  });
  if (pending) room.append(h('span', { class: 'pr-bowl idle', 'aria-hidden': 'true' }, h('i', null, FOOD[u.mascot] || '🍪')));
  if (pending && say === line) room.querySelector('.pr-bubble')?.classList.add('top');
  if (pending && say === line) room.querySelector('.pr-bubble')?.replaceChildren(pending > 1 ? `В миске ${pending} ${pending % 10 >= 2 && pending % 10 <= 4 && (pending % 100 < 12 || pending % 100 > 14) ? 'порции' : 'порций'} еды! Покорми меня 🍽` : 'Галочка есть — в миске еда! Покорми меня 🍽');

  const sweep = tool('🧹', 'Прибраться');
  sweep.addEventListener('click', () => {
    if (dead || dusty) { haptic.tap(); toast('Пыль и паутину сметёт только галочка — отметь привычку 🧹'); onFeed && onFeed(); return; }
    playSweep(room);
  });
  const toHabits = tool('📋', 'Привычки');
  toHabits.addEventListener('click', () => { haptic.tap(); onFeed && onFeed(); });
  const streak = (state.streak && state.streak.current) || 0;
  room.prepend(h('div', { class: 'pr-hud' },
    h('div', { class: 'pr-meters' }, foodMeter, meter('💗', 'Настроение', fun, '#C35BD8'), meter('✨', 'Чистота', clean, '#58BE6A')),
    h('div', { class: 'pr-coins' }, h('span', null, '🔥', h('b', null, String(streak))), state.level ? h('span', null, '⭐', h('b', null, String(state.level.level))) : null)));
  room.append(h('span', { class: 'pr-glare', 'aria-hidden': 'true' }));
  return h('section', { class: 'pr-card pr-device', 'aria-label': `Домик: ${mName}` },
    h('div', { class: 'pr-top' },
      h('span', { class: `pr-led ${dead ? 'bad' : dusty ? 'warn' : ''}`, 'aria-hidden': 'true' }),
      h('h2', null, `Домик · ${mName}`),
      h('span', { class: 'pr-brand', 'aria-hidden': 'true' }, 'LQ·PET')),
    h('div', { class: 'pr-bezel' }, room),
    h('div', { class: 'pr-btns' }, pat, feed, sweep, toHabits),
    h('div', { class: 'pr-speaker', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i')),
    h('div', { class: 'pr-tip' }, dead ? 'Отметь привычку — паутина исчезнет, и маскот простит 💜'
      : 'Галочка = порция еды 🍽 · серия и квест дня — настроение 💗'));
}

/** Компактная полоска маскота для «Сегодня»: настроение, еда в миске, тап — во вкладку «Домик». */
export function petStrip(state, { line, onOpen } = {}) {
  const u = state.user;
  const hs = state.habits || {};
  const { away } = petStats(state);
  const dead = away >= WEB_DAYS, dusty = !dead && away >= DUSTY_DAYS;
  const { pending } = dead || dusty ? { pending: 0 } : feedInfo(state);
  const hour = state.today ? state.today.hour : new Date().getHours();
  const allDone = hs.total && hs.done === hs.total;
  const expr = dead ? 'sad' : dusty || hour >= 23 || hour < 6 ? 'sleepy' : pending ? 'surprised' : allDone ? 'love' : 'happy';
  const mName = ((state.unlocks && state.unlocks.mascots) || []).find(m => m.id === u.mascot)?.name || 'Маскот';
  const word = n => (n % 10 === 1 && n % 100 !== 11 ? 'порция' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'порции' : 'порций');
  const status = dead ? `${mName} обиделся — всё в паутине 😾` : dusty ? `${mName} спит и скучает 💤`
    : pending ? `${mName} ждёт еду: в миске ${pending} ${word(pending)}` : line || `${mName} доволен 💜`;
  const pet = mascot(u.mascot, expr, { size: 64, acc: u.accessory, cls: 'ps-pet' });
  pet.querySelectorAll('text').forEach(n => n.remove());
  const action = h('span', { class: `ps-action ${pending ? 'go' : ''}` }, dead ? '🎁' : dusty ? '⏰' : pending ? `🍽 ${pending}` : '🏠');
  const b = h('button', { type: 'button', class: `pet-strip ${dead ? 'bad' : dusty ? 'warn' : ''}`, 'aria-label': `Домик: ${status}` },
    h('span', { class: 'ps-screen' }, pet),
    h('span', { class: 'grow' }, h('b', null, `🏠 Домик · ${mName}`), h('span', null, status)),
    action);
  b.addEventListener('click', () => { haptic.tap(); onOpen && onOpen(); });
  return b;
}
