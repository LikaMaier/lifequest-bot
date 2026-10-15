// ② Квесты: три кнопки случайного задания с выбором сферы, списки
// активных / выполненных / избранных с поиском и фильтром по сфере.

import { h, clear, plural, fmtDay } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { myMascot } from '../mascot.js';
import { emptyState, sectionTitle, skeleton, busy, toastError, sheet, SPHERE_INFO } from '../ui.js';
import { modeButtons, openQuest, questItem, completeQuest, sphereChips, openMoodQuest } from '../questflow.js';
import { openPaywall } from '../premium.js';

const view = { packs: null, tab: 'active', query: '', soloSphere: null, history: null, historyLoading: false };

export function render(el, ctx) {
  clear(el);
  const { state } = ctx;
  const chBtn = h('button', { type: 'button', class: 'btn small colored c-lime', style: { flexShrink: 0 } },
    state.challenge ? `${state.challenge.emoji} ${state.challenge.done}/${state.challenge.days}` : '🏆 Челленджи');
  chBtn.addEventListener('click', () => { haptic.tap(); ctx.go('challenges'); });
  el.append(h('header', { class: 'page-head' }, myMascot('silly', { size: 56 }),
    h('div', { class: 'grow' }, h('h1', null, 'Квесты'), h('p', null, 'Выбери формат — я подкину задание. Не понравится — возьмём другое.')), chBtn));

  // Генератор
  el.append(h('div', { class: 'small bold muted', style: { margin: '0 2px 8px' } }, 'Сфера задания «Для себя»'),
    sphereChips(view.soloSphere, sp => { view.soloSphere = sp; }),
    modeButtons(() => view.soloSphere),
    moodButton(),
    h('p', { class: 'center tiny muted bold', style: { marginTop: '4px' } },
      `Сегодня ещё ${state.rolls_left} ${plural(state.rolls_left, 'попытка', 'попытки', 'попыток')} — заданий без повторов хватит надолго`));

  // Тематические наборы
  const packsHost = h('div', { class: 'pack-row', role: 'list', 'aria-label': 'Наборы квестов' });
  el.append(sectionTitle('Наборы квестов'), packsHost);
  drawPacks(packsHost, ctx);

  // Переключатель списков
  const seg = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Списки заданий', style: { marginTop: '22px' } },
    [['active', `Активные · ${state.active.length}`], ['done', 'Выполненные'], ['fav', `Избранное · ${state.favorites.length}`]].map(([key, label]) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-pressed': String(view.tab === key), 'aria-selected': String(view.tab === key) }, label);
      b.addEventListener('click', () => { haptic.select(); view.tab = key; render(el, ctx); });
      return b;
    }));
  el.append(seg);

  // Поиск и фильтр
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск по названию', value: view.query, 'aria-label': 'Поиск по заданиям', style: { marginTop: '12px' } });
  const listHost = h('div', { class: 'stack-sm', style: { marginTop: '10px' } });
  search.addEventListener('input', () => { view.query = search.value; drawList(listHost, ctx); });
  el.append(search, listHost);
  drawList(listHost, ctx);
}

function moodButton() {
  const b = h('button', { type: 'button', class: 'btn block colored c-purple', style: { marginTop: '10px' } }, '✨ Квест под настроение');
  b.addEventListener('click', () => { haptic.tap(); openMoodQuest(); });
  return b;
}

async function drawPacks(host, ctx) {
  if (!view.packs) {
    host.append(skeleton(96, { width: '100%' }));
    try { view.packs = (await api.packs()).packs; } catch (e) { clear(host); return; }
  }
  clear(host);
  for (const p of view.packs) {
    const card = h('button', { type: 'button', class: 'pack-card', role: 'listitem', 'aria-label': p.name },
      h('span', { class: 'pack-emoji', 'aria-hidden': 'true' }, p.emoji),
      h('span', { class: 'bold' }, p.name),
      h('span', { class: 'tiny bold muted' }, p.until ? `⏳ до ${p.until}` : `${p.done}/${p.quests.length} выполнено`));
    card.addEventListener('click', () => { haptic.tap(); openPack(p, ctx); });
    host.append(card);
  }
}

