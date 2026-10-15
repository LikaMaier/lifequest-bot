// Карточка «Поделиться достижением»: рисуется на canvas (1080×1350, формат
// поста/сторис), отправляется боту — он присылает картинку в чат.

import { mascotSVG } from './mascot.js';

function loadSvg(markup) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" '))}`;
  });
}

function roundRect(ctx, x, y, w, hgt, r, fill, shadow) {
  if (shadow) { ctx.fillStyle = shadow; ctx.beginPath(); ctx.roundRect(x, y + 14, w, hgt, r); ctx.fill(); }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, hgt, r);
  ctx.fill();
}

function fitText(ctx, text, maxWidth, size, weight = 800, family = 'Unbounded') {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}, sans-serif`; s -= 2; } while (ctx.measureText(text).width > maxWidth && s > 20);
}

export async function buildShareCard(state) {
  await document.fonts.ready;
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx.roundRect) {
    ctx.roundRect = function (x, y, w, hgt, r) { this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + hgt, r); this.arcTo(x + w, y + hgt, x, y + hgt, r); this.arcTo(x, y + hgt, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); };
  }

  // фон с «волнами»
  ctx.fillStyle = '#FDF7DE'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#F8EDAD';
  ctx.beginPath(); ctx.moveTo(0, 220); ctx.bezierCurveTo(300, 120, 650, 340, 1080, 180); ctx.lineTo(1080, 0); ctx.lineTo(0, 0); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 1180); ctx.bezierCurveTo(360, 1080, 700, 1290, 1080, 1150); ctx.lineTo(1080, 1350); ctx.lineTo(0, 1350); ctx.fill();

  ctx.fillStyle = '#B23C6C';
  ctx.font = '800 38px Nunito, sans-serif';
  ctx.fillText('LIFEQUEST', 90, 120);

  const pet = await loadSvg(mascotSVG(state.user.mascot, 'love'));
  ctx.drawImage(pet, 640, 120, 360, 340);

  ctx.fillStyle = '#2C2A22';
  fitText(ctx, state.user.first_name || 'Я', 520, 92);
  ctx.fillText(state.user.first_name || 'Я', 90, 280);
  ctx.font = '700 42px Nunito, sans-serif';
  ctx.fillStyle = '#6E6850';
  ctx.fillText('твой путь к победе', 90, 350);

  // уровень
  roundRect(ctx, 90, 500, 900, 230, 56, '#B494F8', '#6B4B9E');
  ctx.fillStyle = '#6B4B9E'; ctx.font = '800 36px Nunito, sans-serif';
  ctx.fillText(`УРОВЕНЬ ${state.level.level}`, 140, 580);
  ctx.fillStyle = '#2C2A22'; fitText(ctx, state.level.name, 800, 68);
  ctx.fillText(state.level.name, 140, 665);
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.roundRect(140, 690, 800, 18, 9); ctx.fill();
  ctx.fillStyle = '#6B4B9E'; ctx.beginPath(); ctx.roundRect(140, 690, Math.max(18, 800 * state.level.progress), 18, 9); ctx.fill();

  // три метрики
  const tiles = [
    { color: '#ED7C30', deep: '#A2531D', value: String(state.streak.best), label: 'лучшая серия' },
    { color: '#DBFA40', deep: '#7C9414', value: String(state.level.xp), label: 'XP всего' },
    { color: '#F3619C', deep: '#B23C6C', value: String(state.badges.unlocked), label: 'ачивок' },
  ];
  tiles.forEach((t, i) => {
    const x = 90 + i * 310;
    roundRect(ctx, x, 800, 280, 250, 48, t.color, t.deep);
    ctx.fillStyle = '#2C2A22';
    fitText(ctx, t.value, 220, 92);
    ctx.fillText(t.value, x + 36, 940);
    ctx.font = '800 32px Nunito, sans-serif';
    ctx.fillText(t.label, x + 36, 1000);
  });

  ctx.fillStyle = '#2C2A22';
  ctx.font = '800 40px Nunito, sans-serif';
  ctx.fillText(state.bot_username ? `@${state.bot_username}` : 'LifeQuest в Telegram', 90, 1250);
  return canvas.toDataURL('image/png');
}

const SPHERE_EMOJI = { 'Дисциплина': '🛡️', 'Энергия': '🔋', 'Саморазвитие': '📚', 'Смелость': '🦁', 'Приключения': '🧭', 'Творчество': '🎨' };

/** Карточка «Мой октябрь / Мой 2026 в LifeQuest» (1080×1920, формат сторис). */
export async function buildRecapCard(r, state) {
  await document.fonts.ready;
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx.roundRect) {
    ctx.roundRect = function (x, y, w, hgt, rad) { this.moveTo(x + rad, y); this.arcTo(x + w, y, x + w, y + hgt, rad); this.arcTo(x + w, y + hgt, x, y + hgt, rad); this.arcTo(x, y + hgt, x, y, rad); this.arcTo(x, y, x + w, y, rad); this.closePath(); };
  }
  const year = r.period === 'year';
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, year ? '#2B1660' : '#FDF7DE');
  grad.addColorStop(1, year ? '#0B0820' : '#F8EDAD');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  if (year) { // звёзды
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`;
      ctx.beginPath(); ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  const ink = year ? '#EEE9FF' : '#2C2A22';
  const soft = year ? '#C9C0F2' : '#6E6850';

  ctx.fillStyle = year ? '#FF5FD2' : '#B23C6C';
  ctx.font = '800 40px Nunito, sans-serif';
  ctx.fillText('LIFEQUEST', 90, 140);
  ctx.fillStyle = ink;
  const title = year ? `Мой ${r.label}` : `Мой ${r.label}`;
  fitText(ctx, title, 900, 120);
  ctx.fillText(title, 90, 290);
  ctx.font = '700 46px Nunito, sans-serif';
  ctx.fillStyle = soft;
  ctx.fillText(r.first_name ? `${r.first_name} в LifeQuest` : 'в LifeQuest', 90, 360);

  const pet = await loadSvg(mascotSVG(r.mascot, 'love', r.accessory));
  ctx.drawImage(pet, 560, 380, 440, 420);

  // большое число
  ctx.fillStyle = ink;
  ctx.font = '800 240px Unbounded, sans-serif';
  ctx.fillText(String(r.quests), 90, 700);
  ctx.font = '800 50px Nunito, sans-serif';
  ctx.fillText(plural(r.quests, 'приключение', 'приключения', 'приключений'), 96, 780);

  const tiles = [
    { color: '#ED7C30', deep: '#A2531D', value: String(r.active_days), label: plural(r.active_days, 'активный день', 'активных дня', 'активных дней') },
    { color: '#DBFA40', deep: '#7C9414', value: String(r.longest_run), label: 'дней подряд' },
    { color: '#B494F8', deep: '#6B4B9E', value: `${r.xp}`, label: 'XP заработано' },
    { color: '#F3619C', deep: '#B23C6C', value: r.top_sphere ? (SPHERE_EMOJI[r.top_sphere] || '⭐') : '🌱', label: r.top_sphere ? `любимое: ${r.top_sphere}` : 'всё впереди' },
  ];
  tiles.forEach((t, i) => {
    const x = 90 + (i % 2) * 460, y = 880 + Math.floor(i / 2) * 330;
    roundRect(ctx, x, y, 440, 300, 52, t.color, t.deep);
    ctx.fillStyle = '#2C2A22';
    fitText(ctx, t.value, 360, 110);
    ctx.fillText(t.value, x + 40, y + 160);
    ctx.font = '800 34px Nunito, sans-serif';
    ctx.fillText(t.label, x + 40, y + 240);
  });

  if (r.highlight) {
    roundRect(ctx, 90, 1580, 900, 150, 44, year ? 'rgba(255,255,255,.12)' : '#FFFFFF', null);
    ctx.fillStyle = soft; ctx.font = '800 30px Nunito, sans-serif';
    ctx.fillText('ПОСЛЕДНИЙ КВЕСТ', 130, 1635);
    ctx.fillStyle = ink; fitText(ctx, `«${r.highlight}»`, 820, 46, 800, 'Nunito');
    ctx.fillText(`«${r.highlight}»`, 130, 1700);
  }
  ctx.fillStyle = ink;
  ctx.font = '800 40px Nunito, sans-serif';
  ctx.fillText(state.bot_username ? `@${state.bot_username}` : 'LifeQuest в Telegram', 90, 1840);
  return canvas.toDataURL('image/jpeg', 0.92); // сторис-формат в PNG бывает тяжёлым
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
