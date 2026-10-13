// Premium: окно-предложение (когда упёрлись в лимит или нажали на 🔒),
// пробная неделя и покупка за звёзды (когда оплата включена на сервере).

import { h } from './dom.js';
import { tg, haptic, openTgLink } from './tg.js';
import { api } from './api.js';
import { mascot } from './mascot.js';
import { sheet, toast, toastError, busy, confetti } from './ui.js';
import { store, setState, refreshState } from './store.js';

export const PERKS = [
  ['🎲', 'Безлимит «Другое»', 'Крути задания сколько хочешь'],
  ['📸', 'Больше фото на доске', 'Места для воспоминаний — в разы больше'],
  ['❄️', '+1 заморозка в неделю', 'Серия переживёт даже насыщенную неделю'],
  ['🎩', 'Аксессуары и стиль «Космос»', 'Шляпа волшебника, диадема, треуголка'],
  ['🗂️', 'Наборы квестов', 'Свидания, выходные, путешествия — целиком'],
];

const REASONS = {
  roll_limit: ['🎲', 'Попытки на сегодня закончились', 'С Premium можно крутить задания без ограничений.'],
  photo_limit: ['📸', 'На доске закончилось место', 'С Premium воспоминаний помещается в разы больше.'],
  premium_item: ['🎩', 'Это вещь из Premium', 'Все Premium-аксессуары — сразу и бесплатно.'],
  premium_theme: ['🚀', 'Стиль «Космос» — в Premium', 'Звёзды, планеты и неоновая туманность.'],
  pack: ['🗂️', 'Набор целиком — в Premium', 'Первые квесты набора бесплатные, остальные — с Premium.'],
  freeze: ['🧊', 'Защити серию', 'С Premium — две бесплатные заморозки каждую неделю.'],
};

const premiumInfo = () => (store.state && store.state.premium) || {};

/** Покупка товара за звёзды: счёт открывается прямо в мини-аппе. */
export async function buyStars(product) {
  const res = await api.premiumInvoice(product);
  return new Promise(resolve => {
    const done = async status => {
      if (status === 'paid') {
        haptic.success();
        confetti(120);
        // начисление приходит боту чуть позже оплаты — подождём его
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 800));
          try { await refreshState(); } catch (e) { /* сеть */ }
        }
        toast('💛 Оплата прошла — спасибо!', 'good', 2600);
      } else if (status === 'failed') {
        toast('Оплата не прошла. Попробуй ещё раз.', 'bad');
      }
      resolve(status);
    };
    if (tg && tg.openInvoice) tg.openInvoice(res.link, done);
    else { openTgLink(res.link); resolve('opened'); }
  });
}

export async function startTrial() {
  const state = await api.premiumTrial();
  haptic.success();
  confetti(140);
  setState(state);
  toast(`🎁 Premium на ${state.premium.trial_days} дней включён!`, 'good', 3000);
}

async function wantPremium() {
  haptic.success();
  api.premiumInterest().catch(() => {});
  toast('💛 Записали! Оплата скоро появится — ты узнаешь первым.', 'good', 3200);
}

/** Кнопки действия: пробная неделя → покупка (если оплата включена) → «Хочу». */
export function premiumActions(onDone) {
  const p = premiumInfo();
  const out = [];
  const after = () => { if (onDone) onDone(); };
  if (p.trial_available) {
    const b = h('button', { type: 'button', class: 'btn block colored c-pink' }, `🎁 ${p.trial_days} дней бесплатно`);
    b.addEventListener('click', busy(b, async () => { try { await startTrial(); after(); } catch (e) { toastError(e); } }));
    out.push(b);
  }
  if (p.payments && !p.forever) {
    const full = p.full_prices || {};
    const month = p.prices.premium_month;
    const b1 = h('button', { type: 'button', class: `btn block ${out.length ? 'ghost' : ''}` },
      `30 дней — ${month}⭐`, month < full.premium_month ? h('span', { class: 'tag c-lime', style: { marginLeft: '8px' } }, '−50%') : null);
    b1.addEventListener('click', busy(b1, async () => { try { if (await buyStars('premium_month') === 'paid') after(); } catch (e) { toastError(e); } }));
    const b2 = h('button', { type: 'button', class: 'btn block ghost' }, `Год — ${p.prices.premium_year}⭐ · выгоднее на 45%`);
    b2.addEventListener('click', busy(b2, async () => { try { if (await buyStars('premium_year') === 'paid') after(); } catch (e) { toastError(e); } }));
    out.push(b1, b2);
  } else if (!p.active && !p.trial_available) {
    const b = h('button', { type: 'button', class: 'btn block' }, 'Хочу Premium');
    b.addEventListener('click', busy(b, wantPremium));
    out.push(b, h('p', { class: 'tiny muted bold center' }, 'Оплата скоро появится'));
  }
  return h('div', { class: 'stack-sm', style: { marginTop: '14px' } }, out);
}

/** Окно-предложение Premium в момент, когда он нужен. */
export function openPaywall(reason) {
  const [emoji, title, text] = REASONS[reason] || ['👑', 'LifeQuest Premium', 'Больше приключений, больше стиля, больше тебя.'];
  haptic.tap('medium');
  let s;
  const body = h('div', { class: 'center' },
    mascot((store.state && store.state.user.mascot) || 'star', 'love', { size: 96, acc: 'tiara', cls: 'jump' }),
    h('div', { style: { fontSize: '30px', marginTop: '4px' }, 'aria-hidden': 'true' }, emoji),
    h('h2', { style: { marginTop: '4px' } }, title),
    h('p', { class: 'muted bold', style: { marginTop: '6px' } }, text),
    h('div', { class: 'stack-sm', style: { marginTop: '14px', textAlign: 'left' } },
      PERKS.map(([e, t]) => h('div', { class: 'row small bold', style: { gap: '10px' } }, h('span', { 'aria-hidden': 'true' }, e), t))),
    premiumActions(() => s && s.close()));
  s = sheet(body, { label: title });
  return s;
}

/** Ошибка с кодом лимита/Premium → окно-предложение, иначе обычный тост. */
export function handlePremiumError(e) {
  if (e && ['roll_limit', 'photo_limit', 'premium_item', 'premium_theme'].includes(e.code)) {
    openPaywall(e.code);
    return true;
  }
  return false;
}

/** После 3-го квеста — предложение пробной недели (один раз). */
export function offerTrial() {
  const p = premiumInfo();
  if (!p.trial_available) return;
  const s = sheet(h('div', { class: 'center' },
    mascot((store.state && store.state.user.mascot) || 'star', 'love', { size: 100, acc: 'wizard', cls: 'jump' }),
    h('h2', { style: { marginTop: '8px' } }, 'Три квеста позади! 🎉'),
    h('p', { class: 'muted bold', style: { marginTop: '6px' } },
      `Держи подарок: ${p.trial_days} дней Premium бесплатно. Безлимит заданий, новые аксессуары и стиль «Космос».`),
    premiumActions(() => s.close())), { label: 'Подарок' });
}
