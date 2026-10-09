import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '../api';
import { useMe } from '../App';
import { Chips, Field, Icon, Load, NumInput, SearchBox, Sheet, State, useDebounced, useLoad, useToast } from '../components/ui';
import { rub, parseNum, PROJ_STATUS } from '../format';

export default function Projects() {
  const nav = useNavigate();
  const { me } = useMe();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounced(q);
  const list = useLoad(() => get<any[]>('/projects', { q: dq, status }), [dq, status]);
  const open = sp.get('new') === '1';
  const close = () => setSp({});

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Объекты</h1>
        <button className="btn primary sm" disabled={!me.access.active} onClick={() => setSp({ new: '1' })}><Icon.plus width={18} />Объект</button>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Поиск по названию или заказчику" />
      <Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Все' }, ...Object.entries(PROJ_STATUS).map(([value, label]) => ({ value, label }))]} />
      <Load state={list} empty={(d) => (d.length ? null : <State title={q || status ? 'Ничего не найдено' : 'Объектов пока нет'} text={q || status ? 'Измените поиск или фильтр.' : 'Объект — это заказ: смета, доходы, расходы и прибыль в одном месте.'} />)}>
        {(items) => (
          <div className="list">
            {items.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="list-item">
                <div className="grow">
                  <div className="title ellipsis">{p.name}</div>
                  <div className="xs muted ellipsis">{[p.customer, PROJ_STATUS[p.status]].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="right">
                  <div className="num" style={{ fontWeight: 700 }}>{rub(p.finance.contractTotal)}</div>
                  <div className={`xs num ${p.finance.forecastProfit < 0 ? 'neg' : 'muted'}`}>прибыль {rub(p.finance.forecastProfit)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Load>
      <NewProject open={open} onClose={close} onCreated={(id) => nav(`/projects/${id}`, { replace: true })} />
    </>
  );
}

function NewProject({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', customer: '', address: '', contractAmount: '', estimateId: '' });
  const [err, setErr] = useState('');
  const estimates = useLoad(() => (open ? get<any[]>('/estimates') : Promise.resolve([])), [open]);
  const set = (p: any) => setF((x) => ({ ...x, ...p }));
  const submit = async () => {
    if (!f.name.trim()) return setErr('Введите название объекта');
    try {
      const p = await post('/projects', { name: f.name, customer: f.customer || null, address: f.address || null, contractAmount: f.contractAmount ? parseNum(f.contractAmount) : undefined, estimateId: f.estimateId || undefined });
      toast('Объект создан');
      setF({ name: '', customer: '', address: '', contractAmount: '', estimateId: '' });
      onCreated(p.id);
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Новый объект">
      <div className="stack">
        <Field label="Название" error={err}><input className="input" value={f.name} onChange={(e) => { set({ name: e.target.value }); setErr(''); }} placeholder="Площадка ТКО, ул. Садовая" /></Field>
        <Field label="Заказчик"><input className="input" value={f.customer} onChange={(e) => set({ customer: e.target.value })} /></Field>
        <Field label="Адрес"><input className="input" value={f.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        <Field label="Смета" hint="Её итог станет суммой договора, а себестоимость — плановым бюджетом">
          <select className="select" value={f.estimateId} onChange={(e) => set({ estimateId: e.target.value })}>
            <option value="">Без сметы</option>
            {(estimates.data || []).filter((e) => !e.project).map((e) => <option key={e.id} value={e.id}>{e.title} — {rub(e.total)}</option>)}
          </select>
        </Field>
        {!f.estimateId && <Field label="Сумма договора"><NumInput value={f.contractAmount} onChange={(v) => set({ contractAmount: v })} unit="₽" /></Field>}
        <button className="btn primary block lg" onClick={submit}>Создать объект</button>
      </div>
    </Sheet>
  );
}
