// Друзья: «Брось вызов» и «Квест вдвоём», живая лента друзей с реакциями
// и «подбодрить / пнуть», твои вызовы, лига недели, приглашения.

import { monthlyEntry } from '../monthlyui.js';
import { lazyThumb, openViewer } from '../photoui.js';
import { h, clear, plural } from '../dom.js';
import { haptic, openTgLink } from '../tg.js';
import { api } from '../api.js';
import { mascot } from '../mascot.js';
import { sectionTitle, skeleton, toastError, toast, button, sheet, busy } from '../ui.js';
import { duelCard, openDuelCreator } from '../duelui.js';
import { contestCard, openContestCreator } from '../contestui.js';

let cache = null;

/** Выбор формата вызова: 1 на 1 по привычке (дуэль) или компания с пунктами (соревнование). */
export function openChallengeChooser(ctx, redraw = () => {}, friend = null) {
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
    h('h2', null, friend ? `⚔️ Вызов: ${friend.name}` : '⚔️ Брось вызов'),
    h('p', { class: 'bold muted', style: { margin: '-6px 0 0' } }, 'Выбери формат'),
    option('🤺', 'orange', '1 на 1 по привычке', ['С одним другом и одной привычкой', 'Засчитывается само, когда отмечаешь привычку', 'Дуэль — у кого серия длиннее, или «вместе» — общая серия'],
      async () => { try { openDuelCreator(ctx, { friend, friends: await friendsList(), onDone: () => { cache = null; redraw(); } }); } catch (e) { toastError(e); } }),
    option('🏆', 'purple', 'Компания и несколько пунктов', ['До 20 человек по ссылке', 'Свои пункты: «без сахара», «зарядка», «8000 шагов»', 'Отмечаете каждый день — побеждает тот, у кого больше очков'],
      () => openContestCreator(ctx, { onDone: () => { cache = null; } }))));
  return s;
}

/** Ссылка-приглашение: новичку и пригласившему — бонус. */
export function inviteLink(state, questId = null) {
  if (!state.bot_username) return '';
  const payload = questId ? `q_${questId}_${state.user.id}` : `ref_${state.user.id}`;
  return `https://t.me/${state.bot_username}?start=${payload}`;
}

