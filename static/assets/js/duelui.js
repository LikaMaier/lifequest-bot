// Вызовы привычек с друзьями: дуэль (кто чаще) и «вместе» (общая серия).
// Карточка вызова, окно «Бросить вызов», ссылка для тех, кого ещё нет в боте.

import { h, plural } from './dom.js';
import { api } from './api.js';
import { haptic, openTgLink } from './tg.js';
import { mascot } from './mascot.js';
import { sheet, toast, toastError, busy, confetti } from './ui.js';
import { refreshState } from './store.js';

export const MODE_INFO = {
  duel: { emoji: '⚔️', title: 'Дуэль', hint: 'Кто чаще выполнит привычку — получит шапочку для маскота 🎩' },
  team: { emoji: '🤝', title: 'Вместе', hint: 'Общая серия: день засчитан, только если сделали оба' },
};

const dayWord = n => plural(n, 'день', 'дня', 'дней');

export function duelLink(state, id) {
  return state.bot_username ? `https://t.me/${state.bot_username}?start=d_${id}` : '';
}

export function shareDuel(state, d) {
  const link = duelLink(state, d.id);
  const text = d.mode === 'team'
    ? `Давай вместе держать привычку «${d.emoji} ${d.title}» ${d.days} ${dayWord(d.days)}? Общая серия — не подведи 🔥`
    : `Вызываю тебя на дуэль: «${d.emoji} ${d.title}» ${d.days} ${dayWord(d.days)}. Кто чаще — тот победил ⚔️`;
  haptic.tap();
  openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
}

function cells(side, days, team) {
  const size = days <= 7 ? 'l' : days <= 14 ? 'm' : 's';
  return h('div', { class: `duel-cells ${size}`, 'aria-hidden': 'true' }, side.days.map((x, i) =>
    h('i', { class: `${x.state} ${team && team[i] ? 'joint' : ''}` })));
}

function sideRow(side, { me, days, team, lead }) {
  return h('div', { class: `duel-side ${me ? 'me' : ''} ${lead ? 'lead' : ''}` },
    h('div', { class: 'duel-pet' }, mascot(side.mascot || 'cat-purple', side.today_done ? 'happy' : 'wink', { size: 38, acc: side.accessory })),
    h('div', { class: 'grow' },
      h('div', { class: 'duel-name' }, me ? 'Ты' : side.name, side.today_done ? h('span', { class: 'duel-ok' }, ' ✓ сегодня') : null),
      cells(side, days, team)),
    h('div', { class: 'duel-score' }, h('b', null, String(side.score)), h('span', null, lead ? '👑' : `из ${days}`)));
}

/** Выигранная шапочка: маскот уже в ней и кнопка «Надеть». */
function prizeRow(prize, state) {
  const me = state && state.user;
  const worn = me && me.accessory === prize.id;
  const wear = h('button', { type: 'button', class: 'cal2-pill', disabled: worn }, worn ? 'Надета ✓' : '🎩 Надеть');
  wear.addEventListener('click', busy(wear, async () => {
    try {
      await api.equip(prize.id);
      haptic.success();
      wear.textContent = 'Надета ✓';
      wear.disabled = true;
      toast(`«${prize.name}» уже на маскоте 🎩`, 'good');
      refreshState().catch(() => {});
    } catch (e) { toastError(e); }
  }));
  return h('div', { class: 'duel-prize' },
    h('div', { class: 'duel-prize-pet' }, mascot((me && me.mascot) || 'cat-purple', 'happy', { size: 56, acc: prize.id })),
    h('div', { class: 'grow' }, h('div', { class: 'duel-kicker' }, 'Награда за победу'), h('b', null, prize.name)),
    wear);
}

