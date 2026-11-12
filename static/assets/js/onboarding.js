// Приветствие при первом открытии. Четыре экрана: обещание («не знаешь, чем
// заняться?»), что внутри, первые привычки, первый квест — и сразу случайное
// задание. Отметка «уже видел» хранится на сервере (users.onboarded) — работает
// на любом устройстве. Повторно открывается из Профиля.

import { h, clear } from './dom.js';
import { api } from './api.js';
import { haptic, pushBack } from './tg.js';
import { myMascot } from './mascot.js';
import { setState, store } from './store.js';
import { templatePicker } from './habitui.js';
import { ICONS } from './icons.js';
import { balanceWheel } from './charts.js';

const feature = (emoji, color, title, text) => h('div', { class: `onb-feature c-${color}` },
  h('span', { class: 'onb-feature-emoji', 'aria-hidden': 'true' }, emoji),
  h('div', { class: 'grow' }, h('div', { class: 'bold' }, title), h('div', { class: 'small onb-feature-text' }, text)));

// Плавающие вокруг маскота значки — у каждого слайда свои
const floaters = list => h('div', { class: 'onb-floats', 'aria-hidden': 'true' },
  list.map(([emoji, cls]) => h('span', { class: `onb-float ${cls}` }, emoji)));

// Мини-панель вкладок: показывает, где в приложении живёт то, о чём слайд
const TOUR_TABS = [['home', 'Главная', 'home'], ['habits', 'Привычки', 'habits'], ['quests', 'Квест', 'dice'], ['friends', 'Друзья', 'friends'], ['progress', 'Прогресс', 'progress']];
const tourTabs = active => h('div', { class: 'tour-tabs', 'aria-hidden': 'true' }, TOUR_TABS.map(([key, label, icon]) =>
  h('span', { class: `tour-tab ${key === active ? 'on' : ''} ${key === 'quests' ? 'fab' : ''}` }, h('span', { class: 'tour-tab-ico', html: ICONS[icon] }), h('small', null, label))));

// Приманка на первом экране: самые «вкусные» задания из каталога, три случайных
const TEASERS = [
  '☕ Оплати кофе следующему в очереди — и исчезни',
  '🚌 Доедь до конечной незнакомого маршрута',
  '🍽️ Поужинай в ресторане один — без телефона',
  '🌅 Встреть рассвет на крыше',
  '🎞️ Сними по секунде каждый час — получится трейлер дня',
  '🫧 Выдувай мыльные пузыри на мосту',
  '📞 Позвони тому, с кем год только переписываешься',
  '🎲 Придумай три странных правила и живи по ним до вечера',
  '🛝 Качайся на качелях, когда стемнеет',
  '🚲 Поезжай без маршрута — поворот на каждом перекрёстке',
];
const pickTeasers = (n = 3) => {
  const pool = TEASERS.slice();
  const out = [];
  while (out.length < n && pool.length) out.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  return out;
};

