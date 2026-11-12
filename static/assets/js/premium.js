// Premium: окно-предложение (когда упёрлись в лимит или нажали на 🔒),
// пробная неделя и покупка: рубли через ЮKassa или звёзды (что включено на сервере).

import { h, plural } from './dom.js';
import { tg, haptic, openTgLink, openWebLink } from './tg.js';
import { api } from './api.js';
import { mascot } from './mascot.js';
import { sheet, toast, toastError, busy, confetti } from './ui.js';
import { store, setState, refreshState } from './store.js';

export const PERKS = [
  ['🎲', 'Квесты без лимита', 'Новое задание в любой момент: для себя, на двоих или для компании'],
  ['🗂️', 'Все наборы целиком', '«Тайный агент добра», «Кино про тебя», «Свидания» и ещё десяток — все задания, а не первые два'],
  ['📸', 'Альбом до 1000 фото', 'Все воспоминания помещаются — и в календаре, и в ленте друзей'],
  ['🎨', 'Стили «Матрица», «Лес», «Морской мир»', 'Приложение перекрашивается целиком'],
  ['🐼', 'Все маскоты и 8 аксессуаров', 'Не ждать серию входов — выбирай любого и наряжай'],
  ['🥇', 'Соревнования до 10 пунктов', 'Состязайтесь с друзьями сразу во всём'],
  ['🏆', 'Итоги года и челлендж «30 дней»', 'Красивая карточка года и самая большая награда'],
];

const REASONS = {
  roll_limit: ['🎲', 'Попытки на сегодня закончились', 'С Premium можно крутить задания без ограничений.'],
  premium_quests: ['🎲', 'Бесплатный квест на сегодня уже был', 'С Premium — новое задание в любой момент: для себя, на двоих или для компании.'],
  photo_limit: ['📸', 'На доске закончилось место', 'С Premium воспоминаний помещается в разы больше.'],
  premium_item: ['🎩', 'Это вещь из Premium', 'Все Premium-аксессуары — сразу и бесплатно.'],
  premium_theme: ['🎨', 'Этот стиль — в Premium', '«Матрица», «Лес» и «Морской мир» — сразу, пока активен Premium.'],
  pack: ['🗂️', 'Набор целиком — в Premium', 'Первые квесты набора бесплатные, остальные — с Premium.'],
  challenge: ['🚀', '30 дней — в Premium', 'Самый большой челлендж и самая большая награда.'],
  ai_limit: ['✨', 'ИИ-квесты на сегодня закончились', 'С Premium — 30 уникальных квестов от ИИ каждый день.'],
  premium_recap: ['🏆', 'Итоги года — в Premium', 'Красивая карточка всего года: квесты, серии, любимая сфера.'],
  freeze: ['🧊', 'Защити серию', 'С Premium — две бесплатные заморозки каждую неделю.'],
  contest: ['🏆', 'До 10 пунктов в соревновании', 'Бесплатно — 5 пунктов. С Premium можно соревноваться сразу в 10 вещах.'],
};

const premiumInfo = () => (store.state && store.state.premium) || {};

/** Покупка товара (currency: 'RUB' | 'XTR', по умолчанию — основная валюта товара):
 * счёт открывается прямо в мини-аппе. */
