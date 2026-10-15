// Приветствие при первом открытии: 3 шага — что такое LifeQuest, выбор
// первых привычек из шаблонов и квесты-бонус.
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
    title: 'Привет! Это LifeQuest',
    lead: 'Трекер привычек и планер, который не ругает, а играет с тобой. Маленькие шаги каждый день — и большие перемены.',
    body: () => [
      feature('🌱', 'lime', 'Привычки', 'Свои ритуалы по расписанию, серии и напоминания в чат.'),
      feature('🗓️', 'blue', 'План дня', 'Дела по времени, главное дело дня и напоминания.'),
      feature('🌿', 'yellow', 'Без чувства вины', 'Не успелось — бывает. Перенеси, пропусти или поставь паузу.'),
    ],
  },
  {
    color: 'lime', kind: 'cat-lime', expr: 'happy', picker: true,
    title: 'С чего начнём?',
    lead: 'Выбери до 3 привычек — маленькие шаги работают лучше. Остальное добавишь потом.',
  },
  {
    color: 'purple', kind: 'star', expr: 'wink',
    title: 'А ещё — приключения',
    lead: 'Когда захочется чего-то нового, я подкину квест: для себя, на двоих или для компании.',
    body: () => [
      feature('✨', 'purple', 'Квесты-бонус', 'Необычные задания на 15 минут или на целый день.'),
      feature('📷', 'pink', 'Воспоминания', 'Фото с квестов и дней — полароиды в альбоме.'),
      feature('🔥', 'orange', 'Серия и маскот', 'Делай привычки — маскот радуется, серия растёт.'),
    ],
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
  const finish = async () => {
    overlay.remove();
    release && release();
    haptic.success();
    try { setState(await api.settings({ onboarded: true })); } catch (e) { /* не страшно — покажем ещё раз */ }
    onDone && onDone();
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
    next.textContent = i === SLIDES.length - 1 ? 'Поехали! 🚀' : SLIDES[i].picker ? 'Позже' : 'Дальше';
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
  skip.addEventListener('click', finish);

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