function openPack(p, ctx) {
  const s = sheet(h('div', null,
    h('div', { class: 'center' }, h('div', { style: { fontSize: '48px' }, 'aria-hidden': 'true' }, p.emoji),
      h('h2', null, p.name), h('p', { class: 'muted bold small', style: { margin: '4px 0 14px' } }, p.about)),
    h('div', { class: 'stack-sm' }, p.quests.map(q => {
      const active = ctx.state.active.find(a => a.id === q.id);
      const trailing = q.status === 'done' ? h('span', { class: 'tag c-lime' }, '✓')
        : q.locked ? h('span', { class: 'tag c-yellow' }, '🔒') : active ? h('span', { class: 'tag c-blue' }, 'в работе') : null;
      return questItem(q, () => {
        if (q.locked) { s.close(); openPaywall('pack'); return; }
        s.close();
        openQuest(active || q);
      }, trailing);
    })),
    p.quests.some(q => q.locked) ? h('p', { class: 'tiny muted bold center', style: { marginTop: '12px' } },
      `Первые ${p.free} задания — бесплатно, остальные — с Premium`) : null), { label: p.name });
}

export function update(el, ctx) {
  view.packs = null;
  view.history = null; // выполненные могли измениться
  render(el, ctx);
}

function matches(q) {
  const query = view.query.trim().toLowerCase();
  return !query || q.title.toLowerCase().includes(query) || (q.text || '').toLowerCase().includes(query);
}

async function drawList(host, ctx) {
  clear(host);
  const { state } = ctx;
  if (view.tab === 'active') {
    const items = state.active.filter(matches);
    if (!items.length) return host.append(emptyState(state.active.length ? 'Ничего не нашлось — попробуй другой запрос.' : 'Активных заданий нет. Нажми кнопку выше — и вперёд!', { kind: 'cat-blue' }));
    for (const q of items) {
      const done = h('button', { type: 'button', class: 'btn small colored c-lime', 'aria-label': `Выполнено: ${q.title}` }, 'Готово');
      done.addEventListener('click', busy(done, async () => { haptic.tap(); await completeQuest(q.active_id); }));
      host.append(questItem(q, () => openQuest(q), done));
    }
    return;
  }
  if (view.tab === 'fav') {
    const items = state.favorites.filter(matches);
    if (!items.length) return host.append(emptyState(state.favorites.length ? 'Ничего не нашлось.' : 'Здесь появятся задания, которые ты сохранишь сердечком 💛', { kind: 'heart', expr: 'love' }));
    for (const q of items) {
      const active = state.active.find(a => a.id === q.id);
      host.append(questItem(q, () => openQuest(active || q)));
    }
    return;
  }
  // Выполненные — из истории (подгружаем один раз)
  if (!view.history) {
    host.append(skeleton(64), skeleton(64), skeleton(64));
    if (!view.historyLoading) {
      view.historyLoading = true;
      try {
        view.history = (await api.stats('all')).history;
      } catch (e) {
        toastError(e);
        view.history = [];
      } finally {
        view.historyLoading = false;
      }
      drawList(host, ctx);
    }
    return;
  }
  const items = view.history.filter(matches);
  if (!items.length) return host.append(emptyState(view.history.length ? 'Ничего не нашлось.' : 'Пока пусто — здесь будет твоя коллекция выполненных приключений 🏆', { kind: 'star' }));
  host.append(h('p', { class: 'tiny muted bold' }, 'Последние выполненные'));
  for (const q of items) {
    host.append(questItem({ ...q, sphere: q.sphere && SPHERE_INFO[q.sphere] ? q.sphere : null }, null,
      h('div', { class: 'center', style: { flexShrink: 0 } }, h('div', { class: 'tiny bold muted' }, fmtDay(q.date)), q.xp ? h('div', { class: 'tiny bold' }, `+${q.xp} XP`) : null)));
  }
}
