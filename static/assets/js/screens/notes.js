// Все заметки: быстрая запись, поиск, стикеры с датой (нажатие — редактор).

import { h, clear } from '../dom.js';
import { api } from '../api.js';
import { myMascot } from '../mascot.js';
import { skeleton, emptyState, toastError } from '../ui.js';
import { noteCard, noteComposer } from '../noteui.js';
import { todayIso } from '../planui.js';

const view = { query: '' };

export function render(el) {
  clear(el);
  el.append(h('header', { class: 'page-head' }, myMascot('wink', { size: 56 }),
    h('div', null, h('h1', null, 'Заметки'), h('p', null, 'Мысли, идеи и итоги дней — всё в одном месте'))));
  const list = h('div', { class: 'note-grid', style: { marginTop: '12px' } });
  const load = async () => {
    clear(list).append(skeleton(90), skeleton(90));
    try {
      const { notes } = await api.notes({ q: view.query.trim(), limit: 200 });
      clear(list);
      if (!notes.length) {
        list.append(h('div', { style: { gridColumn: '1 / -1' } }, emptyState(view.query ? 'Ничего не нашлось.' : 'Пока ни одной заметки — запиши первую мысль выше ✍️', { expr: 'wink' })));
        return;
      }
      list.append(...notes.map(n => noteCard(n, { onChange: load, showDay: true })));
    } catch (e) { clear(list); toastError(e); }
  };
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск по заметкам', value: view.query,
    'aria-label': 'Поиск по заметкам', style: { marginTop: '12px' } });
  let t = null;
  search.addEventListener('input', () => { view.query = search.value; clearTimeout(t); t = setTimeout(load, 300); });
  el.append(noteComposer({ day: todayIso(), draftKey: 'notes-screen', onSaved: load }), search, list);
  load();
}
