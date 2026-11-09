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
  const day = !night;
  const wall = dead ? '#B8AFA3' : night ? '#5A4E86' : '#FCE8D2', wallDot = dead ? '#A69C90' : night ? '#6B5E9A' : '#F6D2B8';
  const floor = dead ? '#8E847A' : night ? '#5B4466' : '#D9A877', plank = dead ? '#7A7066' : night ? '#4A3655' : '#C48F5E';
  const sofa = dead ? '#9C8A6A' : '#F2B544', sofaD = dead ? '#7E6E52' : '#D6922B';
  const cush1 = dead ? '#9A8C8C' : '#F065A6', cush2 = dead ? '#8A9696' : '#3FBFAE';
  const wilt = dead || dusty;
  let sky;
  if (dead) {
    sky = `<rect x="40" y="52" width="104" height="138" fill="#7A7486"/><g fill="#5E586A"><ellipse cx="70" cy="76" rx="30" ry="12"/><ellipse cx="116" cy="88" rx="26" ry="10"/></g>
    <g stroke="#B8C2D6" stroke-width="1.6" opacity=".8">${[...Array(14)].map((_, i) => `<path d="M${44 + i * 8} ${60 + (i % 3) * 14} l-5 16"/>`).join('')}</g>`;
  } else if (night) {
    sky = `<rect x="40" y="52" width="104" height="138" fill="url(#pr-sk1)"/><circle cx="114" cy="80" r="13" fill="#FFF6DC"/><circle cx="119" cy="76" r="11" fill="#1F1848"/>
    <g fill="#FFF6DC">${[[54, 70], [70, 100], [90, 66], [130, 112], [60, 128], [100, 140], [136, 62]].map(([x, y], i) => `<circle class="pr-star" style="animation-delay:${i * .37}s" cx="${x}" cy="${y}" r="1.8"/>`).join('')}</g>
    <path d="M40 170 L54 170 L54 150 L66 150 L66 162 L82 162 L82 142 L96 142 L96 166 L112 166 L112 154 L126 154 L126 170 L144 170 L144 190 L40 190 Z" fill="#120C2A"/>
    <g fill="#FFE27A">${[[58, 156], [86, 148], [86, 158], [116, 160], [100, 172]].map(([x, y]) => `<rect x="${x}" y="${y}" width="4" height="5"/>`).join('')}</g>`;
  } else {
    sky = `<rect x="40" y="52" width="104" height="138" fill="url(#pr-sk0)"/><circle cx="118" cy="82" r="24" fill="#FFE27A" opacity=".35"/><circle cx="118" cy="82" r="16" fill="#FFE27A"/>
    <g fill="#fff" class="pr-clouds"><ellipse cx="66" cy="92" rx="18" ry="8"/><ellipse cx="78" cy="88" rx="12" ry="9"/><ellipse cx="104" cy="118" rx="14" ry="6"/></g>
    <path d="M40 168 Q70 146 98 162 Q120 150 144 160 L144 190 L40 190 Z" fill="#8CC63F"/><path d="M40 178 Q80 166 144 176 L144 190 L40 190 Z" fill="#6FAE34"/>`;
  }
  const rays = day && !dead && !dusty ? '<path d="M144 60 L250 300 L330 300 L150 50 Z" fill="#FFF3C4" opacity=".35"/><path d="M40 190 L120 330 L200 330 L144 190 Z" fill="#FFF3C4" opacity=".28"/>' : '';
  const lampGlow = night && !dead ? '<circle cx="318" cy="150" r="150" fill="url(#pr-lg)"/>' : '';
  const books = [['#8C6CF0', 30], ['#F065A6', 38], ['#3FBFAE', 32], ['#FFC93C', 36], ['#5B7FD1', 30]];
  let bx = 226;
  const bk = books.map(([c, ht]) => { const r = `<rect x="${bx}" y="${112 - ht}" width="12" height="${ht}" rx="2" fill="${dead ? '#9A9090' : c}" stroke="${K}" stroke-width="2.5"/>`; bx += 13; return r; }).join('');
  const web = (x, y, sx, sy) => {
    let p = '';
    for (let i = 1; i <= 4; i++) { const k = i * 26; p += `<path d="M${x + sx * k} ${y} Q${x + sx * k * .72} ${y + sy * k * .72} ${x} ${y + sy * k}" fill="none" stroke="#fff" stroke-width="2"/>`; }
    for (let a = 0; a <= 4; a++) { const g = a / 4 * Math.PI / 2; p += `<path d="M${x} ${y} L${x + sx * Math.cos(g) * 118} ${y + sy * Math.sin(g) * 118}" stroke="#fff" stroke-width="2"/>`; }
    return p;
  };
  const webs = dead ? web(0, 18, 1, 1) + web(360, 18, -1, 1) + web(360, 438, -1, -1)
    + `<path d="M300 18 L300 150" stroke="#fff" stroke-width="1.4"/><g class="pr-spider" transform="translate(300 160)"><ellipse rx="7" ry="9" fill="${K}"/><g stroke="${K}" stroke-width="2"><path d="M-6 -3 l-9 -6 M-6 2 l-10 0 M-6 6 l-8 7 M6 -3 l9 -6 M6 2 l10 0 M6 6 l8 7"/></g><circle cx="-2.5" cy="-3" r="1.6" fill="#fff"/><circle cx="2.5" cy="-3" r="1.6" fill="#fff"/></g>`
    : '';
  const dust = wilt ? `<g fill="rgba(90,80,90,.35)"><ellipse cx="90" cy="420" rx="34" ry="8"/><ellipse cx="270" cy="430" rx="40" ry="8"/><ellipse cx="190" cy="396" rx="18" ry="5"/></g>` : '';
  const curtain = dead ? '#9A8E9A' : night ? '#8C6CF0' : '#F7A9C8', curtainD = dead ? '#867A86' : night ? '#7556D6' : '#EE8DB3';
  const leaf = wilt ? '#8A8A6A' : '#5A9A3A';
  return `<svg class="pr-scene" viewBox="0 18 360 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>
   <linearGradient id="pr-sk0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8FD3FF"/><stop offset="1" stop-color="#FFE3C4"/></linearGradient>
   <linearGradient id="pr-sk1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A1440"/><stop offset="1" stop-color="#4A3A8C"/></linearGradient>
   <radialGradient id="pr-lg"><stop offset="0" stop-color="#FFE7A0" stop-opacity=".85"/><stop offset="1" stop-color="#FFE7A0" stop-opacity="0"/></radialGradient>
   <pattern id="pr-wp" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="${wall}"/><path d="M11 3 L15 11 L11 19 L7 11 Z" fill="${wallDot}"/></pattern>
   <pattern id="pr-fl" width="60" height="26" patternUnits="userSpaceOnUse"><rect width="60" height="26" fill="${floor}"/><path d="M0 25 H60 M30 0 V25" stroke="${plank}" stroke-width="2.5"/></pattern>
   <pattern id="pr-rug" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="${dead ? '#A9A0A6' : '#C9B8FF'}"/><rect width="8" height="16" fill="${dead ? '#B4ACB0' : '#E3D8FF'}"/></pattern></defs>
   <rect y="0" width="360" height="318" fill="url(#pr-wp)"/>${lampGlow}
   <rect y="306" width="360" height="14" fill="${dead ? '#9E968C' : '#FFFFFF'}" stroke="${K}" stroke-width="3"/>
   <rect y="318" width="360" height="160" fill="url(#pr-fl)"/>
   ${rays}
   <rect x="26" y="40" width="132" height="162" rx="16" fill="#fff" stroke="${K}" stroke-width="4"/>
   ${sky}
   <path d="M92 52 V190 M40 120 H144" stroke="#fff" stroke-width="6"/><rect x="40" y="52" width="104" height="138" fill="none" stroke="${K}" stroke-width="3"/>
   <rect x="18" y="198" width="148" height="14" rx="5" fill="#fff" stroke="${K}" stroke-width="3.5"/>
   <g class="pr-plant" transform="translate(118 168)"><path d="M-12 0 L12 0 L9 26 L-9 26 Z" fill="${wilt ? '#9A8A7A' : '#E07A4A'}" stroke="${K}" stroke-width="3"/>
    <path d="${wilt ? 'M0 2 V-14 Q-2 -22 -10 -18 M0 -8 Q8 -12 12 -4' : 'M0 2 V-26 M0 -12 Q-10 -14 -10 -24 M0 -18 Q10 -20 10 -30'}" stroke="${leaf}" stroke-width="7" fill="none" stroke-linecap="round"/>
    ${wilt ? '' : '<circle cx="0" cy="-30" r="6" fill="#FF8FC2" stroke="#2B2140" stroke-width="2.5"/>'}</g>
   <rect x="8" y="26" width="170" height="8" rx="4" fill="#C98B52" stroke="${K}" stroke-width="3"/><circle cx="8" cy="30" r="7" fill="#FFC93C" stroke="${K}" stroke-width="3"/><circle cx="178" cy="30" r="7" fill="#FFC93C" stroke="${K}" stroke-width="3"/>
   <path d="M14 34 Q34 34 40 34 Q46 100 30 150 Q40 200 34 236 L14 236 Q8 140 14 34 Z" fill="${curtain}" stroke="${K}" stroke-width="3.5"/>
   <path d="M172 34 Q150 34 144 34 Q138 100 154 150 Q144 200 150 236 L172 236 Q178 140 172 34 Z" fill="${curtain}" stroke="${K}" stroke-width="3.5"/>
   <path d="M22 60 Q26 120 22 200 M164 60 Q160 120 164 200" stroke="${curtainD}" stroke-width="3" fill="none"/>
   <rect x="20" y="146" width="22" height="9" rx="4" fill="#FFC93C" stroke="${K}" stroke-width="2.5"/><rect x="144" y="146" width="22" height="9" rx="4" fill="#FFC93C" stroke="${K}" stroke-width="2.5"/>
   <rect x="218" y="112" width="120" height="10" rx="4" fill="#C98B52" stroke="${K}" stroke-width="3"/>${bk}
   <g transform="translate(306 84)"><path d="M-10 -14 H10 V-4 Q10 8 0 10 Q-10 8 -10 -4 Z" fill="${dead ? '#A99E7E' : '#FFC93C'}" stroke="${K}" stroke-width="2.5"/><rect x="-6" y="10" width="12" height="6" fill="#C98B52" stroke="${K}" stroke-width="2.5"/><rect x="-10" y="16" width="20" height="8" rx="2" fill="#8A5A34" stroke="${K}" stroke-width="2.5"/></g>
   <path d="M330 122 q6 20 -4 40 q10 16 0 34" stroke="${leaf}" stroke-width="4" fill="none"/>${wilt ? '' : `<g fill="#7CC95A" stroke="${K}" stroke-width="2"><ellipse cx="324" cy="140" rx="6" ry="4"/><ellipse cx="334" cy="160" rx="6" ry="4"/><ellipse cx="326" cy="182" rx="6" ry="4"/></g>`}
   <g transform="translate(196 140) rotate(${dead ? -9 : 0})"><rect width="72" height="54" rx="6" fill="#fff" stroke="${K}" stroke-width="3.5"/><rect x="7" y="7" width="58" height="40" fill="${dead ? '#9AA0A6' : '#BFE3F5'}"/><path d="M7 47 L26 24 L38 36 L48 26 L65 47 Z" fill="${dead ? '#7E847A' : '#7CC95A'}"/><circle cx="52" cy="16" r="5" fill="${dead ? '#C9C2B0' : '#FFC93C'}"/></g>
   <path d="M318 160 V306" stroke="${K}" stroke-width="5"/><ellipse cx="318" cy="308" rx="20" ry="6" fill="#8A5A34" stroke="${K}" stroke-width="3"/>
   <path d="M296 160 L340 160 L332 126 L304 126 Z" fill="${night && !dead ? '#FFE27A' : dead ? '#A89E8A' : '#FFF1C9'}" stroke="${K}" stroke-width="3.5" ${dead ? 'transform="rotate(14 318 160)"' : ''}/>
   <ellipse cx="180" cy="400" rx="150" ry="30" fill="url(#pr-rug)" stroke="${K}" stroke-width="4"/>
   <rect x="60" y="246" width="240" height="70" rx="26" fill="${sofa}" stroke="${K}" stroke-width="4.5"/>
   <path d="M78 262 Q180 250 282 262" stroke="${sofaD}" stroke-width="4" fill="none" opacity=".6"/>
   <rect x="52" y="300" width="256" height="44" rx="18" fill="${sofa}" stroke="${K}" stroke-width="4.5"/>
   <path d="M180 302 V340" stroke="${sofaD}" stroke-width="3.5"/>
   <rect x="34" y="276" width="42" height="80" rx="20" fill="${sofaD}" stroke="${K}" stroke-width="4.5"/><rect x="284" y="276" width="42" height="80" rx="20" fill="${sofaD}" stroke="${K}" stroke-width="4.5"/>
   <rect x="72" y="270" width="46" height="38" rx="14" fill="${cush1}" stroke="${K}" stroke-width="3.5" transform="rotate(-10 95 289)"/>
   <rect x="242" y="270" width="46" height="38" rx="14" fill="${cush2}" stroke="${K}" stroke-width="3.5" transform="rotate(10 265 289)"/>
   <rect x="66" y="344" width="10" height="16" rx="3" fill="#8A5A34" stroke="${K}" stroke-width="3"/><rect x="284" y="344" width="10" height="16" rx="3" fill="#8A5A34" stroke="${K}" stroke-width="3"/>
   ${night && !dead ? `<rect y="0" width="360" height="478" fill="#1A1440" opacity=".18"/>` : ''}
   ${dead ? '<rect y="0" width="360" height="478" fill="#6E6A7A" opacity=".18"/>' : dusty ? '<rect y="0" width="360" height="478" fill="#8A8290" opacity=".14"/>' : ''}
   ${dust}${webs}
  </svg>`;
}

