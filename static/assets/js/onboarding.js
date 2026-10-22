// Приветствие для новых (банк привычек v2): 3 экрана —
//   1) маскот здоровается и рассказывает, что здесь есть;
//   2) «С чего начнём?» — 2–3 сферы из 8 (минимум 1, максимум 3);
//   3) первые привычки из каталога для выбранных сфер (до 3) или своя.
// Отметка «уже видел» хранится на сервере (users.onboarded) — «Позже» тоже её
// ставит, чтобы не показывать повторно. Повторно открывается из Профиля.

import { h, clear, plural } from './dom.js';
import { api } from './api.js';
import { haptic, pushBack } from './tg.js';
import { myMascot, jump } from './mascot.js';
import { setState, refreshState } from './store.js';
import { toast, toastError, busy, confetti } from './ui.js';
import { loadCatalog, catalogCard, fromCatalog, openHabitEditor } from './habitui.js';

const MAX_SPHERES = 3;
const MAX_HABITS = 3;

const feature = (emoji, color, title, text) => h('div', { class: `onb-feature c-${color}` },
  h('span', { class: 'onb-feature-emoji', 'aria-hidden': 'true' }, emoji),
  h('div', { class: 'grow' }, h('div', { class: 'bold' }, title), h('div', { class: 'small onb-feature-text' }, text)));

