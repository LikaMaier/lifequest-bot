// Задания: рулетка случайного задания, карточка, принять / готово / отказаться.

import { h, clear, plural } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { store, refreshState } from './store.js';
import { celebrate } from './celebrate.js';
import {
  MODE_INFO, SPHERE_INFO, TIER_LABEL, colorOf, sheet, toast, toastError, busy, ICONS, confetti,
} from './ui.js';

const SPIN_EMOJI = ['🎯', '💞', '👥', '🎲', '🗺️', '🎭', '🧭', '🎨', '🦁', '✨', '🔋', '📚'];
const wait = ms => new Promise(r => setTimeout(r, ms));
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function questTags(q) {
  const mode = MODE_INFO[q.mode];
  return h('div', { class: 'row-wrap' },
    mode ? h('span', { class: `tag c-${mode.color}` }, `${mode.emoji} ${mode.label}`) : null,
    q.sphere ? h('span', { class: `tag outline c-${SPHERE_INFO[q.sphere].color}` }, q.sphere) : null,
    q.tier && q.mode === 'solo' && q.tiers && q.tiers.length > 1 ? h('span', { class: 'tag outline c-yellow' }, TIER_LABEL[q.tier]) : null,
    q.daily ? h('span', { class: 'tag c-yellow' }, '☀️ Задание дня') : null);
}

export function questCard(q, { flip = false } = {}) {
  return h('article', { class: `quest-card c-${colorOf(q)} ${flip ? 'flip-in' : ''}` },
    h('div', { class: 'spread' }, h('div', { class: 'qc-emoji', 'aria-hidden': 'true' }, q.emoji || '✨'), questTags(q)),
    h('h2', { class: 'qc-title' }, q.title),
    h('p', { class: 'qc-text' }, q.text),
    q.why ? h('div', { class: 'qc-box' }, h('b', null, 'Зачем это'), h('p', null, q.why)) : null,
    q.outcome ? h('div', { class: 'qc-box' }, h('b', null, 'Что может произойти'), h('p', null, q.outcome)) : null);
}

export function questItem(q, onClick, trailing) {
  const meta = [MODE_INFO[q.mode] ? MODE_INFO[q.mode].label : null, q.sphere].filter(Boolean).join(' · ');
  const item = h('div', { class: `quest-item c-${colorOf(q)}` },
    h('div', { class: 'q-emoji', 'aria-hidden': 'true' }, q.emoji || '📌'),
    h('div', { class: 'grow' }, h('div', { class: 'q-title' }, q.title), meta ? h('div', { class: 'q-meta' }, meta) : null),
    trailing || null);
  if (onClick) {
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.addEventListener('click', e => { if (!e.target.closest('button')) { haptic.tap(); onClick(); } });
    item.addEventListener('keydown', e => { if (e.key === 'Enter') onClick(); });
  }
  return item;
}

function favButton(q) {
  let on = Boolean(q.favorite) || (store.state && store.state.favorites.some(f => f.id === q.id));
  const b = h('button', { type: 'button', class: `icon-btn ${on ? 'on' : ''}`, 'aria-pressed': String(on),
    'aria-label': on ? 'Убрать из избранного' : 'В избранное', html: on ? ICONS.heartFill : ICONS.heart });
  b.addEventListener('click', busy(b, async () => {
    haptic.tap();
    try {
      const res = await api.favorite(q.id, !on);
      on = !on;
      b.classList.toggle('on', on);
      b.innerHTML = on ? ICONS.heartFill : ICONS.heart;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Убрать из избранного' : 'В избранное');
      toast(on ? '💛 Сохранено в избранное' : 'Убрано из избранного');
      refreshState().catch(() => {});
      await celebrate(res);
    } catch (e) { toastError(e); }
  }));
  return b;
}

async function accept(q, { daily = false } = {}) {
  const res = await api.accept(q.id, q.tier, daily);
  haptic.success();
  toast(res.already ? 'Это задание уже в твоих квестах' : '✅ Вызов принят! Задание в разделе «Квесты»', 'good');
  await refreshState();
  await celebrate(res);
  return res;
}

export async function completeQuest(activeId) {
  try {
    const res = await api.complete(activeId);
    haptic.success();
    confetti(70);
    await refreshState();
    await celebrate(res, { xpText: '🎉 Засчитано!' });
    return res;
  } catch (e) {
    toastError(e);
    if (e.status === 404) refreshState().catch(() => {});
    return null;
  }
}

async function skipQuest(activeId) {
  try {
    await api.skip(activeId);
    haptic.warning();
    toast('Задание убрано. Найдём другое?');
    await refreshState();
  } catch (e) { toastError(e); }
}

function actionsRow(...buttons) {
  return h('div', { class: 'row', style: { marginTop: '18px', alignItems: 'flex-start' } }, ...buttons);
}

