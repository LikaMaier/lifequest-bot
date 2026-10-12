// ① «Мой день»: прогресс дня, план на сегодня, привычки, заметки.
// Квесты — приятный бонус внизу: «не знаешь, чем заняться — возьми задание».

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { mascot, moodFor, jump } from '../mascot.js';
import { ring, sectionTitle, MODE_INFO, busy, toastError } from '../ui.js';
import { openQuest, openRandom } from '../questflow.js';
import { habitCard } from '../habitui.js';
import { openAddChooser, openPlanSheet, completePlan } from '../planui.js';
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

  // План на сегодня — лист тетради в линейку с карандашом
  el.append(sectionTitle(`План на сегодня${plans.length ? ` · ${plansDone}/${plans.length}` : ''}`, link('Календарь', () => go('calendar'))),
    notebook(plans, state));

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

// Карандаш: жёлтый корпус, розовый ластик, заточенный кончик.
const PENCIL = '<svg viewBox="0 0 120 24" aria-hidden="true">'
  + '<path d="M18 4h78v16H18z" fill="#FFC83D"/><path d="M18 4h78v5H18z" fill="#FFDD7A"/><path d="M18 15h78v5H18z" fill="#E9A800"/>'
  + '<path d="M96 4l20 8-20 8z" fill="#F2C99A"/><path d="M110 9.6l6 2.4-6 2.4z" fill="#3A3550"/>'
  + '<path d="M12 4h6v16h-6z" fill="#B8BCC6"/><path d="M12 8h6M12 12h6M12 16h6" stroke="#8C909C" stroke-width="1"/>'
  + '<path d="M2 6a2 2 0 0 1 2-2h8v16H4a2 2 0 0 1-2-2z" fill="#F48FB1"/></svg>';

const MIN_LINES = 4;

/** План дня на листе в линейку: по строке на план, плюс пустая строка «допиши»;
 *  без планов — пустой листок на 4 строки. Лист растёт вместе со списком. */
function notebook(plans, state) {
  const add = () => { haptic.tap(); openAddChooser(state.today.date); };
  const sorted = [...plans].sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.time || '99').localeCompare(b.time || '99'));
  const lines = sorted.map(o => {
    const done = o.status === 'done';
    const skipped = o.status === 'skipped';
    const check = h('button', { type: 'button', class: `nb-check ${done ? 'on' : ''}`, disabled: done || skipped,
      'aria-label': done ? `Выполнено: ${o.title}` : `Отметить выполненным: ${o.title}` }, done ? '✓' : '');
    if (!done && !skipped) {
      check.addEventListener('click', busy(check, async () => {
        check.classList.add('on'); check.textContent = '✓';
        try { await completePlan(o); } catch (e) { check.classList.remove('on'); check.textContent = ''; toastError(e); }
      }));
    }
    const text = h('button', { type: 'button', class: 'nb-text', 'aria-label': `${o.title}${o.time ? `, ${o.time}` : ''}. Открыть` },
      o.time ? h('span', { class: 'nb-time' }, o.time) : null,
      h('span', { class: 'nb-title' }, `${o.quest ? `${o.quest.emoji} ` : ''}${o.title}`));
    text.addEventListener('click', () => { haptic.tap(); openPlanSheet(o); });
    return h('li', { class: `nb-line ${done ? 'done' : ''} ${skipped ? 'skipped' : ''}` }, check, text);
  });
  // Пустые строки: минимум 4 на листе и всегда одна свободная — «допиши».
  const empty = Math.max(MIN_LINES - lines.length, 1);
  for (let i = 0; i < empty; i++) {
    const first = i === 0;
    const overdueHint = !plans.length && i === 1 && state.plans_overdue
      ? `${state.plans_overdue} ${plural(state.plans_overdue, 'план ждёт', 'плана ждут', 'планов ждут')} в календаре` : '';
    const hint = first ? (plans.length ? 'дописать ещё…' : 'что хочется успеть?') : overdueHint;
    const b = h('button', { type: 'button', class: 'nb-text nb-empty', 'aria-label': first ? 'Добавить план на сегодня' : 'Пустая строка', tabindex: first ? null : '-1' },
      h('span', { class: 'nb-title' }, hint));
    b.addEventListener('click', add);
    lines.push(h('li', { class: 'nb-line nb-blank' }, h('span', { class: 'nb-check ghost', 'aria-hidden': 'true' }), b));
  }
  const pencil = h('button', { type: 'button', class: 'nb-pencil', 'aria-label': 'Добавить план на сегодня', html: PENCIL });
  pencil.addEventListener('click', add);
  const sheet = h('section', { class: 'notebook', 'aria-label': 'План на сегодня' },
    h('div', { class: 'nb-holes', 'aria-hidden': 'true' }), h('ol', { class: 'nb-lines' }, lines), pencil);
  // Лист «разворачивается»: высота плавно подстраивается под число строк.
  sheet.style.setProperty('--lines', String(lines.length));
  return sheet;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
