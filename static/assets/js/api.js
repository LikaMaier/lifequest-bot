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
  share: image => request('POST', 'api/share', { image }),
};
