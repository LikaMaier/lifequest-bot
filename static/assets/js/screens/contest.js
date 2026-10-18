// Экран соревнования. Лобби: участники, пункты, шаблоны, предложения,
// запуск. После запуска правила заморожены 🔒: отметки за сегодня, таблица
// лидеров. В конце — итоги.

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { mascot } from '../mascot.js';
import { sectionTitle, skeleton, toast, toastError, busy, modal, sheet, confetti } from '../ui.js';
import { refreshState } from '../store.js';
import { openPaywall } from '../premium.js';
import { ICONS } from '../icons.js';
import {
  currentContestId, shareContest, statusLabel, openItemForm, dayWord, pointsWord,
} from '../contestui.js';

let data = null; // { contest, templates }
let fetchedAt = 0;

export async function render(el, ctx) {
  data = null;
  return draw(el, ctx);
}

export async function update(el, ctx) {
  // Обновилось общее состояние (например, вернулись в приложение) — перечитаем
  // соревнование: его меняют и другие участники. Сразу после своего действия не нужно.
  if (Date.now() - fetchedAt < 4000) return;
  return draw(el, ctx, { refetch: true, quiet: true });
}

async function draw(el, ctx, { refetch = false, quiet = false } = {}) {
  const id = currentContestId();
  if (!id) { ctx.go('friends', { replace: true }); return; }
  if (!data || refetch || data.contest.id !== id) {
    if (!quiet || !data) { clear(el); el.append(skeleton(120), h('div', { style: { height: '12px' } }), skeleton(220)); }
    try {
      const [one, list] = await Promise.all([api.contest(id), data ? Promise.resolve({ templates: data.templates }) : api.contests()]);
      data = { contest: one.contest, templates: list.templates || [] };
      fetchedAt = Date.now();
    } catch (e) {
      clear(el).append(h('div', { class: 'card', style: { marginTop: '12px' } }, h('p', { class: 'bold' }, e.message)));
      return;
    }
  }
  paint(el, ctx);
}

/** Применить ответ API ({contest}) и перерисовать. */
function apply(el, ctx, res) {
  if (res && res.contest) { data.contest = res.contest; fetchedAt = Date.now(); }
  paint(el, ctx);
  refreshState().catch(() => {});
}

function paint(el, ctx) {
  const c = data.contest;
  clear(el);
  el.append(head(c));
  if (c.status === 'lobby') lobby(el, ctx, c);
  else if (c.status === 'active') active(el, ctx, c);
  else finished(el, ctx, c);
}

function head(c) {
  const sub = c.status === 'lobby'
    ? `${c.days} ${dayWord(c.days)} · создатель ${c.mine ? '— ты' : c.creator.name}`
    : c.start ? `${fmt(c.start)} — ${fmt(c.end)} · ${c.members_count} ${plural(c.members_count, 'участник', 'участника', 'участников')}` : '';
  return h('header', { class: `ct-head ${c.status}` },
    h('span', { class: 'ct-head-emoji', 'aria-hidden': 'true' }, c.emoji || '🏆'),
    h('div', { class: 'grow' },
      h('div', { class: 'ct-kicker' }, statusLabel(c)),
      h('h1', null, c.title),
      sub ? h('p', null, sub) : null));
}

