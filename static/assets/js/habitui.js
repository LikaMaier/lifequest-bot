// Привычки: карточка с отметками +/−, неделя точками, редактор и шаблоны.

import { h, clear, plural, weekday, fmtDay } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { refreshState } from './store.js';
import { celebrate } from './celebrate.js';
import { sheet, toast, toastError, busy, ICONS, confetti } from './ui.js';

export const HABIT_COLORS = ['lime', 'blue', 'pink', 'yellow', 'lav', 'orange', 'purple', 'red'];
const EMOJIS = ['💧', '🧘', '📖', '🚶', '😴', '📵', '🙏', '💪', '🥗', '✍️', '💊', '🧴', '🎨', '🎧', '🧹', '🌿', '🍎', '🏃', '🦷', '☀️', '🧠', '💤', '🚿', '✨'];

export const TEMPLATES = [
  { emoji: '💧', title: 'Пить воду', target: 8, unit: 'стаканов', color: 'blue' },
  { emoji: '🧘', title: 'Медитация', target: 1, unit: '', color: 'lav' },
  { emoji: '📖', title: 'Чтение', target: 10, unit: 'страниц', color: 'yellow' },
  { emoji: '💪', title: 'Зарядка', target: 1, unit: '', color: 'orange' },
  { emoji: '🚶', title: '10 000 шагов', target: 1, unit: '', color: 'lime' },
  { emoji: '🙏', title: 'Благодарности', target: 3, unit: 'штуки', color: 'pink' },
  { emoji: '😴', title: 'Лечь до 23:00', target: 1, unit: '', color: 'purple' },
  { emoji: '📵', title: 'Утро без соцсетей', target: 1, unit: '', color: 'red' },
  { emoji: '🥗', title: 'Овощи и фрукты', target: 5, unit: 'порций', color: 'lime' },
  { emoji: '✍️', title: 'Дневник', target: 1, unit: '', color: 'yellow' },
];

function countLabel(hb) {
  if (hb.target === 1) return hb.done_today ? 'выполнено сегодня' : 'сегодня ещё нет';
  return `${hb.today} из ${hb.target}${hb.unit ? ` ${hb.unit}` : ''}`;
}

async function applyLog(hb, opts, onUpdate) {
  try {
    const res = await api.logHabit(hb.id, opts);
    const pastDay = opts.date && opts.date !== hb.week[hb.week.length - 1].date;
    if (res.just_done && pastDay) {
      haptic.success();
      toast(`✓ ${fmtDay(opts.date)}: ${hb.title} отмечено${res.xp ? ` · +${res.xp} XP` : ''}`, 'good', 2200);
    } else if (res.just_done) {
      haptic.success();
      confetti(50);
      toast(`${hb.emoji} ${hb.title} — цель дня! ${res.xp ? `+${res.xp} XP` : ''}`, 'good', 2200);
    } else {
      haptic.tap();
    }
    onUpdate && onUpdate(res.habit);
    refreshState().catch(() => {});
    if (res.level_up || (res.new_achievements || []).length) await celebrate({ level_up: res.level_up, new_achievements: res.new_achievements });
  } catch (e) { toastError(e); }
}

