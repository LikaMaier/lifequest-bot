// Клиент API: каждый запрос несёт подписанный initData Telegram.

import { initData } from './tg.js';

export class ApiError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.status = status;
    this.code = code;
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
    throw new ApiError(msg, resp.status, (data && data.code) || null);
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
  premiumInterest: () => request('POST', 'api/premium/interest'),
  premiumInvoice: product => request('POST', 'api/premium/invoice', { product }),
  premiumTrial: () => request('POST', 'api/premium/trial'),
  challenges: () => request('GET', 'api/challenges'),
  challengeStart: id => request('POST', 'api/challenges/start', { id }),
  challengeQuit: () => request('POST', 'api/challenges/quit'),
  packs: () => request('GET', 'api/packs'),
  friends: () => request('GET', 'api/friends'),
  createSphere: data => request('POST', 'api/spheres', data),
  updateSphere: (key, data) => request('PATCH', `api/spheres/${encodeURIComponent(key)}`, data),
  deleteSphere: key => request('DELETE', `api/spheres/${encodeURIComponent(key)}`),
  aiOptions: () => request('GET', 'api/ai/options'),
  aiQuest: (mood, time, place) => request('POST', 'api/ai/quest', { mood, time, place }),
  recap: period => request('GET', `api/recap?period=${encodeURIComponent(period)}`),
  notes: (params = {}) => request('GET', `api/notes?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''))}`),
  createNote: data => request('POST', 'api/notes', data),
  updateNote: (id, data) => request('PATCH', `api/notes/${id}`, data),
  deleteNote: id => request('DELETE', `api/notes/${id}`),
  buy: item => request('POST', 'api/shop/buy', { item }),
  equip: item => request('POST', 'api/shop/equip', { item }),
  share: image => request('POST', 'api/share', { image }),
  habits: () => request('GET', 'api/habits'),
  createHabit: data => request('POST', 'api/habits', data),
  updateHabit: (id, data) => request('POST', 'api/habits/update', { id, ...data }),
  deleteHabit: id => request('POST', 'api/habits/delete', { id }),
  logHabit: (id, { delta, count, date } = {}) => request('POST', 'api/habits/log', { id, delta, count, date }),
  createHabits: items => request('POST', 'api/habits/many', { items }),
  skipHabit: (id, { date, note } = {}) => request('POST', 'api/habits/skip', { id, date, note }),
  habitStats: id => request('GET', `api/habits/${id}/stats`),
  pauseHabits: days => request('POST', 'api/habits/pause', { days }),
  unpauseHabits: () => request('DELETE', 'api/habits/pause'),
  plans: (from, to) => request('GET', `api/plans?from=${from}&to=${to}`),
  createPlan: data => request('POST', 'api/plans', data),
  patchPlan: (id, data) => request('PATCH', `api/plans/${id}`, data),
  deletePlan: (id, { date, scope = 'all' } = {}) => request('DELETE', `api/plans/${id}?scope=${scope}${date ? `&date=${date}` : ''}`),
  completePlan: (id, date) => request('POST', `api/plans/${id}/complete`, { date }),
  skipPlan: (id, date) => request('POST', `api/plans/${id}/skip`, { date }),
  uncompletePlan: (id, date) => request('POST', `api/plans/${id}/uncomplete`, { date }),
  movePlan: (id, date, to) => request('POST', `api/plans/${id}/move`, { date, to }),
  subtaskPlan: (id, index, done) => request('POST', `api/plans/${id}/subtask`, { index, done }),
  focusPlan: (id, date) => request('POST', 'api/plans/focus', { id, date }),
  openChest: () => request('POST', 'api/chest/open'),
  claimLogin: () => request('POST', 'api/login/claim'),
  duels: () => request('GET', 'api/duels'),
  createDuel: data => request('POST', 'api/duels', data),
  duelAction: (id, action) => request('POST', `api/duels/${id}/${action}`, {}),
  contests: () => request('GET', 'api/contests'),
  contest: id => request('GET', `api/contests/${id}`),
  createContest: data => request('POST', 'api/contests', data),
  contestAddItem: (id, item) => request('POST', `api/contests/${id}/items`, item),
  contestUpdateItem: (id, itemId, item) => request('PATCH', `api/contests/${id}/items/${itemId}`, item),
  contestDeleteItem: (id, itemId) => request('DELETE', `api/contests/${id}/items/${itemId}`),
  contestTemplate: (id, template) => request('POST', `api/contests/${id}/template`, { template }),
  contestPropose: (id, item) => request('POST', `api/contests/${id}/proposals`, item),
  contestDecide: (id, pid, accept, item = null) => request('POST', `api/contests/${id}/proposals/${pid}/${accept ? 'accept' : 'reject'}`, { item }),
  contestLaunch: (id, force = false) => request('POST', `api/contests/${id}/launch`, { force }),
  contestLog: (id, itemId, value) => request('POST', `api/contests/${id}/log`, { item_id: itemId, value }),
  contestLeave: id => request('POST', `api/contests/${id}/leave`, {}),
  albums: () => request('GET', 'api/albums'),
  album: id => request('GET', `api/albums/${id}`),
  createAlbum: data => request('POST', 'api/albums', data),
  albumInvite: (id, friendId) => request('POST', `api/albums/${id}/invite`, { friend_id: friendId }),
  albumLeave: id => request('POST', `api/albums/${id}/leave`, {}),
  albumUpdate: (id, data) => request('PATCH', `api/albums/${id}`, data),
  albumDelete: id => request('DELETE', `api/albums/${id}`),
  albumDeletePhoto: (id, photoId) => request('DELETE', `api/albums/${id}/photos/${photoId}`),
  albumAccessList: () => request('GET', 'api/albums/access'),
  albumAccess: (friendId, on) => request('POST', 'api/albums/access', { friend_id: friendId, on }),
  friendAlbum: uid => request('GET', `api/albums/friend/${uid}`),
  inbox: () => request('GET', 'api/inbox'),
  addInbox: title => request('POST', 'api/inbox', { title }),
  deleteInbox: id => request('DELETE', `api/inbox/${id}`),
  scheduleInbox: (id, data) => request('POST', `api/inbox/${id}/schedule`, data),
  calendarSummary: month => request('GET', `api/calendar/summary?month=${month}`),
  exportLink: (from, to) => request('POST', 'api/calendar/export-link', { from, to }),
  searchQuests: ({ q = '', mode = '', sphere = '' } = {}) =>
    request('GET', `api/quests/search?q=${encodeURIComponent(q)}&mode=${mode}&sphere=${encodeURIComponent(sphere)}`),
  photos: (filters = {}) => request('GET', `api/photos?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== null && v !== undefined && v !== ''))}`),
  deletePhoto: id => request('DELETE', `api/photos/${id}`),
  captionPhoto: (id, caption) => request('PATCH', `api/photos/${id}`, { caption }),
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
