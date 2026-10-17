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
import { barChart, lineChart, hbars } from '../charts.js';
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
    tile('🎯', 'Цели месяца', 'бинго из 9 целей', 'lav', 'board'),
    tile('🏅', 'Лига недели', 'соревнуйся с друзьями', 'blue', 'friends'),
    tile('🔥', 'Челленджи', st.challenge ? `${st.challenge.title} · ${st.challenge.done}/${st.challenge.days}` : 'серии на 7–30 дней', 'orange', 'challenges'),
    tile('📷', 'Альбом', st.photos.enabled ? `${st.photos.count} фото` : 'скоро', 'pink', 'album')));

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
  // Главная цифра периода
  const chartHost = h('div', { style: { marginTop: '10px' } });
  const kindSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Вид графика', style: { width: '170px' } },
    [['bar', 'Столбики'], ['line', 'Линия']].map(([k, label]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(view.kind === k) }, label);
      b.addEventListener('click', () => {
        haptic.select(); view.kind = k;
        for (const x of kindSeg.children) x.setAttribute('aria-pressed', String(x === b));
        drawChart();
      });
      return b;
    }));
  const drawChart = () => {
    clear(chartHost);
    chartHost.append(view.kind === 'bar' ? barChart(s.series, { height: 160 }) : lineChart(s.series, { height: 160 }));
  };
  body.append(h('section', { class: 'card', style: { marginTop: '14px' } },
    h('div', { class: 'spread' },
      h('div', null, h('div', { class: 'small bold muted' }, 'ВЫПОЛНЕНО ЗА ПЕРИОД'),
        h('div', { class: 'num', style: { fontSize: '34px' } }, String(s.total_in_range))),
      kindSeg),
    chartHost));
  drawChart();

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
