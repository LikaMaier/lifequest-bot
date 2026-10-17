// Свои соревнования с друзьями: карточка в списке, окно «Новое соревнование»,
// форма пункта (добавить / изменить / предложить / принять с правкой),
// ссылка-приглашение в лобби.

import { h, plural } from './dom.js';
import { api } from './api.js';
import { haptic, openTgLink } from './tg.js';
import { sheet, toast, toastError, busy } from './ui.js';
import { ICONS } from './icons.js';

export const dayWord = n => plural(n, 'день', 'дня', 'дней');
export const pointsWord = n => plural(n, 'очко', 'очка', 'очков');
const ID_KEY = 'lq-contest';

const CONTEST_EMOJI = ['🏆', '🔥', '💪', '🏃', '📚', '🌅', '🍏', '🧘', '🎯', '⚡'];
const ITEM_EMOJI = ['✅', '💪', '🏃', '👟', '📖', '💧', '🧘', '🍎', '😴', '🍬', '🚭', '📵', '🧹', '🎨', '🗣', '⏰'];
const DURATIONS = [3, 7, 14, 30];

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
  const text = `Соревнуемся? «${c.emoji} ${c.title}» — ${c.days} ${dayWord(c.days)}. Заходи в лобби, вместе решим, в чём состязаться 🏆`;
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
    const pend = c.proposals.length;
    line = c.mine
      ? `${c.items.length} ${plural(c.items.length, 'пункт', 'пункта', 'пунктов')} · ${c.members_count} ${plural(c.members_count, 'участник', 'участника', 'участников')}${pend ? ` · 💡 ${pend} ${plural(pend, 'предложение', 'предложения', 'предложений')}` : ''}`
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
    h('p', { class: 'bold muted', style: { margin: '-6px 0 0' } }, 'Сначала собираем людей, потом вместе решаем, в чём соревноваться.'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Название'), title),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Значок'),
      chips(CONTEST_EMOJI, () => form.emoji, v => { form.emoji = v; }, v => v)),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Сколько дней'),
      chips(DURATIONS, () => form.days, v => { form.days = v; }, v => `${v} ${dayWord(v)}`)),
    h('p', { class: 'tiny bold muted', style: { margin: 0 } }, 'Дальше — ссылка для друзей и настройка пунктов в лобби. Правила замораживаются при запуске.'),
    save));
  setTimeout(() => title.focus({ preventScroll: true }), 120);
  return s;
}

/**
 * Форма пункта. mode: 'add' | 'edit' | 'propose' | 'review'.
 * submit(item) → Promise; для 'review' — «Принять с правкой».
 */
export function openItemForm({ mode = 'add', item = null, submit }) {
  const form = {
    title: item ? item.title : '', emoji: item ? item.emoji : '✅', kind: item ? item.kind : 'check',
    unit: item && item.unit ? item.unit : '', norm: item && item.norm ? String(item.norm) : '',
    points: item ? item.points : 10,
  };
  const heading = { add: '➕ Новый пункт', edit: '✏️ Изменить пункт', propose: '💡 Предложить пункт', review: '✏️ Принять с правкой' }[mode];
  const button = { add: 'Сохранить', edit: 'Сохранить', propose: 'Отправить создателю', review: '✅ Принять' }[mode];
  const s = sheet(h('div'), { label: heading });

  const title = h('input', { class: 'input', type: 'text', maxlength: '60', value: form.title,
    placeholder: 'Например: Отжимания, Без сахара, Чтение', 'aria-label': 'Занятие' });
  title.addEventListener('input', () => { form.title = title.value; });
  const unit = h('input', { class: 'input', type: 'text', maxlength: '16', value: form.unit, placeholder: 'раз, минуты, страницы, км', 'aria-label': 'Единица' });
  unit.addEventListener('input', () => { form.unit = unit.value; });
  const norm = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: '1', value: form.norm, placeholder: 'Необязательно', 'aria-label': 'Норма в день' });
  norm.addEventListener('input', () => { form.norm = norm.value; });

  const pointsVal = h('span', { class: 'num hb2-step-val', 'aria-live': 'polite' });
  const pointsHint = h('span', { class: 'tiny bold muted' });
  const drawPoints = () => {
    pointsVal.textContent = String(form.points);
    pointsHint.textContent = form.kind === 'check' ? 'очков за каждый выполненный день' : `очков за каждую единицу (${form.unit.trim() || 'раз'})`;
  };
  const step = d => { haptic.select(); form.points = Math.max(1, Math.min(100, form.points + d)); drawPoints(); };
  const minus = h('button', { type: 'button', class: 'hb2-step', 'aria-label': 'Меньше очков', html: ICONS.minus });
  const plus = h('button', { type: 'button', class: 'hb2-step plus', 'aria-label': 'Больше очков', html: ICONS.plus });
  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));
  unit.addEventListener('input', drawPoints);

  const countFields = h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Единица'), unit),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Норма в день'), norm,
      h('span', { class: 'tiny bold muted' }, 'День засчитывается выполненным, когда норма набрана. Очки идут за каждую единицу.')));

  const kinds = h('div', { class: 'duel-modes' });
  const drawKinds = () => {
    kinds.replaceChildren(...[
      ['check', '☑️', 'Сделал / нет', 'Отметка раз в день'],
      ['count', '🔢', 'Число', 'Сколько раз, минут, страниц…'],
    ].map(([k, e, t, hint]) => {
      const b = h('button', { type: 'button', class: `duel-mode ${form.kind === k ? 'on' : ''}`, 'aria-pressed': String(form.kind === k) },
        h('span', { class: 'duel-mode-emoji', 'aria-hidden': 'true' }, e), h('b', null, t), h('span', null, hint));
      b.addEventListener('click', () => {
        if (form.kind === k) return;
        haptic.select();
        form.kind = k;
        form.points = k === 'check' ? 10 : 1;
        drawKinds();
      });
      return b;
    }));
    countFields.hidden = form.kind !== 'count';
    drawPoints();
  };
  drawKinds();

  const save = h('button', { type: 'button', class: 'btn block' }, button);
  save.addEventListener('click', busy(save, async () => {
    if (!form.title.trim()) { toast('Заполни «Занятие»', 'bad'); title.focus(); return; }
    const data = { title: form.title.trim(), emoji: form.emoji, kind: form.kind, points: form.points };
    if (form.kind === 'count') { data.unit = form.unit.trim() || 'раз'; data.norm = form.norm ? Number(form.norm) : null; }
    try {
      await submit(data);
      haptic.success();
      s.close();
    } catch (e) { toastError(e); }
  }));

  s.setContent(h('div', { class: 'stack' },
    h('h2', null, heading),
    mode === 'propose' ? h('p', { class: 'bold muted', style: { margin: '-6px 0 0' } }, 'Создатель получит уведомление и решит, добавить ли пункт в правила.') : null,
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Занятие'), title),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Эмодзи'),
      chips(ITEM_EMOJI.includes(form.emoji) ? ITEM_EMOJI : [form.emoji, ...ITEM_EMOJI], () => form.emoji, v => { form.emoji = v; }, v => v)),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Тип'), kinds),
    countFields,
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Очки'),
      h('div', { class: 'row', style: { alignItems: 'center', gap: '10px' } }, h('div', { class: 'hb2-stepper' }, minus, pointsVal, plus), pointsHint)),
    save));
  if (!item) setTimeout(() => title.focus({ preventScroll: true }), 120);
  return s;
}
