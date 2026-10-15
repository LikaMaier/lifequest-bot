// Цели месяца 3×3 (раньше — карта недели): свои цели на месяц, отметки,
// линии и полная карта дают XP; награда, оценка месяца и заметки.
// Клетка открывается в редакторе: название, содержимое, дата и фото.

import { h, clear } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { mascot, jump, stickerEl, myMascot } from '../mascot.js';
import { skeleton, toast, toastError, confetti, sectionTitle, sheet } from '../ui.js';
import { openPlanEditor, todayIso } from '../planui.js';
import { photoStrip, photosEnabled } from '../photoui.js';
import { celebrate } from '../celebrate.js';
import { refreshState } from '../store.js';

const CELL_THEMES = [
  { label: 'Привычка', placeholder: 'Полезная привычка, которую будешь соблюдать каждый день', color: 'blue' },
  { label: 'Новое', placeholder: 'Что-то новое, что попробуешь в этом месяце', color: 'lav' },
  { label: 'Тема', placeholder: 'Тема, которую изучишь', color: 'yellow' },
  { label: 'Тело', placeholder: 'Забота о теле — спорт, сон, здоровье', color: 'lime' },
  { label: 'Главное дело', placeholder: 'Самое важное дело месяца', center: true, color: 'pink' },
  { label: 'Творчество', placeholder: 'Что-то, что ты создашь', color: 'orange' },
  { label: 'Смелость', placeholder: 'Шаг, который давно откладываешь', color: 'red' },
  { label: 'Забота', placeholder: 'Приятное для близкого человека', color: 'purple' },
  { label: 'Отдых', placeholder: 'То, что вернёт силы', color: 'paleyellow' },
];
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const RATING_WORDS = ['', 'Тяжёлый месяц', 'Непросто', 'Так себе', 'Бывало лучше', 'Нормально', 'Неплохо', 'Хорошо', 'Очень хорошо', 'Отлично!', 'Лучший месяц!'];

let data = null;      // { board, week_range, progress }
let saveTimer = null;
let saving = Promise.resolve();
let statusEl = null;
let petEl = null;

export async function render(el) {
  clear(el);
  el.append(skeleton(60), h('div', { style: { height: '14px' } }), skeleton(360));
  try {
    data = await api.board();
  } catch (e) {
    clear(el);
    const retry = h('button', { type: 'button', class: 'btn' }, 'Повторить');
    retry.addEventListener('click', () => render(el));
    el.append(h('div', { class: 'empty' }, myMascot('sad', { size: 90 }), h('p', null, e.message), retry));
    return;
  }
  draw(el);
}

// Состояние обновилось из других экранов — карту не перерисовываем, чтобы
// не сбить ввод (у неё свой источник данных).
export function update() {}

function okCells(board) {
  return board.cells.map((c, i) => board.done[i] && c.trim().length > 0);
}

