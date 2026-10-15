// Милые наклейки на фоне ленты с фото. Только для стилей без своей
// анимированной подложки (сейчас это «Классика»): у хэллоуина, леса, моря,
// матрицы и космоса уже есть живой фон — их не трогаем.

import { h } from './dom.js';

const S = (body, vb = '0 0 40 40') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const SETS = {
  classic: [
    S('<path d="M20 3l4.7 11.4L37 15.6l-9.4 8 2.9 12.2L20 29.2 9.5 35.8l2.9-12.2-9.4-8 12.3-1.2z" fill="#FFD23F" stroke="#C99A00" stroke-width="1.5" stroke-linejoin="round"/>'),
    S('<path d="M20 35S5 26 5 15a8 8 0 0115-4 8 8 0 0115 4c0 11-15 20-15 20z" fill="#F3619C"/><path d="M12 12a4 4 0 014-3" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none" opacity=".7"/>'),
    S('<g fill="#B494F8"><circle cx="20" cy="9" r="7"/><circle cx="31" cy="17" r="7"/><circle cx="27" cy="30" r="7"/><circle cx="13" cy="30" r="7"/><circle cx="9" cy="17" r="7"/></g><circle cx="20" cy="20" r="6" fill="#FFD23F"/>'),
    S('<path d="M4 30a16 16 0 0132 0" fill="none" stroke="#F3619C" stroke-width="4"/><path d="M9 30a11 11 0 0122 0" fill="none" stroke="#FFD23F" stroke-width="4"/><path d="M14 30a6 6 0 0112 0" fill="none" stroke="#93ABD8" stroke-width="4"/>'),
    S('<path d="M20 4v32M4 20h32M9 9l22 22M31 9L9 31" stroke="#DBFA40" stroke-width="4" stroke-linecap="round"/><circle cx="20" cy="20" r="4" fill="#2C2A22"/>'),
    S('<circle cx="13" cy="27" r="8" fill="#F3619C"/><circle cx="27" cy="27" r="8" fill="#F3619C"/><path d="M13 19c2-8 7-12 12-14M27 19c-1-6 0-10-2-14" stroke="#4F9A3A" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M25 5c4 0 7 2 8 5-4 1-7-1-8-5z" fill="#9BD86A"/>'),
  ],
  halloween: [
    S('<path d="M20 9c-2-4 0-6 2-6" stroke="#4F7A1E" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="20" cy="23" rx="16" ry="13" fill="#F28C1B"/><path d="M20 10v26M11 12c-3 6-3 15 0 22M29 12c3 6 3 15 0 22" stroke="#C25E00" stroke-width="1.6" fill="none"/><path d="M12 20l4 3-4 1zM28 20l-4 3 4 1zM14 29q6 4 12 0l-2 2-2-1-2 2-2-2-2 1z" fill="#3A1D00"/>'),
    S('<path d="M20 22c-3-6-9-9-17-7 4 2 5 6 3 9 4-1 7 0 9 3 1-3 3-5 5-5zM20 22c3-6 9-9 17-7-4 2-5 6-3 9-4-1-7 0-9 3-1-3-3-5-5-5z" fill="#8A63C9"/><ellipse cx="20" cy="22" rx="4" ry="5" fill="#8A63C9"/><path d="M17 17l1 3M23 17l-1 3" stroke="#8A63C9" stroke-width="2"/><circle cx="18.5" cy="21" r="1" fill="#FFD23F"/><circle cx="21.5" cy="21" r="1" fill="#FFD23F"/>'),
    S('<path d="M8 36V17a12 12 0 0124 0v19l-4-3-4 3-4-3-4 3-4-3z" fill="#FFFDF4" stroke="#3B2551" stroke-width="1.5"/><circle cx="15.5" cy="18" r="2.2" fill="#3B2551"/><circle cx="24.5" cy="18" r="2.2" fill="#3B2551"/><ellipse cx="20" cy="25" rx="2.5" ry="3" fill="#3B2551"/>'),
    S('<path d="M7 13l6 7-6 7M33 13l-6 7 6 7" fill="#B494F8"/><rect x="12" y="13" width="16" height="14" rx="7" fill="#F28C1B"/><path d="M16 14l-2 12M22 14l-2 12M28 15l-2 11" stroke="#FFFDF4" stroke-width="2"/>'),
    S('<g stroke="#8B7FA8" stroke-width="1.2" fill="none"><path d="M20 20L20 2M20 20L36 8M20 20L38 26M20 20L24 38M20 20L6 34M20 20L3 14"/><path d="M14 9q6 3 11-2M27 13q4 4 5 10M29 28q-3 4-6 7M17 32q-5-1-8-4M9 23q-1-5 1-8M13 15q3-2 6-1"/></g><circle cx="27" cy="30" r="3" fill="#3B2551"/><path d="M27 27V20" stroke="#3B2551" stroke-width="1"/>'),
    S('<path d="M26 5a15 15 0 1 0 9 22A13 13 0 0 1 26 5z" fill="#FFE46B"/><circle cx="17" cy="20" r="2" fill="#E8C73A"/><circle cx="21" cy="29" r="1.5" fill="#E8C73A"/>'),
  ],
  matrix: [
    S('<text x="4" y="18" font-family="monospace" font-weight="700" font-size="13" fill="#3CFF6B">01</text><text x="14" y="34" font-family="monospace" font-weight="700" font-size="13" fill="#1DB954">10</text>'),
    S('<rect x="6" y="15" width="28" height="11" rx="5.5" fill="#E53935" transform="rotate(-30 20 20)"/><path d="M20 20l7-4a5.5 5.5 0 015.5 9.5l-7 4z" fill="#FFFDF4" opacity=".35" transform="rotate(0)"/>'),
    S('<rect x="6" y="15" width="28" height="11" rx="5.5" fill="#2F6FE0" transform="rotate(30 20 20)"/>'),
    S('<path d="M15 6c-2 0-3 4-2 10l2 3c-5 1-8 5-8 10 0 5 5 8 13 8s13-3 13-8c0-5-3-9-8-10l2-3c1-6 0-10-2-10s-3 4-3 9h-4c0-5-1-9-3-9z" fill="#E8FFE9"/><circle cx="16" cy="26" r="1.6" fill="#0B3D16"/><circle cx="24" cy="26" r="1.6" fill="#0B3D16"/>'),
    S('<rect x="4" y="7" width="32" height="26" rx="4" fill="#0B140D" stroke="#3CFF6B" stroke-width="2"/><path d="M10 16l5 4-5 4" stroke="#3CFF6B" stroke-width="2.5" fill="none" stroke-linecap="round"/><rect x="18" y="23" width="10" height="3" fill="#3CFF6B"/>'),
    S('<text x="5" y="29" font-family="monospace" font-weight="700" font-size="22" fill="#3CFF6B">{}</text>'),
  ],
  forest: [
    S('<path d="M20 4C9 9 6 22 13 33c11-2 18-13 7-29z" fill="#7FB241"/><path d="M14 33C16 24 18 14 20 4" stroke="#365004" stroke-width="2" fill="none"/>'),
    S('<path d="M5 20a15 13 0 0130 0z" fill="#E0543B"/><circle cx="13" cy="15" r="2.5" fill="#FFF7E0"/><circle cx="22" cy="11" r="2" fill="#FFF7E0"/><circle cx="28" cy="17" r="2.2" fill="#FFF7E0"/><path d="M15 20h10l-1 14h-8z" fill="#FFF3D4"/>'),
    S('<ellipse cx="20" cy="25" rx="9" ry="11" fill="#B8742A"/><path d="M9 17a11 7 0 0122 0z" fill="#6E4310"/><path d="M20 10v-5" stroke="#6E4310" stroke-width="3" stroke-linecap="round"/><path d="M12 15h16M13 13h14" stroke="#4E2E08" stroke-width="1"/>'),
    S('<path d="M20 3L9 18h6L7 28h9v8h8v-8h9l-8-10h6z" fill="#3E7A2C"/>'),
    S('<g fill="#F7C9DD"><circle cx="20" cy="11" r="6"/><circle cx="29" cy="18" r="6"/><circle cx="25" cy="28" r="6"/><circle cx="15" cy="28" r="6"/><circle cx="11" cy="18" r="6"/></g><circle cx="20" cy="20" r="5" fill="#F2C94C"/>'),
    S('<path d="M20 20C14 8 4 9 5 17c1 6 9 6 15 3zM20 20c6-12 16-11 15-3-1 6-9 6-15 3zM20 21c-5 3-11 10-7 13 3 2 6-5 7-13zM20 21c5 3 11 10 7 13-3 2-6-5-7-13z" fill="#F2A541"/><path d="M20 12v20" stroke="#4E2E08" stroke-width="2" stroke-linecap="round"/>'),
  ],
  ocean: [
    S('<path d="M20 34L5 16a15 12 0 0130 0z" fill="#FFB8A8"/><path d="M20 34L12 9M20 34V6M20 34l8-25M20 34L6 15M20 34l14-19" stroke="#E07A6A" stroke-width="1.6" fill="none"/>'),
    S('<path d="M20 3l4 11 11 1-8 8 3 12-10-6-10 6 3-12-8-8 11-1z" fill="#FF8A5B" stroke="#D9572A" stroke-width="1.5" stroke-linejoin="round"/><circle cx="20" cy="19" r="1.5" fill="#D9572A"/>'),
    S('<path d="M6 20c6-10 18-10 24 0-6 10-18 10-24 0z" fill="#FFC93C"/><path d="M30 20l7-7v14z" fill="#FFC93C"/><circle cx="13" cy="18" r="2" fill="#1E3A5F"/><path d="M19 13v14M24 14v12" stroke="#E5A800" stroke-width="2"/>'),
    S('<circle cx="14" cy="24" r="9" fill="none" stroke="#7FE0EA" stroke-width="2.5"/><circle cx="28" cy="12" r="5" fill="none" stroke="#7FE0EA" stroke-width="2.5"/><circle cx="30" cy="30" r="3" fill="none" stroke="#7FE0EA" stroke-width="2"/><path d="M10 20a5 5 0 014-3" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>'),
    S('<path d="M2 24q5-8 10 0t10 0 10 0 8-2" stroke="#2BB3C0" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M2 32q5-8 10 0t10 0 10 0 8-2" stroke="#7FE0EA" stroke-width="4" fill="none" stroke-linecap="round"/>'),
    S('<circle cx="20" cy="9" r="4" fill="none" stroke="#1E3A5F" stroke-width="3"/><path d="M20 13v22M12 19h16M7 25c2 7 8 10 13 10s11-3 13-10" stroke="#1E3A5F" stroke-width="3" fill="none" stroke-linecap="round"/>'),
  ],
  space: [
    S('<circle cx="20" cy="20" r="11" fill="#B494F8"/><ellipse cx="20" cy="20" rx="19" ry="5" fill="none" stroke="#FFD23F" stroke-width="2.5" transform="rotate(-20 20 20)"/><circle cx="16" cy="16" r="3" fill="#CDB8FF"/>'),
    S('<path d="M20 3c7 6 9 15 6 24h-12c-3-9-1-18 6-24z" fill="#FFFDF4" stroke="#2C2A22" stroke-width="1.5"/><circle cx="20" cy="15" r="3.5" fill="#5BC0EB" stroke="#2C2A22" stroke-width="1.5"/><path d="M14 22l-6 7 7-1M26 22l6 7-7-1" fill="#F3619C"/><path d="M16 28c0 5 4 9 4 9s4-4 4-9" fill="#FF9F1C"/>'),
    S('<path d="M20 6l3 11 11 3-11 3-3 11-3-11-11-3 11-3z" fill="#FFE46B"/>'),
    S('<path d="M6 34L28 12" stroke="#93ABD8" stroke-width="4" stroke-linecap="round" opacity=".6"/><path d="M10 30L28 12" stroke="#DBFA40" stroke-width="2" stroke-linecap="round"/><circle cx="30" cy="10" r="6" fill="#DBFA40"/>'),
    S('<ellipse cx="20" cy="24" rx="17" ry="6" fill="#93ABD8"/><path d="M10 22a10 9 0 0120 0z" fill="#7FE0EA" opacity=".85"/><circle cx="20" cy="17" r="4" fill="#7ED957"/><circle cx="18.5" cy="16.5" r="1" fill="#1B1B3A"/><circle cx="21.5" cy="16.5" r="1" fill="#1B1B3A"/><g fill="#FFE46B"><circle cx="9" cy="25" r="1.5"/><circle cx="20" cy="27" r="1.5"/><circle cx="31" cy="25" r="1.5"/></g>'),
    S('<path d="M26 5a15 15 0 1 0 9 22A13 13 0 0 1 26 5z" fill="#F3E9FF"/><circle cx="16" cy="18" r="2.5" fill="#D9C8F5"/><circle cx="21" cy="28" r="1.8" fill="#D9C8F5"/>'),
  ],
};

