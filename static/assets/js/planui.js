// Планы календаря: строка плана, лист плана с действиями, редактор,
// выбор задания из банка, выбор даты, лист дня.

import { h, clear, fmtDay, parseDate } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { dayPlanField } from './dayplan.js';
import { noteCard, noteComposer } from './noteui.js';
import { store, refreshState } from './store.js';
import { celebrate } from './celebrate.js';
import { myMascot } from './mascot.js';
import { MODE_INFO, SPHERE_INFO, sheet, toast, toastError, busy, confetti, emptyState } from './ui.js';
import { questCard } from './questflow.js';
import { photoStrip, photosEnabled, openPhotoReport, memoryBoard } from './photoui.js';

export const PLAN_MODES = {
  ...MODE_INFO,
  free: { label: 'Свой план', short: 'План', emoji: '📝', color: 'yellow' },
};
export const PLAN_COLORS = ['lime', 'blue', 'pink', 'yellow', 'lav', 'orange', 'purple', 'red'];
const REPEAT_LABEL = { none: 'Не повторять', daily: 'Каждый день', weekdays: 'По будням', weekly: 'Раз в неделю' };
const REMIND_LABEL = { none: 'Без напоминания', at_time: 'В это время', hour_before: 'За час' };
const WEEKDAY_FULL = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });

