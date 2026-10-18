// Бонус за вход: каждый день подряд — больше XP, каждый 7-й день — ×2.

import { h, plural } from './dom.js';
import { api } from './api.js';
import { haptic } from './tg.js';
import { store, refreshState } from './store.js';
import { modal, busy, confetti, toastError } from './ui.js';
import { showLevelUp } from './celebrate.js';
import { mascot } from './mascot.js';

let shownFor = null;

/** Показать окно бонуса, если сегодня он ещё не получен. */
export function maybeShowLoginBonus() {
  const st = store.state;
  if (!st || !st.user.onboarded || !st.login || st.login.claimed) return;
  if (shownFor === st.today.date) return;
  shownFor = st.today.date;
  openLoginBonus(st.login);
}

function track(login) {
  const nm = login.next_mascot;
  return h('div', { class: 'login-track' }, login.track.map(t => {
    const pet = nm && t.day === nm.day && t.state !== 'done';
    return h('div', { class: `login-day ${t.state} ${t.day % 7 === 0 ? 'big' : ''}` },
      h('span', { class: 'login-day-n' }, `${t.day}`),
      pet ? h('span', { class: 'login-pet' }, mascot(nm.id, 'wink', { size: 26 })) : h('b', null, t.state === 'done' ? '✓' : `+${t.xp}`),
      t.day % 7 === 0 ? h('span', { class: 'login-x2' }, pet ? '🐾' : '×2') : null);
  }));
}

function mascotLine(login) {
  const nm = login.next_mascot;
  if (!nm) return null;
  return h('p', { class: 'login-mascot-hint' }, nm.in_days <= 0 ? `Сегодня откроется «${nm.name}»!`
    : `Через ${nm.in_days} ${plural(nm.in_days, 'день', 'дня', 'дней')} входа подряд откроется маскот «${nm.name}» 🐾`);
}

export function openLoginBonus(login) {
  const day = login.day;
  const title = h('h2', null, day === 1 ? 'Бонус за вход!' : `${day} ${plural(day, 'день', 'дня', 'дней')} подряд! 🔥`);
  const text = h('p', { class: 'bold muted' }, day === 1
    ? 'Заходи каждый день — награда растёт, а 7-й день даёт двойной бонус.'
    : 'Ты заходишь каждый день — награда растёт. Пропустишь день — серия начнётся заново.');
  const trackHost = h('div', { class: 'stack-sm', style: { width: '100%' } }, track(login), mascotLine(login));
  const fire = h('div', { class: 'login-fire', 'aria-hidden': 'true' }, '🔥');
  const btn = h('button', { type: 'button', class: 'btn block' }, `Забрать +${login.xp} XP`);
  const m = modal(h('div', { class: 'stack center login-modal' },
    fire, title, trackHost, text, btn), { label: 'Бонус за вход' });
  let done = false, levelUp = null;
  btn.addEventListener('click', busy(btn, async () => {
    if (done) { m.close(); if (levelUp) await showLevelUp(levelUp); return; }
    try {
      const res = await api.claimLogin();
      done = true;
      if (res.claimed) {
        haptic.success();
        confetti(day % 7 === 0 ? 160 : 60);
        trackHost.replaceChildren(track(res.login), mascotLine(res.login));
        text.textContent = `+${res.xp} XP получено! Завтра — +${res.login.next_xp} XP.`;
        if (res.mascot) {
          fire.replaceChildren(mascot(res.mascot.id, 'love', { size: 96, cls: 'jump' }));
          title.textContent = `Новый маскот — «${res.mascot.name}»!`;
          text.textContent = `7 дней подряд — и +${res.xp} XP! Выбери маскота в Профиле.`;
        }
        levelUp = res.level_up;
      }
      btn.textContent = 'Отлично!';
      refreshState().catch(() => {});
    } catch (e) { toastError(e); m.close(); }
  }));
  return m;
}
