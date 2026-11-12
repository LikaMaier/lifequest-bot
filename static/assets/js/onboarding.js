// Приветствие при первом открытии. Четыре экрана: обещание («не знаешь, чем
// заняться?»), что внутри, первые привычки, первый квест — и сразу случайное
// задание. Отметка «уже видел» хранится на сервере (users.onboarded) — работает
// на любом устройстве. Повторно открывается из Профиля.

import { h, clear } from './dom.js';
import { api } from './api.js';
import { haptic, pushBack } from './tg.js';
import { myMascot } from './mascot.js';
import { setState } from './store.js';
import { templatePicker } from './habitui.js';

const feature = (emoji, color, title, text) => h('div', { class: `onb-feature c-${color}` },
  h('span', { class: 'onb-feature-emoji', 'aria-hidden': 'true' }, emoji),
  h('div', { class: 'grow' }, h('div', { class: 'bold' }, title), h('div', { class: 'small onb-feature-text' }, text)));

// Плавающие вокруг маскота значки — у каждого слайда свои
const floaters = list => h('div', { class: 'onb-floats', 'aria-hidden': 'true' },
  list.map(([emoji, cls]) => h('span', { class: `onb-float ${cls}` }, emoji)));

const SLIDES = [
  {
    color: 'pink', expr: 'love', grad: 'a',
    kicker: 'Лекарство от прокрастинации',
    title: 'Не знаешь,<br>чем заняться?',
    lead: 'Жми 🎲 — и получишь живое задание на 15 минут. Не «помой посуду», а то, после чего день становится историей.',
    floats: [['🎲', 'f1'], ['⭐', 'f2'], ['🔥', 'f3'], ['📸', 'f4']],
    quotes: ['«Сходи на конечную остановку»', '«Проживи день как герой фильма»', '«Скажи три искренних спасибо»'],
  },
  {
    color: 'lav', expr: 'wink', grad: 'b', dense: true,
    kicker: 'Что внутри',
    title: 'Игра, в которой<br>выигрываешь ты',
    lead: null,
    body: () => [
      feature('🎲', 'purple', 'Квесты и наборы', '400+ заданий: смелость, творчество, свидания, тайные добрые дела.'),
      feature('💧', 'blue', 'Привычки и план дня', 'Галочки, серии и неделя одним взглядом.'),
      feature('🏁', 'orange', 'Челленджи месяца', '«Месяц чтения», «месяц шагов» — отмечаешь каждый день, друзья видят твой результат.'),
      feature('⚔️', 'red', 'Друзья и лига', 'Дуэли, соревнования, квесты вдвоём и сезон месяца с титулом чемпиона.'),
      feature('🏠', 'lime', 'Маскот и Домик', 'Твои галочки кормят маскота, а прогресс виден в колесе баланса.'),
    ],
  },
  {
    color: 'lime', expr: 'happy', picker: true, grad: 'c',
    kicker: 'Шаг первый',
    title: 'С чего начнём?',
    lead: 'Выбери до 3 привычек — маленькие шаги работают лучше. Остальное добавишь потом.',
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
    if (!s.picker) {
      parts.push(h('div', { class: 'onb-hero-wrap' },
        s.floats ? floaters(s.floats) : null,
        h('div', { class: 'onb-hero' }, myMascot(s.expr, { size: s.dense ? 84 : 118, cls: 'jump' }))));
    }
    parts.push(h('div', { class: 'onb-kicker' }, s.kicker));
    parts.push(h('h1', { class: 'onb-title', html: s.title }));
    if (s.lead) parts.push(h('p', { class: 'onb-lead' }, s.lead));
    if (s.quotes) {
      parts.push(h('div', { class: 'onb-quotes' }, s.quotes.map((q, k) =>
        h('span', { class: 'onb-quote', style: { '--d': `${0.15 + k * 0.12}s` } }, q))));
    }
    if (s.picker) parts.push(templatePicker({ max: 3, title: '', onDone: () => go(1) }));
    else if (s.body) parts.push(h('div', { class: 'stack-sm onb-features' }, s.body()));
    clear(slideHost).append(h('section', {
      class: `onb-slide c-${s.color} ${s.picker ? 'picker' : ''} ${s.dense ? 'dense' : ''} ${dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : ''}`,
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
  const go = d => {
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