function fmt(iso) {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

// ==================== ЛОББИ ====================
function lobby(el, ctx, c) {
  const { state } = ctx;
  // Участники
  const invite = h('button', { type: 'button', class: 'cal2-pill dark' }, '📨 Пригласить');
  invite.addEventListener('click', () => shareContest(state, c));
  el.append(h('section', { class: 'ct-block' },
    h('div', { class: 'spread' }, h('h2', null, `Участники · ${c.members_count}`), invite),
    h('div', { class: 'ct-members' }, c.board.map(m => h('div', { class: 'ct-member' },
      h('div', { class: 'ct-member-pet' }, mascot(m.mascot || 'cat-purple', 'happy', { size: 44, acc: m.accessory })),
      h('span', null, m.id === state.user.id ? 'Ты' : m.name),
      m.id === c.creator.id ? h('span', { class: 'ct-owner' }, 'создатель') : null))),
    c.members_count < c.limits.min_members
      ? h('p', { class: 'ct-hint' }, 'Нужен хотя бы ещё один участник — отправь ссылку другу.') : null,
    h('p', { class: 'ct-hint' }, '🔒 После запуска новых участников не будет — зови всех заранее.')));

  // Пункты
  const items = h('section', { class: 'ct-block' },
    h('div', { class: 'spread' }, h('h2', null, 'Пункты соревнования'),
      h('span', { class: 'tag c-paleyellow' }, `${c.items.length}/${c.limits.items}`)));
  if (!c.items.length) {
    items.append(h('p', { class: 'ct-hint' }, c.mine ? 'Пока пусто. Возьми готовый набор или добавь свой пункт.' : `${c.creator.name} ещё собирает правила. Можешь предложить свой пункт 👇`));
  }
  items.append(h('div', { class: 'stack-sm' }, c.items.map(it => itemRow(it, c.mine ? [
    ['✏️', `Изменить: ${it.title}`, () => openItemForm({ mode: 'edit', item: it, submit: async v => apply(el, ctx, await api.contestUpdateItem(c.id, it.id, v)) })],
    ['🗑', `Удалить: ${it.title}`, async () => apply(el, ctx, await api.contestDeleteItem(c.id, it.id))],
  ] : []))));
  if (c.mine) {
    const full = c.items.length >= c.limits.items;
    const add = h('button', { type: 'button', class: 'btn block ghost', style: { marginTop: '10px' } }, '＋ Добавить свой пункт');
    add.addEventListener('click', () => {
      if (full) { limitHit(c); return; }
      haptic.tap();
      openItemForm({ mode: 'add', submit: async v => apply(el, ctx, await api.contestAddItem(c.id, v)) });
    });
    items.append(add,
      h('div', { class: 'cal2-label', style: { marginTop: '14px' } }, 'Готовые наборы'),
      h('div', { class: 'ct-templates' }, data.templates.map(t => {
        const b = h('button', { type: 'button', class: 'ct-template' },
          h('span', { class: 'ct-template-emoji', 'aria-hidden': 'true' }, t.emoji),
          h('b', null, t.title),
          h('span', null, t.items.map(x => x.title).join(', ')));
        b.addEventListener('click', busy(b, async () => {
          haptic.tap();
          try {
            const res = await api.contestTemplate(c.id, t.id);
            toast(res.note || `Добавлено: ${res.added} ${plural(res.added, 'пункт', 'пункта', 'пунктов')}. Их можно поправить ✏️`, 'good', 2600);
            apply(el, ctx, res);
          } catch (e) { e.code === 'contest_items' ? limitHit(c) : toastError(e); }
        }));
        return b;
      })));
  } else {
    const propose = h('button', { type: 'button', class: 'btn block colored c-yellow', style: { marginTop: '10px' } }, '💡 Предложить пункт');
    propose.addEventListener('click', () => {
      haptic.tap();
      openItemForm({ mode: 'propose', submit: async v => {
        const res = await api.contestPropose(c.id, v);
        toast('Отправлено создателю на рассмотрение', 'good');
        apply(el, ctx, res);
      } });
    });
    items.append(propose);
  }
  el.append(items);

  // Предложения
  if (c.proposals.length) {
    const box = h('section', { class: 'ct-block ct-proposals' },
      h('h2', null, c.mine ? `Предложения · ${c.proposals.length}` : 'Твои предложения'));
    box.append(h('div', { class: 'stack-sm' }, c.proposals.map(p => {
      if (!c.mine) return itemRow(p, [], h('span', { class: 'tag c-lav' }, 'ждёт ответа'));
      const decide = async (accept, item = null) => {
        const res = await api.contestDecide(c.id, p.id, accept, item);
        toast(accept ? 'Пункт добавлен ✓' : 'Предложение отклонено', accept ? 'good' : '', 2000);
        apply(el, ctx, res);
      };
      const tap = accept => async () => {
        try { await decide(accept); } catch (e) { e.code === 'contest_items' ? limitHit(c) : toastError(e); }
      };
      const yes = h('button', { type: 'button', class: 'cal2-pill small', 'aria-label': `Принять: ${p.title}` }, '✅ Принять');
      const edit = h('button', { type: 'button', class: 'cal2-pill small ghost', 'aria-label': `Принять с правкой: ${p.title}` }, '✏️ С правкой');
      const no = h('button', { type: 'button', class: 'cal2-pill small ghost', 'aria-label': `Отклонить: ${p.title}` }, '❌');
      yes.addEventListener('click', busy(yes, tap(true)));
      no.addEventListener('click', busy(no, tap(false)));
      edit.addEventListener('click', () => { haptic.tap(); openItemForm({ mode: 'review', item: p, submit: v => decide(true, v) }); });
      return h('div', { class: 'ct-proposal' },
        h('div', { class: 'ct-proposal-by' }, `💡 ${p.by} предлагает`),
        itemRow(p, []),
        h('div', { class: 'duel-actions' }, yes, edit, no));
    })));
    el.append(box);
  }

  // Запуск / выход
  const foot = h('section', { class: 'ct-block ct-foot' });
  // Запустить может любой участник в любой момент — хватит и одного пункта
  if (c.member) {
    const missing = !c.items.length ? (c.mine ? 'Добавь хотя бы один пункт' : 'Ждём хотя бы один пункт — предложи свой')
      : c.members_count < c.limits.min_members ? 'Нужно хотя бы 2 участника' : '';
    const go = h('button', { type: 'button', class: 'btn block', disabled: Boolean(missing) }, '🚀 Запустить');
    go.addEventListener('click', () => { haptic.tap(); confirmLaunch(el, ctx, c); });
    foot.append(go);
    if (missing) foot.append(h('p', { class: 'ct-hint center' }, missing));
  }
  if (c.lobby_days_left !== undefined) {
    foot.append(h('p', { class: 'ct-hint center' }, c.lobby_days_left > 0
      ? `Если не запустить, черновик удалится через ${c.lobby_days_left} ${dayWord(c.lobby_days_left)}.`
      : 'Черновик скоро удалится — запусти соревнование.'));
  }
  const leave = h('button', { type: 'button', class: 'btn block ghost small' }, c.mine ? 'Отменить соревнование' : 'Выйти из лобби');
  leave.addEventListener('click', () => confirmLeave(el, ctx, c));
  foot.append(leave);
  el.append(foot);
}

function itemRow(it, actions = [], extra = null) {
  return h('div', { class: 'ct-item' },
    h('span', { class: 'ct-item-emoji', 'aria-hidden': 'true' }, it.emoji || '✅'),
    h('div', { class: 'grow' },
      h('div', { class: 'ct-item-title' }, it.title),
      h('div', { class: 'ct-item-rule' }, it.kind === 'count' ? `🔢 ${it.rule}` : `☑️ ${it.rule}`,
        it.proposed_by ? ` · идея: ${it.proposed_by}` : '')),
    extra,
    actions.map(([icon, label, fn]) => {
      const b = h('button', { type: 'button', class: 'ct-icon-btn', 'aria-label': label }, icon);
      b.addEventListener('click', busy(b, async () => { haptic.tap(); try { await fn(); } catch (e) { toastError(e); } }));
      return b;
    }));
}

function limitHit(c) {
  if (c.limits.items < 10) {
    toast(`Бесплатно — до ${c.limits.items} пунктов. В Premium — до 10 💛`, 'bad', 3000);
    openPaywall('contest');
  } else {
    toast(`Больше ${c.limits.items} пунктов не поместится`, 'bad');
  }
}

// ---------- Экран 5: подтверждение запуска ----------
function confirmLaunch(el, ctx, c) {
  const yes = h('button', { type: 'button', class: 'btn block' }, '🚀 Запустить');
  const back = h('button', { type: 'button', class: 'btn block ghost', style: { marginTop: '8px' } }, 'Назад к настройке');
  const m = modal(h('div', { class: 'ct-launch' },
    h('h2', null, 'Запускаем?'),
    h('p', { class: 'bold muted' }, `${c.days} ${dayWord(c.days)}, с сегодняшнего дня · ${c.members_count} ${plural(c.members_count, 'участник', 'участника', 'участников')}`),
    h('div', { class: 'ct-launch-items' }, c.items.map(it => h('div', null, `${it.emoji} ${it.title} — ${it.rule}`))),
    h('div', { class: 'ct-lock' }, '🔒 После запуска пункты нельзя будет изменить, а новых участников — добавить.'),
    yes, back), { label: 'Запуск соревнования' });
  back.addEventListener('click', () => m.close());
  yes.addEventListener('click', busy(yes, async () => {
    try {
      const res = await api.contestLaunch(c.id);
      m.close();
      launched(el, ctx, res);
    } catch (e) {
      if (e.code === 'proposals') { m.close(); askProposals(el, ctx, c, e.message); } else toastError(e);
    }
  }));
}

function askProposals(el, ctx, c, text) {
  const review = h('button', { type: 'button', class: 'btn block' }, c.mine ? 'Рассмотреть' : 'Подождать');
  const skip = h('button', { type: 'button', class: 'btn block ghost', style: { marginTop: '8px' } }, 'Запустить без них');
  const note = c.mine ? `${text} Если запустить сейчас, они будут отклонены.`
    : `${c.creator.name} ещё не ответил(а) на предложения. Если запустить сейчас, они не войдут в правила.`;
  const m = modal(h('div', null, h('h2', null, '💡 Есть предложения'),
    h('p', { class: 'bold muted', style: { margin: '6px 0 14px' } }, note),
    review, skip), { label: 'Предложения без ответа' });
  review.addEventListener('click', () => {
    m.close();
    const box = el.querySelector('.ct-proposals');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  skip.addEventListener('click', busy(skip, async () => {
    try { const res = await api.contestLaunch(c.id, true); m.close(); launched(el, ctx, res); } catch (e) { toastError(e); }
  }));
}

function launched(el, ctx, res) {
  haptic.success();
  confetti(90);
  toast('Соревнование началось! Все получили правила в боте 🔥', 'good', 3000);
  window.scrollTo(0, 0);
  apply(el, ctx, res);
}

function confirmLeave(el, ctx, c) {
  haptic.warning();
  const lobbyText = c.mine ? 'Лобби закроется, участники получат сообщение.' : 'Вернуться можно будет по ссылке, пока соревнование не запущено.';
  const yes = h('button', { type: 'button', class: 'btn block' }, c.mine && c.status === 'lobby' ? 'Да, отменить' : c.status === 'active' ? 'Да, сдаюсь' : 'Да, выйти');
  const no = h('button', { type: 'button', class: 'btn block ghost', style: { marginTop: '8px' } }, 'Нет, остаюсь');
  const m = modal(h('div', null,
    h('h2', null, c.status === 'active' ? 'Сдаться?' : c.mine ? 'Отменить соревнование?' : 'Выйти из лобби?'),
    h('p', { class: 'bold muted', style: { margin: '6px 0 14px' } },
      c.status === 'active' ? 'Ты выбываешь из таблицы, а вернуться уже не получится — двери закрыты 🔒' : lobbyText),
    yes, no), { label: 'Подтверждение' });
  no.addEventListener('click', () => m.close());
  yes.addEventListener('click', busy(yes, async () => {
    try {
      await api.contestLeave(c.id);
      m.close();
      refreshState().catch(() => {});
      if (c.status === 'active') { data = null; draw(el, ctx); } else ctx.go('friends', { replace: true, fresh: true });
    } catch (e) { toastError(e); }
  }));
}

// ==================== ИДЁТ ====================
function active(el, ctx, c) {
  const me = c.me;
  if (me && !me.left) {
    const today = h('section', { class: 'ct-block ct-today' },
      h('div', { class: 'spread' }, h('h2', null, 'Сегодня'),
        h('span', { class: `tag ${me.all_today ? 'c-lime' : 'c-paleyellow'}` }, me.all_today ? 'всё ✓' : `${me.done_today}/${c.items.length}`)));
    if (c.not_started) today.append(h('p', { class: 'ct-hint' }, 'Соревнование стартует завтра по твоему времени — тогда и отмечай.'));
    else today.append(h('div', { class: 'stack-sm' }, c.items.map(it => markRow(el, ctx, c, it))));
    el.append(today);
  }

  el.append(sectionTitle('Таблица лидеров'), board(c, ctx.state));
  el.append(rules(c));

  if (me && !me.left) {
    const give = h('button', { type: 'button', class: 'btn block ghost small', style: { marginTop: '14px' } }, '🏳️ Сдаться');
    give.addEventListener('click', () => confirmLeave(el, ctx, c));
    el.append(give);
  }
}

function markRow(el, ctx, c, it) {
  const value = Number(c.me.today[String(it.id)] || 0);
  const send = async v => {
    try { apply(el, ctx, await api.contestLog(c.id, it.id, v)); } catch (e) { toastError(e); }
  };
  if (it.kind === 'check') {
    const on = value > 0;
    const btn = h('button', { type: 'button', class: `hb2-check ${on ? 'on' : ''}`, 'aria-pressed': String(on),
      'aria-label': on ? `Снять отметку: ${it.title}` : `Отметить: ${it.title}`, html: ICONS.check });
    btn.addEventListener('click', busy(btn, async () => { on ? haptic.tap() : haptic.success(); await send(on ? 0 : 1); }));
    return h('div', { class: `ct-mark ${on ? 'done' : ''}` },
      h('span', { class: 'ct-item-emoji', 'aria-hidden': 'true' }, it.emoji),
      h('div', { class: 'grow' }, h('div', { class: 'ct-item-title' }, it.title), h('div', { class: 'ct-item-rule' }, `+${it.points} за день`)),
      btn);
  }
  const done = value >= (it.norm || 1);
  const minus = h('button', { type: 'button', class: 'hb2-step', 'aria-label': `Минус один: ${it.title}`, html: ICONS.minus, disabled: value <= 0 });
  const plus = h('button', { type: 'button', class: 'hb2-step plus', 'aria-label': `Плюс один: ${it.title}`, html: ICONS.plus });
  const num = h('button', { type: 'button', class: 'ct-num', 'aria-label': `Ввести число: ${it.title}` }, it.norm ? `${value}/${it.norm}` : String(value));
  minus.addEventListener('click', busy(minus, async () => { haptic.select(); await send(value - 1); }));
  plus.addEventListener('click', busy(plus, async () => { haptic.select(); await send(value + 1); }));
  num.addEventListener('click', () => { haptic.tap(); numberSheet(it, value, send); });
  const row = h('div', { class: `ct-mark ${done ? 'done' : ''}` },
    h('span', { class: 'ct-item-emoji', 'aria-hidden': 'true' }, it.emoji),
    h('div', { class: 'grow' }, h('div', { class: 'ct-item-title' }, it.title),
      h('div', { class: 'ct-item-rule' }, `+${it.points} за единицу${it.norm ? ` · норма ${it.norm} ${it.unit}` : ` · ${it.unit}`}`)),
    h('div', { class: 'hb2-counter' }, minus, num, plus));
  if (it.norm) row.append(h('div', { class: 'hb2-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.min(1, value / it.norm) * 100}%` } })));
  return row;
}

function numberSheet(it, value, send) {
  const s = sheet(h('div'), { label: it.title });
  const input = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: '0', value: String(value), 'aria-label': `Сколько за сегодня, ${it.unit}` });
  const quick = h('div', { class: 'duel-chips' }, [1, 5, 10, 25].map(n => {
    const b = h('button', { type: 'button', class: 'duel-chip' }, `+${n}`);
    b.addEventListener('click', () => { haptic.select(); input.value = String((Number(input.value) || 0) + n); });
    return b;
  }));
  const save = h('button', { type: 'button', class: 'btn block' }, 'Сохранить');
  save.addEventListener('click', busy(save, async () => {
    const v = Math.max(0, Math.floor(Number(input.value) || 0));
    await send(v);
    s.close();
  }));
  s.setContent(h('div', { class: 'stack' },
    h('h2', null, `${it.emoji} ${it.title}`),
    h('div', { class: 'field' }, h('span', { class: 'label' }, `Всего за сегодня, ${it.unit}`), input),
    quick, save));
  setTimeout(() => { input.focus({ preventScroll: true }); input.select(); }, 120);
}

function board(c, state) {
  const medals = ['🥇', '🥈', '🥉'];
  const total = c.items.length;
  return h('div', { class: 'stack-sm' }, c.board.map(r => {
    const me = r.id === state.user.id;
    const won = c.status === 'done' && c.winners.includes(r.id);
    return h('div', { class: `ct-row ${me ? 'me' : ''} ${r.left ? 'left' : ''} ${won ? 'won' : ''}` },
      h('div', { class: 'ct-place' }, r.left ? '—' : r.place <= 3 && r.score > 0 ? medals[r.place - 1] : String(r.place)),
      h('div', { class: 'ct-row-pet' }, mascot(r.mascot || 'cat-purple', r.all_today || won ? 'happy' : 'wink', { size: 40, acc: r.accessory })),
      h('div', { class: 'grow' },
        h('div', { class: 'ct-row-name' }, me ? 'Ты' : r.name, won ? ' 🏆' : ''),
        h('div', { class: 'ct-row-sub' }, r.left ? 'сдался(ась)'
          : c.status === 'active' ? (r.all_today ? `сегодня всё ✓` : `сегодня ${r.done_today}/${total}`)
          : c.items.map(it => `${it.emoji} ${r.totals[String(it.id)] || 0}`).join('  '))),
      h('div', { class: 'ct-score' }, h('b', null, String(r.score)), h('span', null, pointsWord(r.score))));
  }));
}

function rules(c) {
  const box = h('details', { class: 'ct-rules' },
    h('summary', null, `🔒 Правила · ${c.items.length} ${plural(c.items.length, 'пункт', 'пункта', 'пунктов')}`),
    h('div', { class: 'stack-sm', style: { marginTop: '10px' } }, c.items.map(it => itemRow(it))),
    h('p', { class: 'ct-hint' }, 'Правила заморожены при запуске. Отмечать можно только сегодняшний день — до полуночи по твоему времени.'));
  return box;
}

// ==================== ИТОГИ ====================
function finished(el, ctx, c) {
  const me = c.me;
  let text;
  if (c.status === 'cancelled') text = 'Соревнование отменено';
  else if (me && c.winners.includes(me.id)) text = c.winners.length > 1 ? '🏆 Победа — первое место разделено!' : '🏆 Победа! Новая шапочка — в Магазине 🎩';
  else if (!c.winners.length) text = '🤝 Очков никто не набрал';
  else text = `🎉 Победа у ${c.board.filter(r => c.winners.includes(r.id)).map(r => r.name).join(', ')}`;
  el.append(h('div', { class: 'duel-result', style: { margin: '4px 0 12px' } }, text));
  if (c.status === 'done') el.append(sectionTitle('Итоговая таблица'), board(c, ctx.state), rules(c));
}
