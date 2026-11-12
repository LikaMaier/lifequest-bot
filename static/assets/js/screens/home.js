// ① Главная — за полтора экрана: квест дня героем (главная фишка), кольца привычек,
// «твой ход» с друзьями одной строкой, маскот строкой (весь Домик — по тапу),
// неделя лентой, план дня; «+» добавляет что угодно.

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { moodFor } from '../mascot.js';
import { busy, toastError } from '../ui.js';
import { buyStars } from '../premium.js';
import { openQuest } from '../questflow.js';
import { habitRing, openTemplatePicker, applyLog, openHabitDetail } from '../habitui.js';
import { planRow } from '../planui.js';
import { openPlus, plusFab } from '../plus.js';
import { refreshState } from '../store.js';
import { chestRow } from '../chest.js';
import { openMonthly } from './monthly.js';
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
  const buildAll = (hs.items || []).filter(x => x.kind === 'build');
  const gridMode = buildAll.length && habitsView() === 'grid';
  // Переключатель вида: кольца на сегодня / сетка недели
  const viewToggle = buildAll.length ? h('div', { class: 'hb2-view', role: 'tablist', 'aria-label': 'Вид привычек' },
    ['rings', 'grid'].map(m => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String((gridMode ? 'grid' : 'rings') === m), 'aria-label': m === 'grid' ? 'Сетка недели' : 'Сегодня',
        html: m === 'grid' ? '<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><rect x="2" y="3" width="7" height="3" rx="1.5"/><rect x="11" y="3" width="7" height="3" rx="1.5"/><rect x="2" y="8.5" width="7" height="3" rx="1.5"/><rect x="11" y="8.5" width="7" height="3" rx="1.5"/><rect x="2" y="14" width="7" height="3" rx="1.5"/><rect x="11" y="14" width="7" height="3" rx="1.5"/></svg>'
          : '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="6" cy="10" r="3.6"/><circle cx="14.5" cy="10" r="3.6"/></svg>' });
      b.addEventListener('click', () => { haptic.select(); setHabitsView(m); rerender(); });
      return b;
    })) : null;
  habitsCard.append(h('div', { class: 'home2-head' }, h('h2', null, gridMode ? 'Эта неделя' : viewToggle ? 'Привычки' : 'Привычки сегодня'),
    hs.total ? h('span', { class: 'home2-count' }, `${hs.done} из ${hs.total}`) : null, viewToggle, habitsLink));
  if (!hs.items || !hs.items.length) {
    const pick = h('button', { type: 'button', class: 'quest-item c-lime' }, h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, '🌱'),
      h('span', { class: 'grow' }, h('span', { class: 'q-title', style: { display: 'block' } }, 'Выбери первые привычки'),
        h('span', { class: 'q-meta', style: { display: 'block' } }, 'Вода, зарядка, чтение — в пару касаний')));
    pick.addEventListener('click', () => { haptic.tap(); openTemplatePicker({ onDone: rerender }); });
    habitsCard.append(pick);
  } else if (gridMode) {
    habitsCard.append(weekGrid(buildAll, state));
    const ch = chestRow(state.chest);
    if (ch) habitsCard.append(ch);
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
  const notesLink = h('button', { type: 'button', class: 'home2-link', style: { marginRight: '10px' } }, '📒 Заметки');
  notesLink.addEventListener('click', () => { haptic.tap(); go('notes', { fresh: true }); });
  el.append(h('div', { class: 'home2-head', style: { marginTop: '18px' } }, h('h2', null, 'План дня'),
    state.plans_today.length ? h('span', { class: 'home2-count' }, String(state.plans_today.length)) : null, notesLink, calLink));
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
  const seenKey = `lq_daily_seen:${state.user.id || state.user.user_id || ''}:${state.today.date}`;
  let seen = Boolean(active || done);
  try { seen = seen || localStorage.getItem(seenKey) === '1'; } catch (e) { /* приватный режим */ }

  const take = h('button', { type: 'button', class: 'dh-btn' }, done ? '✓ Выполнено' : active ? 'Открыть квест' : 'Беру квест');
  take.addEventListener('click', () => { haptic.tap('medium'); openQuest(active || { ...daily, daily: true }, { daily: !active && !done }); });
  const other = h('button', { type: 'button', class: 'dh-other' }, done ? '🎲 Ещё одно задание' : 'не то? подбери другое 🎲');
  other.addEventListener('click', () => { haptic.tap(); go('quests'); });
  const meta = [daily.minutes ? `⏱ ${daily.minutes} мин` : null, daily.sphere_label || daily.sphere ? `${daily.sphere_emoji || '✨'} ${daily.sphere_label || daily.sphere}` : null, `+${daily.bonus_xp} XP`].filter(Boolean);
  const front = h('div', { class: `dh dh-face ${done ? 'done' : ''}`, 'aria-label': 'Квест дня' },
    h('div', { class: 'dh-kicker' }, done ? '🎉 КВЕСТ ДНЯ СДЕЛАН' : '🎲 КВЕСТ ДНЯ'),
    h('div', { class: 'dh-row' }, h('span', { class: 'dh-emoji', 'aria-hidden': 'true' }, daily.emoji), h('h2', { class: 'dh-title' }, daily.title)),
    h('div', { class: 'dh-meta' }, meta.map(m => h('span', null, m))),
    take, other);
  if (seen) return front;

  // Рубашка карты: что внутри — узнаешь, только перевернув
  const back = h('button', { type: 'button', class: 'dh dh-face dh-back', 'aria-label': 'Открыть квест дня' },
    h('div', { class: 'dh-kicker' }, '🎲 КВЕСТ ДНЯ'),
    h('div', { class: 'dh-back-art', 'aria-hidden': 'true' }, h('span', { class: 'dh-q' }, '?'), h('span', { class: 'dh-spark s1' }, '✦'), h('span', { class: 'dh-spark s2' }, '✦'), h('span', { class: 'dh-spark s3' }, '✧')),
    h('div', { class: 'dh-back-hint' }, 'Нажми, чтобы перевернуть карту'),
    h('div', { class: 'dh-meta' }, h('span', null, `+${daily.bonus_xp} XP`), h('span', null, 'новое каждый день')));
  const flip = h('div', { class: 'dh-flip' }, h('div', { class: 'dh-inner' }, back, front));
  back.addEventListener('click', () => {
    haptic.tap('medium');
    flip.classList.add('flipped');
    try { localStorage.setItem(seenKey, '1'); } catch (e) { /* ок */ }
    setTimeout(() => { flip.replaceWith(front); front.classList.remove('dh-face'); }, 700);
  });
  return flip;
}

