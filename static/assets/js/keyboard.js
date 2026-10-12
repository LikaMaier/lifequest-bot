// Клавиатура на телефоне: у многострочных полей в iOS нет кнопки «Готово»,
// а Telegram сам не прячет клавиатуру по тапу мимо — она «застревает».
// Поэтому: тап вне поля или прокрутка страницы — клавиатура прячется;
// Enter в поиске — тоже. Пока клавиатура открыта, нижнее меню скрыто,
// чтобы не висело над ней.

import { tg } from './tg.js';

const TEXT_INPUT = 'input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, [contenteditable="true"]';

const isTextField = el => Boolean(el && el.matches && el.matches(TEXT_INPUT));

export function hideKeyboard() {
  const el = document.activeElement;
  if (isTextField(el)) el.blur();
  try { if (tg && tg.hideKeyboard) tg.hideKeyboard(); } catch (e) { /* старый клиент */ }
}

export function initKeyboard() {
  const root = document.documentElement;
  document.addEventListener('focusin', e => { if (isTextField(e.target)) root.classList.add('kb-open'); });
  document.addEventListener('focusout', () => {
    // фокус может перейти в соседнее поле — проверяем после переключения
    setTimeout(() => { if (!isTextField(document.activeElement)) root.classList.remove('kb-open'); }, 60);
  });

  // Тап мимо поля: прячем клавиатуру. Кнопки внутри того же блока (например,
  // «Сохранить» у заметки или галочка плана) продолжают работать как обычно.
  let start = null;
  document.addEventListener('touchstart', e => {
    start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target } : null;
  }, { passive: true, capture: true });
  document.addEventListener('touchend', e => {
    if (!start || !isTextField(document.activeElement)) return;
    const t = e.changedTouches[0];
    const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y) > 12;
    const target = start.target;
    start = null;
    if (isTextField(target) || target.closest('label')) return; // по полю: курсор, выделение, другое поле
    if (moved) { hideKeyboard(); return; } // прокрутка страницы — прячем
    if (target.closest('button, a, [role=button], select')) return; // нажатие на кнопку — обработает кнопка
    hideKeyboard();
  }, { passive: true, capture: true });

  // Enter в однострочном поиске — закрыть клавиатуру.
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('input[type=search]')) {
      e.preventDefault();
      hideKeyboard();
    }
  });
}