const SLIDES = [
  {
    color: 'pink', expr: 'love', grad: 'a', card: true,
    kicker: 'Личное приглашение',
    title: 'тебе выпала карта',
    lead: 'Нажми на неё. Внутри — задание, после которого обычный день становится историей.',
    leadOpen: 'Это одна из 400+. Здесь нет «помой посуду» — только то, о чём потом рассказывают. Каждый день — новая карта.',
    quotes: true,
  },
  {
    color: 'purple', grad: 'b', tour: 'quests',
    kicker: 'Экскурсия · 1 из 4',
    title: 'Квест — когда<br>не знаешь, чем заняться',
    lead: 'Большая кнопка в центре. Выбери, с кем играешь, и получи задание. А ещё — тематические наборы.',
    demo: () => h('div', { class: 'tour-box' },
      h('div', { class: 'tour-modes' }, [['🙂', 'Один', true], ['💞', 'Вдвоём'], ['👯', 'Компания']].map(([e, t, on]) =>
        h('span', { class: `tour-mode ${on ? 'on' : ''}` }, h('i', null, e), t))),
      h('div', { class: 'tour-go' }, '🎲 Дай задание'),
      h('div', { class: 'tour-chips' }, ['🎬 Кино про тебя', '🕶️ Тайный агент добра', '🔥 Дерзкие 30 минут', '💘 Свидания'].map(t => h('span', null, t)))),
  },
  {
    color: 'lime', picker: true, grad: 'c', tour: 'habits',
    kicker: 'Экскурсия · 2 из 4',
    title: 'Привычки и план дня',
    lead: 'Галочки, серии и неделя одним взглядом. Выбери до 3 привычек — или позже.',
  },
  {
    color: 'orange', grad: 'a', tour: 'friends',
    kicker: 'Экскурсия · 3 из 4',
    title: 'Друзья: вызовы,<br>лига и челленджи',
    lead: 'Дуэли на привычках, квесты вдвоём, лента с фото и челленджи месяца, где видно результат каждого.',
    demo: () => h('div', { class: 'tour-box' },
      h('div', { class: 'tour-ch' }, h('span', { class: 'tour-ch-e' }, '📚'), h('div', { class: 'grow' },
        h('b', null, 'Месяц чтения'), h('span', null, '310 из 600 страниц'), h('div', { class: 'tour-bar' }, h('i', { style: { width: '52%' } })))),
      [['🥇', 'Соня', '530'], ['🥈', 'Ты', '310', true], ['🥉', 'Олег', '290']].map(([m, n, v, me]) =>
        h('div', { class: `tour-row ${me ? 'me' : ''}` }, h('span', null, m), h('b', { class: 'grow' }, n), h('b', null, v))),
      h('div', { class: 'tour-reacts' }, ['⚔️ Брось вызов', '🤝 Квест вдвоём', '🔥 👏 😂'].map(t => h('span', null, t)))),
  },
  {
    color: 'pink', grad: 'd', tour: 'progress',
    kicker: 'Экскурсия · 4 из 4',
    title: 'Прогресс и маскот',
    lead: 'Колесо баланса показывает, какие сферы растут. Твои галочки кормят маскота в Домике, а уровень открывает новое.',
    demo: () => h('div', { class: 'tour-box tour-prog' },
      h('div', { class: 'tour-wheel' }, balanceWheel([
        { key: 'a', name: 'Смелость', emoji: '🦁', color: 'red', count: 6 }, { key: 'b', name: 'Творчество', emoji: '🎨', color: 'pink', count: 4 },
        { key: 'c', name: 'Энергия', emoji: '🔋', color: 'lime', count: 5 }, { key: 'd', name: 'Развитие', emoji: '📚', color: 'yellow', count: 3 },
        { key: 'e', name: 'Приключения', emoji: '🧭', color: 'lav', count: 2 }, { key: 'f', name: 'Дисциплина', emoji: '🛡️', color: 'blue', count: 4 }])),
      h('div', { class: 'tour-pet' }, myMascot('love', { size: 54 }), h('div', { class: 'grow' }, h('b', null, 'Домик маскота'), h('span', null, 'покорми, погладь, наряди'))),
      h('div', { class: 'tour-reacts' }, ['🗺️ Карта пути', '🟩 Год одним взглядом', '📲 Сторис недели'].map(t => h('span', null, t)))),
  },
  {
    color: 'purple', expr: 'silly', grad: 'd',
    kicker: 'Поехали',
    title: 'Первый квест —<br>прямо сейчас',
    lead: 'Самое сложное — начать. Сейчас подберу задание на 5–15 минут: сделай его, сфоткай момент и забери первые XP.',
    floats: [['🎲', 'f1'], ['⚡', 'f2'], ['📷', 'f3'], ['💜', 'f4']],
    body: () => [
      feature('⏱️', 'yellow', '5 минут', 'Маленькое, но настоящее дело — почувствуй, как это работает.'),
      feature('📷', 'pink', 'Фото-отчёт', 'Полароид останется в альбоме, а друзья увидят его в ленте.'),
      feature('⭐', 'purple', '+XP и еда маскоту', 'Первая победа — и маскот уже доволен.'),
    ],
    first: true,
  },
];