// ---------- Сетка недели: привычки строками, дни столбцами ----------
const HB_VIEW_KEY = 'lq_home_hb_view';
function habitsView() { try { return localStorage.getItem(HB_VIEW_KEY) || 'rings'; } catch (e) { return 'rings'; } }
function setHabitsView(v) { try { localStorage.setItem(HB_VIEW_KEY, v); } catch (e) { /* ок */ } }

function weekGrid(items, state) {
  const today = state.today.date;
  const days = (items[0] && items[0].week_mon) || [];
  const d0 = days[0] ? Number(days[0].date.slice(8)) : 0, d6 = days[6] ? Number(days[6].date.slice(8)) : 0;
  const m0 = days[0] ? Number(days[0].date.slice(5, 7)) : 1, m6 = days[6] ? Number(days[6].date.slice(5, 7)) : 1;
  const MG = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const range = m0 === m6 ? `${d0}–${d6} ${MG[m0 - 1]}` : `${d0} ${MG[m0 - 1]} – ${d6} ${MG[m6 - 1]}`;
  const head = h('div', { class: 'wg-row wg-head' }, h('span', { class: 'wg-name tiny bold muted' }, range),
    days.map((d, i) => h('span', { class: `wg-d ${d.date === today ? 'today' : ''}` }, h('i', null, WD[i][0]), h('b', null, String(Number(d.date.slice(8)))))));
  const rows = items.map(hb => h('div', { class: `wg-row c-${hb.color}` },
    h('span', { class: 'wg-name' }, h('span', { class: 'wg-emoji', 'aria-hidden': 'true' }, hb.emoji), h('span', { class: 'wg-title' }, hb.title)),
    (hb.week_mon || []).map(d => {
      const isToday = d.date === today;
      const cell = h(isToday ? 'button' : 'span', { type: isToday ? 'button' : null, class: `wg-cell s-${d.state} ${isToday ? 'today' : ''}`,
        title: `${hb.title}: ${d.state === 'done' ? 'сделано' : d.state === 'miss' ? 'пропуск' : d.state === 'skip' ? 'пропущено осознанно' : d.state === 'pause' ? 'пауза' : d.state === 'off' ? 'не по расписанию' : ''}`,
        'aria-label': isToday ? `${hb.title}: ${hb.done_today ? 'выполнено, нажми чтобы снять' : 'отметить сегодня'}` : null });
      if (isToday) cell.addEventListener('click', busy(cell, async () => {
        if (hb.target === 1 || !hb.done_today) await applyLog(hb, { delta: hb.done_today ? -1 : 1 }, () => {});
        else openHabitDetail(hb, { onChanged: () => {} });
      }));
      return cell;
    })));
  return h('div', { class: 'wg', role: 'table', 'aria-label': 'Привычки за неделю' }, head, rows);
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
  for (const c of (state.monthly_nudges || []).slice(0, 2)) {
    out.push(line(c.emoji, `${c.title}: отметь сегодня`, c.kind === 'days' ? 'получилось? нажми и засчитай день' : `сколько ${c.unit[2]} сегодня?`, () => openMonthly(go, c.id)));
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
    // тап по дню — сразу лист этого дня: планы, заметки, фото
    b.addEventListener('click', async () => { haptic.select(); (await import('../planui.js')).openDaySheet(iso, { onChange: () => { weekCache.clear(); refreshState().catch(() => {}); } }); });
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
