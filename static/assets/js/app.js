// Точка входа: Telegram, загрузка состояния, таб-бар и роутинг экранов.

import { h, clear } from './dom.js';
import { initTelegram, isTelegram, haptic, pushBack, hideMainButton } from './tg.js';
import { ICONS } from './icons.js';
import { mascot } from './mascot.js';
import { skeleton } from './ui.js';
import { store, onState, refreshState } from './store.js';

// Экраны подгружаются лениво — модуль экрана грузится при первом открытии.
const SCREENS = {
  home: { title: 'Главная', icon: ICONS.home, load: () => import('./screens/home.js') },
  quests: { title: 'Квесты', icon: ICONS.quests, load: () => import('./screens/quests.js') },
  habits: { title: 'Привычки', icon: ICONS.habits, load: () => import('./screens/habits.js') },
  board: { title: 'Карта', icon: ICONS.board, load: () => import('./screens/board.js') },
  progress: { title: 'Прогресс', icon: ICONS.progress, load: () => import('./screens/progress.js') },
  calendar: { title: 'Календарь', icon: ICONS.calendar, load: () => import('./screens/calendar.js') },
  awards: { title: 'Награды', sub: true, load: () => import('./screens/awards.js') },
  album: { title: 'Альбом', sub: true, load: () => import('./screens/album.js') },
  profile: { title: 'Профиль', sub: true, load: () => import('./screens/profile.js') },
  premium: { title: 'Premium', sub: true, load: () => import('./screens/profile.js'), entry: 'renderPremium' },
};
const TABS = ['home', 'quests', 'calendar', 'habits', 'board', 'progress'];

const root = document.getElementById('app');
const mounted = {}; // name -> { el, module, dirty }
let current = null;
let lastTab = 'home';
let releaseBack = null;
let tabbar;

function buildTabbar() {
  tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Разделы' },
    TABS.map(name => {
      const b = h('button', { type: 'button', class: 'tab', dataset: { tab: name }, 'aria-label': SCREENS[name].title },
        h('span', { html: SCREENS[name].icon, 'aria-hidden': 'true' }), h('span', null, SCREENS[name].title));
      b.addEventListener('click', () => { haptic.select(); go(name); });
      return b;
    }));
  document.body.append(tabbar);
}

function markTab(name) {
  for (const b of tabbar.querySelectorAll('.tab')) {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}

async function mount(name) {
  const def = SCREENS[name];
  if (mounted[name] && !mounted[name].dirty) return mounted[name];
  let entry = mounted[name];
  if (!entry) {
    const el = h('main', { class: 'screen', 'aria-label': def.title });
    el.append(skeleton(56), h('div', { style: { height: '14px' } }), skeleton(180), h('div', { style: { height: '14px' } }), skeleton(120));
    root.append(el);
    entry = mounted[name] = { el, module: null, dirty: true };
  }
  if (!entry.module) entry.module = await def.load();
  const render = entry.module[def.entry || 'render'];
  entry.dirty = false;
  await render(entry.el, { go, state: store.state });
  return entry;
}

export async function go(name, { replace = false } = {}) {
  if (!SCREENS[name]) name = 'home';
  hideMainButton();
  const def = SCREENS[name];
  const from = current;
  if (!def.sub) lastTab = name;
  if (current && mounted[current]) mounted[current].el.hidden = true;
  current = name;
  markTab(def.sub ? lastTab : name);
  const target = `#${name}`;
  if (location.hash !== target) history[replace ? 'replaceState' : 'pushState'](null, '', target);

  if (releaseBack) { releaseBack(); releaseBack = null; }
  // «Назад» с вложенного экрана — туда, откуда пришли (или на последнюю вкладку).
  if (def.sub) {
    const back = from && from !== name && SCREENS[from] ? from : lastTab;
    releaseBack = pushBack(() => go(back));
  }

  const entry = mounted[name];
  if (entry) entry.el.hidden = false;
  try {
    const m = await mount(name);
    if (current === name) { m.el.hidden = false; window.scrollTo(0, 0); }
  } catch (e) {
    console.error(e);
  }
}

// После любого изменения состояния: видимый экран перерисовываем,
// остальные помечаем «грязными» — перерисуются при открытии.
onState(() => {
  for (const [name, entry] of Object.entries(mounted)) {
    if (name === current) {
      const def = SCREENS[name];
      const update = entry.module && (entry.module[def.update || 'update'] || entry.module[def.entry || 'render']);
      if (update) update(entry.el, { go, state: store.state });
    } else {
      entry.dirty = true;
    }
  }
});

function fullscreen(kind, expr, title, text, action) {
  clear(root);
  if (tabbar) tabbar.hidden = true;
  root.append(h('div', { class: 'fullscreen-msg' }, mascot(kind, expr, { size: 120, cls: expr === 'sad' ? 'wiggle' : '' }),
    h('h2', null, title), h('p', { class: 'muted bold' }, text), action || null));
}

async function boot() {
  initTelegram();
  if (!isTelegram()) {
    fullscreen('cat-lav', 'surprised', 'Открой LifeQuest в Telegram',
      'Приложение работает внутри бота: нажми кнопку «Открыть LifeQuest» в чате с ботом.');
    return;
  }
  clear(root);
  root.append(h('div', { class: 'screen' }, skeleton(56), h('div', { style: { height: '14px' } }), skeleton(200), h('div', { style: { height: '14px' } }), skeleton(130)));
  try {
    await refreshState();
  } catch (e) {
    const retry = h('button', { type: 'button', class: 'btn' }, 'Повторить');
    retry.addEventListener('click', () => { haptic.tap(); boot(); });
    fullscreen('cat-blue', 'sad', 'Не получилось загрузиться',
      e.status === 401 ? 'Сессия устарела — закрой и снова открой приложение из бота.' : (e.message || 'Сервер не отвечает.'), retry);
    return;
  }
  clear(root);
  if (!tabbar) buildTabbar();
  tabbar.hidden = false;
  const start = (location.hash || '#home').slice(1);
  go(SCREENS[start] ? start : 'home', { replace: true });
  // Первое открытие — приветствие с миссией и возможностями.
  if (!store.state.user.onboarded) import('./onboarding.js').then(m => m.showOnboarding());
}

window.addEventListener('popstate', () => {
  const name = (location.hash || '#home').slice(1);
  if (name !== current && store.state) go(name, { replace: true });
});
document.addEventListener('visibilitychange', () => {
  // Вернулись в приложение (например, после выполнения задания из чата) — обновим данные.
  if (document.visibilityState === 'visible' && store.state) refreshState().catch(() => {});
});

boot();
