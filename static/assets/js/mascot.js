// Маскоты LifeQuest: котики, звёздочка и сердечко из первой версии карты,
// плюс новые выражения (грустит, влюблена) и реакции на события.

import { h, svgEl } from './dom.js';

export const MASCOT_COLORS = {
  'cat-purple': '#B494F8', 'cat-blue': '#93ABD8', 'cat-lav': '#E7BEF8',
  'cat-orange': '#ED7C30', 'cat-pink2': '#F3619C', 'cat-lime': '#DBFA40',
};
// Выбираемые маскоты: котик и звёздочка — с самого начала, звери открываются уровнями.
export const MASCOT_KINDS = ['cat-purple', 'star', 'frog', 'puppy', 'bear', 'leopard', 'panda', 'pig'];
// Старые маскоты (до обновления) — рисуем так же, как их замену.
const LEGACY = { 'cat-blue': 'frog', heart: 'puppy', 'cat-orange': 'bear', 'cat-lav': 'leopard', 'cat-pink2': 'panda', 'cat-lime': 'pig' };
export const EXPRESSIONS = ['happy', 'wink', 'surprised', 'sleepy', 'silly', 'sad', 'love'];

const INK = '#241F1A';

function eyesSVG(expr) {
  if (expr === 'wink') {
    return `<circle cx="35" cy="44" r="5" fill="${INK}"/>`
      + `<path d="M56 44 q9 -7 18 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
  if (expr === 'sleepy') {
    return `<path d="M27 44 q8 6 16 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`
      + `<path d="M57 44 q8 6 16 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
  if (expr === 'surprised') {
    return `<circle cx="35" cy="44" r="6.5" fill="${INK}"/><circle cx="65" cy="44" r="6.5" fill="${INK}"/>`;
  }
  if (expr === 'sad') {
    return `<circle cx="35" cy="46" r="4.5" fill="${INK}"/><circle cx="65" cy="46" r="4.5" fill="${INK}"/>`
      + `<path d="M27 36 l12 4" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
      + `<path d="M73 36 l-12 4" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
      + `<path d="M70 52 q3 7 0 9 q-3 -2 0 -9 z" fill="#7FB6F0"/>`;
  }
  if (expr === 'love') {
    const heart = (x, y) => `<path d="M${x} ${y + 5} c-7 -5 -8 -11 -3.5 -12.5 c2 -0.6 3.5 0.6 3.5 2.2 c0 -1.6 1.5 -2.8 3.5 -2.2 c4.5 1.5 3.5 7.5 -3.5 12.5 z" fill="#FB4645"/>`;
    return heart(35, 42) + heart(65, 42);
  }
  return `<circle cx="35" cy="44" r="5" fill="${INK}"/><circle cx="65" cy="44" r="5" fill="${INK}"/>`;
}

function mouthSVG(expr) {
  if (expr === 'surprised') return `<ellipse cx="50" cy="62" rx="6" ry="7" fill="${INK}"/>`;
  if (expr === 'silly') {
    return `<path d="M38 58 q12 12 24 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`
      + '<path d="M45 61 q5 9 10 0 Z" fill="#E8807A"/>';
  }
  if (expr === 'sad') return `<path d="M40 64 q10 -8 20 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  if (expr === 'sleepy') return `<ellipse cx="50" cy="62" rx="4" ry="3" fill="${INK}"/>`;
  return `<path d="M38 58 q12 9 24 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
}

const blush = '<ellipse cx="24" cy="56" rx="6" ry="3.5" fill="#F3619C" opacity=".35"/><ellipse cx="76" cy="56" rx="6" ry="3.5" fill="#F3619C" opacity=".35"/>';
const zzz = '<text x="80" y="14" font-family="Unbounded, sans-serif" font-weight="800" font-size="16" fill="#6B4B9E">z</text><text x="92" y="2" font-family="Unbounded, sans-serif" font-weight="800" font-size="11" fill="#6B4B9E">z</text>';

