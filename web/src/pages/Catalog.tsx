import React, { useEffect, useState } from 'react';
import { get, post, patch, del } from '../api';
import { useMe } from '../App';
import { Chips, Field, Icon, Load, NumInput, SearchBox, Sheet, State, useDebounced, useLoad, useToast } from '../components/ui';
import { rub, date, parseNum, TYPE_LABEL, UNITS } from '../format';
import { confirmDialog } from '../tg';

const empty = { name: '', type: 'work', category: '', unit: 'м²', price: '', costPrice: '', description: '', notes: '', active: true };

export default function Catalog() {
  const toast = useToast();
  const { me } = useMe();
  const ro = !me.access.active;
  const lists = useLoad(() => get<any[]>('/pricelists'), []);
  const [listId, setListId] = useState('');
  useEffect(() => { if (!listId && lists.data?.length) setListId(lists.data.find((l) => l.isDefault)?.id || lists.data[0].id); }, [lists.data, listId]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const dq = useDebounced(q);
  const items = useLoad(() => (listId ? get<any[]>('/items', { priceListId: listId, q: dq, type, category, includeInactive: '1' }) : Promise.resolve([])), [listId, dq, type, category]);
  const cats = useLoad(() => get<string[]>('/categories'), []);
  const [edit, setEdit] = useState<any>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copyOpen, setCopyOpen] = useState(false);

  const toggle = (id: string) => setSelected((s) => { const c = new Set(s); c.has(id) ? c.delete(id) : c.add(id); return c; });
  const currentList = lists.data?.find((l) => l.id === listId);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Работы и материалы</h1>
        <button className="btn primary sm" disabled={ro || !listId} onClick={() => setEdit({ ...empty, priceListId: listId })}><Icon.plus width={18} />Позиция</button>
      </div>

      <button className="list-item panel" style={{ marginBottom: 12 }} onClick={() => setListsOpen(true)}>
        <div className="grow"><div className="xs muted">Прайс-лист</div><div className="title">{currentList?.name || '…'}</div></div>
        <span className="small muted">{currentList?.itemsCount ?? ''} поз.</span><Icon.chevron className="chev" width={18} />
      </button>

      <SearchBox value={q} onChange={setQ} placeholder="Поиск по названию" />
      <Chips value={type} onChange={setType} options={[{ value: '', label: 'Все' }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))]} />
      <select className="select" style={{ marginBottom: 12 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория">
        <option value="">Все категории</option>
        {(cats.data || []).map((c) => <option key={c}>{c}</option>)}
      </select>

      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="xs muted">Цена копируется в смету при добавлении. Изменения здесь не меняют сохранённые сметы.</span>
        {!ro && <button className="btn ghost sm" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? 'Отмена' : 'Выбрать'}</button>}
      </div>

      <Load state={items} empty={(d) => (d.length ? null : (
        <State title={q || type || category ? 'Ничего не найдено' : 'Справочник пуст'}
          text={q || type || category ? 'Измените поиск или фильтр.' : 'Добавьте работы и материалы с вашими ценами — они будут подставляться в новые сметы.'}
          action={!ro && !q ? <button className="btn primary" onClick={() => setEdit({ ...empty, priceListId: listId })}>Добавить позицию</button> : undefined} />
      ))}>
        {(list) => (
          <div className="list">
            {list.map((it) => (
              <button key={it.id} className="list-item" onClick={() => (selecting ? toggle(it.id) : setEdit({ ...it, price: String(it.price), costPrice: it.costPrice == null ? '' : String(it.costPrice) }))} style={{ opacity: it.active ? 1 : 0.5 }}>
                {selecting && <input type="checkbox" readOnly checked={selected.has(it.id)} aria-label="Выбрать" />}
                <div className="grow">
                  <div className="title ellipsis">{it.name}</div>
                  <div className="xs muted">{it.category} · {TYPE_LABEL[it.type]}{!it.active ? ' · неактивна' : ''}</div>
                </div>
                <div className="right"><div className="num" style={{ fontWeight: 700 }}>{rub(it.price)}</div><div className="xs muted">за {it.unit}</div></div>
              </button>
            ))}
          </div>
        )}
      </Load>

      {selecting && selected.size > 0 && (
        <div className="totalbar"><div className="in">
          <div className="grow small">Выбрано: {selected.size}</div>
          <button className="btn primary" onClick={() => setCopyOpen(true)}>Копировать или перенести</button>
        </div></div>
      )}

      <ItemSheet item={edit} onClose={() => setEdit(null)} categories={cats.data || []} readOnly={ro}
        onSaved={() => { setEdit(null); items.reload(); lists.reload(); cats.reload(); }} />

      <Sheet open={listsOpen} onClose={() => setListsOpen(false)} title="Прайс-листы">
        <PriceLists lists={lists.data || []} current={listId} readOnly={ro}
          onPick={(id) => { setListId(id); setListsOpen(false); }} onChanged={() => lists.reload()} />
      </Sheet>

      <Sheet open={copyOpen} onClose={() => setCopyOpen(false)} title={`Позиций: ${selected.size}`}>
        <p className="small muted">Выберите прайс-лист, куда скопировать или перенести позиции.</p>
        <div className="list">
          {(lists.data || []).filter((l) => l.id !== listId).map((l) => (
            <div key={l.id} className="list-item" style={{ cursor: 'default' }}>
              <div className="grow title">{l.name}</div>
              <button className="btn sm" onClick={async () => { await post('/items/copy', { itemIds: [...selected], toPriceListId: l.id }); toast('Скопировано'); setCopyOpen(false); setSelecting(false); lists.reload(); }}>Копировать</button>
              <button className="btn sm" onClick={async () => { await post('/items/copy', { itemIds: [...selected], toPriceListId: l.id, move: true }); toast('Перенесено'); setCopyOpen(false); setSelecting(false); items.reload(); lists.reload(); }}>Перенести</button>
            </div>
          ))}
        </div>
        {(lists.data || []).length < 2 && <State title="Нужен второй прайс-лист" text="Создайте его в списке прайс-листов." />}
      </Sheet>
    </>
  );
}

