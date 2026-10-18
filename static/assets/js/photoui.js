// Фото: сжатие перед загрузкой, лента превью с прогрессом, ленивые
// миниатюры, полноэкранный просмотр со свайпом и зумом, карточка «Поделиться».

import { h, clear, fmtDay, plural } from './dom.js';
import { api, uploadPhoto } from './api.js';
import { handlePremiumError } from './premium.js';
import { haptic, tg, pushBack } from './tg.js';
import { store, refreshState } from './store.js';
import { mascotSVG } from './mascot.js';
import { celebrate } from './celebrate.js';
import { toast, toastError, sheet, busy } from './ui.js';

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

// ---------- Доска воспоминаний: полароиды на скотче и кнопках ----------
function hashOf(str) {
  let x = 0;
  for (const c of String(str)) x = (x * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(x);
}

const SHORT_DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

/** Один полароид: белая рамка, подпись от руки, лёгкий наклон, скотч или кнопка. */
export function polaroid(photo, { onOpen, small = false, caption } = {}) {
  const n = hashOf(photo.id);
  const tilt = ((n % 9) - 4) * (small ? 1.6 : 1.2); // −6…+6°, у каждого фото свой и не меняется
  const deco = n % 3 === 0 ? 'pin' : 'tape';
  const text = caption !== undefined ? caption : (photo.label || SHORT_DAY.format(new Date(`${photo.day}T12:00:00`)));
  const b = h('button', { type: 'button', class: `polaroid ${small ? 'small' : ''} ${deco} pc-${n % 5}`,
    style: { '--tilt': `${tilt}deg` }, 'aria-label': `${photo.label || 'Фото'}, ${photo.day}` },
    h('span', { class: 'polaroid-img' }, lazyThumb(photo)),
    text ? h('span', { class: 'polaroid-cap' }, text) : null);
  if (onOpen) b.addEventListener('click', () => { haptic.tap(); onOpen(); });
  return b;
}

/** Доска с полароидами (альбом, неделя в календаре). */
export function memoryBoard(list, { onDelete, small = false, captions = true } = {}) {
  return h('div', { class: `memo-board ${small ? 'small' : ''}` },
    list.map((p, i) => polaroid(p, { small, caption: captions ? undefined : '',
      onOpen: () => openViewer(list, i, { onDelete }) })));
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
        if (!handlePremiumError(e)) toastError(e);
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

// ---------- Полноэкранный просмотр: большой полароид на доске ----------
const KIND = { quest: ['квест', 'lime'], plan: ['план', 'blue'], day: ['день', 'yellow'], board: ['цели месяца', 'orange'], album: ['общий альбом', 'lav'] };
const LONG_DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const VIEWER_ICONS = {
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
};
const vIcon = name => h('span', { class: 'memo-ico', 'aria-hidden': 'true', html: VIEWER_ICONS[name] });

export function openViewer(list, index, { onDelete, onChange } = {}) {
  let i = index;
  let edited = false;
  const img = h('img', { class: 'viewer-img', alt: '' });
  const caption = h('button', { type: 'button', class: 'viewer-hand' });
  const counter = h('div', { class: 'viewer-counter' });
  const frame = h('div', { class: 'viewer-polaroid' }, h('span', { class: 'viewer-tape', 'aria-hidden': 'true' }),
    h('div', { class: 'viewer-photo' }, img), caption);
  const stage = h('div', { class: 'viewer-stage' }, h('div', { class: 'viewer-back', 'aria-hidden': 'true' }), frame);
  const tags = h('div', { class: 'viewer-tags' });
  const title = h('div', { class: 'viewer-title' });
  const info = h('div', { class: 'viewer-info' }, tags, title);
  const dots = h('div', { class: 'viewer-dots', 'aria-hidden': 'true' });
  const close = h('button', { type: 'button', class: 'viewer-btn', 'aria-label': 'Закрыть' }, '✕');
  const download = h('button', { type: 'button', class: 'viewer-btn', 'aria-label': 'Скачать' }, vIcon('down'));
  const share = h('button', { type: 'button', class: 'memo-btn dark grow' }, vIcon('share'), 'Поделиться');
  const toCal = h('button', { type: 'button', class: 'memo-btn accent grow' }, vIcon('cal'), 'В календарь');
  const del = h('button', { type: 'button', class: 'viewer-del', 'aria-label': 'Удалить фото' }, vIcon('trash'));
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Просмотр фото' },
    h('div', { class: 'viewer-top' }, close, counter, download),
    stage, info, h('div', { class: 'viewer-actions' }, share, toCal, del), dots);

  // свайп влево/вправо — листание (без зума: полароид не масштабируется)
  let swipeX = null;
  const show = () => {
    const p = list[i];
    img.src = p.url;
    img.alt = p.label || 'Фото';
    const n = hashOf(p.id);
    frame.style.setProperty('--tilt', `${(n % 5) - 2.5}deg`);
    frame.className = `viewer-polaroid pc-${n % 5}`;
    // Чужие фото (общий альбом, альбом друга) — только смотреть: без подписи, «В календарь» и удаления.
    const mine = p.mine !== false;
    caption.textContent = p.caption || (mine ? '＋ добавить подпись' : '');
    caption.classList.toggle('empty', !p.caption);
    caption.disabled = !mine;
    caption.setAttribute('aria-label', p.caption ? `Подпись: ${p.caption}${mine ? '. Изменить' : ''}` : 'Добавить подпись');
    // style.display, а не hidden: у кнопок свой display в CSS
    toCal.style.display = !mine || p.target === 'album' ? 'none' : '';
    del.style.display = p.can_delete === false || (!mine && !p.can_delete) ? 'none' : '';
    const [kind, color] = KIND[p.target] || ['фото', 'pink'];
    clear(tags).append(h('span', { class: 'viewer-tag dark' }, fmtDay(p.day)), h('span', { class: `viewer-tag c-${color}` }, kind));
    if (p.by) tags.append(h('span', { class: 'viewer-tag c-paleyellow' }, `📷 ${p.by}`));
    title.textContent = p.label || 'Хороший момент';
    counter.textContent = `${i + 1} из ${list.length}`;
    clear(dots);
    if (list.length > 1) {
      const from = Math.max(0, Math.min(i - 4, list.length - 9));
      for (let k = from; k < Math.min(list.length, from + 9); k++) dots.append(h('span', { class: k === i ? 'on' : '' }));
    }
  };
  caption.addEventListener('click', () => {
    const p = list[i];
    if (p.mine === false) return;
    haptic.tap();
    const input = h('input', { class: 'input', type: 'text', maxlength: '120', value: p.caption || '', placeholder: 'Например: лучший закат осени', 'aria-label': 'Подпись к фото' });
    const save = h('button', { type: 'button', class: 'btn block' }, 'Сохранить подпись');
    const s2 = sheet(h('div', { class: 'stack' }, h('h2', null, '✍️ Подпись на полароиде'), input, save), { label: 'Подпись к фото' });
    s2.panel.parentElement.style.zIndex = '80'; // поверх просмотра
    const submit = busy(save, async () => {
      try {
        const res = await api.captionPhoto(p.id, input.value);
        Object.assign(p, { caption: res.photo.caption, label: res.photo.label });
        edited = true;
        haptic.success();
        s2.close();
        show();
      } catch (e) { toastError(e); }
    });
    save.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    setTimeout(() => input.focus(), 200);
  });
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('.viewer-hand') || !e.isPrimary) return;
    swipeX = e.clientX;
  });
  const up = e => {
    if (swipeX === null || !e.isPrimary) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 60 && list.length > 1) { i = (i + (dx < 0 ? 1 : -1) + list.length) % list.length; haptic.select(); show(); }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', () => { swipeX = null; });

  let release;
  const shut = () => {
    overlay.remove(); release && release(); document.removeEventListener('keydown', onKey);
    if (edited && onChange) onChange();
  };
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
  toCal.addEventListener('click', async () => {
    haptic.tap();
    const day = list[i].day;
    shut();
    const { openDaySheet } = await import('./planui.js');
    openDaySheet(day);
  });
  del.addEventListener('click', async () => {
    try {
      const p = list[i];
      if (p.target === 'album' && p.album_id) await api.albumDeletePhoto(p.album_id, p.id);
      else await api.deletePhoto(p.id);
      haptic.success();
      toast('Фото удалено');
      list.splice(i, 1);
      onDelete && onDelete(p.id);
      refreshState().catch(() => {});
      if (!list.length) return shut();
      i = Math.min(i, list.length - 1);
      show();
    } catch (e) { toastError(e); }
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

/** Карточка года 1080×1350: 12 месяцев с фото, лучший — со звездой. */
export async function yearShareCard(year, byMonth, total, quests) {
  await document.fonts.ready;
  const load = src => new Promise(resolve => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = src; });
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FDF7DE'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(44,42,34,.08)';
  for (let y = 10; y < H; y += 28) for (let x = 10; x < W; x += 28) { ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#B23C6C'; ctx.font = '700 64px Caveat, cursive'; ctx.fillText(String(year), 80, 130);
  ctx.fillStyle = '#2C2A22'; ctx.font = '800 64px Unbounded, sans-serif'; ctx.fillText('Мой год в фото', 80, 210);
  ctx.fillStyle = '#6E6850'; ctx.font = '800 36px Nunito, sans-serif';
  ctx.fillText(`${total} фото${quests ? ` · ${quests} ${plural(quests, 'квест', 'квеста', 'квестов')}` : ''}`, 80, 270);
  let best = null;
  for (const [k, v] of byMonth) if (!best || v.length > byMonth.get(best).length) best = k;
  const tints = ['#EEE5FF', '#E6F0FF', '#FFE0EE', '#F7FBD0', '#FDF3B0', '#FFEBD4'];
  const names = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const cw = 290, ch = 200, gx = 25, gy = 20, x0 = 80, y0 = 320;
  for (let m = 0; m < 12; m++) {
    const key = `${year}-${String(m + 1).padStart(2, '0')}`;
    const photos = byMonth.get(key) || [];
    const x = x0 + (m % 3) * (cw + gx), y = y0 + Math.floor(m / 3) * (ch + gy);
    ctx.save();
    roundRect(ctx, x, y, cw, ch, 32);
    if (photos.length) { ctx.fillStyle = tints[m % tints.length]; ctx.fill(); } else { ctx.setLineDash([10, 10]); ctx.strokeStyle = '#D9CFAE'; ctx.lineWidth = 4; ctx.stroke(); }
    ctx.restore();
    const pics = await Promise.all(photos.slice(0, 2).map(p => load(p.thumb)));
    pics.forEach((pic, k) => {
      if (!pic) return;
      ctx.save();
      ctx.translate(x + 90 + k * 80, y + 80); ctx.rotate(k ? 0.12 : -0.14);
      ctx.shadowColor = 'rgba(70,50,90,.25)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#FFFEF9'; ctx.fillRect(-56, -56, 112, 126);
      ctx.shadowColor = 'transparent';
      const s = Math.min(pic.width, pic.height);
      ctx.drawImage(pic, (pic.width - s) / 2, (pic.height - s) / 2, s, s, -48, -48, 96, 96);
      ctx.restore();
    });
    ctx.fillStyle = photos.length ? '#2C2A22' : '#B5AC8C'; ctx.font = '700 50px Caveat, cursive'; ctx.fillText(names[m], x + 22, y + ch - 22);
    ctx.fillStyle = '#6E6850'; ctx.font = '800 28px Nunito, sans-serif';
    const cnt = photos.length ? String(photos.length) : '—';
    ctx.fillText(cnt, x + cw - 22 - ctx.measureText(cnt).width, y + ch - 26);
    if (key === best) {
      ctx.save(); ctx.translate(x + cw - 40, y + 40); ctx.rotate(0.25);
      ctx.fillStyle = '#FFD23F'; ctx.strokeStyle = '#C99A00'; ctx.lineWidth = 3; ctx.beginPath();
      for (let k = 0; k < 10; k++) { const r = k % 2 ? 15 : 34, a = -Math.PI / 2 + k * Math.PI / 5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  ctx.fillStyle = '#B23C6C'; ctx.font = '800 36px Nunito, sans-serif'; ctx.fillText('LIFEQUEST', 80, H - 50);
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
    h('h2', null, intro ? '📷 Добавим фото в календарь?' : '📷 Фото-отчёт'),
    h('p', { class: 'muted bold' }, intro
      ? `«${title}» выполнено! Сфотографируй момент — фото появится в календаре на этот день и на доске воспоминаний.`
      : title),
    photoStrip({ target: 'quest', quest_history_id: historyId }, { title: 'Фото-отчёт' }), close), { label: 'Фото-отчёт' });
  close.addEventListener('click', () => s.close());
  return s;
}

/** Кнопки «Камера» и «Галерея»: выбрать фото и загрузить с полями fields
 *  (например { target: 'day', day } или { target: 'album', album_id }). */
export function uploadButtons(fields, { onDone, label = 'Добавить фото', small = false } = {}) {
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const gallery = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const status = h('div', { class: 'upl-status', role: 'status', hidden: true });
  const bar = h('span', { class: 'upl-bar' });
  status.append(h('span', { class: 'upl-text' }), h('span', { class: 'upl-track' }, bar));
  const cam = h('button', { type: 'button', class: `upl-btn ${small ? 'small' : ''}` }, '📷', h('span', null, 'Камера'));
  const gal = h('button', { type: 'button', class: `upl-btn dark ${small ? 'small' : ''}` }, '🖼️', h('span', null, small ? 'Галерея' : `${label} из галереи`));
  cam.addEventListener('click', () => { haptic.tap(); camera.click(); });
  gal.addEventListener('click', () => { haptic.tap(); gallery.click(); });
  const run = async files => {
    const list = [...files].slice(0, 10);
    cam.disabled = gal.disabled = true;
    status.hidden = false;
    let ok = 0;
    for (const [k, file] of list.entries()) {
      status.firstChild.textContent = `Загружаю ${k + 1} из ${list.length}…`;
      bar.style.width = '0%';
      try {
        const blob = await prepareImage(file);
        const res = await uploadPhoto(blob, fields, f => { bar.style.width = `${Math.round(f * 100)}%`; });
        ok += 1;
        if ((res.new_achievements || []).length) celebrate(res);
      } catch (e) {
        if (!handlePremiumError(e)) toastError(e);
        break;
      }
    }
    status.hidden = true;
    cam.disabled = gal.disabled = false;
    if (ok) {
      haptic.success();
      toast(ok > 1 ? `📸 Добавлено ${ok} ${plural(ok, 'фото', 'фото', 'фото')}` : '📸 Фото добавлено', 'good');
      refreshState().catch(() => {});
      onDone && onDone(ok);
    }
  };
  camera.addEventListener('change', () => { if (camera.files.length) run(camera.files); camera.value = ''; });
  gallery.addEventListener('change', () => { if (gallery.files.length) run(gallery.files); gallery.value = ''; });
  return h('div', { class: 'upl' }, h('div', { class: 'upl-row' }, cam, gal), status, camera, gallery);
}
