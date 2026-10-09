import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CALCULATORS, CALC_GROUPS, getCalculator, runCalc } from '../../../shared/calculators';
import { get, post } from '../api';
import { useMe } from '../App';
import { Field, Icon, Load, NumInput, Sheet, State, useLoad, useToast } from '../components/ui';
import { n, rub, parseNum, TYPE_LABEL } from '../format';

export default function Calculators() {
  return (
    <>
      <h1 className="page-title">Калькуляторы</h1>
      {CALC_GROUPS.map((g) => (
        <section key={g}>
          <h2 className="section-title">{g}</h2>
          <div className="list">
            {CALCULATORS.filter((c) => c.group === g).map((c) => (
              <Link key={c.id} to={`/calculators/${c.id}`} className="list-item">
                <div className="grow"><div className="title">{c.title}</div><div className="xs muted">{c.description}</div></div>
                <Icon.chevron className="chev" width={18} />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

const storeKey = (id: string) => `smeta_calc_${id}`;

export function CalculatorPage() {
  const { id } = useParams();
  const calc = getCalculator(id || '');
  const [values, setValues] = useState<Record<string, any>>(() => {
    const d: Record<string, any> = {};
    calc?.fields.forEach((f) => (d[f.key] = f.default ?? ''));
    try { Object.assign(d, JSON.parse(localStorage.getItem(storeKey(id || '')) || '{}')); } catch { /* */ }
    return d;
  });
  const [touched, setTouched] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem(storeKey(id || ''), JSON.stringify(values)); } catch { /* */ } }, [values, id]);

  const res = useMemo(() => {
    if (!calc) return null;
    try { return runCalc(calc, values); } catch (e: any) { return { errors: { _: e.message }, output: null }; }
  }, [calc, values]);
  if (!calc) return <State title="Калькулятор не найден" />;
  const out = res?.output;
  const primary = out?.rows.find((r) => r.primary);

  return (
    <>
      <h1 className="page-title">{calc.title}</h1>
      <div className="panel stack">
        {calc.fields.map((f) => {
          const err = touched || values[f.key] !== '' ? res?.errors[f.key] : undefined;
          const set = (v: any) => { setValues((x) => ({ ...x, [f.key]: v })); setTouched(true); };
          return (
            <Field key={f.key} label={f.label} hint={f.hint} error={err}>
              {f.type === 'select' ? (
                <select className="select" value={values[f.key]} onChange={(e) => set(e.target.value)}>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              ) : f.type === 'text' ? (
                <input className={`input ${err ? 'invalid' : ''}`} value={values[f.key]} onChange={(e) => set(e.target.value)} />
              ) : (
                <NumInput value={values[f.key]} onChange={set} unit={f.unit} invalid={!!err} />
              )}
            </Field>
          );
        })}
      </div>

      {out ? (
        <>
          <div className="panel result-main" style={{ marginTop: 16 }}>
            {primary && <div className="dim"><div className="dim-value num">{n(primary.value, 3)} <span style={{ fontSize: 20 }}>{primary.unit}</span></div><div className="dim-label">{primary.label}</div></div>}
            <table className="breakdown" style={{ marginTop: 16 }}><tbody>
              {out.rows.filter((r) => !r.primary).map((r, i) => <tr key={i}><td>{r.label}</td><td>{n(r.value, 3)} {r.unit}</td></tr>)}
            </tbody></table>
          </div>
          <h2 className="section-title">Как посчитано</h2>
          <div className="formula num">{out.formula.map((f, i) => <div key={i}>{f}</div>)}</div>
          {out.warnings.map((w, i) => <div key={i} className="banner" style={{ marginTop: 12, marginBottom: 0 }}>{w}</div>)}
          {out.suggestions.length > 0 && <button className="btn primary block lg" style={{ marginTop: 16 }} onClick={() => setAddOpen(true)}><Icon.plus width={20} />Добавить в смету</button>}
          <AddToEstimate open={addOpen} onClose={() => setAddOpen(false)} suggestions={out.suggestions} />
        </>
      ) : (
        <div className="state">Заполните параметры — результат появится сразу.</div>
      )}
    </>
  );
}

function AddToEstimate({ open, onClose, suggestions }: { open: boolean; onClose: () => void; suggestions: any[] }) {
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useMe();
  const estimates = useLoad(() => (open ? get<any[]>('/estimates', { status: 'draft' }) : Promise.resolve([])), [open]);
  const items = useLoad(() => (open ? get<any[]>('/items') : Promise.resolve([])), [open]);
  const [rows, setRows] = useState<any[]>([]);
  const [target, setTarget] = useState('new');
  const [busy, setBusy] = useState(false);

  // Цена по личному прайс-листу: ищем позицию с похожим названием и тем же типом
  useEffect(() => {
    if (!open) return;
    const cat = items.data || [];
    setRows(suggestions.map((s) => {
      const base = s.name.toLowerCase().split(/[\s(]/)[0];
      const match = cat.find((i) => i.type === s.type && i.name.toLowerCase().includes(base));
      return { ...s, on: true, price: match ? String(match.price) : '', costPrice: match?.costPrice ?? null, unit: match?.unit && match.unit === s.unit ? match.unit : s.unit, catalogItemId: match?.id || null, matched: match?.name, category: match?.category || null };
    }));
  }, [open, items.data, suggestions]);

  const total = rows.filter((r) => r.on).reduce((a, r) => a + parseNum(r.price) * r.qty, 0);
  const submit = async () => {
    const lines = rows.filter((r) => r.on).map((r) => ({ name: r.matched || r.name, qty: r.qty, unit: r.unit, price: parseNum(r.price), costPrice: r.costPrice, type: r.type, category: r.category, catalogItemId: r.catalogItemId }));
    if (!lines.length) return toast('Отметьте хотя бы одну позицию', true);
    setBusy(true);
    try {
      let id = target;
      if (target === 'new') id = (await post('/estimates', { title: 'Новая смета' })).id;
      await post(`/estimates/${id}/lines`, { lines });
      toast('Добавлено в смету');
      nav(`/estimates/${id}`);
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Добавить в смету">
      <div className="stack">
        <Field label="Смета">
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">Новая смета</option>
            {(estimates.data || []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </Field>
        <div className="list">
          {rows.map((r, i) => (
            <div key={i} className="line">
              <label className="row"><input type="checkbox" checked={r.on} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} />
                <span className="grow"><b>{r.matched || r.name}</b><div className="xs muted">{n(r.qty, 3)} {r.unit} · {TYPE_LABEL[r.type]}{r.matched ? ' · цена из справочника' : ' · нет в справочнике'}</div></span></label>
              <div style={{ marginTop: 6 }}><NumInput value={r.price} onChange={(v) => setRows((x) => x.map((y, j) => (j === i ? { ...y, price: v } : y)))} unit={`₽/${r.unit}`} placeholder="Цена" /></div>
            </div>
          ))}
        </div>
        <div className="row between"><span className="muted">Стоимость</span><b className="num">{rub(Math.round(total * 100) / 100)}</b></div>
        {rows.some((r) => r.on && !r.price) && <p className="xs muted">Позиции без цены добавятся с ценой 0 — заполните её в смете.</p>}
        <button className="btn primary block lg" onClick={submit} disabled={busy || !me.access.active}>{busy ? 'Добавляю…' : 'Добавить'}</button>
      </div>
    </Sheet>
  );
}
