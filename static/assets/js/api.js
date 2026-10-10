// Клиент API: каждый запрос несёт подписанный initData Telegram.

import { initData } from './tg.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function timezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
}

async function request(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let resp;
  try {
    resp = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData(),
        'X-Timezone': timezone(),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError('Нет связи с сервером. Проверь интернет и попробуй ещё раз.', 0);
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await resp.json(); } catch (e) { /* не JSON */ }
  if (!resp.ok) {
    const msg = (data && data.error) || (resp.status >= 500 ? 'Сервер приуныл. Попробуй через минутку.' : 'Что-то пошло не так.');
    throw new ApiError(msg, resp.status);
  }
  return data;
}

export const api = {
  state: () => request('GET', 'api/state'),
  random: (mode, sphere) => request('POST', 'api/quest/random', { mode, sphere }),
  accept: (id, tier, daily = false) => request('POST', 'api/quest/accept', { id, tier, daily }),
  complete: activeId => request('POST', 'api/quest/complete', { active_id: activeId }),
  skip: activeId => request('POST', 'api/quest/skip', { active_id: activeId }),
  favorite: (id, on) => request('POST', 'api/favorite', { id, on }),
  stats: range => request('GET', `api/stats?range=${encodeURIComponent(range)}`),
  achievements: () => request('GET', 'api/achievements'),
  board: () => request('GET', 'api/board'),
  saveBoard: board => request('POST', 'api/board', { board }),
  settings: data => request('POST', 'api/settings', data),
  shop: () => request('GET', 'api/shop'),
  buy: item => request('POST', 'api/shop/buy', { item }),
  equip: item => request('POST', 'api/shop/equip', { item }),
  share: image => request('POST', 'api/share', { image }),
  habits: () => request('GET', 'api/habits'),
  createHabit: data => request('POST', 'api/habits', data),
  updateHabit: (id, data) => request('POST', 'api/habits/update', { id, ...data }),
  deleteHabit: id => request('POST', 'api/habits/delete', { id }),
  logHabit: (id, { delta, count, date } = {}) => request('POST', 'api/habits/log', { id, delta, count, date }),
  plans: (from, to) => request('GET', `api/plans?from=${from}&to=${to}`),
  createPlan: data => request('POST', 'api/plans', data),
  patchPlan: (id, data) => request('PATCH', `api/plans/${id}`, data),
  deletePlan: (id, { date, scope = 'all' } = {}) => request('DELETE', `api/plans/${id}?scope=${scope}${date ? `&date=${date}` : ''}`),
  completePlan: (id, date) => request('POST', `api/plans/${id}/complete`, { date }),
  skipPlan: (id, date) => request('POST', `api/plans/${id}/skip`, { date }),
  movePlan: (id, date, to) => request('POST', `api/plans/${id}/move`, { date, to }),
  calendarSummary: month => request('GET', `api/calendar/summary?month=${month}`),
  exportLink: (from, to) => request('POST', 'api/calendar/export-link', { from, to }),
  searchQuests: ({ q = '', mode = '', sphere = '' } = {}) =>
    request('GET', `api/quests/search?q=${encodeURIComponent(q)}&mode=${mode}&sphere=${encodeURIComponent(sphere)}`),
  photos: (filters = {}) => request('GET', `api/photos?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== null && v !== undefined && v !== ''))}`),
  deletePhoto: id => request('DELETE', `api/photos/${id}`),
  deleteMyPhotos: () => request('POST', 'api/me/delete-photos', {}),
  deleteAllData: () => request('POST', 'api/me/delete-all', { confirm: 'DELETE' }),
};

/** Загрузка фото с прогрессом (fetch не умеет прогресс отправки). */
export function uploadPhoto(blob, fields, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) form.append(k, String(v));
    form.append('file', blob, 'photo.jpg');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/photos');
    xhr.setRequestHeader('X-Telegram-Init-Data', initData());
    xhr.timeout = 60000;
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* не JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError((data && data.error) || 'Не получилось загрузить фото', xhr.status));
    };
    xhr.onerror = xhr.ontimeout = () => reject(new ApiError('Нет связи с сервером — фото не загрузилось', 0));
    xhr.send(form);
  });
}
