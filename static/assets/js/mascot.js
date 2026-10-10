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
  const kind = MASCOT_KINDS[Math.floor(seed * 997) % MASCOT_KINDS.length];
  const expr = ['happy', 'wink', 'silly', 'love'][Math.floor(seed * 131) % 4];
  return h('div', { class: 'mascot', style: { width: '100%', height: '100%' }, html: mascotSVG(kind, expr), 'aria-hidden': 'true' });
}
