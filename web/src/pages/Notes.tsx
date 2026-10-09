import React, { useEffect, useState } from 'react';
import { get, post, patch, del } from '../api';
import { useMe } from '../App';
import { Field, Icon, Load, SearchBox, Sheet, State, useDebounced, useLoad, useToast } from '../components/ui';
import { date } from '../format';
import { confirmDialog } from '../tg';

export default function Notes() {
  const { me } = useMe();
  const ro = !me.access.active;
  const toast = useToast();
  const [q, setQ] = useState('');
  const [projectId, setProjectId] = useState('');
  const dq = useDebounced(q);
  const notes = useLoad(() => get<any[]>('/notes', { q: dq, projectId }), [dq, projectId]);
  const projects = useLoad(() => get<any[]>('/projects'), []);
  const [edit, setEdit] = useState<any>(null);
  const [f, setF] = useState<any>(null);
  useEffect(() => setF(edit ? { title: edit.title || '', body: edit.body || '', projectId: edit.projectId || '' } : null), [edit]);

  const save = async () => {
    if (!f.title.trim()) return toast('Введите заголовок', true);
    const body = { title: f.title, body: f.body, projectId: f.projectId || null };
    try {
      if (edit.id) await patch(`/notes/${edit.id}`, body); else await post('/notes', body);
      toast('Заметка сохранена'); setEdit(null); notes.reload();
    } catch (e: any) { toast(e.message, true); }
  };

  return (
    <>
      <div className="page-head"><h1 className="page-title">Заметки</h1><button className="btn primary sm" disabled={ro} onClick={() => setEdit({})}><Icon.plus width={18} />Заметка</button></div>
      <SearchBox value={q} onChange={setQ} placeholder="Поиск по заметкам" />
      <select className="select" style={{ marginBottom: 12 }} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Объект">
        <option value="">Все заметки</option>
        {(projects.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Load state={notes} empty={(d) => (d.length ? null : <State title={q ? 'Ничего не найдено' : 'Заметок нет'} text={q ? undefined : 'Записывайте размеры, договорённости с заказчиком и контакты поставщиков.'} />)}>
        {(list) => (
          <div className="list">
            {list.map((n) => (
              <button key={n.id} className="list-item" onClick={() => setEdit(n)}>
                <div className="grow"><div className="title ellipsis">{n.title}</div><div className="xs muted ellipsis">{[n.project?.name, date(n.updatedAt), n.body?.slice(0, 60)].filter(Boolean).join(' · ')}</div></div>
              </button>
            ))}
          </div>
        )}
      </Load>
      <Sheet open={!!edit && !!f} onClose={() => setEdit(null)} title={edit?.id ? 'Заметка' : 'Новая заметка'}>
        {f && (
          <div className="stack">
            <Field label="Заголовок"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} readOnly={ro} /></Field>
            <Field label="Объект">
              <select className="select" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} disabled={ro}>
                <option value="">Общая заметка</option>
                {(projects.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Текст"><textarea className="textarea" style={{ minHeight: 200 }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} readOnly={ro} /></Field>
            {edit?.id && <p className="xs muted">Создана {date(edit.createdAt)}, изменена {date(edit.updatedAt)}</p>}
            {!ro && <button className="btn primary block lg" onClick={save}>Сохранить</button>}
            {edit?.id && !ro && <button className="btn block danger" onClick={async () => {
              if (!(await confirmDialog('Удалить заметку?'))) return;
              await del(`/notes/${edit.id}`); toast('Заметка удалена'); setEdit(null); notes.reload();
            }}>Удалить</button>}
          </div>
        )}
      </Sheet>
    </>
  );
}