/** Рулетка: крутится 0.6–1 с, параллельно идёт запрос. */
export function openRandom(mode, sphere = null) {
  const s = sheet(h('div'), { label: `Задание: ${MODE_INFO[mode].label}` });
  const spin = async () => {
    haptic.tap('medium');
    const emojiEl = h('div', { class: 'spin-emoji', 'aria-hidden': 'true' }, MODE_INFO[mode].emoji);
    s.setContent(h('div', { class: 'roulette' }, h('div', { class: 'center' }, emojiEl,
      h('p', { class: 'bold muted', style: { marginTop: '14px' }, role: 'status' }, 'Выбираю задание…'))));
    let i = 0;
    const timer = setInterval(() => { emojiEl.textContent = SPIN_EMOJI[i++ % SPIN_EMOJI.length]; haptic.select(); }, 110);
    try {
      const [res] = await Promise.all([api.random(mode, sphere), wait(reduceMotion() ? 0 : 800)]);
      clearInterval(timer);
      showOffer(res.quest);
      celebrate(res);
    } catch (e) {
      clearInterval(timer);
      haptic.error();
      const retry = h('button', { type: 'button', class: 'btn ghost' }, 'Закрыть');
      retry.addEventListener('click', () => s.close());
      s.setContent(h('div', { class: 'empty' }, h('p', null, e.message), retry));
    }
  };
  const showOffer = q => {
    const acceptBtn = h('button', { type: 'button', class: 'btn grow' }, 'Принять вызов');
    acceptBtn.addEventListener('click', busy(acceptBtn, async () => {
      try { await accept(q); s.close(); } catch (e) { toastError(e); }
    }));
    const other = h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'Другое задание' },
      h('span', { html: ICONS.reroll, style: { width: '20px', height: '20px', display: 'inline-flex' } }), 'Другое');
    other.addEventListener('click', () => spin());
    s.setContent(h('div', null,
      questCard(q, { flip: true }),
      actionsRow(acceptBtn, favButton(q)),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, other),
      h('p', { class: 'center tiny muted bold', style: { marginTop: '6px' } },
        `Осталось ${q.rolls_left} ${plural(q.rolls_left, 'попытка', 'попытки', 'попыток')} на сегодня`)));
  };
  spin();
  return s;
}

/** Карточка уже известного задания: активного (Готово/Отказаться) или нового. */
export function openQuest(q, { daily = false } = {}) {
  const s = sheet(h('div'), { label: q.title });
  const body = h('div', null, questCard(q, { flip: false }));
  if (q.active_id) {
    const done = h('button', { type: 'button', class: 'btn grow' }, '✅ Готово!');
    done.addEventListener('click', busy(done, async () => { const r = await completeQuest(q.active_id); if (r) s.close(); }));
    const skip = h('button', { type: 'button', class: 'btn ghost small' }, 'Отказаться');
    skip.addEventListener('click', busy(skip, async () => { await skipQuest(q.active_id); s.close(); }));
    body.append(actionsRow(done, favButton(q)), h('div', { class: 'row', style: { justifyContent: 'center' } }, skip));
  } else {
    const acc = h('button', { type: 'button', class: 'btn grow' }, daily ? `Принять · +${q.bonus_xp || 15} XP бонус` : 'Принять вызов');
    acc.addEventListener('click', busy(acc, async () => {
      try { await accept(q, { daily }); s.close(); } catch (e) { toastError(e); }
    }));
    body.append(actionsRow(acc, favButton(q)));
  }
  s.setContent(body);
  return s;
}

/** Блок из трёх больших кнопок режимов. getSphere — выбранная сфера для «Для себя». */
export function modeButtons(getSphere = () => null) {
  return h('div', { class: 'quest-modes' },
    ['solo', 'pair', 'company'].map(mode => {
      const info = MODE_INFO[mode];
      const b = h('button', { type: 'button', class: `mode-btn c-${info.color}`, 'aria-label': `Случайное задание: ${info.label}` },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, info.emoji), info.label, h('span', { class: 'sub' }, info.sub));
      b.addEventListener('click', () => openRandom(mode, mode === 'solo' ? getSphere() : null));
      return b;
    }));
}

export function sphereChips(selected, onChange, { withAll = true } = {}) {
  const spheres = (store.state && store.state.spheres) || Object.keys(SPHERE_INFO);
  const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': 'Сфера' });
  const draw = () => {
    clear(wrap);
    const opts = withAll ? [null, ...spheres] : spheres;
    for (const sp of opts) {
      const color = sp ? SPHERE_INFO[sp].color : 'yellow';
      const b = h('button', { type: 'button', class: `chip c-${color}`, 'aria-pressed': String(selected === sp) },
        sp ? `${SPHERE_INFO[sp].emoji} ${sp}` : '✨ Любая');
      b.addEventListener('click', () => { haptic.select(); selected = sp; draw(); onChange(sp); });
      wrap.append(b);
    }
  };
  draw();
  return wrap;
}
