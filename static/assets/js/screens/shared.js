// Общий альбом (все участники добавляют фото) или альбом друга, который
// открыл мне доступ (только смотреть).

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { mascot } from '../mascot.js';
import { skeleton, toastError, busy, modal, sheet, toast } from '../ui.js';
import { refreshState } from '../store.js';
import { uploadButtons } from '../photoui.js';
import { currentShared, photoGrid, openInvite, ALBUM_EMOJI } from '../albumui.js';

export async function render(el, ctx) {
  const target = currentShared();
  if (!target) { ctx.go('album', { replace: true }); return; }
  clear(el);
  el.append(skeleton(120), h('div', { style: { height: '12px' } }), skeleton(260));
  try {
    if (target.kind === 'friend') {
      const res = await api.friendAlbum(target.id);
      paintFriend(el, ctx, res);
    } else {
      const res = await api.album(target.id);
      paintAlbum(el, ctx, res.album);
    }
  } catch (e) {
    clear(el).append(h('div', { class: 'card', style: { marginTop: '12px' } }, h('p', { class: 'bold' }, e.message)));
  }
}

function head(emoji, title, sub, pet) {
  return h('header', { class: 'alb-head' },
    pet || h('span', { class: 'alb-head-emoji', 'aria-hidden': 'true' }, emoji),
    h('div', { class: 'grow' }, h('h1', null, title), sub ? h('p', null, sub) : null));
}

function paintFriend(el, ctx, data) {
  clear(el);
  const o = data.owner;
  el.append(head('', `Альбом: ${o.name}`, `🔓 ${o.name} открыл(а) тебе свои воспоминания · ${data.photos.length} ${plural(data.photos.length, 'фото', 'фото', 'фото')}`,
    h('div', { class: 'alb-head-pet' }, mascot(o.mascot || 'cat-purple', 'love', { size: 56, acc: o.accessory }))));
  if (!data.photos.length) {
    el.append(h('div', { class: 'card', style: { marginTop: '12px' } }, h('p', { class: 'bold muted center' }, 'Здесь пока нет фото 🌱')));
    return;
  }
  el.append(photoGrid(data.photos), h('p', { class: 'memo-foot' }, '👀 Только просмотр — менять фото может лишь владелец'));
}

