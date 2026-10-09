// Маскоты LifeQuest: котики, звёздочка и сердечко из первой версии карты,
// плюс новые выражения (грустит, влюблена) и реакции на события.

import { h, svgEl } from './dom.js';

export const MASCOT_COLORS = {
  'cat-purple': '#B494F8', 'cat-blue': '#93ABD8', 'cat-lav': '#E7BEF8',
  'cat-orange': '#ED7C30', 'cat-pink2': '#F3619C', 'cat-lime': '#DBFA40',
};
export const MASCOT_KINDS = ['star', 'heart', 'cat-purple', 'cat-blue', 'cat-lav', 'cat-orange', 'cat-pink2', 'cat-lime'];
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

/** SVG-строка маскота: kind — вид, expr — выражение. */
export function mascotSVG(kind, expr = 'happy') {
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
export function mascot(kind, expr = 'happy', { size = 64, label, cls = '' } = {}) {
  const el = svgEl(mascotSVG(kind, expr), `mascot ${cls}`);
  el.style.width = `${size}px`;
  el.style.height = `${Math.round(size * 0.92)}px`;
  if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); }
  else el.setAttribute('aria-hidden', 'true');
  return el;
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
