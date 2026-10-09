import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post, put, del } from '../api';
import { calcEstimate } from '../../../shared/estimate';
import { useMe } from '../App';
import { Field, Icon, Load, NumInput, SearchBox, Sheet, State, useDebounced, useLoad, useToast } from '../components/ui';
import { rub, n, pct, date, dateInput, parseNum, EST_STATUS, TYPE_LABEL, UNITS } from '../format';
import { confirmDialog, haptic } from '../tg';

type L = { k: string; id?: string; name: string; qty: string; unit: string; price: string; costPrice: string; type: string; category: string; note: string; catalogItemId?: string | null; unconfirmed?: boolean };
type H = { title: string; customer: string; address: string; date: string; status: string; projectId: string | null; notes: string;
  discountPct: string; markupPct: string; taxPct: string; lossReservePct: string; delivery: string; extraCosts: string };

let seq = 0;
const key = () => `l${Date.now()}_${seq++}`;
const toL = (l: any): L => ({ k: key(), id: l.id, name: l.name, qty: String(l.qty ?? ''), unit: l.unit || 'шт', price: String(l.price ?? ''), costPrice: l.costPrice == null ? '' : String(l.costPrice), type: l.type || 'work', category: l.category || '', note: l.note || '', catalogItemId: l.catalogItemId, unconfirmed: l.unconfirmed });
const toH = (e: any): H => ({ title: e.title, customer: e.customer || '', address: e.address || '', date: dateInput(e.date), status: e.status, projectId: e.projectId, notes: e.notes || '',
  discountPct: String(e.discountPct || 0), markupPct: String(e.markupPct || 0), taxPct: String(e.taxPct || 0), lossReservePct: String(e.lossReservePct || 0), delivery: String(e.delivery || 0), extraCosts: String(e.extraCosts || 0) });
const payload = (h: H, lines: L[]) => ({
  title: h.title.trim() || 'Без названия', customer: h.customer || null, address: h.address || null, date: h.date || undefined, status: h.status, projectId: h.projectId || null, notes: h.notes || null,
  discountPct: parseNum(h.discountPct), markupPct: parseNum(h.markupPct), taxPct: parseNum(h.taxPct), lossReservePct: parseNum(h.lossReservePct), delivery: parseNum(h.delivery), extraCosts: parseNum(h.extraCosts),
  lines: lines.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), qty: parseNum(l.qty), unit: l.unit || 'шт', price: parseNum(l.price), costPrice: l.costPrice === '' ? null : parseNum(l.costPrice), type: l.type, category: l.category || null, note: l.note || null, catalogItemId: l.catalogItemId || null, unconfirmed: Boolean(l.unconfirmed) })),
});
const draftKey = (id: string) => `smeta_draft_${id}`;

export default function EstimateEditor() {
  const { id } = useParams();
  const state = useLoad(() => get(`/estimates/${id}`), [id]);
  return <Load state={state}>{(e) => <Editor key={e.id} initial={e} reload={state.reload} />}</Load>;
}

