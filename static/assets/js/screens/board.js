// ③ Карта недели 3×3: свои задачи на неделю, отметки, линии и полная карта
// дают XP; награда, оценка недели и заметки. Сохраняется автоматически.

import { h, clear } from '../dom.js';
import { haptic } from '../tg.js';
import { api } from '../api.js';
import { mascot, jump, stickerEl } from '../mascot.js';
import { skeleton, toast, toastError, confetti, sectionTitle, sheet } from '../ui.js';
import { openPlanEditor, todayIso } from '../planui.js';
import { photoStrip, photosEnabled } from '../photoui.js';
import { celebrate } from '../celebrate.js';
import { refreshState } from '../store.js';

const CELL_THEMES = [
  { label: 'Привычка', placeholder: 'Полезная привычка, которую будешь соблюдать каждый день', color: 'blue' },
  { label: 'Новое', placeholder: 'Что-то новое, что попробуешь на этой неделе', color: 'lav' },
  { label: 'Тема', placeholder: 'Тема, которую изучишь', color: 'yellow' },
  { label: 'Тело', placeholder: 'Забота о теле — спорт, сон, здоровье', color: 'lime' },
  { label: 'Главное дело', placeholder: 'Самое сложное дело недели', center: true, color: 'pink' },
  { label: 'Творчество', placeholder: 'Что-то, что ты создашь', color: 'orange' },
  { label: 'Смелость', placeholder: 'Шаг, который давно откладываешь', color: 'red' },
  { label: 'Забота', placeholder: 'Приятное для близкого человека', color: 'purple' },
  { label: 'Отдых', placeholder: 'То, что вернёт силы', color: 'paleyellow' },
];
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const RATING_WORDS = ['', 'Тяжёлая неделя', 'Непросто', 'Так себе', 'Бывало лучше', 'Нормально', 'Неплохо', 'Хорошо', 'Очень хорошо', 'Отлично!', 'Лучшая неделя!'];

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
    el.append(h('div', { class: 'empty' }, mascot('cat-blue', 'sad', { size: 90 }), h('p', null, e.message), retry));
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

  petEl = mascot(full ? 'star' : 'cat-purple', full ? 'love' : doneCount ? 'happy' : 'wink', { size: 56 });
  el.append(h('header', { class: 'page-head' }, petEl,
    h('div', null, h('h1', null, 'Карта недели'), h('p', null, data.week_range))));

  if (full) {
    el.append(h('div', { class: 'card tinted c-lime center', style: { marginBottom: '14px' }, role: 'status' },
      h('h2', null, '🎉 Бинго! Карта закрыта'),
      board.reward.trim() ? h('p', { class: 'bold', style: { marginTop: '6px' } }, `Награда ждёт: ${board.reward}`) : null));
  }

  // Прогресс-челлендж недели
  el.append(h('section', { class: 'card', style: { marginBottom: '14px' } },
    h('div', { class: 'spread' },
      h('div', null, h('div', { class: 'small bold muted' }, 'ЧЕЛЛЕНДЖ НЕДЕЛИ'),
        h('div', { class: 'bold' }, `${doneCount} из 9 клеток · ${lines.length} ${lines.length === 1 ? 'линия' : lines.length >= 2 && lines.length <= 4 ? 'линии' : 'линий'}`)),
      h('div', { class: 'tiny bold muted', style: { textAlign: 'right' } }, 'клетка +3 XP', h('br'), 'линия +8 · карта +30'))));

  // Сетка
  const grid = h('div', { class: 'board-grid' });
  CELL_THEMES.forEach((theme, i) => {
    const inLine = lines.some(l => l.includes(i));
    const cell = h('div', { class: `board-cell c-${theme.color} ${ok[i] ? 'done' : ''} ${inLine ? 'in-line' : ''} ${theme.center ? 'is-center' : ''}` });
    const label = h('div', { class: 'cell-label' }, theme.label);
    const ta = h('textarea', { rows: theme.center ? 4 : 3, maxlength: '80', placeholder: theme.placeholder, 'aria-label': theme.label });
    ta.value = board.cells[i] || '';
    ta.addEventListener('input', () => { board.cells[i] = ta.value; scheduleSave(el, 900); });
    ta.addEventListener('blur', () => { if (saveTimer) scheduleSave(el, 0); });
    const check = h('button', { type: 'button', class: 'cell-check', 'aria-pressed': String(Boolean(board.done[i])),
      'aria-label': board.done[i] ? `Снять отметку: ${theme.label}` : `Отметить выполненным: ${theme.label}` },
      board.done[i] ? '✓' : '');
    check.addEventListener('click', () => {
      if (!board.cells[i].trim()) { haptic.warning(); toast('Сначала впиши задачу в клетку ✍️'); ta.focus(); return; }
      board.done[i] = !board.done[i];
      haptic.tap(board.done[i] ? 'medium' : 'light');
      scheduleSave(el, 0, true);
    });
    const sticker = h('div', { class: 'cell-sticker', 'aria-hidden': 'true' }, stickerEl((i + 1) / 10));
    cell.append(label, ta, sticker, check);
    grid.append(cell);
  });
  el.append(grid);

  // Награда
  const reward = h('input', { class: 'input', type: 'text', maxlength: '80', placeholder: 'Чем наградишь себя за полную карту?', 'aria-label': 'Награда за неделю' });
  reward.value = board.reward;
  reward.addEventListener('input', () => { board.reward = reward.value; scheduleSave(el, 900); });
  el.append(sectionTitle('🎁 Награда'), h('div', { class: 'card tinted c-paleyellow' }, reward));

  // Оценка недели + заметки
  const stars = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'Оценка недели от 1 до 10' });
  for (let n = 1; n <= 10; n++) {
    const s = h('button', { type: 'button', class: `star-btn ${n <= board.rating ? 'on' : ''}`, role: 'radio',
      'aria-checked': String(n === board.rating), 'aria-label': `${n} из 10` }, h('span', { 'aria-hidden': 'true' }));
    s.addEventListener('click', () => { haptic.select(); board.rating = n; scheduleSave(el, 0, true); });
    stars.append(s);
  }
  const notes = h('textarea', { class: 'input', rows: 3, maxlength: '300', placeholder: 'Что получилось, а что нет? Пара слов для себя.', 'aria-label': 'Заметки' });
  notes.value = board.notes;
  notes.addEventListener('input', () => { board.notes = notes.value; scheduleSave(el, 900); });
  el.append(sectionTitle('⭐ Итоги недели'), h('div', { class: 'card tinted c-purple stack-sm' }, stars,
    h('div', { class: 'bold small', style: { color: 'var(--purple-deep)' } }, board.rating ? `${board.rating}/10 — ${RATING_WORDS[board.rating]}` : 'Оцени неделю от 1 до 10'),
    notes));

  // Клетки карты на даты календаря и фото клеток
  const filled = CELL_THEMES.map((t, i) => ({ t, i, text: board.cells[i].trim() })).filter(x => x.text);
  if (filled.length) {
    el.append(sectionTitle('📅 Клетки в календарь и фото'),
      h('p', { class: 'tiny muted bold', style: { margin: '-4px 2px 8px' } }, 'Поставь задачу из клетки на конкретный день — выполнив план, закроешь и клетку.'),
      h('div', { class: 'chips' }, filled.map(x => {
        const b = h('button', { type: 'button', class: `chip c-${x.t.color}` }, `${x.t.label}: ${x.text.slice(0, 18)}${x.text.length > 18 ? '…' : ''}`);
        b.addEventListener('click', () => { haptic.tap(); openCellSheet(x); });
        return b;
      })));
  }
  statusEl = h('p', { class: 'center tiny muted bold', style: { marginTop: '14px' }, role: 'status', 'aria-live': 'polite' }, 'Карта сохраняется автоматически');
  el.append(statusEl, h('p', { class: 'center tiny muted', style: { marginTop: '4px' } }, 'Отмечай клетку кнопкой в углу. В понедельник начнётся новая карта.'));
}

function openCellSheet(x) {
  const planBtn = h('button', { type: 'button', class: 'btn block' }, '📅 Поставить на дату');
  const s = sheet(h('div', { class: 'stack' },
    h('h2', null, `${x.t.label}: ${x.text}`),
    planBtn,
    photosEnabled() ? h('div', null, h('h3', { style: { marginBottom: '8px' } }, '📷 Фото клетки'),
      photoStrip({ target: 'board', board_cell: x.i }, { title: 'Фото клетки' })) : null), { label: x.t.label });
  planBtn.addEventListener('click', () => {
    s.close();
    openPlanEditor({ date: todayIso(), boardCell: x.i, preset: { title: x.text, color: x.t.color === 'paleyellow' ? 'yellow' : x.t.color } });
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
