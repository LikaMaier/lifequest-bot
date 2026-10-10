// Состояние приложения: последний ответ /api/state и подписчики.

import { api } from './api.js';
import { applyTheme } from './themefx.js';

const listeners = new Set();
export const store = { state: null };

export function onState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setState(state) {
  store.state = state;
  applyTheme(state.user.theme || 'classic');
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error(e); }
  }
}

export async function refreshState() {
  const state = await api.state();
  setState(state);
  return state;
}
