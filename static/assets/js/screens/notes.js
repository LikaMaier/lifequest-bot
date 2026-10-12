// Заметки: быстрый ввод, поиск и стикеры по дням (закреплённые — сверху).

import { h, clear, plural } from '../dom.js';
import { api } from '../api.js';
import { mascot } from '../mascot.js';
import { skeleton, sectionTitle, emptyState } from '../ui.js';
import { noteCard, noteComposer, noteDay } from '../noteui.js';

const view = { q: '' };
let timer = null;

export function render(el, ctx) {
  clear(el);
  el.append(h('header', { class: 'page-head' }, mascot(ctx.state.user.mascot, 'happy', { size: 56, acc: ctx.state.user.accessory }),
    h('div', null, h('h1', null, 'Заметки'), h('p', null, 'Мысли, идеи, списки и итоги дня. Видишь их только ты.'))));
  const listHost = h('div');
  el.append(noteComposer()); // после сохранения состояние обновится и вызовет update()
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск по заметкам', value: view.q,
    'aria-label': 'Поиск по заметкам', style: { margin: '14px 0 4px' } });
  search.addEventListener('input', () => {
    view.q = search.value;
    clearTimeout(timer);
    timer = setTimeout(() => drawList(listHost, ctx), 250);
  });
  el.append(search, listHost);
  drawList(listHost, ctx);
}

export function update(el, ctx) {
  const host = el.querySelector('.notes-list-host');
  if (host) drawList(host, ctx); else render(el, ctx);
}

async function drawList(host, ctx) {
  host.className = 'notes-list-host';
  clear(host).append(skeleton(90), h('div', { style: { height: '10px' } }), skeleton(90));
  let data;
  try {
    data = await api.notes({ q: view.q.trim(), limit: 200 });
  } catch (e) {
    clear(host).append(h('p', { class: 'muted bold' }, e.message));
    return;
  }
  clear(host);
  const onChange = null; // update() перерисует список после refreshState
  if (!data.notes.length) {
    host.append(h('div', { class: 'card', style: { marginTop: '10px' } },
      emptyState(view.q ? 'Ничего не нашлось 🤔' : 'Здесь будут твои заметки. Начни с одной строчки — например, что сегодня порадовало.',
        { kind: 'star', expr: view.q ? 'surprised' : 'wink' })));
    return;
  }
  const pinned = data.notes.filter(n => n.pinned);
  if (pinned.length) host.append(sectionTitle('📌 Закреплённые'), h('div', { class: 'note-grid' }, pinned.map(n => noteCard(n, { onChange, showDay: true }))));
  const byDay = new Map();
  for (const n of data.notes.filter(x => !x.pinned)) {
    if (!byDay.has(n.day)) byDay.set(n.day, []);
    byDay.get(n.day).push(n);
  }
  const today = ctx.state.today.date;
  for (const [day, list] of byDay) {
    host.append(sectionTitle(day === today ? 'Сегодня' : noteDay(day)), h('div', { class: 'note-grid' }, list.map(n => noteCard(n, { onChange }))));
  }
  if (data.total > data.notes.length) {
    host.append(h('p', { class: 'tiny muted bold center', style: { marginTop: '10px' } },
      `Показаны последние ${data.notes.length} из ${data.total} ${plural(data.total, 'заметки', 'заметок', 'заметок')} — найди старые поиском`));
  }
}