function draw(el) {
  clear(el);
  const board = data.board;
  const ok = okCells(board);
  const lines = LINES.filter(l => l.every(i => ok[i]));
  const doneCount = ok.filter(Boolean).length;
  const full = doneCount === 9;

  petEl = myMascot(full ? 'love' : doneCount ? 'happy' : 'wink', { size: 56 });
  el.append(h('header', { class: 'page-head' }, petEl,
    h('div', null, h('h1', null, 'Цели месяца'), h('p', null, data.week_range))));

  if (full) {
    el.append(h('div', { class: 'card tinted c-lime center', style: { marginBottom: '14px' }, role: 'status' },
      h('h2', null, '🎉 Бинго! Карта закрыта'),
      board.reward.trim() ? h('p', { class: 'bold', style: { marginTop: '6px' } }, `Награда ждёт: ${board.reward}`) : null));
  }

  // Прогресс-челлендж недели
  el.append(h('section', { class: 'card', style: { marginBottom: '14px' } },
    h('div', { class: 'spread' },
      h('div', null, h('div', { class: 'small bold muted' }, 'ЦЕЛИ МЕСЯЦА'),
        h('div', { class: 'bold' }, `${doneCount} из 9 клеток · ${lines.length} ${lines.length === 1 ? 'линия' : lines.length >= 2 && lines.length <= 4 ? 'линии' : 'линий'}`)),
      h('div', { class: 'tiny bold muted', style: { textAlign: 'right' } }, 'клетка +3 XP', h('br'), 'линия +8 · карта +30'))));

  // Сетка: клетка — название и цель; нажатие открывает редактор, угол — отметка
  const grid = h('div', { class: 'board-grid' });
  CELL_THEMES.forEach((theme, i) => {
    const inLine = lines.some(l => l.includes(i));
    const title = cellTitle(board, i);
    const text = (board.cells[i] || '').trim();
    const cell = h('div', { class: `board-cell c-${theme.color} ${ok[i] ? 'done' : ''} ${inLine ? 'in-line' : ''} ${theme.center ? 'is-center' : ''}` });
    const open = h('div', { class: 'cell-open', role: 'button', tabindex: '0', 'aria-label': `${title}: ${text || 'пусто'}. Изменить` },
      h('span', { class: 'cell-label' }, title),
      h('span', { class: `cell-text ${text ? '' : 'ph'}` }, text || theme.placeholder));
    open.addEventListener('click', () => { haptic.tap(); openCellEditor(el, i); });
    open.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCellEditor(el, i); } });
    const check = h('button', { type: 'button', class: 'cell-check', 'aria-pressed': String(Boolean(board.done[i])),
      'aria-label': board.done[i] ? `Снять отметку: ${title}` : `Отметить выполненным: ${title}` },
      board.done[i] ? '✓' : '');
    check.addEventListener('click', () => {
      if (!board.cells[i].trim()) { haptic.warning(); toast('Сначала впиши цель в клетку ✍️'); openCellEditor(el, i); return; }
      board.done[i] = !board.done[i];
      haptic.tap(board.done[i] ? 'medium' : 'light');
      scheduleSave(el, 0, true);
    });
    const sticker = h('div', { class: 'cell-sticker', 'aria-hidden': 'true' }, stickerEl((i + 1) / 10));
    cell.append(open, sticker, check);
    grid.append(cell);
  });
  el.append(grid);

  // Награда
  const reward = h('input', { class: 'input', type: 'text', maxlength: '80', placeholder: 'Чем наградишь себя за полную карту?', 'aria-label': 'Награда за месяц' });
  reward.value = board.reward;
  reward.addEventListener('input', () => { board.reward = reward.value; scheduleSave(el, 900); });
  el.append(sectionTitle('🎁 Награда'), h('div', { class: 'card tinted c-paleyellow' }, reward));

  // Оценка недели + заметки
  const stars = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'Оценка месяца от 1 до 10' });
  for (let n = 1; n <= 10; n++) {
    const s = h('button', { type: 'button', class: `star-btn ${n <= board.rating ? 'on' : ''}`, role: 'radio',
      'aria-checked': String(n === board.rating), 'aria-label': `${n} из 10` }, h('span', { 'aria-hidden': 'true' }));
    s.addEventListener('click', () => { haptic.select(); board.rating = n; scheduleSave(el, 0, true); });
    stars.append(s);
  }
  const notes = h('textarea', { class: 'input', rows: 3, maxlength: '300', placeholder: 'Что получилось, а что нет? Пара слов для себя.', 'aria-label': 'Заметки' });
  notes.value = board.notes;
  notes.addEventListener('input', () => { board.notes = notes.value; scheduleSave(el, 900); });
  el.append(sectionTitle('⭐ Итоги месяца'), h('div', { class: 'card tinted c-purple stack-sm' }, stars,
    h('div', { class: 'bold small', style: { color: 'var(--purple-deep)' } }, board.rating ? `${board.rating}/10 — ${RATING_WORDS[board.rating]}` : 'Оцени месяц от 1 до 10'),
    notes));

  statusEl = h('p', { class: 'center tiny muted bold', style: { marginTop: '14px' }, role: 'status', 'aria-live': 'polite' }, 'Карта сохраняется автоматически');
  el.append(statusEl, h('p', { class: 'center tiny muted', style: { marginTop: '4px' } }, 'Нажми на клетку, чтобы изменить название и цель. Отмечай кнопкой в углу. 1-го числа начнётся новая карта.'));
}