function Editor({ initial, reload }: { initial: any; reload: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useMe();
  const readOnly = !me.access.active;
  const [h, setH] = useState<H>(() => toH(initial));
  const [lines, setLines] = useState<L[]>(() => initial.lines.map(toL));
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [sheet, setSheet] = useState<null | 'head' | 'params' | 'add' | 'more' | 'history' | 'line'>(null);
  const [editLine, setEditLine] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(false);
  const [restore, setRestore] = useState<any>(null);
  const saving = useRef(false);

  // Восстановление незавершённого ввода
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey(initial.id));
      if (raw) {
        const d = JSON.parse(raw);
        if (d.at > new Date(initial.updatedAt).getTime()) setRestore(d); else localStorage.removeItem(draftKey(initial.id));
      }
    } catch { /* */ }
  }, [initial.id, initial.updatedAt]);

  const change = useCallback(() => setDirty(true), []);
  const setHead = (patch: Partial<H>) => { setH((x) => ({ ...x, ...patch })); change(); };
  const setLine = (k: string, patch: Partial<L>) => { setLines((ls) => ls.map((l) => (l.k === k ? { ...l, ...patch } : l))); change(); };

  // Локальная копия на случай закрытия приложения
  useEffect(() => {
    if (!dirty) return;
    try { localStorage.setItem(draftKey(initial.id), JSON.stringify({ at: Date.now(), h, lines })); } catch { /* */ }
  }, [h, lines, dirty, initial.id]);

  const save = useCallback(async () => {
    if (saving.current || readOnly) return;
    saving.current = true;
    setSaveState('saving');
    try {
      await put(`/estimates/${initial.id}`, payload(h, lines));
      setDirty(false);
      setSaveState('saved');
      try { localStorage.removeItem(draftKey(initial.id)); } catch { /* */ }
    } catch (e: any) {
      setSaveState('error');
      if (e.code !== 'subscription_required') toast(e.message, true);
    } finally { saving.current = false; }
  }, [h, lines, initial.id, readOnly, toast]);

  // Автосохранение через 1,2 с после последнего изменения
  const debounced = useDebounced({ h, lines }, 1200);
  useEffect(() => { if (dirty) save(); /* eslint-disable-next-line */ }, [debounced]);

  const totals = useMemo(() => calcEstimate(
    lines.map((l) => ({ qty: parseNum(l.qty), price: parseNum(l.price), costPrice: l.costPrice === '' ? null : parseNum(l.costPrice), type: l.type, category: l.category })),
    { discountPct: parseNum(h.discountPct), markupPct: parseNum(h.markupPct), taxPct: parseNum(h.taxPct), lossReservePct: parseNum(h.lossReservePct), delivery: parseNum(h.delivery), extraCosts: parseNum(h.extraCosts) },
  ), [lines, h]);

  const move = (k: string, dir: -1 | 1) => {
    setLines((ls) => { const i = ls.findIndex((l) => l.k === k); const j = i + dir; if (j < 0 || j >= ls.length) return ls; const c = [...ls]; [c[i], c[j]] = [c[j], c[i]]; return c; });
    change();
  };
  const duplicate = (k: string) => { setLines((ls) => { const i = ls.findIndex((l) => l.k === k); const c = [...ls]; c.splice(i + 1, 0, { ...ls[i], k: key(), id: undefined }); return c; }); change(); };
  const remove = async (k: string) => {
    const l = lines.find((x) => x.k === k);
    if (l?.name && !(await confirmDialog(`Удалить позицию «${l.name}»?`))) return;
    setLines((ls) => ls.filter((x) => x.k !== k)); change(); setSheet(null);
  };
  const addLines = (ls: Partial<L>[]) => {
    setLines((cur) => [...cur, ...ls.map((l) => ({ k: key(), name: '', qty: '1', unit: 'шт', price: '0', costPrice: '', type: 'work', category: '', note: '', ...l }))]);
    change(); haptic('light');
  };

  const action = async (fn: () => Promise<any>, ok?: string) => {
    try { if (dirty) await save(); await fn(); if (ok) toast(ok); } catch (e: any) { toast(e.message, true); }
  };

  const order = useMemo(() => {
    if (!grouped) return [{ cat: null as string | null, items: lines }];
    const m = new Map<string, L[]>();
    lines.forEach((l) => { const c = l.category || 'Без категории'; m.set(c, [...(m.get(c) || []), l]); });
    return [...m.entries()].map(([cat, items]) => ({ cat, items }));
  }, [lines, grouped]);
  const idx = new Map(lines.map((l, i) => [l.k, i]));
  const current = lines.find((l) => l.k === editLine);

  return (
    <>
      {restore && (
        <div className="banner">
          Найден несохранённый ввод от {new Date(restore.at).toLocaleString('ru-RU')}.
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm primary" onClick={() => { setH(restore.h); setLines(restore.lines); setDirty(true); setRestore(null); }}>Восстановить</button>
            <button className="btn sm" onClick={() => { try { localStorage.removeItem(draftKey(initial.id)); } catch { /* */ } setRestore(null); }}>Не нужно</button>
          </div>
        </div>
      )}

      <button className="list-item panel" style={{ marginBottom: 12, padding: 16 }} onClick={() => setSheet('head')}>
        <div className="grow">
          <div className="page-title" style={{ margin: 0, fontSize: 24 }}>{h.title || 'Без названия'}</div>
          <div className="small muted">{[h.customer || 'Заказчик не указан', h.date && date(h.date), EST_STATUS[h.status]].filter(Boolean).join(' · ')}</div>
          {initial.project && <div className="small" style={{ color: 'var(--amber)' }}>Объект: {initial.project.name}</div>}
        </div>
        <Icon.chevron className="chev" width={20} />
      </button>

      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="xs muted">{readOnly ? 'Только просмотр' : saveState === 'saving' ? 'Сохраняю…' : saveState === 'error' ? 'Не сохранено' : dirty ? 'Есть изменения' : 'Сохранено'}</span>
        <div className="row">
          <button className={`chip ${grouped ? 'on' : ''}`} onClick={() => setGrouped(!grouped)}>По категориям</button>
          <button className="icon-btn" aria-label="Действия" onClick={() => setSheet('more')}><Icon.more /></button>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="panel"><State title="В смете пока нет позиций" text="Добавьте работы и материалы из своего справочника или пустой строкой." /></div>
      ) : (
        <div className="list">
          {order.map((g) => (
            <React.Fragment key={g.cat || 'all'}>
              {g.cat && <div className="cat-head"><span>{g.cat}</span><span className="num">{rub(g.items.reduce((a, l) => a + totals.lineAmounts[idx.get(l.k)!], 0))}</span></div>}
              {g.items.map((l) => (
                <div key={l.k} className={`line ${l.unconfirmed ? 'unconfirmed' : ''}`}>
                  <div className="line-top">
                    <input className="line-name" value={l.name} placeholder="Название позиции" onChange={(e) => setLine(l.k, { name: e.target.value })} readOnly={readOnly} aria-label="Название" />
                    <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Подробнее" onClick={() => { setEditLine(l.k); setSheet('line'); }}><Icon.more /></button>
                  </div>
                  <div className="line-grid">
                    <NumInput value={l.qty} onChange={(v) => setLine(l.k, { qty: v })} placeholder="Кол-во" aria-label="Количество" readOnly={readOnly} invalid={parseNum(l.qty) < 0} />
                    <select className="select" style={{ minHeight: 40, padding: '6px 4px' }} value={l.unit} onChange={(e) => setLine(l.k, { unit: e.target.value })} disabled={readOnly} aria-label="Единица">
                      {[...new Set([l.unit, ...UNITS])].map((u) => <option key={u}>{u}</option>)}
                    </select>
                    <NumInput value={l.price} onChange={(v) => setLine(l.k, { price: v })} unit="₽" aria-label="Цена" readOnly={readOnly} invalid={parseNum(l.price) < 0} />
                  </div>
                  <div className="line-sum"><span className="muted">{TYPE_LABEL[l.type]}{l.category && !grouped ? ` · ${l.category}` : ''}{l.unconfirmed ? ' · требует уточнения' : ''}</span><b className="num">{rub(totals.lineAmounts[idx.get(l.k)!])}</b></div>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="grid2" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => setSheet('add')}><Icon.book width={18} />Из справочника</button>
          <button className="btn" onClick={() => addLines([{}])}><Icon.plus width={18} />Пустая строка</button>
        </div>
      )}

      <h2 className="section-title">Итог</h2>
      <div className="panel">
        <div className="dim"><div className="dim-value num">{rub(totals.total)}</div><div className="dim-label">Итого заказчику</div></div>
        <table className="breakdown" style={{ marginTop: 16 }}>
          <tbody>
            <tr><td>Работы</td><td>{rub(totals.worksSubtotal)}</td></tr>
            <tr><td>Материалы</td><td>{rub(totals.materialsSubtotal)}</td></tr>
            {totals.otherSubtotal > 0 && <tr><td>Техника, услуги, прочее</td><td>{rub(totals.otherSubtotal)}</td></tr>}
            {totals.reserve > 0 && <tr><td>Резерв на потери ({pct(parseNum(h.lossReservePct))} от материалов)</td><td>{rub(totals.reserve)}</td></tr>}
            {totals.markup > 0 && <tr><td>Наценка {pct(parseNum(h.markupPct))}</td><td>{rub(totals.markup)}</td></tr>}
            {totals.discount > 0 && <tr><td>Скидка {pct(parseNum(h.discountPct))}</td><td>−{rub(totals.discount)}</td></tr>}
            {totals.delivery > 0 && <tr><td>Доставка</td><td>{rub(totals.delivery)}</td></tr>}
            {totals.extraCosts > 0 && <tr><td>Доп. расходы</td><td>{rub(totals.extraCosts)}</td></tr>}
            {totals.tax > 0 && <tr><td>Налог {pct(parseNum(h.taxPct))}</td><td>{rub(totals.tax)}</td></tr>}
            <tr className="total"><td>Итого</td><td>{rub(totals.total)}</td></tr>
          </tbody>
        </table>
        <button className="btn block" style={{ marginTop: 12 }} onClick={() => setSheet('params')} disabled={readOnly}>Скидка, наценка, налог, доставка</button>
      </div>

      <h2 className="section-title">Для себя</h2>
      <div className="panel">
        <table className="breakdown"><tbody>
          <tr><td>Себестоимость (прямые затраты)</td><td>{rub(totals.directCost)}</td></tr>
          <tr><td>Выручка без налога</td><td>{rub(totals.revenueExTax)}</td></tr>
          <tr className="total"><td>Плановая прибыль</td><td className={totals.plannedProfit < 0 ? 'neg' : 'pos'}>{rub(totals.plannedProfit)}</td></tr>
          <tr><td>Маржа</td><td>{pct(totals.marginPct)}</td></tr>
        </tbody></table>
        {totals.linesWithoutCost > 0 && <p className="xs muted" style={{ marginBottom: 0 }}>У {totals.linesWithoutCost} поз. не указана закупочная цена — они не входят в себестоимость, прибыль может быть завышена.</p>}
      </div>

      <div className="totalbar"><div className="in">
        <div className="grow"><div className="xs muted">Итого</div><div className="sum num">{rub(totals.total)}</div></div>
        {!readOnly && <button className="btn primary" onClick={save} disabled={!dirty || saveState === 'saving'}>{saveState === 'saving' ? 'Сохраняю…' : dirty ? 'Сохранить' : 'Сохранено'}</button>}
      </div></div>
      <div style={{ height: 80 }} />

      {/* ---- Шапка ---- */}
      <Sheet open={sheet === 'head'} onClose={() => setSheet(null)} title="Данные сметы">
        <HeadForm h={h} setHead={setHead} readOnly={readOnly} />
      </Sheet>

      {/* ---- Параметры ---- */}
      <Sheet open={sheet === 'params'} onClose={() => setSheet(null)} title="Скидка, наценка, налог">
        <div className="stack">
          <div className="grid2">
            <Field label="Наценка" hint="На подытог и резерв"><NumInput value={h.markupPct} onChange={(v) => setHead({ markupPct: v })} unit="%" /></Field>
            <Field label="Скидка" hint="После наценки"><NumInput value={h.discountPct} onChange={(v) => setHead({ discountPct: v })} unit="%" /></Field>
            <Field label="Резерв на потери" hint="От суммы материалов"><NumInput value={h.lossReservePct} onChange={(v) => setHead({ lossReservePct: v })} unit="%" /></Field>
            <Field label="Налог" hint="Начисляется сверху"><NumInput value={h.taxPct} onChange={(v) => setHead({ taxPct: v })} unit="%" /></Field>
            <Field label="Доставка"><NumInput value={h.delivery} onChange={(v) => setHead({ delivery: v })} unit="₽" /></Field>
            <Field label="Доп. расходы"><NumInput value={h.extraCosts} onChange={(v) => setHead({ extraCosts: v })} unit="₽" /></Field>
          </div>
          <p className="xs muted">Порядок: подытог → резерв → наценка → скидка → доставка и доп. расходы → налог.</p>
          <button className="btn primary block" onClick={() => setSheet(null)}>Готово</button>
        </div>
      </Sheet>

      {/* ---- Строка подробно ---- */}
      <Sheet open={sheet === 'line' && !!current} onClose={() => setSheet(null)} title="Позиция">
        {current && (
          <div className="stack">
            <Field label="Название"><input className="input" value={current.name} onChange={(e) => setLine(current.k, { name: e.target.value })} readOnly={readOnly} /></Field>
            <div className="grid2">
              <Field label="Тип"><select className="select" value={current.type} onChange={(e) => setLine(current.k, { type: e.target.value })} disabled={readOnly}>{Object.entries(TYPE_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field>
              <Field label="Категория"><input className="input" value={current.category} onChange={(e) => setLine(current.k, { category: e.target.value })} readOnly={readOnly} placeholder="Напр. Фундамент" /></Field>
              <Field label="Количество"><NumInput value={current.qty} onChange={(v) => setLine(current.k, { qty: v })} unit={current.unit} readOnly={readOnly} /></Field>
              <Field label="Единица"><input className="input" value={current.unit} onChange={(e) => setLine(current.k, { unit: e.target.value })} readOnly={readOnly} /></Field>
              <Field label="Цена заказчику"><NumInput value={current.price} onChange={(v) => setLine(current.k, { price: v })} unit="₽" readOnly={readOnly} /></Field>
              <Field label="Закупочная / себестоимость" hint="Не видна заказчику"><NumInput value={current.costPrice} onChange={(v) => setLine(current.k, { costPrice: v })} unit="₽" readOnly={readOnly} placeholder="—" /></Field>
            </div>
            <Field label="Примечание"><input className="input" value={current.note} onChange={(e) => setLine(current.k, { note: e.target.value })} readOnly={readOnly} /></Field>
            {current.unconfirmed && <label className="row small"><input type="checkbox" checked={!current.unconfirmed} onChange={() => setLine(current.k, { unconfirmed: false })} />Позиция уточнена</label>}
            {!readOnly && (
              <div className="row wrap">
                <button className="btn sm" onClick={() => move(current.k, -1)}><Icon.up width={16} />Выше</button>
                <button className="btn sm" onClick={() => move(current.k, 1)}><Icon.down width={16} />Ниже</button>
                <button className="btn sm" onClick={() => { duplicate(current.k); setSheet(null); }}><Icon.copy width={16} />Дублировать</button>
                <button className="btn sm danger" onClick={() => remove(current.k)}><Icon.trash width={16} />Удалить</button>
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* ---- Добавить из справочника ---- */}
      <Sheet open={sheet === 'add'} onClose={() => setSheet(null)} title="Добавить из справочника">
        {sheet === 'add' && <CatalogPicker onPick={(it) => addLines([{ name: it.name, unit: it.unit, price: String(it.price), costPrice: it.costPrice == null ? '' : String(it.costPrice), type: it.type, category: it.category, catalogItemId: it.id }])} />}
      </Sheet>

      {/* ---- Действия ---- */}
      <Sheet open={sheet === 'more'} onClose={() => setSheet(null)} title="Действия со сметой">
        <div className="list">
          <button className="list-item" disabled={readOnly} onClick={() => action(async () => { const r = await post(`/estimates/${initial.id}/refresh-prices`); setLines(r.lines.map(toL)); setDirty(false); setSheet(null); toast(r.changed ? `Обновлено цен: ${r.changed}` : 'Цены уже актуальны'); })}>
            <div className="grow"><div className="title">Обновить цены из справочника</div><div className="xs muted">Подставит текущие цены в позиции, добавленные из справочника</div></div>
          </button>
          <button className="list-item" disabled={readOnly} onClick={() => action(async () => { const e = await post(`/estimates/${initial.id}/duplicate`); setSheet(null); nav(`/estimates/${e.id}`); }, 'Копия создана')}>
            <div className="grow title">Копировать смету</div>
          </button>
          {!initial.isTemplate && <button className="list-item" disabled={readOnly} onClick={() => action(async () => { await post(`/estimates/${initial.id}/save-as-template`, {}); setSheet(null); }, 'Шаблон сохранён')}>
            <div className="grow title">Сохранить как шаблон</div>
          </button>}
          <button className="list-item" onClick={() => setSheet('history')}><div className="grow title">История изменений</div></button>
          <button className="list-item" disabled={readOnly} onClick={async () => {
            if (!(await confirmDialog('Удалить смету? Её можно будет восстановить по запросу в поддержку.'))) return;
            await action(async () => { await del(`/estimates/${initial.id}`); nav('/estimates', { replace: true }); }, 'Смета удалена');
          }}><div className="grow title" style={{ color: 'var(--bad)' }}>Удалить смету</div></button>
        </div>
        <p className="xs muted" style={{ marginTop: 12 }}>Экспорт в PDF и Excel появится на следующем этапе.</p>
      </Sheet>

      <Sheet open={sheet === 'history'} onClose={() => setSheet(null)} title="История изменений">
        {sheet === 'history' && <History id={initial.id} />}
      </Sheet>
    </>
  );
}

function HeadForm({ h, setHead, readOnly }: { h: H; setHead: (p: Partial<H>) => void; readOnly: boolean }) {
  const projects = useLoad(() => get<any[]>('/projects'), []);
  return (
    <div className="stack">
      <Field label="Название"><input className="input" value={h.title} onChange={(e) => setHead({ title: e.target.value })} readOnly={readOnly} /></Field>
      <Field label="Заказчик"><input className="input" value={h.customer} onChange={(e) => setHead({ customer: e.target.value })} readOnly={readOnly} /></Field>
      <Field label="Адрес"><input className="input" value={h.address} onChange={(e) => setHead({ address: e.target.value })} readOnly={readOnly} /></Field>
      <div className="grid2">
        <Field label="Дата"><input className="input" type="date" value={h.date} onChange={(e) => setHead({ date: e.target.value })} readOnly={readOnly} /></Field>
        <Field label="Статус"><select className="select" value={h.status} onChange={(e) => setHead({ status: e.target.value })} disabled={readOnly}>{Object.entries(EST_STATUS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Field>
      </div>
      <Field label="Объект" hint="Смета станет плановым бюджетом объекта">
        <select className="select" value={h.projectId || ''} onChange={(e) => setHead({ projectId: e.target.value || null })} disabled={readOnly}>
          <option value="">Без объекта</option>
          {(projects.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Примечания"><textarea className="textarea" value={h.notes} onChange={(e) => setHead({ notes: e.target.value })} readOnly={readOnly} /></Field>
    </div>
  );
}

export function CatalogPicker({ onPick }: { onPick: (item: any) => void }) {
  const toast = useToast();
  const lists = useLoad(() => get<any[]>('/pricelists'), []);
  const [listId, setListId] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const items = useLoad(() => get<any[]>('/items', { priceListId: listId, q: dq }), [listId, dq]);
  return (
    <>
      {(lists.data?.length || 0) > 1 && (
        <select className="select" style={{ marginBottom: 12 }} value={listId || lists.data!.find((l) => l.isDefault)?.id} onChange={(e) => setListId(e.target.value)} aria-label="Прайс-лист">
          {lists.data!.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
      <SearchBox value={q} onChange={setQ} placeholder="Найти работу или материал" />
      <Load state={items} empty={(d) => (d.length ? null : <State title={q ? 'Ничего не найдено' : 'Справочник пуст'} text="Добавьте свои работы и материалы с ценами в разделе «Справочник»." />)}>
        {(list) => (
          <div className="list">
            {list.map((it) => (
              <button key={it.id} className="list-item" onClick={() => { onPick(it); toast(`Добавлено: ${it.name}`); }}>
                <div className="grow"><div className="title ellipsis">{it.name}</div><div className="xs muted">{it.category} · {TYPE_LABEL[it.type]}</div></div>
                <div className="num right small">{rub(it.price)}<div className="xs muted">за {it.unit}</div></div>
                <Icon.plus width={18} style={{ color: 'var(--accent)' }} />
              </button>
            ))}
          </div>
        )}
      </Load>
    </>
  );
}

const ACTIONS: Record<string, string> = { create: 'Создана', update: 'Изменена', add_lines: 'Добавлены позиции', refresh_prices: 'Обновлены цены', delete: 'Удалена', restore: 'Восстановлена' };
function History({ id }: { id: string }) {
  const h = useLoad(() => get<any[]>(`/estimates/${id}/history`), [id]);
  return (
    <Load state={h} empty={(d) => (d.length ? null : <State title="Изменений пока нет" />)}>
      {(list) => (
        <div className="list">
          {list.map((r) => (
            <div key={r.id} className="list-item" style={{ cursor: 'default' }}>
              <div className="grow">
                <div className="title">{ACTIONS[r.action] || r.action}</div>
                <div className="xs muted">{new Date(r.createdAt).toLocaleString('ru-RU')}</div>
              </div>
              {r.data?.totalAfter != null && <div className="small num right">{rub(r.data.totalBefore)} → <b>{rub(r.data.totalAfter)}</b></div>}
              {r.data?.count != null && <div className="small">+{n(r.data.count, 0)}</div>}
            </div>
          ))}
        </div>
      )}
    </Load>
  );
}
