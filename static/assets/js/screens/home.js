// ① Главная: приветствие с маскотом, кольцо дня, метрики, три кнопки
// случайных заданий, задание дня, активные квесты, мини-график недели.

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { mascot, moodFor, jump } from '../mascot.js';
import { ring, progressBar, sectionTitle, emptyState, busy } from '../ui.js';
import { barChart } from '../charts.js';
import { modeButtons, openQuest, questItem, completeQuest } from '../questflow.js';
import { habitCard } from '../habitui.js';

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

export function render(el, { state, go }) {
  clear(el);
  const u = state.user;
  const mood = moodFor(state);
  const name = u.first_name || 'путешественница';

  // Шапка
  const avatar = h('button', { type: 'button', class: 'avatar-btn', 'aria-label': 'Профиль и настройки' }, (name[0] || '★').toUpperCase());
  avatar.addEventListener('click', () => { haptic.tap(); go('profile'); });
  el.append(h('header', { class: 'topbar' },
    h('div', { class: 'grow' }, h('div', { class: 'brand' }, 'LIFEQUEST'),
      h('div', { class: 'small muted bold' }, capitalize(DATE_FMT.format(new Date())))), avatar));

  // Приветствие + маскот с репликой
  const pet = mascot(u.mascot, mood.expr, { size: 76, label: 'Твой маскот' });
  pet.addEventListener('click', () => { haptic.tap('soft'); jump(pet); });
  el.append(h('section', { class: 'row', style: { alignItems: 'flex-start', marginBottom: '16px' } }, pet,
    h('div', { class: 'grow' }, h('h1', { style: { fontSize: '23px', marginBottom: '8px' } }, `Привет, ${name}!`),
      h('div', { class: 'speech' }, mood.line))));

  // Кольцо дня + серия
  const goal = state.today.goal;
  const done = state.today.done;
  const r = ring(done, goal, { color: done >= goal ? 'lime' : 'pink', size: 150, caption: 'цель дня',
    label: `Сегодня выполнено ${done} из ${goal}` });
  if (done >= goal) r.classList.add('pulse');
  const streak = state.streak;
  const streakText = streak.status === 'done' ? 'засчитана сегодня'
    : streak.status === 'at_risk' ? 'выполни задание, чтобы продлить'
    : streak.status === 'freeze' ? 'заморозка спасёт пропуск ❄️'
    : streak.status === 'lost' ? 'начни новую сегодня' : 'начни сегодня';
  el.append(h('section', { class: 'card', 'aria-label': 'Прогресс дня' },
    h('div', { class: 'row', style: { gap: '16px' } }, r,
      h('div', { class: 'grow stack-sm' },
        h('div', { class: 'small bold muted' }, 'СЕРИЯ'),
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'num', style: { fontSize: '34px' } }, String(streak.current)),
          h('span', { style: { fontSize: '26px' }, 'aria-hidden': 'true' }, streak.current ? '🔥' : '🌱')),
        h('div', { class: 'small bold' }, `${plural(streak.current, 'день', 'дня', 'дней')} подряд — ${streakText}`),
        h('div', { class: 'tiny muted bold' }, streak.freeze_available ? '❄️ Заморозка на неделю доступна' : '❄️ Заморозка уже использована')))));

  // Метрики
  const lv = state.level;
  const levelCard = h('button', { type: 'button', class: 'metric c-purple', style: { gridColumn: 'span 2' }, 'aria-label': 'Уровень и награды' },
    h('div', { class: 'spread' }, h('span', { class: 'label' }, `Уровень ${lv.level}`), h('span', { class: 'hint' }, `${lv.xp} / ${lv.next} XP`)),
    h('div', { class: 'value', style: { fontSize: '19px', margin: '2px 0 8px' } }, lv.name),
    progressBar(lv.progress, 'purple'),
    h('div', { class: 'hint', style: { marginTop: '6px' } }, `До «${lv.next_name}» — ${lv.next - lv.xp} XP`));
  levelCard.addEventListener('click', () => { haptic.tap(); go('awards'); });
  const badges = h('button', { type: 'button', class: 'metric c-yellow', 'aria-label': 'Баджи' },
    h('span', { class: 'label' }, 'Баджи'), h('span', { class: 'value' }, `${state.badges.unlocked}`),
    h('span', { class: 'hint' }, `из ${state.badges.total}`), h('span', { class: 'deco', 'aria-hidden': 'true' }, '🏅'));
  badges.addEventListener('click', () => { haptic.tap(); go('awards'); });
  el.append(h('section', { class: 'metrics', style: { marginTop: '14px' }, 'aria-label': 'Показатели' },
    h('div', { class: 'metric c-lime' }, h('span', { class: 'label' }, 'За месяц'), h('span', { class: 'value' }, String(state.month_done)),
      h('span', { class: 'hint' }, plural(state.month_done, 'задание', 'задания', 'заданий')), h('span', { class: 'deco', 'aria-hidden': 'true' }, '✅')),
    badges, levelCard));

  // Три кнопки случайных заданий
  el.append(sectionTitle('Получить задание'), modeButtons());

  // Задание дня
  const daily = state.daily;
  const dailyStatus = daily.status === 'done' ? '✅ Выполнено' : daily.status === 'active' ? 'В твоих квестах' : `+${daily.bonus_xp} XP бонус`;
  const dailyCard = h('button', { type: 'button', class: 'card tinted c-yellow', style: { width: '100%', textAlign: 'left', border: '0', marginTop: '6px' },
    'aria-label': `Задание дня: ${daily.title}` },
    h('div', { class: 'spread' }, h('span', { class: 'card-title', style: { margin: 0 } }, '☀️ Задание дня'), h('span', { class: 'tag c-paleyellow' }, dailyStatus)),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { style: { fontSize: '30px' }, 'aria-hidden': 'true' }, daily.emoji),
      h('div', { class: 'grow' }, h('div', { class: 'bold' }, daily.title), h('div', { class: 'small', style: { fontWeight: 600 } }, 'Одно на всех — сегодня его выполняют все в LifeQuest'))));
  dailyCard.addEventListener('click', () => {
    haptic.tap();
    const active = state.active.find(q => q.id === daily.id);
    openQuest(active || { ...daily, daily: true }, { daily: !active && daily.status !== 'done' });
  });
  el.append(sectionTitle('Сегодня'), dailyCard);

  // Привычки на сегодня
  const habitsLink = h('button', { type: 'button', class: 'link' }, state.habits.total ? 'Все привычки' : 'Добавить');
  habitsLink.addEventListener('click', () => { haptic.tap(); go('habits'); });
  el.append(sectionTitle(`Привычки${state.habits.total ? ` · ${state.habits.done}/${state.habits.total}` : ''}`, habitsLink));
  if (!state.habits.total) {
    const add = h('button', { type: 'button', class: 'quest-item c-lime' }, h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, '🌱'),
      h('span', { class: 'grow' }, h('span', { class: 'q-title' }, 'Заведи первую привычку'),
        h('span', { class: 'q-meta', style: { display: 'block' } }, 'Вода, чтение, зарядка — или что-то своё')));
    add.addEventListener('click', () => { haptic.tap(); go('habits'); });
    el.append(add);
  } else {
    el.append(h('div', { class: 'stack-sm' }, state.habits.items.slice(0, 4).map(hb => habitCard(hb, { compact: true }))));
  }

  // Активные квесты
  const allLink = h('button', { type: 'button', class: 'link' }, 'Все квесты');
  allLink.addEventListener('click', () => { haptic.tap(); go('quests'); });
  el.append(sectionTitle(`Мои квесты${state.active.length ? ` · ${state.active.length}` : ''}`, allLink));
  if (!state.active.length) {
    el.append(h('div', { class: 'card' }, emptyState('Пока нет принятых заданий. Нажми любую кнопку выше — я подберу что-нибудь интересное!', { kind: u.mascot, expr: 'wink' })));
  } else {
    const list = h('div', { class: 'stack-sm' });
    for (const q of state.active.slice(0, 3)) {
      const doneBtn = h('button', { type: 'button', class: 'btn small colored c-lime', 'aria-label': `Выполнено: ${q.title}` }, 'Готово');
      doneBtn.addEventListener('click', busy(doneBtn, async () => { haptic.tap(); await completeQuest(q.active_id); }));
      list.append(questItem(q, () => openQuest(q), doneBtn));
    }
    el.append(list);
  }

  // Мини-график недели
  const weekTotal = state.week.reduce((s, d) => s + d.count, 0);
  const statsLink = h('button', { type: 'button', class: 'link' }, 'Подробнее');
  statsLink.addEventListener('click', () => { haptic.tap(); go('progress'); });
  el.append(sectionTitle('Неделя', statsLink),
    h('section', { class: 'card' },
      h('div', { class: 'spread', style: { marginBottom: '8px' } }, h('span', { class: 'bold' }, 'Выполнено за 7 дней'),
        h('span', { class: 'num', style: { fontSize: '20px' } }, String(weekTotal))),
      barChart(state.week, { height: 120, compact: true, label: 'Выполнено за последние 7 дней' })));
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