export function shareInvite(state, quest = null, customText = null) {
  const link = inviteLink(state, quest && quest.id);
  const text = customText || (quest
    ? `Зову тебя на квест в LifeQuest: «${quest.title}». Кто первый?`
    : 'Я играю в LifeQuest — бот подкидывает странные и классные задания. Давай со мной? Будем соревноваться, кто больше успеет 🔥');
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
      const [fr, du, co, fe, lg] = await Promise.all([api.friends(), api.duels(), api.contests(), api.feed().catch(() => ({ events: [], reactions: [], pair: { incoming: [], outgoing: [], active: [] } })), api.league().catch(() => null)]);
      cache = { ...fr, duels: du, contests: co, feed: fe, league: lg };
    } catch (e) { clear(body); toastError(e); return; }
  }
  clear(body);
  const du = cache.duels;

  // Одна кнопка «Брось вызов» — внутри выбор: 1 на 1 по привычке или компания с пунктами
  const co = cache.contests;
  const cta = h('button', { type: 'button', class: 'fr-cta main' }, h('span', { 'aria-hidden': 'true' }, '⚔️'), h('b', null, 'Брось вызов'), h('small', null, 'дуэль или компания'));
  cta.addEventListener('click', () => { haptic.tap(); openChallengeChooser(ctx, redraw); });
  const pairBtn = h('button', { type: 'button', class: 'fr-cta' }, h('span', { 'aria-hidden': 'true' }, '🤝'), h('b', null, 'Квест вдвоём'), h('small', null, 'одно задание на двоих'));
  pairBtn.addEventListener('click', () => { haptic.tap(); openPairCreator(ctx, { friends: cache.friends, onDone: redraw }); });
  body.append(h('div', { class: 'fr-ctas' }, cta, pairBtn));
  body.append(monthlyEntry(state, ctx.go, { friends: true }));

  // Квесты вдвоём: входящие, активные, отправленные
  const pr = cache.feed.pair || { incoming: [], outgoing: [], active: [] };
  const pairs = [...pr.incoming, ...pr.active, ...pr.outgoing];
  if (pairs.length) body.append(sectionTitle('Квесты вдвоём'), h('div', { class: 'stack-sm' }, pairs.map(p => pairCard(p, redraw))));

  const contests = [...co.lobby, ...co.active, ...co.finished.slice(0, 2)];
  const cards = [...du.incoming, ...du.active, ...du.outgoing, ...du.finished.slice(0, 2)];
  if (cards.length || contests.length) {
    body.append(sectionTitle('Твои вызовы'), h('div', { class: 'stack-sm' },
      contests.map(c => contestCard(c, { go: ctx.go })), cards.map(d => duelCard(d, { state, onChange: redraw }))));
  } else {
    body.append(h('p', { class: 'small bold muted', style: { margin: '10px 4px 0' } },
      'Вызови друга на привычку один на один или собери компанию и соревнуйтесь по очкам — кто больше сделает за неделю.'));
  }

  // Лента друзей
  if (cache.friends.length) body.append(sectionTitle('Лента'), feedList(cache.feed, state, redraw));

  const invite = h('div', { class: 'card tinted c-blue', style: { marginTop: '14px' } },
    h('div', { class: 'bold' }, '🎁 Позови друга — вместе веселее'),
    h('p', { class: 'small bold', style: { margin: '4px 0 12px' } }, 'Дуэли, соревнования и лига работают только с друзьями. Бонус обоим — когда друг впервые откроет бота по твоей ссылке.'),
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
  const lg = cache.league;
  if (lg && lg.last && lg.last.fresh) body.append(seasonBanner(lg));
  const seg = h('div', { class: 'segmented', role: 'tablist', style: { marginBottom: '10px' } },
    [['week', 'Неделя'], ['season', `Сезон · ${cap(lg ? lg.label : 'месяц')}`]].map(([key, text]) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-pressed': String(leagueMode === key), 'aria-selected': String(leagueMode === key) }, text);
      b.addEventListener('click', () => { haptic.select(); leagueMode = key; draw(el, ctx); });
      return b;
    }));
  const leagueRows = (list, mode) => h('div', { class: 'stack-sm' }, list.map((f, i) => {
    const row = h(f.me ? 'div' : 'button', { type: f.me ? null : 'button', class: `quest-item ${f.me ? 'c-yellow' : 'c-blue'}`, style: { width: '100%' } },
      h('div', { class: 'bold', style: { width: '22px', textAlign: 'center' } }, i < 3 && f.points ? ['🥇', '🥈', '🥉'][i] : String(i + 1)),
      h('div', { style: { width: '44px', height: '42px', flexShrink: 0 } }, mascot(f.mascot, f.me ? 'happy' : 'wink', { size: 44, acc: f.accessory })),
      h('div', { class: 'grow', style: { textAlign: 'left' } }, h('div', { class: 'q-title' }, f.name, f.champion ? h('span', { class: 'lg-champ', title: 'Чемпион прошлого сезона' }, ' 🏆') : null),
        h('div', { class: 'q-meta' }, mode === 'week' ? `🎯 ${f.week_done || 0} · 🌱 ${f.week_habits || 0} · 📅 ${f.week_plans || 0} · 🔥 ${f.streak}` : `🎯 ${f.quests} · 🌱 ${f.habits} · 📅 ${f.plans}${f.wins ? ` · 🏆 ${f.wins}` : ''}`)),
      h('div', { class: 'center' }, h('div', { class: 'num', style: { fontSize: '22px' } }, String(f.points || 0)),
        h('div', { class: 'tiny bold muted' }, f.me ? plural(f.points || 0, 'очко', 'очка', 'очков') : '⚔️ вызов')));
    if (!f.me) row.addEventListener('click', () => { haptic.tap(); const fr = cache.friends.find(x => x.id === f.id) || f; openChallengeChooser(ctx, redraw, fr); });
    return row;
  }));
  if (leagueMode === 'season' && lg) {
    const byId = new Map(cache.friends.map(f => [f.id, f]));
    const srows = lg.rows.map(r => ({ ...r, name: r.me ? 'Ты' : r.name, mascot: r.me ? state.user.mascot : (byId.get(r.id) || {}).mascot, accessory: r.me ? state.user.accessory : (byId.get(r.id) || {}).accessory }));
    body.append(sectionTitle('Лига · сезон'), seg,
      h('p', { class: 'small bold muted', style: { margin: '-4px 0 10px' } },
        `Очки с 1 ${genitive(lg.label)}. ${lg.days_left ? `До конца сезона ${lg.days_left} ${plural(lg.days_left, 'день', 'дня', 'дней')}.` : 'Сегодня финал сезона!'} За 1–3 место — +${lg.rewards[1]} / +${lg.rewards[2]} / +${lg.rewards[3]} XP, чемпиону — 🏆 у имени на месяц.`),
      leagueRows(srows, 'season'), invite);
  } else {
    body.append(sectionTitle('Лига · неделя'), seg,
      h('p', { class: 'small bold muted', style: { margin: '-4px 0 10px' } },
        `Квест — ${pts.quest} очка, привычка и дело из плана — по ${pts.habit}. ${left ? `До финала ${left} ${plural(left, 'день', 'дня', 'дней')}.` : 'Сегодня финал недели!'} Нажми на друга, чтобы бросить вызов.`),
      leagueRows(rows, 'week'), invite);
  }
}

