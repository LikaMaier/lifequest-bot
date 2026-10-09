// Обёртка над Telegram.WebApp: работает и вне Telegram (для отладки в браузере).

export const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    // Цвета шапки/фона — под кремовый фон приложения (тёмную тему не делаем).
    if (tg.setHeaderColor) tg.setHeaderColor('#FDF7DE');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#FDF7DE');
    if (tg.setBottomBarColor) tg.setBottomBarColor('#FDF7DE');
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  } catch (e) { /* старые клиенты без части методов */ }
}

export const initData = () => (tg && tg.initData) || '';
export const tgUser = () => (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
export const isTelegram = () => Boolean(initData());

export const haptic = {
  tap(style = 'light') { try { tg && tg.HapticFeedback.impactOccurred(style); } catch (e) {} },
  success() { try { tg && tg.HapticFeedback.notificationOccurred('success'); } catch (e) {} },
  error() { try { tg && tg.HapticFeedback.notificationOccurred('error'); } catch (e) {} },
  warning() { try { tg && tg.HapticFeedback.notificationOccurred('warning'); } catch (e) {} },
  select() { try { tg && tg.HapticFeedback.selectionChanged(); } catch (e) {} },
};

// BackButton: стек обработчиков — закрываем верхний лист/экран.
const backStack = [];
function syncBack() {
  if (!tg || !tg.BackButton) return;
  if (backStack.length) tg.BackButton.show(); else tg.BackButton.hide();
}
if (tg && tg.BackButton) {
  tg.BackButton.onClick(() => {
    const top = backStack[backStack.length - 1];
    if (top) top();
  });
}
export function pushBack(handler) {
  backStack.push(handler);
  syncBack();
  return () => {
    const i = backStack.lastIndexOf(handler);
    if (i >= 0) backStack.splice(i, 1);
    syncBack();
  };
}

// MainButton — нативная кнопка Telegram внизу экрана.
let mainHandler = null;
export function showMainButton(text, handler, color) {
  if (!tg || !tg.MainButton) return false;
  if (mainHandler) tg.MainButton.offClick(mainHandler);
  mainHandler = handler;
  tg.MainButton.setParams({ text, color: color || '#FB4645', text_color: '#ffffff', is_visible: true, is_active: true });
  tg.MainButton.onClick(handler);
  return true;
}
export function hideMainButton() {
  if (!tg || !tg.MainButton) return;
  if (mainHandler) tg.MainButton.offClick(mainHandler);
  mainHandler = null;
  tg.MainButton.hide();
}

export function openTgLink(url) {
  if (tg && tg.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}