export function showOnboarding({ onDone, go } = {}) {
  let i = 0;
  let cat = [];
  const chosen = [];           // ключи сфер — в порядке выбора
  const picked = new Map();    // ключ привычки → привычка каталога
  const STEPS = 3;

  const slideHost = h('div', { class: 'onb-slide-host' });
  const dots = h('div', { class: 'onb-dots', role: 'tablist', 'aria-label': 'Шаги приветствия' });
  const back = h('button', { type: 'button', class: 'btn ghost small' }, 'Назад');
  const next = h('button', { type: 'button', class: 'btn grow' }, 'Начнём');
  const skip = h('button', { type: 'button', class: 'onb-skip' }, 'Позже');
  const overlay = h('div', { class: 'onboarding', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Добро пожаловать в LifeQuest' },
    h('div', { class: 'onb-top' }, h('span', { class: 'onb-brand' }, 'LIFEQUEST'), skip),
    slideHost, dots, h('div', { class: 'row onb-actions' }, back, next));

  let release = null;
  const close = () => { overlay.remove(); release && release(); };
  const markSeen = async () => {
    try { setState(await api.settings({ onboarded: true })); } catch (e) { /* не страшно — покажем ещё раз */ }
  };
  // «Позже»: просто закрываем и больше не показываем
  const later = async () => { close(); haptic.tap(); await markSeen(); onDone && onDone(); };

  // Сохранить выбор: включить сферы и создать выбранные привычки
  const save = async () => {
    if (chosen.length) await api.enableSpheres(chosen);
    if (picked.size) await api.createHabits([...picked.values()].map(fromCatalog));
    await markSeen();
    await refreshState().catch(() => {});
  };
  const celebrateHome = () => {
    if (go) go('home');
    setTimeout(() => {
      const pet = document.querySelector('main:not([hidden]) .mascot');
      if (pet) jump(pet);
      confetti(70);
      haptic.success();
    }, 350);
  };

  const slideShell = (dir, color, parts) => h('section', {
    class: `onb-slide c-${color} ${i > 0 ? 'picker' : ''} ${dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : ''}`, 'aria-live': 'polite' }, parts);

  const hello = dir => slideShell(dir, 'pink', [
    h('div', { class: 'onb-hero' }, myMascot('love', { size: 110, cls: 'jump' })),
    h('h1', { class: 'onb-title' }, 'Привет! Я буду рядом'),
    h('p', { class: 'onb-lead' }, 'Здесь маленькие шаги складываются в привычки. Получилось — радуемся вместе, не получилось — бывает, завтра новый день.'),
    h('div', { class: 'stack-sm' },
      feature('🌱', 'lime', 'Привычки', 'Свои маленькие ритуалы — по расписанию и с напоминаниями.'),
      feature('✨', 'purple', 'Квесты', 'Необычные задания, когда захочется чего-то нового.'),
      feature('⚔️', 'orange', 'Дуэли с друзьями', 'Позови друга — держать привычку вдвоём веселее.')),
  ]);

  const spheresSlide = dir => {
    const grid = h('div', { class: 'hb2-tpl-grid' }, cat.map(sp => {
      const on = chosen.includes(sp.key);
      const b = h('button', { type: 'button', class: `hb2-tpl ${on ? 'on' : ''} c-${sp.color}`, 'aria-pressed': String(on) },
        h('span', { class: 'hb2-tpl-title' }, `${sp.emoji} ${sp.name}`),
        h('span', { class: 'hb2-tpl-hint' }, sp.habits.slice(0, 2).map(x => x.title.toLowerCase()).join(', ')),
        on ? h('span', { class: 'hb2-tpl-check', 'aria-hidden': 'true' }, '✓') : null);
      b.addEventListener('click', () => {
        haptic.select();
        if (on) chosen.splice(chosen.indexOf(sp.key), 1);
        else if (chosen.length < MAX_SPHERES) chosen.push(sp.key);
        else { toast(`Для начала хватит ${MAX_SPHERES} — остальные добавишь потом в сферах 🙂`); return; }
        // привычки из снятых сфер больше не выбраны
        for (const [k, t] of picked) if (!chosen.includes(t.sphere)) picked.delete(k);
        draw(0);
      });
      return b;
    }));
    return slideShell(dir, 'lime', [
      h('div', { class: 'onb-step' }, `Шаг 2 из ${STEPS}`),
      h('h1', { class: 'onb-title' }, 'С чего начнём?'),
      h('p', { class: 'onb-lead' }, 'Выбери 2–3 сферы. Остальные никуда не денутся — добавишь, когда захочется.'),
      h('div', { class: 'onb-step', style: { textAlign: 'center' }, 'aria-live': 'polite' }, `Выбрано: ${chosen.length} из ${MAX_SPHERES}`),
      grid,
    ]);
  };

  const habitsSlide = dir => {
    const groups = cat.filter(sp => chosen.includes(sp.key)).map(sp => h('div', null,
      h('div', { class: 'cal2-label' }, `${sp.emoji} ${sp.name}`),
      h('div', { class: 'hb2-tpl-grid' }, sp.habits.map(t => catalogCard(t, {
        on: picked.has(t.key),
        onClick: () => {
          haptic.select();
          if (picked.has(t.key)) picked.delete(t.key);
          else if (picked.size < MAX_HABITS) picked.set(t.key, t);
          else { toast(`На старт — не больше ${MAX_HABITS}. Маленькие шаги работают лучше 🙂`); return; }
          draw(0);
        },
      })))));
    const own = h('button', { type: 'button', class: 'cal2-link' }, '✏️ Или придумай свою');
    own.addEventListener('click', busy(own, async () => {
      try {
        await save();
        close();
        onDone && onDone();
        if (go) go('home');
        openHabitEditor(null, { preset: { sphere: chosen[0] || null }, onSaved: () => refreshState().catch(() => {}) });
      } catch (e) { toastError(e); }
    }));
    return slideShell(dir, 'purple', [
      h('div', { class: 'onb-step' }, `Шаг 3 из ${STEPS}`),
      h('h1', { class: 'onb-title' }, 'Первые привычки'),
      h('p', { class: 'onb-lead' }, `Выбери до ${MAX_HABITS} — маленькие шаги работают лучше всего. Остальное добавишь потом.`),
      h('div', { class: 'onb-step', style: { textAlign: 'center' }, 'aria-live': 'polite' }, `Выбрано: ${picked.size} из ${MAX_HABITS}`),
      h('div', { class: 'stack-sm' }, groups),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, own),
    ]);
  };

  const draw = (dir = 0) => {
    const slide = i === 0 ? hello(dir) : i === 1 ? spheresSlide(dir) : habitsSlide(dir);
    clear(slideHost).append(slide);
    clear(dots).append(...Array.from({ length: STEPS }, (_, k) => h('span', { class: `onb-dot ${k === i ? 'on' : ''}`, 'aria-hidden': 'true' })));
    dots.setAttribute('aria-label', `Шаг ${i + 1} из ${STEPS}`);
    back.style.display = i === 0 ? 'none' : '';
    const n = picked.size;
    next.textContent = i === 0 ? 'Начнём'
      : i === 1 ? 'Дальше'
      : n ? `Добавить ${n} ${plural(n, 'привычку', 'привычки', 'привычек')}` : 'Начать без привычек';
    next.disabled = i === 1 && !chosen.length;
  };

  const finish = busy(next, async () => {
    try {
      await save();
      close();
      onDone && onDone();
      celebrateHome();
      toast(picked.size ? 'Готово! Первые привычки уже на Главной 🎉' : 'Готово! Привычки можно добавить в любой момент 🌱', 'good', 2600);
    } catch (e) { toastError(e); }
  });

  const step = async d => {
    const n = i + d;
    if (n < 0) return;
    if (i === 1 && d > 0 && !chosen.length) { toast('Выбери хотя бы одну сферу'); return; }
    if (n >= STEPS) { finish(); return; }
    haptic.select();
    i = n;
    draw(d);
  };
  next.addEventListener('click', () => step(1));
  back.addEventListener('click', () => step(-1));
  skip.addEventListener('click', later);

  // свайп между экранами
  let sx = null, sy = null;
  slideHost.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  slideHost.addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && i < STEPS - 1) step(1);
      if (dx > 0) step(-1);
    }
  });

  document.body.append(overlay);
  release = pushBack(() => (i > 0 ? step(-1) : later()));
  draw();
  loadCatalog().then(c => { cat = c; if (i > 0) draw(0); }).catch(e => toastError(e));
}
