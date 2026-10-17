// Общий альбом (все участники добавляют фото) или альбом друга, который
// открыл мне доступ (только смотреть).

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { mascot } from '../mascot.js';
import { skeleton, toastError, busy, modal } from '../ui.js';
import { refreshState } from '../store.js';
import { uploadButtons } from '../photoui.js';
import { currentShared, photoGrid, openInvite } from '../albumui.js';

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
  el.append(head(a.emoji || '📸', a.title,
    `${a.count} ${plural(a.count, 'фото', 'фото', 'фото')} · ${a.members} ${plural(a.members, 'участник', 'участника', 'участников')} · создатель ${a.mine ? '— ты' : a.owner}`));

  const invite = h('button', { type: 'button', class: 'cal2-pill dark' }, '👥 Позвать');
  invite.addEventListener('click', () => { haptic.tap(); openInvite(ctx.state, a, { onChange: () => reload() }); });
  el.append(h('section', { class: 'ct-block' },
    h('div', { class: 'spread' }, h('h2', null, 'Участники'), invite),
    h('div', { class: 'ct-members', style: { marginTop: '10px' } }, a.members_list.map(m => h('div', { class: 'ct-member' },
      h('div', { class: 'ct-member-pet' }, mascot(m.mascot || 'cat-purple', 'happy', { size: 44, acc: m.accessory })),
      h('span', null, m.id === ctx.state.user.id ? 'Ты' : m.name),
      m.id === a.owner_id ? h('span', { class: 'ct-crown', 'aria-label': 'Создатель' }, '👑') : null)))));

  el.append(h('section', { class: 'ct-block' }, h('h2', { style: { marginBottom: '10px' } }, '＋ Добавить фото'),
    uploadButtons({ target: 'album', album_id: a.id }, { label: 'Фото', onDone: reload })));

  if (a.photos.length) el.append(h('div', { class: 'memo-sec-head' }, h('h2', null, 'Фото'), h('span', null, String(a.count))), photoGrid(a.photos, { onChange: reload }));
  else el.append(h('div', { class: 'card', style: { marginTop: '12px' } }, h('p', { class: 'bold muted center' }, 'Пока пусто — добавь первое фото, и его увидят все участники 📸')));

  const leave = h('button', { type: 'button', class: 'btn block ghost small', style: { marginTop: '16px' } }, a.mine ? '🗑 Удалить альбом' : 'Выйти из альбома');
  leave.addEventListener('click', () => {
    haptic.warning();
    const yes = h('button', { type: 'button', class: 'btn block' }, a.mine ? 'Да, удалить' : 'Да, выйти');
    const no = h('button', { type: 'button', class: 'btn block ghost', style: { marginTop: '8px' } }, 'Отмена');
    const m = modal(h('div', null, h('h2', null, a.mine ? 'Удалить альбом?' : 'Выйти из альбома?'),
      h('p', { class: 'bold muted', style: { margin: '6px 0 14px' } }, a.mine
        ? 'Все фото в нём удалятся у всех участников. Это нельзя отменить.'
        : 'Твои фото останутся в альбоме. Вернуться можно по ссылке-приглашению.'), yes, no), { label: 'Подтверждение' });
    no.addEventListener('click', () => m.close());
    yes.addEventListener('click', busy(yes, async () => {
      try {
        await api.albumLeave(a.id);
        m.close();
        refreshState().catch(() => {});
        ctx.go('album', { replace: true, fresh: true });
      } catch (e) { toastError(e); }
    }));
  });
  el.append(leave);
}