export const todayIso = () => (store.state ? store.state.today.date : new Date().toISOString().slice(0, 10));
export const addDays = (iso, n) => {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const dayTitle = iso => `${fmtDay(iso)}, ${WEEKDAY_FULL.format(parseDate(iso))}`;
const planColor = o => o.color || PLAN_MODES[o.mode]?.color || 'yellow';

function changed(onChange) {
  refreshState().catch(() => {});
  onChange && onChange();
}

// ---------- Действия ----------
export async function completePlan(o, onChange) {
  const res = await api.completePlan(o.id, o.date);
  haptic.success();
  confetti(90);
  changed(onChange);
  await celebrate(res, { xpText: '🎉 Выполнено!' });
  // Задание из банка выполнено — предлагаем сохранить момент на календаре.
  if (o.quest_key && res.history_id) openPhotoReport(res.history_id, res.title || o.title, { intro: true });
  return res;
}

async function movePlan(o, to, onChange) {
  await api.movePlan(o.id, o.date, to);
  haptic.success();
  toast(`📅 Перенесено на ${fmtDay(to)}`, 'good');
  changed(onChange);
}

async function skipPlan(o, onChange) {
  await api.skipPlan(o.id, o.date);
  haptic.tap();
  toast('Отпустили — без чувства вины 🌿');
  changed(onChange);
}

// ---------- Строка плана ----------
export function planRow(o, { onChange, compact = false, onOpen = null } = {}) {
  const mode = PLAN_MODES[o.mode] || PLAN_MODES.free;
  const done = o.status === 'done';
  const skipped = o.status === 'skipped';
  const row = h('div', { class: `plan-row c-${planColor(o)} ${done ? 'done' : ''} ${skipped ? 'skipped' : ''}` });
  const meta = [o.time, o.sphere && SPHERE_INFO[o.sphere] ? `${SPHERE_INFO[o.sphere].emoji} ${o.sphere}` : null, o.repeat_rule !== 'none' ? '🔁' : null, o.photos ? `📷 ${o.photos}` : null].filter(Boolean).join(' · ');
  const info = h('button', { type: 'button', class: 'plan-info', 'aria-label': `${o.title}${o.time ? `, ${o.time}` : ''}. Открыть` },
    h('span', { class: 'plan-emoji', 'aria-hidden': 'true' }, o.quest ? o.quest.emoji : mode.emoji),
    h('span', { class: 'grow' }, h('span', { class: 'plan-title' }, o.title),
      h('span', { class: 'plan-meta' }, meta),
      o.overdue && !compact ? h('span', { class: 'tag c-paleyellow', style: { marginTop: '4px' } }, 'Не успелось?') : null));
  info.addEventListener('click', () => { haptic.tap(); (onOpen ? onOpen(o) : openPlanSheet(o, { onChange })); });
  row.append(info);
  if (!done && !skipped && o.date <= todayIso()) {
    const check = h('button', { type: 'button', class: 'plan-check', 'aria-label': `Выполнено: ${o.title}` }, '✓');
    check.addEventListener('click', busy(check, async () => {
      row.classList.add('done'); // оптимистично
      try { await completePlan(o, onChange); } catch (e) { row.classList.remove('done'); toastError(e); }
    }));
    row.append(check);
  } else if (done) {
    // Галочку можно снять (кроме задания из банка — оно уже засчитано в квестах).
    const mark = h('button', { type: 'button', class: 'plan-done-mark', 'aria-label': `Снять отметку: ${o.title}`, disabled: Boolean(o.quest_key) }, '✓');
    mark.addEventListener('click', busy(mark, async () => {
      haptic.tap();
      try { await api.uncompletePlan(o.id, o.date); changed(onChange); } catch (e) { toastError(e); }
    }));
    row.append(mark);
  }
  return row;
}

// ---------- Лист плана ----------
export function openPlanSheet(o, { onChange } = {}) {
  const s = sheet(h('div'), { label: o.title });
  const mode = PLAN_MODES[o.mode] || PLAN_MODES.free;
  const done = o.status === 'done';
  const body = h('div', { class: 'stack' });
  if (o.quest) body.append(questCard(o.quest));
  else {
    body.append(h('div', { class: `card tinted c-${planColor(o)}` },
      h('div', { class: 'row' }, h('span', { style: { fontSize: '30px' }, 'aria-hidden': 'true' }, mode.emoji),
        h('h2', { class: 'grow', style: { overflowWrap: 'anywhere' } }, o.title)),
      o.note ? h('p', { class: 'bold', style: { marginTop: '8px', whiteSpace: 'pre-line' } }, o.note) : null));
  }
  body.append(h('div', { class: 'row-wrap' },
    h('span', { class: 'tag c-blue' }, `📅 ${dayTitle(o.date)}`),
    o.time ? h('span', { class: 'tag c-lav' }, `⏰ ${o.time}`) : null,
    o.repeat_rule !== 'none' ? h('span', { class: 'tag c-lime' }, `🔁 ${REPEAT_LABEL[o.repeat_rule]}`) : null,
    o.remind !== 'none' ? h('span', { class: 'tag c-yellow' }, `🔔 ${REMIND_LABEL[o.remind]}`) : null,
    done ? h('span', { class: 'tag c-lime' }, '✓ Выполнено') : null,
    o.status === 'skipped' ? h('span', { class: 'tag c-paleyellow' }, 'Отпущено') : null));

  const act = (text, cls, fn) => {
    const b = h('button', { type: 'button', class: `btn ${cls}` }, text);
    b.addEventListener('click', busy(b, async () => { haptic.tap(); try { await fn(); } catch (e) { toastError(e); } }));
    return b;
  };

  if (o.overdue) {
    body.append(h('div', { class: 'card soft c-paleyellow row', style: { alignItems: 'flex-start' } },
      myMascot('wink', { size: 48 }),
      h('div', { class: 'grow stack-sm' }, h('div', { class: 'bold' }, 'Не успелось? Бывает!'),
        h('div', { class: 'small', style: { fontWeight: 600 } }, 'Можно перенести на завтра или просто отпустить — без чувства вины.'),
        h('div', { class: 'row-wrap' },
          act('Перенести на завтра', 'small', async () => { await movePlan(o, addDays(todayIso(), 1), onChange); s.close(); }),
          act('Отпустить', 'small ghost', async () => { await skipPlan(o, onChange); s.close(); })))));
  }
  if (!done && o.status !== 'skipped') {
    if (o.date <= todayIso()) body.append(act('✅ Выполнено', 'block', async () => { await completePlan(o, onChange); s.close(); }));
    body.append(h('div', { class: 'row' },
      act('📅 Перенести', 'ghost grow', async () => {
        const to = await pickDate(o.date === todayIso() ? addDays(o.date, 1) : todayIso(), 'Перенести на…');
        if (to) { await movePlan(o, to, onChange); s.close(); }
      }),
      act('✏️ Изменить', 'ghost grow', async () => { s.close(); openPlanEditor({ plan: o, onChange }); })));
  }
  if (!done && o.status !== 'skipped' && o.date >= todayIso()) {
    body.append(act(o.focus ? '🎯 Снять «главное дело»' : '🎯 Сделать главным делом дня', 'ghost block', async () => {
      await api.focusPlan(o.focus ? null : o.id, o.date);
      haptic.success();
      toast(o.focus ? 'Главное дело снято' : '🎯 Это главное сегодня — у тебя получится!', 'good');
      s.close();
      changed(onChange);
    }));
  }
  if (photosEnabled() && o.date <= todayIso()) {
    body.append(h('div', null, h('h3', { style: { marginBottom: '8px' } }, '📷 Фото'),
      photoStrip({ target: 'plan', plan_id: o.id, plan_date: o.date }, { onChange: () => onChange && onChange() })));
  }
  s.setContent(body);
  return s;
}

// ---------- Выбор даты ----------
export function pickDate(initial, title = 'Выбери дату') {
  return new Promise(resolve => {
    let value = initial || todayIso();
    let done = false;
    const s = sheet(h('div'), { label: title, onClose: () => { if (!done) resolve(null); } });
    const input = h('input', { class: 'input', type: 'date', value, 'aria-label': 'Дата' });
    input.addEventListener('change', () => { value = input.value; });
    const quick = (label, iso) => {
      const b = h('button', { type: 'button', class: 'chip c-yellow' }, label);
      b.addEventListener('click', () => { haptic.select(); value = iso; input.value = iso; });
      return b;
    };
    const ok = h('button', { type: 'button', class: 'btn block' }, 'Готово');
    ok.addEventListener('click', () => { if (!value) return; done = true; resolve(value); s.close(); });
    s.setContent(h('div', { class: 'stack' }, h('h2', null, title),
      h('div', { class: 'chips' }, quick('Сегодня', todayIso()), quick('Завтра', addDays(todayIso(), 1)),
        quick('Через неделю', addDays(todayIso(), 7))), input, ok));
  });
}

// ---------- Добавление ----------
export function openAddChooser(date, { onChange, boardCell } = {}) {
  const s = sheet(h('div'), { label: 'Добавить в план' });
  const big = (emoji, title, sub, color, fn) => {
    const b = h('button', { type: 'button', class: `quest-item c-${color}`, style: { minHeight: '72px' } },
      h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, emoji),
      h('span', { class: 'grow' }, h('span', { class: 'q-title', style: { display: 'block' } }, title), h('span', { class: 'q-meta', style: { display: 'block' } }, sub)));
    b.addEventListener('click', () => { haptic.tap(); s.close(); fn(); });
    return b;
  };
  s.setContent(h('div', { class: 'stack' },
    h('h2', null, `Планы на ${fmtDay(date)}`),
    big('🎯', 'Запланировать задание', 'Из банка LifeQuest — или случайное', 'purple', () => openQuestPicker(date, { onChange })),
    big('📝', 'Свой план', 'Название, время, повтор, напоминание', 'yellow', () => openPlanEditor({ date, onChange, boardCell }))));
}

