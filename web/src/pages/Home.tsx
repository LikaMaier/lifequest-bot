import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post, patch } from '../api';
import { useMe } from '../App';
import { Icon, Load, Sheet, State, Switch, useLoad, useToast } from '../components/ui';
import { rub, rub0, date, EST_STATUS } from '../format';

export default function Home() {
  const { me, setMe } = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const recent = useLoad(() => get<any[]>('/estimates'), []);
  const fin = useLoad(() => get<any>('/finance/summary'), []);
  const [pickProject, setPickProject] = useState(false);
  const projects = useLoad(() => (pickProject ? get<any[]>('/projects') : Promise.resolve([])), [pickProject]);
  const [busy, setBusy] = useState(false);

  const createEstimate = async () => {
    setBusy(true);
    try { const e = await post('/estimates', { title: 'Новая смета' }); nav(`/estimates/${e.id}`); }
    catch { /* тост показан глобально или ниже */ } finally { setBusy(false); }
  };
  const toggleAi = async (v: boolean) => {
    try { setMe(await patch('/me', { aiEnabled: v })); toast(v ? 'ИИ-помощник включён' : 'ИИ-помощник выключен'); }
    catch (e: any) { toast(e.message, true); }
  };
  const voiceDisabled = !me.aiEnabled || !me.aiAvailable;

  return (
    <>
      <div className="logo"><img src="/icon.svg" alt="" /><div><b>СМЕТА PRO</b><span>Считай точно. Работай прибыльно.</span></div></div>

      <div className="hero-actions">
        <button className="btn primary lg" onClick={createEstimate} disabled={busy || !me.access.active}><Icon.plus width={22} />Создать смету</button>
        <button className="btn lg" onClick={() => nav('/assistant')} disabled={voiceDisabled} title={voiceDisabled ? 'ИИ выключен или не подключён' : ''}><Icon.mic width={20} />По голосу</button>
        <button className="btn lg" onClick={() => setPickProject(true)} disabled={!me.access.active}><Icon.money width={20} />Расход</button>
      </div>
      {voiceDisabled && <p className="xs muted" style={{ marginTop: -12 }}>{!me.aiEnabled ? 'Создание по голосу доступно при включённом ИИ-помощнике.' : 'Голосовой ИИ-сметчик ещё не подключён — сметы составляются вручную.'}</p>}

      <Load state={fin}>{(f) => (
        <div className="kpi">
          <div><b className="num">{f.activeCount}</b><span>Активных объектов</span></div>
          <div><b className={`num ${f.totals.plannedProfit < 0 ? 'neg' : ''}`}>{rub0(f.totals.plannedProfit)}</b><span>Плановая прибыль</span></div>
          <div><b className={`num ${f.totals.currentProfit < 0 ? 'neg' : ''}`}>{rub0(f.totals.currentProfit)}</b><span>Факт на сегодня</span></div>
        </div>
      )}</Load>

      <div className="page-head"><h2 className="section-title">Последние сметы</h2><Link to="/estimates" className="small">Все</Link></div>
      <Load state={recent} empty={(d) => (d.length ? null : <div className="panel"><State title="Смет пока нет" text="Нажмите «Создать смету» — первая смета займёт пару минут." /></div>)}>
        {(list) => (
          <div className="list">
            {list.slice(0, 5).map((e) => (
              <Link key={e.id} to={`/estimates/${e.id}`} className="list-item">
                <div className="grow">
                  <div className="title ellipsis">{e.title}</div>
                  <div className="xs muted">{e.customer || 'Без заказчика'} · {date(e.date)} · {EST_STATUS[e.status]}</div>
                </div>
                <div className="num right" style={{ fontWeight: 700 }}>{rub(e.total)}</div>
              </Link>
            ))}
          </div>
        )}
      </Load>

      <h2 className="section-title">Аккаунт</h2>
      <div className="list">
        <Link to="/settings" className="list-item">
          <div className="grow">
            <div className="title">Подписка</div>
            <div className="xs muted">{me.access.mode === 'trial' ? `Пробный период: ${me.access.daysLeft} дн.` : me.access.mode === 'subscription' ? `Активна до ${date(me.access.until)}` : 'Закончилась'}</div>
          </div>
          <span className={`badge ${me.access.active ? 'ok' : 'bad'}`}>{me.access.active ? 'Активна' : 'Нет доступа'}</span>
        </Link>
        <div className="list-item" style={{ cursor: 'default' }}>
          <div className="grow"><div className="title">ИИ-помощник</div><div className="xs muted">{me.aiEnabled ? 'Включён' : 'Выключен — всё работает вручную'}</div></div>
          <Switch checked={me.aiEnabled} onChange={toggleAi} label="ИИ-помощник" />
        </div>
      </div>

      <Sheet open={pickProject} onClose={() => setPickProject(false)} title="К какому объекту расход?">
        <Load state={projects} empty={(d) => (d.length ? null : <State title="Нет объектов" text="Сначала создайте объект." action={<button className="btn primary" onClick={() => nav('/projects?new=1')}>Создать объект</button>} />)}>
          {(list) => (
            <div className="list">
              {list.map((p) => <button key={p.id} className="list-item" onClick={() => nav(`/projects/${p.id}?add=expense`)}><div className="grow title">{p.name}</div><Icon.chevron className="chev" width={18} /></button>)}
            </div>
          )}
        </Load>
      </Sheet>
    </>
  );
}