// ---------- Звери ----------
// Лицо у всех на одной сетке (глаза y≈44, нос y≈53, рот y≈58–64), поэтому
// все выражения работают без отдельной отрисовки.
function animalSVG(kind, expr) {
  let eyes = eyesSVG(expr);
  let mouth = mouthSVG(expr);
  const cheeks = expr === 'love' || expr === 'happy' || expr === 'silly' ? blush : '';
  const z = expr === 'sleepy' ? zzz : '';
  const nose = (fill = INK) => `<ellipse cx="50" cy="54" rx="5" ry="3.8" fill="${fill}"/>`;
  let body = '';
  if (kind === 'frog') {
    body = '<circle cx="31" cy="33" r="15" fill="#7CC95A"/><circle cx="69" cy="33" r="15" fill="#7CC95A"/>'
      + '<ellipse cx="50" cy="62" rx="44" ry="31" fill="#7CC95A"/>'
      + '<circle cx="31" cy="33" r="10" fill="#FFFDF5"/><circle cx="69" cy="33" r="10" fill="#FFFDF5"/>'
      + '<ellipse cx="50" cy="78" rx="24" ry="10" fill="#B9E58F"/>';
    eyes = `<g transform="translate(0,-11) translate(50,0) scale(1.27,1) translate(-50,0)">${eyes}</g>`;
    mouth = `<g transform="translate(50,60) scale(1.35,1) translate(-50,-60)">${mouth}</g>`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">${body}${eyes}${mouth}${cheeks}${z}</svg>`;
  }
  if (kind === 'puppy') {
    body = '<ellipse cx="50" cy="56" rx="37" ry="36" fill="#EBC48F"/>'
      + '<ellipse cx="65" cy="42" rx="12" ry="11" fill="#D9A066"/>'
      + '<path d="M17 26 C3 38 5 66 16 74 C26 68 28 44 27 30 Z" fill="#A86B3C"/>'
      + '<path d="M83 26 C97 38 95 66 84 74 C74 68 72 44 73 30 Z" fill="#A86B3C"/>'
      + '<ellipse cx="50" cy="63" rx="16" ry="12" fill="#F7E3C4"/>' + nose();
  } else if (kind === 'bear') {
    body = '<circle cx="22" cy="24" r="12" fill="#9C6B43"/><circle cx="78" cy="24" r="12" fill="#9C6B43"/>'
      + '<circle cx="22" cy="24" r="6" fill="#D8A97E"/><circle cx="78" cy="24" r="6" fill="#D8A97E"/>'
      + '<ellipse cx="50" cy="57" rx="40" ry="36" fill="#B07A4E"/>'
      + '<ellipse cx="50" cy="63" rx="16" ry="12" fill="#E2BC94"/>' + nose();
  } else if (kind === 'leopard') {
    const spot = (x, y) => `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="#7A4E1A" stroke-width="2.4"/><circle cx="${x}" cy="${y}" r="1.4" fill="#C98A2E"/>`;
    body = '<circle cx="23" cy="27" r="10" fill="#E8A53A"/><circle cx="77" cy="27" r="10" fill="#E8A53A"/>'
      + '<circle cx="23" cy="27" r="5" fill="#F6D08A"/><circle cx="77" cy="27" r="5" fill="#F6D08A"/>'
      + '<ellipse cx="50" cy="57" rx="41" ry="36" fill="#F2B84B"/>'
      + spot(20, 52) + spot(27, 72) + spot(80, 52) + spot(73, 72) + spot(40, 27) + spot(60, 27) + spot(50, 34)
      + '<ellipse cx="50" cy="64" rx="15" ry="11" fill="#FBE7C2"/>'
      + '<path d="M45 52 h10 l-5 5.5 z" fill="#C9656B" stroke="#C9656B" stroke-linejoin="round" stroke-width="1.5"/>';
  } else if (kind === 'panda') {
    body = '<circle cx="22" cy="25" r="12" fill="#2C2A22"/><circle cx="78" cy="25" r="12" fill="#2C2A22"/>'
      + '<ellipse cx="50" cy="57" rx="41" ry="36" fill="#FFFDF5" stroke="#E3DCC8" stroke-width="2"/>'
      + '<ellipse cx="35" cy="45" rx="10" ry="12.5" fill="#2C2A22" transform="rotate(-24 35 45)"/>'
      + '<ellipse cx="65" cy="45" rx="10" ry="12.5" fill="#2C2A22" transform="rotate(24 65 45)"/>' + nose();
    eyes = eyes.replace(new RegExp(INK, 'g'), '#FFFDF5');
  } else if (kind === 'pig') {
    body = '<path d="M20 32 L25 9 L42 24 Z" fill="#E77FA6"/><path d="M80 32 L75 9 L58 24 Z" fill="#E77FA6"/>'
      + '<ellipse cx="50" cy="56" rx="40" ry="36" fill="#F7A8C4"/>'
      + '<ellipse cx="50" cy="60" rx="14" ry="9.5" fill="#F27BA8"/>'
      + '<ellipse cx="45" cy="60" rx="2.4" ry="3.4" fill="#B23C6C"/><ellipse cx="55" cy="60" rx="2.4" ry="3.4" fill="#B23C6C"/>';
    mouth = `<g transform="translate(0,13)">${mouth}</g>`;
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${body}${eyes}${mouth}${cheeks}${z}</svg>`;
}

// ---------- Аксессуары из магазина ----------
// Рисуются поверх маскота в той же сетке 100×100 (голова сверху, глаза y≈44).
export const ACCESSORIES = {
  flower: '<g transform="translate(24 22)"><circle cx="0" cy="-7" r="5.5" fill="#FF8FC2"/><circle cx="7" cy="-2" r="5.5" fill="#FF8FC2"/>'
    + '<circle cx="4.5" cy="6" r="5.5" fill="#FF8FC2"/><circle cx="-4.5" cy="6" r="5.5" fill="#FF8FC2"/><circle cx="-7" cy="-2" r="5.5" fill="#FF8FC2"/>'
    + '<circle r="4.5" fill="#FFD23F"/></g>',
  bow: '<g transform="translate(74 22) rotate(18)"><path d="M0 0 L-14 -9 Q-17 0 -14 9 Z" fill="#FB4645"/><path d="M0 0 L14 -9 Q17 0 14 9 Z" fill="#FB4645"/>'
    + '<circle r="4.5" fill="#C92E3A"/></g>',
  cap: '<path d="M28 27 Q30 7 50 7 Q70 7 72 27 Z" fill="#4E7BFF"/><path d="M60 25 Q80 22 90 28 Q78 31 62 30 Z" fill="#2D4FC4"/>'
    + '<circle cx="50" cy="8" r="3" fill="#2D4FC4"/><path d="M50 9 L50 26" stroke="#2D4FC4" stroke-width="1.5"/>',
  glasses: '<g fill="none" stroke="#241F1A" stroke-width="3"><circle cx="35" cy="44" r="10" fill="#9FD8F0" fill-opacity=".35"/>'
    + '<circle cx="65" cy="44" r="10" fill="#9FD8F0" fill-opacity=".35"/><path d="M45 43 Q50 39 55 43"/>'
    + '<path d="M25 42 L14 38"/><path d="M75 42 L86 38"/></g>',
  party: '<path d="M38 25 L54 -10 L64 25 Z" fill="#B494F8"/><path d="M42 16 L60 14 M45 8 L58 6 M48 0 L56 -1" stroke="#FFD23F" stroke-width="3"/>'
    + '<circle cx="54" cy="-11" r="5" fill="#F3619C"/>',
  headphones: '<path d="M16 52 Q14 6 50 6 Q86 6 84 52" fill="none" stroke="#3A3550" stroke-width="6" stroke-linecap="round"/>'
    + '<rect x="6" y="40" width="14" height="24" rx="6" fill="#F3619C"/><rect x="80" y="40" width="14" height="24" rx="6" fill="#F3619C"/>',
  crown: '<path d="M33 22 L33 6 L42 14 L50 2 L58 14 L67 6 L67 22 Z" fill="#FFC83D" stroke="#C98A00" stroke-width="2" stroke-linejoin="round"/>'
    + '<circle cx="50" cy="16" r="3" fill="#FB4645"/><circle cx="40" cy="18" r="2" fill="#4E7BFF"/><circle cx="60" cy="18" r="2" fill="#4E7BFF"/>',
  halo: '<ellipse cx="50" cy="-3" rx="24" ry="6.5" fill="none" stroke="#FFE46B" stroke-width="7" opacity=".45"/>'
    + '<ellipse cx="50" cy="-3" rx="24" ry="6.5" fill="none" stroke="#FFC83D" stroke-width="3.5"/>',
  // ---- Сезонные ----
  pumpkin: '<path d="M50 10 q2 -8 8 -10" fill="none" stroke="#3F7A2A" stroke-width="3.5" stroke-linecap="round"/>'
    + '<ellipse cx="50" cy="19" rx="22" ry="11" fill="#FF8A2A"/><ellipse cx="38" cy="19" rx="9" ry="10.5" fill="#FF9B45"/>'
    + '<ellipse cx="62" cy="19" rx="9" ry="10.5" fill="#FF9B45"/><ellipse cx="50" cy="19" rx="8" ry="11" fill="#FFA65A"/>'
    + '<path d="M42 17 l3 -3 l3 3 Z M52 17 l3 -3 l3 3 Z M43 23 q7 5 14 0 l-3 1 l-2 -2 l-2 2 l-2 -2 l-2 2 Z" fill="#5A2A0E"/>',
  santa: '<path d="M24 26 Q28 0 56 2 Q76 4 86 22 L80 26 Z" fill="#E0322B"/>'
    + '<rect x="22" y="21" width="58" height="9" rx="4.5" fill="#F7F3EA"/><circle cx="86" cy="23" r="5.5" fill="#F7F3EA"/>',
  // ---- За XP ----
  bowtie: '<g transform="translate(50 88)"><path d="M0 0 L-13 -8 L-13 8 Z" fill="#4E7BFF"/><path d="M0 0 L13 -8 L13 8 Z" fill="#4E7BFF"/>'
    + '<circle r="3.5" fill="#2D4FC4"/></g>',
  beanie: '<path d="M25 28 Q25 4 50 4 Q75 4 75 28 Z" fill="#3FB6A8"/><path d="M36 8 L36 24 M50 4 L50 24 M64 8 L64 24" stroke="#2A8C80" stroke-width="2"/>'
    + '<rect x="23" y="21" width="54" height="9" rx="4.5" fill="#2A8C80"/><circle cx="50" cy="2" r="6.5" fill="#F7F3EA"/>',
  beret: '<ellipse cx="46" cy="19" rx="28" ry="9" fill="#C8102E" transform="rotate(-10 46 19)"/>'
    + '<path d="M48 10 l3 -7" stroke="#8A0B20" stroke-width="3" stroke-linecap="round"/>',
  sunglasses: '<path d="M22 38 h24 v7 q0 9 -12 9 q-12 0 -12 -9 z" fill="#241F1A"/><path d="M54 38 h24 v7 q0 9 -12 9 q-12 0 -12 -9 z" fill="#241F1A"/>'
    + '<path d="M46 40 h8 M22 39 L14 36 M78 39 L86 36" stroke="#241F1A" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="M27 42 l7 -2.5 M59 42 l7 -2.5" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".55"/>',
  chef: '<g fill="#FFFFFF" stroke="#D8D2C2" stroke-width="1.5"><circle cx="37" cy="9" r="9.5"/><circle cx="63" cy="9" r="9.5"/>'
    + '<circle cx="50" cy="3" r="11"/><rect x="31" y="12" width="38" height="16" rx="3"/></g>'
    + '<path d="M38 16 L38 26 M50 16 L50 26 M62 16 L62 26" stroke="#E8E2D2" stroke-width="1.5"/>',
  cowboy: '<path d="M34 24 Q33 4 44 6 Q50 11 56 6 Q67 4 66 24 Z" fill="#A0652D"/><rect x="34" y="17" width="32" height="5" fill="#5A3714"/>'
    + '<path d="M10 22 Q50 34 90 22 Q88 30 50 33 Q12 30 10 22 Z" fill="#8B5524"/>',
  graduate: '<path d="M32 16 L32 27 Q50 34 68 27 L68 16 Z" fill="#3A332B"/><path d="M50 2 L88 14 L50 26 L12 14 Z" fill="#241F1A"/>'
    + '<path d="M50 14 L80 18 L80 31" stroke="#FFC83D" stroke-width="2" fill="none"/><circle cx="80" cy="32" r="3" fill="#FFC83D"/>'
    + '<circle cx="50" cy="14" r="2.5" fill="#FFC83D"/>',
  tophat: '<rect x="34" y="-8" width="32" height="31" rx="2" fill="#241F1A"/><rect x="34" y="12" width="32" height="5" fill="#B23C6C"/>'
    + '<ellipse cx="50" cy="23" rx="26" ry="5" fill="#241F1A"/><path d="M38 -4 L38 10" stroke="#fff" stroke-width="2" opacity=".2"/>',
  // ---- Premium-коллекция ----
  unicorn: '<path d="M44 23 L50 -9 L56 23 Z" fill="#FFE46B" stroke="#E0B300" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<path d="M45 16 L55 13 M46.5 8 L53.5 5.5 M48 1 L52 -0.5" stroke="#E0B300" stroke-width="1.5"/>'
    + '<circle cx="37" cy="23" r="4.5" fill="#FF8FC2"/><circle cx="63" cy="23" r="4.5" fill="#B494F8"/>'
    + '<circle cx="37" cy="23" r="1.6" fill="#FFE46B"/><circle cx="63" cy="23" r="1.6" fill="#FFE46B"/>',
  viking: '<path d="M27 22 Q8 18 9 -1 Q16 12 31 14 Z" fill="#F7F3EA" stroke="#C9C0A8" stroke-width="1.5"/>'
    + '<path d="M73 22 Q92 18 91 -1 Q84 12 69 14 Z" fill="#F7F3EA" stroke="#C9C0A8" stroke-width="1.5"/>'
    + '<path d="M26 28 Q26 4 50 4 Q74 4 74 28 Z" fill="#9AA3B5"/><path d="M50 5 L50 22" stroke="#6B7385" stroke-width="3"/>'
    + '<rect x="24" y="22" width="52" height="7" rx="3" fill="#6B7385"/>'
    + '<circle cx="34" cy="25.5" r="1.5" fill="#C9CEDA"/><circle cx="50" cy="25.5" r="1.5" fill="#C9CEDA"/><circle cx="66" cy="25.5" r="1.5" fill="#C9CEDA"/>',
  flowercrown: '<path d="M22 27 Q50 13 78 27" stroke="#3F7A2A" stroke-width="3" fill="none"/>'
    + '<ellipse cx="33" cy="21" rx="4" ry="2" fill="#5FA83A" transform="rotate(-30 33 21)"/><ellipse cx="67" cy="21" rx="4" ry="2" fill="#5FA83A" transform="rotate(30 67 21)"/>'
    + '<circle cx="26" cy="25" r="5" fill="#FF8FC2"/><circle cx="39" cy="19" r="5.5" fill="#FFD23F"/><circle cx="50" cy="17" r="6" fill="#B494F8"/>'
    + '<circle cx="61" cy="19" r="5.5" fill="#FF8FC2"/><circle cx="74" cy="25" r="5" fill="#FFD23F"/>'
    + '<g fill="#fff"><circle cx="26" cy="25" r="1.8"/><circle cx="39" cy="19" r="2"/><circle cx="50" cy="17" r="2.2"/><circle cx="61" cy="19" r="2"/><circle cx="74" cy="25" r="1.8"/></g>',
  mushroom: '<path d="M17 26 Q17 -1 50 -1 Q83 -1 83 26 Q50 33 17 26 Z" fill="#E8483F"/>'
    + '<g fill="#fff"><circle cx="35" cy="9" r="4.5"/><circle cx="56" cy="6" r="3.5"/><circle cx="69" cy="16" r="4"/><circle cx="46" cy="19" r="3"/><circle cx="27" cy="20" r="2.5"/></g>',
  bunny: '<ellipse cx="38" cy="2" rx="7.5" ry="20" fill="#F7F3EA" transform="rotate(-12 38 2)"/><ellipse cx="38" cy="4" rx="3.5" ry="14" fill="#FFB3CF" transform="rotate(-12 38 4)"/>'
    + '<ellipse cx="62" cy="2" rx="7.5" ry="20" fill="#F7F3EA" transform="rotate(12 62 2)"/><ellipse cx="62" cy="4" rx="3.5" ry="14" fill="#FFB3CF" transform="rotate(12 62 4)"/>'
    + '<path d="M26 26 Q50 12 74 26" stroke="#F3619C" stroke-width="5" fill="none" stroke-linecap="round"/>',
  // ---- Premium-коллекция (первые) ----
  wizard: '<path d="M26 26 Q50 32 74 26 L66 22 Q60 6 56 -10 Q46 -2 40 4 Q36 14 34 22 Z" fill="#5B3FD9"/>'
    + '<path d="M56 -10 Q64 -6 66 0" fill="none" stroke="#5B3FD9" stroke-width="5" stroke-linecap="round"/>'
    + '<ellipse cx="50" cy="25" rx="27" ry="5" fill="#3E2A9E"/>'
    + '<path d="M44 10 l1.6 3.4 3.7.5-2.7 2.6.7 3.7-3.3-1.8-3.3 1.8.7-3.7-2.7-2.6 3.7-.5z" fill="#FFD23F"/>'
    + '<circle cx="58" cy="16" r="1.8" fill="#FFE46B"/><circle cx="38" cy="19" r="1.4" fill="#FFE46B"/>',
  tiara: '<path d="M30 24 Q50 14 70 24 L66 26 Q50 19 34 26 Z" fill="#E6E9F5" stroke="#9AA3C7" stroke-width="1.2"/>'
    + '<path d="M38 22 L41 12 L45 20 L50 6 L55 20 L59 12 L62 22" fill="none" stroke="#C6CCE6" stroke-width="2.6" stroke-linejoin="round"/>'
    + '<path d="M50 9 L53 14 L50 19 L47 14 Z" fill="#F3619C"/><circle cx="41" cy="14" r="2" fill="#7FD6FF"/><circle cx="59" cy="14" r="2" fill="#7FD6FF"/>',
  pirate: '<path d="M18 26 Q24 4 50 6 Q76 4 82 26 Q66 18 50 22 Q34 18 18 26 Z" fill="#241F1A"/>'
    + '<path d="M18 26 Q34 18 50 22 Q66 18 82 26" fill="none" stroke="#FFC83D" stroke-width="2.5"/>'
    + '<path d="M44 20 L56 9 M56 20 L44 9" stroke="#F7F3EA" stroke-width="1.6" stroke-linecap="round"/>'
    + '<circle cx="50" cy="13" r="4.5" fill="#F7F3EA"/><path d="M47.5 12.5 h1.5 M51 12.5 h1.5 M48 16 h4" stroke="#241F1A" stroke-width="1.2"/>',
};

function withAccessory(svg, acc) {
  const art = acc && ACCESSORIES[acc];
  return art ? svg.replace(/<\/svg>$/, `${art}</svg>`) : svg;
}

/** SVG-строка маскота: kind — вид, expr — выражение, acc — аксессуар из магазина. */
export function mascotSVG(kind, expr = 'happy', acc = null) {
  return withAccessory(baseSVG(kind, expr), acc);
}

function baseSVG(kind, expr) {
  kind = LEGACY[kind] || kind;
  if (['frog', 'puppy', 'bear', 'leopard', 'panda', 'pig'].includes(kind)) return animalSVG(kind, expr);
  const eyes = eyesSVG(expr);
  const mouth = mouthSVG(expr);
  const extra = (expr === 'sleepy' ? zzz : '') + (expr === 'love' || expr === 'happy' || expr === 'silly' ? blush : '');
  if (kind === 'star') {
    const starMouth = expr === 'sad' || expr === 'surprised' || expr === 'sleepy' ? mouth
      : `<path d="M40 60 q10 7 20 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    return '<svg viewBox="0 0 100 100" aria-hidden="true">'
      + '<path d="M50 4 L61 36 L96 36 L67 57 L78 90 L50 70 L22 90 L33 57 L4 36 L39 36 Z" fill="#EDE986" stroke="#9C9740" stroke-width="2" stroke-linejoin="round"/>'
      + eyes + starMouth + extra + '</svg>';
  }
  if (kind === 'heart') {
    const heartMouth = expr === 'sad' || expr === 'surprised' || expr === 'sleepy' ? mouth
      : `<path d="M40 50 q10 7 20 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    return '<svg viewBox="0 0 100 100" aria-hidden="true">'
      + '<path d="M50 88 C10 62 8 30 30 18 C42 12 50 22 50 32 C50 22 58 12 70 18 C92 30 90 62 50 88 Z" fill="#FB4645"/>'
      + eyes.replace(/cy="4[46]"/g, 'cy="40"') + heartMouth + extra + '</svg>';
  }
  const color = MASCOT_COLORS[kind] || '#B494F8';
  return '<svg viewBox="0 0 100 100" aria-hidden="true">'
    + `<path d="M18 34 L30 6 L42 30 Z" fill="${color}"/>`
    + `<path d="M82 34 L70 6 L58 30 Z" fill="${color}"/>`
    + '<path d="M24 26 L30 14 L36 26 Z" fill="#fff" opacity=".35"/><path d="M76 26 L70 14 L64 26 Z" fill="#fff" opacity=".35"/>'
    + `<ellipse cx="50" cy="58" rx="42" ry="36" fill="${color}"/>`
    + eyes
    + `<ellipse cx="50" cy="53" rx="3.2" ry="2.4" fill="${INK}"/>`
    + mouth + extra
    + '</svg>';
}

// Маскот, выбранный в профиле: на всех экранах показываем только его.
const current = { kind: 'cat-purple', acc: null };
export function setCurrentMascot(kind, acc) {
  current.kind = kind || 'cat-purple';
  current.acc = acc || null;
}
/** Выбранный маскот (с надетым аксессуаром) — для шапок экранов, пустых состояний и праздников. */
export function myMascot(expr = 'happy', opts = {}) {
  return mascot(current.kind, expr, { acc: current.acc, ...opts });
}

/** DOM-элемент маскота. */
export function mascot(kind, expr = 'happy', { size = 64, label, cls = '', acc = null } = {}) {
  const el = svgEl(mascotSVG(kind, expr, acc), `mascot ${cls}`);
  el.style.width = `${size}px`;
  el.style.height = `${Math.round(size * 0.92)}px`;
  if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); }
  else el.setAttribute('aria-hidden', 'true');
  if (document.documentElement.dataset.theme === 'pixel') pixelate(el, mascotSVG(kind, expr, acc));
  return el;
}

// Стиль 8-bit: рисуем маскота в крошечный холст (сетка 28×28) и растягиваем
// без сглаживания — получается пиксель-арт. Полупрозрачные края убираем,
// чтобы контур был ступенчатым. SVG остаётся, пока холст не готов.
const PIXELS = 28;
const pixelCache = new Map();

function pixelate(el, markup) {
  const draw = canvasFrom => {
    const c = document.createElement('canvas');
    c.width = c.height = PIXELS;
    c.className = 'mascot-pixel';
    c.getContext('2d').drawImage(canvasFrom, 0, 0);
    el.replaceChildren(c);
  };
  const cached = pixelCache.get(markup);
  if (cached) { draw(cached); return; }
  const img = new Image();
  img.onload = () => {
    try {
      const src = document.createElement('canvas');
      src.width = src.height = PIXELS;
      const ctx = src.getContext('2d');
      ctx.drawImage(img, 0, 0, PIXELS, PIXELS);
      const data = ctx.getImageData(0, 0, PIXELS, PIXELS);
      const px = data.data;
      for (let i = 3; i < px.length; i += 4) px[i] = px[i] > 110 ? 255 : 0;
      ctx.putImageData(data, 0, 0);
      if (pixelCache.size > 60) pixelCache.clear();
      pixelCache.set(markup, src);
      draw(src);
    } catch (e) { /* холст недоступен — остаётся обычный SVG */ }
  };
  // Запас по краям: ушки, «z», корона и нимб выходят за сетку 100×100.
  const svg = markup.replace('<svg viewBox="0 0 100 100"', '<svg viewBox="-10 -16 120 120"')
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" ');
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function jump(el) {
  if (!el) return;
  el.classList.remove('jump');
  void el.offsetWidth;
  el.classList.add('jump');
}

/** Настроение маскота по состоянию: ночь — спит, серия сорвалась — грустит,
 *  цель дня выполнена — радуется, пусто — подбадривает. */
export function moodFor(state) {
  const hour = state.today.hour;
  if (hour >= 23 || hour < 6) return { expr: 'sleepy', line: 'Ночь на дворе… Приключения подождут до утра. Сладких снов 💤' };
  if (state.streak.status === 'lost') return { expr: 'sad', line: `Серия в ${state.streak.lost_value} ${dayWord(state.streak.lost_value)} прервалась… Ничего, начнём новую прямо сегодня?` };
  if (state.today.done >= state.today.goal) return { expr: 'love', line: 'Цель дня выполнена! Ты просто огонь 🔥' };
  if (state.streak.status === 'at_risk') return { expr: 'surprised', line: `Серия ${state.streak.current} ${dayWord(state.streak.current)} ждёт тебя — одно задание, и она растёт!` };
  if (state.streak.status === 'freeze') return { expr: 'wink', line: 'Вчера был пропуск, но заморозка спасёт серию — выполни задание сегодня ❄️' };
  if (state.today.done > 0) return { expr: 'happy', line: 'Отличное начало! Ещё немного до цели дня.' };
  return { expr: 'wink', line: state.greeting };
}

function dayWord(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
}

export function stickerEl(seed = Math.random()) {
  const expr = ['happy', 'wink', 'silly', 'love'][Math.floor(seed * 131) % 4];
  return h('div', { class: 'mascot', style: { width: '100%', height: '100%' }, html: mascotSVG(current.kind, expr, current.acc), 'aria-hidden': 'true' });
}