const ANIMATED = new Set(['halloween', 'matrix', 'forest', 'ocean', 'space']);
const decorOn = () => !ANIMATED.has(document.documentElement.dataset.theme);

/** Слой наклеек для ленты высотой примерно rows «рядов» фото. */
export function feedDecor(rows) {
  if (!decorOn()) return null;
  const theme = document.documentElement.dataset.theme;
  const set = SETS[theme] || SETS.classic;
  const layer = h('div', { class: `feed-decor theme-${SETS[theme] ? theme : 'classic'}`, 'aria-hidden': 'true' });
  const count = Math.max(4, Math.min(28, Math.round(rows * 2.2)));
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  // три «дорожки»: левый край, промежуток между колонками, правый край
  const lanes = [[-4, 6], [44, 52], [90, 99]];
  for (let k = 0; k < count; k++) {
    const [a, b] = lanes[k % 3];
    const size = 34 + Math.round(rnd() * 18);
    const item = h('span', {
      class: 'feed-decor-item',
      style: {
        left: `calc(${(a + rnd() * (b - a)).toFixed(1)}% - ${size / 2}px)`,
        top: `${((k + 0.5) / count * 100 + (rnd() - 0.5) * 6).toFixed(1)}%`,
        width: `${size}px`, height: `${size}px`,
        '--r': `${Math.round((rnd() - 0.5) * 50)}deg`,
        '--d': `${(rnd() * 4).toFixed(2)}s`,
      },
      html: set[Math.floor(rnd() * set.length)],
    });
    layer.append(item);
  }
  return layer;
}

/** Наклейка на уголок полароида — из набора текущего стиля. */
export function cornerSticker(n) {
  if (!decorOn()) return null;
  const theme = document.documentElement.dataset.theme;
  const set = SETS[theme] || SETS.classic;
  const corner = n % 2 ? 'tr' : 'bl';
  return h('span', { class: `snap-sticker ${corner} theme-${SETS[theme] ? theme : 'classic'}`, 'aria-hidden': 'true',
    style: { '--r': `${((n % 9) - 4) * 6}deg` }, html: set[n % set.length] });
}
