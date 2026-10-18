// ④ Прогресс: период, столбики/линия по дням, сферы и форматы, тепловая
// карта месяца, рекорды и лента выполненных заданий.

import { h, clear, plural, fmtDay } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { myMascot } from '../mascot.js';
import { skeleton, sectionTitle, emptyState, busy, toast, toastError, SPHERE_INFO, MODE_INFO, colorOf } from '../ui.js';
import { buildRecapCard } from '../share.js';
import { openSphereManager } from '../sphereui.js';
const RANGE_WORD = { 1: 'сегодня', 7: 'неделя', 30: 'месяц', all: 'всё время' };
import { handlePremiumError } from '../premium.js';
import { hbars, jarChart, ACTIVITY_COLORS, ACTIVITY_LABELS } from '../charts.js';
import { openPhotoReport } from '../photoui.js';

const view = { range: '7', kind: 'bar', stats: {} };
const RANGES = [['1', 'День'], ['7', 'Неделя'], ['30', 'Месяц'], ['all', 'Всё время']];

export async function render(el, ctx) {
  clear(el);
  el.append(h('header', { class: 'page-head' }, myMascot('happy', { size: 56 }),
    h('div', null, h('h1', null, 'Прогресс'), h('p', null, 'Следи за своими приключениями и находи закономерности'))));
  // Хаб: всё про награды и достижения в одном месте
  const tile = (emoji, title, sub, color, route) => {
    const b = h('button', { type: 'button', class: `hub-tile c-${color}` }, h('span', { class: 'hub-emoji', 'aria-hidden': 'true' }, emoji),
      h('b', null, title), h('span', null, sub));
    b.addEventListener('click', () => { haptic.tap(); ctx.go(route); });
    return b;
  };
  const st = ctx.state;
  el.append(h('div', { class: 'hub-grid' },
    tile('🏆', 'Награды', `${st.badges.unlocked} из ${st.badges.total} ачивок`, 'yellow', 'awards'),
    tile('🛍️', 'Магазин', `${st.user.balance} XP на счету`, 'lime', 'shop'),
    tile('🎯', 'Цели месяца', 'бинго из 9 целей', 'lav', 'board')));
  // Альбом — на всю ширину, заметно
  const album = h('button', { type: 'button', class: 'hub-album' },
    h('span', { class: 'hub-album-pics', 'aria-hidden': 'true' },
      h('span', { class: 'pic p1' }, '🌅'), h('span', { class: 'pic p2' }, '🌸'), h('span', { class: 'pic p3' }, '📷')),
    h('span', { class: 'grow' }, h('b', null, 'Альбом воспоминаний'),
      h('span', null, st.photos.enabled ? (st.photos.count ? `${st.photos.count} фото — листай свои полароиды` : 'Добавь первое фото дня') : 'Скоро здесь будут фото')),
    h('span', { class: 'hub-album-go', 'aria-hidden': 'true' }, '›'));
  album.addEventListener('click', () => { haptic.tap(); ctx.go('album'); });
  el.append(album);

  const recapBtn = (period, label) => {
    const b = h('button', { type: 'button', class: `btn small ${period === 'year' ? 'colored c-purple' : 'ghost'}` }, label);
    b.addEventListener('click', busy(b, async () => {
      try {
        const r = await api.recap(period);
        const image = await buildRecapCard(r, ctx.state);
        await api.share(image);
        haptic.success();
        toast('📬 Карточка уже в чате с ботом — выкладывай в сторис!', 'good', 3600);
      } catch (e) { if (!handlePremiumError(e)) toastError(e); }
    }));
    return b;
  };
  el.append(h('div', { class: 'row', style: { gap: '8px', marginBottom: '14px' } },
    recapBtn('month', '📸 Карточка месяца'),
    recapBtn('year', `🏆 Итоги года${ctx.state.user.is_premium ? '' : ' 🔒'}`)));

  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Период' },
    RANGES.map(([key, label]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(view.range === key) }, label);
      b.addEventListener('click', () => { haptic.select(); view.range = key; render(el, ctx); });
      return b;
    }));
  const body = h('div');
  el.append(seg, body);

  let stats = view.stats[view.range];
  if (!stats) {
    body.append(h('div', { style: { height: '14px' } }), skeleton(220), h('div', { style: { height: '14px' } }), skeleton(180));
    try {
      stats = view.stats[view.range] = await api.stats(view.range);
    } catch (e) {
      clear(body);
      const retry = h('button', { type: 'button', class: 'btn' }, 'Повторить');
      retry.addEventListener('click', () => render(el, ctx));
      body.append(h('div', { class: 'empty' }, myMascot('sad', { size: 84 }), h('p', null, e.message), retry));
      return;
    }
  }
  clear(body);
  draw(body, stats, { ...ctx, el });
}

