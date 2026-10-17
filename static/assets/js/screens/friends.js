// Друзья: вызовы на привычки (дуэль и «вместе»), лига недели, приглашения, серии, приглашение по ссылке.

import { h, clear, plural } from '../dom.js';
import { haptic, openTgLink } from '../tg.js';
import { api } from '../api.js';
import { mascot } from '../mascot.js';
import { sectionTitle, skeleton, toastError, button } from '../ui.js';
import { duelCard, openDuelCreator } from '../duelui.js';

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
  const redraw = () => { cache = null; draw(el, ctx); };
  el.append(h('header', { class: 'page-head' }, mascot(state.user.mascot, 'love', { size: 56, acc: state.user.accessory }),
    h('div', null, h('h1', null, 'Друзья'), h('p', null, 'Вызовы на привычки, лига недели и квесты вместе'))));

  const body = h('div');
  el.append(body);
  if (!cache) {
    body.append(skeleton(200));
    try {
      const [fr, du] = await Promise.all([api.friends(), api.duels()]);
      cache = { ...fr, duels: du };
    } catch (e) { clear(body); toastError(e); return; }
  }
  clear(body);
  const du = cache.duels;

  // Вызовы на привычки — главная фишка экрана
  const cta = h('button', { type: 'button', class: 'duel-cta' },
    h('span', { class: 'duel-cta-emoji', 'aria-hidden': 'true' }, '⚔️'),
    h('span', { class: 'grow' }, h('b', null, 'Бросить вызов'),
      h('span', { class: 'sub' }, 'Дуэль или общая серия по привычке — с другом')));
  cta.addEventListener('click', () => { haptic.tap(); openDuelCreator(ctx, { friends: cache.friends, onDone: redraw }); });
  body.append(cta);
  const cards = [...du.incoming, ...du.active, ...du.outgoing, ...du.finished.slice(0, 2)];
  if (cards.length) {
    body.append(sectionTitle('Вызовы'), h('div', { class: 'stack-sm' },
      cards.map(d => duelCard(d, { state, onChange: redraw }))));
  } else {
    body.append(h('p', { class: 'small bold muted', style: { margin: '10px 4px 0' } },
      '⚔️ Дуэль — кто чаще выполнит привычку. 🤝 Вместе — общая серия: день засчитан, только если сделали оба. Друг получит приглашение в боте, а прогресс друг друга видно каждый день.'));
  }

  const invite = h('div', { class: 'card tinted c-blue', style: { marginTop: '14px' } },
    h('div', { class: 'bold' }, '🧊 Позови друга — получите по заморозке серии'),
    h('p', { class: 'small bold', style: { margin: '4px 0 12px' } }, 'Подарок — когда друг впервые откроет бота по твоей ссылке.'),
    button('Позвать друга', { cls: 'block', onClick: () => shareInvite(state) }));
  if (!cache.friends.length) {
    body.append(invite);
    return;
  }
  const me = cache.me || { points: 0, week_done: cache.me_week || 0, week_habits: 0, week_plans: 0 };
  const rows = [{ id: state.user.id, name: 'Ты', mascot: state.user.mascot, accessory: state.user.accessory,
    ...me, streak: state.streak.current, level: state.level.level, me: true }, ...cache.friends]
    .sort((a, b) => (b.points || 0) - (a.points || 0) || b.streak - a.streak);
  const pts = cache.points || { quest: 3, habit: 1, plan: 1 };
  const left = cache.days_left ?? 0;
  body.append(sectionTitle('Лига недели'),
    h('p', { class: 'small bold muted', style: { margin: '-4px 0 10px' } },
      `Квест — ${pts.quest} очка, привычка и дело из плана — по ${pts.habit}. ${left ? `До финала ${left} ${plural(left, 'день', 'дня', 'дней')}.` : 'Сегодня финал недели!'} Нажми на друга, чтобы бросить вызов.`),
    h('div', { class: 'stack-sm' }, rows.map((f, i) => {
      const row = h(f.me ? 'div' : 'button', { type: f.me ? null : 'button', class: `quest-item ${f.me ? 'c-yellow' : 'c-blue'}`, style: { width: '100%' } },
        h('div', { class: 'bold', style: { width: '22px', textAlign: 'center' } }, i < 3 && f.points ? ['🥇', '🥈', '🥉'][i] : String(i + 1)),
        h('div', { style: { width: '44px', height: '42px', flexShrink: 0 } }, mascot(f.mascot, f.me ? 'happy' : 'wink', { size: 44, acc: f.accessory })),
        h('div', { class: 'grow', style: { textAlign: 'left' } }, h('div', { class: 'q-title' }, f.name),
          h('div', { class: 'q-meta' }, `🎯 ${f.week_done || 0} · 🌱 ${f.week_habits || 0} · 📅 ${f.week_plans || 0} · 🔥 ${f.streak}`)),
        h('div', { class: 'center' }, h('div', { class: 'num', style: { fontSize: '22px' } }, String(f.points || 0)),
          h('div', { class: 'tiny bold muted' }, f.me ? plural(f.points || 0, 'очко', 'очка', 'очков') : '⚔️ вызов')));
      if (!f.me) row.addEventListener('click', () => { haptic.tap(); openDuelCreator(ctx, { friend: f, friends: cache.friends, onDone: redraw }); });
      return row;
    })), invite);
}
