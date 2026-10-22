// Свои соревнования с друзьями: карточка в списке, окно «Новое соревнование»,
// форма пункта (добавить / изменить),
// ссылка-приглашение в лобби.

import { h, plural } from './dom.js';
import { api } from './api.js';
import { haptic, openTgLink } from './tg.js';
import { sheet, toast, toastError, busy } from './ui.js';
import { ICONS } from './icons.js';
import { mascot } from './mascot.js';

export const dayWord = n => plural(n, 'день', 'дня', 'дней');
export const pointsWord = n => plural(n, 'очко', 'очка', 'очков');
const ID_KEY = 'lq-contest';

const CONTEST_EMOJI = ['🏆', '🔥', '💪', '🏃', '📚', '🌅', '🍏', '🧘', '🎯', '⚡', '🥇', '🚀', '🌟', '👑', '🎉', '💎',
  '🏋️', '🚴', '🏊', '⚽', '🧠', '🎨', '🎸', '🌱', '🍂', '🎃', '❄️', '☀️', '💧', '😴', '🧹', '💰'];
const ITEM_EMOJI = ['✅', '💪', '🏃', '👟', '🚴', '🏊', '🧘', '🤸', '🏋️', '⚽', '📖', '📚', '✍️', '🗣', '🧠', '🎨',
  '🎸', '🎹', '💧', '🍎', '🥗', '🥦', '🍬', '🍔', '☕', '🚭', '🍷', '📵', '📱', '😴', '⏰', '🌅',
  '🧹', '🧺', '🍳', '🛏', '🪴', '🐶', '🚶', '🌳', '💰', '💻', '📝', '🙏', '😊', '❤️', '🦷', '🧴'];
const DURATIONS = [3, 7, 14, 30];
const MAX_POINTS = 20;

/** Открыть экран соревнования (id запоминаем — он переживает перезагрузку). */
export function openContest(go, id) {
  try { sessionStorage.setItem(ID_KEY, String(id)); } catch (e) { /* приватный режим */ }
  haptic.tap();
  go('contest', { fresh: true });
}

export function currentContestId() {
  try { return Number(sessionStorage.getItem(ID_KEY)) || null; } catch (e) { return null; }
}

export function contestLink(state, id) {
  return state.bot_username ? `https://t.me/${state.bot_username}?start=c_${id}` : '';
}

export function shareContest(state, c) {
  const link = contestLink(state, c.id);
  if (!link) { toast('Ссылка появится, когда бот будет на связи', 'bad'); return; }
  const text = `Соревнуемся? «${c.emoji} ${c.title}» — ${c.days} ${dayWord(c.days)}. Жми ссылку и прими вызов 🏆`;
  haptic.tap();
  openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
}

export function statusLabel(c) {
  if (c.status === 'lobby') return '⏳ Идёт настройка';
  if (c.status === 'active') return c.not_started ? '🔥 Стартует завтра' : `🔥 Идёт · день ${c.day || 1} из ${c.days}`;
  if (c.status === 'done') return '🏁 Итоги';
  return 'Отменено';
}

/** Карточка соревнования для списка на экране «Друзья». */
export function contestCard(c, { go }) {
  const me = c.me || {};
  let line;
  if (c.status === 'lobby') {
    line = c.mine
      ? `${c.items.length} ${plural(c.items.length, 'пункт', 'пункта', 'пунктов')} · ${c.members_count} ${plural(c.members_count, 'участник', 'участника', 'участников')}`
      : `Ждём запуска от ${c.creator.name} · ${c.members_count} ${plural(c.members_count, 'участник', 'участника', 'участников')}`;
  } else if (c.status === 'active') {
    line = me.place ? `Ты на ${me.place}-м месте · ${me.score} ${pointsWord(me.score)} · сегодня ${me.done_today}/${c.items.length}` : 'Ты вышел(а) из соревнования';
  } else {
    const won = c.winners.includes(me.id);
    line = won ? '🏆 Победа!' : me.place ? `Твоё место — ${me.place}` : 'Соревнование окончено';
  }
  const todo = c.status === 'active' && me.place && !me.all_today && !c.not_started;
  const b = h('button', { type: 'button', class: `ct-card ${c.status} ${todo ? 'todo' : ''}` },
    h('span', { class: 'ct-card-emoji', 'aria-hidden': 'true' }, c.emoji || '🏆'),
    h('span', { class: 'grow' },
      h('span', { class: 'ct-kicker' }, statusLabel(c)),
      h('b', null, c.title),
      h('span', { class: 'ct-card-line' }, line)),
    h('span', { class: 'ct-card-go', 'aria-hidden': 'true' }, '›'));
  b.addEventListener('click', () => openContest(go, c.id));
  return b;
}

