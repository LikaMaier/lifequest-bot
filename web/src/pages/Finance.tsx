import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { Chips, Load, State, useLoad } from '../components/ui';
import { rub, PROJ_STATUS } from '../format';

export default function Finance() {
  const [status, setStatus] = useState('');
  const s = useLoad(() => get<any>('/finance/summary', { status }), [status]);
  return (
    <>
      <h1 className="page-title">Финансы</h1>
      <Chips value={status} onChange={setStatus} options={[{ value: '', label: 'Кроме архива' }, ...Object.entries(PROJ_STATUS).map(([value, label]) => ({ value, label }))]} />
      <Load state={s} empty={(d) => (d.projects.length ? null : <State title="Нет объектов" text="Финансы ведутся по объектам. Создайте объект и добавьте поступления и расходы." />)}>
        {(d) => (
          <>
            <div className="panel">
              <div className="dim"><div className={`dim-value num ${d.totals.forecastProfit < 0 ? 'neg' : ''}`}>{rub(d.totals.forecastProfit)}</div><div className="dim-label">Прогноз прибыли по объектам</div></div>
              <table className="breakdown" style={{ marginTop: 16 }}><tbody>
                <tr><td>Сумма договоров</td><td>{rub(d.totals.contractTotal)}</td></tr>
                <tr><td>Получено от заказчиков</td><td className="pos">{rub(d.totals.received)}</td></tr>
                <tr><td>Долги заказчиков</td><td className={d.totals.customerDebt > 0 ? 'neg' : ''}>{rub(d.totals.customerDebt)}</td></tr>
                <tr><td>Расходы начислено / оплачено</td><td>{rub(d.totals.expensesAccrued)} / {rub(d.totals.expensesPaid)}</td></tr>
                <tr><td>Неоплаченные обязательства</td><td className={d.totals.unpaidObligations > 0 ? 'neg' : ''}>{rub(d.totals.unpaidObligations)}</td></tr>
                <tr><td>Плановая прибыль</td><td>{rub(d.totals.plannedProfit)}</td></tr>
                <tr><td>Прибыль на текущий момент</td><td className={d.totals.currentProfit < 0 ? 'neg' : 'pos'}>{rub(d.totals.currentProfit)}</td></tr>
                <tr className="total"><td>Денежный остаток</td><td className={d.totals.cashBalance < 0 ? 'neg' : ''}>{rub(d.totals.cashBalance)}</td></tr>
              </tbody></table>
            </div>
            <h2 className="section-title">По объектам</h2>
            <div className="list">
              {d.projects.map((p: any) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="list-item">
                  <div className="grow"><div className="title ellipsis">{p.name}</div><div className="xs muted">{PROJ_STATUS[p.status]} · долг заказчика {rub(p.customerDebt)}</div></div>
                  <div className="right"><div className={`num ${p.forecastProfit < 0 ? 'neg' : ''}`} style={{ fontWeight: 700 }}>{rub(p.forecastProfit)}</div><div className="xs muted">план {rub(p.plannedProfit)}</div></div>
                </Link>
              ))}
            </div>
          </>
        )}
      </Load>
    </>
  );
}
