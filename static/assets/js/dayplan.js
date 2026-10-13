// План дня как одно поле ввода: каждая строка — план (главная и день в календаре).
// Enter — следующая строка, пустая строка — план удалён, квадратик — выполнено.
// Время можно написать в начале строки: «18:30 зал».
// Пока человек печатает, главная не перерисовывается (иначе на телефоне
// закроется клавиатура): сохраняем по месту, а общее состояние обновляем,
// когда фокус ушёл из поля.

import { h } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { toastError } from './ui.js';
import { refreshState } from './store.js';
import { completePlan, openPlanSheet } from './planui.js';

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
    const locked = plan && (done || plan.quest); // задание из банка правится в календаре
    const check = h('button', { type: 'button', class: `dp-check ${done ? 'on' : ''}`, disabled: !plan || done || !canComplete,
      'aria-label': plan ? (done ? `Выполнено: ${plan.title}` : `Отметить выполненным: ${plan.title}`) : 'Сначала напиши план' }, done ? '✓' : '');
    const input = h('input', { class: 'dp-text', type: 'text', maxlength: '130', enterkeyhint: 'next', autocomplete: 'off',
      'aria-label': plan ? `План: ${plan.title}` : 'Новый план', readonly: locked ? true : null });
    const del = h('button', { type: 'button', class: 'dp-del', 'aria-label': 'Удалить план' }, '✕');
    const line = h('div', { class: `dp-line ${done ? 'done' : ''} ${plan ? '' : 'new'}`, role: 'listitem' }, check, input, del);
    del.addEventListener('click', () => { haptic.tap(); remove(line); });
    line._plan = plan;
    input.value = plan ? lineText(plan) : draft.text;

    check.addEventListener('click', async () => {
      if (!line._plan || line.classList.contains('done')) return;
      haptic.tap();
      line.classList.add('done');
      check.classList.add('on');
      check.textContent = '✓';
      try { await completePlan(line._plan); } catch (e) { line.classList.remove('done'); check.classList.remove('on'); check.textContent = ''; toastError(e); }
    });
    if (locked) input.addEventListener('click', () => { haptic.tap(); openPlanSheet(plan); });
    // Сохраняем сами, через секунду после последней буквы: на iPhone в Telegram
    // событие «ушёл из поля» приходит не всегда — без этого правки терялись.
    input.addEventListener('input', () => {
      if (!line._plan) draft.text = input.value;
      clearTimeout(line._timer);
      line._timer = setTimeout(() => commit(line), 900);
    });
    input.addEventListener('change', () => commit(line));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(line);
        // Фокус переносим сразу, в том же нажатии — клавиатура не закрывается.
        const next = line.nextElementSibling;
        if (next && !next.classList.contains('new')) next.querySelector('.dp-text').focus();
        else if (next) next.querySelector('.dp-text').focus();
        else if (input.value.trim()) { const fresh = makeLine(null); box.append(fresh); fresh.querySelector('.dp-text').focus(); }
      } else if (e.key === 'Backspace' && !input.value && line.previousElementSibling) {
        e.preventDefault();
        const prev = line.previousElementSibling.querySelector('.dp-text');
        prev.focus();
        prev.setSelectionRange(prev.value.length, prev.value.length);
        if (line._plan) commit(line);
      }
    });
    input.addEventListener('blur', () => { clearTimeout(line._timer); commit(line); });
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
    if (isLast) line.classList.add('new'); else line.remove();
    if (!plan) return;
    try { await (line._saving || Promise.resolve()); await dropPlan(plan); dirty = true; scheduleRefresh(); }
    catch (e) { toastError(e); }
  }

  async function commit(line) {
    if (line._saving) { line._again = true; return line._saving; } // допишем, когда закончится текущее сохранение
    const input = line.querySelector('.dp-text');
    if (input.readOnly || !line.isConnected) return null;
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