function paintAlbum(el, ctx, a) {
  clear(el);
  const reload = () => render(el, ctx);
  const header = head(a.emoji || '📸', a.title,
    `${a.count} фото · ${a.members} ${plural(a.members, 'участник', 'участника', 'участников')} · создатель ${a.mine ? '— ты' : a.owner}`);
  const edit = h('button', { type: 'button', class: 'cal2-icon-btn soft', 'aria-label': 'Изменить название и значок' }, '✏️');
  edit.addEventListener('click', () => { haptic.tap(); openEditAlbum(a, reload); });
  header.append(edit);
  el.append(header);

  const invite = h('button', { type: 'button', class: 'cal2-pill dark' }, '👥 Позвать');
  invite.addEventListener('click', () => { haptic.tap(); openInvite(ctx.state, a, { onChange: () => reload() }); });
  el.append(h('section', { class: 'ct-block' },
    h('div', { class: 'spread' }, h('h2', null, 'Участники'), invite),
    h('div', { class: 'ct-members', style: { marginTop: '10px' } }, a.members_list.map(m => h('div', { class: 'ct-member' },
      h('div', { class: 'ct-member-pet' }, mascot(m.mascot || 'cat-purple', 'happy', { size: 44, acc: m.accessory })),
      h('span', null, m.id === ctx.state.user.id ? 'Ты' : m.name),
      m.id === a.owner_id ? h('span', { class: 'ct-owner' }, 'создатель') : null)))));

  el.append(h('section', { class: 'ct-block' }, h('h2', { style: { marginBottom: '10px' } }, '＋ Добавить фото'),
    uploadButtons({ target: 'album', album_id: a.id }, { label: 'Фото', onDone: reload })));

  if (a.photos.length) el.append(h('div', { class: 'memo-sec-head' }, h('h2', null, 'Фото'), h('span', null, String(a.count))), photoGrid(a.photos, { onChange: reload }));
  else el.append(h('div', { class: 'card', style: { marginTop: '12px' } }, h('p', { class: 'bold muted center' }, 'Пока пусто — добавь первое фото, и его увидят все участники 📸')));

  // Выйти или удалить альбом — доступно каждому участнику
  const confirmAction = (kind) => {
    haptic.warning();
    const del = kind === 'delete';
    const yes = h('button', { type: 'button', class: `btn block ${del ? 'colored c-pink' : ''}` }, del ? 'Да, удалить альбом' : 'Да, выйти');
    const no = h('button', { type: 'button', class: 'btn block ghost', style: { marginTop: '8px' } }, 'Отмена');
    const m = modal(h('div', null, h('h2', null, del ? 'Удалить альбом?' : 'Выйти из альбома?'),
      h('p', { class: 'bold muted', style: { margin: '6px 0 14px' } }, del
        ? 'Альбом и все фото в нём исчезнут у всех участников. Это нельзя отменить.'
        : 'Твои фото останутся в альбоме. Вернуться можно по ссылке-приглашению.'), yes, no), { label: 'Подтверждение' });
    no.addEventListener('click', () => m.close());
    yes.addEventListener('click', busy(yes, async () => {
      try {
        await (del ? api.albumDelete(a.id) : api.albumLeave(a.id));
        m.close();
        if (del) toast('🗑 Альбом удалён', 'good');
        refreshState().catch(() => {});
        ctx.go('album', { replace: true, fresh: true });
      } catch (e) { toastError(e); }
    }));
  };
  const leave = h('button', { type: 'button', class: 'btn block ghost small' }, 'Выйти из альбома');
  leave.addEventListener('click', () => confirmAction('leave'));
  const remove = h('button', { type: 'button', class: 'btn block ghost small alb-delete' }, '🗑 Удалить альбом');
  remove.addEventListener('click', () => confirmAction('delete'));
  el.append(h('div', { class: 'stack-sm', style: { marginTop: '16px' } }, leave, remove),
    h('p', { class: 'memo-foot' }, '👥 Все участники равны: добавляют и удаляют фото, меняют подписи и название'));
}

/** Название и значок альбома — может менять любой участник. */
function openEditAlbum(a, onSaved) {
  const form = { emoji: a.emoji || '📸' };
  const s = sheet(h('div'), { label: 'Изменить альбом' });
  const title = h('input', { class: 'input', type: 'text', maxlength: '50', value: a.title, 'aria-label': 'Название альбома' });
  const emoji = h('div', { class: 'duel-chips' });
  const drawEmoji = () => emoji.replaceChildren(...ALBUM_EMOJI.map(e => {
    const b = h('button', { type: 'button', class: `duel-chip ${form.emoji === e ? 'on' : ''}`, 'aria-pressed': String(form.emoji === e) }, e);
    b.addEventListener('click', () => { haptic.select(); form.emoji = e; drawEmoji(); });
    return b;
  }));
  drawEmoji();
  const save = h('button', { type: 'button', class: 'btn block' }, 'Сохранить');
  save.addEventListener('click', busy(save, async () => {
    if (!title.value.trim()) { toast('Придумай название 🙂', 'bad'); title.focus(); return; }
    try {
      await api.albumUpdate(a.id, { title: title.value.trim(), emoji: form.emoji });
      haptic.success();
      toast('Сохранено ✓', 'good');
      s.close();
      onSaved && onSaved();
    } catch (e) { toastError(e); }
  }));
  s.setContent(h('div', { class: 'stack' }, h('h2', null, '✏️ Изменить альбом'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Название'), title),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Значок'), emoji), save));
}
