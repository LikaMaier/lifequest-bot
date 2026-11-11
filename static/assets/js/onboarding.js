// Приветствие при первом открытии: обещание из рекламы — сразу. Шаг 1 — что это,
// шаг 2 — первые привычки, шаг 3 — «первый квест за 5 минут»: закрываем
// онбординг и открываем случайное задание. Привычки и друзья — после первой победы.
// Отметка «уже видел» хранится на сервере (users.onboarded) — работает на
// любом устройстве. Повторно открывается из Профиля.

import { h, clear } from './dom.js';
import { api } from './api.js';
import { haptic, pushBack } from './tg.js';
import { myMascot } from './mascot.js';
import { setState } from './store.js';
import { templatePicker } from './habitui.js';

const feature = (emoji, color, title, text) => h('div', { class: `onb-feature c-${color}` },
  h('span', { class: 'onb-feature-emoji', 'aria-hidden': 'true' }, emoji),
  h('div', { class: 'grow' }, h('div', { class: 'bold' }, title), h('div', { class: 'small onb-feature-text' }, text)));

const SLIDES = [
  {
    color: 'pink', kind: 'cat-purple', expr: 'love',
    title: 'Не знаешь, чем заняться?',
    lead: 'LifeQuest — игра против прокрастинации. Жми 🎲 — получишь задание на 15 минут. Делай одна или с друзьями, а маскот растёт вместе с тобой.',
    body: () => [
      feature('🎲', 'purple', 'Квест на сейчас', 'Случайное задание, когда скучно или всё откладываешь. Каждый день — бесплатно.'),
      feature('👥', 'orange', 'С друзьями', 'Дуэли, соревнования, квесты вдвоём и лига недели.'),
      feature('🐾', 'pink', 'Маскот и прогресс', 'Галочки кормят маскота, колесо баланса показывает рост.'),
    ],
  },
  {
    color: 'lime', kind: 'cat-lime', expr: 'happy', picker: true,
    title: 'С чего начнём?',
    lead: 'Выбери до 3 привычек — маленькие шаги работают лучше. Остальное добавишь потом.',
  },
  {
    color: 'purple', kind: 'star', expr: 'wink',
    title: 'Первый квест — прямо сейчас',
    lead: 'Самое сложное — начать. Я подберу задание на 5–15 минут: сделай его, сфоткай результат и получи первые XP.',
    body: () => [
      feature('⏱️', 'yellow', '5 минут', 'Маленькое, но настоящее дело — почувствуй, как это работает.'),
      feature('📷', 'pink', 'Фото-отчёт', 'Полароид останется в альбоме воспоминаний.'),
      feature('⭐', 'purple', '+XP и еда маскоту', 'Первая победа — и Сирень уже доволен.'),
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
  const overlay = h('div', { class: 'onboarding', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Добро пожаловать в LifeQuest' },
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
    const content = s.picker
      ? templatePicker({ max: 3, title: '', onDone: () => go(1) })
      : h('div', { class: 'stack-sm' }, s.body());
    clear(slideHost).append(h('section', { class: `onb-slide c-${s.color} ${s.picker ? 'picker' : ''} ${dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : ''}`, 'aria-live': 'polite' },
      s.picker ? null : h('div', { class: 'onb-hero' }, myMascot(s.expr, { size: 110, cls: 'jump' })),
      h('div', { class: 'onb-step' }, `Шаг ${i + 1} из ${SLIDES.length}`),
      h('h1', { class: 'onb-title' }, s.title),
      h('p', { class: 'onb-lead' }, s.lead),
      content));
    clear(dots).append(...SLIDES.map((_, k) => h('span', { class: `onb-dot ${k === i ? 'on' : ''}`, 'aria-hidden': 'true' })));
    dots.setAttribute('aria-label', `Шаг ${i + 1} из ${SLIDES.length}`);
    back.style.display = i === 0 ? 'none' : '';
    next.textContent = i === SLIDES.length - 1 ? '🎲 Дай первый квест' : SLIDES[i].picker ? 'Позже' : 'Дальше';
    next.classList.toggle('ghost', Boolean(SLIDES[i].picker));
    skip.style.visibility = i === SLIDES.length - 1 ? 'hidden' : 'visible';
  };
  const go = d => {
    const n = i + d;
    if (n < 0) return;
    if (n >= SLIDES.length) { finish(); return; }
    haptic.select();
    i = n;
    draw(d);
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
