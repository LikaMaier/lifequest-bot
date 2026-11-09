// Тамагочи «Домик» на главной: комната маскота живёт привычками.
// Галочки — это корм, серия и квест дня — настроение. День — солнце в окне,
// ночью — луна и торшер. Пару дней без галочек — пыль и маскот спит,
// неделю и дольше — всё в паутине, маскот обижен. Отметь привычку — и он простит.

import { h } from './dom.js';
import { haptic } from './tg.js';
import { mascot, tapMascot } from './mascot.js';
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

/** Сытость и настроение 0–100 — от галочек сегодня, серии и давности. */
export function petStats(state) {
  const away = awayDays(state);
  if (away >= DUSTY_DAYS) {
    const v = Math.max(4, 44 - away * 6);
    return { food: v, fun: Math.max(4, v - 8), away };
  }
  const hs = state.habits || {};
  const t = state.today || {};
  const food = hs.total ? Math.round(18 + 82 * (hs.done / hs.total))
    : t.goal ? Math.round(18 + 82 * Math.min(1, t.done / t.goal)) : 40;
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

  const pat = h('button', { type: 'button', class: 'pr-btn' }, dead ? '🎁 Помириться' : dusty ? '⏰ Разбудить' : '🤚 Погладить');
  pat.addEventListener('click', () => {
    if (dead || dusty) { haptic.tap(); toast(dead ? 'Отметь привычку — паутина исчезнет 🧹' : 'Одна галочка — и я проснусь 🌅'); onFeed && onFeed(); return; }
    haptic.success(); floatUp(room, '💜', 6);
    pet.classList.remove('jump'); void pet.offsetWidth; pet.classList.add('jump');
  });
  const feed = h('button', { type: 'button', class: 'pr-btn main' }, '🍽 Покормить');
  feed.addEventListener('click', () => {
    haptic.tap();
    if (allDone) { floatUp(room, '😋', 3); toast(`${mName} сыт — все привычки на сегодня сделаны 🎉`, 'good'); return; }
    toast('Корм — это галочки: отметь привычку 💜');
    onFeed && onFeed();
  });

  return h('section', { class: 'pr-card', 'aria-label': `Домик: ${mName}` },
    h('div', { class: 'pr-top' }, h('h2', null, `🏠 Домик · ${mName}`),
      state.level ? h('span', { class: 'pr-lv' }, `ур. ${state.level.level}`) : null),
    h('div', { class: 'pr-meters' }, meter('🍽', 'Сытость', food, '#8CC63F'), meter('🎉', 'Настроение', fun, '#F065A6')),
    room,
    h('div', { class: 'pr-btns' }, pat, feed),
    h('div', { class: 'pr-tip' }, dead ? 'Отметь привычку — паутина исчезнет, и маскот простит 💜'
      : 'Каждая привычка — корм 🍽 · серия и квест дня — настроение 🎉'));
}
