// Привычки: неделя кольцами, список по времени дня (утро / день / вечер),
// «Бросаю», пауза на отпуск и болезнь, готовые шаблоны.

import { h, clear, plural, parseDate } from '../dom.js';
import { haptic } from '../tg.js';
import { myMascot } from '../mascot.js';
import { habitCard, openHabitEditor, openPause, templatePicker, openTemplatePicker, TIMES } from '../habitui.js';

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAY_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

export function render(el, ctx) {
  clear(el);
  const sum = ctx.state.habits;
  const items = sum.items || [];
  const rerender = () => render(el, ctx);
  const add = h('button', { type: 'button', class: 'cal2-icon-btn dark big', 'aria-label': 'Новая привычка', html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' });
  add.addEventListener('click', () => { haptic.tap(); openHabitEditor(null, { onSaved: rerender }); });
  const today = items[0] ? items[0].week[6].date : null;
  const sub = sum.total
    ? `${today ? WEEKDAY_FULL[parseDate(today).getDay()] : 'Сегодня'} · ${sum.done} из ${sum.total} ${plural(sum.total, 'сделана', 'сделано', 'сделано')}`
    : (items.length ? 'Сегодня привычек по расписанию нет' : 'Маленькие ритуалы каждый день');
  el.append(h('header', { class: 'cal2-head' },
    myMascot(sum.total && sum.done === sum.total ? 'love' : 'happy', { size: 54 }),
    h('div', { class: 'grow' }, h('h1', null, 'Привычки'), h('p', { class: 'cal2-sub' }, sub)), add));

  if (!items.length) {
    el.append(h('section', { class: 'card' }, templatePicker({ max: 3, title: 'С чего начнём? Выбери до 3 привычек', onDone: rerender })));
    const own = h('button', { type: 'button', class: 'cal2-link', style: { width: '100%' } }, 'Создам свою привычку');
    own.addEventListener('click', () => { haptic.tap(); openHabitEditor(null, { onSaved: rerender }); });
    el.append(own);
    return;
  }

  // неделя: доля выполненных привычек по дням (кольца)
  const build = items.filter(x => x.kind === 'build');
  const strip = h('div', { class: 'hb2-week' }, Array.from({ length: 7 }, (_, i) => {
    const date = build[0] ? build[0].week[i].date : null;
    let due = 0, done = 0;
    for (const hb of build) {
      const d = hb.week[i];
      if (d.state === 'done') { due++; done++; } else if (d.state === 'miss') due++;
    }
    const p = due ? Math.round(done / due * 100) : 0;
    const isToday = i === 6;
    return h('div', { class: `hb2-week-day ${isToday ? 'today' : ''}`, 'aria-label': `${date || ''}: ${done} из ${due}` },
      h('span', { class: 'wd' }, date ? WD[(parseDate(date).getDay() + 6) % 7] : ''),
      h('span', { class: 'hb2-mini-ring', style: { '--p': `${p}%` } }, h('span', null, date ? String(parseDate(date).getDate()) : '')));
  }));
  el.append(strip);

  if (sum.pause) {
    const b = h('button', { type: 'button', class: 'hb2-pause-banner' }, '⏸ Пауза до ', h('b', null, sum.pause.end.split('-').reverse().slice(0, 2).join('.')), ' — серии не горят. Снять');
    b.addEventListener('click', () => openPause(sum.pause, { onChanged: rerender }));
    el.append(b);
  }

  const groups = ['morning', 'day', 'evening', 'any'];
  for (const g of groups) {
    const list = build.filter(x => (x.time_of_day || 'any') === g);
    if (!list.length) continue;
    list.sort((a, b) => Number(b.due_today || b.done_today) - Number(a.due_today || a.done_today) || (a.remind_time || '99').localeCompare(b.remind_time || '99'));
    const due = list.filter(x => x.due_today);
    el.append(h('section', { class: 'hb2-group' },
      h('div', { class: 'hb2-group-head' }, h('span', { class: 'hb2-group-title' }, TIMES[g]),
        due.length ? h('span', { class: 'hb2-group-sub' }, `${due.filter(x => x.done_today).length} из ${due.length}`) : null),
      list.map(hb => habitCard(hb, { onChanged: () => {} }))));
  }

  const quit = items.filter(x => x.kind === 'quit');
  if (quit.length) {
    el.append(h('section', { class: 'hb2-group' }, h('div', { class: 'hb2-group-head' }, h('span', { class: 'hb2-group-title' }, 'Бросаю')),
      quit.map(hb => habitCard(hb))));
  }

  if (!sum.pause) {
    const pause = h('button', { type: 'button', class: 'cal2-pill' }, 'Пауза');
    pause.addEventListener('click', () => { haptic.tap(); openPause(null, { onChanged: rerender }); });
    el.append(h('div', { class: 'hb2-pause-tip' }, h('div', { class: 'grow' }, 'Отпуск или болеешь? Поставь паузу — серии не сгорят.'), pause));
  }
  const tpl = h('button', { type: 'button', class: 'cal2-link', style: { width: '100%' } }, '✨ Добавить из готовых привычек');
  tpl.addEventListener('click', () => { haptic.tap(); openTemplatePicker({ onDone: rerender }); });
  el.append(tpl, h('p', { class: 'center tiny muted bold', style: { marginTop: '4px' } }, 'Нажми на привычку — откроется её статистика. Можно до 20 привычек.'));
}
