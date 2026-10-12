// Приветствие при первом открытии: миссия и возможности LifeQuest в 5 слайдах.
// Отметка «уже видел» хранится на сервере (users.onboarded) — работает на
// любом устройстве. Повторно открывается из Профиля.

import { h, clear } from './dom.js';
import { api } from './api.js';
import { haptic, pushBack } from './tg.js';
import { mascot } from './mascot.js';
import { setState } from './store.js';
import { MODE_INFO } from './ui.js';

const feature = (emoji, color, title, text) => h('div', { class: `onb-feature c-${color}` },
  h('span', { class: 'onb-feature-emoji', 'aria-hidden': 'true' }, emoji),
  h('div', { class: 'grow' }, h('div', { class: 'bold' }, title), h('div', { class: 'small onb-feature-text' }, text)));

const SLIDES = [
  {
    color: 'pink', kind: 'cat-purple', expr: 'love',
    title: 'Привет! Это LifeQuest',
    lead: 'Дни часто похожи друг на друга. Наша миссия — помочь тебе выбираться из привычного сценария и превращать обычные дни в маленькие приключения, которые хочется запомнить.',
    body: () => [
      feature('✨', 'yellow', 'Маленькие шаги', 'Задания на 15 минут или на целый день — без марафонов и давления.'),
      feature('🌿', 'lime', 'Без чувства вины', 'Не успелось — бывает. Перенеси или отпусти, LifeQuest не ругается.'),
    ],
  },
  {
    color: 'purple', kind: 'star', expr: 'wink',
    title: 'Задания трёх форматов',
    lead: 'Нажми кнопку — я покручу рулетку и подкину что-нибудь странное и классное. Не понравилось — возьмём другое.',
    body: () => ['solo', 'pair', 'company'].map(m => feature(MODE_INFO[m].emoji, MODE_INFO[m].color, MODE_INFO[m].label,
      { solo: 'Приключение для себя: смелость, творчество, энергия и ещё 3 сферы.', pair: 'Свидания и вызовы на двоих, которые никто не повторит.',
        company: 'Авантюры для друзей, о которых они не просили.' }[m])),
  },
  {
    color: 'lime', kind: 'cat-lime', expr: 'happy',
    title: 'Привычки и карта недели',
    lead: 'Собирай свои ритуалы и ставь цели на неделю.',
    body: () => [
      feature('🌱', 'lime', 'Трекер привычек', 'Придумай свои привычки, задай, сколько раз в день, и отмечай +/−.'),
      feature('🗺️', 'blue', 'Карта недели 3×3', '9 своих задач на неделю. Собери линию или всю карту — получи бонус.'),
    ],
  },
  {
    color: 'blue', kind: 'cat-blue', expr: 'surprised',
    title: 'Календарь и воспоминания',
    lead: 'Планируй задания и дела на конкретные дни — бот напомнит в нужное время.',
    body: () => [
      feature('🗓️', 'blue', 'Календарь планов', 'Задание из банка или свой план, повторы и напоминания в чат.'),
      feature('📷', 'pink', 'Фото-воспоминания', 'Прикрепляй фото к заданиям и дням — их видишь только ты.'),
    ],
  },
  {
    color: 'yellow', kind: 'heart', expr: 'love',
    title: 'Расти и собирай награды',
    lead: 'Каждое выполненное задание приносит XP. Чем больше приключений — тем выше уровень.',
    body: () => [
      feature('🔥', 'orange', 'Серия дней', 'Делай хотя бы одно задание в день. Раз в неделю пропуск прощается ❄️'),
      feature('🏆', 'purple', 'Уровни и ачивки', 'Уровни открывают новых маскотов — от лягушонка до панды. И 40+ ачивок.'),
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
    clear(slideHost).append(h('section', { class: `onb-slide c-${s.color} ${dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : ''}`, 'aria-live': 'polite' },
      h('div', { class: 'onb-hero' }, mascot(s.kind, s.expr, { size: 110, cls: 'jump' })),
      h('h1', { class: 'onb-title' }, s.title),
      h('p', { class: 'onb-lead' }, s.lead),
      h('div', { class: 'stack-sm' }, s.body())));
    clear(dots).append(...SLIDES.map((_, k) => h('span', { class: `onb-dot ${k === i ? 'on' : ''}`, 'aria-hidden': 'true' })));
    dots.setAttribute('aria-label', `Шаг ${i + 1} из ${SLIDES.length}`);
    back.style.display = i === 0 ? 'none' : '';
    next.textContent = i === SLIDES.length - 1 ? 'Поехали! 🚀' : 'Дальше';
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