export function update(el, ctx) {
  view.stats = {}; // данные изменились — перезапросим
  render(el, ctx);
}

function draw(body, s, ctx) {
  const r = s.records;
  // Итоги периода: привычки, дела, квесты, XP — и сравнение с прошлым периодом
  if (s.activity) body.append(activityCard(s.activity));

  // Рекорды
  const fav = r.favorite_sphere;
  const favSp = fav ? (s.spheres.find(x => x.key === fav) || { color: (SPHERE_INFO[fav] || {}).color || 'lav', emoji: (SPHERE_INFO[fav] || {}).emoji || '⭐', name: fav }) : null;
  body.append(sectionTitle('Рекорды'), h('div', { class: 'metrics' },
    metric('orange', 'Лучшая серия', r.best_streak, plural(r.best_streak, 'день', 'дня', 'дней'), '🔥'),
    metric('lime', 'Всего заданий', r.total, `${r.xp} XP всего`, '🏆'),
    metric('blue', 'Лучшая неделя', r.best_week ? r.best_week.count : 0, r.best_week ? weekLabel(r.best_week.week) : 'ещё впереди', null),
    metric(favSp ? favSp.color : 'lav', 'Любимая сфера', favSp ? favSp.emoji : '—', favSp ? favSp.name : 'пока не ясно', null, true)));

  // Сферы и форматы
  const spheres = s.spheres.map(x => ({ label: x.name || x.sphere, value: x.count,
    tag: h('span', { class: `tag c-${x.color || 'lav'}` }, `${x.emoji || '⭐'} ${x.name || x.sphere}`) }));
  const tune = h('button', { type: 'button', class: 'link' }, 'Настроить');
  tune.addEventListener('click', () => { haptic.tap(); openSphereManager({ onChange: () => { view.stats = {}; render(ctx.el, ctx); } }); });
  const modes = s.modes.map(x => ({ label: MODE_INFO[x.mode].label, value: x.count,
    tag: h('span', { class: `tag c-${MODE_INFO[x.mode].color}` }, `${MODE_INFO[x.mode].emoji} ${MODE_INFO[x.mode].short}`) }));
  body.append(sectionTitle(`Сферы · ${RANGE_WORD[view.range]}`, tune),
    h('section', { class: 'card' }, s.spheres.some(x => x.count) ? hbars(spheres, { label: 'Квесты и привычки по сферам' })
      : h('p', { class: 'muted bold small' }, 'За этот период пока пусто — сферы появятся после квестов «Для себя» и привычек, у которых выбрана сфера.'),
      s.spheres.some(x => x.count) ? h('p', { class: 'tiny muted bold', style: { marginTop: '8px' } }, 'Считаются выполненные квесты и дни, когда привычка со сферой выполнена') : null),
    sectionTitle('Форматы'),
    h('section', { class: 'card' }, hbars(modes, { label: 'Задания по форматам' })));

  // Лента истории
  body.append(sectionTitle('История'));
  if (!s.history.length) {
    body.append(h('div', { class: 'card' }, emptyState('Здесь будет лента твоих приключений. Первое — на Главной!', { kind: 'cat-lime', expr: 'wink' })));
  } else {
    const feed = h('ol', { class: 'feed' });
    let lastDate = null;
    for (const q of s.history.slice(0, 40)) {
      if (q.date !== lastDate) { feed.append(h('li', { class: 'feed-date' }, fmtDay(q.date))); lastDate = q.date; }
      feed.append(h('li', { class: `feed-item c-${colorOf(q)}` },
        h('span', { class: 'feed-dot', 'aria-hidden': 'true' }, q.emoji),
        h('div', { class: 'grow' }, h('div', { class: 'bold' }, q.title),
          h('div', { class: 'tiny muted bold' }, [MODE_INFO[q.mode] ? MODE_INFO[q.mode].label : null, q.sphere].filter(Boolean).join(' · '))),
        q.xp ? h('span', { class: 'tiny bold' }, `+${q.xp} XP`) : null,
        ctx.state.photos.enabled && q.hid ? photoBtn(q) : null));
    }
    body.append(feed);
  }
}