function meter(icon, label, v, good) {
  const color = v > 50 ? good : v > 20 ? '#FFC93C' : '#FF6B6B';
  return h('div', { class: 'pr-meter' }, h('span', { class: 'pr-meter-l' }, `${icon} ${label}`),
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

function setMeter(meter, to, from) {
  if (!meter) return;
  const bar = meter.querySelector('.pr-bar i'), num = meter.querySelector('b');
  if (from !== undefined) { bar.style.transition = 'none'; bar.style.width = `${from}%`; void bar.offsetWidth; bar.style.transition = ''; }
  bar.style.width = `${to}%`;
  bar.style.background = to > 50 ? '#8CC63F' : to > 20 ? '#FFC93C' : '#FF6B6B';
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

  const foodMeter = meter('🍽', 'Сытость', food, '#8CC63F');
  const pat = h('button', { type: 'button', class: 'pr-btn' }, dead ? '🎁 Помириться' : dusty ? '⏰ Разбудить' : '🤚 Погладить');
  pat.addEventListener('click', () => {
    if (dead || dusty) { haptic.tap(); toast(dead ? 'Отметь привычку — паутина исчезнет 🧹' : 'Одна галочка — и я проснусь 🌅'); onFeed && onFeed(); return; }
    playPet(room, pet, u, expr);
  });
  let { pending } = dead || dusty ? { pending: 0 } : feedInfo(state);
  const badge = h('span', { class: 'pr-badge' }, String(pending));
  const feed = h('button', { type: 'button', class: `pr-btn main ${pending ? 'has-food' : ''}` }, '🍽 Покормить', pending ? badge : null);
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

  return h('section', { class: 'pr-card', 'aria-label': `Домик: ${mName}` },
    h('div', { class: 'pr-top' }, h('h2', null, `🏠 Домик · ${mName}`),
      state.level ? h('span', { class: 'pr-lv' }, `ур. ${state.level.level}`) : null),
    h('div', { class: 'pr-meters' }, foodMeter, meter('🎉', 'Настроение', fun, '#F065A6')),
    room,
    h('div', { class: 'pr-btns' }, pat, feed),
    h('div', { class: 'pr-tip' }, dead ? 'Отметь привычку — паутина исчезнет, и маскот простит 💜'
      : 'Каждая привычка — корм 🍽 · серия и квест дня — настроение 🎉'));
}