export function openPlanEditor({ date, plan = null, onChange, boardCell = null, preset = null } = {}) {
  const isNew = !plan;
  const src = plan || preset || {};
  const form = {
    title: src.title || '', note: src.note || '', date: plan ? plan.date : (date || todayIso()), time: src.time || '',
    color: src.color || 'yellow', repeat_rule: src.repeat_rule || 'none', remind: src.remind || 'none',
    end: src.end_time || '',
  };
  const s = sheet(h('div'), { label: isNew ? 'Новый план' : 'Изменить план' });
  const draw = () => {
    const title = h('input', { class: 'input', type: 'text', maxlength: '80', placeholder: 'Например: Пикник в парке', value: form.title, 'aria-label': 'Что планируешь' });
    const note = h('textarea', { class: 'input', rows: 2, maxlength: '500', placeholder: 'Заметка (необязательно)', 'aria-label': 'Заметка' });
    note.value = form.note;
    const dateIn = h('input', { class: 'input', type: 'date', value: form.date, 'aria-label': 'Дата' });
    const timeIn = h('input', { class: 'input', type: 'time', value: form.time, 'aria-label': 'Время (необязательно)' });
    const endIn = h('input', { class: 'input', type: 'time', value: form.end, disabled: !form.time, 'aria-label': 'До скольки (необязательно)' });
    const sync = () => { form.title = title.value; form.note = note.value; form.date = dateIn.value; form.time = timeIn.value; form.end = form.time ? endIn.value : ''; };
    endIn.addEventListener('change', () => { sync(); draw(); });
    const seg = (options, key, label, disabled = false) => h('div', { class: 'segmented wrap', role: 'group', 'aria-label': label },
      Object.entries(options).map(([k, text]) => {
        const b = h('button', { type: 'button', 'aria-pressed': String(form[key] === k), disabled }, text);
        b.addEventListener('click', () => { haptic.select(); sync(); form[key] = k; draw(); });
        return b;
      }));
    timeIn.addEventListener('change', () => { sync(); if (!form.time) form.remind = 'none'; draw(); });
    const colors = h('div', { class: 'row-wrap', role: 'radiogroup', 'aria-label': 'Цвет-метка' }, PLAN_COLORS.map(c => {
      const b = h('button', { type: 'button', class: `accent-pick c-${c} ${c === form.color ? 'on' : ''}`, role: 'radio', 'aria-checked': String(c === form.color), 'aria-label': `Цвет ${c}` }, c === form.color ? '✓' : '');
      b.addEventListener('click', () => { haptic.select(); sync(); form.color = c; draw(); });
      return b;
    }));
    const save = h('button', { type: 'button', class: 'btn block' }, isNew ? 'Добавить в календарь' : 'Сохранить');
    save.addEventListener('click', busy(save, async () => {
      sync();
      haptic.tap();
      try {
        const mins = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
        const duration = form.time && form.end ? mins(form.end) - mins(form.time) : 0;
        if (form.time && form.end && duration <= 0) { toast('Окончание должно быть позже начала ⏰'); return; }
        const { end, ...rest } = form;
        const data = { ...rest, time: form.time || null, duration: duration || null };
        if (isNew && boardCell !== null && boardCell !== undefined) data.board_cell = boardCell;
        if (isNew) await api.createPlan(data);
        else await api.patchPlan(plan.id, { ...data, occurrence: plan.date });
        haptic.success();
        toast(isNew ? `📅 Запланировано на ${fmtDay(form.date)}` : 'Сохранено ✓', 'good');
        s.close();
        changed(onChange);
      } catch (e) { toastError(e); }
    }));
    s.setContent(h('div', { class: 'stack' },
      h('h2', null, isNew ? 'Свой план' : 'Изменить план'),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Что планируешь'), title),
      note,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Дата'), dateIn),
      h('div', { class: 'row' }, h('div', { class: 'field grow' }, h('span', { class: 'label' }, 'Начало'), timeIn),
        h('div', { class: 'field grow' }, h('span', { class: 'label' }, form.time ? 'До скольки' : 'До (сначала начало)'), endIn)),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Повтор'), seg(REPEAT_LABEL, 'repeat_rule', 'Повтор')),
      h('div', { class: 'field' }, h('span', { class: 'label' }, form.time ? 'Напоминание в чат' : 'Напоминание (сначала укажи время)'),
        seg(REMIND_LABEL, 'remind', 'Напоминание', !form.time)),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Цвет-метка'), colors),
      save));
  };
  draw();
  return s;
}

