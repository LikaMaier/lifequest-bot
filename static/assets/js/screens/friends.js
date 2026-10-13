// Друзья: рейтинг недели (кто больше квестов), серии, приглашение по ссылке.

import { h, clear, plural } from '../dom.js';
import { haptic, openTgLink } from '../tg.js';
import { api } from '../api.js';
import { mascot } from '../mascot.js';
import { sectionTitle, skeleton, toastError, emptyState, button } from '../ui.js';

let cache = null;

/** Ссылка-приглашение: новичку и пригласившему — по заморозке. */
export function inviteLink(state, questId = null) {
  if (!state.bot_username) return '';
  const payload = questId ? `q_${questId}_${state.user.id}` : `ref_${state.user.id}`;
  return `https://t.me/${state.bot_username}?start=${payload}`;
}

export function shareInvite(state, quest = null) {
  const link = inviteLink(state, quest && quest.id);
  const text = quest
    ? `Зову тебя на квест в LifeQuest: «${quest.title}». Кто первый?`
    : 'Я играю в LifeQuest — бот подкидывает странные и классные задания. Давай со мной? По ссылке нам обоим по заморозке серии 🧊';
  haptic.tap();
  openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
}

export async function render(el, ctx) {
  cache = null;
  return draw(el, ctx);
}

async function draw(el, ctx) {
  clear(el);
  const { state } = ctx;
  el.append(h('header', { class: 'page-head' }, mascot(state.user.mascot, 'love', { size: 56, acc: state.user.accessory }),
    h('div', null, h('h1', null, 'Друзья'), h('p', null, 'Соревнуйтесь за неделю и зовите друг друга на квесты'))));
  el.append(h('div', { class: 'card tinted c-blue' },
    h('div', { class: 'bold' }, '🧊 Позови друга — получите по заморозке серии'),
    h('p', { class: 'small bold', style: { margin: '4px 0 12px' } }, 'Подарок — когда друг впервые откроет бота по твоей ссылке.'),
    button('Позвать друга', { cls: 'block', onClick: () => shareInvite(state) })));

  const body = h('div');
  el.append(body);
  if (!cache) {
    body.append(skeleton(200));
    try { cache = await api.friends(); } catch (e) { clear(body); toastError(e); return; }
  }
  clear(body);
  if (!cache.friends.length) {
    body.append(h('div', { class: 'card', style: { marginTop: '14px' } },
      emptyState('Пока здесь пусто. Позови кого-нибудь — вместе приключаться веселее!', { kind: state.user.mascot, expr: 'wink' })));
    return;
  }
  const rows = [{ id: state.user.id, name: 'Ты', mascot: state.user.mascot, accessory: state.user.accessory,
    week_done: cache.me_week, streak: state.streak.current, level: state.level.level, me: true }, ...cache.friends]
    .sort((a, b) => b.week_done - a.week_done || b.streak - a.streak);
  body.append(sectionTitle('Рейтинг недели'), h('div', { class: 'stack-sm' }, rows.map((f, i) =>
    h('div', { class: `quest-item ${f.me ? 'c-yellow' : 'c-blue'}` },
      h('div', { class: 'bold', style: { width: '22px', textAlign: 'center' } }, i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)),
      h('div', { style: { width: '44px', height: '42px', flexShrink: 0 } }, mascot(f.mascot, f.me ? 'happy' : 'wink', { size: 44, acc: f.accessory })),
      h('div', { class: 'grow' }, h('div', { class: 'q-title' }, f.name),
        h('div', { class: 'q-meta' }, `🔥 ${f.streak} ${plural(f.streak, 'день', 'дня', 'дней')} · уровень ${f.level}`)),
      h('div', { class: 'center' }, h('div', { class: 'num', style: { fontSize: '22px' } }, String(f.week_done)),
        h('div', { class: 'tiny bold muted' }, plural(f.week_done, 'квест', 'квеста', 'квестов')))))));
}