let leagueMode = 'week';
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';

function seasonBanner(lg) {
  const l = lg.last;
  const medal = l.rank === 1 ? '🏆' : l.rank === 2 ? '🥈' : l.rank === 3 ? '🥉' : '🏁';
  const text = l.rank === 1 ? `Ты чемпион ${genitive(l.label)}!` : `${cap(l.label)}: ты ${l.rank}-е место из ${l.members}`;
  return h('section', { class: 'lg-banner' }, h('span', { class: 'lg-banner-medal', 'aria-hidden': 'true' }, medal),
    h('div', { class: 'grow' }, h('b', null, text), h('span', null, `${l.points} ${plural(l.points, 'очко', 'очка', 'очков')} за сезон${l.xp ? ` · +${l.xp} XP` : ''}`)));
}
const GEN = { 'январь': 'января', 'февраль': 'февраля', 'март': 'марта', 'апрель': 'апреля', 'май': 'мая', 'июнь': 'июня', 'июль': 'июля', 'август': 'августа', 'сентябрь': 'сентября', 'октябрь': 'октября', 'ноябрь': 'ноября', 'декабрь': 'декабря' };
const genitive = m => GEN[m] || m;



// ---------- лента, реакции, пинки ----------
function feedList(feed, state, redraw) {
  const evs = feed.events || [];
  if (!evs.length) return h('div', { class: 'card' }, h('p', { class: 'small bold muted' }, 'Пока тихо: когда друзья сделают квест или соберут серию — увидишь здесь и сможешь отреагировать 🔥'));
  return h('div', { class: 'stack-sm' }, evs.slice(0, 12).map(e => feedItem(e, feed.reactions || ['🔥', '👏', '😂', '💜'], redraw)));
}

