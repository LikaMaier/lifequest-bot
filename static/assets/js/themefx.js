// Применение стиля приложения: атрибут data-theme, цвета шапки Telegram и
// декоративные эффекты (цифровой дождь в «Матрице»).

import { tg } from './tg.js';

let rain = null;
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function applyTheme(theme) {
  const root = document.documentElement;
  if (root.dataset.theme === theme && (theme !== 'matrix' || rain)) return;
  root.dataset.theme = theme;
  // Шапку и фон Telegram красим в фон стиля.
  const bg = getComputedStyle(root).getPropertyValue('--cream').trim() || '#FDF7DE';
  try {
    if (tg && tg.setHeaderColor) tg.setHeaderColor(bg);
    if (tg && tg.setBackgroundColor) tg.setBackgroundColor(bg);
    if (tg && tg.setBottomBarColor) tg.setBottomBarColor(bg);
  } catch (e) { /* старые клиенты */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', bg);
  if (theme === 'matrix' && !reduceMotion()) startRain(); else stopRain();
}

function startRain() {
  if (rain) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'matrix-rain';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const chars = 'アカサタナハマヤラワ0123456789ЛАЙФКВЕСТ+*<>';
  let cols = [], size = 16, raf = 0, last = 0;
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = Array.from({ length: Math.ceil(canvas.width / size) }, () => Math.random() * -50);
  };
  resize();
  window.addEventListener('resize', resize);
  const frame = t => {
    raf = requestAnimationFrame(frame);
    if (t - last < 70) return; // ~14 кадров в секунду — экономим батарею
    last = t;
    ctx.fillStyle = 'rgba(2, 10, 4, 0.18)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00FF66';
    ctx.font = `${size}px "JetBrains Mono", monospace`;
    cols.forEach((y, i) => {
      ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * size, y * size);
      cols[i] = y * size > canvas.height && Math.random() > 0.975 ? 0 : y + 1;
    });
  };
  raf = requestAnimationFrame(frame);
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else raf = requestAnimationFrame(frame); };
  document.addEventListener('visibilitychange', onVis);
  rain = { stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis); canvas.remove(); } };
}

function stopRain() {
  if (rain) { rain.stop(); rain = null; }
}