/** Карточка вызова. */
export function duelCard(d, { state, onChange } = {}) {
  const info = MODE_INFO[d.mode] || MODE_INFO.duel;
  const card = h('section', { class: `duel-card ${d.mode} ${d.status}` });
  const act = async (action, okText) => {
    try {
      const res = await api.duelAction(d.id, action);
      haptic.success();
      if (okText) toast(okText, 'good');
      refreshState().catch(() => {});
      onChange && onChange(res.duels);
    } catch (e) { toastError(e); }
  };
  const kicker = d.status === 'active' ? `${info.emoji} ${info.title} · день ${d.day} из ${d.days}`
    : d.status === 'done' ? `${info.emoji} ${info.title} · итог`
    : `${info.emoji} ${info.title} · ${d.days} ${dayWord(d.days)}`;
  card.append(h('div', { class: 'duel-head' },
    h('span', { class: 'duel-emoji', 'aria-hidden': 'true' }, d.emoji || '✨'),
    h('div', { class: 'grow' }, h('div', { class: 'duel-kicker' }, kicker),
      h('div', { class: 'duel-title' }, d.title, d.target > 1 ? h('span', { class: 'duel-target' }, ` · ${d.target} раз в день`) : null))));

  if (d.status === 'pending') {
    if (d.mine) {
      card.append(h('p', { class: 'duel-note' }, d.rival ? `Ждём ответа от ${d.rival.name}…` : 'Отправь ссылку другу — вызов начнётся, когда он её откроет'));
      const row = h('div', { class: 'duel-actions' });
      if (!d.rival) {
        const share = h('button', { type: 'button', class: 'cal2-pill' }, '📨 Отправить ссылку');
        share.addEventListener('click', () => shareDuel(state, d));
        row.append(share);
      }
      const cancel = h('button', { type: 'button', class: 'cal2-pill ghost' }, 'Отменить');
      cancel.addEventListener('click', busy(cancel, () => act('decline', 'Вызов отменён')));
      row.append(cancel);
      card.append(row);
    } else {
      card.append(h('p', { class: 'duel-note' }, `${d.rival ? d.rival.name : 'Друг'} зовёт тебя: ${info.hint.toLowerCase()}`));
      const yes = h('button', { type: 'button', class: 'cal2-pill' }, '✅ Принимаю');
      yes.addEventListener('click', busy(yes, async () => { await act('accept', 'Вызов принят! Привычка уже в твоём списке 💪'); confetti(60); }));
      const no = h('button', { type: 'button', class: 'cal2-pill ghost' }, 'Не сейчас');
      no.addEventListener('click', busy(no, () => act('decline')));
      card.append(h('div', { class: 'duel-actions' }, yes, no));
    }
    return card;
  }

  const team = d.mode === 'team' ? d.team && d.team.days : null;
  const leadMe = d.mode === 'duel' && d.lead === 'me' && d.me.score > 0;
  const leadRival = d.mode === 'duel' && d.lead === 'rival';
  card.append(sideRow(d.me, { me: true, days: d.days, team, lead: leadMe }));
  if (d.rival) card.append(sideRow(d.rival, { days: d.days, team, lead: leadRival }));

  if (d.mode === 'team' && d.team) {
    card.append(h('div', { class: 'duel-team' }, h('span', { class: 'duel-fire', 'aria-hidden': 'true' }, '🔥'),
      h('span', { class: 'grow' }, h('b', null, `Общая серия ${d.team.streak} ${dayWord(d.team.streak)}`),
        h('span', null, `вместе ${d.team.joint} из ${d.days}`))));
  }

  if (d.status === 'done') {
    let text;
    if (d.mode === 'team') text = d.team && d.team.joint === d.days ? '🌟 Идеально — все дни вместе!' : `🎉 Вместе ${d.team ? d.team.joint : 0} из ${d.days} дней`;
    else text = d.winner == null ? '🤝 Ничья' : d.winner === d.me.id ? '🏆 Победа твоя!' : `💪 Победа у ${d.rival ? d.rival.name : 'соперника'}`;
    card.append(h('div', { class: 'duel-result' }, text));
    if (d.mode === 'duel' && d.winner === d.me.id && d.prize) card.append(prizeRow(d.prize, state));
    return card;
  }

  // статус-строка: кто впереди и что сделать сегодня
  let line;
  if (d.mode === 'team') {
    line = d.me.today_done && d.rival.today_done ? 'Сегодня оба молодцы — серия растёт!'
      : d.me.today_done ? `Твоя часть сделана — ждём ${d.rival.name}`
      : d.rival.today_done ? `${d.rival.name}: своя часть ✓ — твоя очередь!` : 'Сегодня ещё никто не отметил';
  } else {
    line = d.lead === 'me' ? `Ты впереди на ${d.me.score - d.rival.score}` : d.lead === 'rival' ? `${d.rival.name} впереди на ${d.rival.score - d.me.score} — догоняй!` : 'Пока ничья';
  }
  const row = h('div', { class: 'duel-actions' }, h('span', { class: 'duel-line grow' }, line));
  if (d.can_nudge) {
    const nudge = h('button', { type: 'button', class: 'cal2-pill' }, '👉 Пнуть');
    nudge.setAttribute('aria-label', `Напомнить ${d.rival.name}`);
    nudge.addEventListener('click', busy(nudge, () => act('nudge', `Пинок отправлен — ${d.rival.name} получит напоминание в боте`)));
    row.append(nudge);
  }
  const more = h('button', { type: 'button', class: 'duel-more', 'aria-label': 'Ещё' }, '⋯');
  more.addEventListener('click', () => {
    haptic.tap();
    const s = sheet(h('div'), { label: 'Вызов' });
    const give = h('button', { type: 'button', class: 'btn block ghost' }, d.mode === 'team' ? 'Завершить вызов' : '🏳️ Сдаться');
    give.addEventListener('click', busy(give, async () => { await act('giveup', 'Вызов завершён'); s.close(); }));
    s.setContent(h('div', { class: 'stack' }, h('h2', null, `${d.emoji} ${d.title}`),
      h('p', { class: 'bold muted' }, d.mode === 'team' ? 'Если завершить, общая серия остановится.' : 'Если сдаться, победа достанется сопернику.'), give));
  });
  row.append(more);
  card.append(row);
  return card;
}