export function openQuestPicker(date, { onChange } = {}) {
  const st = { q: '', mode: '', items: [] };
  const s = sheet(h('div'), { label: 'Запланировать задание' });
  const list = h('div', { class: 'stack-sm' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск по заданиям', 'aria-label': 'Поиск по заданиям' });
  const plan = async q => {
    try {
      await api.createPlan({ quest_key: q.id, tier: q.tier, date });
      haptic.success();
      toast(`${q.emoji} «${q.title}» — на ${fmtDay(date)}`, 'good');
      s.close();
      changed(onChange);
    } catch (e) { toastError(e); }
  };
  const load = async () => {
    clear(list).append(h('div', { class: 'skeleton', style: { height: '64px' } }));
    try {
      st.items = (await api.searchQuests(st)).quests;
    } catch (e) { toastError(e); st.items = []; }
    clear(list);
    if (!st.items.length) return list.append(emptyState('Ничего не нашлось — попробуй другой запрос.', { kind: 'cat-blue' }));
    for (const q of st.items) {
      const b = h('button', { type: 'button', class: `quest-item c-${q.sphere ? SPHERE_INFO[q.sphere].color : MODE_INFO[q.mode].color}` },
        h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, q.emoji),
        h('span', { class: 'grow' }, h('span', { class: 'q-title', style: { display: 'block' } }, q.title),
          h('span', { class: 'q-meta', style: { display: 'block' } }, [MODE_INFO[q.mode].label, q.sphere].filter(Boolean).join(' · '))));
      b.addEventListener('click', () => { haptic.tap(); previewQuest(q); });
      list.append(b);
    }
  };
  const previewQuest = q => {
    const add = h('button', { type: 'button', class: 'btn block' }, `📅 Запланировать на ${fmtDay(date)}`);
    add.addEventListener('click', busy(add, () => plan(q)));
    const back = h('button', { type: 'button', class: 'btn ghost block' }, '← К списку');
    back.addEventListener('click', () => draw());
    s.setContent(h('div', { class: 'stack' }, questCard(q, { flip: true }), add, back));
  };
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { st.q = search.value; load(); }, 300); });
  const modeChips = () => h('div', { class: 'chips', role: 'group', 'aria-label': 'Формат' },
    [['', '✨ Все', 'yellow'], ['solo', '🎯 Для себя', 'purple'], ['pair', '💞 Вдвоём', 'pink'], ['company', '👥 Компания', 'orange']].map(([k, label, color]) => {
      const b = h('button', { type: 'button', class: `chip c-${color}`, 'aria-pressed': String(st.mode === k) }, label);
      b.addEventListener('click', () => { haptic.select(); st.mode = k; draw(); load(); });
      return b;
    }));
  const random = h('button', { type: 'button', class: 'btn colored c-lime block' }, '🎲 Случайное');
  random.addEventListener('click', () => {
    if (!st.items.length) return;
    haptic.tap('medium');
    previewQuest(st.items[Math.floor(Math.random() * st.items.length)]);
  });
  const draw = () => {
    search.value = st.q;
    s.setContent(h('div', { class: 'stack' }, h('h2', null, `Задание на ${fmtDay(date)}`), search, modeChips(), random, list));
  };
  draw();
  load();
}

