import React, { useEffect, useState } from 'react';
import { get, patch, post } from '../api';
import { useMe } from '../App';
import { Field, Load, Switch, useLoad, useToast } from '../components/ui';
import { date } from '../format';
import { openInvoice, haptic } from '../tg';

export default function Settings() {
  const { me, setMe, refreshMe } = useMe();
  const toast = useToast();
  const plans = useLoad(() => get<any[]>('/plans'), []);
  const [company, setCompany] = useState(me.companyName || '');
  const [contacts, setContacts] = useState(me.contacts || '');
  const [paying, setPaying] = useState('');
  useEffect(() => { setCompany(me.companyName || ''); setContacts(me.contacts || ''); }, [me.companyName, me.contacts]);

  const pay = async (code: string) => {
    setPaying(code);
    try {
      const { url } = await post(`/pay/${code}`);
      const status = await openInvoice(url);
      if (status === 'paid') {
        haptic('success');
        toast('Оплата прошла, обновляю доступ…');
        // Подтверждение приходит на сервер от Telegram — проверяем статус
        for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 1500)); await refreshMe(); }
      } else if (status === 'failed') toast('Оплата не прошла. Попробуйте ещё раз.', true);
    } catch (e: any) { toast(e.message, true); } finally { setPaying(''); }
  };

  return (
    <>
      <h1 className="page-title">Настройки и подписка</h1>

      <div className="panel">
        <div className="row between">
          <div>
            <div className="title" style={{ fontWeight: 700 }}>{me.access.mode === 'trial' ? 'Пробный период' : me.access.mode === 'subscription' ? 'Подписка активна' : 'Подписка закончилась'}</div>
            <div className="small muted">{me.access.active ? `до ${date(me.access.until)} · осталось ${me.access.daysLeft} дн.` : 'Данные сохранены. Изменения доступны после продления.'}</div>
          </div>
          <span className={`badge ${me.access.active ? 'ok' : 'bad'}`}>{me.access.active ? 'Доступ есть' : 'Нет доступа'}</span>
        </div>
      </div>

      <h2 className="section-title">Тарифы</h2>
      <Load state={plans}>{(list) => (
        <div className="list">
          {list.map((p) => (
            <div key={p.code} className="list-item" style={{ cursor: 'default' }}>
              <div className="grow"><div className="title">{p.title}</div><div className="xs muted">{p.starsPrice} ⭐ Telegram Stars</div></div>
              <button className="btn primary sm" disabled={!!paying} onClick={() => pay(p.code)}>{paying === p.code ? 'Открываю…' : me.access.mode === 'subscription' ? 'Продлить' : 'Оформить'}</button>
            </div>
          ))}
        </div>
      )}</Load>
      <p className="xs muted">Оплата в Telegram Stars. Доступ продлевается только после подтверждения платежа Telegram.</p>

      <h2 className="section-title">ИИ-помощник</h2>
      <div className="panel">
        <div className="row between">
          <div className="grow"><div style={{ fontWeight: 600 }}>{me.aiEnabled ? 'Включён' : 'Выключен'}</div>
            <div className="xs muted">{me.aiEnabled ? (me.aiAvailable ? 'Можно создавать сметы голосом и текстом.' : 'Голосовой сметчик ещё не подключён на сервере.') : 'Запросы к ИИ не отправляются. Сметы, калькуляторы, справочник и финансы работают вручную.'}</div></div>
          <Switch checked={me.aiEnabled} label="ИИ-помощник" onChange={async (v) => { try { setMe(await patch('/me', { aiEnabled: v })); } catch (e: any) { toast(e.message, true); } }} />
        </div>
      </div>

      <h2 className="section-title">Реквизиты для смет</h2>
      <div className="panel stack">
        <Field label="Компания или имя мастера"><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        <Field label="Контакты" hint="Телефон, мессенджер — попадут в смету для заказчика"><textarea className="textarea" style={{ minHeight: 80 }} value={contacts} onChange={(e) => setContacts(e.target.value)} /></Field>
        <button className="btn primary block" onClick={async () => { try { setMe(await patch('/me', { companyName: company || null, contacts: contacts || null })); toast('Сохранено'); } catch (e: any) { toast(e.message, true); } }}>Сохранить</button>
      </div>
    </>
  );
}
