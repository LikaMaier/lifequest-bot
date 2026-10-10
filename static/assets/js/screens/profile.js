// ⑥ Профиль: имя и уровень, маскот, цвет, цель дня, напоминания, часовой
// пояс, «Поделиться достижением» и вход в заготовку Premium.

import { h, clear } from '../dom.js';
import { haptic, openTgLink, showMainButton } from '../tg.js';
import { api } from '../api.js';
import { mascot, mascotSVG } from '../mascot.js';
import { sectionTitle, progressBar, toast, toastError, busy, button, ICONS } from '../ui.js';
import { setState, store, refreshState } from '../store.js';
import { buildShareCard } from '../share.js';

const COMMON_TZ = [
  'Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk',
  'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka',
  'Europe/Minsk', 'Europe/Kyiv', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Baku',
  'Europe/Istanbul', 'Europe/Berlin', 'Europe/London', 'Asia/Dubai', 'Asia/Bangkok', 'America/New_York',
];
const TZ_NAMES = {
  'Europe/Kaliningrad': 'Калининград', 'Europe/Moscow': 'Москва', 'Europe/Samara': 'Самара', 'Asia/Yekaterinburg': 'Екатеринбург',
  'Asia/Omsk': 'Омск', 'Asia/Novosibirsk': 'Новосибирск', 'Asia/Krasnoyarsk': 'Красноярск', 'Asia/Irkutsk': 'Иркутск',
  'Asia/Yakutsk': 'Якутск', 'Asia/Vladivostok': 'Владивосток', 'Asia/Magadan': 'Магадан', 'Asia/Kamchatka': 'Камчатка',
  'Europe/Minsk': 'Минск', 'Europe/Kyiv': 'Киев', 'Asia/Almaty': 'Алматы', 'Asia/Tashkent': 'Ташкент', 'Asia/Tbilisi': 'Тбилиси',
  'Asia/Yerevan': 'Ереван', 'Asia/Baku': 'Баку', 'Europe/Istanbul': 'Стамбул', 'Europe/Berlin': 'Берлин', 'Europe/London': 'Лондон',
  'Asia/Dubai': 'Дубай', 'Asia/Bangkok': 'Бангкок', 'America/New_York': 'Нью-Йорк',
};

async function saveSettings(patch, okText = 'Сохранено ✓') {
  try {
    const state = await api.settings(patch);
    haptic.success();
    setState(state);
    toast(okText, 'good', 1500);
  } catch (e) { toastError(e); }
}

