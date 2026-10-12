// «План на сегодня» как одно поле ввода: каждая строка — план.
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
const draft = { text: '' }; // недописанная последняя строка

function parseLine(text) {
  const m = text.trim().match(TIME_RE);
  if (!m) return { title: text.trim(), time: null };
  return { title: m[3].trim(), time: `${m[1].padStart(2, '0')}:${m[2]}` };
}
const lineText = o => (o.time ? `${o.time} ${o.title}` : o.title);

export function dayPlanField(plans, today) {
  const box = h('div', { class: 'dayplan', role: 'list', 'aria-label': 'План на сегодня' });
  let dirty = false;

  const sorted = [...plans].sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.time || '99').localeCompare(b.time || '99'));

  function makeLine(plan) {
    const done = plan && plan.status === 'done';
    const locked = plan && (done || plan.quest); // задание из банка правится в календаре
    const check = h('button', { type: 'button', class: `dp-check ${done ? 'on' : ''}`, disabled: !plan || done,
      'aria-label': plan ? (done ? `Выполнено: ${plan.title}` : `Отметить выполненным: ${plan.title}`) : 'Сначала напиши план' }, done ? '✓' : '');
    const input = h('input', { class: 'dp-text', type: 'text', maxlength: '130', enterkeyhint: 'next', autocomplete: 'off',
      'aria-label': plan ? `План: ${plan.title}` : 'Новый план', readonly: locked ? true : null });
    const line = h('div', { class: `dp-line ${done ? 'done' : ''} ${plan ? '' : 'new'}`, role: 'listitem' }, check, input);
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
    input.addEventListener('input', () => { if (!line._plan) draft.text = input.value; });
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
    input.addEventListener('blur', () => commit(line));
    return line;
  }

  async function commit(line) {
    if (line._saving) return line._saving;
    const input = line.querySelector('.dp-text');
    if (input.readOnly) return null;
    const text = input.value.trim();
    const plan = line._plan;
    const isLast = line === box.lastElementChild;
    let job = null;
    if (!plan && text) {
      const { title, time } = parseLine(text);
      draft.text = '';
      line.classList.remove('new');
      job = api.createPlan({ title, date: today, ...(time ? { time } : {}) }).then(res => {
        line._plan = res.plan;
        line.querySelector('.dp-check').disabled = false;
        input.setAttribute('aria-label', `План: ${res.plan.title}`);
        if (!box.querySelector('.dp-line.new')) box.append(makeLine(null)); // всегда есть пустая строка
      });
    } else if (plan && !text) {
      // Очистил строку — план убран: разовый удаляем, повторяющийся пропускаем сегодня.
      job = (plan.repeat_rule && plan.repeat_rule !== 'none' ? api.skipPlan(plan.id, plan.date) : api.deletePlan(plan.id))
        .then(() => { if (!isLast) line.remove(); else { line._plan = null; line.classList.add('new'); } });
    } else if (plan && text !== lineText(plan)) {
      const { title, time } = parseLine(text);
      job = api.patchPlan(plan.id, { title, time: time || null }).then(res => {
        line._plan = { ...plan, ...(res.plan || {}), title, time };
        input.value = lineText(line._plan);
      });
    }
    if (!job) return null;
    dirty = true;
    line._saving = job.catch(e => toastError(e)).finally(() => { line._saving = null; });
    return line._saving;
  }

  sorted.forEach(o => box.append(makeLine(o)));
  box.append(makeLine(null));
  const first = box.querySelector('.dp-line.new .dp-text');
  first.placeholder = sorted.length ? 'Ещё дело…' : 'Что сегодня в планах?';

  // Фокус ушёл из поля — обновляем общее состояние (кольцо дня, счётчики).
  box.addEventListener('focusout', () => {
    setTimeout(async () => {
      if (!dirty || box.contains(document.activeElement)) return;
      dirty = false;
      await Promise.all([...box.querySelectorAll('.dp-line')].map(l => l._saving).filter(Boolean));
      refreshState().catch(() => {});
    }, 250);
  });
  // Нажатие на свободное место поля — к последней строке.
  box.addEventListener('click', e => {
    if (e.target === box) { const last = box.lastElementChild.querySelector('.dp-text'); last.focus(); }
  });
  return box;
}
