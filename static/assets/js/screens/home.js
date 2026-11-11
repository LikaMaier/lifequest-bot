// ① Главная — за полтора экрана: квест дня героем (главная фишка), кольца привычек,
// «твой ход» с друзьями одной строкой, маскот строкой (весь Домик — по тапу),
// неделя лентой, план дня; «+» добавляет что угодно.

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { moodFor } from '../mascot.js';
import { busy, toastError } from '../ui.js';
import { buyStars } from '../premium.js';
import { openQuest } from '../questflow.js';
import { habitRing, openTemplatePicker } from '../habitui.js';
import { planRow } from '../planui.js';
import { openPlus, plusFab } from '../plus.js';
import { chestRow } from '../chest.js';
import { openContest } from '../contestui.js';
import { petStrip } from '../petroom.js';
import { api } from '../api.js';

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

  // Тамагочи «Домик» — маскот живёт привычками; серия рядом с приветствием
  const allDone = hs.total && hs.done === hs.total;
  const petLine = !hs.total ? mood.line
    : allDone ? 'Все привычки на сегодня сделаны — я счастлив! 🎉'
    : hs.done ? `Уже ${hs.done} из ${hs.total} привычек — ещё чуть-чуть!`
    : `Сегодня ${hs.total} ${plural(hs.total, 'привычка', 'привычки', 'привычек')} — начнём?`;
  const streak = state.streak;
  const streakBox = h('button', { type: 'button', class: 'home2-streak', 'aria-label': `Серия ${streak.current} ${plural(streak.current, 'день', 'дня', 'дней')}` },
    h('b', null, String(streak.current)), h('span', null, `${plural(streak.current, 'день', 'дня', 'дней')} ${streak.current ? '🔥' : '🌱'}`));
  streakBox.addEventListener('click', () => { haptic.tap(); go('progress'); });
  el.append(h('section', { class: 'home2-hello' },
    h('div', { class: 'grow' }, h('h1', null, name ? `Привет, ${name}!` : 'Привет!')), streakBox));
  let habitsCard = null;
  const banner = streakBanner(state, go);
  if (banner) el.append(banner);
  if (state.gift_theme === 'halloween') el.append(halloweenGift(go));

  // Квест дня — герой экрана: «не знаешь, чем заняться — вот задание»
  el.append(dailyHero(state, go));

  // «Твой ход» — дуэли и соревнования одной строкой; карточки целиком — во вкладке «Друзья»
  const turns = turnLines(state, go);
  if (turns.length) el.append(h('div', { class: 'turn-list' }, turns));

  // Привычки сегодня — кольцами
  habitsCard = h('section', { class: 'home2-card' });
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

  // Маскот — строкой: сколько еды в миске; тап открывает Домик
  el.append(petStrip(state, { line: petLine, onOpen: () => go('pet') }));

  // Неделя лентой: заливка дня — доля сделанных привычек, тап — план
  el.append(weekStrip(state, go));

  // План дня
  const calLink = h('button', { type: 'button', class: 'home2-link' }, 'План ›');
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

  if (state.active.length) {
    const more = h('button', { type: 'button', class: 'home2-link-row' }, `🎯 Мои квесты: ${state.active.length}`, h('span', null, '›'));
    more.addEventListener('click', () => { haptic.tap(); go('quests'); });
    el.append(more);
  }

  el.append(h('div', { style: { height: '72px' }, 'aria-hidden': 'true' }), plusFab({ go, onChange: rerender }));
}

// 30 октября: «Хэллоуин» в подарок — кнопка ведёт к выбору стилей в Профиле
function halloweenGift(go) {
  const btn = h('button', { type: 'button', class: 'gift-btn' }, '🎨 Выбрать стиль');
  btn.addEventListener('click', () => {
    haptic.tap('medium');
    go('profile');
    let tries = 0;
    const scroll = () => {
      const t = document.getElementById('themes');
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else if (tries++ < 20) setTimeout(scroll, 100);
    };
    setTimeout(scroll, 150);
  });
  return h('section', { class: 'gift-card' },
    h('div', { class: 'gift-emoji', 'aria-hidden': 'true' }, '🎃'),
    h('div', { class: 'grow' }, h('div', { class: 'gift-kicker' }, 'Подарок к Хэллоуину'),
      h('b', null, 'Стиль «Хэллоуин» теперь твой навсегда!'),
      h('p', null, 'Тыквы, летучие мыши и фиолетовая ночь — включи его в Профиле.'), btn));
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
  return null;
}

