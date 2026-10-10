// Применение стиля приложения: атрибут data-theme, цвета шапки Telegram и
// декоративные эффекты (цифровой дождь в «Матрице», фигурки тетриса в 8-bit, пузырьки в «Морском мире»,
// летучие мыши и тыквы в «Хэллоуине»).

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

// Хэллоуин: летучие мыши машут крыльями и пролетают по волнистой траектории,
// тыквы-фонарики медленно всплывают и покачиваются.
function pumpkinSprite(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const g = c.getContext('2d');
  const r = size * 0.62, cx = size, cy = size * 1.08;
  g.fillStyle = '#4C8A2A'; // хвостик
  g.fillRect(cx - size * 0.07, cy - r * 0.95 - size * 0.22, size * 0.14, size * 0.28);
  [[-0.42, 0.62, '#D9600F'], [0.42, 0.62, '#D9600F'], [0, 0.7, '#FF7A1A']].forEach(([dx, rx, color]) => {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(cx + dx * r, cy, rx * r, r * 0.78, 0, 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = '#FFD23F'; // светящееся лицо
  const tri = (x, y, w) => { g.beginPath(); g.moveTo(x - w, y + w * 0.7); g.lineTo(x + w, y + w * 0.7); g.lineTo(x, y - w * 0.7); g.fill(); };
  tri(cx - r * 0.33, cy - r * 0.2, r * 0.16);
  tri(cx + r * 0.33, cy - r * 0.2, r * 0.16);
  g.beginPath();
  g.moveTo(cx - r * 0.45, cy + r * 0.18);
  for (let i = 0; i <= 6; i++) g.lineTo(cx - r * 0.45 + i * r * 0.15, cy + r * (i % 2 ? 0.3 : 0.18));
  g.quadraticCurveTo(cx, cy + r * 0.62, cx - r * 0.45, cy + r * 0.18);
  g.fill();
  return c;
}

function halloweenSky() {
  let bats = [], pumpkins = [];
  const sprites = [22, 30, 40].map(pumpkinSprite);
  const newBat = (canvas, anywhere) => {
    const dir = Math.random() < 0.5 ? 1 : -1;
    return {
      x: anywhere ? Math.random() * canvas.width : (dir > 0 ? -40 : canvas.width + 40),
      y0: 30 + Math.random() * canvas.height * 0.75,
      dir, size: 9 + Math.random() * 10, speed: 1.2 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2, flap: Math.random() * Math.PI * 2,
    };
  };
  const newPumpkin = (canvas, anywhere) => ({
    x: 20 + Math.random() * (canvas.width - 40),
    y: anywhere ? Math.random() * canvas.height : canvas.height + 50,
    sprite: sprites[Math.floor(Math.random() * sprites.length)],
    speed: 0.25 + Math.random() * 0.35, phase: Math.random() * Math.PI * 2,
  });
  const drawBat = (ctx, b) => {
    const x = b.x, y = b.y0 + Math.sin(b.phase) * 18, s = b.size;
    const w = Math.sin(b.flap) * 0.9; // взмах: кончики крыльев вверх-вниз
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(b.dir, 1);
    ctx.fillStyle = '#6B4A8C';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-s * 0.9, -s * (0.2 + w), -s * 2, -s * w * 1.2);
    ctx.quadraticCurveTo(-s * 1.4, s * 0.1, -s * 1.1, s * 0.35);
    ctx.quadraticCurveTo(-s * 0.7, s * 0.05, -s * 0.35, s * 0.35);
    ctx.quadraticCurveTo(-s * 0.2, s * 0.1, 0, s * 0.3);
    ctx.quadraticCurveTo(s * 0.2, s * 0.1, s * 0.35, s * 0.35);
    ctx.quadraticCurveTo(s * 0.7, s * 0.05, s * 1.1, s * 0.35);
    ctx.quadraticCurveTo(s * 1.4, s * 0.1, s * 2, -s * w * 1.2);
    ctx.quadraticCurveTo(s * 0.9, -s * (0.2 + w), 0, 0);
    ctx.fill();
    ctx.beginPath(); // тельце с ушками
    ctx.ellipse(0, s * 0.1, s * 0.28, s * 0.42, 0, 0, Math.PI * 2);
    ctx.moveTo(-s * 0.22, -s * 0.2); ctx.lineTo(-s * 0.15, -s * 0.5); ctx.lineTo(-s * 0.02, -s * 0.25);
    ctx.moveTo(s * 0.22, -s * 0.2); ctx.lineTo(s * 0.15, -s * 0.5); ctx.lineTo(s * 0.02, -s * 0.25);
    ctx.fill();
    ctx.fillStyle = '#FF8A2A'; // глазки
    ctx.fillRect(-s * 0.14, -s * 0.02, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.04, -s * 0.02, s * 0.1, s * 0.1);
    ctx.restore();
  };
  return canvasLoop('halloween-sky', canvas => {
    const area = canvas.width * canvas.height;
    bats = Array.from({ length: Math.max(6, Math.round(area / 50000)) }, () => newBat(canvas, true));
    pumpkins = Array.from({ length: Math.max(4, Math.round(area / 90000)) }, () => newPumpkin(canvas, true));
  }, (canvas, ctx) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.65;
    pumpkins.forEach((p, i) => {
      p.y -= p.speed;
      p.phase += 0.03;
      if (p.y < -60) { pumpkins[i] = newPumpkin(canvas); return; }
      const half = p.sprite.width / 2;
      ctx.save();
      ctx.translate(p.x + Math.sin(p.phase) * 10, p.y);
      ctx.rotate(Math.sin(p.phase * 0.8) * 0.25);
      ctx.drawImage(p.sprite, -half, -half);
      ctx.restore();
    });
    ctx.globalAlpha = 0.85;
    bats.forEach((b, i) => {
      b.x += b.speed * b.dir;
      b.phase += 0.04;
      b.flap += 0.45;
      if (b.x < -60 || b.x > canvas.width + 60) { bats[i] = newBat(canvas); return; }
      drawBat(ctx, b);
    });
    ctx.globalAlpha = 1;
  }, 33);
}

const EFFECTS = { matrix: matrixRain, pixel: tetrisRain, ocean: oceanBubbles, halloween: halloweenSky };
