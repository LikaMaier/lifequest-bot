// «Позови подругу» — один раз, сразу после первой галочки (привычка, дело
// или квест), если у человека ещё нет друзей. Флаг хранится на сервере.

import { h } from './dom.js';
import { haptic } from './tg.js';
import { api } from './api.js';
import { store } from './store.js';
import { myMascot } from './mascot.js';
import { sheet } from './ui.js';

const SHARE_TEXT = 'Я отмечаю привычки в LifeQuest — тут котик радуется каждой галочке 🐱 '
  + 'Давай вместе? Вызовем друг друга на дуэль ⚔️ По ссылке нам обоим по заморозке серии 🧊';

let shown = false;

export function maybeInviteNudge(delay = 1400) {
  const state = store.state;
  if (shown || !state || !state.invite_nudge || !state.bot_username) return;
  shown = true;
  state.invite_nudge = false;
  api.inviteNudgeSeen().catch(() => {});
  setTimeout(() => openInviteNudge(state), delay);
}

function openInviteNudge(state) {
  const call = h('button', { type: 'button', class: 'btn block inv-nudge-go' }, '💌 Позвать подругу');
  const later = h('button', { type: 'button', class: 'btn block ghost', style: { marginTop: '8px' } }, 'Потом');
  const body = h('div', { class: 'inv-nudge' },
    h('div', { class: 'inv-nudge-pet' }, myMascot('love', { size: 96, cls: 'jump' }),
      h('span', { class: 'inv-nudge-spark s1', 'aria-hidden': 'true' }, '✨'),
      h('span', { class: 'inv-nudge-spark s2', 'aria-hidden': 'true' }, '💜')),
    h('h2', null, 'Первая галочка! 🎉'),
    h('p', { class: 'inv-nudge-lead' }, 'Вдвоём держаться намного легче. Позови подругу — вызовете друг друга на дуэль, и котик будет болеть за вас обеих.'),
    h('div', { class: 'inv-nudge-gifts' },
      h('span', null, '🧊 заморозка серии — каждой'),
      h('span', null, '⚔️ дуэль на 7 дней'),
      h('span', null, '🎩 шапочка за победу')),
    call, later);
  const s = sheet(body, { label: 'Позвать подругу' });
  call.addEventListener('click', async () => {
    haptic.success();
    const { shareInvite } = await import('./screens/friends.js');
    shareInvite(state, null, SHARE_TEXT);
    s.close();
  });
  later.addEventListener('click', () => { haptic.tap(); s.close(); });
}