function feedItem(e, reactions, redraw) {
  const f = e.friend;
  const when = e.date ? fmtRel(e.date) : '';
  const head = h('div', { class: 'fd-head' },
    h('span', { class: 'fd-ava' }, mascot(f.mascot, e.kind === 'away' ? 'sleepy' : 'happy', { size: 40, acc: f.accessory })),
    h('span', { class: 'grow' }, h('b', null, f.name), h('span', { class: 'fd-what' },
      e.kind === 'quest' ? ` сделал(а) квест` : e.kind === 'streak' ? ` держит серию ${e.streak} дн. 🔥` : ` не заходил(а) ${e.away} дн. 💤`)),
    h('span', { class: 'fd-when' }, when));
  const title = e.kind === 'quest' ? h('div', { class: 'fd-title' }, h('span', { 'aria-hidden': 'true' }, e.emoji), ' ', e.title) : null;
  // Фото к квесту, которые друг открыл для ленты
  const photos = (e.photos || []).length ? h('div', { class: `fd-photos n${Math.min(3, e.photos.length)}` }, e.photos.slice(0, 3).map((p, i) => {
    const b = h('button', { type: 'button', class: 'fd-photo', 'aria-label': `Фото ${i + 1} от ${f.name}` }, lazyThumb(p, e.title));
    if (i === 2 && e.photos.length > 3) b.append(h('span', { class: 'fd-photo-more' }, `+${e.photos.length - 3}`));
    b.addEventListener('click', () => { haptic.tap(); openViewer(e.photos.map(x => ({ ...x, mine: false, can_delete: false, by: f.name })), i); });
    return b;
  })) : null;
  const row = h('div', { class: 'fd-actions' });
  if (e.kind === 'away') {
    const cheer = h('button', { type: 'button', class: 'fd-btn', disabled: !e.can_cheer }, e.can_cheer ? '👋 Подбодрить' : '👋 Отправлено');
    const poke = h('button', { type: 'button', class: 'fd-btn', disabled: !e.can_poke }, e.can_poke ? '👉 Пнуть' : '👉 Отправлено');
    const send = (btn, kind) => busy(btn, async () => {
      try { await api.friendPing(f.id, kind); haptic.success(); toast(kind === 'cheer' ? `👋 ${f.name} получит ободряшку от твоего маскота` : `👉 Пинок улетел к ${f.name}`, 'good'); btn.disabled = true; btn.textContent = btn.textContent.replace(/Подбодрить|Пнуть/, 'Отправлено'); }
      catch (err) { toastError(err); }
    });
    cheer.addEventListener('click', send(cheer, 'cheer')); poke.addEventListener('click', send(poke, 'poke'));
    row.append(cheer, poke);
  } else {
    const counts = Object.fromEntries((e.reactions || []).map(r => [r.emoji, r.count]));
    reactions.forEach(em => {
      const n = counts[em] || 0;
      const b = h('button', { type: 'button', class: `fd-react ${e.mine === em ? 'on' : ''}`, 'aria-pressed': String(e.mine === em) }, em, n ? h('i', null, String(n)) : null);
      b.addEventListener('click', busy(b, async () => {
        const next = e.mine === em ? '' : em;
        try {
          await api.react(e.id, next);
          haptic.tap('soft');
          if (e.mine) counts[e.mine] = Math.max(0, (counts[e.mine] || 1) - 1);
          if (next) counts[next] = (counts[next] || 0) + 1;
          e.mine = next || null;
          row.querySelectorAll('.fd-react').forEach(x => { const em2 = x.firstChild.textContent; x.classList.toggle('on', e.mine === em2); x.setAttribute('aria-pressed', String(e.mine === em2)); const c = counts[em2] || 0; x.querySelector('i')?.remove(); if (c) x.append(h('i', null, String(c))); });
        } catch (err) { toastError(err); }
      }));
      row.append(b);
    });
    if (e.kind === 'streak' && e.friend) {
      const cheer = h('button', { type: 'button', class: 'fd-btn', disabled: !e.can_cheer }, '👋');
      cheer.addEventListener('click', busy(cheer, async () => { try { await api.friendPing(f.id, 'cheer'); haptic.success(); toast(`👋 ${f.name} получит ободряшку`, 'good'); cheer.disabled = true; } catch (err) { toastError(err); } }));
      row.append(cheer);
    }
  }
  return h('article', { class: `fd-item k-${e.kind}` }, head, title, photos, row);
}

function fmtRel(iso) {
  const d = new Date(iso + 'T00:00:00'); const t = new Date(); t.setHours(0, 0, 0, 0);
  const days = Math.round((t - d) / 864e5);
  return days <= 0 ? 'сегодня' : days === 1 ? 'вчера' : `${days} дн. назад`;
}