function ItemSheet({ item, onClose, onSaved, categories, readOnly }: { item: any; onClose: () => void; onSaved: () => void; categories: string[]; readOnly: boolean }) {
  const toast = useToast();
  const [f, setF] = useState<any>(item);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => { setF(item); setErr({}); setShowHistory(false); }, [item]);
  if (!item || !f) return null;
  const set = (p: any) => setF((x: any) => ({ ...x, ...p }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Введите название';
    if (!f.category.trim()) e.category = 'Укажите категорию';
    if (!f.unit.trim()) e.unit = 'Укажите единицу';
    if (f.price === '' || parseNum(f.price) < 0) e.price = 'Цена не может быть пустой или отрицательной';
    if (f.costPrice !== '' && parseNum(f.costPrice) < 0) e.costPrice = 'Не может быть отрицательной';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const body = { priceListId: f.priceListId, name: f.name, type: f.type, category: f.category, unit: f.unit, price: parseNum(f.price), costPrice: f.costPrice === '' ? null : parseNum(f.costPrice), description: f.description || null, notes: f.notes || null, active: f.active };
    try {
      if (f.id) await patch(`/items/${f.id}`, body); else await post('/items', body);
      toast(f.id ? 'Позиция сохранена' : 'Позиция добавлена');
      onSaved();
    } catch (x: any) { toast(x.message, true); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmDialog(`Удалить «${f.name}» из справочника? Сохранённые сметы не изменятся.`))) return;
    await del(`/items/${f.id}`); toast('Позиция удалена'); onSaved();
  };

  return (
    <Sheet open onClose={onClose} title={f.id ? 'Позиция справочника' : 'Новая позиция'}>
      <div className="stack">
        <Field label="Название" error={err.name}><input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Монтаж бордюра" readOnly={readOnly} /></Field>
        <div className="grid2">
          <Field label="Тип"><select className="select" value={f.type} onChange={(e) => set({ type: e.target.value })} disabled={readOnly}>{Object.entries(TYPE_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field>
          <Field label="Единица" error={err.unit}>
            <input className="input" list="units" value={f.unit} onChange={(e) => set({ unit: e.target.value })} readOnly={readOnly} />
            <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          </Field>
        </div>
        <Field label="Категория" error={err.category} hint="Выберите из списка или впишите свою">
          <input className="input" list="cats" value={f.category} onChange={(e) => set({ category: e.target.value })} readOnly={readOnly} />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="grid2">
          <Field label="Ваша цена" error={err.price}><NumInput value={f.price} onChange={(v) => set({ price: v })} unit="₽" readOnly={readOnly} /></Field>
          <Field label="Закупочная / себестоимость" error={err.costPrice} hint="Для расчёта прибыли"><NumInput value={f.costPrice} onChange={(v) => set({ costPrice: v })} unit="₽" readOnly={readOnly} placeholder="—" /></Field>
        </div>
        <Field label="Описание"><input className="input" value={f.description || ''} onChange={(e) => set({ description: e.target.value })} readOnly={readOnly} /></Field>
        <Field label="Примечания"><input className="input" value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} readOnly={readOnly} /></Field>
        <label className="row small"><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} disabled={readOnly} />Активна (показывать при подборе в смету)</label>
        {f.id && <p className="xs muted">Цена изменена: {date(f.priceUpdatedAt)}. <button className="btn ghost sm" onClick={() => setShowHistory(!showHistory)}>История цен</button></p>}
        {showHistory && <PriceHistory id={f.id} />}
        {!readOnly && <button className="btn primary block lg" onClick={save} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>}
        {f.id && !readOnly && <button className="btn block danger" onClick={remove}>Удалить из справочника</button>}
      </div>
    </Sheet>
  );
}