/** Яркая карточка идущей дуэли для Главной: «ты VS друг», счёт и действие на сегодня. */
export function duelSpotlight(d, { go, state } = {}) {
  const info = MODE_INFO[d.mode] || MODE_INFO.duel;
  const team = d.mode === 'team';
  const rival = d.rival || { name: 'Друг', score: 0, today_done: false };
  const myTurn = !d.me.today_done && rival.today_done;
  const side = (x, who, lead) => h('div', { class: `dsp-side ${lead ? 'lead' : ''}` },
    h('div', { class: 'dsp-pet' }, mascot(x.mascot || 'cat-purple', x.today_done ? 'happy' : 'wink', { size: 64, acc: x.accessory }),
      lead ? h('span', { class: 'dsp-crown', 'aria-hidden': 'true' }, '👑') : null),
    h('div', { class: 'dsp-name' }, who),
    h('div', { class: 'dsp-score' }, String(x.score)),
    h('div', { class: `dsp-today ${x.today_done ? 'ok' : ''}` }, x.today_done ? '✓ сегодня' : 'ещё нет'));
  const card = h('section', { class: `dsp ${d.mode} ${myTurn ? 'turn' : ''}`, role: 'button', tabindex: '0',
    'aria-label': `${info.title}: ${d.title} с ${rival.name}` });
  card.append(
    h('div', { class: 'dsp-top' },
      h('span', { class: 'dsp-kicker' }, `${info.emoji} ${info.title.toUpperCase()} · ДЕНЬ ${d.day || 1} ИЗ ${d.days}`),
      myTurn ? h('span', { class: 'dsp-badge' }, 'Твой ход!') : null),
    h('div', { class: 'dsp-title' }, `${d.emoji || '✨'} ${d.title}`),
    h('div', { class: 'dsp-vs' },
      side(d.me, 'Ты', !team && d.lead === 'me' && d.me.score > 0),
      h('div', { class: 'dsp-mid', 'aria-hidden': 'true' }, team ? h('span', { class: 'dsp-fire' }, '🔥') : 'VS',
        team && d.team ? h('small', null, `${d.team.streak} ${dayWord(d.team.streak)}`) : null),
      side(rival, rival.name, !team && d.lead === 'rival')));
  const actions = h('div', { class: 'dsp-actions' });
  if (!d.me.today_done && d.me.habit_id) {
    const mark = h('button', { type: 'button', class: 'dsp-btn' }, '✓ Отметить привычку');
    mark.addEventListener('click', busy(mark, async e => {
      e.stopPropagation();
      try {
        await api.logHabit(d.me.habit_id, { delta: 1 });
        haptic.success();
        confetti(50);
        refreshState().catch(() => {});
      } catch (err) { toastError(err); }
    }));
    actions.append(mark);
  } else {
    actions.append(h('span', { class: 'dsp-line' }, team
      ? (rival.today_done ? 'Сегодня вы оба молодцы!' : `Твоя часть сделана — ждём ${rival.name}`)
      : (d.lead === 'me' ? `Ты впереди на ${d.me.score - rival.score}` : d.lead === 'rival' ? `Догоняй: −${rival.score - d.me.score}` : 'Пока ничья — сделай рывок!')));
  }
  if (d.can_nudge) {
    const nudge = h('button', { type: 'button', class: 'dsp-btn ghost' }, '👉 Пнуть');
    nudge.addEventListener('click', busy(nudge, async e => {
      e.stopPropagation();
      try {
        await api.duelAction(d.id, 'nudge');
        haptic.success();
        toast(`Пинок отправлен — ${rival.name} получит напоминание`, 'good');
        refreshState().catch(() => {});
      } catch (err) { toastError(err); }
    }));
    actions.append(nudge);
  }
  card.append(actions);
  const open = () => { haptic.tap(); go && go('friends'); };
  card.addEventListener('click', open);
  card.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
  return card;
}

/** Компактная строка вызова для главной. */
export function duelRow(d, { go } = {}) {
  const info = MODE_INFO[d.mode] || MODE_INFO.duel;
  const score = d.mode === 'team' ? `🔥 ${d.team ? d.team.streak : 0}` : `${d.me.score}:${d.rival ? d.rival.score : 0}`;
  const todo = !d.me.today_done;
  const b = h('button', { type: 'button', class: `duel-row ${todo ? 'todo' : ''}` },
    h('span', { class: 'duel-row-emoji', 'aria-hidden': 'true' }, info.emoji),
    h('span', { class: 'grow' }, h('b', null, `${d.emoji} ${d.title} · ${d.rival ? d.rival.name : ''}`),
      h('span', null, todo ? (d.rival && d.rival.today_done ? `${d.rival.name} уже ✓ — твой ход!` : 'сегодня ещё не отмечено') : 'сегодня ✓')),
    h('span', { class: 'duel-row-score' }, score));
  b.addEventListener('click', () => { haptic.tap(); go && go('friends'); });
  return b;
}