// ---------- квест вдвоём ----------
function pairCard(p, redraw) {
  const f = p.friend;
  const act = async (action, btn) => { try { await api.pairAction(p.id, action); haptic.success(); redraw(); } catch (err) { toastError(err); } };
  const buttons = [];
  if (p.status === 'pending' && !p.mine) {
    const ok = h('button', { type: 'button', class: 'btn small' }, 'Принять'); ok.addEventListener('click', busy(ok, () => act('accept')));
    const no = h('button', { type: 'button', class: 'btn ghost small' }, 'Не сейчас'); no.addEventListener('click', busy(no, () => act('decline')));
    buttons.push(ok, no);
  } else if (p.status === 'pending') {
    const c = h('button', { type: 'button', class: 'btn ghost small' }, 'Отменить'); c.addEventListener('click', busy(c, () => act('cancel'))); buttons.push(c);
  } else if (p.status === 'active') {
    if (!p.me_done) { const d = h('button', { type: 'button', class: 'btn small' }, '✅ Я сделал(а)'); d.addEventListener('click', busy(d, () => act('done'))); buttons.push(d); }
    if (p.mine) { const c = h('button', { type: 'button', class: 'btn ghost small' }, 'Отменить'); c.addEventListener('click', busy(c, () => act('cancel'))); buttons.push(c); }
  }
  const status = p.status === 'pending' ? (p.mine ? `ждём ответа от ${f.name}` : `${f.name} зовёт тебя`)
    : p.me_done && !p.friend_done ? `ты ✓ · ждём ${f.name}` : !p.me_done && p.friend_done ? `${f.name} ✓ · твоя очередь` : 'сделайте оба — и +XP';
  return h('section', { class: 'card tinted c-lav pair-card' },
    h('div', { class: 'row', style: { gap: '10px', alignItems: 'center' } },
      h('span', { style: { width: '40px', height: '40px', flexShrink: 0 } }, mascot(f.mascot, 'wink', { size: 40, acc: f.accessory })),
      h('div', { class: 'grow' }, h('div', { class: 'tiny bold', style: { opacity: .75 } }, `🤝 КВЕСТ ВДВОЁМ · +${p.bonus_xp} XP КАЖДОМУ`),
        h('div', { class: 'bold' }, `${p.emoji} ${p.title}`), h('div', { class: 'small bold muted' }, status))),
    p.text ? h('p', { class: 'small bold', style: { margin: '8px 0 0' } }, p.text) : null,
    buttons.length ? h('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } }, buttons) : null);
}

export function openPairCreator(ctx, { friends = [], onDone = () => {} } = {}) {
  const s = sheet(h('div'), { label: 'Квест вдвоём' });
  if (!friends.length) {
    s.setContent(h('div', { class: 'stack' }, h('h2', null, '🤝 Квест вдвоём'),
      h('p', { class: 'bold muted' }, 'Нужен хотя бы один друг в LifeQuest. Позови — и сразу зовите друг друга на задания.'),
      button('Позвать друга', { cls: 'block', onClick: () => { s.close(); shareInvite(ctx.state); } })));
    return s;
  }
  let picked = friends[0];
  const list = h('div', { class: 'stack-sm' });
  const paint = () => { clear(list); friends.forEach(f => {
    const b = h('button', { type: 'button', class: `quest-item ${picked.id === f.id ? 'c-lav' : 'c-blue'}`, style: { width: '100%' }, 'aria-pressed': String(picked.id === f.id) },
      h('span', { style: { width: '40px', height: '40px', flexShrink: 0 } }, mascot(f.mascot, 'happy', { size: 40, acc: f.accessory })),
      h('span', { class: 'grow', style: { textAlign: 'left' } }, h('span', { class: 'q-title' }, f.name), h('span', { class: 'q-meta', style: { display: 'block' } }, `🔥 ${f.streak} · ур. ${f.level}`)),
      picked.id === f.id ? h('span', null, '✓') : null);
    b.addEventListener('click', () => { haptic.select(); picked = f; paint(); });
    list.append(b);
  }); };
  paint();
  const go = h('button', { type: 'button', class: 'btn block' }, '🎲 Случайный парный квест');
  go.addEventListener('click', busy(go, async () => {
    try { const r = await api.pairCreate(picked.id); haptic.success(); s.close(); toast(`🤝 ${picked.name} получит приглашение на «${r.pair.title}»`, 'good', 3000); onDone(); }
    catch (err) { toastError(err); }
  }));
  s.setContent(h('div', { class: 'stack' }, h('h2', null, '🤝 Квест вдвоём'),
    h('p', { class: 'bold muted', style: { margin: '-6px 0 0' } }, `Одно задание на двоих. Засчитается, когда сделаете оба — и каждому +20 XP.`),
    list, go));
  return s;
}