function PriceHistory({ id }: { id: string }) {
  const h = useLoad(() => get<any[]>(`/items/${id}/history`), [id]);
  return (
    <Load state={h}>{(list) => (
      <table className="breakdown"><tbody>
        {list.map((r) => <tr key={r.id}><td>{new Date(r.changedAt).toLocaleString('ru-RU')}</td><td>{rub(r.price)}{r.costPrice != null ? ` / закуп ${rub(r.costPrice)}` : ''}</td></tr>)}
      </tbody></table>
    )}</Load>
  );
}

function PriceLists({ lists, current, onPick, onChanged, readOnly }: { lists: any[]; current: string; onPick: (id: string) => void; onChanged: () => void; readOnly: boolean }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const create = async () => {
    if (!name.trim()) return toast('Введите название прайс-листа', true);
    const l = await post('/pricelists', { name, copyFromId: copyFrom || undefined });
    setName(''); setCopyFrom(''); onChanged(); onPick(l.id); toast('Прайс-лист создан');
  };
  return (
    <div className="stack">
      <div className="list">
        {lists.map((l) => (
          <div key={l.id} className="list-item" style={{ cursor: 'default' }}>
            <button className="grow" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, cursor: 'pointer' }} onClick={() => onPick(l.id)}>
              <div className="title">{l.name} {l.id === current && <Icon.check width={16} style={{ color: 'var(--accent)', verticalAlign: -3 }} />}</div>
              <div className="xs muted">{l.itemsCount} поз.{l.isDefault ? ' · основной' : ''}</div>
            </button>
            {!readOnly && !l.isDefault && <button className="btn sm" onClick={async () => { await patch(`/pricelists/${l.id}`, { isDefault: true }); onChanged(); }}>Основной</button>}
            {!readOnly && lists.length > 1 && <button className="icon-btn" aria-label="Удалить" onClick={async () => {
              if (!(await confirmDialog(`Удалить прайс-лист «${l.name}» и все его позиции? Сметы не изменятся.`))) return;
              await del(`/pricelists/${l.id}`); onChanged(); if (l.id === current) onPick(lists.find((x) => x.id !== l.id)!.id);
            }}><Icon.trash /></button>}
          </div>
        ))}
      </div>
      {!readOnly && (
        <>
          <Field label="Новый прайс-лист"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Цены 2027" /></Field>
          <Field label="Скопировать позиции из">
            <select className="select" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Пустой</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <button className="btn primary block" onClick={create}>Создать</button>
        </>
      )}
    </div>
  );
}
