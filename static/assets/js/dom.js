// Мини-помощник для DOM. Пользовательский текст попадает в страницу только
// как текстовые узлы — innerHTML используется лишь для SVG-констант из кода.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'html') el.innerHTML = value; // только доверенные SVG-строки
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, value);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Элемент из доверенной SVG-строки (иконки, маскоты, графики). */
export function svgEl(markup, cls) {
  const wrap = document.createElement('span');
  if (cls) wrap.className = cls;
  wrap.innerHTML = markup;
  return wrap;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** Экранирование для текста внутри SVG-строк (подписи графиков). */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function parseDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const fmtDay = iso => { const d = parseDate(iso); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`; };
export const fmtMonth = iso => { const d = parseDate(iso); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
export const weekday = iso => WEEKDAYS[parseDate(iso).getDay()];
