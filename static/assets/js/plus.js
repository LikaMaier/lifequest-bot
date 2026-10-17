// Единый «+»: строка «напиши как есть» (дата и время распознаются сами) и
// выбор — привычка, план, заметка, фото дня, квест.

import { h, fmtDay } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { refreshState } from './store.js';
import { sheet, toast, toastError, busy } from './ui.js';
import { parsePhrase } from './nlparse.js';
import { todayIso } from './planui.js';

export function openPlus({ go, onChange } = {}) {
  const today = todayIso();
  const s = sheet(h('div'), { label: 'Добавить' });
  const input = h('input', { class: 'cal2-quick-input', type: 'text', maxlength: '120', placeholder: 'завтра в 19 кино с Ирой', 'aria-label': 'Напиши, что запланировать' });
  const chips = h('div', { class: 'plus-chips', 'aria-live': 'polite' });
  const save = h('button', { type: 'button', class: 'cal2-save', disabled: true }, 'Напиши, что запланировать');
  const inbox = h('button', { type: 'button', class: 'cal2-link', hidden: true }, '📥 Без даты — во входящие');
  inbox.addEventListener('click', busy(inbox, async () => {
    try { await api.addInbox(parsed.title); haptic.success(); toast('📥 Во входящих — разберёшь в календаре', 'good'); s.close(); onChange && onChange(); } catch (e) { toastError(e); }
  }));
  let parsed = { title: '', date: null, time: null };
  const update = () => {
    parsed = parsePhrase(input.value, today);
    const date = parsed.date || today;
    chips.replaceChildren(...(parsed.title ? [
      h('span', { class: 'plus-chip blue' }, 'План'),
      h('span', { class: 'plus-chip yellow' }, date === today ? 'сегодня' : fmtDay(date)),
      parsed.time ? h('span', { class: 'plus-chip lav' }, parsed.time) : null,
      h('span', { class: 'plus-chip' }, `«${parsed.title}»`),
    ].filter(Boolean) : []));
    save.disabled = !parsed.title;
    inbox.hidden = !parsed.title || Boolean(parsed.date);
    save.textContent = parsed.title ? `Добавить на ${date === today ? 'сегодня' : fmtDay(date)}` : 'Напиши, что запланировать';
  };
  input.addEventListener('input', update);
  const submit = async () => {
    if (!parsed.title) return;
    try {
      const date = parsed.date || today;
      await api.createPlan({ title: parsed.title, date, time: parsed.time, repeat_rule: 'none', remind: parsed.time ? 'hour_before' : 'none', color: 'yellow', note: '' });
      haptic.success();
      toast(`📅 «${parsed.title}» — ${date === today ? 'сегодня' : fmtDay(date)}${parsed.time ? ` в ${parsed.time}` : ''}`, 'good', 2600);
      s.close();
      refreshState().catch(() => {});
      onChange && onChange();
    } catch (e) { toastError(e); }
  };
  save.addEventListener('click', busy(save, submit));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

  const kind = (title, sub, color, fn) => {
    const b = h('button', { type: 'button', class: `plus-kind c-${color}` }, h('b', null, title), h('span', null, sub));
    b.addEventListener('click', () => { haptic.tap(); s.close(); fn(); });
    return b;
  };
  s.setContent(h('div', { class: 'stack plus-sheet' },
    h('h2', null, 'Что добавим?'),
    h('div', null, h('div', { class: 'cal2-label' }, 'Напиши как есть — я разберусь'),
      h('div', { class: 'cal2-quick' }, input), chips),
    save, inbox,
    h('div', { class: 'plus-grid' },
      kind('Привычка', 'ритуал на каждый день', 'lime', async () => (await import('./habitui.js')).openHabitEditor(null, { onSaved: onChange })),
      kind('План', 'дело на дату и время', 'blue', async () => (await import('./screens/calendar.js')).openQuickAdd(today, { onChange })),
      kind('Заметка', 'мысль или итог дня', 'lav', () => openNote(today)),
      kind('Фото дня', 'в альбом воспоминаний', 'pink', async () => (await import('./planui.js')).openDaySheet(today, { onChange })),
      kind('Квест', 'подкинь приключение', 'orange', () => go && go('quests')),
      kind('Из шаблонов', 'готовые привычки', 'yellow', async () => (await import('./habitui.js')).openTemplatePicker({ onDone: onChange })))));
  setTimeout(() => input.focus(), 250);
  return s;
}

async function openNote(day) {
  const { noteComposer } = await import('./noteui.js');
  const s = sheet(h('div'), { label: 'Заметка' });
  s.setContent(h('div', { class: 'stack' }, h('h2', null, '📝 Заметка'),
    noteComposer({ day, draftKey: 'plus', placeholder: 'Мысль, идея или итог дня…', onSaved: () => { toast('Заметка сохранена ✓', 'good'); s.close(); } })));
}

/** Плавающая кнопка «+». */
export function plusFab(ctx) {
  const b = h('button', { type: 'button', class: 'plus-fab', 'aria-label': 'Добавить',
    html: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' });
  b.addEventListener('click', () => { haptic.tap('medium'); openPlus(ctx); });
  return b;
}
