// Общие компоненты интерфейса.

import { h, svgEl, clear } from './dom.js';
import { haptic, pushBack } from './tg.js';
import { mascot } from './mascot.js';
import { ICONS } from './icons.js';

// ---------- Цвета сфер и режимов (одни и те же везде) ----------
export const MODE_INFO = {
  solo: { label: 'Для себя', short: 'Для себя', emoji: '🎯', color: 'purple', sub: 'приключение для себя' },
  pair: { label: 'Для двоих', short: 'Вдвоём', emoji: '💞', color: 'pink', sub: 'задание на двоих' },
  company: { label: 'Для компании', short: 'Компания', emoji: '👥', color: 'orange', sub: 'авантюра с друзьями' },
};
export const SPHERE_INFO = {
  'Дисциплина': { color: 'blue', emoji: '🛡️' },
  'Энергия': { color: 'lime', emoji: '🔋' },
  'Саморазвитие': { color: 'yellow', emoji: '📚' },
  'Смелость': { color: 'red', emoji: '🦁' },
  'Приключения': { color: 'lav', emoji: '🧭' },
  'Творчество': { color: 'pink', emoji: '🎨' },
};
export const colorOf = q => (q.sphere && SPHERE_INFO[q.sphere] ? SPHERE_INFO[q.sphere].color : (MODE_INFO[q.mode] || MODE_INFO.solo).color);
export const TIER_LABEL = { easy: 'Полегче', medium: 'Посложнее' };

// ---------- Тосты ----------
let toastHost;
export function toast(text, kind = '', ms = 2600) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast ${kind}` }, text);
  toastHost.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}
export function toastError(err) {
  haptic.error();
  toast(err && err.message ? err.message : 'Что-то пошло не так', 'bad', 3200);
}

// ---------- Защита от двойного нажатия ----------
/** Кнопка становится неактивной, пока выполняется async-действие. */
export function busy(btn, fn) {
  return async (...args) => {
    if (btn.classList.contains('busy') || btn.disabled) return;
    btn.classList.add('busy');
    btn.disabled = true;
    try { return await fn(...args); }
    finally { btn.classList.remove('busy'); btn.disabled = false; }
  };
}

export function button(text, { cls = '', color, onClick, label, icon } = {}) {
  const b = h('button', { type: 'button', class: `btn ${cls} ${color ? `colored c-${color}` : ''}`, 'aria-label': label },
    icon ? svgEl(icon) : null, text);
  if (onClick) b.addEventListener('click', busy(b, async e => { haptic.tap(); await onClick(e); }));
  return b;
}

// ---------- Нижний лист и модалка ----------
export function sheet(content, { onClose, label = 'Окно' } = {}) {
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
    h('div', { class: 'grabber', 'aria-hidden': 'true' }), content);
  const overlay = h('div', { class: 'overlay' }, panel);
  let releaseBack;
  const close = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    releaseBack && releaseBack();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  releaseBack = pushBack(close);
  setTimeout(() => { const f = panel.querySelector('button, [tabindex]'); f && f.focus({ preventScroll: true }); }, 50);
  return { close, panel, setContent(node) { clear(panel); panel.append(h('div', { class: 'grabber', 'aria-hidden': 'true' }), node); } };
}

export function modal(content, { label = 'Сообщение' } = {}) {
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, content);
  const overlay = h('div', { class: 'overlay center' }, box);
  let release;
  const done = new Promise(resolve => {
    const close = () => { overlay.remove(); release && release(); resolve(); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    box.addEventListener('lq-close', close);
    release = pushBack(close);
  });
  document.body.append(overlay);
  setTimeout(() => { const f = box.querySelector('button'); f && f.focus({ preventScroll: true }); }, 50);
  return { done, close: () => box.dispatchEvent(new Event('lq-close')) };
}

// ---------- Кольцо прогресса ----------
export function ring(value, max, { color = 'pink', size = 168, stroke = 16, label, caption } = {}) {
  const r = (100 - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  const wrapEl = h('div', { class: `ring-wrap c-${color}`, style: { width: `${size}px`, height: `${size}px` }, role: 'img',
    'aria-label': label || `${value} из ${max}` });
  wrapEl.append(svgEl(`<svg viewBox="0 0 100 100" aria-hidden="true">
    <circle class="ring-track" cx="50" cy="50" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="ring-bar" cx="50" cy="50" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/></svg>`));
  const center = h('div', { class: 'ring-center' }, h('div', { class: 'num' }, `${value}/${max}`), caption ? h('div', { class: 'cap' }, caption) : null);
  wrapEl.append(center);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const bar = wrapEl.querySelector('.ring-bar');
    if (bar) bar.style.strokeDashoffset = String(circ * (1 - frac));
  }));
  return wrapEl;
}

export function progressBar(frac, color) {
  const fill = h('span');
  const el = h('div', { class: `bar ${color ? `c-${color}` : ''}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
    'aria-valuenow': String(Math.round(frac * 100)) }, fill);
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; }));
  return el;
}

// ---------- Пустые состояния и скелетоны ----------
export function emptyState(text, { kind = 'cat-lav', expr = 'wink', action } = {}) {
  return h('div', { class: 'empty' }, mascot(kind, expr, { size: 84 }), h('p', null, text), action || null);
}
export function skeleton(height = 80, extra = {}) {
  return h('div', { class: 'skeleton', style: { height: `${height}px`, ...extra }, 'aria-hidden': 'true' });
}
export function sectionTitle(text, action) {
  return h('div', { class: 'section-title' }, h('h2', null, text), action || null);
}

export function iconButton(icon, label, onClick, cls = '') {
  const b = h('button', { type: 'button', class: `icon-btn ${cls}`, 'aria-label': label, html: icon });
  if (onClick) b.addEventListener('click', e => { haptic.tap(); onClick(e, b); });
  return b;
}

export { ICONS };

// ---------- Конфетти (canvas, без библиотек) ----------
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function confetti(amount = 120) {
  if (reduceMotion()) return;
  const canvas = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  document.body.append(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.width = window.innerWidth * dpr;
  const H = canvas.height = window.innerHeight * dpr;
  const ctx = canvas.getContext('2d');
  const colors = ['#F3619C', '#DBFA40', '#93ABD8', '#EDE986', '#B494F8', '#ED7C30', '#FB4645', '#E7BEF8'];
  const parts = Array.from({ length: amount }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35,
    vx: (Math.random() - 0.5) * 18 * dpr, vy: (-Math.random() * 16 - 6) * dpr,
    s: (5 + Math.random() * 7) * dpr, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)], round: Math.random() < 0.3,
  }));
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.45 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66);
      ctx.restore();
    }
    if (t - start < 2600) requestAnimationFrame(frame); else canvas.remove();
  })(start);
}