// ---------- Лист дня ----------
/** Страница дня: свободное поле для планов (как на главной), «Как всё прошло?»
 *  с заметками этого дня и фото дня. Без выбора заданий, даты и напоминаний. */
export function openDaySheet(date, { onChange } = {}) {
  const s = sheet(h('div'), { label: dayTitle(date) });
  const today = todayIso();
  const planHost = h('div', null, h('div', { class: 'skeleton', style: { height: '120px' } }));
  const notesHost = h('div', { class: 'note-grid', style: { marginTop: '10px' } });
  const loadNotes = async () => {
    try {
      const { notes } = await api.notes({ day: date, limit: 50 });
      notesHost.replaceChildren(...notes.map(n => noteCard(n, { onChange: loadNotes })));
    } catch (e) { /* заметки подгрузятся при следующем открытии */ }
  };
  const body = h('div', { class: 'stack' },
    h('h2', null, dayTitle(date)),
    planHost,
    h('div', null,
      h('h3', { style: { marginBottom: '8px' } }, date <= today ? 'Как всё прошло?' : 'Заметки к этому дню'),
      noteComposer({ day: date, draftKey: `day-${date}`, onSaved: loadNotes,
        placeholder: date <= today ? 'Пара слов о дне: что получилось, что запомнилось…' : 'Мысли и идеи к этому дню…' }),
      notesHost));
  if (photosEnabled() && date <= today) {
    // Фото с квестов и планов этого дня — доской полароидов над «Фото дня».
    const memories = h('div');
    api.photos({ from: date, to: date }).then(res => {
      const list = (res.photos || []).filter(p => p.target !== 'day');
      if (list.length) memories.replaceChildren(h('h3', { style: { marginBottom: '8px' } }, '✨ Воспоминания дня'),
        memoryBoard(list, { small: true, onDelete: () => onChange && onChange() }));
    }).catch(() => {});
    body.append(memories, h('div', null, h('h3', { style: { marginBottom: '8px' } }, '📷 Фото дня'),
      photoStrip({ target: 'day', day: date }, { onChange: () => onChange && onChange() })));
  }
  s.setContent(body);
  api.plans(date, date).then(res => {
    const items = res.plans.filter(o => o.status === 'planned' || o.status === 'done');
    planHost.replaceChildren(dayPlanField(items, date, { onChange, canComplete: date <= today,
      placeholder: date === today ? 'Что сегодня в планах?' : 'Что запланируем на этот день?' }));
  }).catch(e => planHost.replaceChildren(h('p', { class: 'muted bold' }, e.message)));
  loadNotes();
  return s;
}
