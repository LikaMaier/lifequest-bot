// Фото: сжатие перед загрузкой, лента превью с прогрессом, ленивые
// миниатюры, полноэкранный просмотр со свайпом и зумом, карточка «Поделиться».

import { h, clear, fmtDay } from './dom.js';
import { api, uploadPhoto } from './api.js';
import { haptic, tg, pushBack } from './tg.js';
import { store, refreshState } from './store.js';
import { mascotSVG } from './mascot.js';
import { celebrate } from './celebrate.js';
import { toast, toastError, sheet } from './ui.js';

const MAX_SIDE = 1280;
const PER_ITEM = 5;

/** Уменьшает фото до 1280px и JPEG 0.8. Ориентацию по EXIF применяет сам
 *  браузер при отрисовке (createImageBitmap с imageOrientation или <img>). */
export async function prepareImage(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Не получилось открыть фото'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width, hgt = source.height;
  const k = Math.min(1, MAX_SIDE / Math.max(w, hgt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(hgt * k);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Не получилось сжать фото'))), 'image/jpeg', 0.8));
}

// ---------- Ленивые миниатюры ----------
const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const e of entries) {
    if (e.isIntersecting) {
      const img = e.target;
      img.src = img.dataset.src;
      io.unobserve(img);
    }
  }
}, { rootMargin: '200px' }) : null;

export function lazyThumb(photo, alt = '') {
  const img = h('img', { class: 'thumb-img', alt: alt || photo.label || 'Фото', decoding: 'async', loading: 'lazy' });
  img.dataset.src = photo.thumb;
  if (io) io.observe(img); else img.src = photo.thumb;
  return img;
}

export const photosEnabled = () => Boolean(store.state && store.state.photos && store.state.photos.enabled);

/** Лента фото элемента (задание / план / день / клетка карты) с добавлением. */
export function photoStrip(target, { title = 'Фото', onChange } = {}) {
  const box = h('div', { class: 'photo-strip-box' });
  if (!photosEnabled()) {
    box.append(h('p', { class: 'tiny muted bold' }, '📷 Фото пока недоступны'));
    return box;
  }
  const strip = h('div', { class: 'photo-strip', role: 'list', 'aria-label': title });
  let items = [];
  const filters = { ...target };
  const filterParams = { target: target.target, quest_history_id: target.quest_history_id, plan_id: target.plan_id,
    plan_date: target.plan_date, day: target.target === 'day' ? target.day : undefined, board_cell: target.board_cell };

  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const gallery = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const addCam = h('button', { type: 'button', class: 'photo-add', 'aria-label': 'Сделать фото' }, '📷', h('span', null, 'Камера'));
  const addGal = h('button', { type: 'button', class: 'photo-add', 'aria-label': 'Выбрать фото из галереи' }, '🖼️', h('span', null, 'Галерея'));
  addCam.addEventListener('click', () => { haptic.tap(); camera.click(); });
  addGal.addEventListener('click', () => { haptic.tap(); gallery.click(); });

  const draw = () => {
    clear(strip);
    items.forEach((p, i) => {
      const b = h('button', { type: 'button', class: 'photo-thumb', role: 'listitem', 'aria-label': `Открыть фото ${i + 1}` }, lazyThumb(p));
      b.addEventListener('click', () => { haptic.tap(); openViewer(items, i, { onDelete: id => { items = items.filter(x => x.id !== id); draw(); onChange && onChange(items); } }); });
      strip.append(b);
    });
    if (items.length < PER_ITEM) strip.append(addCam, addGal);
  };

  const upload = async files => {
    for (const file of [...files].slice(0, PER_ITEM - items.length)) {
      const preview = h('div', { class: 'photo-thumb uploading', role: 'status', 'aria-label': 'Загружается фото' });
      const bar = h('span', { class: 'photo-progress' });
      preview.append(bar);
      strip.insertBefore(preview, addCam.isConnected ? addCam : null);
      try {
        const blob = await prepareImage(file);
        preview.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
        const res = await uploadPhoto(blob, filters, f => { bar.style.width = `${Math.round(f * 100)}%`; });
        items = [res.photo, ...items];
        haptic.success();
        refreshState().catch(() => {});
        if ((res.new_achievements || []).length) celebrate(res);
      } catch (e) {
        toastError(e);
      }
      preview.remove();
      draw();
      onChange && onChange(items);
    }
  };
  camera.addEventListener('change', () => { if (camera.files.length) upload(camera.files); camera.value = ''; });
  gallery.addEventListener('change', () => { if (gallery.files.length) upload(gallery.files); gallery.value = ''; });

  box.append(strip, camera, gallery);
  draw();
  api.photos(filterParams).then(res => { items = res.photos; draw(); }).catch(() => {});
  return box;
}

