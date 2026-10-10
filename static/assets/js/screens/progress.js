// ④ Прогресс: период, столбики/линия по дням, сферы и форматы, тепловая
// карта месяца, рекорды и лента выполненных заданий.

import { h, clear, plural, fmtDay, fmtMonth } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { mascot } from '../mascot.js';
import { skeleton, sectionTitle, emptyState, SPHERE_INFO, MODE_INFO, colorOf } from '../ui.js';
import { barChart, lineChart, hbars, heatmap } from '../charts.js';
import { openPhotoReport } from '../photoui.js';

const view = { range: '7', kind: 'bar', stats: {} };
const RANGES = [['7', '7 дн.'], ['14', '14 дн.'], ['30', '30 дн.'], ['all', 'Всё время']];

export async function render(el, ctx) {
  clear(el);
  el.append(h('header', { class: 'page-head' }, mascot('cat-blue', 'happy', { size: 56 }),
    h('div', null, h('h1', null, 'Прогресс'), h('p', null, 'Следи за своими приключениями и находи закономерности'))));
  const awardsBtn = h('button', { type: 'button', class: 'quest-item c-yellow' }, h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, '🏆'),
    h('span', { class: 'grow' }, h('span', { class: 'q-title', style: { display: 'block' } }, 'Награды'),
      h('span', { class: 'q-meta', style: { display: 'block' } }, `${ctx.state.badges.unlocked} из ${ctx.state.badges.total} ачивок · уровень ${ctx.state.level.level}`)));
  awardsBtn.addEventListener('click', () => { haptic.tap(); ctx.go('awards'); });
  const albumBtn = h('button', { type: 'button', class: 'quest-item c-pink' }, h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, '📷'),
    h('span', { class: 'grow' }, h('span', { class: 'q-title', style: { display: 'block' } }, 'Альбом'),
      h('span', { class: 'q-meta', style: { display: 'block' } }, ctx.state.photos.enabled ? `${ctx.state.photos.count} фото-воспоминаний` : 'Фото пока недоступны')));
  albumBtn.addEventListener('click', () => { haptic.tap(); ctx.go('album'); });
  el.append(h('div', { class: 'metrics', style: { marginBottom: '14px' } }, awardsBtn, albumBtn));

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
      body.append(h('div', { class: 'empty' }, mascot('cat-blue', 'sad', { size: 84 }), h('p', null, e.message), retry));
      return;
    }
  }
  clear(body);
  draw(body, stats, ctx);
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
  body.append(sectionTitle('Рекорды'), h('div', { class: 'metrics' },
    metric('orange', 'Лучшая серия', r.best_streak, plural(r.best_streak, 'день', 'дня', 'дней'), '🔥'),
    metric('lime', 'Всего заданий', r.total, `${r.xp} XP всего`, '🏆'),
    metric('blue', 'Лучшая неделя', r.best_week ? r.best_week.count : 0, r.best_week ? weekLabel(r.best_week.week) : 'ещё впереди', null),
    metric(fav ? SPHERE_INFO[fav].color : 'lav', 'Любимая сфера', fav ? SPHERE_INFO[fav].emoji : '—', fav || 'пока не ясно', null, true)));

  // Сферы и форматы
  const spheres = s.spheres.map(x => ({ label: x.sphere, value: x.count,
    tag: h('span', { class: `tag c-${SPHERE_INFO[x.sphere].color}` }, `${SPHERE_INFO[x.sphere].emoji} ${x.sphere}`) }));
  const modes = s.modes.map(x => ({ label: MODE_INFO[x.mode].label, value: x.count,
    tag: h('span', { class: `tag c-${MODE_INFO[x.mode].color}` }, `${MODE_INFO[x.mode].emoji} ${MODE_INFO[x.mode].short}`) }));
  body.append(sectionTitle('Сферы'),
    h('section', { class: 'card' }, s.total_in_range ? hbars(spheres, { label: 'Задания по сферам' })
      : h('p', { class: 'muted bold small' }, 'За этот период пока пусто — сферы появятся после первых заданий «Для себя».')),
    sectionTitle('Форматы'),
    h('section', { class: 'card' }, hbars(modes, { label: 'Задания по форматам' })));

  // Тепловая карта месяца
  body.append(sectionTitle(fmtMonth(s.heatmap[0].date)),
    h('section', { class: 'card' }, heatmap(s.heatmap, { today: ctx.state.today.date })));

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
