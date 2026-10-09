let token: string | null = null;
try { token = sessionStorage.getItem('smeta_token'); } catch { /* недоступно */ }

export function setToken(t: string | null) {
  token = t;
  try { t ? sessionStorage.setItem('smeta_token', t) : sessionStorage.removeItem('smeta_token'); } catch { /* */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

type Listener = (e: ApiError) => void;
const listeners = new Set<Listener>();
export const onApiError = (fn: Listener) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function api<T = any>(path: string, opts: { method?: string; body?: any; query?: Record<string, any> } = {}): Promise<T> {
  let url = `/api${path}`;
  if (opts.query) {
    const q = new URLSearchParams();
    Object.entries(opts.query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
    const s = q.toString();
    if (s) url += `?${s}`;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method || 'GET',
      headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    const e = new ApiError(0, 'Нет связи с сервером. Проверьте интернет и повторите.', 'network');
    listeners.forEach((l) => l(e));
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new ApiError(res.status, data.error || `Ошибка ${res.status}`, data.code);
    listeners.forEach((l) => l(e));
    throw e;
  }
  return data as T;
}

export const get = <T = any>(p: string, query?: Record<string, any>) => api<T>(p, { query });
export const post = <T = any>(p: string, body?: any) => api<T>(p, { method: 'POST', body: body ?? {} });
export const put = <T = any>(p: string, body: any) => api<T>(p, { method: 'PUT', body });
export const patch = <T = any>(p: string, body: any) => api<T>(p, { method: 'PATCH', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