// ---------- Полноэкранный просмотр ----------
export function openViewer(list, index, { onDelete } = {}) {
  let i = index;
  const img = h('img', { class: 'viewer-img', alt: '' });
  const caption = h('div', { class: 'viewer-caption' });
  const counter = h('div', { class: 'viewer-counter tiny bold' });
  const stage = h('div', { class: 'viewer-stage' }, img);
  const close = h('button', { type: 'button', class: 'viewer-btn', 'aria-label': 'Закрыть' }, '✕');
  const download = h('button', { type: 'button', class: 'viewer-btn', 'aria-label': 'Скачать' }, '⬇︎');
  const share = h('button', { type: 'button', class: 'viewer-btn', 'aria-label': 'Поделиться' }, '↗︎');
  const del = h('button', { type: 'button', class: 'viewer-btn', 'aria-label': 'Удалить фото' }, '🗑');
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Просмотр фото' },
    h('div', { class: 'viewer-top' }, counter, h('div', { class: 'row', style: { gap: '8px' } }, download, share, del, close)),
    stage, caption);

  // зум: щипок двумя пальцами и двойной тап; свайп — листание
  let scale = 1, tx = 0, ty = 0;
  const pts = new Map();
  let startDist = 0, startScale = 1, swipeX = null, lastTap = 0, panStart = null;
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const reset = () => { scale = 1; tx = 0; ty = 0; apply(); };
  const show = () => {
    const p = list[i];
    reset();
    img.src = p.url;
    img.alt = p.label || 'Фото';
    caption.textContent = [p.label, fmtDay(p.day)].filter(Boolean).join(' · ');
    counter.textContent = `${i + 1} / ${list.length}`;
  };
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      startDist = Math.hypot(a.x - b.x, a.y - b.y);
      startScale = scale;
      swipeX = null;
    } else {
      swipeX = scale === 1 ? e.clientX : null;
      panStart = { x: e.clientX - tx, y: e.clientY - ty };
      const now = Date.now();
      if (now - lastTap < 280) { scale = scale > 1 ? 1 : 2.5; tx = ty = 0; apply(); }
      lastTap = now;
    }
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      scale = Math.min(4, Math.max(1, startScale * Math.hypot(a.x - b.x, a.y - b.y) / startDist));
      apply();
    } else if (scale > 1 && panStart) {
      tx = e.clientX - panStart.x; ty = e.clientY - panStart.y; apply();
    }
  });
  const up = e => {
    pts.delete(e.pointerId);
    if (swipeX !== null && pts.size === 0 && scale === 1) {
      const dx = e.clientX - swipeX;
      if (Math.abs(dx) > 60 && list.length > 1) { i = (i + (dx < 0 ? 1 : -1) + list.length) % list.length; haptic.select(); show(); }
    }
    swipeX = null;
    if (scale <= 1.02) reset();
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  let release;
  const shut = () => { overlay.remove(); release && release(); document.removeEventListener('keydown', onKey); };
  const onKey = e => {
    if (e.key === 'Escape') shut();
    if (e.key === 'ArrowRight') { i = (i + 1) % list.length; show(); }
    if (e.key === 'ArrowLeft') { i = (i - 1 + list.length) % list.length; show(); }
  };
  close.addEventListener('click', shut);
  download.addEventListener('click', () => {
    haptic.tap();
    const url = new URL(list[i].url, location.href).href;
    if (tg && tg.downloadFile) {
      try { tg.downloadFile({ url, file_name: `lifequest-${list[i].day}.jpg` }); return; } catch (e) { /* старый клиент */ }
    }
    if (tg && tg.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener');
  });
  share.addEventListener('click', async () => {
    haptic.tap();
    share.disabled = true;
    try {
      const image = await photoShareCard(list[i]);
      await api.share(image);
      haptic.success();
      toast('📬 Карточка с фото уже в чате с ботом — перешли друзьям!', 'good', 3200);
    } catch (e) { toastError(e); }
    share.disabled = false;
  });
  let armed = false;
  del.addEventListener('click', async () => {
    if (!armed) { armed = true; haptic.warning(); toast('Нажми 🗑 ещё раз, чтобы удалить фото'); setTimeout(() => { armed = false; }, 3000); return; }
    try {
      const p = list[i];
      await api.deletePhoto(p.id);
      haptic.success();
      toast('Фото удалено');
      list.splice(i, 1);
      onDelete && onDelete(p.id);
      refreshState().catch(() => {});
      if (!list.length) return shut();
      i = Math.min(i, list.length - 1);
      show();
    } catch (e) { toastError(e); }
    armed = false;
  });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  release = pushBack(shut);
  show();
}

/** Карточка 1080×1350: фото в «стикерной» рамке, подпись и маскот. */
export async function photoShareCard(photo) {
  await document.fonts.ready;
  const load = src => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = src; });
  const pic = await load(photo.url);
  const kind = (store.state && store.state.user.mascot) || 'cat-purple';
  const pet = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(mascotSVG(kind, 'love').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" '))}`);
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FDF7DE'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#F8EDAD';
  ctx.beginPath(); ctx.moveTo(0, 1150); ctx.bezierCurveTo(360, 1060, 700, 1260, 1080, 1120); ctx.lineTo(1080, 1350); ctx.lineTo(0, 1350); ctx.fill();
  // рамка-«полароид» с жёсткой тенью
  const fx = 90, fy = 90, fw = 900, fh = 900;
  ctx.save(); ctx.translate(W / 2, fy + fh / 2); ctx.rotate(-0.025); ctx.translate(-W / 2, -(fy + fh / 2));
  ctx.fillStyle = '#B23C6C'; roundRect(ctx, fx, fy + 16, fw, fh + 120, 40); ctx.fill();
  ctx.fillStyle = '#FFFDF5'; roundRect(ctx, fx, fy, fw, fh + 120, 40); ctx.fill();
  const k = Math.max((fw - 60) / pic.width, (fh - 60) / pic.height);
  const sw = (fw - 60) / k, sh = (fh - 60) / k;
  ctx.save(); roundRect(ctx, fx + 30, fy + 30, fw - 60, fh - 60, 24); ctx.clip();
  ctx.drawImage(pic, (pic.width - sw) / 2, (pic.height - sh) / 2, sw, sh, fx + 30, fy + 30, fw - 60, fh - 60);
  ctx.restore();
  ctx.fillStyle = '#2C2A22'; ctx.font = '800 40px Unbounded, sans-serif';
  ctx.fillText(trim(ctx, photo.label || 'Моё приключение', fw - 80), fx + 40, fy + fh + 60);
  ctx.restore();
  ctx.drawImage(pet, 800, 1030, 220, 220);
  ctx.fillStyle = '#6E6850'; ctx.font = '700 40px Nunito, sans-serif';
  ctx.fillText(fmtDay(photo.day), 90, 1200);
  ctx.fillStyle = '#B23C6C'; ctx.font = '800 36px Nunito, sans-serif';
  ctx.fillText('LIFEQUEST', 90, 1270);
  return c.toDataURL('image/jpeg', 0.88);
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hgt, r); ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function trim(ctx, text, max) {
  let t = text;
  while (ctx.measureText(t).width > max && t.length > 3) t = `${t.slice(0, -2)}…`;
  return t;
}

/** Лист «фото-отчёт» к выполненному заданию. */
export function openPhotoReport(historyId, title, { intro = false } = {}) {
  if (!photosEnabled() || !historyId) return null;
  const close = h('button', { type: 'button', class: 'btn ghost block' }, intro ? 'Не сейчас' : 'Готово');
  const s = sheet(h('div', { class: 'stack' },
    h('h2', null, intro ? '📷 Сохраним воспоминание?' : '📷 Фото-отчёт'),
    h('p', { class: 'muted bold' }, intro ? `«${title}» выполнено! Добавь фото — оно появится в альбоме.` : title),
    photoStrip({ target: 'quest', quest_history_id: historyId }, { title: 'Фото-отчёт' }), close), { label: 'Фото-отчёт' });
  close.addEventListener('click', () => s.close());
  return s;
}