/** Квест дня — большая карточка-герой с кнопкой «Беру» и выходом на 🎲 «подбери другой». */
function dailyHero(state, go) {
  const daily = state.daily;
  const active = state.active.find(q => q.id === daily.id);
  const done = daily.status === 'done';
  const take = h('button', { type: 'button', class: 'dh-btn' }, done ? '✓ Выполнено' : active ? 'Открыть квест' : 'Беру квест');
  take.addEventListener('click', () => { haptic.tap('medium'); openQuest(active || { ...daily, daily: true }, { daily: !active && !done }); });
  const other = h('button', { type: 'button', class: 'dh-other' }, done ? '🎲 Ещё одно задание' : 'не то? подбери другое 🎲');
  other.addEventListener('click', () => { haptic.tap(); go('quests'); });
  const meta = [daily.minutes ? `⏱ ${daily.minutes} мин` : null, daily.sphere_label || daily.sphere ? `${daily.sphere_emoji || '✨'} ${daily.sphere_label || daily.sphere}` : null, `+${daily.bonus_xp} XP`].filter(Boolean);
  return h('section', { class: `dh ${done ? 'done' : ''}`, 'aria-label': 'Квест дня' },
    h('div', { class: 'dh-kicker' }, done ? '🎉 КВЕСТ ДНЯ СДЕЛАН' : '🎲 КВЕСТ ДНЯ'),
    h('div', { class: 'dh-row' }, h('span', { class: 'dh-emoji', 'aria-hidden': 'true' }, daily.emoji), h('h2', { class: 'dh-title' }, daily.title)),
    h('div', { class: 'dh-meta' }, meta.map(m => h('span', null, m))),
    take, other);
}
/** Строки «твой ход»: входящий вызов, дуэль без отметки сегодня, соревнование с неотмеченными пунктами. */
function turnLines(state, go) {
  const out = [];
  const line = (emoji, text, sub, onClick, hot = false) => {
    const b = h('button', { type: 'button', class: `turn-line ${hot ? 'hot' : ''}` }, h('span', { class: 'turn-emoji', 'aria-hidden': 'true' }, emoji),
      h('span', { class: 'grow' }, h('b', null, text), sub ? h('span', null, sub) : null), h('span', { class: 'turn-go', 'aria-hidden': 'true' }, '›'));
    b.addEventListener('click', () => { haptic.tap(); onClick(); });
    return b;
  };
  const du = state.duels || { incoming: [], active: [] };
  for (const d of du.incoming.slice(0, 1)) {
    out.push(line('⚔️', `${d.rival ? d.rival.name : 'Друг'} бросает тебе вызов!`, `${d.emoji} ${d.title} — ответь`, () => go('friends'), true));
  }
  for (const d of du.active.filter(x => !x.me.today_done).slice(0, 2)) {
    out.push(line(d.emoji || '⚔️', `Твой ход: ${d.title}`, `дуэль с ${d.rival ? d.rival.name : 'другом'} · отметь привычку`, () => go('friends'), true));
  }
  for (const c of (state.contests || []).filter(x => x.status === 'active' && !x.not_started && x.done_today < x.items).slice(0, 2)) {
    out.push(line(c.emoji || '🏆', `Соревнование: ${c.title}`, `сегодня отмечено ${c.done_today} из ${c.items}${c.place ? ` · ты ${c.place}-е место` : ''}`, () => openContest(go, c.id)));
  }
  return out;
}

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const weekCache = new Map(); // 'YYYY-MM' -> дни с привычками

/** Неделя пн–вс: день заливается по доле сделанных привычек, тап — полный календарь. */
function weekStrip(state, go) {
  const today = state.today.date;
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(t); monday.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => { const x = new Date(monday); x.setUTCDate(monday.getUTCDate() + i); return x.toISOString().slice(0, 10); });
  const cells = days.map((iso, i) => {
    const b = h('button', { type: 'button', class: `wk-day ${iso === today ? 'today' : ''} ${iso > today ? 'future' : ''}`, 'aria-label': `${WD[i]}, ${Number(iso.slice(8))}` },
      h('span', { class: 'wk-wd' }, WD[i]), h('b', null, String(Number(iso.slice(8)))));
    b.addEventListener('click', () => { haptic.select(); go('calendar'); });
    return b;
  });
  const open = h('button', { type: 'button', class: 'home2-link' }, `${MONTHS[m - 1]} ›`);
  open.addEventListener('click', () => { haptic.tap(); go('calendar'); });
  const box = h('section', { class: 'wk-card' }, h('div', { class: 'home2-head' }, h('h2', null, 'Неделя'), open), h('div', { class: 'wk-row' }, cells));
  const paint = map => days.forEach((iso, i) => {
    const hb = map.get(iso);
    if (!hb || !hb.total) return;
    const frac = Math.min(1, hb.done / hb.total);
    cells[i].style.setProperty('--hb', String(frac));
    cells[i].classList.add('hb');
    if (frac >= 1 && !cells[i].classList.contains('full')) { cells[i].classList.add('full'); cells[i].append(h('span', { class: 'cal2-bigcheck wk-check', 'aria-hidden': 'true' }, h('i'))); }
    cells[i].setAttribute('aria-label', `${cells[i].getAttribute('aria-label')}: привычки ${hb.done} из ${hb.total}`);
  });
  const months = [...new Set(days.map(x => x.slice(0, 7)))];
  const known = new Map();
  for (const mk of months) for (const [k, v] of (weekCache.get(mk) || [])) known.set(k, v);
  paint(known);
  Promise.all(months.map(mk => api.calendarSummary(mk).then(r => {
    const mm = new Map(r.days.map(x => [x.date, x.habits || { done: 0, total: 0 }]));
    weekCache.set(mk, mm);
    return mm;
  }))).then(list => { const all = new Map(); list.forEach(mm => mm.forEach((v, k) => all.set(k, v))); paint(all); }).catch(() => {});
  return box;
}
