// Альбом: фото выбранного дня (лист по тапу на календарь), общие альбомы
// с друзьями и доступ к своему альбому.

import { h, clear, fmtDay, plural } from './dom.js';
import { api } from './api.js';
import { haptic, openTgLink } from './tg.js';
import { mascot } from './mascot.js';
import { sheet, toast, toastError, busy, skeleton } from './ui.js';
import { lazyThumb, openViewer, uploadButtons } from './photoui.js';

const KEY = 'lq-shared';
export const ALBUM_EMOJI = ['📸', '🏖️', '🎉', '🎂', '🌲', '🍕', '✈️', '💛', '🐾', '🎄'];
const KIND = { quest: 'Квест', plan: 'План', day: 'День', board: 'Цели месяца', album: 'Общий альбом' };

/** Открыть общий альбом (kind 'album') или альбом друга (kind 'friend'). */
export function openShared(go, kind, id) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ kind, id })); } catch (e) { /* приватный режим */ }
  haptic.tap();
  go('shared', { fresh: true });
}

export function currentShared() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
}

/** Сетка полароидов; тап — просмотр. */
export function photoGrid(list, { onChange } = {}) {
  return h('div', { class: 'alb-grid' }, list.map((p, i) => {
    const b = h('button', { type: 'button', class: `alb-pic pc-${i % 5}`, 'aria-label': `Открыть фото ${i + 1}${p.by ? `, ${p.by}` : ''}` },
      h('span', { class: 'alb-pic-img' }, lazyThumb(p)),
      h('span', { class: 'alb-pic-cap' }, p.caption || (p.by ? `📷 ${p.by}` : fmtDay(p.day))));
    b.addEventListener('click', () => { haptic.tap(); openViewer(list, i, { onDelete: onChange, onChange }); });
    return b;
  }));
}

// ---------- Тап по дню в календаре альбома ----------
/** Лист дня: фото этого дня (если есть) и кнопки «Добавить фото дня» / «Добавить ещё». */
export function openDayPhotos(day, photos, { onChange, today } = {}) {
  const s = sheet(h('div'), { label: fmtDay(day) });
  const future = today && day > today;
  const draw = list => {
    const body = h('div', { class: 'stack' },
      h('div', null, h('h2', null, `📅 ${fmtDay(day)}`),
        h('p', { class: 'bold muted', style: { margin: '4px 0 0' } }, list.length
          ? `${list.length} ${plural(list.length, 'фото', 'фото', 'фото')} в этот день`
          : future ? 'Этот день ещё впереди' : 'В этот день фото пока нет')));
    if (list.length) {
      body.append(photoGrid(list, { onChange: () => { refresh(); onChange && onChange(); } }));
      if (!future) body.append(h('div', { class: 'cal2-label', style: { margin: '4px 0 -6px' } }, '＋ Добавить ещё'));
    } else if (!future) {
      body.append(h('div', { class: 'alb-empty-day' }, h('span', { 'aria-hidden': 'true' }, '📷'),
        h('b', null, 'Добавь фото дня'), h('span', null, 'Сделай снимок или выбери из галереи — он появится в календаре')));
    }
    if (!future) body.append(uploadButtons({ target: 'day', day }, { label: 'Фото дня', onDone: () => { refresh(); onChange && onChange(); } }));
    s.setContent(body);
  };
  const refresh = async () => {
    try { draw((await api.photos({ day })).photos); } catch (e) { toastError(e); }
  };
  draw(photos || []);
  return s;
}

