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
  ctx.fillText('выбирается из привычного', 90, 350);
  ctx.fillText('сценария', 90, 400);

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
