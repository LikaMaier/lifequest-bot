import React from 'react';
import { Link } from 'react-router-dom';
import { patch } from '../api';
import { useMe } from '../App';
import { State, Switch, useToast } from '../components/ui';

export default function Assistant() {
  const { me, setMe } = useMe();
  const toast = useToast();
  return (
    <>
      <h1 className="page-title">ИИ-помощник</h1>
      <div className="panel row between">
        <div className="grow"><b>{me.aiEnabled ? 'Включён' : 'Выключен'}</b><div className="xs muted">Состояние сохраняется в вашем аккаунте</div></div>
        <Switch checked={me.aiEnabled} label="ИИ-помощник" onChange={async (v) => { try { setMe(await patch('/me', { aiEnabled: v })); } catch (e: any) { toast(e.message, true); } }} />
      </div>
      {!me.aiEnabled ? (
        <State title="ИИ выключен" text="Запросы к ИИ не отправляются. Составляйте сметы вручную или включите помощника." action={<Link to="/estimates" className="btn primary">К сметам</Link>} />
      ) : !me.aiAvailable ? (
        <State title="Голосовой сметчик ещё не подключён"
          text="Он будет принимать голос и текст заказчика, задавать уточняющие вопросы по одному и собирать черновик сметы по вашим ценам. Расчёты — только через проверяемый расчётный модуль."
          action={<Link to="/calculators" className="btn">Открыть калькуляторы</Link>} />
      ) : null}
    </>
  );
}