// ---------- Полка «Общие альбомы» на экране Альбома ----------
export function sharedShelf(ctx) {
  const box = h('section', { class: 'alb-shelf' }, skeleton(120));
  const load = async () => {
    let data;
    try { data = await api.albums(); } catch (e) { clear(box).append(h('p', { class: 'tiny muted bold' }, e.message)); return; }
    clear(box);
    const access = h('button', { type: 'button', class: 'alb-access' },
      h('span', { 'aria-hidden': 'true' }, data.granted ? '🔓' : '🔒'),
      h('span', { class: 'grow' }, h('b', null, 'Доступ к моему альбому'),
        h('span', null, data.granted ? `Видят ${data.granted} ${plural(data.granted, 'друг', 'друга', 'друзей')}` : 'Пока видишь только ты')),
      h('span', { class: 'alb-go', 'aria-hidden': 'true' }, '›'));
    access.addEventListener('click', () => { haptic.tap(); openAccess({ onChange: load }); });
    const create = h('button', { type: 'button', class: 'alb-card new' },
      h('span', { class: 'alb-cover' }, h('span', { class: 'alb-plus', 'aria-hidden': 'true' }, '＋')),
      h('b', null, 'Общий альбом'), h('span', null, 'с друзьями'));
    create.addEventListener('click', () => { haptic.tap(); openCreateAlbum(ctx); });
    const cards = [
      create,
      ...data.albums.map(a => {
        const b = h('button', { type: 'button', class: 'alb-card' },
          h('span', { class: 'alb-cover' }, a.cover ? lazyThumb({ thumb: a.cover, w: 1, h: 1 }) : h('span', { class: 'alb-cover-emoji' }, a.emoji || '📸'),
            h('span', { class: 'alb-badge' }, `${a.emoji || '📸'} ${a.count}`)),
          h('b', null, a.title), h('span', null, `👥 ${a.members} · ${a.mine ? 'твой' : a.owner}`));
        b.addEventListener('click', () => openShared(ctx.go, 'album', a.id));
        return b;
      }),
      ...data.friends.map(f => {
        const b = h('button', { type: 'button', class: 'alb-card friend' },
          h('span', { class: 'alb-cover' }, f.cover ? lazyThumb({ thumb: f.cover, w: 1, h: 1 })
            : h('span', { class: 'alb-cover-pet' }, mascot(f.mascot || 'cat-purple', 'happy', { size: 56, acc: f.accessory })),
            h('span', { class: 'alb-badge' }, `🔓 ${f.count}`)),
          h('b', null, `Альбом: ${f.name}`), h('span', null, 'открыт для тебя'));
        b.addEventListener('click', () => openShared(ctx.go, 'friend', f.id));
        return b;
      }),
    ];
    box.append(h('div', { class: 'memo-sec-head', style: { marginTop: '4px' } }, h('h2', null, 'Общие альбомы'),
      h('span', null, data.albums.length || data.friends.length ? `${data.albums.length + data.friends.length}` : '')),
    h('div', { class: 'alb-row' }, cards), access);
  };
  load();
  return box;
}

export function openCreateAlbum(ctx) {
  const form = { emoji: '📸' };
  const s = sheet(h('div'), { label: 'Общий альбом' });
  const title = h('input', { class: 'input', type: 'text', maxlength: '50', placeholder: 'Например: Лето на даче', 'aria-label': 'Название альбома' });
  const emoji = h('div', { class: 'duel-chips' });
  const drawEmoji = () => emoji.replaceChildren(...ALBUM_EMOJI.map(e => {
    const b = h('button', { type: 'button', class: `duel-chip ${form.emoji === e ? 'on' : ''}`, 'aria-pressed': String(form.emoji === e) }, e);
    b.addEventListener('click', () => { haptic.select(); form.emoji = e; drawEmoji(); });
    return b;
  }));
  drawEmoji();
  const save = h('button', { type: 'button', class: 'btn block' }, '📸 Создать альбом');
  save.addEventListener('click', busy(save, async () => {
    if (!title.value.trim()) { toast('Придумай название 🙂', 'bad'); title.focus(); return; }
    try {
      const res = await api.createAlbum({ title: title.value.trim(), emoji: form.emoji });
      haptic.success();
      s.close();
      openShared(ctx.go, 'album', res.album.id);
    } catch (e) { toastError(e); }
  }));
  s.setContent(h('div', { class: 'stack' }, h('h2', null, '📸 Общий альбом'),
    h('p', { class: 'bold muted', style: { margin: '-6px 0 0' } }, 'Все, кого ты позовёшь, смогут добавлять фото и видеть фото друг друга.'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Название'), title),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Значок'), emoji), save));
  setTimeout(() => title.focus({ preventScroll: true }), 120);
}

