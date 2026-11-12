// Челленджи месяца: «Месяц чтения», «Месяц шагов»… Общие для всех,
// результат отмечаем каждый день, друзья видят друг друга, есть общий топ.

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { mascot, mascotSVG } from '../mascot.js';
import { sectionTitle, skeleton, toast, toastError, busy, sheet, confetti, progressBar } from '../ui.js';
import { setState } from '../store.js';

const ID_KEY = 'lq_monthly_id';
let list = null;        // кэш списка
let detailCache = {};   // id -> карточка

export function openMonthly(go, id) {
  try { sessionStorage.setItem(ID_KEY, String(id)); } catch (e) { /* приватный режим */ }
  haptic.tap();
  go('challenge', { fresh: true });
}
function currentId() {
  try { return sessionStorage.getItem(ID_KEY) || null; } catch (e) { return null; }
}

const fmt = n => Number(n).toLocaleString('ru-RU');
const unitOf = (n, u) => plural(n, u[0], u[1], u[2]);

// ====================== список ======================
export async function render(el, ctx) {
  clear(el);
  list = null;
  const body = h('div');
  el.append(body);
  await draw(body, ctx);
}
export function update(el, ctx) { return render(el, ctx); }

async function draw(body, ctx) {
  clear(body);
  body.append(h('header', { class: 'page-head' }, mascot(ctx.state.user.mascot, 'silly', { size: 56 }),
    h('div', { class: 'grow' }, h('h1', null, 'Челленджи'), h('p', null, 'Один месяц, одна цель — и друзья рядом'))));
  if (!list) {
    body.append(skeleton(120), h('div', { style: { height: '12px' } }), skeleton(200));
    try { list = await api.monthly(); } catch (e) { clear(body).append(h('p', { class: 'muted bold' }, e.message)); return; }
    return draw(body, ctx);
  }
  const { go } = ctx;
  const period = h('p', { class: 'mo-period' }, `${cap(list.period_label)} · ${list.days_left} ${plural(list.days_left, 'день', 'дня', 'дней')} до конца`);
  body.append(period);

  if (list.mine.length) {
    body.append(sectionTitle('Мои челленджи'), h('div', { class: 'stack-sm' }, list.mine.map(c => mineCard(c, go))));
  } else {
    body.append(h('section', { class: 'mo-intro' },
      h('div', { class: 'mo-intro-pet', html: mascotSVG(ctx.state.user.mascot, 'love', ctx.state.user.accessory) }),
      h('div', null, h('b', null, 'Выбери челлендж на месяц'),
        h('p', null, 'Отмечай результат каждый день — страницы, шаги, минуты. Друзья увидят твой прогресс, а ты — их. За каждый день +5 XP, за цель +100.'))));
  }
  body.append(sectionTitle(list.mine.length ? 'Ещё челленджи' : 'Выбирай'),
    h('div', { class: 'mo-grid' }, list.catalog.map(c => catalogCard(c, go))));
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

function mineCard(c, go) {
  const left = Math.max(0, c.my_goal - c.my_score);
  const card = h('button', { type: 'button', class: `mo-mine ${c.logged_today ? 'done' : ''}` },
    h('span', { class: 'mo-emoji', 'aria-hidden': 'true' }, c.emoji),
    h('span', { class: 'grow' },
      h('b', null, c.title),
      h('span', { class: 'mo-sub' }, c.percent >= 100 ? '🏆 цель достигнута!' : `${fmt(c.my_score)} из ${fmt(c.my_goal)} ${unitOf(c.my_goal, c.unit)} · ещё ${fmt(left)}`),
      progressBar(c.percent / 100, c.percent >= 100 ? 'lime' : 'pink'),
      h('span', { class: 'mo-meta' },
        c.logged_today ? h('span', { class: 'tag c-lime' }, '✓ сегодня') : h('span', { class: 'tag c-yellow' }, 'отметь сегодня'),
        h('span', { class: 'tiny bold muted' }, `${c.participants} ${plural(c.participants, 'участник', 'участника', 'участников')}${c.friends_count ? ` · ${c.friends_count} ${plural(c.friends_count, 'друг', 'друга', 'друзей')}` : ''}`))),
    h('span', { class: 'turn-go', 'aria-hidden': 'true' }, '›'));
  card.addEventListener('click', () => openMonthly(go, c.id));
  return card;
}

function catalogCard(c, go) {
  const card = h('button', { type: 'button', class: 'mo-card' },
    h('span', { class: 'mo-emoji big', 'aria-hidden': 'true' }, c.emoji),
    h('b', null, c.title),
    h('span', { class: 'mo-goal' }, c.kind === 'days' ? `${c.goal} ${unitOf(c.goal, c.unit)}` : `${fmt(c.goal)} ${unitOf(c.goal, c.unit)}`),
    c.friends.length ? h('span', { class: 'mo-friends' }, c.friends.slice(0, 3).map(f => h('span', { class: 'mo-ava', html: mascotSVG(f.mascot, 'happy', f.accessory), title: f.name })),
      h('span', { class: 'tiny bold' }, c.friends_count > 3 ? `+${c.friends_count - 3}` : ''))
      : h('span', { class: 'tiny bold muted' }, c.participants ? `${c.participants} ${plural(c.participants, 'участник', 'участника', 'участников')}` : 'будь первым'));
  card.addEventListener('click', () => openMonthly(go, c.id));
  return card;
}

// ====================== карточка челленджа ======================
export async function renderDetail(el, ctx) {
  clear(el);
  const id = currentId();
  if (!id) { ctx.go('challenges', { replace: true }); return; }
  const body = h('div');
  el.append(body);
  body.append(skeleton(220), h('div', { style: { height: '12px' } }), skeleton(160));
  try { detailCache[id] = await api.monthlyOne(id); } catch (e) { clear(body).append(h('p', { class: 'muted bold' }, e.message)); return; }
  drawDetail(body, ctx, detailCache[id]);
}

// При смене состояния (XP после отметки) карточку не перерисовываем — она уже обновлена ответом.
export function updateDetail() {}

function drawDetail(body, ctx, d) {
  clear(body);
  const { state, go } = ctx;
  const redraw = nd => { detailCache[d.id] = nd; list = null; drawDetail(body, ctx, nd); };
  const my = d.my;

  // шапка
  body.append(h('header', { class: 'mo-head' },
    h('div', { class: 'mo-head-emoji', 'aria-hidden': 'true' }, d.emoji),
    h('div', { class: 'grow' }, h('h1', null, d.title), h('p', { class: 'small bold', style: { opacity: .85 } }, d.pitch)),
  ));
  body.append(h('p', { class: 'mo-period' }, `${cap(d.period_label)} · ${d.participants} ${plural(d.participants, 'участник', 'участника', 'участников')}${d.days_left ? ` · ${d.days_left} ${plural(d.days_left, 'день', 'дня', 'дней')} до конца` : ''}`));

  if (!d.joined) {
    const join = h('button', { type: 'button', class: 'btn block' }, `${d.emoji} Участвую!`);
    join.addEventListener('click', () => busy(join, async () => {
      try { const nd = await api.monthlyAction(d.id, 'join'); haptic.success(); confetti(60); toast('Ты в игре! Отмечай результат каждый день', 'good', 2400); redraw(nd); }
      catch (e) { toastError(e); }
    }));
    body.append(h('section', { class: 'card tinted c-yellow center' },
      h('div', { class: 'mo-join-pet', html: mascotSVG(state.user.mascot, 'wink', state.user.accessory) }),
      h('p', { class: 'bold', style: { margin: '6px 0 12px' } },
        d.kind === 'days' ? `Цель — ${d.goal} ${unitOf(d.goal, d.unit)} за месяц. Отмечай каждый удачный день.`
          : `Цель — ${fmt(d.goal)} ${unitOf(d.goal, d.unit)} за месяц. Свою цель можно поменять.`),
      join));
  } else {
    // мой прогресс
    const left = Math.max(0, my.goal - my.score);
    const prog = h('section', { class: `card mo-progress ${my.goal_reached ? 'reached' : ''}` },
      h('div', { class: 'mo-big' }, h('span', { class: 'num' }, fmt(my.score)), h('span', { class: 'mo-big-unit' }, ` ${unitOf(my.score, d.unit)}`)),
      h('p', { class: 'small bold', style: { opacity: .8 } }, my.goal_reached ? '🏆 Цель достигнута — ты легенда месяца' : `до цели ${fmt(my.goal)} — ещё ${fmt(left)}`),
      progressBar(my.percent / 100, my.goal_reached ? 'lime' : 'pink'),
      h('div', { class: 'mo-stats' },
        stat('📅', `${my.days}`, plural(my.days, 'день', 'дня', 'дней')),
        my.rank ? stat('🏅', `${my.rank}`, 'место') : null,
        d.milestone ? stat(d.milestone.emoji, `${my.milestones}`, unitOf(my.milestones, d.milestone.unit)) : null,
        stat('⚡', `${my.days * 5 + (my.goal_reached ? 100 : 0)}`, 'XP')));
    const goalBtn = h('button', { type: 'button', class: 'home2-link' }, 'Моя цель ›');
    goalBtn.addEventListener('click', () => editGoal(d, redraw));
    prog.append(h('div', { style: { textAlign: 'right', marginTop: '6px' } }, goalBtn));
    body.append(prog);

    // отметить сегодня
    body.append(logCard(d, redraw, go));

    // дни месяца
    body.append(sectionTitle('Мой месяц'), h('div', { class: 'card' }, monthGrid(d)));
  }

  // друзья
  if (d.friends_board.length > 1 || (d.joined && d.friends_board.length)) {
    body.append(sectionTitle('Друзья в челлендже'), h('div', { class: 'card' }, board(d, d.friends_board)));
  } else if (d.joined) {
    const inv = h('button', { type: 'button', class: 'btn ghost small' }, 'Позвать друзей');
    inv.addEventListener('click', () => go('friends'));
    body.append(sectionTitle('Друзья в челлендже'), h('div', { class: 'card center' },
      h('p', { class: 'muted bold small', style: { marginBottom: '10px' } }, 'Из твоих друзей здесь пока никого. Вместе веселее — и результаты видно.'), inv));
  }
  // общий топ
  if (d.top.length) body.append(sectionTitle('Топ месяца'), h('div', { class: 'card' }, board(d, d.top)));

  if (d.joined) {
    const leave = h('button', { type: 'button', class: 'btn ghost small block', style: { marginTop: '18px' } }, 'Выйти из челленджа');
    leave.addEventListener('click', () => busy(leave, async () => {
      try { await api.monthlyAction(d.id, 'leave'); list = null; toast('Вышел(ла). Записи за месяц остались', '', 2000); go('challenges', { fresh: true }); }
      catch (e) { toastError(e); }
    }));
    body.append(leave);
  }
}

function stat(emoji, value, label) {
  return h('div', { class: 'mo-stat' }, h('span', { 'aria-hidden': 'true' }, emoji), h('b', { class: 'num' }, value), h('span', null, label));
}

function logCard(d, redraw, go) {
  const my = d.my;
  const send = async (value, milestone) => {
    try {
      const r = await api.monthlyAction(d.id, 'log', { value, milestone });
      if (r.state) setState(r.state);
      haptic.success();
      if (r.goal_reached) { confetti(160); toast(`🏆 Цель достигнута! +${r.xp} XP`, 'good', 3200); }
      else if (r.xp) toast(`+${r.xp} XP — день засчитан`, 'good', 1800);
      else toast('Записано ✓', 'good', 1200);
      redraw(r);
    } catch (e) { toastError(e); }
  };
  if (d.kind === 'days') {
    if (my.logged_today) {
      const undo = h('button', { type: 'button', class: 'home2-link' }, 'отменить');
      undo.addEventListener('click', () => busy(undo, async () => { try { redraw(await api.monthlyAction(d.id, 'undo')); } catch (e) { toastError(e); } }));
      return h('section', { class: 'card tinted c-lime mo-log' }, h('div', { class: 'mo-log-done' }, '✓ Сегодня засчитано'), undo);
    }
    const b = h('button', { type: 'button', class: 'btn block' }, '✓ Сегодня получилось!');
    b.addEventListener('click', () => busy(b, () => send(1, false)));
    return h('section', { class: 'card tinted c-yellow mo-log' }, h('p', { class: 'bold', style: { marginBottom: '10px' } }, 'Отметь день, когда справишься'), b);
  }
  const input = h('input', { class: 'input mo-input', type: 'number', inputmode: 'numeric', min: '0', placeholder: '0', 'aria-label': `Сколько ${unitOf(5, d.unit)} сегодня` });
  const add = h('button', { type: 'button', class: 'btn' }, 'Добавить');
  add.addEventListener('click', () => busy(add, () => send(Number(input.value) || 0, false)));
  const quick = h('div', { class: 'mo-quick' }, d.steps.map(s => {
    const q = h('button', { type: 'button', class: 'mo-chip' }, `+${fmt(s)}`);
    q.addEventListener('click', () => busy(q, () => send(s, false)));
    return q;
  }));
  const box = h('section', { class: 'card tinted c-yellow mo-log' },
    h('div', { class: 'mo-log-head' }, h('b', null, 'Сегодня'), h('span', { class: 'tiny bold' }, my.today ? `${fmt(my.today)} ${unitOf(my.today, d.unit)}` : 'пока пусто')),
    h('div', { class: 'mo-log-row' }, input, add), quick);
  if (d.milestone) {
    const m = h('button', { type: 'button', class: 'btn ghost small block', style: { marginTop: '10px' } }, `${d.milestone.emoji} ${d.milestone.label}`);
    m.addEventListener('click', () => busy(m, () => send(0, true)));
    box.append(m);
  }
  if (my.today_entries) {
    const undo = h('button', { type: 'button', class: 'home2-link', style: { marginTop: '8px' } }, 'отменить последнюю запись');
    undo.addEventListener('click', () => busy(undo, async () => { try { redraw(await api.monthlyAction(d.id, 'undo')); } catch (e) { toastError(e); } }));
    box.append(h('div', { class: 'center' }, undo));
  }
  return box;
}

function monthGrid(d) {
  const max = Math.max(1, ...d.days.map(x => x.value));
  return h('div', { class: 'mo-days' }, d.days.map(x => {
    const lvl = !x.done ? 0 : d.kind === 'days' ? 4 : Math.max(1, Math.ceil(4 * x.value / max));
    return h('span', { class: `mo-day l${lvl} ${x.future ? 'future' : ''}`, title: x.done ? `${x.day}: ${fmt(x.value)}` : String(x.day) }, String(x.day));
  }));
}

function board(d, rows) {
  return h('ol', { class: 'mo-board' }, rows.map(r => h('li', { class: `mo-row ${r.me ? 'me' : ''}` },
    h('span', { class: 'mo-rank' }, r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : String(r.rank)),
    h('span', { class: 'mo-ava', html: mascotSVG(r.mascot, r.me ? 'love' : 'happy', r.accessory) }),
    h('span', { class: 'grow' }, h('b', null, r.me ? 'Ты' : r.name), h('span', { class: 'tiny bold muted' }, `${r.days} ${plural(r.days, 'день', 'дня', 'дней')}${d.milestone && r.milestones ? ` · ${d.milestone.emoji} ${r.milestones}` : ''}`)),
    h('b', { class: 'num' }, fmt(r.score)))));
}

function editGoal(d, redraw) {
  const input = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: '1', value: String(d.my.goal), 'aria-label': 'Цель на месяц' });
  const save = h('button', { type: 'button', class: 'btn block', style: { marginTop: '12px' } }, 'Сохранить');
  const s = sheet(h('div', null, h('h2', null, 'Моя цель на месяц'),
    h('p', { class: 'muted bold small', style: { margin: '4px 0 12px' } }, `Рекомендуем ${fmt(d.goal)} ${unitOf(d.goal, d.unit)}, но цель твоя — ставь свою.`),
    input, save), { label: 'Цель' });
  save.addEventListener('click', () => busy(save, async () => {
    try { const nd = await api.monthlyAction(d.id, 'goal', { goal: Number(input.value) }); s.close(); toast('Цель обновлена', 'good', 1500); redraw(nd); }
    catch (e) { toastError(e); }
  }));
}