function photoBtn(q) {
  const b = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Фото-отчёт: ${q.title}` }, '📷');
  b.addEventListener('click', () => { haptic.tap(); openPhotoReport(q.hid, `${q.emoji} ${q.title}`); });
  return b;
}

function metric(color, label, value, hint, deco, small = false) {
  return h('div', { class: `metric c-${color}` }, h('span', { class: 'label' }, label),
    h('span', { class: 'value', style: small ? { fontSize: '24px' } : null }, String(value)),
    h('span', { class: 'hint' }, hint), deco ? h('span', { class: 'deco', 'aria-hidden': 'true' }, deco) : null);
}

function weekLabel(key) {
  // '2026-W41' → понедельник этой недели
  const [y, w] = key.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
  const iso = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  return `с ${fmtDay(iso)}`;
}

const PREV_WORD = { 1: 'вчера', 7: 'прошлой неделей', 30: 'прошлым месяцем' };
const PERIOD_TITLE = { 1: 'Итоги дня', 7: 'Итоги недели', 30: 'Итоги месяца', all: 'Итоги за всё время' };

function activityCard(a) {
  const t = a.totals, p = a.prev;
  const tile = (key, emoji, value, name, color) => {
    let delta = null;
    if (p) {
      const d = value - p[key];
      delta = h('span', { class: `act-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}` }, d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${-d}` : '=');
    }
    return h('div', { class: 'act-tile', style: { '--c': color } },
      h('span', { class: 'act-emoji', 'aria-hidden': 'true' }, emoji),
      h('b', null, String(value)), h('span', { class: 'act-name' }, name), delta);
  };
  const empty = !t.habits && !t.plans && !t.quests;
  const total = t.habits + t.plans + t.quests;
  const spell = empty ? 'Магия ждёт первого шага — отметь что-нибудь, и здесь заискрится ✨'
    : total >= 30 ? 'Настоящая магия — звёзды в восторге! 🌟'
    : total >= 12 ? 'Чары работают: каждый шаг добавляет искорку ✨'
    : 'Первые искры уже летят — продолжай колдовать 🪄';
  const sparkles = h('div', { class: 'act-magic', 'aria-hidden': 'true' },
    ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map(k => h('i', { class: `act-spark ${k}` })));
  const card = h('section', { class: 'card act-card', style: { marginTop: '14px' } }, sparkles,
    h('div', { class: 'act-head' },
      h('span', { class: 'act-wand', 'aria-hidden': 'true' }, '🪄'),
      h('div', { class: 'grow' },
        h('h2', null, PERIOD_TITLE[view.range] || 'Итоги'),
        h('p', { class: 'act-spell' }, spell)),
      a.days > 1 ? h('span', { class: 'act-days' }, h('b', null, String(t.active_days)), `из ${a.days}`, h('small', null, 'дней')) : null),
    h('div', { class: 'act-tiles' },
      tile('habits', '🌱', t.habits, plural(t.habits, 'привычка', 'привычки', 'привычек'), ACTIVITY_COLORS.habits),
      tile('plans', '📅', t.plans, plural(t.plans, 'дело', 'дела', 'дел'), ACTIVITY_COLORS.plans),
      tile('quests', '🎯', t.quests, plural(t.quests, 'квест', 'квеста', 'квестов'), ACTIVITY_COLORS.quests),
      tile('xp', '⭐', t.xp, 'XP', '#E0B300')),
    p ? h('p', { class: 'act-note' }, `Стрелки — сравнение с ${PREV_WORD[view.range]}`) : null);
  if (empty) {
    card.append(h('p', { class: 'act-empty' }, 'Пока пусто — отметь привычку или дело из календаря, и в банке появится первая конфетка 🍬'));
    return card;
  }
  // Банка: каждое сделанное — конфета цвета своей плашки, XP — золотые звёздочки
  const d = p ? total - (p.habits + p.plans + p.quests) : null;
  card.append(h('div', { class: 'act-chart act-jar' }, jarChart(a.series, { total }),
    h('div', { class: 'act-jar-side' },
      h('b', { class: 'act-jar-num' }, String(total)),
      h('span', { class: 'act-jar-word' }, plural(total, 'конфета', 'конфеты', 'конфет')),
      d !== null ? h('span', { class: `act-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}` }, d > 0 ? `▲ на ${d} больше` : d < 0 ? `▼ на ${-d} меньше` : 'как раньше') : null,
      h('div', { class: 'act-legend col', 'aria-hidden': 'true' },
        [...Object.entries(ACTIVITY_LABELS), ['xp', '20 XP']].map(([k, label]) =>
          h('span', null, h('i', { class: `candy-${k}` }), label))))));
  if (a.best_day && a.days > 1) {
    card.append(h('div', { class: 'act-best' }, h('span', { class: 'act-best-ico', 'aria-hidden': 'true' }, '🏆'),
      h('span', null, 'Лучший день — ', h('b', null, fmtDay(a.best_day.date)), `: сделано ${a.best_day.total} ✨`)));
  }
  return card;
}
