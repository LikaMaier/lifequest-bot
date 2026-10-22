// Сферы пользователя: стандартные (их можно переименовать, сменить эмодзи
// и цвет, удалить и потом вернуть) и свои (можно добавить и удалить).
// Используются у привычек и в статистике «Прогресс».

import { h } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { sheet, toast, toastError, busy } from './ui.js';
import { store, refreshState } from './store.js';

const COLORS = ['lime', 'blue', 'pink', 'yellow', 'lav', 'orange', 'purple', 'red'];
const EMOJIS = ['🛡️', '🔋', '📚', '🦁', '🧭', '🎨', '💼', '💰', '❤️', '👨‍👩‍👧', '🏠', '🧘', '🏃', '🍎', '😴', '🎵',
  '✈️', '🌱', '🧠', '🤝', '📈', '🎓', '🙏', '⭐'];

export const userSpheres = () => (store.state && store.state.user_spheres) || [];
export const sphereByKey = key => userSpheres().find(s => s.key === key) || null;

/** Список сфер: изменить любую, добавить свою. */
export function openSphereManager({ onChange } = {}) {
  let s;
  const draw = () => {
    const rows = userSpheres().map(sp => {
      const b = h('button', { type: 'button', class: `quest-item c-${sp.color}` },
        h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, sp.emoji),
        h('span', { class: 'grow' }, h('span', { class: 'q-title', style: { display: 'block' } }, sp.name),
          h('span', { class: 'q-meta', style: { display: 'block' } }, sp.custom ? 'своя сфера' : 'стандартная · квесты тоже считаются сюда')),
        h('span', { 'aria-hidden': 'true' }, '✏️'));
      b.addEventListener('click', () => { haptic.tap(); openSphereEditor(sp, { onDone: changed }); });
      return b;
    });
    const add = h('button', { type: 'button', class: 'btn block' }, '＋ Своя сфера');
    add.addEventListener('click', () => { haptic.tap(); openSphereEditor(null, { onDone: changed }); });
    // удалённые стандартные сферы можно вернуть
    const gone = (store.state && store.state.user_spheres_hidden) || [];
    const back = gone.map(sp => {
      const b = h('button', { type: 'button', class: 'chip' }, `↺ ${sp.emoji} ${sp.name}`);
      b.addEventListener('click', busy(b, async () => {
        try {
          const res = await api.updateSphere(sp.key, { reset: true });
          store.state.user_spheres = res.spheres;
          store.state.user_spheres_hidden = res.hidden;
          haptic.success();
          refreshState().catch(() => {});
          changed();
        } catch (e) { toastError(e); }
      }));
      return b;
    });
    s.setContent(h('div', null,
      h('h2', { class: 'center' }, 'Сферы жизни'),
      h('p', { class: 'center small bold muted', style: { margin: '4px 0 14px' } },
        'Привычки можно отнести к сфере — так в «Прогрессе» видно, чему ты уделяешь время'),
      h('div', { class: 'stack-sm' }, rows), h('div', { style: { marginTop: '14px' } }, add),
      back.length ? h('div', { style: { marginTop: '14px' } },
        h('div', { class: 'small bold muted', style: { margin: '0 2px 6px' } }, 'Вернуть удалённые'),
        h('div', { class: 'chips' }, back)) : null));
  };
  const changed = () => { draw(); onChange && onChange(); };
  s = sheet(h('div'), { label: 'Сферы жизни' });
  draw();
  return s;
}

/** Редактор сферы: название, эмодзи, цвет; удалить; стандартная — ещё и вернуть как было. */
export function openSphereEditor(sp, { onDone } = {}) {
  const isNew = !sp;
  const form = { name: sp ? sp.name : '', emoji: sp ? sp.emoji : '⭐', color: sp ? sp.color : 'lav' };
  const s = sheet(h('div'), { label: isNew ? 'Новая сфера' : 'Сфера' });
  const finish = async res => {
    store.state.user_spheres = res.spheres;
    if (res.hidden) store.state.user_spheres_hidden = res.hidden;
    haptic.success();
    s.close();
    refreshState().catch(() => {});
    onDone && onDone();
  };
  const draw = () => {
    const name = h('input', { class: 'input', type: 'text', maxlength: '24', placeholder: 'Например: Семья', value: form.name, 'aria-label': 'Название сферы' });
    name.addEventListener('input', () => { form.name = name.value; });
    const emojis = h('div', { class: 'emoji-grid', role: 'radiogroup', 'aria-label': 'Эмодзи' }, EMOJIS.map(e => {
      const b = h('button', { type: 'button', class: `emoji-pick ${e === form.emoji ? 'on' : ''}`, role: 'radio', 'aria-checked': String(e === form.emoji), 'aria-label': e }, e);
      b.addEventListener('click', () => { haptic.select(); form.emoji = e; form.name = name.value; draw(); });
      return b;
    }));
    const colors = h('div', { class: 'row-wrap', role: 'radiogroup', 'aria-label': 'Цвет' }, COLORS.map(c => {
      const b = h('button', { type: 'button', class: `accent-pick c-${c} ${c === form.color ? 'on' : ''}`, role: 'radio', 'aria-checked': String(c === form.color), 'aria-label': `Цвет ${c}` }, c === form.color ? '✓' : '');
      b.addEventListener('click', () => { haptic.select(); form.color = c; form.name = name.value; draw(); });
      return b;
    }));
    const save = h('button', { type: 'button', class: 'btn block' }, isNew ? 'Добавить сферу' : 'Сохранить');
    save.addEventListener('click', busy(save, async () => {
      form.name = name.value;
      try {
        await finish(isNew ? await api.createSphere(form) : await api.updateSphere(sp.key, form));
        toast(isNew ? `${form.emoji} Сфера добавлена` : 'Сохранено ✓', 'good', 1600);
      } catch (e) { toastError(e); }
    }));
    const extra = [];
    if (sp && !sp.custom) {
      const reset = h('button', { type: 'button', class: 'btn ghost block' }, '↺ Вернуть как было');
      reset.addEventListener('click', busy(reset, async () => {
        try { await finish(await api.updateSphere(sp.key, { reset: true })); } catch (e) { toastError(e); }
      }));
      extra.push(reset);
    }
    if (sp) {
      const del = h('button', { type: 'button', class: 'btn ghost block sphere-del' }, '🗑️ Удалить сферу');
      del.addEventListener('click', busy(del, async () => {
        try {
          await finish(await api.deleteSphere(sp.key));
          toast(sp.custom ? 'Сфера удалена — привычки остались без сферы' : 'Сфера удалена — вернуть её можно в списке сфер', '', 2600);
        } catch (e) { toastError(e); }
      }));
      extra.push(del);
    }
    s.setContent(h('div', { class: 'stack' },
      h('h2', null, isNew ? 'Новая сфера' : 'Сфера'),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Название'), name),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Эмодзи'), emojis),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Цвет'), colors),
      save, ...extra));
  };
  draw();
  return s;
}