export async function buyStars(product, currency) {
  const res = await api.premiumInvoice(product, currency);
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

/** Оплата по СБП (и картой) на странице ЮKassa: открываем её, а когда человек
 * вернётся в приложение — сами проверяем платёж. */
export async function buySbp(product) {
  const res = await api.premiumSbp(product);
  openWebLink(res.url);
  return new Promise(resolve => {
    let tries = 0;
    const check = async () => {
      try {
        const r = await api.premiumSbpCheck(res.id);
        if (r.paid) {
          document.removeEventListener('visibilitychange', onBack);
          if (r.state) setState(r.state);
          haptic.success();
          confetti(120);
          toast('💛 Оплата прошла — спасибо!', 'good', 2600);
          resolve('paid');
          return;
        }
      } catch (e) { /* сеть — попробуем ещё */ }
      if (++tries < 40) setTimeout(check, 3000);  // подтверждение в банке может занять пару минут
    };
    const onBack = () => { if (document.visibilityState === 'visible') { tries = 0; check(); } };
    document.addEventListener('visibilitychange', onBack);
    setTimeout(check, 4000);  // встроенный браузер мог открыться поверх, не скрыв приложение
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

/** Главное обещание Premium — одной фразой. */
export const PROMISE = ['Сними все ограничения',
  'Привычки, план, друзья и челленджи месяца — бесплатно навсегда. Premium открывает квесты без лимита, все наборы, стили и место для воспоминаний.'];

/** Что есть бесплатно и что добавляет Premium. */
export const COMPARE = [
  ['🎲', 'Случайные квесты', '1 в день', 'без лимита'],
  ['🗂️', 'Наборы квестов', 'первые 2 задания', 'все целиком'],
  ['📸', 'Фото в альбоме', '15', 'до 1000'],
  ['🎨', 'Стили оформления', '3', '+ ещё 3'],
  ['🐼', 'Маскоты и аксессуары', 'за серию входов', 'все сразу, +8 вещей'],
  ['🥇', 'Соревнования', 'до 5 пунктов', 'до 10'],
  ['🚀', 'Челлендж «30 дней»', '—', '✓'],
  ['🏆', 'Итоги года', '—', '✓'],
];

export function perksList() {
  return h('div', { class: 'prem-perks' }, PERKS.slice(0, 4).map(([e, t, d]) => h('div', { class: 'prem-perk' },
    h('span', { class: 'prem-perk-e', 'aria-hidden': 'true' }, e), h('div', { class: 'grow' }, h('b', null, t), h('span', null, d)))));
}

export function compareTable() {
  return h('div', { class: 'prem-compare', role: 'table', 'aria-label': 'Бесплатно и Premium' },
    h('div', { class: 'pc-row pc-head', role: 'row' }, h('span', { role: 'columnheader' }, ''),
      h('span', { role: 'columnheader' }, 'Бесплатно'), h('span', { role: 'columnheader', class: 'pc-prem' }, '👑 Premium')),
    COMPARE.map(([e, name, free, prem]) => h('div', { class: 'pc-row', role: 'row' },
      h('span', { class: 'pc-name', role: 'rowheader' }, h('span', { 'aria-hidden': 'true' }, e), ' ', name),
      h('span', { class: 'pc-free', role: 'cell' }, free), h('span', { class: 'pc-prem', role: 'cell' }, prem))));
}

/** «Аня и Оля из твоих друзей — в Premium», «Уже 25 человек в Premium». */
export function socialProof() {
  const s = premiumInfo().social || {};
  const names = s.friends || [];
  let text = '';
  if (names.length) text = `💛 ${names.join(', ')} из твоих друзей уже в Premium`;
  else if (s.total) text = `💛 Уже ${s.total} ${plural(s.total, 'человек', 'человека', 'человек')} в Premium`;
  return text ? h('p', { class: 'small bold center prem-social' }, text) : null;
}

const fmtShort = iso => new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const priceBtn = (label, o, cls, tag) => h('button', { type: 'button', class: `btn block price-btn ${cls}` },
  h('span', { class: 'pb-main' }, `${label} — `, h('b', null, o.text),
    o.full_text ? h('s', { class: 'pb-old' }, o.full_text) : null,
    tag ? h('span', { class: 'tag c-lime' }, tag) : null),
  o.per_day ? h('span', { class: 'pb-sub' }, o.per_day) : null);

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
    const opts = p.options || {};
    // рубли при подключённом API ЮKassa — на страницу ЮKassa (там есть СБП), иначе — форма Telegram
    const pay = (product, currency) => (currency === 'RUB' && p.sbp ? buySbp(product) : buyStars(product, currency));
    const buy = (b, product, currency) => b.addEventListener('click', busy(b, async () => {
      try { if (await pay(product, currency) === 'paid') after(); } catch (e) { toastError(e); }
    }));
    const month = opts.premium_month || [];
    const year = opts.premium_year || [];
    const main = month[0];
    if (main) {
      const b = priceBtn('30 дней', main, out.length ? 'ghost' : '', main.full_text ? '−50% первый месяц' : null);
      buy(b, 'premium_month', main.currency);
      out.push(b);
    }
    const y = year.find(o => main && o.currency === main.currency) || year[0];
    if (y) {
      const b = priceBtn('Год', y, 'ghost', y.save ? `выгоднее на ${y.save}%` : null);
      buy(b, 'premium_year', y.currency);
      out.push(b);
    }
    // Навсегда — один платёж; в первый месяц со скидкой
    const fv = (opts.premium_forever || []).find(o => main && o.currency === main.currency) || (opts.premium_forever || [])[0];
    if (fv) {
      const until = p.forever_discount_until;
      const b = h('button', { type: 'button', class: 'btn block price-btn price-forever' },
        h('span', { class: 'pb-main' }, '♾️ Навсегда — ', h('b', null, fv.text), fv.full_text ? h('s', { class: 'pb-old' }, fv.full_text) : null),
        h('span', { class: 'pb-sub' }, fv.full_text && until ? `скидка первого месяца — до ${fmtShort(until)} · один платёж, без продлений` : 'один платёж, без продлений'));
      buy(b, 'premium_forever', fv.currency);
      out.push(b);
    }
    if (p.sbp && main && main.currency === 'RUB') {
      out.push(h('p', { class: 'tiny muted bold center' }, '⚡ СБП, карта, SberPay или ЮMoney'));
    }
    // звёзды — запасной способ, одной строкой
    const stars = [['premium_month', month], ['premium_year', year]]
      .map(([product, list]) => [product, list.find(o => o.currency === 'XTR' && o !== main && o !== y)])
      .filter(([, o]) => o);
    if (stars.length) {
      out.push(h('div', { class: 'row prem-stars' }, h('span', { class: 'tiny muted bold' }, 'или звёздами:'),
        stars.map(([product, o]) => {
          const b = h('button', { type: 'button', class: 'btn small ghost' }, `${product === 'premium_year' ? 'год' : 'месяц'} · ${o.text}`);
          buy(b, product, 'XTR');
          return b;
        })));
    }
    out.push(h('p', { class: 'tiny muted bold center' }, 'Без автосписаний: продлеваешь, только когда сам(а) захочешь.'));
  } else if (!p.active && !p.trial_available) {
    const b = h('button', { type: 'button', class: 'btn block' }, 'Хочу Premium');
    b.addEventListener('click', busy(b, wantPremium));
    out.push(b, h('p', { class: 'tiny muted bold center' }, 'Оплата скоро появится'));
  }
  return h('div', { class: 'stack-sm', style: { marginTop: '14px' } }, out);
}

/** Окно-предложение Premium в момент, когда он нужен. */
export function openPaywall(reason) {
  const [emoji, title, text] = REASONS[reason] || ['👑', PROMISE[0], PROMISE[1]];
  haptic.tap('medium');
  let s;
  const body = h('div', { class: 'center' },
    mascot((store.state && store.state.user.mascot) || 'star', 'love', { size: 96, acc: 'tiara', cls: 'jump' }),
    h('div', { style: { fontSize: '30px', marginTop: '4px' }, 'aria-hidden': 'true' }, emoji),
    h('h2', { style: { marginTop: '4px' } }, title),
    h('p', { class: 'muted bold', style: { marginTop: '6px' } }, text),
    perksList(),
    compareTable(),
    socialProof(),
    premiumActions(() => s && s.close()));
  s = sheet(body, { label: title });
  return s;
}

/** Ошибка с кодом лимита/Premium → окно-предложение, иначе обычный тост. */
export function handlePremiumError(e) {
  if (e && ['roll_limit', 'premium_quests', 'photo_limit', 'premium_item', 'premium_theme', 'pack', 'challenge', 'premium_recap', 'ai_limit'].includes(e.code)) {
    openPaywall(e.code);
    return true;
  }
  return false;
}

/** После 3-го квеста — предложение пробной недели (один раз). */
export function offerTrial(reason = 'quests') {
  const p = premiumInfo();
  if (!p.trial_available) return;
  const s = sheet(h('div', { class: 'center' },
    mascot((store.state && store.state.user.mascot) || 'star', 'love', { size: 100, acc: 'wizard', cls: 'jump' }),
    h('h2', { style: { marginTop: '8px' } }, reason === 'habits' ? 'Три дня с привычками! 🎉' : 'Три квеста позади! 🎉'),
    h('p', { class: 'muted bold', style: { marginTop: '6px' } },
      `Держи подарок: ${p.trial_days} дней Premium бесплатно. Случайные квесты, все наборы, аксессуары и новые стили.`),
    premiumActions(() => s.close())), { label: 'Подарок' });
}