/** Строка идущего соревнования для Главной (из state.contests). */
export function contestRow(c, { go }) {
  const left = c.items - c.done_today;
  const b = h('button', { type: 'button', class: `duel-row ${left ? 'todo' : ''}` },
    h('span', { class: 'duel-row-emoji', 'aria-hidden': 'true' }, '🏆'),
    h('span', { class: 'grow' }, h('b', null, `${c.emoji} ${c.title}`),
      h('span', null, left ? `сегодня отмечено ${c.done_today} из ${c.items}` : 'сегодня всё отмечено ✓')),
    h('span', { class: 'duel-row-score' }, c.place ? `${c.place}/${c.count}` : '›'));
  b.addEventListener('click', () => openContest(go, c.id));
  return b;
}

/** Как у дуэли: квадраты «Ты VS соперник» с маскотами, счётом и «✓ сегодня».
 *  Двое — «Ты VS друг»; больше — топ-3 квадратами с медалями. */
function contestVs(c, medals) {
  const box = (m, lead) => h('div', { class: `dsp-side ${lead ? 'lead' : ''}` },
    h('div', { class: 'dsp-pet' }, mascot(m.mascot || 'cat-purple', m.all_today ? 'happy' : 'wink', { size: 64, acc: m.accessory }),
      lead ? h('span', { class: 'dsp-crown', 'aria-hidden': 'true' }, '👑') : null),
    h('div', { class: 'dsp-name' }, m.me ? 'Ты' : m.name),
    h('div', { class: 'dsp-score' }, String(m.score)),
    h('div', { class: `dsp-today ${m.all_today ? 'ok' : ''}` }, m.all_today ? '✓ сегодня' : 'ещё нет'));
  const top = c.top;
  const best = Math.max(...top.map(m => m.score));
  const isLead = m => best > 0 && m.score === best && top.filter(x => x.score === best).length === 1;
  if (top.length === 2) {
    const me = top.find(m => m.me) || top[0];
    const rival = top.find(m => m !== me);
    return h('div', { class: 'dsp-vs' }, box(me, isLead(me)), h('div', { class: 'dsp-mid', 'aria-hidden': 'true' }, 'VS'), box(rival, isLead(rival)));
  }
  return h('div', { class: 'dsp-vs3' }, top.slice(0, 3).map(m => {
    const b = box(m, isLead(m));
    b.prepend(h('span', { class: 'dsp-medal', 'aria-hidden': 'true' }, best > 0 ? medals[Math.min(m.place, 3) - 1] : ''));
    return b;
  }));
}

/** Пьедестал: 2-е место слева, 1-е в центре (выше всех), 3-е справа. */
function podium(top, medals) {
  const order = top.length >= 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  return h('div', { class: `cts-podium n${order.length}` }, order.map(m => {
    const step = m.place <= 3 ? m.place : 3;
    return h('div', { class: `cts-col p${step} ${m.me ? 'me' : ''}` },
      h('div', { class: 'cts-pet' }, mascot(m.mascot || 'cat-purple', m.all_today ? 'love' : step === 1 ? 'happy' : 'wink', { size: 58, acc: m.accessory }),
        step === 1 && m.score > 0 ? h('span', { class: 'cts-crown', 'aria-hidden': 'true' }, '👑') : null),
      h('div', { class: 'cts-name' }, m.me ? 'Ты' : m.name, m.all_today ? ' ✓' : ''),
      h('div', { class: 'cts-step' },
        h('span', { class: 'cts-medal' }, medals[step - 1]),
        h('b', null, String(m.score)), h('small', null, 'очк.')));
  }));
}

