// План дня как одно поле ввода: каждая строка — план (главная и день в календаре).
// Enter — следующая строка, ✏️ — изменить, ✕ — удалить, квадратик — выполнено/снять.
// Время можно написать в начале строки: «18:30 зал».
// Пока человек печатает, главная не перерисовывается (иначе на телефоне
// закроется клавиатура): сохраняем по месту, а общее состояние обновляем,
// когда фокус ушёл из поля.

import { h } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { toastError, sheet, SPHERE_INFO } from './ui.js';
import { refreshState } from './store.js';
import { completePlan } from './planui.js';

const TIME_RE = /^([01]?\d|2[0-3])[:.]([0-5]\d)\s+(.+)$/;
const drafts = new Map(); // недописанная последняя строка — по дню

function parseLine(text) {
  const m = text.trim().match(TIME_RE);
  if (!m) return { title: text.trim(), time: null };
  return { title: m[3].trim(), time: `${m[1].padStart(2, '0')}:${m[2]}` };
}
const lineText = o => (o.time ? `${o.time} ${o.title}` : o.title);

export function dayPlanField(plans, date, { onChange, canComplete = true, placeholder = 'Что сегодня в планах?' } = {}) {
  const draft = { get text() { return drafts.get(date) || ''; }, set text(v) { if (v) drafts.set(date, v); else drafts.delete(date); } };
  const box = h('div', { class: 'dayplan', role: 'list', 'aria-label': 'План на сегодня' });
  let dirty = false;

  const sorted = [...plans].sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.time || '99').localeCompare(b.time || '99'));

  function makeLine(plan) {
    const done = plan && plan.status === 'done';
    const check = h('button', { type: 'button', class: `dp-check ${done ? 'on' : ''}`, disabled: !plan || !canComplete,
      'aria-label': plan ? (done ? `Снять отметку: ${plan.title}` : `Отметить выполненным: ${plan.title}`) : 'Сначала напиши план' }, done ? '✓' : '');
    // Сохранённый план — просто текст: нажатие ничего не открывает,
    // править — карандашом, удалять — крестиком.
    const input = h('input', { class: 'dp-text', type: 'text', maxlength: '130', enterkeyhint: 'done', autocomplete: 'off',
      'aria-label': plan ? `План: ${plan.title}` : 'Новый план', readonly: plan ? true : null });
    const edit = h('button', { type: 'button', class: 'dp-edit', 'aria-label': 'Изменить план' }, '✏️');
    const del = h('button', { type: 'button', class: 'dp-del', 'aria-label': 'Удалить план' }, '✕');
    const tag = h('button', { type: 'button', class: 'dp-tag', 'aria-label': 'Категория плана' });
    const line = h('div', { class: `dp-line ${done ? 'done' : ''} ${plan ? '' : 'new'} ${plan && plan.quest ? 'quest' : ''}`, role: 'listitem' },
      check, input, tag, edit, del);
    const drawTag = () => {
      const sp = line._plan && line._plan.sphere;
      tag.textContent = sp && SPHERE_INFO[sp] ? SPHERE_INFO[sp].emoji : '🏷️';
      tag.classList.toggle('empty', !sp);
      tag.setAttribute('aria-label', sp ? `Категория: ${sp}` : 'Выбрать категорию');
    };
    tag.addEventListener('click', () => {
      if (!line._plan) return;
      haptic.tap();
      pickSphere(line._plan.sphere, async sp => {
        const p = line._plan;
        line._plan = { ...p, sphere: sp };
        drawTag();
        try { await api.patchPlan(p.id, { sphere: sp }); dirty = true; scheduleRefresh(); }
        catch (e) { line._plan = p; drawTag(); toastError(e); }
      });
    });
    line._plan = plan;
    input.value = plan ? lineText(plan) : draft.text;
    drawTag();

    del.addEventListener('click', () => { haptic.tap(); remove(line); });
    edit.addEventListener('click', () => {
      haptic.tap();
      line.classList.add('editing');
      input.readOnly = false;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    const stopEditing = () => {
      if (!line._plan) return; // новая строка остаётся строкой ввода
      input.readOnly = true;
      line.classList.remove('editing');
    };

    // Галочка ставится и снимается.
    check.addEventListener('click', async () => {
      const p = line._plan;
      if (!p) return;
      haptic.tap();
      const wasDone = line.classList.contains('done');
      const set = on => { line.classList.toggle('done', on); check.classList.toggle('on', on); check.textContent = on ? '✓' : '';
        check.setAttribute('aria-label', on ? `Снять отметку: ${p.title}` : `Отметить выполненным: ${p.title}`); };
      set(!wasDone);
      try {
        if (wasDone) { await api.uncompletePlan(p.id, p.date); line._plan = { ...p, status: 'planned' }; dirty = true; scheduleRefresh(); }
        else { await completePlan(p); line._plan = { ...p, status: 'done' }; }
      } catch (e) { set(wasDone); toastError(e); }
    });

    // Сохраняем сами, через секунду после последней буквы: на iPhone в Telegram
    // событие «ушёл из поля» приходит не всегда — без этого правки терялись.
    input.addEventListener('input', () => {
      if (!line._plan) draft.text = input.value;
      clearTimeout(line._timer);
      line._timer = setTimeout(() => commit(line), 900);
    });
    input.addEventListener('change', () => commit(line));
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(line._timer);
      commit(line);
      if (line.classList.contains('editing')) { stopEditing(); input.blur(); return; }
      // Новая строка: фокус сразу в следующую пустую — клавиатура не закрывается.
      if (input.value.trim()) {
        let fresh = box.querySelector('.dp-line.new:not(:focus-within)');
        if (!fresh || fresh === line) { fresh = makeLine(null); box.append(fresh); }
        fresh.querySelector('.dp-text').focus();
      }
    });
    input.addEventListener('blur', () => { clearTimeout(line._timer); commit(line); stopEditing(); });
    return line;
  }

  const dropPlan = plan => (plan.repeat_rule && plan.repeat_rule !== 'none'
    ? api.skipPlan(plan.id, plan.date) // повторяющийся — убираем только этот день
    : api.deletePlan(plan.id));

  // Крестик: удалить сразу, без вопросов.
  async function remove(line) {
    clearTimeout(line._timer);
    const plan = line._plan;
    const isLast = line === box.lastElementChild;
    line._plan = null;
    line.querySelector('.dp-text').value = '';
    if (isLast) { line.classList.add('new'); line.querySelector('.dp-text').readOnly = false; } else line.remove();
    if (!plan) return;
    try { await (line._saving || Promise.resolve()); await dropPlan(plan); dirty = true; scheduleRefresh(); }
    catch (e) { toastError(e); }
  }

  async function commit(line) {
    if (line._saving) { line._again = true; return line._saving; } // допишем, когда закончится текущее сохранение
    const input = line.querySelector('.dp-text');
    if (!line.isConnected || (line._plan && line._plan.quest)) return null;
    const text = input.value.trim();
    const plan = line._plan;
    const focused = document.activeElement === input;
    let job = null;
    if (!plan && text) {
      const { title, time } = parseLine(text);
      draft.text = '';
      line.classList.remove('new');
      job = api.createPlan({ title, date, ...(time ? { time } : {}) }).then(res => {
        line._plan = res.plan;
        drawTag();
        line.querySelector('.dp-check').disabled = !canComplete;
        input.setAttribute('aria-label', `План: ${res.plan.title}`);
        if (!box.querySelector('.dp-line.new')) box.append(makeLine(null)); // всегда есть пустая строка
      });
    } else if (plan && !text) {
      // Строку стёрли — план убран. Пока человек в строке, она остаётся (можно вписать новое).
      line._plan = null;
      job = dropPlan(plan).then(() => {
        if (!focused && line !== box.lastElementChild) line.remove();
        else line.classList.add('new');
      });
    } else if (!plan && !text && !focused && line !== box.lastElementChild) {
      line.remove(); // пустая строка в середине — убираем
      return null;
    } else if (plan && text !== lineText(plan)) {
      const { title, time } = parseLine(text);
      job = api.patchPlan(plan.id, { title, time: time || null }).then(res => {
        line._plan = { ...plan, ...(res.plan || {}), title, time };
      });
    }
    if (!job) return null;
    dirty = true;
    line._saving = job.catch(e => toastError(e)).finally(() => {
      line._saving = null;
      if (line._again) { line._again = false; commit(line); }
      scheduleRefresh();
    });
    return line._saving;
  }

  // Общее состояние (кольцо дня, календарь) обновляем, когда человек вышел из поля.
  let refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (!dirty || box.contains(document.activeElement)) return;
      dirty = false;
      await Promise.all([...box.querySelectorAll('.dp-line')].map(l => l._saving).filter(Boolean));
      refreshState().catch(() => {});
      onChange && onChange();
    }, 300);
  }

  sorted.forEach(o => box.append(makeLine(o)));
  box.append(makeLine(null));
  const first = box.querySelector('.dp-line.new .dp-text');
  first.placeholder = sorted.length ? 'Ещё дело…' : placeholder;

  box.addEventListener('focusout', scheduleRefresh);
  // Нажатие на свободное место поля — к последней строке.
  box.addEventListener('click', e => {
    if (e.target === box) { const last = box.lastElementChild.querySelector('.dp-text'); last.focus(); }
  });
  return box;
}

/** Выбор категории (сферы) плана: она попадает в ползунки статистики. */
export function pickSphere(current, onPick) {
  const s = sheet(h('div', null,
    h('h2', { class: 'center' }, 'Категория плана'),
    h('p', { class: 'center small bold muted', style: { margin: '4px 0 14px' } }, 'Выполненные планы попадут в статистику по сферам'),
    h('div', { class: 'stack-sm' }, [...Object.entries(SPHERE_INFO), [null, { emoji: '✖️', color: 'paleyellow' }]].map(([sp, info]) => {
      const b = h('button', { type: 'button', class: `quest-item c-${info.color}`, 'aria-pressed': String(sp === (current || null)) },
        h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, info.emoji),
        h('span', { class: 'grow q-title' }, sp || 'Без категории'),
        sp === (current || null) ? h('span', { class: 'bold' }, '✓') : null);
      b.addEventListener('click', () => { haptic.select(); s.close(); if (sp !== (current || null)) onPick(sp); });
      return b;
    }))), { label: 'Категория плана' });
  return s;
}
