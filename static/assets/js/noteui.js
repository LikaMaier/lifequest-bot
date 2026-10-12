// Заметки: стикер, быстрый ввод и редактор. Общие для главной и экрана «Заметки».

import { h } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { sheet, toast, toastError } from './ui.js';
import { refreshState } from './store.js';

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'lime', 'lav', 'orange'];
const DAY_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const drafts = new Map(); // черновики переживают перерисовку экрана
export const noteDay = iso => DAY_FMT.format(new Date(`${iso}T12:00:00`));

async function changed(onChange) {
  try { await refreshState(); } catch (e) { /* главная обновится при следующем входе */ }
  onChange && onChange();
}

/** Стикер с заметкой; нажатие — редактор. */
export function noteCard(n, { onChange, showDay = false } = {}) {
  const b = h('button', { type: 'button', class: `note-card c-${n.color}`, 'aria-label': `Заметка: ${n.text.slice(0, 60)}` },
    n.pinned ? h('span', { class: 'note-pin', 'aria-label': 'Закреплена' }, '📌') : null,
    h('span', { class: 'note-text' }, n.text),
    showDay ? h('span', { class: 'note-day' }, noteDay(n.day)) : null);
  b.addEventListener('click', () => { haptic.tap(); openNoteEditor(n, { onChange }); });
  return b;
}

function colorPicker(selected, onPick) {
  const wrap = h('div', { class: 'note-colors', role: 'radiogroup', 'aria-label': 'Цвет стикера' });
  const draw = () => {
    wrap.replaceChildren(...NOTE_COLORS.map(c => {
      const dot = h('button', { type: 'button', class: `note-color c-${c} ${c === selected ? 'on' : ''}`, role: 'radio',
        'aria-checked': String(c === selected), 'aria-label': `Цвет ${c}` });
      dot.addEventListener('click', () => { haptic.select(); selected = c; onPick(c); draw(); });
      return dot;
    }));
  };
  draw();
  return wrap;
}

/** Быстрый ввод: поле растёт по мере текста, Enter с Ctrl/⌘ — сохранить. */
export function noteComposer({ day, onSaved, placeholder = 'Запиши мысль, идею или итог дня…', draftKey = 'notes' } = {}) {
  let color = 'yellow';
  const area = h('textarea', { class: 'input note-input', rows: '2', maxlength: '4000', placeholder, 'aria-label': 'Новая заметка' });
  const save = h('button', { type: 'button', class: 'btn small', disabled: true }, 'Сохранить');
  const grow = () => { area.style.height = 'auto'; area.style.height = `${Math.min(220, area.scrollHeight)}px`; };
  area.value = drafts.get(draftKey) || '';
  save.disabled = !area.value.trim();
  if (area.value) requestAnimationFrame(grow);
  area.addEventListener('input', () => { drafts.set(draftKey, area.value); save.disabled = !area.value.trim(); grow(); });
  const submit = async () => {
    const text = area.value.trim();
    if (!text) return;
    save.disabled = true;
    try {
      const { note } = await api.createNote({ text, color, ...(day ? { day } : {}) });
      area.value = '';
      drafts.delete(draftKey);
      grow();
      haptic.success();
      toast('📝 Записано', 'good', 1200);
      await changed(() => onSaved && onSaved(note));
    } catch (e) { toastError(e); save.disabled = false; }
  };
  save.addEventListener('click', submit);
  area.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); });
  return h('div', { class: `card note-composer` }, area,
    h('div', { class: 'spread', style: { marginTop: '8px' } }, colorPicker(color, c => { color = c; }), save));
}

export function openNoteEditor(n, { onChange } = {}) {
  let color = n.color;
  let pinned = n.pinned;
  const area = h('textarea', { class: 'input note-input big', rows: '8', maxlength: '4000', 'aria-label': 'Текст заметки' });
  area.value = n.text;
  const pin = h('button', { type: 'button', class: `chip c-yellow`, 'aria-pressed': String(pinned) }, pinned ? '📌 Закреплена' : '📌 Закрепить');
  pin.addEventListener('click', () => { haptic.select(); pinned = !pinned; pin.setAttribute('aria-pressed', String(pinned)); pin.textContent = pinned ? '📌 Закреплена' : '📌 Закрепить'; });
  const save = h('button', { type: 'button', class: 'btn block' }, 'Сохранить');
  const del = h('button', { type: 'button', class: 'btn block ghost', style: { marginTop: '8px' } }, 'Удалить заметку');
  const s = sheet(h('div', null,
    h('div', { class: 'spread', style: { marginBottom: '10px' } }, h('h2', null, 'Заметка'), h('span', { class: 'tiny muted bold' }, noteDay(n.day))),
    area, h('div', { class: 'spread', style: { margin: '10px 0 14px' } }, colorPicker(color, c => { color = c; }), pin),
    save, del), { label: 'Заметка' });
  save.addEventListener('click', async () => {
    if (!area.value.trim()) return toast('Заметка пустая', '', 1500);
    save.disabled = true;
    try {
      await api.updateNote(n.id, { text: area.value, color, pinned });
      haptic.success();
      s.close();
      await changed(onChange);
    } catch (e) { toastError(e); save.disabled = false; }
  });
  let armed = false;
  del.addEventListener('click', async () => {
    if (!armed) { armed = true; del.textContent = 'Точно удалить? Нажми ещё раз'; haptic.tap(); return; }
    try {
      await api.deleteNote(n.id);
      haptic.success();
      s.close();
      toast('Заметка удалена', '', 1400);
      await changed(onChange);
    } catch (e) { toastError(e); }
  });
}
