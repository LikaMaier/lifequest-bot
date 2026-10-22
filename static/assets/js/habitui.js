// Привычки: карточка (галочка или счётчик), карточка привычки со
// статистикой (сетка 17 недель, дни недели, вехи), редактор с расписанием
// и напоминанием, пропуск с причиной, пауза и выбор из шаблонов.

import { h, clear, plural, weekday, fmtDay } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { refreshState } from './store.js';
import { celebrate } from './celebrate.js';
import { sheet, toast, toastError, busy, ICONS, confetti } from './ui.js';
import { userSpheres, sphereByKey, openSphereManager } from './sphereui.js';

export const HABIT_COLORS = ['lime', 'blue', 'pink', 'yellow', 'lav', 'orange', 'purple', 'red'];
const EMOJIS = ['💧', '🧘', '📖', '🚶', '😴', '📵', '🙏', '💪', '🥗', '✍️', '💊', '🧴', '🎨', '🎧', '🧹', '🌿', '🍎', '🏃', '🦷', '☀️', '🧠', '💤', '🚿', '✨', '🍬', '📱'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const TIMES = { morning: 'Утро', day: 'День', evening: 'Вечер', any: 'В любое время' };

// Готовые привычки — каталог с сервера (habits_bank.py → habit_catalog.py):
// 8 сфер × 7 привычек. Грузим один раз и держим в памяти.
let catalogCache = null;
let catalogLoading = null;
export function loadCatalog() {
  if (catalogCache) return Promise.resolve(catalogCache);
  catalogLoading = catalogLoading || api.habitCatalog()
    .then(res => { catalogCache = res.spheres; return catalogCache; })
    .catch(e => { catalogLoading = null; throw e; });
  return catalogLoading;
}
export const catalogNow = () => catalogCache;

/** Привычка каталога → данные для создания привычки (поля приложения + bank_key). */
export function fromCatalog(t) {
  return { title: t.title, emoji: t.emoji, color: t.color, sphere: t.sphere, bank_key: t.key, kind: 'build', target: 1,
    schedule: t.schedule, days: t.days || '1111111', per_week: t.per_week || 3, time_of_day: 'any' };
}

/** Карточка готовой привычки: название, как часто, «начни с малого». */
export function catalogCard(t, { on, onClick }) {
  const b = h('button', { type: 'button', class: `hb2-tpl ${on ? 'on' : ''} c-${t.color}`, 'aria-pressed': String(on) },
    h('span', { class: 'hb2-tpl-title' }, `${t.emoji} ${t.title}`),
    h('span', { class: 'hb2-tpl-hint' }, `${t.freq_text} · начни с малого: ${t.tiny}`),
    on ? h('span', { class: 'hb2-tpl-check', html: ICONS.check }) : null);
  b.addEventListener('click', onClick);
  return b;
}

const unitWord = (hb, n) => (hb.streak_unit === 'week' ? plural(n, 'неделя', 'недели', 'недель') : plural(n, 'день', 'дня', 'дней'));

/** «каждый день · 8:00», «пн · ср · пт», «3 раза в неделю». */
export function scheduleText(hb) {
  let s = 'каждый день';
  if (hb.schedule === 'days') {
    const on = [...(hb.days || '1111111')].map((c, i) => (c === '1' ? i : -1)).filter(i => i >= 0);
    s = hb.days === '1111100' ? 'по будням' : hb.days === '0000011' ? 'по выходным' : on.map(i => WD[i].toLowerCase()).join(' · ');
  } else if (hb.schedule === 'weekly') s = `${hb.per_week} ${plural(hb.per_week, 'раз', 'раза', 'раз')} в неделю`;
  return [s, hb.remind_time].filter(Boolean).join(' · ');
}

function streakText(hb) {
  if (hb.kind === 'quit') return hb.streak ? `${hb.streak} ${unitWord(hb, hb.streak)} без срыва` : 'сегодня начинаешь';
  if (hb.paused) return 'на паузе';
  if (!hb.due_today && hb.schedule !== 'weekly') return 'сегодня выходной';
  if (hb.schedule === 'weekly') return `${hb.week_done} из ${hb.per_week} на этой неделе`;
  return hb.streak ? `${hb.streak} ${unitWord(hb, hb.streak)} подряд` : 'начни серию сегодня';
}

async function applyLog(hb, opts, onUpdate) {
  try {
    const res = await api.logHabit(hb.id, opts);
    const pastDay = opts.date && opts.date !== hb.week[hb.week.length - 1].date;
    if (hb.kind === 'quit') {
      haptic.tap();
      toast('Срыв отмечен. Бывает — начинаем заново, без чувства вины 🌿', '', 2600);
    } else if (res.just_done && pastDay) {
      haptic.success();
      toast(`✓ ${fmtDay(opts.date)}: ${hb.title} отмечено${res.xp ? ` · +${res.xp} XP` : ''}`, 'good', 2200);
    } else if (res.just_done) {
      haptic.success();
      confetti(50);
      toast(`${hb.emoji} ${hb.title} — цель дня! ${res.xp ? `+${res.xp} XP` : ''}`, 'good', 2200);
    } else {
      haptic.tap();
    }
    if (res.streak && res.streak.streak) {
      const n = res.streak.streak;
      setTimeout(() => toast(`🔥 Серия ${n} ${plural(n, 'день', 'дня', 'дней')}${res.streak.used_freeze ? ' — заморозка спасла пропуск ❄️' : '!'}`, 'good', 2600), 900);
    }
    onUpdate && onUpdate(res.habit);
    refreshState().catch(() => {});
    if (res.milestone) setTimeout(() => openMilestone(res.milestone), 1200);
    if (res.level_up || (res.new_achievements || []).length) await celebrate({ level_up: res.level_up, new_achievements: res.new_achievements });
    if (res.trial_offer) {
      const { offerTrial } = await import('./premium.js');
      await refreshState().catch(() => {});
      offerTrial('habits');
    }
    return res;
  } catch (e) { toastError(e); return null; }
}

/** Карточка привычки. compact — без лишнего для Главной. */
export function habitCard(hb, { compact = false, onChanged } = {}) {
  const off = hb.kind === 'build' && !hb.due_today && !hb.done_today;
  const card = h('div', { class: `hb2-card ${hb.kind === 'quit' ? 'quit' : ''} ${hb.done_today ? 'done' : ''} ${off ? 'off' : ''} ${compact ? 'compact' : ''}` });
  const redraw = next => { next = { ...next, duel: next.duel ?? hb.duel }; const fresh = habitCard(next, { compact, onChanged }); card.replaceWith(fresh); onChanged && onChanged(next); };

  const info = h('button', { type: 'button', class: 'hb2-info', 'aria-label': `${hb.title}. Открыть карточку привычки` },
    h('span', { class: `hb2-icon c-${hb.color}`, 'aria-hidden': 'true' }, hb.emoji),
    h('span', { class: 'grow' }, h('span', { class: 'hb2-title' }, hb.title, hb.duel ? h('span', { class: 'hb2-duel' }, `${hb.duel.mode === 'team' ? '🤝' : '⚔️'} ${hb.duel.with}`) : null),
      h('span', { class: 'hb2-meta' }, h('b', null, streakText(hb)), compact || hb.kind === 'quit' ? null : h('span', null, scheduleText(hb)),
        hb.kind === 'quit' && hb.best ? h('span', null, `рекорд ${hb.best}`) : null)));
  info.addEventListener('click', () => { haptic.tap(); openHabitDetail(hb, { onChanged: redraw }); });

  let controls = null;
  if (hb.kind === 'quit') {
    const slip = h('button', { type: 'button', class: 'hb2-slip' }, hb.slips_today ? 'Срыв отмечен' : 'Был срыв');
    slip.disabled = Boolean(hb.slips_today);
    slip.addEventListener('click', busy(slip, () => applyLog(hb, { delta: 1 }, redraw)));
    controls = slip;
  } else if (hb.skipped_today) {
    const undo = h('button', { type: 'button', class: 'hb2-skip-tag', 'aria-label': `Вернуть: ${hb.title}` }, 'пропуск');
    undo.addEventListener('click', busy(undo, () => applyLog(hb, { count: 0 }, redraw)));
    controls = undo;
  } else if (off) {
    controls = null;
  } else if (hb.target === 1) {
    const check = h('button', { type: 'button', class: `hb2-check ${hb.done_today ? 'on' : ''}`, 'aria-pressed': String(hb.done_today),
      'aria-label': hb.done_today ? `Снять отметку: ${hb.title}` : `Отметить: ${hb.title}`, html: ICONS.check });
    check.addEventListener('click', busy(check, () => applyLog(hb, { delta: hb.done_today ? -1 : 1 }, redraw)));
    controls = check;
  } else {
    const minus = h('button', { type: 'button', class: 'hb2-step', 'aria-label': `Минус один: ${hb.title}`, html: ICONS.minus, disabled: hb.today <= 0 });
    const plus = h('button', { type: 'button', class: 'hb2-step plus', 'aria-label': `Плюс один: ${hb.title}`, html: ICONS.plus });
    minus.addEventListener('click', busy(minus, () => applyLog(hb, { delta: -1 }, redraw)));
    plus.addEventListener('click', busy(plus, () => applyLog(hb, { delta: 1 }, redraw)));
    controls = h('div', { class: 'hb2-counter' }, minus, h('span', { class: 'num', 'aria-live': 'polite' }, `${hb.today}/${hb.target}`), plus);
  }
  card.append(info);
  if (controls) card.append(controls);
  if (hb.kind === 'build' && hb.target > 1 && !off) {
    card.append(h('div', { class: 'hb2-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.min(1, hb.today / hb.target) * 100}%` } })));
  }
  return card;
}

/** Кольцо прогресса привычки (для Главной). */
export function habitRing(hb, { onChanged } = {}) {
  const frac = hb.done_today ? 1 : Math.min(1, hb.today / hb.target);
  const label = hb.done_today ? '✓' : hb.target > 1 ? `${hb.today}/${hb.target}` : hb.emoji;
  const b = h('button', { type: 'button', class: `hb2-ring c-${hb.color} ${hb.done_today ? 'done' : ''}`,
    style: { '--p': `${Math.round(frac * 100)}%` }, 'aria-label': `${hb.title}: ${hb.done_today ? 'выполнено' : hb.target > 1 ? `${hb.today} из ${hb.target}` : 'ещё нет'}` },
    h('span', { class: 'hb2-ring-circle' }, h('span', { class: 'hb2-ring-inner' }, label)),
    h('span', { class: 'hb2-ring-title' }, hb.title));
  b.addEventListener('click', busy(b, async () => {
    if (hb.target === 1) await applyLog(hb, { delta: hb.done_today ? -1 : 1 }, onChanged);
    else if (!hb.done_today) await applyLog(hb, { delta: 1 }, onChanged);
    else openHabitDetail(hb, { onChanged });
  }));
  return b;
}

// ---------- Карточка привычки ----------
const GRID_COLORS = { done: 'done', skip: 'skip', pause: 'pause', miss: 'miss', off: 'off', future: 'future', before: 'future', today: 'future', clean: 'done', slip: 'miss' };

export async function openHabitDetail(hb, { onChanged } = {}) {
  const s = sheet(h('div', { class: 'skeleton', style: { height: '320px' } }), { label: hb.title });
  let data;
  try { data = await api.habitStats(hb.id); } catch (e) { toastError(e); s.close(); return; }
  const v = data.habit;
  const refresh = next => { onChanged && onChanged(next); s.close(); openHabitDetail(next, { onChanged }); };
  const unit = n => unitWord(v, n);
  const stat = (n, t) => h('div', { class: 'hb2-stat' }, h('b', null, String(n)), h('span', null, t));

  const head = h('section', { class: `hb2-hero c-${v.color} ${v.kind === 'quit' ? 'quit' : ''}` },
    h('div', { class: 'hb2-hero-sub' }, v.kind === 'quit' ? 'бросаю' : [scheduleText(v), TIMES[v.time_of_day] && v.time_of_day !== 'any' ? TIMES[v.time_of_day].toLowerCase() : null].filter(Boolean).join(' · ')),
    h('h2', null, `${v.emoji} ${v.title}`),
    h('div', { class: 'hb2-stats' },
      v.kind === 'quit' ? stat(v.streak, `${unit(v.streak)} без срыва`) : stat(v.streak, `${unit(v.streak)} подряд`),
      stat(v.best, 'рекорд'), v.kind === 'quit' ? stat(`${data.rate30}%`, 'за 30 дней') : stat(v.total_days, 'всего раз')));

  const grid = h('div', { class: 'hb2-grid', 'aria-label': 'Последние 17 недель' });
  // сетка по неделям: колонки — недели, строки — дни недели
  for (let wd = 0; wd < 7; wd++) {
    for (let w = 0; w < 17; w++) {
      const c = data.grid[w * 7 + wd];
      grid.append(h('i', { class: GRID_COLORS[c.state] || 'off', title: `${fmtDay(c.date)}` }));
    }
  }
  const gridCard = h('section', { class: 'hb2-panel' },
    h('div', { class: 'hb2-panel-head' }, h('h3', null, 'Последние 17 недель'), h('span', null, v.kind === 'quit' ? '' : `${data.rate30}% за 30 дней`)),
    grid,
    h('div', { class: 'hb2-legend' }, h('span', null, h('i', { class: 'done' }), v.kind === 'quit' ? 'без срыва' : 'сделано'),
      v.kind === 'quit' ? h('span', null, h('i', { class: 'miss' }), 'срыв') : h('span', null, h('i', { class: 'pause' }), 'пауза / пропуск'),
      v.kind === 'quit' ? null : h('span', null, h('i', { class: 'miss' }), 'не сделано')));

  const body = h('div', { class: 'stack' }, head,
    v.tip ? h('section', { class: 'hb2-panel' },
      h('div', { class: 'hb2-hint', style: { marginTop: 0 } }, v.tip.why),
      h('div', { class: 'small bold muted', style: { marginTop: '6px' } }, `Начни с малого: ${v.tip.tiny}`)) : null,
    gridCard);

  if (v.kind === 'build') {
    const max = 100;
    body.append(h('section', { class: 'hb2-panel' }, h('div', { class: 'hb2-panel-head' }, h('h3', null, 'По дням недели')),
      h('div', { class: 'hb2-wd' }, data.weekday.map((p, i) => h('div', null,
        h('span', { class: 'track' }, h('i', { class: p !== null && p < 60 ? 'low' : '', style: { height: `${p === null ? 4 : Math.max(6, Math.round(p / max * 70))}px` } })),
        h('span', { class: 'wd' }, WD[i])))),
      data.weak_weekday !== null && data.weak_weekday !== undefined
        ? h('div', { class: 'hb2-hint' }, `Чаще всего пропускаешь в ${['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'][data.weak_weekday]}. Может, сделать этот день выходным в расписании?`)
        : null));
    // последние 7 дней — можно поправить
    const days = h('div', { class: 'hb2-days', role: 'group', 'aria-label': 'Последние 7 дней' }, v.week.map((d, i) => {
      const isToday = i === v.week.length - 1;
      const b = h('button', { type: 'button', class: `hb2-day ${d.done ? 'on' : d.skipped ? 'skip' : ''} ${isToday ? 'today' : ''}`,
        'aria-pressed': String(d.done), 'aria-label': `${fmtDay(d.date)}: ${d.done ? 'выполнено' : d.skipped ? 'пропуск' : 'нет'}` },
        h('span', { class: 'wd' }, weekday(d.date)), h('span', { class: 'dot', 'aria-hidden': 'true' }, d.done ? '✓' : d.skipped ? '–' : ''));
      b.addEventListener('click', busy(b, async () => { const r = await applyLog(v, { date: d.date, count: d.done ? 0 : v.target }); if (r) refresh(r.habit); }));
      return b;
    }));
    body.append(h('section', { class: 'hb2-panel' }, h('div', { class: 'hb2-panel-head' }, h('h3', null, 'Неделя'), h('span', null, 'нажми, чтобы поправить')), days));
    if (data.milestones.length) {
      body.append(h('section', { class: 'hb2-panel' }, h('div', { class: 'hb2-panel-head' }, h('h3', null, 'Вехи')),
        h('div', { class: 'hb2-marks' }, data.milestones.filter(m => [7, 30, 100, 365].includes(m.days)).map(m =>
          h('div', { class: m.reached ? 'on' : '' }, h('b', null, String(m.days)), h('span', null, 'дней'))))));
    }
    const actions = h('div', { class: 'hb2-actions' });
    if (!v.done_today && v.due_today) {
      const mark = h('button', { type: 'button', class: 'btn' }, 'Отметить сегодня');
      mark.addEventListener('click', busy(mark, async () => { const r = await applyLog(v, { count: v.target }); if (r) refresh(r.habit); }));
      actions.append(mark);
    }
    if (!v.done_today && !v.skipped_today) {
      const skip = h('button', { type: 'button', class: 'btn ghost' }, 'Пропуск с причиной');
      skip.addEventListener('click', () => openSkip(v, next => refresh(next)));
      actions.append(skip);
    }
    if (actions.childElementCount) body.append(actions);
  }
  const edit = h('button', { type: 'button', class: 'btn ghost block' }, '✏️ Изменить привычку');
  edit.addEventListener('click', () => { s.close(); openHabitEditor(v, { onSaved: next => next && onChanged && onChanged(next) }); });
  body.append(edit);
  s.setContent(body);
}

function openSkip(hb, onDone) {
  const reasons = ['Болею', 'Отдыхаю', 'Не было возможности', 'В дороге'];
  let picked = reasons[0];
  const input = h('input', { class: 'input', type: 'text', maxlength: '120', placeholder: 'Или своя причина', 'aria-label': 'Причина пропуска' });
  const chips = h('div', { class: 'chips' });
  const drawChips = () => {
    clear(chips);
    reasons.forEach(r => {
      const b = h('button', { type: 'button', class: 'chip c-paleyellow', 'aria-pressed': String(picked === r) }, r);
      b.addEventListener('click', () => { haptic.select(); picked = r; input.value = ''; drawChips(); });
      chips.append(b);
    });
  };
  drawChips();
  const save = h('button', { type: 'button', class: 'btn block' }, 'Пропустить сегодня');
  const s = sheet(h('div', { class: 'stack' }, h('h2', null, 'Пропуск — без чувства вины'),
    h('p', { class: 'muted bold', style: { margin: 0 } }, 'День не засчитается, но и серию не прервёт.'), chips, input, save), { label: 'Пропуск' });
  s.panel.parentElement.style.zIndex = '80';
  save.addEventListener('click', busy(save, async () => {
    try {
      const res = await api.skipHabit(hb.id, { note: input.value.trim() || picked });
      haptic.success();
      toast('Пропуск отмечен 🌿');
      s.close();
      refreshState().catch(() => {});
      onDone && onDone(res.habit);
    } catch (e) { toastError(e); }
  }));
}

/** Пауза на отпуск или болезнь: привычки не требуются, серии не горят. */
export function openPause(current, { onChanged } = {}) {
  const s = sheet(h('div'), { label: 'Пауза' });
  const body = h('div', { class: 'stack' }, h('h2', null, '⏸ Пауза для привычек'),
    h('p', { class: 'muted bold', style: { margin: 0 } }, 'Отпуск, болезнь или просто тяжёлая неделя? На паузе привычки не нужно отмечать — серии не сгорят.'));
  if (current) {
    body.append(h('div', { class: 'card soft c-blue bold' }, `Сейчас пауза до ${fmtDay(current.end)}`));
    const stop = h('button', { type: 'button', class: 'btn block' }, 'Снять паузу');
    stop.addEventListener('click', busy(stop, async () => {
      try { await api.unpauseHabits(); haptic.success(); toast('Пауза снята — с возвращением! 🌱', 'good'); s.close(); await refreshState(); onChanged && onChanged(); } catch (e) { toastError(e); }
    }));
    body.append(stop);
  } else {
    body.append(h('div', { class: 'hb2-pause-grid' }, [[1, 'Сегодня'], [3, '3 дня'], [7, 'Неделя'], [14, '2 недели']].map(([n, t]) => {
      const b = h('button', { type: 'button', class: 'hb2-pause-btn' }, t);
      b.addEventListener('click', busy(b, async () => {
        try { await api.pauseHabits(n); haptic.success(); toast('⏸ Пауза включена. Отдыхай!', 'good'); s.close(); await refreshState(); onChanged && onChanged(); } catch (e) { toastError(e); }
      }));
      return b;
    })));
  }
  s.setContent(body);
  return s;
}

/** Выбор нескольких привычек из каталога: вкладки-сферы (или только сферы
 *  из only — тогда списком по сферам, как в приветствии). */
export function templatePicker({ max = 3, onDone, title = 'С чего начнём?', only = null } = {}) {
  let tab = null;
  const picked = new Map(); // key → привычка каталога
  const root = h('div', { class: 'hb2-picker' }, h('div', { class: 'skeleton', style: { height: '220px' } }));
  const toggle = t => () => {
    haptic.select();
    if (picked.has(t.key)) picked.delete(t.key);
    else if (picked.size < max) picked.set(t.key, t);
    else { toast(`Для начала — не больше ${max}. Остальное добавишь потом 🙂`); return; }
    draw();
  };
  let cat = [];
  const draw = () => {
    clear(root);
    const list = only ? cat.filter(sp => only.includes(sp.key)) : cat;
    tab = tab || (list[0] && list[0].key);
    const card = t => catalogCard(t, { on: picked.has(t.key), onClick: toggle(t) });
    let content;
    if (only) {
      content = h('div', { class: 'stack-sm' }, list.map(sp => h('div', null,
        h('div', { class: 'cal2-label' }, `${sp.emoji} ${sp.name}`),
        h('div', { class: 'hb2-tpl-grid' }, sp.habits.map(card)))));
    } else {
      const tabs = h('div', { class: 'memo-chips' }, list.map(sp => {
        const b = h('button', { type: 'button', class: `memo-chip ${tab === sp.key ? 'on' : ''}` }, `${sp.emoji} ${sp.name}`);
        b.addEventListener('click', () => { haptic.select(); tab = sp.key; draw(); });
        return b;
      }));
      const cur = list.find(sp => sp.key === tab) || list[0];
      content = h('div', null, tabs, h('div', { class: 'hb2-tpl-grid' }, cur ? cur.habits.map(card) : []));
    }
    const n = picked.size;
    const go = h('button', { type: 'button', class: 'btn block', disabled: !n },
      n ? `Добавить ${n} ${plural(n, 'привычку', 'привычки', 'привычек')}` : 'Выбери хотя бы одну');
    go.addEventListener('click', busy(go, async () => {
      try {
        const res = await api.createHabits([...picked.values()].map(fromCatalog));
        haptic.success();
        confetti(60);
        await refreshState();
        onDone && onDone(res);
        if ((res.new_achievements || []).length) await celebrate(res);
      } catch (e) { toastError(e); }
    }));
    if (title) root.append(h('h2', null, title));
    root.append(content, go);
  };
  loadCatalog().then(c => { cat = c; draw(); })
    .catch(e => { clear(root).append(h('p', { class: 'muted bold' }, e.message)); });
  return root;
}

export function openTemplatePicker({ onDone } = {}) {
  const s = sheet(h('div'), { label: 'Готовые привычки' });
  s.setContent(templatePicker({ max: 5, title: 'Готовые привычки', onDone: res => { s.close(); onDone && onDone(res); } }));
  return s;
}

// ---------- Веха ----------
export function openMilestone(m) {
  const share = h('button', { type: 'button', class: 'btn block' }, 'Поделиться карточкой');
  const s = sheet(h('div', { class: 'stack hb2-milestone' },
    h('div', { class: 'hb2-milestone-card' },
      h('div', { class: 'kicker' }, 'Новая веха'),
      h('div', { class: 'big' }, `${m.days} ${plural(m.days, 'день', 'дня', 'дней')}`),
      h('div', { class: 'what' }, `${m.emoji} ${m.title} — подряд`),
      h('div', { class: 'small' }, m.days >= 30 ? 'Это уже не привычка, а часть тебя.' : 'Отличный старт — продолжай!')),
    share), { label: 'Веха' });
  share.addEventListener('click', busy(share, async () => {
    try {
      const { milestoneCard } = await import('./share.js');
      await api.share(await milestoneCard(m));
      haptic.success();
      toast('📬 Карточка уже в чате с ботом — перешли друзьям!', 'good', 3000);
      s.close();
    } catch (e) { toastError(e); }
  }));
  confetti(120);
  haptic.success();
}

// ---------- Редактор ----------
export function openHabitEditor(habit = null, { onSaved, preset } = {}) {
  const isNew = !habit;
  const src = habit || preset || {};
  const form = {
    kind: src.kind || 'build', title: src.title || '', emoji: src.emoji || '✨', color: src.color || 'lime',
    target: src.target || 1, unit: src.unit || '', sphere: src.sphere || null,
    schedule: src.schedule || 'daily', days: src.days || '1111111', per_week: src.per_week || 3,
    time_of_day: src.time_of_day || 'any', remind_time: src.remind_time || '',
  };
  const s = sheet(h('div'), { label: isNew ? 'Новая привычка' : 'Изменить привычку' });
  if (isNew && !catalogNow()) loadCatalog().then(() => { if (s.panel.isConnected) draw(); }).catch(() => {});

  const draw = () => {
    const title = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: form.kind === 'quit' ? 'Например: Без сахара' : 'Например: Пить воду', value: form.title, 'aria-label': 'Название привычки' });
    const unit = h('input', { class: 'input', type: 'text', maxlength: '12', placeholder: 'раз', value: form.unit, 'aria-label': 'Единица' });
    const sync = () => { form.title = title.value; form.unit = unit.value; };
    const pick = (fn) => () => { haptic.select(); sync(); fn(); draw(); };
    const seg = (options, key, label) => h('div', { class: 'cal2-chips', role: 'group', 'aria-label': label },
      options.map(([k, t]) => {
        const on = form[key] === k;
        const b = h('button', { type: 'button', class: `cal2-chip ${on ? 'on' : ''}`, 'aria-pressed': String(on) }, t);
        b.addEventListener('click', pick(() => { form[key] = k; }));
        return b;
      }));

    const kind = h('div', { class: 'cal2-seg', role: 'group', 'aria-label': 'Тип привычки', style: { gridTemplateColumns: '1fr 1fr', marginBottom: 0 } },
      [['build', 'Начать делать'], ['quit', 'Бросить']].map(([k, t]) => {
        const b = h('button', { type: 'button', 'aria-pressed': String(form.kind === k) }, t);
        b.addEventListener('click', pick(() => { form.kind = k; }));
        return b;
      }));

    const emojis = h('div', { class: 'emoji-grid', role: 'radiogroup', 'aria-label': 'Эмодзи' },
      EMOJIS.map(e => {
        const b = h('button', { type: 'button', class: `emoji-pick ${e === form.emoji ? 'on' : ''}`, role: 'radio', 'aria-checked': String(e === form.emoji), 'aria-label': e }, e);
        b.addEventListener('click', pick(() => { form.emoji = e; }));
        return b;
      }));
    const colors = h('div', { class: 'row-wrap', role: 'radiogroup', 'aria-label': 'Цвет' },
      HABIT_COLORS.map(c => {
        const b = h('button', { type: 'button', class: `accent-pick c-${c} ${c === form.color ? 'on' : ''}`, role: 'radio', 'aria-checked': String(c === form.color), 'aria-label': `Цвет ${c}` }, c === form.color ? '✓' : '');
        b.addEventListener('click', pick(() => { form.color = c; }));
        return b;
      }));
    const manage = h('button', { type: 'button', class: 'chip c-paleyellow' }, '⚙️ Настроить');
    manage.addEventListener('click', () => { haptic.tap(); sync(); openSphereManager({ onChange: draw }); });
    const spheres = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Сфера' },
      [...userSpheres(), null].map(sp => {
        const key = sp ? sp.key : null;
        const on = (form.sphere || null) === key;
        const b = h('button', { type: 'button', class: `chip c-${sp ? sp.color : 'paleyellow'}`, role: 'radio',
          'aria-checked': String(on), 'aria-pressed': String(on) }, sp ? `${sp.emoji} ${sp.name}` : 'Без сферы');
        b.addEventListener('click', pick(() => { form.sphere = key; }));
        return b;
      }), manage);

    const stepper = (key, min, max, label, suffix) => {
      const val = h('span', { class: 'num hb2-step-val', 'aria-live': 'polite' }, suffix(form[key]));
      const step = d => { haptic.select(); form[key] = Math.max(min, Math.min(max, form[key] + d)); val.textContent = suffix(form[key]); };
      const minus = h('button', { type: 'button', class: 'hb2-step', 'aria-label': `Меньше: ${label}`, html: ICONS.minus });
      const plus = h('button', { type: 'button', class: 'hb2-step plus', 'aria-label': `Больше: ${label}`, html: ICONS.plus });
      minus.addEventListener('click', () => step(-1));
      plus.addEventListener('click', () => step(1));
      return h('div', { class: 'hb2-stepper' }, minus, val, plus);
    };

    const daysRow = h('div', { class: 'hb2-days-pick', role: 'group', 'aria-label': 'Дни недели' }, WD.map((w, i) => {
      const on = form.days[i] === '1';
      const b = h('button', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on) }, w);
      b.addEventListener('click', pick(() => {
        const arr = [...form.days];
        arr[i] = on ? '0' : '1';
        if (arr.includes('1')) form.days = arr.join('');
      }));
      return b;
    }));

    const remindOn = Boolean(form.remind_time);
    const remindTime = h('input', { class: 'input', type: 'time', value: form.remind_time || '09:00', 'aria-label': 'Время напоминания' });
    remindTime.addEventListener('change', () => { form.remind_time = remindTime.value; });
    const remindToggle = h('button', { type: 'button', class: `cal2-toggle ${remindOn ? 'on lime' : ''}` }, remindOn ? '🔔 Напоминание включено' : '🔕 Без напоминания');
    remindToggle.addEventListener('click', pick(() => { form.remind_time = remindOn ? '' : (remindTime.value || '09:00'); }));

    const save = h('button', { type: 'button', class: 'cal2-save' }, isNew ? 'Создать привычку' : 'Сохранить');
    save.addEventListener('click', busy(save, async () => {
      haptic.tap();
      sync();
      try {
        const res = isNew ? await api.createHabit(form) : await api.updateHabit(habit.id, form);
        haptic.success();
        toast(isNew ? `${form.emoji} Привычка добавлена!` : 'Сохранено ✓', 'good', 1800);
        s.close();
        await refreshState();
        onSaved && onSaved(res.habit);
        if (res.new_achievements) await celebrate(res);
      } catch (e) { toastError(e); }
    }));

    const build = form.kind === 'build';
    const body = h('div', { class: 'stack' },
      h('h2', null, isNew ? 'Новая привычка' : 'Привычка'),
      kind,
      isNew ? (() => {
        const more = h('button', { type: 'button', class: 'chip c-lime' }, '✨ Все шаблоны');
        more.addEventListener('click', () => { s.close(); openTemplatePicker({ onDone: () => onSaved && onSaved(null) }); });
        // по одной первой привычке из каждой сферы каталога («бросить» в каталоге нет)
        const quick = form.kind === 'build' && catalogNow() ? catalogNow().map(sp => sp.habits[0]).slice(0, 6) : [];
        return h('div', null, h('div', { class: 'cal2-label' }, 'Быстрый старт'),
          h('div', { class: 'chips' }, quick.map(t => {
            const b = h('button', { type: 'button', class: `chip c-${t.color}` }, `${t.emoji} ${t.title}`);
            b.addEventListener('click', pick(() => {
              Object.assign(form, { unit: '', remind_time: '' }, fromCatalog(t));
            }));
            return b;
          }), more));
      })() : null,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Название'), title),
      build ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Как часто'),
        seg([['daily', 'Каждый день'], ['days', 'По дням недели'], ['weekly', 'N раз в неделю']], 'schedule', 'Как часто'),
        form.schedule === 'days' ? h('div', { style: { marginTop: '8px' } }, daysRow) : null,
        form.schedule === 'weekly' ? h('div', { style: { marginTop: '8px' } }, stepper('per_week', 1, 7, 'раз в неделю', n => `${n} ${plural(n, 'раз', 'раза', 'раз')} в неделю`)) : null) : null,
      build ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Сколько за день'),
        h('div', { class: 'row' }, stepper('target', 1, 50, 'раз в день', n => String(n)), h('div', { class: 'grow' }, unit))) : null,
      build ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Время дня'),
        seg([['morning', 'Утро'], ['day', 'День'], ['evening', 'Вечер'], ['any', 'Любое']], 'time_of_day', 'Время дня')) : null,
      build ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Напоминание в чат'),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, remindToggle), remindOn ? remindTime : null)) : null,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Сфера — для статистики «Прогресс»'), spheres),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Эмодзи'), emojis),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Цвет'), colors),
      save);
    if (!isNew) {
      const del = h('button', { type: 'button', class: 'btn ghost block' }, 'Удалить привычку');
      del.addEventListener('click', busy(del, async () => {
        try {
          await api.deleteHabit(habit.id);
          haptic.success();
          toast('Привычка удалена. История осталась в статистике.');
          s.close();
          await refreshState();
          onSaved && onSaved(null);
        } catch (e) { toastError(e); }
      }));
      body.append(del);
    }
    s.setContent(body);
  };
  draw();
  return s;
}

export function habitsSummaryText(sum) {
  if (!sum.total) return 'На сегодня привычек нет';
  return `${sum.done} из ${sum.total} ${plural(sum.total, 'привычки', 'привычек', 'привычек')} сегодня`;
}

export { clear };
