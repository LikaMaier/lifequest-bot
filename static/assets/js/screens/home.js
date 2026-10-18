// ① Главная: привычки и план дня в центре. Маскот радуется привычкам,
// серия рядом; квест дня — бонус внизу; «+» добавляет что угодно.

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { mascot, moodFor, jump } from '../mascot.js';
import { progressBar, busy, toastError } from '../ui.js';
import { buyStars } from '../premium.js';
import { openQuest } from '../questflow.js';
import { habitRing, openTemplatePicker } from '../habitui.js';
import { planRow } from '../planui.js';
import { openPlus, plusFab } from '../plus.js';
import { chestRow } from '../chest.js';
import { duelRow, duelSpotlight, duelPendingCard } from '../duelui.js';
import { contestSpotlight } from '../contestui.js';

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

export function render(el, ctx) {
  const { state, go } = ctx;
  clear(el);
  const u = state.user;
  const mood = moodFor(state);
  const name = u.first_name || '';
  const hs = state.habits;
  const due = (hs.items || []).filter(x => x.kind === 'build' && (x.due_today || x.done_today));
  const rerender = () => render(el, ctx);

  // Шапка: дата и профиль
  const avatar = h('button', { type: 'button', class: 'avatar-btn', 'aria-label': 'Профиль и настройки' }, (name[0] || '★').toUpperCase());
  avatar.addEventListener('click', () => { haptic.tap(); go('profile'); });
  el.append(h('header', { class: 'topbar' },
    h('div', { class: 'grow' }, h('div', { class: 'brand' }, 'LIFEQUEST'),
      h('div', { class: 'small muted bold' }, capitalize(DATE_FMT.format(new Date())))), avatar));

  // Маскот — его настроение зависит от привычек; серия рядом
  const allDone = hs.total && hs.done === hs.total;
  const expr = mood.expr === 'sleepy' || mood.expr === 'sad' ? mood.expr : allDone ? 'love' : hs.done ? 'happy' : mood.expr;
  const pet = mascot(u.mascot, expr, { size: 72, label: 'Твой маскот', acc: u.accessory });
  pet.addEventListener('click', () => { haptic.tap('soft'); jump(pet); });
  const petLine = !hs.total ? mood.line
    : allDone ? 'Все привычки на сегодня сделаны — я счастлив! 🎉'
    : hs.done ? `Уже ${hs.done} из ${hs.total} привычек — ещё чуть-чуть!`
    : `Сегодня ${hs.total} ${plural(hs.total, 'привычка', 'привычки', 'привычек')} — начнём?`;
  const streak = state.streak;
  const streakBox = h('button', { type: 'button', class: 'home2-streak', 'aria-label': `Серия ${streak.current} ${plural(streak.current, 'день', 'дня', 'дней')}` },
    h('b', null, String(streak.current)), h('span', null, `${plural(streak.current, 'день', 'дня', 'дней')} ${streak.current ? '🔥' : '🌱'}`));
  streakBox.addEventListener('click', () => { haptic.tap(); go('progress'); });
  el.append(h('section', { class: 'home2-hello' }, pet,
    h('div', { class: 'grow' }, h('h1', null, name ? `Привет, ${name}!` : 'Привет!'), h('div', { class: 'home2-line' }, petLine)), streakBox));
  const banner = streakBanner(state, go);
  if (banner) el.append(banner);

  // Дуэли с друзьями — ярко и сразу под приветствием: кто ведёт и что сделать сегодня
  const du = state.duels;
  if (du && du.incoming.length) {
    const inv = du.incoming[0];
    const b = h('button', { type: 'button', class: 'dsp-invite' }, h('span', { class: 'dsp-invite-emoji', 'aria-hidden': 'true' }, '⚔️'),
      h('span', { class: 'grow' }, h('b', null, `${inv.rival ? inv.rival.name : 'Друг'} бросает тебе вызов!`),
        h('span', null, `${inv.emoji} ${inv.title} · ${inv.days} ${plural(inv.days, 'день', 'дня', 'дней')} — ответь`)),
      h('span', { class: 'dsp-invite-go', 'aria-hidden': 'true' }, '›'));
    b.addEventListener('click', () => { haptic.tap(); go('friends'); });
    el.append(b);
  }
  if (du && du.active.length) {
    // впереди — та, где сейчас «твой ход»
    const sorted = [...du.active].sort((a, b) => (!b.me.today_done) - (!a.me.today_done));
    el.append(duelSpotlight(sorted[0], { go, state }));
    for (const d of sorted.slice(1, 3)) el.append(duelRow(d, { go }));
  }
  // Соревнования — так же ярко, как дуэли: лидеры, твоё место, отметка на сегодня
  for (const c of (state.contests || []).slice(0, 3)) el.append(contestSpotlight(c, { go }));
  // Свои отправленные вызовы — сразу после создания, пока друг не ответил
  if (du && du.outgoing.length) for (const d of du.outgoing.slice(0, 2)) el.append(duelPendingCard(d, { go, state }));

  // Привычки сегодня — кольцами
  const habitsCard = h('section', { class: 'home2-card' });
  const habitsLink = h('button', { type: 'button', class: 'home2-link' }, hs.items && hs.items.length ? 'Все' : 'Добавить');
  habitsLink.addEventListener('click', () => { haptic.tap(); go('habits'); });
  habitsCard.append(h('div', { class: 'home2-head' }, h('h2', null, 'Привычки сегодня'),
    hs.total ? h('span', { class: 'home2-count' }, `${hs.done} из ${hs.total}`) : null, habitsLink));
  if (!hs.items || !hs.items.length) {
    const pick = h('button', { type: 'button', class: 'quest-item c-lime' }, h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, '🌱'),
      h('span', { class: 'grow' }, h('span', { class: 'q-title', style: { display: 'block' } }, 'Выбери первые привычки'),
        h('span', { class: 'q-meta', style: { display: 'block' } }, 'Вода, зарядка, чтение — в пару касаний')));
    pick.addEventListener('click', () => { haptic.tap(); openTemplatePicker({ onDone: rerender }); });
    habitsCard.append(pick);
  } else if (!due.length) {
    habitsCard.append(h('p', { class: 'home2-empty' }, hs.pause ? '⏸ Пауза — отдыхай, серии не горят' : 'Сегодня по расписанию привычек нет — выходной 🌿'));
  } else {
    habitsCard.append(h('div', { class: 'hb2-rings' }, due.map(hb => habitRing(hb, { onChanged: () => {} }))));
    const left = hs.total - hs.done;
    habitsCard.append(h('div', { class: 'home2-hint' }, left
      ? `Ещё ${left} ${plural(left, 'привычка', 'привычки', 'привычек')} — и день засчитан полностью`
      : 'Все привычки сделаны — маскот доволен 🎉'));
    const ch = chestRow(state.chest);
    if (ch) habitsCard.append(ch);
  }
  el.append(habitsCard);


  // План дня
  const calLink = h('button', { type: 'button', class: 'home2-link' }, 'Календарь');
  calLink.addEventListener('click', () => { haptic.tap(); go('calendar'); });
  el.append(h('div', { class: 'home2-head', style: { marginTop: '18px' } }, h('h2', null, 'План дня'),
    state.plans_today.length ? h('span', { class: 'home2-count' }, String(state.plans_today.length)) : null, calLink));
  if (!state.plans_today.length) {
    const plan = h('button', { type: 'button', class: 'quest-item c-blue' }, h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, '🗓️'),
      h('span', { class: 'grow' }, h('span', { class: 'q-title', style: { display: 'block' } }, 'На сегодня планов нет'),
        h('span', { class: 'q-meta', style: { display: 'block' } }, state.plans_overdue ? `Есть ${state.plans_overdue} из прошлых дней — загляни в календарь` : 'Нажми «+» и напиши, что хочешь сделать')));
    plan.addEventListener('click', () => { haptic.tap(); openPlus({ go, onChange: rerender }); });
    el.append(plan);
  } else {
    const focus = state.plans_today.find(o => o.focus);
    if (focus) {
      const done = focus.status === 'done';
      const fc = h('button', { type: 'button', class: `home2-focus ${done ? 'done' : ''}` },
        h('span', { class: 'grow' }, h('span', { class: 'home2-kicker' }, done ? '🎯 Главное сделано!' : '🎯 Главное сегодня'),
          h('span', { class: 'bold', style: { display: 'block', fontSize: '16px' } }, focus.title),
          focus.time ? h('span', { class: 'small bold', style: { display: 'block' } }, `в ${focus.time}${focus.end_time ? `–${focus.end_time}` : ''}`) : null),
        h('span', { class: 'home2-focus-dot', 'aria-hidden': 'true' }, done ? '✓' : ''));
      fc.addEventListener('click', () => { haptic.tap(); go('calendar'); });
      el.append(fc);
    }
    el.append(h('div', { class: 'stack-sm' }, state.plans_today.filter(o => !o.focus).slice(0, 4).map(o => planRow(o, { compact: true }))));
  }

  // Квест дня — бонус
  const daily = state.daily;
  const active = state.active.find(q => q.id === daily.id);
  const take = h('button', { type: 'button', class: 'cal2-pill lav' }, daily.status === 'done' ? 'Готово ✓' : active ? 'Открыть' : 'Взять');
  const dailyCard = h('section', { class: 'home2-bonus' },
    h('span', { class: 'home2-bonus-emoji', 'aria-hidden': 'true' }, daily.emoji),
    h('div', { class: 'grow' }, h('div', { class: 'home2-kicker' }, `Квест дня · +${daily.bonus_xp} XP`), h('div', { class: 'bold' }, daily.title)), take);
  take.addEventListener('click', () => { haptic.tap(); openQuest(active || { ...daily, daily: true }, { daily: !active && daily.status !== 'done' }); });
  el.append(dailyCard);
  if (state.active.length) {
    const more = h('button', { type: 'button', class: 'home2-link-row' }, `🎯 Мои квесты: ${state.active.length}`, h('span', null, '›'));
    more.addEventListener('click', () => { haptic.tap(); go('quests'); });
    el.append(more);
  }

  // Уровень одной строкой
  const lv = state.level;
  const level = h('button', { type: 'button', class: 'home2-level', 'aria-label': `Уровень ${lv.level}, ${lv.xp} из ${lv.next} XP` },
    h('span', { class: 'home2-level-n' }, String(lv.level)),
    h('span', { class: 'grow' }, h('span', { class: 'bold', style: { display: 'block' } }, lv.name), progressBar(lv.progress, 'yellow')),
    h('span', { class: 'home2-count' }, `${lv.xp}/${lv.next} XP`));
  level.addEventListener('click', () => { haptic.tap(); go('progress'); });
  el.append(level);

  el.append(h('div', { style: { height: '72px' }, 'aria-hidden': 'true' }), plusFab({ go, onChange: rerender }));
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Серия в опасности или только что сгорела — подсказываем, как спасти.
function streakBanner(state, go) {
  const s = state.streak;
  const p = state.premium || {};
  if (p.restore) {
    const b = h('button', { type: 'button', class: 'btn small colored c-pink' }, `🔥 Вернуть за ${p.prices.streak_restore}⭐`);
    b.addEventListener('click', busy(b, async () => {
      try { await buyStars('streak_restore'); } catch (e) { toastError(e); }
    }));
    return h('section', { class: 'card tinted c-pink', style: { marginTop: '12px' } },
      h('div', { class: 'bold' }, `💔 Серия ${p.restore} ${plural(p.restore, 'день', 'дня', 'дней')} прервалась`),
      h('p', { class: 'small bold', style: { margin: '4px 0 10px' } }, 'Её ещё можно вернуть — пока не начата новая.'), b);
  }
  if (s.status === 'at_risk' && s.current >= 3 && !s.freeze_weekly_left && !s.freeze_tokens) {
    const b = h('button', { type: 'button', class: 'btn small ghost' }, '🧊 Купить заморозку');
    b.addEventListener('click', () => { haptic.tap(); go('shop'); });
    return h('section', { class: 'card tinted c-orange', style: { marginTop: '12px' } },
      h('div', { class: 'bold' }, '🔥 Заморозок не осталось'),
      h('p', { class: 'small bold', style: { margin: '4px 0 10px' } }, 'Если сегодня ничего не сделать, серия сгорит в полночь.'), b);
  }
  return null;
}