export function showOnboarding({ onDone } = {}) {
  let i = 0;
  const slideHost = h('div', { class: 'onb-slide-host' });
  const dots = h('div', { class: 'onb-dots', role: 'tablist', 'aria-label': 'Шаги приветствия' });
  const back = h('button', { type: 'button', class: 'btn ghost small' }, 'Назад');
  const next = h('button', { type: 'button', class: 'btn grow' }, 'Дальше');
  const skip = h('button', { type: 'button', class: 'onb-skip' }, 'Пропустить');
  const overlay = h('div', { class: 'onboarding g-a', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Добро пожаловать в LifeQuest' },
    h('div', { class: 'onb-glow', 'aria-hidden': 'true' }),
    h('div', { class: 'onb-top' }, h('span', { class: 'onb-brand' }, 'LIFEQUEST'), skip),
    slideHost, dots, h('div', { class: 'row onb-actions' }, back, next));

  let release = null;
  let skipped = false;
  let quotes = null;
  const finish = async () => {
    overlay.remove();
    release && release();
    haptic.success();
    try { setState(await api.settings({ onboarded: true })); } catch (e) { /* не страшно — покажем ещё раз */ }
    onDone && onDone();
    if (SLIDES[i] && SLIDES[i].first && !skipped) {
      try { (await import('./questflow.js')).openRandom('solo'); } catch (e) { /* не страшно */ }
    }
  };

  const draw = (dir = 0) => {
    const s = SLIDES[i];
    SLIDES.forEach(x => overlay.classList.remove(`g-${x.grad}`));
    overlay.classList.add(`g-${s.grad}`);
    const parts = [];
    if (s.card) { drawCard(s, dir); return; }
    if (!s.picker && !s.tour) {
      parts.push(h('div', { class: 'onb-hero-wrap' },
        s.floats ? floaters(s.floats) : null,
        h('div', { class: 'onb-hero' }, myMascot(s.expr, { size: s.dense ? 84 : 118, cls: 'jump' }))));
    }
    parts.push(h('div', { class: 'onb-kicker' }, s.kicker));
    parts.push(h('h1', { class: 'onb-title', html: s.title }));
    if (s.lead) parts.push(h('p', { class: 'onb-lead' }, s.lead));
    if (s.quotes) {
      parts.push(h('div', { class: 'onb-quotes' }, (quotes || (quotes = pickTeasers())).map((q, k) =>
        h('span', { class: 'onb-quote', style: { '--d': `${0.15 + k * 0.12}s` } }, q))));
    }
    const where = s.tour ? h('div', { class: 'tour-where' }, h('span', { class: 'tour-where-label' }, 'где это в приложении'), tourTabs(s.tour)) : null;
    if (s.picker && where) parts.push(where);
    if (s.picker) parts.push(templatePicker({ max: 3, title: '', onDone: () => go(1) }));
    else if (s.demo) parts.push(s.demo());
    else if (s.body) parts.push(h('div', { class: 'stack-sm onb-features' }, s.body()));
    if (where && !s.picker) parts.push(where);
    clear(slideHost).append(h('section', {
      class: `onb-slide c-${s.color} ${s.picker ? 'picker' : ''} ${s.dense ? 'dense' : ''} ${s.tour ? 'tour' : ''} ${dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : ''}`,
      'aria-live': 'polite',
    }, parts));
    clear(dots).append(...SLIDES.map((_, k) => h('span', { class: `onb-dot ${k === i ? 'on' : ''} ${k < i ? 'past' : ''}`, 'aria-hidden': 'true' })));
    dots.setAttribute('aria-label', `Шаг ${i + 1} из ${SLIDES.length}`);
    back.style.display = i === 0 ? 'none' : '';
    next.textContent = i === SLIDES.length - 1 ? '🎲 Дай первый квест' : s.picker ? 'Позже' : 'Дальше';
    next.classList.toggle('ghost', Boolean(s.picker));
    next.classList.toggle('onb-go', i === SLIDES.length - 1);
    skip.style.visibility = i === SLIDES.length - 1 ? 'hidden' : 'visible';
  };
  // Первый экран: именное приглашение и закрытая карта — переверни, чтобы увидеть задание
  let cardOpen = false;
  const drawCard = (s, dir) => {
    const name = (store.state && store.state.user && store.state.user.first_name) || '';
    const picks = quotes || (quotes = pickTeasers());
    const first = picks[0];
    const emoji = first.split(' ')[0], text = first.slice(emoji.length + 1);
    const lead = h('p', { class: 'onb-lead' }, cardOpen ? s.leadOpen : s.lead);
    const more = h('div', { class: 'onb-quotes', hidden: !cardOpen }, h('span', { class: 'onb-more-label' }, 'а ещё в колоде:'),
      picks.slice(1).map((q, k) => h('span', { class: 'onb-quote', style: { '--d': `${0.25 + k * 0.14}s` } }, q)));
    const faceBack = h('div', { class: 'onb-card-face onb-card-back' },
      h('span', { class: 'onb-card-corner tl' }, 'LQ'), h('span', { class: 'onb-card-corner br' }, 'LQ'),
      h('span', { class: 'onb-card-q' }, '?'), h('span', { class: 'onb-card-hint' }, 'нажми, чтобы открыть'),
      h('span', { class: 'onb-card-shine', 'aria-hidden': 'true' }));
    const front = h('div', { class: 'onb-card-face onb-card-front' },
      h('span', { class: 'onb-card-tag' }, 'твой квест'), h('span', { class: 'onb-card-emoji', 'aria-hidden': 'true' }, emoji),
      h('span', { class: 'onb-card-text' }, text), h('span', { class: 'onb-card-meta' }, '15 минут · +XP · фото на память'));
    const card = h('button', { type: 'button', class: `onb-card ${cardOpen ? 'open' : ''}`, 'aria-label': cardOpen ? text : 'Открыть карту' },
      h('span', { class: 'onb-card-inner' }, faceBack, front));
    const flip = () => {
      if (cardOpen) return;
      cardOpen = true;
      haptic.success();
      card.classList.add('open');
      card.setAttribute('aria-label', text);
      lead.textContent = s.leadOpen;
      more.hidden = false;
      next.textContent = 'Хочу ещё →';
      next.classList.remove('onb-go');
    };
    card.addEventListener('click', flip);
    clear(slideHost).append(h('section', { class: `onb-slide onb-invite c-${s.color} ${dir < 0 ? 'from-left' : ''}`, 'aria-live': 'polite' },
      h('div', { class: 'onb-kicker onb-kicker-gold' }, h('span', { 'aria-hidden': 'true' }, '✦ '), s.kicker, h('span', { 'aria-hidden': 'true' }, ' ✦')),
      h('h1', { class: 'onb-title' }, name ? `${name}, ${s.title}` : s.title[0].toUpperCase() + s.title.slice(1)),
      h('div', { class: 'onb-card-wrap' }, h('span', { class: 'onb-card-spark s1', 'aria-hidden': 'true' }, '✦'), h('span', { class: 'onb-card-spark s2', 'aria-hidden': 'true' }, '✧'),
        h('span', { class: 'onb-card-spark s3', 'aria-hidden': 'true' }, '✦'), card),
      lead, more));
    clear(dots).append(...SLIDES.map((_, k) => h('span', { class: `onb-dot ${k === i ? 'on' : ''}`, 'aria-hidden': 'true' })));
    back.style.display = 'none';
    next.textContent = cardOpen ? 'Хочу ещё →' : '✨ Открыть карту';
    next.classList.remove('ghost');
    next.classList.toggle('onb-go', !cardOpen);
    skip.style.visibility = 'visible';
    flipCard = flip;
  };
  let flipCard = null;

  const go = d => {
    if (d > 0 && SLIDES[i].card && !cardOpen && flipCard) { flipCard(); return; }
    const n = i + d;
    if (n < 0) return;
    if (n >= SLIDES.length) { finish(); return; }
    haptic.select();
    i = n;
    draw(d);
    slideHost.scrollTop = 0;
  };
  next.addEventListener('click', () => go(1));
  back.addEventListener('click', () => go(-1));
  skip.addEventListener('click', () => { skipped = true; finish(); });

  // свайп между слайдами
  let sx = null, sy = null;
  slideHost.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  slideHost.addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && i < SLIDES.length - 1) go(1);
      if (dx > 0) go(-1);
    }
  });
  document.addEventListener('keydown', function onKey(e) {
    if (!overlay.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  });

  document.body.append(overlay);
  release = pushBack(() => (i > 0 ? go(-1) : finish()));
  draw();
}