/** Яркая карточка соревнования для Главной: идёт — лидеры и твоё место; лобби — «идёт настройка». */
export function contestSpotlight(c, { go }) {
  const medals = ['🥇', '🥈', '🥉'];
  const card = h('section', { class: `dsp contest ${c.status}`, role: 'button', tabindex: '0',
    'aria-label': `Соревнование ${c.title}` });
  const open = () => openContest(go, c.id);
  card.addEventListener('click', open);
  card.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
  if (c.status === 'lobby') {
    card.append(
      h('div', { class: 'dsp-top' }, h('span', { class: 'dsp-kicker' }, `🏆 СОРЕВНОВАНИЕ · ${c.days} ${dayWord(c.days).toUpperCase()}`),
        h('span', { class: 'dsp-badge wait' }, 'Идёт настройка')),
      h('div', { class: 'dsp-title' }, `${c.emoji || '🏆'} ${c.title}`),
      h('div', { class: 'cts-pets' }, c.top.map(m => h('div', { class: 'cts-pet' },
        mascot(m.mascot || 'cat-purple', 'happy', { size: 46, acc: m.accessory }), h('span', null, m.me ? 'Ты' : m.name)))),
      h('div', { class: 'dsp-actions' }, h('span', { class: 'dsp-line' },
        c.can_launch ? `${c.items} ${plural(c.items, 'пункт', 'пункта', 'пунктов')} готово — можно жать «Запустить» 🚀`
          : c.count < 2 ? 'Ждём второго участника — отправь ссылку' : 'Добавьте хотя бы один пункт')));
    return card;
  }
  const left = c.items - c.done_today;
  card.append(
    h('div', { class: 'dsp-top' },
      h('span', { class: 'dsp-kicker' }, c.not_started ? '🏆 СОРЕВНОВАНИЕ · СТАРТ ЗАВТРА' : `🏆 СОРЕВНОВАНИЕ · ДЕНЬ ${c.day || 1} ИЗ ${c.days}`),
      left && !c.not_started ? h('span', { class: 'dsp-badge' }, 'Твой ход!') : null),
    h('div', { class: 'dsp-title' }, `${c.emoji || '🏆'} ${c.title}`),
    contestVs(c, medals));
  const me = c.top.find(m => m.me);
  const others = c.top.filter(m => !m.me);
  const bestOther = others.length ? Math.max(...others.map(m => m.score)) : 0;
  if (left || c.not_started) {
    const btn = h('button', { type: 'button', class: 'dsp-btn' }, c.not_started ? 'Открыть правила' : `✓ Отметить сегодня · ${c.done_today}/${c.items}`);
    btn.addEventListener('click', e => { e.stopPropagation(); open(); });
    card.append(h('div', { class: 'dsp-actions' }, btn));
  } else {
    const diff = me ? me.score - bestOther : 0;
    card.append(h('div', { class: 'dsp-actions' }, h('span', { class: 'dsp-line' },
      diff > 0 ? `Ты впереди на ${diff} — так держать!` : diff < 0 ? `Догоняй: −${-diff}` : 'Пока ничья — сделай рывок!')));
  }
  return card;
}

/** Сетка эмодзи 8 в ряд (как в редакторе привычки). */
function emojiGrid(list, get, set) {
  const grid = h('div', { class: 'emoji-grid', role: 'radiogroup' });
  const draw = () => grid.replaceChildren(...list.map(e => {
    const on = get() === e;
    const b = h('button', { type: 'button', class: `emoji-pick ${on ? 'on' : ''}`, role: 'radio', 'aria-checked': String(on), 'aria-label': e }, e);
    b.addEventListener('click', () => { haptic.select(); set(e); draw(); });
    return b;
  }));
  draw();
  return grid;
}

function chips(items, get, set, render, cls = 'duel-chips') {
  const row = h('div', { class: cls, role: 'radiogroup' });
  const draw = () => row.replaceChildren(...items.map(it => {
    const on = get() === it;
    const b = h('button', { type: 'button', class: `duel-chip ${on ? 'on' : ''}`, role: 'radio', 'aria-checked': String(on) }, render(it));
    b.addEventListener('click', () => { haptic.select(); set(it); draw(); });
    return b;
  }));
  draw();
  return row;
}

