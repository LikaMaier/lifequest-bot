// Магазин: XP тратится на заморозки серии и аксессуары для маскота.
// Уровень от покупок не падает — он считается по всему заработанному XP.

import { h, clear } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { mascot, mascotSVG } from '../mascot.js';
import { skeleton, sectionTitle, toast, toastError, modal, confetti } from '../ui.js';
import { setState } from '../store.js';

let cache = null;
let preview = undefined; // аксессуар, который сейчас примеряем (undefined — надетый)

export async function render(el, ctx) {
  cache = null; // при входе — свежий баланс
  preview = undefined;
  return redraw(el, ctx);
}

// После изменения состояния (покупка, XP) — перерисовка без лишнего запроса.
export function update(el, ctx) {
  return redraw(el, ctx);
}

async function redraw(el, ctx) {
  clear(el);
  const body = h('div');
  el.append(body);
  if (!cache) {
    body.append(skeleton(200), h('div', { style: { height: '14px' } }), skeleton(260));
    try { cache = await api.shop(); } catch (e) {
      clear(body).append(h('p', { class: 'muted bold' }, e.message));
      return;
    }
  }
  clear(body);
  draw(body, el, ctx);
}

function draw(body, el, ctx) {
  const u = ctx.state.user;
  const shop = cache;
  const worn = preview === undefined ? shop.accessory : preview;
  const freeze = shop.items.find(i => i.kind === 'freeze');

  // Витрина: маскот в примеряемом аксессуаре и баланс
  body.append(h('section', { class: 'card tinted c-pink center' },
    mascot(u.mascot, 'happy', { size: 110, acc: worn, label: 'Твой маскот', cls: 'jump' }),
    h('h1', { style: { marginTop: '6px' } }, 'Магазин'),
    h('div', { class: 'shop-balance num' }, `${shop.balance} XP`),
    h('p', { class: 'tiny bold', style: { color: 'var(--pink-deep)', marginTop: '2px' } },
      'можно потратить · уровень от покупок не падает')));

  // Заморозки
  const full = freeze.count >= freeze.max;
  const freezeBtn = h('button', { type: 'button', class: 'btn', disabled: full || shop.balance < freeze.price },
    full ? 'Морозилка полна' : `Купить за ${freeze.price} XP`);
  freezeBtn.addEventListener('click', () => confirmBuy(freeze, el, ctx));
  body.append(sectionTitle('Защита серии'), h('section', { class: 'card shop-freeze' },
    h('div', { class: 'row', style: { gap: '12px', alignItems: 'flex-start' } },
      h('div', { class: 'shop-ice', 'aria-hidden': 'true' }, '🧊'),
      h('div', { class: 'grow' },
        h('div', { class: 'bold' }, freeze.name),
        h('p', { class: 'small muted bold', style: { marginTop: '2px' } }, freeze.about),
        h('div', { class: 'shop-tokens', 'aria-label': `В запасе ${freeze.count} из ${freeze.max}` },
          Array.from({ length: freeze.max }, (_, i) => h('span', { class: i < freeze.count ? 'on' : '' }, '❄️'))))),
    h('div', { style: { marginTop: '10px' } }, freezeBtn)));

  // Аксессуары
  const grid = h('div', { class: 'shop-grid' }, shop.items.filter(i => i.kind === 'accessory').map(item => {
    const state = item.equipped ? 'Снять' : item.owned ? 'Надеть' : `${item.price} XP`;
    const card = h('div', { class: `shop-item ${item.equipped ? 'on' : ''} ${worn === item.id ? 'trying' : ''}` },
      h('button', { type: 'button', class: 'shop-try', 'aria-label': `Примерить: ${item.name}` },
        h('span', { class: 'shop-img', html: mascotSVG(u.mascot, 'happy', item.id) }),
        h('span', { class: 'bold small' }, item.name)),
      h('button', { type: 'button', class: `btn small ${item.owned ? 'ghost' : ''}`,
        disabled: !item.owned && shop.balance < item.price }, state));
    const [tryBtn, actBtn] = card.querySelectorAll('button');
    tryBtn.addEventListener('click', () => { haptic.select(); preview = item.id; redraw(el, ctx); });
    actBtn.addEventListener('click', async () => {
      if (!item.owned) return confirmBuy(item, el, ctx);
      try {
        const res = await api.equip(item.equipped ? null : item.id);
        haptic.success();
        apply(res, el, ctx);
        toast(item.equipped ? 'Снято' : `${item.name} — к лицу! ✨`, 'good', 1500);
      } catch (e) { toastError(e); }
    });
    return card;
  }));
  body.append(sectionTitle('Аксессуары для маскота'),
    h('p', { class: 'tiny muted bold', style: { margin: '-4px 4px 10px' } }, 'Нажми на картинку, чтобы примерить'), grid);
}

function apply(res, el, ctx) {
  cache = res.shop;
  preview = undefined;
  setState(res.state); // перерисует магазин, главный экран и профиль покажут обновку
}

async function confirmBuy(item, el, ctx) {
  haptic.tap();
  const yes = h('button', { type: 'button', class: 'btn block' }, `Купить за ${item.price} XP`);
  const no = h('button', { type: 'button', class: 'btn block ghost', style: { marginTop: '8px' } }, 'Подумаю');
  const art = item.kind === 'freeze' ? h('div', { style: { fontSize: '64px' }, 'aria-hidden': 'true' }, '🧊')
    : mascot(ctx.state.user.mascot, 'love', { size: 110, acc: item.id });
  const m = modal(h('div', null, art,
    h('h2', { style: { marginTop: '8px' } }, item.name),
    h('p', { class: 'muted bold', style: { margin: '6px 0 14px' } },
      `Останется ${cache.balance - item.price} XP. Уровень не изменится.`), yes, no), { label: `Купить ${item.name}` });
  no.addEventListener('click', () => m.close());
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    try {
      const res = await api.buy(item.id);
      m.close();
      haptic.success();
      confetti(90);
      toast(item.kind === 'freeze' ? '🧊 Заморозка в запасе — серия под защитой' : `${item.name} уже на маскоте! ✨`, 'good', 2400);
      apply(res, el, ctx);
    } catch (e) { yes.disabled = false; toastError(e); }
  });
}
