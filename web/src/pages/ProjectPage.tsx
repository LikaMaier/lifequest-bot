import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, patch, del } from '../api';
import { useMe } from '../App';
import { Chips, Field, Icon, Load, NumInput, Sheet, State, useLoad, useToast } from '../components/ui';
import { rub, pct, date, dateInput, parseNum, n, PROJ_STATUS, EXP_GROUP, INCOME_TYPE, groupLabel, UNITS } from '../format';
import { confirmDialog, haptic } from '../tg';

type Tab = 'summary' | 'ops' | 'planfact' | 'estimates' | 'close';

export default function ProjectPage() {
  const { id } = useParams();
  const state = useLoad(() => get(`/projects/${id}`), [id]);
  return <Load state={state}>{(p) => <Project p={p} setP={state.setData} reload={state.reload} />}</Load>;
}

function Project({ p, setP, reload }: { p: any; setP: (x: any) => void; reload: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const { me } = useMe();
  const ro = !me.access.active;
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<Tab>(sp.get('add') ? 'ops' : 'summary');
  const [editOpen, setEditOpen] = useState(false);
  const [op, setOp] = useState<any>(null);
  const ops = useLoad(() => get<any[]>(`/projects/${p.id}/ops`), [p.id]);
  const f = p.finance;

  useEffect(() => {
    const add = sp.get('add');
    if (add === 'expense' || add === 'income') { setOp({ kind: add }); setSp({}, { replace: true }); }
  }, [sp, setSp]);

  const refresh = async () => { setP(await get(`/projects/${p.id}`)); ops.reload(); };
  const update = async (body: any) => { try { setP(await patch(`/projects/${p.id}`, body)); } catch (e: any) { toast(e.message, true); } };

  return (
    <>
      <button className="list-item panel" style={{ marginBottom: 12, padding: 16 }} onClick={() => setEditOpen(true)}>
        <div className="grow">
          <div className="page-title" style={{ margin: 0, fontSize: 24 }}>{p.name}</div>
          <div className="small muted">{[p.customer || 'Заказчик не указан', p.address].filter(Boolean).join(' · ')}</div>
        </div>
        <Icon.chevron className="chev" width={20} />
      </button>
      <div className="row" style={{ marginBottom: 12 }}>
        <select className="select" value={p.status} onChange={(e) => update({ status: e.target.value })} disabled={ro} aria-label="Статус" style={{ flex: 1 }}>
          {Object.entries(PROJ_STATUS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </div>

      <Chips value={tab} onChange={setTab} options={[
        { value: 'summary', label: 'Сводка' }, { value: 'ops', label: 'Доходы и расходы' }, { value: 'planfact', label: 'План-факт' },
        { value: 'estimates', label: 'Сметы' }, { value: 'close', label: 'Закрытие' },
      ]} />

      {tab === 'summary' && (
        <>
          <div className="panel">
            <div className="dim"><div className={`dim-value num ${f.forecastProfit < 0 ? 'neg' : ''}`}>{rub(f.forecastProfit)}</div><div className="dim-label">Прогноз итоговой прибыли · маржа {pct(f.forecastMarginPct)}</div></div>
            <table className="breakdown" style={{ marginTop: 16 }}><tbody>
              <tr><td>Сумма договора{f.contractChanges ? ` (с изменениями ${rub(f.contractChanges)})` : ''}</td><td>{rub(f.contractTotal)}</td></tr>
              <tr><td>Получено от заказчика</td><td className="pos">{rub(f.received)}</td></tr>
              <tr><td>Долг заказчика</td><td className={f.customerDebt > 0 ? 'neg' : ''}>{rub(f.customerDebt)}</td></tr>
              {f.overpaid > 0 && <tr><td>Переплата заказчика</td><td>{rub(f.overpaid)}</td></tr>}
              <tr><td>Расходы начислено</td><td>{rub(f.expensesAccrued)}</td></tr>
              <tr><td>Расходы оплачено</td><td>{rub(f.expensesPaid)}</td></tr>
              <tr><td>Неоплаченные счета и обязательства</td><td className={f.unpaidObligations > 0 ? 'neg' : ''}>{rub(f.unpaidObligations)}</td></tr>
              <tr><td>Денежный остаток (получено − оплачено)</td><td className={f.cashBalance < 0 ? 'neg' : ''}>{rub(f.cashBalance)}</td></tr>
            </tbody></table>
          </div>
          <h2 className="section-title">Прибыль</h2>
          <div className="panel">
            <table className="breakdown"><tbody>
              <tr><td>Плановая себестоимость</td><td>{rub(f.plannedCost)}</td></tr>
              <tr><td>Плановая прибыль</td><td className={f.plannedProfit < 0 ? 'neg' : ''}>{rub(f.plannedProfit)} · {pct(f.plannedMarginPct)}</td></tr>
              <tr><td>Начисленный доход ({pct(p.completionPct)} выполнено)</td><td>{rub(f.earnedRevenue)}</td></tr>
              <tr><td>Прибыль на текущий момент</td><td className={f.currentProfit < 0 ? 'neg' : 'pos'}>{rub(f.currentProfit)}</td></tr>
              <tr><td>Прогноз оставшихся затрат</td><td>{rub(f.remainingForecast)}</td></tr>
              <tr><td>Отклонение от бюджета</td><td className={f.budgetDeviation > 0 ? 'neg' : 'pos'}>{f.budgetDeviation > 0 ? '+' : ''}{rub(f.budgetDeviation)}</td></tr>
            </tbody></table>
            <Field label={`Выполнено работ: ${n(p.completionPct, 0)}%`} hint="Нужно для прибыли на текущий момент: доход признаётся пропорционально выполненным и принятым работам">
              <input type="range" min={0} max={100} step={5} defaultValue={p.completionPct} disabled={ro} style={{ width: '100%', accentColor: 'var(--accent)' }}
                onMouseUp={(e) => update({ completionPct: Number((e.target as HTMLInputElement).value) })}
                onTouchEnd={(e) => update({ completionPct: Number((e.target as HTMLInputElement).value) })}
                onKeyUp={(e) => update({ completionPct: Number((e.target as HTMLInputElement).value) })} />
            </Field>
            <p className="xs muted" style={{ marginBottom: 0 }}>Прогноз = договор − (факт расходов + остаток планового бюджета по статьям, где факт меньше плана).</p>
          </div>
          {!ro && <div className="grid2" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={() => setOp({ kind: 'income' })}><Icon.plus width={18} />Поступление</button>
            <button className="btn primary" onClick={() => setOp({ kind: 'expense' })}><Icon.plus width={18} />Расход</button>
          </div>}
        </>
      )}

      {tab === 'ops' && <Ops ops={ops} onEdit={setOp} onAdd={(kind) => setOp({ kind })} readOnly={ro} />}

      {tab === 'planfact' && <PlanFact p={p} onSave={(budget) => update({ budget })} readOnly={ro} />}

      {tab === 'estimates' && <LinkedEstimates p={p} setP={setP} readOnly={ro} />}

      {tab === 'close' && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Перед закрытием проверьте</h3>
          <ul className="checklist">
            {p.checklist.map((c: any) => (
              <li key={c.key}><span className={c.ok ? 'pos' : 'neg'}>{c.ok ? <Icon.check width={18} /> : '!'}</span><div><div>{c.label}</div>{!c.ok && <div className="xs muted">{c.hint}</div>}</div></li>
            ))}
          </ul>
          {p.status === 'done' ? (
            <>
              <p className="small muted">Объект закрыт {date(p.closedAt)}. Данные сохранены, их можно исправить — изменения попадут в историю.</p>
              <button className="btn block" disabled={ro} onClick={async () => { setP(await post(`/projects/${p.id}/reopen`)); toast('Объект снова в работе'); }}>Вернуть в работу</button>
            </>
          ) : (
            <button className="btn primary block lg" style={{ marginTop: 16 }} disabled={ro} onClick={async () => {
              const notOk = p.checklist.filter((c: any) => !c.ok).length;
              if (!(await confirmDialog(notOk ? `Не выполнено пунктов: ${notOk}. Всё равно закрыть объект? Финансовые данные не удалятся.` : 'Закрыть объект? Финансовые данные сохранятся.'))) return;
              setP(await post(`/projects/${p.id}/close`, { confirm: true })); haptic('success'); toast('Объект закрыт');
            }}>Закрыть объект</button>
          )}
          <button className="btn block danger" style={{ marginTop: 12 }} disabled={ro} onClick={async () => {
            if (!(await confirmDialog('Удалить объект со всеми операциями? Связанные сметы останутся.'))) return;
            await del(`/projects/${p.id}`); toast('Объект удалён'); nav('/projects', { replace: true });
          }}>Удалить объект</button>
        </div>
      )}

      <ProjectEdit open={editOpen} p={p} onClose={() => setEditOpen(false)} onSave={async (body) => { await update(body); setEditOpen(false); }} readOnly={ro} />
      <OpSheet op={op} projectId={p.id} onClose={() => setOp(null)} onSaved={async () => { setOp(null); await refresh(); }} readOnly={ro} />
    </>
  );
}

function Ops({ ops, onEdit, onAdd, readOnly }: { ops: any; onEdit: (o: any) => void; onAdd: (k: string) => void; readOnly: boolean }) {
  const [kind, setKind] = useState('');
  const [cat, setCat] = useState('');
  const [paid, setPaid] = useState('');
  const list = (ops.data || []).filter((o: any) => (!kind || o.kind === kind) && (!cat || o.category === cat) &&
    (!paid || (o.kind === 'expense' && (paid === 'paid' ? o.paidAmount >= o.amount : o.paidAmount < o.amount))));
  return (
    <>
      {!readOnly && <div className="grid2" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={() => onAdd('income')}><Icon.plus width={18} />Поступление</button>
        <button className="btn primary" onClick={() => onAdd('expense')}><Icon.plus width={18} />Расход</button>
      </div>}
      <Chips value={kind} onChange={(v) => { setKind(v); if (v !== 'expense') { setCat(''); setPaid(''); } }} options={[{ value: '', label: 'Все' }, { value: 'income', label: 'Доходы' }, { value: 'expense', label: 'Расходы' }]} />
      {kind === 'expense' && (
        <>
          <Chips value={cat} onChange={setCat} options={[{ value: '', label: 'Все статьи' }, ...Object.entries(EXP_GROUP).map(([value, label]) => ({ value, label }))]} />
          <Chips value={paid} onChange={setPaid} options={[{ value: '', label: 'Любая оплата' }, { value: 'unpaid', label: 'Не оплачено' }, { value: 'paid', label: 'Оплачено' }]} />
        </>
      )}
      <Load state={ops} empty={() => (list.length ? null : <State title="Операций нет" text="Добавляйте авансы, закупки, аренду техники и выплаты рабочим — прибыль посчитается сама." />)}>
        {() => (
          <div className="list">
            {list.map((o: any) => (
              <button key={o.id} className="list-item" onClick={() => onEdit(o)}>
                <div className="grow">
                  <div className="title ellipsis">{o.title}</div>
                  <div className="xs muted ellipsis">{date(o.date)} · {o.kind === 'income' ? INCOME_TYPE[o.incomeType] : groupLabel(o.category)}{o.counterparty ? ` · ${o.counterparty}` : ''}</div>
                </div>
                <div className="right">
                  <div className={`num ${o.kind === 'income' ? 'pos' : ''}`} style={{ fontWeight: 700 }}>{o.kind === 'income' ? '+' : '−'}{rub(Math.abs(o.amount))}</div>
                  {o.kind === 'expense' && o.paidAmount < o.amount && <span className="badge bad">долг {rub(o.amount - o.paidAmount)}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </Load>
    </>
  );
}

const COUNTERPARTY: Record<string, string> = { materials: 'Поставщик', equipment: 'Арендодатель', labor: 'Сотрудник или подрядчик', other: 'Кому оплачено' };
const TITLE_HINT: Record<string, string> = { materials: 'Цемент М500, доставка песка…', equipment: 'Экскаватор, доставка техники, топливо…', labor: 'Бетонные работы, бригада Ивана…', other: 'Вывоз мусора, проживание…' };

function OpSheet({ op, projectId, onClose, onSaved, readOnly }: { op: any; projectId: string; onClose: () => void; onSaved: () => void; readOnly: boolean }) {
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<string>('');
  useEffect(() => {
    if (!op) return setF(null);
    setErr('');
    setF({
      id: op.id, kind: op.kind, incomeType: op.incomeType || 'advance', category: op.category || 'materials', title: op.title || '',
      qty: op.qty ?? '', unit: op.unit || '', unitPrice: op.unitPrice ?? '', amount: op.amount ?? '', paidAmount: op.paidAmount ?? '',
      counterparty: op.counterparty || '', date: dateInput(op.date || new Date().toISOString()), note: op.note || '', fullyPaid: op.id ? op.paidAmount >= op.amount : true,
    });
  }, [op]);
  if (!op || !f) return null;
  const set = (p: any) => setF((x: any) => {
    const y = { ...x, ...p };
    if (('qty' in p || 'unitPrice' in p) && y.qty !== '' && y.unitPrice !== '') y.amount = String(Math.round(parseNum(y.qty) * parseNum(y.unitPrice) * 100) / 100);
    return y;
  });
  const isExp = f.kind === 'expense';
  const customCats = !Object.keys(EXP_GROUP).includes(f.category);

  const save = async () => {
    const amount = parseNum(f.amount);
    const paidAmount = isExp ? (f.fullyPaid ? amount : parseNum(f.paidAmount)) : 0;
    if (!f.title.trim()) return setErr('Введите название');
    if (f.amount === '' ) return setErr('Введите сумму');
    if (isExp && paidAmount > amount) return setErr('Оплачено больше начисленного');
    const body = {
      kind: f.kind, incomeType: isExp ? null : f.incomeType, category: isExp ? f.category : null, title: f.title,
      qty: f.qty === '' ? null : parseNum(f.qty), unit: f.unit || null, unitPrice: f.unitPrice === '' ? null : parseNum(f.unitPrice),
      amount, paidAmount, counterparty: f.counterparty || null, date: f.date, note: f.note || null,
    };
    try {
      if (f.id) await patch(`/ops/${f.id}`, body); else await post(`/projects/${projectId}/ops`, body);
      haptic('success'); toast(f.id ? 'Операция сохранена' : 'Операция добавлена'); onSaved();
    } catch (e: any) { setErr(e.message); }
  };
  const remove = async () => {
    if (!(await confirmDialog(`Удалить операцию «${f.title}» на ${rub(parseNum(f.amount))}? Итоги объекта пересчитаются.`))) return;
    await del(`/ops/${f.id}`); toast('Операция удалена'); onSaved();
  };

  return (
    <Sheet open onClose={onClose} title={f.id ? 'Операция' : isExp ? 'Новый расход' : 'Новое поступление'}>
      <div className="stack">
        {isExp ? (
          <Field label="Статья расхода">
            <select className="select" value={customCats ? '_custom' : f.category} onChange={(e) => set({ category: e.target.value === '_custom' ? '' : e.target.value })} disabled={readOnly}>
              {Object.entries(EXP_GROUP).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              <option value="_custom">Своя статья…</option>
            </select>
            {customCats && <input className="input" style={{ marginTop: 8 }} value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder="Название статьи" />}
          </Field>
        ) : (
          <Field label="Тип поступления" hint={['extra_work', 'contract_change'].includes(f.incomeType) ? 'Меняет сумму договора, а не полученные деньги. Для уменьшения договора введите отрицательную сумму.' : 'Деньги, фактически полученные от заказчика'}>
            <select className="select" value={f.incomeType} onChange={(e) => set({ incomeType: e.target.value, title: f.title || INCOME_TYPE[e.target.value] })} disabled={readOnly}>
              {Object.entries(INCOME_TYPE).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </Field>
        )}
        <Field label="Название"><input className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={isExp ? TITLE_HINT[f.category] || '' : INCOME_TYPE[f.incomeType]} readOnly={readOnly} /></Field>
        {isExp && (
          <div className="line-grid" style={{ gridTemplateColumns: '1fr 80px 1fr' }}>
            <NumInput value={f.qty} onChange={(v) => set({ qty: v })} placeholder={f.category === 'equipment' ? 'Смен/часов' : 'Кол-во'} readOnly={readOnly} />
            <input className="input" list="op-units" value={f.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="ед." readOnly={readOnly} />
            <NumInput value={f.unitPrice} onChange={(v) => set({ unitPrice: v })} unit="₽" placeholder="Цена" readOnly={readOnly} />
            <datalist id="op-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          </div>
        )}
        <Field label={isExp ? 'Сумма (начислено)' : 'Сумма'}><NumInput value={f.amount} onChange={(v) => set({ amount: v })} unit="₽" readOnly={readOnly} /></Field>
        {isExp && (
          <>
            <label className="row small"><input type="checkbox" checked={f.fullyPaid} onChange={(e) => set({ fullyPaid: e.target.checked })} disabled={readOnly} />Оплачено полностью</label>
            {!f.fullyPaid && <Field label="Фактически оплачено" hint="Аванс рабочему или частичная оплата поставщику"><NumInput value={f.paidAmount} onChange={(v) => set({ paidAmount: v })} unit="₽" readOnly={readOnly} /></Field>}
            <Field label={COUNTERPARTY[f.category] || 'Контрагент'}><input className="input" value={f.counterparty} onChange={(e) => set({ counterparty: e.target.value })} readOnly={readOnly} /></Field>
          </>
        )}
        <Field label="Дата"><input className="input" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} readOnly={readOnly} /></Field>
        <Field label="Примечание" hint={isExp ? 'Номер чека или счёта' : undefined}><input className="input" value={f.note} onChange={(e) => set({ note: e.target.value })} readOnly={readOnly} /></Field>
        {err && <div className="banner bad">{err}</div>}
        {!readOnly && <button className="btn primary block lg" onClick={save}>Сохранить</button>}
        {f.id && !readOnly && <button className="btn block danger" onClick={remove}>Удалить операцию</button>}
      </div>
    </Sheet>
  );
}

function PlanFact({ p, onSave, readOnly }: { p: any; onSave: (b: any) => void; readOnly: boolean }) {
  const f = p.finance;
  const [edit, setEdit] = useState(false);
  const [b, setB] = useState<Record<string, string>>({});
  useEffect(() => {
    const src: Record<string, string> = {};
    Object.keys(EXP_GROUP).forEach((g) => (src[g] = String(f.planFact.find((r: any) => r.group === g)?.planned ?? 0)));
    setB(src);
  }, [f]);
  return (
    <>
      <p className="small muted">План {f.budgetSource === 'manual' ? 'задан вручную' : 'взят из себестоимости связанных смет'}. Положительное отклонение — перерасход.</p>
      {f.planFact.length === 0 ? <State title="Нет плана и расходов" text="Свяжите смету с закупочными ценами или задайте бюджет вручную." /> : (
        <div className="list">
          {f.planFact.map((r: any) => {
            const ratio = r.planned > 0 ? Math.min(r.actual / r.planned, 1.5) : r.actual > 0 ? 1.5 : 0;
            return (
              <div key={r.group} className="line">
                <div className="row between"><b>{groupLabel(r.group)}</b><span className={`num small ${r.deviation > 0 ? 'neg' : 'pos'}`}>{r.deviation > 0 ? '+' : ''}{rub(r.deviation)}</span></div>
                <div className="pf-bar"><i className={r.deviation > 0 ? 'over' : ''} style={{ width: `${(ratio / 1.5) * 100}%` }} /></div>
                <div className="row between xs muted" style={{ marginTop: 4 }}><span>факт {rub(r.actual)} из {rub(r.planned)}</span><span>оплачено {rub(r.paid)}</span></div>
              </div>
            );
          })}
        </div>
      )}
      {!readOnly && <button className="btn block" style={{ marginTop: 12 }} onClick={() => setEdit(true)}>Задать бюджет вручную</button>}
      {f.budgetSource === 'manual' && !readOnly && <button className="btn ghost block" onClick={() => onSave(null)}>Брать план из смет</button>}
      <Sheet open={edit} onClose={() => setEdit(false)} title="Плановый бюджет">
        <div className="stack">
          {Object.entries(EXP_GROUP).map(([g, label]) => <Field key={g} label={label}><NumInput value={b[g]} onChange={(v) => setB((x) => ({ ...x, [g]: v }))} unit="₽" /></Field>)}
          <button className="btn primary block" onClick={() => { const o: Record<string, number> = {}; Object.entries(b).forEach(([k, v]) => (o[k] = parseNum(v))); onSave(o); setEdit(false); }}>Сохранить бюджет</button>
        </div>
      </Sheet>
    </>
  );
}

function LinkedEstimates({ p, setP, readOnly }: { p: any; setP: (x: any) => void; readOnly: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const all = useLoad(() => (open ? get<any[]>('/estimates') : Promise.resolve([])), [open]);
  return (
    <>
      {p.estimates.length === 0 ? <State title="Смет нет" text="Свяжите смету — её себестоимость станет плановым бюджетом." /> : (
        <div className="list">
          {p.estimates.map((e: any) => (
            <div key={e.id} className="list-item">
              <Link to={`/estimates/${e.id}`} className="grow" style={{ color: 'var(--text)' }}><div className="title">{e.title}</div><div className="xs muted">{rub(e.total)}</div></Link>
              {!readOnly && <button className="btn sm" onClick={async () => { setP(await post(`/projects/${p.id}/link-estimate`, { estimateId: e.id, unlink: true })); toast('Смета отвязана'); }}>Отвязать</button>}
            </div>
          ))}
        </div>
      )}
      {!readOnly && <button className="btn primary block" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>Связать смету</button>}
      <Sheet open={open} onClose={() => setOpen(false)} title="Выберите смету">
        <Load state={all} empty={(d) => (d.filter((e) => e.projectId !== p.id).length ? null : <State title="Нет свободных смет" />)}>
          {(list) => <div className="list">{list.filter((e) => e.projectId !== p.id).map((e) => (
            <button key={e.id} className="list-item" onClick={async () => { setP(await post(`/projects/${p.id}/link-estimate`, { estimateId: e.id })); setOpen(false); toast('Смета связана'); }}>
              <div className="grow"><div className="title">{e.title}</div><div className="xs muted">{e.project ? `Сейчас: ${e.project.name}` : 'Без объекта'}</div></div><span className="num">{rub(e.total)}</span>
            </button>))}</div>}
        </Load>
      </Sheet>
    </>
  );
}

function ProjectEdit({ open, p, onClose, onSave, readOnly }: { open: boolean; p: any; onClose: () => void; onSave: (b: any) => void; readOnly: boolean }) {
  const [f, setF] = useState<any>({});
  useEffect(() => { if (open) setF({ name: p.name, customer: p.customer || '', address: p.address || '', startDate: dateInput(p.startDate), endDate: dateInput(p.endDate), contractAmount: String(p.contractAmount), notes: p.notes || '' }); }, [open, p]);
  const set = (x: any) => setF((y: any) => ({ ...y, ...x }));
  return (
    <Sheet open={open} onClose={onClose} title="Данные объекта">
      <div className="stack">
        <Field label="Название"><input className="input" value={f.name || ''} onChange={(e) => set({ name: e.target.value })} readOnly={readOnly} /></Field>
        <Field label="Заказчик"><input className="input" value={f.customer || ''} onChange={(e) => set({ customer: e.target.value })} readOnly={readOnly} /></Field>
        <Field label="Адрес"><input className="input" value={f.address || ''} onChange={(e) => set({ address: e.target.value })} readOnly={readOnly} /></Field>
        <div className="grid2">
          <Field label="Начало"><input className="input" type="date" value={f.startDate || ''} onChange={(e) => set({ startDate: e.target.value })} readOnly={readOnly} /></Field>
          <Field label="Завершение"><input className="input" type="date" value={f.endDate || ''} onChange={(e) => set({ endDate: e.target.value })} readOnly={readOnly} /></Field>
        </div>
        <Field label="Базовая сумма договора" hint="Доп. работы и изменения стоимости добавляйте как поступления соответствующего типа"><NumInput value={f.contractAmount} onChange={(v) => set({ contractAmount: v })} unit="₽" readOnly={readOnly} /></Field>
        <Field label="Заметки"><textarea className="textarea" value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} readOnly={readOnly} /></Field>
        {!readOnly && <button className="btn primary block lg" onClick={() => {
          if (!f.name?.trim()) return;
          onSave({ name: f.name, customer: f.customer || null, address: f.address || null, startDate: f.startDate || null, endDate: f.endDate || null, contractAmount: parseNum(f.contractAmount), notes: f.notes || null });
        }}>Сохранить</button>}
      </div>
    </Sheet>
  );
}