/** Карточка привычки. compact — короткий вариант для Главной. */
export function habitCard(hb, { compact = false, onChanged } = {}) {
  const card = h('div', { class: `habit-card c-${hb.color} ${hb.done_today ? 'done' : ''} ${compact ? 'compact' : ''}` });
  const redraw = next => { const fresh = habitCard(next, { compact, onChanged }); card.replaceWith(fresh); onChanged && onChanged(next); };

  const info = h('button', { type: 'button', class: 'habit-info', 'aria-label': `Изменить привычку «${hb.title}»` },
    h('span', { class: 'habit-emoji', 'aria-hidden': 'true' }, hb.emoji),
    h('span', { class: 'grow' }, h('span', { class: 'habit-title' }, hb.title),
      h('span', { class: 'habit-meta' }, countLabel(hb), hb.streak ? ` · 🔥 ${hb.streak} ${plural(hb.streak, 'день', 'дня', 'дней')}` : '')));
  info.addEventListener('click', () => { haptic.tap(); openHabitEditor(hb); });

  let controls;
  if (hb.target === 1) {
    const check = h('button', { type: 'button', class: `habit-check ${hb.done_today ? 'on' : ''}`, 'aria-pressed': String(hb.done_today),
      'aria-label': hb.done_today ? `Снять отметку: ${hb.title}` : `Отметить: ${hb.title}`, html: ICONS.check });
    check.addEventListener('click', busy(check, () => applyLog(hb, { delta: hb.done_today ? -1 : 1 }, redraw)));
    controls = check;
  } else {
    const minus = h('button', { type: 'button', class: 'habit-step', 'aria-label': `Минус один: ${hb.title}`, html: ICONS.minus, disabled: hb.today <= 0 });
    const plus = h('button', { type: 'button', class: 'habit-step plus', 'aria-label': `Плюс один: ${hb.title}`, html: ICONS.plus });
    minus.addEventListener('click', busy(minus, () => applyLog(hb, { delta: -1 }, redraw)));
    plus.addEventListener('click', busy(plus, () => applyLog(hb, { delta: 1 }, redraw)));
    controls = h('div', { class: 'row', style: { gap: '6px' } }, minus, h('span', { class: 'num habit-count', 'aria-live': 'polite' }, String(hb.today)), plus);
  }
  card.append(h('div', { class: 'row', style: { gap: '10px' } }, info, controls));

  if (hb.target > 1) {
    const frac = Math.min(1, hb.today / hb.target);
    card.append(h('div', { class: 'habit-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${frac * 100}%` } })));
  }

  if (!compact) {
    // Неделя: точки за 7 дней; прошлые дни можно поправить нажатием.
    const week = h('div', { class: 'habit-week', role: 'group', 'aria-label': 'Последние 7 дней' },
      hb.week.map((d, i) => {
        const isToday = i === hb.week.length - 1;
        const b = h('button', { type: 'button', class: `habit-day ${d.done ? 'on' : d.count ? 'part' : ''} ${isToday ? 'today' : ''}`,
          'aria-pressed': String(d.done), 'aria-label': `${fmtDay(d.date)}: ${d.done ? 'выполнено' : d.count ? `${d.count} из ${hb.target}` : 'нет'}` },
          h('span', { class: 'wd' }, weekday(d.date)), h('span', { class: 'dot', 'aria-hidden': 'true' }, d.done ? '✓' : ''));
        b.addEventListener('click', busy(b, () => applyLog(hb, { date: d.date, count: d.done ? 0 : hb.target }, redraw)));
        return b;
      }));
    card.append(week);
  }
  return card;
}

/** Редактор: новая привычка (habit = null) или изменение существующей. */
export function openHabitEditor(habit = null, { onSaved, preset } = {}) {
  const isNew = !habit;
  const src = habit || preset || {};
  const form = { title: src.title || '', emoji: src.emoji || '✨', color: src.color || 'lime', target: src.target || 1, unit: src.unit || '' };
  const s = sheet(h('div'), { label: isNew ? 'Новая привычка' : 'Изменить привычку' });

  const draw = () => {
    const title = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Например: Пить воду', value: form.title, 'aria-label': 'Название привычки' });
    title.addEventListener('input', () => { form.title = title.value; });
    const unit = h('input', { class: 'input', type: 'text', maxlength: '12', placeholder: 'раз', value: form.unit, 'aria-label': 'Единица' });
    unit.addEventListener('input', () => { form.unit = unit.value; });

    const emojis = h('div', { class: 'emoji-grid', role: 'radiogroup', 'aria-label': 'Эмодзи' },
      EMOJIS.map(e => {
        const b = h('button', { type: 'button', class: `emoji-pick ${e === form.emoji ? 'on' : ''}`, role: 'radio', 'aria-checked': String(e === form.emoji), 'aria-label': e }, e);
        b.addEventListener('click', () => { haptic.select(); form.emoji = e; form.title = title.value; form.unit = unit.value; draw(); });
        return b;
      }));
    const colors = h('div', { class: 'row-wrap', role: 'radiogroup', 'aria-label': 'Цвет' },
      HABIT_COLORS.map(c => {
        const b = h('button', { type: 'button', class: `accent-pick c-${c} ${c === form.color ? 'on' : ''}`, role: 'radio', 'aria-checked': String(c === form.color), 'aria-label': `Цвет ${c}` }, c === form.color ? '✓' : '');
        b.addEventListener('click', () => { haptic.select(); form.color = c; form.title = title.value; form.unit = unit.value; draw(); });
        return b;
      }));
    const targetVal = h('span', { class: 'num', style: { fontSize: '26px', minWidth: '44px', textAlign: 'center' }, 'aria-live': 'polite' }, String(form.target));
    const step = d => { haptic.select(); form.target = Math.max(1, Math.min(50, form.target + d)); targetVal.textContent = String(form.target); };
    const minus = h('button', { type: 'button', class: 'habit-step', 'aria-label': 'Меньше раз в день', html: ICONS.minus });
    const plus = h('button', { type: 'button', class: 'habit-step plus', 'aria-label': 'Больше раз в день', html: ICONS.plus });
    minus.addEventListener('click', () => step(-1));
    plus.addEventListener('click', () => step(1));

    const save = h('button', { type: 'button', class: 'btn block' }, isNew ? 'Добавить привычку' : 'Сохранить');
    save.addEventListener('click', busy(save, async () => {
      haptic.tap();
      form.title = title.value; form.unit = unit.value;
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

    const body = h('div', { class: 'stack' },
      h('h2', null, isNew ? 'Новая привычка' : 'Привычка'),
      isNew ? h('div', null, h('div', { class: 'small bold muted', style: { marginBottom: '6px' } }, 'Быстрый старт'),
        h('div', { class: 'chips' }, TEMPLATES.map(t => {
          const b = h('button', { type: 'button', class: `chip c-${t.color}` }, `${t.emoji} ${t.title}`);
          b.addEventListener('click', () => { haptic.select(); Object.assign(form, t); draw(); });
          return b;
        }))) : null,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Название'), title),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Сколько раз в день'),
        h('div', { class: 'row' }, minus, targetVal, plus, h('div', { class: 'grow' }, unit))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Эмодзи'), emojis),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Цвет'), colors),
      save);
    if (!isNew) {
      const del = h('button', { type: 'button', class: 'btn ghost block' }, 'Удалить привычку');
      let armed = false;
      del.addEventListener('click', busy(del, async () => {
        if (!armed) { armed = true; haptic.warning(); del.textContent = 'Точно удалить? Нажми ещё раз'; return; }
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
  if (!sum.total) return 'Привычек пока нет';
  return `${sum.done} из ${sum.total} ${plural(sum.total, 'привычки', 'привычек', 'привычек')} сегодня`;
}

export { clear };
