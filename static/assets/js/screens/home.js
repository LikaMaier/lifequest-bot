// ① «Мой день»: прогресс дня, план на сегодня, привычки, заметки.
// Квесты — приятный бонус внизу: «не знаешь, чем заняться — возьми задание».

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { mascot, moodFor, jump } from '../mascot.js';
import { ring, sectionTitle, MODE_INFO, toastError } from '../ui.js';
import { openQuest, openRandom } from '../questflow.js';
import { habitCard } from '../habitui.js';
import { openAddChooser, planRow } from '../planui.js';
import { api } from '../api.js';
import { refreshState } from '../store.js';
import { noteCard, noteComposer } from '../noteui.js';

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

function greeting(hour) {
  if (hour < 5) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

const link = (text, onClick) => {
  const b = h('button', { type: 'button', class: 'link' }, text);
  b.addEventListener('click', () => { haptic.tap(); onClick(); });
  return b;
};

export function render(el, { state, go }) {
  clear(el);
  const u = state.user;
  const mood = moodFor(state);
  const name = u.first_name || '';

  // Шапка: дата и профиль
  const avatar = h('button', { type: 'button', class: 'avatar-btn', 'aria-label': 'Профиль и настройки' }, (name[0] || '★').toUpperCase());
  avatar.addEventListener('click', () => { haptic.tap(); go('profile'); });
  el.append(h('header', { class: 'topbar' },
    h('div', { class: 'grow' }, h('div', { class: 'brand' }, 'МОЙ ДЕНЬ'),
      h('div', { class: 'small muted bold' }, capitalize(DATE_FMT.format(new Date())))), avatar));

  // Приветствие с маскотом
  const pet = mascot(u.mascot, mood.expr, { size: 64, label: 'Твой маскот', acc: u.accessory });
  pet.addEventListener('click', () => { haptic.tap('soft'); jump(pet); });
  el.append(h('section', { class: 'row', style: { alignItems: 'flex-start', marginBottom: '14px' } }, pet,
    h('div', { class: 'grow' }, h('h1', { style: { fontSize: '22px', marginBottom: '6px' } },
      `${greeting(state.today.hour)}${name ? `, ${name}` : ''}!`),
      h('div', { class: 'speech' }, mood.line))));

  // Прогресс дня: планы + привычки
  const plans = state.plans_today;
  const plansDone = plans.filter(o => o.status === 'done').length;
  const hb = state.habits;
  const total = plans.length + hb.total;
  const done = plansDone + hb.done;
  const streak = state.streak;
  const r = ring(done, Math.max(total, 1), { color: total && done >= total ? 'lime' : 'blue', size: 108, stroke: 12,
    caption: total ? 'за день' : 'начни', label: `За день сделано ${done} из ${total}` });
  if (total && done >= total) r.classList.add('pulse');
  el.append(h('section', { class: 'card day-card', 'aria-label': 'Прогресс дня' },
    h('div', { class: 'row', style: { gap: '14px' } }, r,
      h('div', { class: 'grow stack-sm' },
        h('div', { class: 'day-line' }, h('span', { 'aria-hidden': 'true' }, '🗓️'), h('span', { class: 'grow' }, 'Планы'),
          h('b', { class: 'num' }, plans.length ? `${plansDone}/${plans.length}` : '—')),
        h('div', { class: 'day-line' }, h('span', { 'aria-hidden': 'true' }, '🌱'), h('span', { class: 'grow' }, 'Привычки'),
          h('b', { class: 'num' }, hb.total ? `${hb.done}/${hb.total}` : '—')),
        h('div', { class: 'day-line' }, h('span', { 'aria-hidden': 'true' }, streak.current ? '🔥' : '✨'), h('span', { class: 'grow' }, 'Серия'),
          h('b', { class: 'num' }, `${streak.current} ${plural(streak.current, 'день', 'дня', 'дней')}`))))));

  // План на сегодня: дела и ввод прямо в карточке
  el.append(sectionTitle(`План на сегодня${plans.length ? ` · ${plansDone}/${plans.length}` : ''}`, link('Календарь', () => go('calendar'))),
    planWidget(plans, state));

  // Привычки
  el.append(sectionTitle(`Привычки${hb.total ? ` · ${hb.done}/${hb.total}` : ''}`, link(hb.total ? 'Все' : 'Добавить', () => go('habits'))));
  if (!hb.total) {
    const add = h('button', { type: 'button', class: 'card soft c-lime empty-line', style: { width: '100%', border: 0, textAlign: 'left' } },
      h('span', { 'aria-hidden': 'true', style: { fontSize: '24px' } }, '🌱'),
      h('span', { class: 'grow small bold' }, 'Заведи первую привычку: вода, чтение, зарядка — или что-то своё'));
    add.addEventListener('click', () => { haptic.tap(); go('habits'); });
    el.append(add);
  } else {
    el.append(h('div', { class: 'stack-sm' }, hb.items.slice(0, 6).map(x => habitCard(x, { compact: true }))));
  }

  // Заметки
  const notes = state.notes || { items: [], total: 0 };
  el.append(sectionTitle('Заметки', link(notes.total ? `Все · ${notes.total}` : 'Открыть', () => go('notes'))),
    noteComposer({ day: state.today.date, placeholder: 'Как проходит день? Мысль, идея, список…', draftKey: 'home' }));
  if (notes.items.length) el.append(h('div', { class: 'note-grid', style: { marginTop: '10px' } }, notes.items.map(n => noteCard(n))));

  // Бонус: квесты; внизу — уровень и магазин
  el.append(bonusCard(state, go), h('div', { class: 'home-footer' },
    link(`⭐ Уровень ${state.level.level} · ${state.level.name}`, () => go('awards')),
    link(`🛍️ Магазин · ${u.balance} XP`, () => go('shop'))));
}

function bonusCard(state, go) {
  const daily = state.daily;
  const modes = h('div', { class: 'bonus-modes' }, ['solo', 'pair', 'company'].map(m => {
    const info = MODE_INFO[m];
    const b = h('button', { type: 'button', class: `chip c-${info.color}`, 'aria-label': `Случайное задание: ${info.label}` }, `${info.emoji} ${info.short}`);
    b.addEventListener('click', () => { haptic.tap(); openRandom(m); });
    return b;
  }));
  const dailyBtn = h('button', { type: 'button', class: 'bonus-daily', 'aria-label': `Задание дня: ${daily.title}` },
    h('span', { 'aria-hidden': 'true', style: { fontSize: '22px' } }, daily.emoji),
    h('span', { class: 'grow' }, h('span', { class: 'tiny bold muted', style: { display: 'block' } },
      daily.status === 'done' ? 'Задание дня ✅' : `Задание дня · +${daily.bonus_xp} XP`), h('span', { class: 'bold small' }, daily.title)));
  dailyBtn.addEventListener('click', () => {
    haptic.tap();
    const active = state.active.find(q => q.id === daily.id);
    openQuest(active || { ...daily, daily: true }, { daily: !active && daily.status !== 'done' });
  });
  return h('section', { class: 'card bonus-card', style: { marginTop: '22px' }, 'aria-label': 'Бонус: задания' },
    h('div', { class: 'spread' }, h('div', { class: 'card-title', style: { margin: 0 } }, '🎲 Не знаешь, чем заняться?'),
      state.active.length ? link(`Мои квесты · ${state.active.length}`, () => go('quests')) : null),
    h('p', { class: 'small bold muted', style: { margin: '4px 0 10px' } }, 'Возьми случайное задание — маленькое приключение на сегодня.'),
    modes, dailyBtn);
}

const planDraft = { title: '', time: '' }; // набранный текст переживает перерисовку главной

/** План на сегодня: список дел и строка ввода прямо в карточке — набрал, Enter, готово. */
function planWidget(plans, state) {
  const sorted = [...plans].sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.time || '99').localeCompare(b.time || '99'));
  const card = h('section', { class: 'card plan-widget', 'aria-label': 'План на сегодня' });
  if (sorted.length) card.append(h('div', { class: 'stack-sm' }, sorted.map(o => planRow(o, { compact: true }))));
  else if (state.plans_overdue) {
    card.append(h('p', { class: 'tiny muted bold', style: { margin: '0 2px 10px' } },
      `На сегодня пусто. ${state.plans_overdue} ${plural(state.plans_overdue, 'план ждёт', 'плана ждут', 'планов ждут')} решения в календаре.`));
  }

  const title = h('input', { class: 'input pw-title', type: 'text', maxlength: '120', enterkeyhint: 'done',
    placeholder: sorted.length ? 'Ещё дело…' : 'Что успеть сегодня?', 'aria-label': 'Новое дело на сегодня' });
  const time = h('input', { class: 'input pw-time', type: 'time', 'aria-label': 'Время (необязательно)' });
  const addBtn = h('button', { type: 'button', class: 'btn pw-add', 'aria-label': 'Добавить в план', disabled: true }, '＋');
  const more = h('button', { type: 'button', class: 'link pw-more' }, 'Повтор, напоминание или задание из банка →');
  title.value = planDraft.title;
  time.value = planDraft.time;
  addBtn.disabled = !title.value.trim();
  title.addEventListener('input', () => { planDraft.title = title.value; addBtn.disabled = !title.value.trim(); });
  time.addEventListener('input', () => { planDraft.time = time.value; });
  const submit = async () => {
    const text = title.value.trim();
    if (!text || addBtn.dataset.busy) return;
    addBtn.dataset.busy = '1';
    addBtn.disabled = true;
    try {
      await api.createPlan({ title: text, date: state.today.date, ...(time.value ? { time: time.value } : {}) });
      planDraft.title = '';
      planDraft.time = '';
      haptic.success();
      await refreshState(); // главная перерисуется с новым делом
    } catch (e) {
      toastError(e);
      addBtn.disabled = false;
    } finally {
      delete addBtn.dataset.busy;
    }
  };
  addBtn.addEventListener('click', submit);
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  more.addEventListener('click', () => { haptic.tap(); openAddChooser(state.today.date); });
  card.append(h('div', { class: 'pw-input', style: { marginTop: sorted.length ? '10px' : '0' } }, title, time, addBtn), more);
  return card;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
