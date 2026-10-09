// Реакции на успехи: +XP, новый уровень, новые ачивки — по очереди.

import { h } from './dom.js';
import { haptic } from './tg.js';
import { mascot, MASCOT_KINDS } from './mascot.js';
import { toast, modal, confetti } from './ui.js';

function closeBtn(text, m) {
  const b = h('button', { type: 'button', class: 'btn block', style: { marginTop: '18px' } }, text);
  b.addEventListener('click', () => { haptic.tap(); m.close(); });
  return b;
}

export async function showLevelUp(level) {
  haptic.success();
  confetti(160);
  const body = h('div', null,
    mascot('star', 'love', { size: 110, cls: 'jump' }),
    h('p', { class: 'small bold muted', style: { marginTop: '8px' } }, 'НОВЫЙ УРОВЕНЬ'),
    h('h1', { style: { margin: '6px 0 4px', color: 'var(--accent-deep)' } }, `${level.level}`),
    h('h2', null, level.name),
    h('p', { class: 'muted', style: { marginTop: '10px', fontWeight: 700 } }, 'Загляни в профиль — там могли открыться новый котик или цвет.'));
  const m = modal(body, { label: 'Новый уровень' });
  body.append(closeBtn('Ура! 🎉', m));
  await m.done;
}

export async function showAchievement(a) {
  haptic.success();
  confetti(110);
  const kind = MASCOT_KINDS[Math.abs([...a.code].reduce((s, c) => s + c.charCodeAt(0), 0)) % MASCOT_KINDS.length];
  const body = h('div', null,
    h('p', { class: 'small bold', style: { color: 'var(--pink-deep)' } }, 'НОВАЯ АЧИВКА!'),
    h('div', { class: `badge-big c-${a.color}`, 'aria-hidden': 'true' }, a.icon),
    h('h2', { style: { marginTop: '12px' } }, a.title),
    h('p', { class: 'muted', style: { marginTop: '6px', fontWeight: 700 } }, a.how),
    h('div', { style: { marginTop: '10px' } }, mascot(kind, 'love', { size: 64, cls: 'jump' })));
  const m = modal(body, { label: 'Новая ачивка' });
  body.append(closeBtn('Забрать', m));
  await m.done;
}

/** Показывает всё, что вернул сервер после действия. */
export async function celebrate(result, { xpText } = {}) {
  if (!result) return;
  if (result.xp) {
    const parts = (result.breakdown || []).filter(p => p.label !== 'Задание').map(p => `${p.label} +${p.xp}`);
    toast(`${xpText || 'Засчитано!'} +${result.xp} XP${parts.length ? ` · ${parts.join(' · ')}` : ''}`, 'good', 3200);
  }
  if (result.used_freeze) toast('❄️ Заморозка спасла твою серию!', '', 3000);
  if (result.level_up) await showLevelUp(result.level_up);
  for (const a of result.new_achievements || []) await showAchievement(a);
}