/** Окно «Бросить вызов». friend — выбранный заранее друг (или null). */
export async function openDuelCreator(ctx, { friend = null, friends = null, onDone } = {}) {
  const { state } = ctx;
  const own = (state.habits.items || []).filter(x => x.kind === 'build');
  const s = sheet(h('div'), { label: 'Бросить вызов' });
  if (!own.length) {
    const go = h('button', { type: 'button', class: 'btn block' }, 'Выбрать привычку');
    go.addEventListener('click', async () => { s.close(); (await import('./habitui.js')).openTemplatePicker({}); });
    s.setContent(h('div', { class: 'stack' }, h('h2', null, '⚔️ Бросить вызов'),
      h('p', { class: 'bold muted' }, 'Сначала заведи хотя бы одну привычку — по ней и будете соревноваться.'), go));
    return s;
  }
  let list = friends;
  if (!list) { try { list = (await api.friends()).friends; } catch { list = []; } }
  const form = { habit: own[0].id, mode: 'duel', days: 7, friend: friend ? friend.id : (list[0] ? list[0].id : null) };

  const chipRow = (items, key, render) => {
    const row = h('div', { class: 'duel-chips' });
    const draw = () => row.replaceChildren(...items.map(it => {
      const b = h('button', { type: 'button', class: `duel-chip ${form[key] === it.value ? 'on' : ''}`, 'aria-pressed': String(form[key] === it.value) }, render(it));
      b.addEventListener('click', () => { haptic.select(); form[key] = it.value; draw(); update(); });
      return b;
    }));
    draw();
    return row;
  };
  const modes = h('div', { class: 'duel-modes' });
  const drawModes = () => modes.replaceChildren(...Object.entries(MODE_INFO).map(([k, m]) => {
    const b = h('button', { type: 'button', class: `duel-mode ${form.mode === k ? 'on' : ''}`, 'aria-pressed': String(form.mode === k) },
      h('span', { class: 'duel-mode-emoji', 'aria-hidden': 'true' }, m.emoji), h('b', null, m.title), h('span', null, m.hint));
    b.addEventListener('click', () => { haptic.select(); form.mode = k; drawModes(); update(); });
    return b;
  }));
  drawModes();

  const friendItems = [...list.map(f => ({ value: f.id, f })), { value: null, link: true }];
  const friendRow = chipRow(friendItems, 'friend', it => it.link ? '📨 По ссылке'
    : h('span', { class: 'duel-chip-friend' }, mascot(it.f.mascot, 'wink', { size: 22, acc: it.f.accessory }), it.f.name));
  const save = h('button', { type: 'button', class: 'btn block' });
  const update = () => {
    const f = list.find(x => x.id === form.friend);
    save.textContent = f ? `${MODE_INFO[form.mode].emoji} Бросить вызов: ${f.name}` : '📨 Создать и отправить ссылку';
  };
  update();
  save.addEventListener('click', busy(save, async () => {
    try {
      const res = await api.createDuel({ habit_id: form.habit, mode: form.mode, days: form.days, friend_id: form.friend });
      haptic.success();
      s.close();
      if (form.friend) toast('Вызов отправлен — друг получит его в боте ⚔️', 'good', 2600);
      else shareDuel(state, res.duel);
      onDone && onDone();
    } catch (e) { toastError(e); }
  }));
  s.setContent(h('div', { class: 'stack duel-create' },
    h('h2', null, '⚔️ Бросить вызов'),
    h('div', null, h('div', { class: 'cal2-label' }, 'Привычка'),
      chipRow(own.map(x => ({ value: x.id, x })), 'habit', it => `${it.x.emoji} ${it.x.title}`)),
    h('div', null, h('div', { class: 'cal2-label' }, 'Как соревнуемся'), modes),
    h('div', null, h('div', { class: 'cal2-label' }, 'Сколько дней'),
      chipRow([3, 7, 14, 30].map(n => ({ value: n })), 'days', it => `${it.value} ${dayWord(it.value)}`)),
    h('div', null, h('div', { class: 'cal2-label' }, 'С кем'), friendRow,
      h('p', { class: 'tiny bold muted', style: { marginTop: '6px' } }, 'Друг получит приглашение в боте. По ссылке можно позвать того, кого ещё нет в LifeQuest — вам обоим подарим заморозку.')),
    save));
  return s;
}
