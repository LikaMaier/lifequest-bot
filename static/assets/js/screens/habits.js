// Привычки: свой список, отметки за сегодня и прошлую неделю, серии.

import { h, clear } from '../dom.js';
import { haptic } from '../tg.js';
import { mascot } from '../mascot.js';
import { ring, emptyState, sectionTitle } from '../ui.js';
import { habitCard, openHabitEditor, TEMPLATES, habitsSummaryText } from '../habitui.js';

export function render(el, ctx) {
  clear(el);
  const sum = ctx.state.habits;
  el.append(h('header', { class: 'page-head' }, mascot('cat-lime', sum.total && sum.done === sum.total ? 'love' : 'happy', { size: 56 }),
    h('div', null, h('h1', null, 'Привычки'), h('p', null, 'Свои маленькие ритуалы — отмечай каждый день'))));

  const add = h('button', { type: 'button', class: 'btn block' }, '＋ Добавить привычку');
  add.addEventListener('click', () => { haptic.tap(); openHabitEditor(null); });

  if (!sum.total) {
    el.append(h('div', { class: 'card' },
      emptyState('Придумай привычку, которую хочешь закрепить, — или возьми одну из готовых ниже.', { kind: 'cat-lime', expr: 'wink' }),
      h('div', { class: 'stack-sm' }, TEMPLATES.slice(0, 4).map(t => {
        const b = h('button', { type: 'button', class: `quest-item c-${t.color}` },
          h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, t.emoji),
          h('span', { class: 'grow' }, h('span', { class: 'q-title' }, t.title),
            h('span', { class: 'q-meta', style: { display: 'block' } }, t.target > 1 ? `${t.target} ${t.unit} в день` : 'раз в день')));
        b.addEventListener('click', () => { haptic.tap(); openTemplate(t); });
        return b;
      }))), h('div', { style: { marginTop: '14px' } }, add));
    return;
  }

  el.append(h('section', { class: 'card', style: { marginBottom: '6px' } },
    h('div', { class: 'row', style: { gap: '16px' } },
      ring(sum.done, sum.total, { color: sum.done === sum.total ? 'lime' : 'blue', size: 110, stroke: 14, caption: 'сегодня',
        label: habitsSummaryText(sum) }),
      h('div', { class: 'grow stack-sm' },
        h('div', { class: 'bold' }, habitsSummaryText(sum)),
        h('div', { class: 'small muted bold' }, sum.done === sum.total ? 'Все привычки на сегодня выполнены 🎉' : 'Нажми ✓ или +, когда сделаешь. Прошлые дни можно поправить в точках недели.'),
        h('div', { class: 'tiny muted bold' }, '+3 XP за каждую привычку, выполненную за день')))));

  el.append(sectionTitle('Мой список'));
  const list = h('div', { class: 'stack-sm' }, sum.items.map(hb => habitCard(hb)));
  el.append(list, h('div', { style: { marginTop: '16px' } }, add),
    h('p', { class: 'center tiny muted bold', style: { marginTop: '6px' } }, 'Нажми на привычку, чтобы изменить её или удалить. Можно до 20 привычек.'));
}

function openTemplate(t) {
  openHabitEditor(null, { preset: t });
}
