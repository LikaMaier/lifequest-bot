import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';

// ---------- Иконки (линейные, строительные) ----------
const P = (d: string | React.ReactNode) => (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);
export const Icon = {
  home: P(<><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10" /><path d="M10 20v-5h4v5" /></>),
  doc: P(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></>),
  site: P(<><path d="M3 21h18" /><path d="M5 21V10l7-5 7 5v11" /><path d="M9 21v-6h6v6" /></>),
  book: P(<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /><path d="M9 7h6" /></>),
  more: P(<><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>),
  calc: P(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h2M12 11h2M16 11v6M8 15h2M12 15h2" /></>),
  money: P(<><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9v.01M18 15v.01" /></>),
  mic: P(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>),
  note: P(<><path d="M5 4h14v12l-4 4H5z" /><path d="M15 20v-4h4" /><path d="M8 9h8M8 13h5" /></>),
  gear: P(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  plus: P('M12 5v14M5 12h14'),
  trash: P(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>),
  copy: P(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>),
  up: P('M12 19V5M6 11l6-6 6 6'),
  down: P('M12 5v14M6 13l6 6 6-6'),
  chevron: P('M9 6l6 6-6 6'),
  back: P('M15 6l-6 6 6 6'),
  search: P(<><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>),
  close: P('M6 6l12 12M18 6 6 18'),
  history: P(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>),
  check: P('M5 12l5 5 9-10'),
};

// ---------- Тосты ----------
type Toast = { text: string; error?: boolean } | null;
const ToastCtx = createContext<(t: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<Toast>(null);
  const timer = useRef<any>();
  const show = useCallback((text: string, error?: boolean) => {
    setT({ text, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast ${t.error ? 'error' : ''}`} role="status">{t.text}</div>}
    </ToastCtx.Provider>
  );
}

// ---------- Загрузка данных ----------
export function useLoad<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); } catch (e: any) { setError(e); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

/** Универсальная обёртка состояний: загрузка / ошибка / нет доступа / нет данных */
export function Load<T>({ state, empty, children }: { state: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }; empty?: (d: T) => React.ReactNode | null; children: (d: T) => React.ReactNode }) {
  if (state.loading && !state.data) return <div className="spinner" aria-label="Загрузка" />;
  if (state.error && !state.data) {
    if (state.error.status === 404) return <State title="Не найдено" text="Запись удалена или у вас нет к ней доступа." />;
    if (state.error.status === 401) return <State title="Нет доступа" text={state.error.message} />;
    return <State title="Не удалось загрузить" text={state.error.message} action={<button className="btn" onClick={state.reload}>Повторить</button>} />;
  }
  if (!state.data) return null;
  const e = empty?.(state.data);
  if (e) return <>{e}</>;
  return <>{children(state.data)}</>;
}

export function State({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return <div className="state"><b>{title}</b>{text && <div className="small">{text}</div>}{action}</div>;
}

// ---------- Поля ----------
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <div className="err">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </label>
  );
}

export function NumInput({ value, onChange, unit, invalid, ...rest }: { value: any; onChange: (v: string) => void; unit?: string; invalid?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const el = <input className={`input num ${invalid ? 'invalid' : ''}`} inputMode="decimal" value={value ?? ''} onChange={(e) => onChange(e.target.value.replace(/[^\d.,\-]/g, ''))} {...rest} />;
  return unit ? <div className="input-unit">{el}<em>{unit}</em></div> : el;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  );
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => <button key={o.value} role="tab" aria-selected={o.value === value} className={`chip ${o.value === value ? 'on' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input className="input search" type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** Задержка ввода для поиска */
export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Ошибочная граница: сбой одного экрана не роняет приложение */
export class Boundary extends React.Component<{ children: React.ReactNode }, { err: any }> {
  state = { err: null as any };
  static getDerivedStateFromError(err: any) { return { err }; }
  render() {
    if (this.state.err) return <State title="Этот раздел не открылся" text="Остальные разделы работают. Попробуйте открыть его снова." action={<button className="btn" onClick={() => this.setState({ err: null })}>Повторить</button>} />;
    return this.props.children;
  }
}