export function render(el, { state, go }) {
  clear(el);
  const u = state.user;
  const lv = state.level;

  el.append(h('section', { class: 'card tinted c-lav center', style: { marginTop: '4px' } },
    mascot(u.mascot, 'happy', { size: 96, label: 'Твой маскот', cls: 'jump' }),
    h('h1', { style: { marginTop: '8px' } }, u.first_name || 'Искатель приключений'),
    h('p', { class: 'bold', style: { color: 'var(--lav-deep)', marginTop: '4px' } }, `Уровень ${lv.level} · ${lv.name}`),
    h('div', { style: { margin: '12px 10px 4px' } }, progressBar(lv.progress, 'purple')),
    h('p', { class: 'tiny bold muted' }, `${lv.xp} / ${lv.next} XP`),
    u.is_premium ? h('span', { class: 'tag c-yellow', style: { marginTop: '8px' } }, '👑 Premium') : null));

  // Поделиться
  const shareBtn = button('Поделиться достижением', { cls: 'block', icon: ICONS.share, onClick: async () => {
    try {
      const image = await buildShareCard(store.state);
      await api.share(image);
      haptic.success();
      toast('📬 Карточка уже в чате с ботом — перешли её друзьям!', 'good', 3600);
    } catch (e) { toastError(e); }
  } });
  const invite = button('Позвать друга', { cls: 'block ghost', onClick: () => {
    const link = state.bot_username ? `https://t.me/${state.bot_username}` : '';
    const text = 'Я играю в LifeQuest — бот подкидывает странные и классные задания. Давай со мной?';
    openTgLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  } });
  el.append(h('div', { class: 'stack-sm', style: { marginTop: '16px' } }, shareBtn, invite));

  // Маскот
  const mascots = h('div', { class: 'picker-grid', role: 'radiogroup', 'aria-label': 'Маскот' },
    state.unlocks.mascots.map(m => {
      const b = h('button', { type: 'button', class: `picker ${m.id === u.mascot ? 'on' : ''}`, role: 'radio',
        'aria-checked': String(m.id === u.mascot), disabled: !m.unlocked,
        'aria-label': m.unlocked ? m.name : `${m.name} — откроется на ${m.level} уровне` },
        h('span', { class: 'picker-img', html: mascotSVG(m.id, m.unlocked ? 'happy' : 'sleepy') }),
        h('span', { class: 'tiny bold' }, m.unlocked ? m.name : `🔒 ур. ${m.level}`));
      b.addEventListener('click', busy(b, () => saveSettings({ mascot: m.id }, `Теперь с тобой ${m.name}!`)));
      return b;
    }));
  el.append(sectionTitle('Маскот'), h('div', { class: 'card' }, mascots));

  // Стиль приложения — все доступны сразу
  const PREVIEW = {
    classic: { bg: '#FDF7DE', cells: ['#F3619C', '#93ABD8', '#DBFA40'], mark: '🐱', radius: '8px' },
    pixel: { bg: '#FFF8EC', cells: ['#FF2E84', '#FFA21F', '#3DEBF2'], mark: '👾', radius: '0' },
    halloween: { bg: '#160D1E', cells: ['#FF8A2A', '#B98CFF', '#9BFF4F'], mark: '🎃', radius: '8px' },
    matrix: { bg: '#020A04', cells: ['#00FF66', '#2CF2C8', '#D6FF3D'], mark: '⌨️', radius: '3px' },
    forest: { bg: 'linear-gradient(180deg, #EDE383, #B9CC74)', cells: ['#365004', '#8DA432', '#925E06'], mark: '🍃', radius: '10px' },
    ocean: { bg: 'linear-gradient(180deg, #DFD0B1, #3BEAEF 70%, #3D7282)', cells: ['rgba(255,255,255,.55)', 'rgba(255,255,255,.55)', 'rgba(255,255,255,.55)'], mark: '🫧', radius: '10px' },
  };
  const themes = h('div', { class: 'theme-grid', role: 'radiogroup', 'aria-label': 'Стиль приложения' },
    state.unlocks.themes.map(t => {
      const p = PREVIEW[t.id] || PREVIEW.classic;
      const on = t.id === u.theme;
      const b = h('button', { type: 'button', class: `theme-card ${on ? 'on' : ''}`, role: 'radio', 'aria-checked': String(on), 'aria-label': `${t.name}. ${t.description}` },
        h('span', { class: 'theme-preview', style: { background: p.bg }, 'aria-hidden': 'true' },
          h('b', null, p.mark),
          p.cells.map(c => h('i', { style: { background: c, borderRadius: p.radius, border: p.border || 'none' } }))),
        h('span', { class: 'theme-name' }, `${on ? '✓ ' : ''}${t.name}`),
        h('span', { class: 'theme-desc' }, t.description));
      b.addEventListener('click', busy(b, () => saveSettings({ theme: t.id }, `Стиль «${t.name}» включён`)));
      return b;
    }));
  el.append(sectionTitle('Стиль приложения'), themes);

  // Цель дня
  const goal = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Цель дня' },
    [1, 2, 3].map(n => {
      const b = h('button', { type: 'button', 'aria-pressed': String(u.daily_goal === n) }, `${n} ${n === 1 ? 'задание' : 'задания'}`);
      b.addEventListener('click', () => { haptic.select(); saveSettings({ daily_goal: n }); });
      return b;
    }));
  el.append(sectionTitle('Цель дня'), h('div', { class: 'card' }, goal));

  // Напоминания и часовой пояс
  const hourSelect = (value, key, label) => {
    const sel = h('select', { class: 'input', 'aria-label': label },
      Array.from({ length: 24 }, (_, i) => h('option', { value: String(i), selected: i === value }, `${String(i).padStart(2, '0')}:00`)));
    sel.addEventListener('change', () => saveSettings({ [key]: Number(sel.value) }));
    return sel;
  };
  let detected = '';
  try { detected = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* нет Intl */ }
  const zones = [...new Set([u.tz, detected, ...COMMON_TZ].filter(Boolean))];
  const tzSel = h('select', { class: 'input', 'aria-label': 'Часовой пояс' },
    zones.map(z => h('option', { value: z, selected: z === u.tz }, `${TZ_NAMES[z] || z}${z === detected ? ' (как на телефоне)' : ''}`)));
  if (!u.tz) tzSel.prepend(h('option', { value: '', selected: true, disabled: true }, 'Не выбран'));
  tzSel.addEventListener('change', () => saveSettings({ tz: tzSel.value }));
  el.append(sectionTitle('Напоминания'), h('div', { class: 'card stack' },
    h('div', { class: 'field' }, h('span', { class: 'label' }, '🌅 Утреннее напоминание'), hourSelect(u.reminder_hour, 'reminder_hour', 'Час утреннего напоминания')),
    h('div', { class: 'field' }, h('span', { class: 'label' }, '🌙 Вечерний вопрос «как прошёл день?»'), hourSelect(u.evening_reminder_hour, 'evening_reminder_hour', 'Час вечернего напоминания')),
    h('div', { class: 'field' }, h('span', { class: 'label' }, '🕰️ Часовой пояс'), tzSel,
      h('p', { class: 'tiny muted bold' }, 'По нему считаются день серии, цель дня и время напоминаний.'))));

  // Premium
  const prem = h('button', { type: 'button', class: 'card tinted c-yellow', style: { width: '100%', border: '0', textAlign: 'left', marginTop: '22px' } },
    h('div', { class: 'row' }, h('span', { style: { fontSize: '34px' }, 'aria-hidden': 'true' }, '👑'),
      h('div', { class: 'grow' }, h('div', { class: 'card-title', style: { margin: 0 } }, 'LifeQuest Premium'),
        h('div', { class: 'small bold' }, u.is_premium ? 'Подписка активна — спасибо! 💛' : 'Скоро: больше заданий и фишек'))));
  prem.addEventListener('click', () => { haptic.tap(); go('premium'); });
  el.append(prem);

  // Повторно открыть приветствие
  const tour = h('button', { type: 'button', class: 'quest-item c-lav', style: { marginTop: '14px' } },
    h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, '💡'),
    h('span', { class: 'grow' }, h('span', { class: 'q-title', style: { display: 'block' } }, 'Как устроен LifeQuest'),
      h('span', { class: 'q-meta', style: { display: 'block' } }, 'Миссия и возможности приложения')));
  tour.addEventListener('click', () => { haptic.tap(); import('../onboarding.js').then(m => m.showOnboarding()); });
  el.append(tour);

  // Утренняя сводка планов
  const morning = h('button', { type: 'button', class: `toggle ${u.morning_plans ? 'on' : ''}`, role: 'switch',
    'aria-checked': String(u.morning_plans), 'aria-label': 'Утренняя сводка планов' }, h('span', { class: 'knob' }));
  morning.addEventListener('click', busy(morning, () => saveSettings({ morning_plans: !u.morning_plans })));
  el.append(sectionTitle('Календарь'), h('div', { class: 'card stack-sm' },
    h('div', { class: 'spread' }, h('div', null, h('div', { class: 'bold' }, '🌅 Утренняя сводка планов'),
      h('div', { class: 'tiny muted bold' }, 'В час утреннего напоминания бот пришлёт, что у тебя сегодня в планах')), morning)));

  // Альбом и приватность
  const album = h('button', { type: 'button', class: 'quest-item c-pink' }, h('span', { class: 'q-emoji', 'aria-hidden': 'true' }, '📷'),
    h('span', { class: 'grow' }, h('span', { class: 'q-title', style: { display: 'block' } }, 'Альбом'),
      h('span', { class: 'q-meta', style: { display: 'block' } }, state.photos.enabled ? `${state.photos.count} из ${state.photos.limit} фото` : 'Фото пока недоступны')));
  album.addEventListener('click', () => { haptic.tap(); go('album'); });
  const confirmBtn = (text, armedText, fn) => {
    let armed = false;
    const b = h('button', { type: 'button', class: 'btn ghost block small' }, text);
    b.addEventListener('click', busy(b, async () => {
      if (!armed) { armed = true; haptic.warning(); b.textContent = armedText; setTimeout(() => { armed = false; b.textContent = text; }, 4000); return; }
      try { await fn(); } catch (e) { toastError(e); }
    }));
    return b;
  };
  el.append(sectionTitle('Приватность'), h('div', { class: 'stack-sm' }, album,
    h('p', { class: 'tiny muted bold', style: { margin: '4px 2px' } }, 'Фото и записи видишь только ты. Фото хранятся на сервере LifeQuest без геометок.'),
    confirmBtn('🗑 Удалить все мои фото', 'Точно? Нажми ещё раз — фото удалятся навсегда', async () => {
      const r = await api.deleteMyPhotos();
      haptic.success();
      toast(`Удалено фото: ${r.deleted}`);
      await refreshState();
    }),
    confirmBtn('⚠️ Удалить все мои данные', 'Точно? Прогресс, планы, привычки и фото удалятся навсегда', async () => {
      await api.deleteAllData();
      haptic.success();
      toast('Все данные удалены. Можно начать с чистого листа 🌱', 'good', 3600);
      await refreshState();
      go('home');
    })));
}

