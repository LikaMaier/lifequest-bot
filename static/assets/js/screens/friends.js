// Друзья: одна кнопка «Брось вызов» (1 на 1 по привычке — дуэль или «вместе»;
// компания с пунктами — своё соревнование), лига недели, приглашения, серии.

import { h, clear, plural } from '../dom.js';
import { haptic, openTgLink } from '../tg.js';
import { api } from '../api.js';
import { mascot } from '../mascot.js';
import { sectionTitle, skeleton, toastError, button, sheet } from '../ui.js';
import { duelCard, openDuelCreator } from '../duelui.js';
import { contestCard, openContestCreator } from '../contestui.js';

let cache = null;

/** Выбор формата вызова: 1 на 1 по привычке (дуэль) или компания с пунктами (соревнование). */
export function openChallengeChooser(ctx, redraw = () => {}) {
  const s = sheet(h('div'), { label: 'Брось вызов' });
  // открыли не с экрана «Друзья» — список друзей для дуэли подгрузим сами
  const friendsList = async () => (cache && cache.friends) || (await api.friends()).friends;
  const option = (emoji, color, title, lines, onPick) => {
    const b = h('button', { type: 'button', class: `ch-choice c-${color}` },
      h('span', { class: 'ch-choice-emoji', 'aria-hidden': 'true' }, emoji),
      h('span', { class: 'grow' }, h('b', null, title), lines.map(t => h('span', null, t))));
    b.addEventListener('click', () => { haptic.tap(); s.close(); onPick(); });
    return b;
  };
  s.setContent(h('div', { class: 'stack' },
    h('h2', null, '⚔️ Брось вызов'),
    h('p', { class: 'bold muted', style: { margin: '-6px 0 0' } }, 'Выбери формат'),
    option('🤺', 'orange', '1 на 1 по привычке', ['С одним другом и одной привычкой', 'Засчитывается само, когда отмечаешь привычку', 'Дуэль — у кого серия длиннее, или «вместе» — общая серия'],
      async () => { try { openDuelCreator(ctx, { friends: await friendsList(), onDone: () => { cache = null; redraw(); } }); } catch (e) { toastError(e); } }),
    option('🏆', 'purple', 'Компания и несколько пунктов', ['До 20 человек по ссылке', 'Свои пункты: «без сахара», «зарядка», «8000 шагов»', 'Отмечаете каждый день — побеждает тот, у кого больше очков'],
      () => openContestCreator(ctx, { onDone: () => { cache = null; } }))));
  return s;
}

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
    h('div', null, h('h1', null, 'Друзья'), h('p', null, 'Соревнования, вызовы на привычки и лига недели'))));

  const body = h('div');
  el.append(body);
  if (!cache) {
    body.append(skeleton(200));
    try {
      const [fr, du, co] = await Promise.all([api.friends(), api.duels(), api.contests()]);
      cache = { ...fr, duels: du, contests: co };
    } catch (e) { clear(body); toastError(e); return; }
  }
  clear(body);
  const du = cache.duels;

  // Одна кнопка «Брось вызов» — внутри выбор: 1 на 1 по привычке или компания с пунктами
  const co = cache.contests;
  const cta = h('button', { type: 'button', class: 'challenge-hero' },
    h('span', { class: 'challenge-hero-emoji', 'aria-hidden': 'true' }, '⚔️'),
    h('span', { class: 'grow' }, h('b', null, 'Брось вызов'),
      h('span', null, 'Другу один на один или целой компании')),
    h('span', { class: 'challenge-hero-go' }, 'Вызвать'));
  cta.addEventListener('click', () => { haptic.tap(); openChallengeChooser(ctx, redraw); });
  body.append(cta);

  const contests = [...co.lobby, ...co.active, ...co.finished.slice(0, 2)];
  const cards = [...du.incoming, ...du.active, ...du.outgoing, ...du.finished.slice(0, 2)];
  if (cards.length || contests.length) {
    body.append(sectionTitle('Твои вызовы'), h('div', { class: 'stack-sm' },
      contests.map(c => contestCard(c, { go: ctx.go })), cards.map(d => duelCard(d, { state, onChange: redraw }))));
  } else {
    body.append(h('p', { class: 'small bold muted', style: { margin: '10px 4px 0' } },
      'Вызови друга на привычку один на один или собери компанию и соревнуйтесь по очкам — кто больше сделает за неделю.'));
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