function cellTitle(board, i) {
  return ((board.titles || [])[i] || '').trim() || CELL_THEMES[i].label;
}

/** Редактор клетки: название и цель отдельными полями + дата в календаре и фото. */
function openCellEditor(el, i) {
  const board = data.board;
  const theme = CELL_THEMES[i];
  if (!board.titles) board.titles = Array(9).fill('');
  const title = h('input', { class: 'input', type: 'text', maxlength: '30', placeholder: theme.label,
    value: board.titles[i] || '', 'aria-label': 'Название клетки' });
  const text = h('textarea', { class: 'input', rows: 3, maxlength: '80', placeholder: theme.placeholder, 'aria-label': 'Цель' });
  text.value = board.cells[i] || '';
  const save = h('button', { type: 'button', class: 'btn block' }, 'Сохранить');
  const planBtn = h('button', { type: 'button', class: 'btn ghost block' }, '📅 Поставить на дату');
  const s = sheet(h('div', { class: 'stack' },
    h('h2', null, 'Клетка'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Название'), title),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Цель'), text),
    save, planBtn,
    photosEnabled() ? h('div', null, h('h3', { style: { marginBottom: '8px' } }, '📷 Фото клетки'),
      photoStrip({ target: 'board', board_cell: i }, { title: 'Фото клетки' })) : null), { label: 'Клетка' });
  const apply = () => {
    board.titles[i] = title.value.trim();
    board.cells[i] = text.value;
    if (!board.cells[i].trim()) board.done[i] = false;
  };
  save.addEventListener('click', () => { haptic.success(); apply(); s.close(); scheduleSave(el, 0, true); });
  planBtn.addEventListener('click', () => {
    apply();
    scheduleSave(el, 0, true);
    if (!board.cells[i].trim()) { toast('Сначала впиши цель ✍️'); return; }
    s.close();
    openPlanEditor({ date: todayIso(), boardCell: i, preset: { title: board.cells[i].trim(), color: theme.color === 'paleyellow' ? 'yellow' : theme.color } });
  });
}

function scheduleSave(el, delay, redraw = false) {
  if (statusEl) statusEl.textContent = 'Сохраняю…';
  clearTimeout(saveTimer);
  if (redraw) draw(el);
  saveTimer = setTimeout(() => { saveTimer = null; saving = saving.then(() => save(el)); }, delay);
}

async function save(el) {
  const sent = JSON.parse(JSON.stringify(data.board));
  try {
    const res = await api.saveBoard(sent);
    if (statusEl) statusEl.textContent = 'Сохранено ✓';
    if (res.new_full) {
      haptic.success();
      confetti(200);
      toast(`🎉 Бинго! Вся карта закрыта · +${res.xp} XP`, 'good', 3600);
      draw(el);
      jump(petEl);
    } else if (res.new_lines.length) {
      haptic.success();
      confetti(80);
      toast(`➖ Линия собрана! +${res.xp} XP`, 'good');
      jump(petEl);
    } else if (res.xp) {
      toast(`+${res.xp} XP`, 'good', 1600);
    }
    if (res.xp || (res.new_achievements || []).length) {
      refreshState().catch(() => {});
      await celebrate({ level_up: res.level_up, new_achievements: res.new_achievements });
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Не сохранилось — проверь интернет';
    toastError(e);
  }
}