const PERKS = [
  ['🎲', 'Безлимит «Другое»', 'Крути задания сколько хочешь — без дневного лимита'],
  ['🐱', 'Эксклюзивные маскоты', 'Котики, которых нет в обычной версии'],
  ['❄️', 'Две заморозки в неделю', 'Серия переживёт даже насыщенную неделю'],
  ['🗂️', 'Тематические подборки', 'Свидания, выходные, путешествия — наборы заданий по теме'],
  ['📈', 'Подробная статистика', 'Итоги месяца и года с красивыми карточками'],
];

export function renderPremium(el, { state }) {
  clear(el);
  const isPremium = state.user.is_premium;
  el.append(h('section', { class: 'premium-hero' },
    mascot('star', 'love', { size: 110, cls: 'jump' }),
    h('h1', { style: { marginTop: '10px' } }, 'LifeQuest Premium'),
    h('p', { class: 'bold', style: { marginTop: '8px', color: 'var(--ink-soft)' } },
      isPremium ? 'Подписка активна. Спасибо, что поддерживаешь LifeQuest! 💛' : 'Больше приключений, больше котиков, больше тебя.')));
  el.append(h('div', { class: 'stack-sm', style: { marginTop: '16px' } }, PERKS.map(([emoji, title, text]) =>
    h('div', { class: 'quest-item c-yellow' }, h('div', { class: 'q-emoji', 'aria-hidden': 'true' }, emoji),
      h('div', { class: 'grow' }, h('div', { class: 'q-title' }, title), h('div', { class: 'q-meta' }, text))))));
  if (!isPremium) {
    el.append(h('div', { class: 'card center', style: { marginTop: '16px' } },
      h('div', { class: 'num', style: { fontSize: '22px' } }, 'Скоро'),
      h('p', { class: 'small bold muted', style: { marginTop: '6px' } }, 'Подписка ещё в разработке — оплата появится через Telegram Stars. Сейчас всё в LifeQuest бесплатно.')));
    const want = () => { haptic.success(); toast('💛 Спасибо! Premium уже в работе — анонс будет в боте.', 'good', 3200); };
    if (!showMainButton('Хочу Premium', want, '#F3619C')) {
      el.append(h('div', { style: { marginTop: '14px' } }, button('Хочу Premium', { cls: 'block', onClick: want })));
    }
  }
}