/** Кому открыт мой альбом: друзья с переключателями. */
export function openAccess({ onChange } = {}) {
  const s = sheet(h('div', null, skeleton(160)), { label: 'Доступ к моему альбому' });
  const draw = list => {
    const rows = list.map(f => {
      const sw = h('button', { type: 'button', class: `alb-switch ${f.on ? 'on' : ''}`, role: 'switch', 'aria-checked': String(f.on),
        'aria-label': `${f.name}: ${f.on ? 'видит альбом' : 'не видит альбом'}` }, h('span'));
      sw.addEventListener('click', busy(sw, async () => {
        haptic.select();
        try {
          const res = await api.albumAccess(f.id, !f.on);
          toast(!f.on ? `🔓 ${f.name} теперь видит твой альбом` : `🔒 ${f.name} больше не видит альбом`, 'good');
          draw(res.access);
          onChange && onChange();
        } catch (e) { toastError(e); }
      }));
      return h('div', { class: 'alb-friend' },
        h('div', { class: 'alb-friend-pet' }, mascot(f.mascot || 'cat-purple', f.on ? 'happy' : 'wink', { size: 40, acc: f.accessory })),
        h('div', { class: 'grow' }, h('b', null, f.name), h('span', null, f.on ? 'видит твой альбом' : 'не видит')), sw);
    });
    s.setContent(h('div', { class: 'stack' }, h('h2', null, '🔓 Доступ к моему альбому'),
      h('p', { class: 'bold muted', style: { margin: '-6px 0 0' } }, 'Выбери друзей, которые смогут смотреть твои «Воспоминания». Только смотреть — менять и удалять фото они не могут.'),
      rows.length ? h('div', { class: 'stack-sm' }, rows)
        : h('p', { class: 'bold muted' }, 'Пока нет друзей. Позови друга на экране «Друзья» — и сможешь открыть ему альбом.')));
  };
  api.albumAccessList().then(res => draw(res.access)).catch(e => { toastError(e); s.close(); });
  return s;
}

/** Позвать в общий альбом: друзья из списка или ссылка для всех остальных. */
export function openInvite(state, album, { onChange } = {}) {
  const s = sheet(h('div', null, skeleton(160)), { label: 'Позвать в альбом' });
  const link = state.bot_username ? `https://t.me/${state.bot_username}?start=a_${album.id}` : '';
  const shareLink = h('button', { type: 'button', class: 'btn block' }, '📨 Отправить ссылку');
  shareLink.addEventListener('click', () => {
    if (!link) { toast('Ссылка появится, когда бот будет на связи', 'bad'); return; }
    haptic.tap();
    const text = `Залетай в наш общий фотоальбом «${album.emoji} ${album.title}» в LifeQuest — добавляй фото! 📸`;
    openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  });
  const draw = list => {
    const inside = new Set(album.members_list.map(m => m.id));
    const rows = list.filter(f => !inside.has(f.id)).map(f => {
      const add = h('button', { type: 'button', class: 'cal2-pill small dark' }, 'Позвать');
      add.addEventListener('click', busy(add, async () => {
        try {
          const res = await api.albumInvite(album.id, f.id);
          haptic.success();
          toast(`${f.name} теперь в альбоме 📸`, 'good');
          album = res.album;
          onChange && onChange(res.album);
          draw(list);
        } catch (e) { toastError(e); }
      }));
      return h('div', { class: 'alb-friend' },
        h('div', { class: 'alb-friend-pet' }, mascot(f.mascot || 'cat-purple', 'wink', { size: 40, acc: f.accessory })),
        h('div', { class: 'grow' }, h('b', null, f.name)), add);
    });
    s.setContent(h('div', { class: 'stack' }, h('h2', null, '👥 Позвать в альбом'),
      rows.length ? h('div', { class: 'stack-sm' }, rows) : h('p', { class: 'bold muted' }, 'Все друзья уже в альбоме — или позови кого-то по ссылке.'),
      shareLink, h('p', { class: 'tiny bold muted', style: { margin: 0 } }, 'По ссылке может войти любой, кому ты её отправишь.')));
  };
  api.friends().then(res => draw(res.friends || [])).catch(() => draw([]));
  return s;
}

export { KIND };