/** Шаг 1: название и срок → лобби. */
export function openContestCreator(ctx, { onDone } = {}) {
  const form = { title: '', emoji: '🏆', days: 7 };
  const s = sheet(h('div'), { label: 'Новое соревнование' });
  const title = h('input', { class: 'input', type: 'text', maxlength: '60', placeholder: 'Например: Осенний марафон', 'aria-label': 'Название соревнования' });
  title.addEventListener('input', () => { form.title = title.value; });
  const save = h('button', { type: 'button', class: 'btn block' }, '🏆 Создать лобби');
  save.addEventListener('click', busy(save, async () => {
    if (!title.value.trim()) { toast('Придумай название 🙂', 'bad'); title.focus(); return; }
    try {
      const res = await api.createContest({ title: title.value.trim(), emoji: form.emoji, days: form.days });
      haptic.success();
      s.close();
      onDone && onDone(res.contest);
      openContest(ctx.go, res.contest.id);
    } catch (e) { toastError(e); }
  }));
  s.setContent(h('div', { class: 'stack' },
    h('h2', null, '🏆 Новое соревнование'),
    h('p', { class: 'bold muted', style: { margin: '-6px 0 0' } }, 'Друзья получат приглашение и просто примут его или откажутся. Пункты задаёшь ты.'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Название'), title),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Значок'),
      emojiGrid(CONTEST_EMOJI, () => form.emoji, v => { form.emoji = v; })),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Сколько дней'),
      chips(DURATIONS, () => form.days, v => { form.days = v; }, v => `${v} ${dayWord(v)}`)),
    h('p', { class: 'tiny bold muted', style: { margin: 0 } }, 'Дальше — ссылка для друзей и пункты в лобби. Правила замораживаются при запуске.'),
    save));
  setTimeout(() => title.focus({ preventScroll: true }), 120);
  return s;
}

/** Форма пункта: занятие, эмодзи и очки за выполненный день (сделал / не сделал). */
export function openItemForm({ mode = 'add', item = null, submit }) {
  const form = { title: item ? item.title : '', emoji: item ? item.emoji : '✅', points: item ? Math.min(MAX_POINTS, item.points) : 10 };
  const heading = mode === 'edit' ? '✏️ Изменить пункт' : '➕ Новый пункт';
  const s = sheet(h('div'), { label: heading });

  const title = h('input', { class: 'input', type: 'text', maxlength: '60', value: form.title,
    placeholder: 'Например: 30 отжиманий, Без сахара, Чтение', 'aria-label': 'Занятие' });
  title.addEventListener('input', () => { form.title = title.value; });

  const pointsVal = h('span', { class: 'num hb2-step-val', 'aria-live': 'polite' });
  const drawPoints = () => { pointsVal.textContent = String(form.points); };
  const step = d => { haptic.select(); form.points = Math.max(1, Math.min(MAX_POINTS, form.points + d)); drawPoints(); };
  const minus = h('button', { type: 'button', class: 'hb2-step', 'aria-label': 'Меньше очков', html: ICONS.minus });
  const plus = h('button', { type: 'button', class: 'hb2-step plus', 'aria-label': 'Больше очков', html: ICONS.plus });
  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));
  drawPoints();

  const save = h('button', { type: 'button', class: 'btn block' }, 'Сохранить');
  save.addEventListener('click', busy(save, async () => {
    if (!form.title.trim()) { toast('Заполни «Занятие»', 'bad'); title.focus(); return; }
    try {
      await submit({ title: form.title.trim(), emoji: form.emoji, points: form.points });
      haptic.success();
      s.close();
    } catch (e) { toastError(e); }
  }));

  s.setContent(h('div', { class: 'stack' },
    h('h2', null, heading),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Занятие'), title),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Эмодзи'),
      emojiGrid(ITEM_EMOJI.includes(form.emoji) ? ITEM_EMOJI : [form.emoji, ...ITEM_EMOJI], () => form.emoji, v => { form.emoji = v; })),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Очки за день'),
      h('div', { class: 'row', style: { alignItems: 'center', gap: '10px' } }, h('div', { class: 'hb2-stepper' }, minus, pointsVal, plus),
        h('span', { class: 'tiny bold muted' }, `за выполненный день, максимум ${MAX_POINTS}`))),
    save));
  if (!item) setTimeout(() => title.focus({ preventScroll: true }), 120);
  return s;
}
