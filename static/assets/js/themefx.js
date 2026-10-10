// Применение стиля приложения: атрибут data-theme, цвета шапки Telegram и
// декоративные эффекты (цифровой дождь в «Матрице», фигурки тетриса в 8-bit, пузырьки в «Морском мире»).

import { tg } from './tg.js';

let fx = null; // { theme, stop() } — текущий фоновый эффект
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function applyTheme(theme) {
  const root = document.documentElement;
  if (root.dataset.theme === theme && (!EFFECTS[theme] || (fx && fx.theme === theme))) return;
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
  if (fx && fx.theme !== theme) { fx.stop(); fx = null; }
  if (!fx && EFFECTS[theme] && !reduceMotion()) fx = { theme, ...EFFECTS[theme]() };
}

/** Общая обвязка: холст на весь экран под контентом, ~14 кадров в секунду, пауза в фоне. */
function canvasLoop(className, onResize, onFrame, interval = 70) {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let raf = 0, last = 0;
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    onResize(canvas, ctx);
  };
  resize();
  window.addEventListener('resize', resize);
  const frame = t => {
    raf = requestAnimationFrame(frame);
    if (t - last < interval) return;
    last = t;
    onFrame(canvas, ctx);
  };
  raf = requestAnimationFrame(frame);
  const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); };
  document.addEventListener('visibilitychange', onVis);
  return {
    stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
      canvas.remove();
    },
  };
}

function matrixRain() {
  const chars = 'アカサタナハマヤラワ0123456789ЛАЙФКВЕСТ+*<>';
  const size = 16;
  let cols = [];
  return canvasLoop('matrix-rain', canvas => {
    cols = Array.from({ length: Math.ceil(canvas.width / size) }, () => Math.random() * -50);
  }, (canvas, ctx) => {
    ctx.fillStyle = 'rgba(2, 10, 4, 0.18)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00FF66';
    ctx.font = `${size}px "JetBrains Mono", monospace`;
    cols.forEach((y, i) => {
      ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * size, y * size);
      cols[i] = y * size > canvas.height && Math.random() > 0.975 ? 0 : y + 1;
    });
  });
}

// Тетрис: разноцветные фигурки падают по клеткам и иногда поворачиваются.
const TETROMINOES = [
  [[0, 0], [1, 0], [2, 0], [3, 0]],         // I
  [[0, 0], [1, 0], [0, 1], [1, 1]],         // O
  [[0, 0], [1, 0], [2, 0], [1, 1]],         // T
  [[1, 0], [2, 0], [0, 1], [1, 1]],         // S
  [[0, 0], [1, 0], [1, 1], [2, 1]],         // Z
  [[0, 0], [0, 1], [1, 1], [2, 1]],         // J
  [[2, 0], [0, 1], [1, 1], [2, 1]],         // L
];
const TETRIS_COLORS = ['#4D6BFF', '#00E0EB', '#FF2E84', '#FF9500', '#8A5CFF', '#FFD12E'];

function tetrisRain() {
  const cell = 14;
  let pieces = [], cols = 0, rows = 0;
  const spawn = (y = -4 - Math.floor(Math.random() * 20)) => ({
    shape: TETROMINOES[Math.floor(Math.random() * TETROMINOES.length)].map(p => [...p]),
    color: TETRIS_COLORS[Math.floor(Math.random() * TETRIS_COLORS.length)],
    x: Math.floor(Math.random() * Math.max(1, cols - 3)),
    y,
    every: 2 + Math.floor(Math.random() * 3), // скорость: шаг раз в 2–4 кадра
    tick: 0,
  });
  const rotate = shape => {
    const r = shape.map(([x, y]) => [-y, x]);
    const minX = Math.min(...r.map(p => p[0])), minY = Math.min(...r.map(p => p[1]));
    return r.map(([x, y]) => [x - minX, y - minY]);
  };
  const block = (ctx, x, y, color) => {
    const px = x * cell, py = y * cell;
    ctx.fillStyle = color;
    ctx.fillRect(px, py, cell, cell);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; // блик сверху-слева, как в 8-bit
    ctx.fillRect(px, py, cell, 3);
    ctx.fillRect(px, py, 3, cell);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(px, py + cell - 3, cell, 3);
    ctx.fillRect(px + cell - 3, py, 3, cell);
  };
  return canvasLoop('tetris-rain', canvas => {
    cols = Math.ceil(canvas.width / cell);
    rows = Math.ceil(canvas.height / cell);
    const count = Math.max(8, Math.round(cols / 2.5));
    pieces = Array.from({ length: count }, () => spawn(Math.floor(Math.random() * rows) - 4));
  }, (canvas, ctx) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((p, i) => {
      if (++p.tick >= p.every) {
        p.tick = 0;
        p.y += 1;
        if (Math.random() < 0.08) p.shape = rotate(p.shape);
      }
      if (p.y > rows) { pieces[i] = spawn(); return; }
      for (const [dx, dy] of p.shape) block(ctx, p.x + dx, p.y + dy, p.color);
    });
  });
}

// Морской мир: пузырьки поднимаются со дна, покачиваясь, и лопаются у поверхности.
function oceanBubbles() {
  let bubbles = [];
  const spawn = (canvas, y) => ({
    x: Math.random() * canvas.width,
    y: y ?? canvas.height + 10 + Math.random() * 60,
    r: 2 + Math.random() * Math.random() * 11,
    speed: 0.5 + Math.random() * 1.3,
    phase: Math.random() * Math.PI * 2,
    sway: 0.4 + Math.random() * 1.2,
  });
  return canvasLoop('ocean-bubbles', canvas => {
    const count = Math.max(18, Math.round(canvas.width * canvas.height / 16000));
    bubbles = Array.from({ length: count }, () => spawn(canvas, Math.random() * canvas.height));
  }, (canvas, ctx) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    bubbles.forEach((b, i) => {
      b.y -= b.speed * (1 + b.r / 12);
      b.phase += 0.05;
      const x = b.x + Math.sin(b.phase) * b.sway * 3;
      if (b.y < -20) { bubbles[i] = spawn(canvas); return; }
      // к поверхности пузырёк чуть тает
      const alpha = Math.min(1, b.y / (canvas.height * 0.25));
      ctx.globalAlpha = 0.85 * alpha;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.stroke();
      ctx.beginPath(); // блик
      ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, Math.max(0.8, b.r * 0.25), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }, 33);
}

const EFFECTS = { matrix: matrixRain, pixel: tetrisRain, ocean: oceanBubbles };
