// Фишки фотоальбома: сторис-слайдшоу месяца, «цвета месяца» из фото,
// коллаж месяца для отправки друзьям и «в этот день».

import { h, clear, fmtDay } from './dom.js';
import { haptic, pushBack } from './tg.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const STORY_MS = 3800;

const load = src => new Promise(resolve => {
  const im = new Image();
  im.decoding = 'async';
  im.onload = () => resolve(im);
  im.onerror = () => resolve(null);
  im.src = src;
});

// ---------- Сторис: фото месяца по одному, с автопрокруткой ----------
export function playStories(list, title) {
  if (!list.length) return;
  const photos = [...list].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let i = 0, timer = null, started = 0, left = STORY_MS, paused = false;
  const bars = photos.map(() => h('span', { class: 'story-bar' }, h('i')));
  const img = h('img', { class: 'story-img', alt: '' });
  const blur = h('img', { class: 'story-blur', alt: '', 'aria-hidden': 'true' });
  const date = h('div', { class: 'story-date' });
  const cap = h('div', { class: 'story-cap' });
  const close = h('button', { type: 'button', class: 'story-close', 'aria-label': 'Закрыть' }, '✕');
  const overlay = h('div', { class: 'story', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Сторис: ${title}` },
    blur, img,
    h('div', { class: 'story-top' }, h('div', { class: 'story-bars' }, bars),
      h('div', { class: 'story-head' }, h('div', { class: 'story-title' }, title), close)),
    h('div', { class: 'story-bottom' }, date, cap),
    h('button', { type: 'button', class: 'story-tap prev', 'aria-label': 'Назад' }),
    h('button', { type: 'button', class: 'story-tap next', 'aria-label': 'Дальше' }));

  const fill = () => bars.forEach((b, k) => {
    const bar = b.firstChild;
    bar.style.transition = 'none';
    bar.style.width = k < i ? '100%' : '0%';
  });
  const run = ms => {
    clearTimeout(timer);
    started = Date.now();
    left = ms;
    const bar = bars[i].firstChild;
    bar.style.transition = 'none';
    void bar.offsetWidth;
    bar.style.transition = `width ${ms}ms linear`;
    bar.style.width = '100%';
    timer = setTimeout(() => step(1), ms);
  };
  const show = () => {
    const p = photos[i];
    fill();
    img.src = p.url;
    blur.src = p.thumb;
    img.classList.remove('kb');
    void img.offsetWidth;
    img.classList.add('kb');
    date.textContent = fmtDay(p.day);
    cap.textContent = p.label || '';
    run(STORY_MS);
    if (photos[i + 1]) load(photos[i + 1].url); // подгрузить следующее заранее
  };
  const step = d => {
    if (i + d >= photos.length) return shut();
    i = Math.max(0, i + d);
    haptic.select();
    show();
  };
  const pause = () => {
    if (paused) return;
    paused = true;
    clearTimeout(timer);
    left = Math.max(300, left - (Date.now() - started));
    const bar = bars[i].firstChild;
    const w = getComputedStyle(bar).width;
    bar.style.transition = 'none';
    bar.style.width = w;
  };
  const resume = () => {
    if (!paused) return;
    paused = false;
    const bar = bars[i].firstChild;
    bar.style.transition = `width ${left}ms linear`;
    bar.style.width = '100%';
    started = Date.now();
    timer = setTimeout(() => step(1), left);
  };
  // долгое нажатие — пауза, короткий тап по краю — листание
  let downAt = 0;
  for (const [cls, d] of [['.prev', -1], ['.next', 1]]) {
    const zone = overlay.querySelector(cls);
    zone.addEventListener('pointerdown', () => { downAt = Date.now(); setTimeout(() => { if (downAt) pause(); }, 220); });
    zone.addEventListener('pointerup', () => {
      const long = Date.now() - downAt > 220;
      downAt = 0;
      if (long) resume(); else step(d);
    });
    zone.addEventListener('pointercancel', () => { downAt = 0; resume(); });
  }
  let release;
  const onKey = e => {
    if (e.key === 'Escape') shut();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  };
  const onHide = () => (document.hidden ? pause() : resume());
  function shut() {
    clearTimeout(timer);
    overlay.remove();
    release && release();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
  }
  close.addEventListener('click', shut);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHide);
  document.body.append(overlay);
  release = pushBack(shut);
  haptic.tap('medium');
  show();
}

// ---------- Цвета месяца: средний цвет каждого фото ----------
const colorCache = new Map();

async function photoColor(p) {
  if (colorCache.has(p.id)) return colorCache.get(p.id);
  const im = await load(p.thumb);
  let rgb = null;
  if (im) {
    try {
      const c = document.createElement('canvas');
      c.width = 12; c.height = 12;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(im, 0, 0, 12, 12);
      const d = ctx.getImageData(0, 0, 12, 12).data;
      // берём самые «живые» пиксели, а не серое среднее
      const px = [];
      for (let k = 0; k < d.length; k += 4) {
        const [r, g, b] = [d[k], d[k + 1], d[k + 2]];
        px.push({ r, g, b, s: Math.max(r, g, b) - Math.min(r, g, b) });
      }
      px.sort((a, b) => b.s - a.s);
      const top = px.slice(0, 40);
      rgb = ['r', 'g', 'b'].map(ch => Math.round(top.reduce((s, q) => s + q[ch], 0) / top.length));
    } catch (e) { rgb = null; }
  }
  colorCache.set(p.id, rgb);
  return rgb;
}

/** Полоска «цвета месяца»: заполняется, когда миниатюры загрузятся. */
export function monthPalette(list, monthIdx) {
  const strip = h('div', { class: 'memo-palette', 'aria-hidden': 'true' });
  const box = h('div', { class: 'memo-palette-box' },
    h('div', { class: 'memo-palette-title' }, `Цвета: ${MONTHS[monthIdx].toLowerCase()}`), strip);
  const sample = list.slice(0, 14);
  Promise.all(sample.map(photoColor)).then(colors => {
    const ok = colors.filter(Boolean);
    if (!ok.length) { box.remove(); return; }
    clear(strip);
    ok.sort((a, b) => hue(a) - hue(b));
    for (const [r, g, b] of ok) strip.append(h('span', { style: { background: `rgb(${r}, ${g}, ${b})` } }));
  });
  return box;
}

function hue([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let hh = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  hh *= 60;
  return hh < 0 ? hh + 360 : hh;
}

// ---------- Коллаж месяца 1080×1350 ----------
export async function monthCollageCard(monthKey, list) {
  await document.fonts.ready;
  const [y, m] = monthKey.split('-').map(Number);
  const pick = [...list.filter(p => p.target === 'quest'), ...list.filter(p => p.target !== 'quest')].slice(0, 6);
  const pics = await Promise.all(pick.map(p => load(p.url)));
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FDF7DE'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2C2A22'; ctx.font = '800 72px Unbounded, sans-serif';
  ctx.fillText(MONTHS[m - 1], 70, 140);
  ctx.fillStyle = '#B23C6C'; ctx.font = '800 40px Nunito, sans-serif';
  ctx.fillText(`${y} · ${list.length} фото`, 74, 200);
  // раскладки под число фото: [x, y, w, h] в долях поля 940×1000
  const L = {
    1: [[0, 0, 1, 1]],
    2: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
    3: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]],
    4: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
    5: [[0, 0, 0.6, 0.6], [0.6, 0, 0.4, 0.3], [0.6, 0.3, 0.4, 0.3], [0, 0.6, 0.5, 0.4], [0.5, 0.6, 0.5, 0.4]],
    6: [[0, 0, 0.5, 0.4], [0.5, 0, 0.5, 0.4], [0, 0.4, 0.34, 0.3], [0.34, 0.4, 0.33, 0.3], [0.67, 0.4, 0.33, 0.3], [0, 0.7, 1, 0.3]],
  }[Math.max(1, pics.filter(Boolean).length)];
  const fx = 70, fy = 250, fw = 940, fh = 1000, gap = 14;
  pics.filter(Boolean).forEach((pic, k) => {
    const [a, b, cw, ch] = L[k];
    const x = fx + a * fw + gap / 2, yy = fy + b * fh + gap / 2, w = cw * fw - gap, hh = ch * fh - gap;
    const k2 = Math.max(w / pic.width, hh / pic.height);
    const sw = w / k2, sh = hh / k2;
    ctx.save();
    roundRect(ctx, x, yy, w, hh, 28);
    ctx.clip();
    ctx.drawImage(pic, (pic.width - sw) / 2, Math.max(0, (pic.height - sh) * 0.35), sw, sh, x, yy, w, hh);
    ctx.restore();
  });
  ctx.fillStyle = '#B23C6C'; ctx.font = '800 34px Nunito, sans-serif';
  ctx.fillText('LIFEQUEST', 74, H - 40);
  return c.toDataURL('image/jpeg', 0.88);
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hgt, r); ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------- В этот день ----------
function shiftMonths(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Самое давнее «в этот день» среди: год, полгода, месяц, неделя назад. */
export function onThisDay(all, today) {
  const marks = [[shiftMonths(today, -12), 'Год назад'], [shiftMonths(today, -6), 'Полгода назад'],
    [shiftMonths(today, -1), 'Месяц назад'], [addDaysIso(today, -7), 'Неделю назад']];
  for (const [day, label] of marks) {
    const photos = all.filter(p => p.day === day);
    if (photos.length) return { day, label, photos };
  }
  return null;
}

/** Самая длинная серия дней подряд с фото (в списке дней 'YYYY-MM-DD'). */
export function longestStreak(days) {
  const sorted = [...new Set(days)].sort();
  let best = 0, run = 0, prev = null;
  for (const d of sorted) {
    run = prev && addDaysIso(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}
