// Челленджи: N дней подряд по квесту в день. Активный — с кружками дней,
// остальные — карточки «Начать». Один челлендж за раз.

import { h, clear, plural } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { mascot } from '../mascot.js';
import { sectionTitle, skeleton, toast, toastError, busy, modal } from '../ui.js';
import { refreshState } from '../store.js';
import { openPaywall } from '../premium.js';

let cache = null;

export async function render(el, ctx) {
  cache = null;
  return draw(el, ctx);
}

export function update(el, ctx) {
  cache = null;
  return draw(el, ctx);
}

async function draw(el, ctx) {
  clear(el);
  el.append(h('header', { class: 'page-head' }, mascot(ctx.state.user.mascot, 'happy', { size: 56, acc: ctx.state.user.accessory }),
    h('div', null, h('h1', null, 'Челленджи'), h('p', null, 'Один квест в день — и так несколько дней подряд'))));
  const body = h('div');
  el.append(body);
  if (!cache) {
    body.append(skeleton(160), h('div', { style: { height: '12px' } }), skeleton(240));
    try { cache = await api.challenges(); } catch (e) { clear(body).append(h('p', { class: 'muted bold' }, e.message)); return; }
  }
  clear(body);
  const data = cache;
  if (data.last_result && data.last_result.failed) {
    const f = data.last_result.failed;
    body.append(h('div', { class: 'card tinted c-orange', style: { marginBottom: '14px' } },
      h('div', { class: 'bold' }, `😿 «${f.title}» прервался на ${f.done} из ${f.days}`),
      h('p', { class: 'small bold', style: { marginTop: '4px' } }, 'Бывает. Попробуем ещё раз?')));
  }
  if (data.active) body.append(activeCard(data.active, el, ctx));

  body.append(sectionTitle(data.active ? 'Другие челленджи' : 'Выбери челлендж'));
  body.append(h('div', { class: 'stack-sm' }, data.list.map(c => {
    const isActive = data.active && data.active.id === c.id;
    const btn = h('button', { type: 'button', class: `btn small ${c.locked ? 'colored c-yellow' : ''}`,
      disabled: Boolean(data.active) && !c.locked }, c.locked ? '🔒 Premium' : isActive ? 'Идёт' : 'Начать');
    btn.addEventListener('click', busy(btn, async () => {
      if (c.locked) { openPaywall('challenge'); return; }
      try {
        cache = await api.challengeStart(c.id);
        haptic.success();
        toast(`${c.emoji} Поехали! День 1 из ${c.days}`, 'good', 2200);
        refreshState().catch(() => {});
        draw(el, ctx);
      } catch (e) { toastError(e); }
    }));
    return h('div', { class: `quest-item c-${c.sphere ? 'purple' : 'pink'}` },
      h('div', { class: 'q-emoji', 'aria-hidden': 'true' }, c.emoji),
      h('div', { class: 'grow' }, h('div', { class: 'q-title' }, c.title),
        h('div', { class: 'q-meta' }, `${c.rule} · +${c.xp} XP${c.wins ? ` · пройден ${c.wins}×` : ''}`)),
      btn);
  })));
}

function activeCard(a, el, ctx) {
  const dots = h('div', { class: 'ch-days', role: 'list', 'aria-label': `Прогресс: ${a.done} из ${a.days}` },
    a.day_list.map((d, i) => h('span', { class: `ch-day ${d.state}`, role: 'listitem', 'aria-label': `День ${i + 1}: ${d.state}` },
      d.state === 'done' ? '✓' : String(i + 1))));
  const quit = h('button', { type: 'button', class: 'btn ghost small' }, 'Сдаться');
  quit.addEventListener('click', async () => {
    haptic.warning();
    const yes = h('button', { type: 'button', class: 'btn block' }, 'Да, сдаюсь');
    const no = h('button', { type: 'button', class: 'btn block ghost', style: { marginTop: '8px' } }, 'Нет, продолжаю!');
    const m = modal(h('div', null, h('h2', null, 'Точно сдаться?'),
      h('p', { class: 'muted bold', style: { margin: '6px 0 14px' } }, `Прогресс ${a.done} из ${a.days} не сохранится.`), yes, no));
    no.addEventListener('click', () => m.close());
    yes.addEventListener('click', async () => {
      try { cache = await api.challengeQuit(); m.close(); refreshState().catch(() => {}); draw(el, ctx); } catch (e) { toastError(e); }
    });
  });
  const need = a.sphere ? `квест из сферы «${a.sphere}»` : 'любой квест';
  return h('section', { class: 'card tinted c-lime' },
    h('div', { class: 'spread' }, h('div', { class: 'card-title', style: { margin: 0 } }, `${a.emoji} ${a.title}`),
      h('span', { class: 'tag c-paleyellow' }, `+${a.xp} XP`)),
    h('p', { class: 'small bold', style: { margin: '6px 0 12px' } },
      a.today_done ? `День ${a.day} засчитан ✓ Возвращайся завтра!` : `День ${a.day} из ${a.days}: сегодня нужен ${need}.`),
    dots,
    h('div', { class: 'spread', style: { marginTop: '12px' } },
      h('span', { class: 'tiny bold muted' }, `${a.done} ${plural(a.done, 'день', 'дня', 'дней')} из ${a.days}`), quit));
}
