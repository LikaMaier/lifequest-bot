// ⑤ Награды: уровень и лестница уровней с наградами, сетка ачивок
// (полученные — цветные, закрытые — силуэты с подсказкой и прогрессом).

import { h, clear, fmtDay } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { mascot, mascotSVG } from '../mascot.js';
import { skeleton, sectionTitle, progressBar, modal } from '../ui.js';

let cache = null;
const filter = { mode: 'all' };

export async function render(el, ctx) {
  clear(el);
  el.append(h('header', { class: 'page-head' }, mascot('star', 'love', { size: 56 }),
    h('div', null, h('h1', null, 'Награды'), h('p', null, 'Каждое приключение приближает новую ачивку'))));
  const body = h('div');
  el.append(body);
  if (!cache) {
    body.append(skeleton(170), h('div', { style: { height: '14px' } }), skeleton(300));
    try { cache = await api.achievements(); } catch (e) {
      clear(body);
      const retry = h('button', { type: 'button', class: 'btn' }, 'Повторить');
      retry.addEventListener('click', () => render(el, ctx));
      body.append(h('div', { class: 'empty' }, mascot('cat-blue', 'sad', { size: 84 }), h('p', null, e.message), retry));
      return;
    }
  }
  clear(body);
  draw(body, cache, el, ctx);
}

export function update(el, ctx) {
  cache = null;
  render(el, ctx);
}

function draw(body, data, el, ctx) {
  const lv = data.level;
  // Уровень
  body.append(h('section', { class: 'card tinted c-purple' },
    h('div', { class: 'spread' }, h('div', null, h('div', { class: 'small bold', style: { color: 'var(--purple-deep)' } }, `УРОВЕНЬ ${lv.level}`),
      h('h2', { style: { fontSize: '22px', marginTop: '4px' } }, lv.name)),
      h('div', { class: 'level-badge num', 'aria-hidden': 'true' }, String(lv.level))),
    h('div', { style: { margin: '12px 0 6px' } }, progressBar(lv.progress, 'purple')),
    h('div', { class: 'spread small bold' }, h('span', null, `${lv.xp} XP`), h('span', null, `${lv.next} XP — «${lv.next_name}»`))));

  // Лестница уровней с наградами
  const rewardsAt = {};
  for (const m of data.unlocks.mascots) (rewardsAt[m.level] = rewardsAt[m.level] || []).push({ type: 'mascot', ...m });
  const ladder = h('ol', { class: 'ladder', 'aria-label': 'Уровни и награды' },
    data.levels.map(l => {
      const reached = lv.level >= l.level;
      const rewards = (rewardsAt[l.level] || []).map(r => r.type === 'mascot'
        ? h('span', { class: 'ladder-reward', title: `Маскот «${r.name}»`, 'aria-label': `Маскот ${r.name}`, html: mascotSVG(r.id, reached ? 'happy' : 'sleepy') })
        : h('span', { class: `ladder-reward accent-dot c-${r.id}`, title: `Цвет «${r.name}»`, 'aria-label': `Цвет ${r.name}` }));
      return h('li', { class: `ladder-step ${reached ? 'reached' : ''} ${lv.level === l.level ? 'current' : ''}` },
        h('span', { class: 'ladder-num num' }, String(l.level)),
        h('div', { class: 'grow' }, h('div', { class: 'bold' }, l.name), h('div', { class: 'tiny muted bold' }, `${l.xp} XP`)),
        h('div', { class: 'row', style: { gap: '4px' } }, rewards));
    }));
  body.append(sectionTitle('Уровни'), h('div', { class: 'card' }, ladder),
    h('p', { class: 'tiny muted bold', style: { margin: '8px 4px 0' } },
      'XP: задание «полегче» +10, «посложнее» +20, вдвоём +20, компанией +25. Бонусы: «Смелость» +10, в тот же день +5, задание дня +15, серия до +20.'));

  // Ачивки
  const unlocked = data.achievements.filter(a => a.unlocked).length;
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Фильтр ачивок', style: { marginBottom: '12px' } },
    [['all', 'Все'], ['open', 'Открытые'], ['locked', 'Закрытые']].map(([k, label]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(filter.mode === k) }, label);
      b.addEventListener('click', () => { haptic.select(); filter.mode = k; render(el, ctx); });
      return b;
    }));
  const list = data.achievements.filter(a => filter.mode === 'all' || (filter.mode === 'open' ? a.unlocked : !a.unlocked))
    .sort((a, b) => (b.unlocked - a.unlocked) || (b.value / b.target - a.value / a.target));
  const grid = h('div', { class: 'badge-grid' }, list.map(a => {
    const b = h('button', { type: 'button', class: `badge c-${a.color} ${a.unlocked ? 'on' : 'off'}`,
      'aria-label': `${a.title}: ${a.unlocked ? 'получена' : `${a.value} из ${a.target}`}` },
      h('span', { class: 'badge-icon', 'aria-hidden': 'true' }, a.icon),
      h('span', { class: 'badge-title' }, a.title),
      a.unlocked ? h('span', { class: 'badge-sub' }, '✓ получена')
        : h('span', { class: 'badge-sub' }, `${a.value}/${a.target}`),
      a.unlocked ? null : h('span', { class: 'badge-progress', 'aria-hidden': 'true' }, h('span', { style: { width: `${(a.value / a.target) * 100}%` } })));
    b.addEventListener('click', () => { haptic.tap(); details(a); });
    return b;
  }));
  body.append(sectionTitle(`Ачивки · ${unlocked}/${data.achievements.length}`), seg, grid);
}

function details(a) {
  const close = h('button', { type: 'button', class: 'btn block', style: { marginTop: '18px' } }, a.unlocked ? 'Красота!' : 'Понятно, вперёд!');
  const body = h('div', null,
    h('div', { class: `badge-big c-${a.color} ${a.unlocked ? '' : 'locked'}`, 'aria-hidden': 'true' }, a.icon),
    h('h2', { style: { marginTop: '14px' } }, a.title),
    h('p', { class: 'muted bold', style: { marginTop: '6px' } }, a.how),
    a.unlocked ? h('p', { class: 'small bold', style: { marginTop: '10px' } }, `Получена ${fmtDay(a.unlocked_at)}`)
      : h('div', { style: { marginTop: '12px' } }, progressBar(a.value / a.target, a.color),
        h('p', { class: 'small bold', style: { marginTop: '6px' } }, `${a.value} из ${a.target}`)),
    close);
  const m = modal(body, { label: a.title });
  close.addEventListener('click', () => m.close());
}
