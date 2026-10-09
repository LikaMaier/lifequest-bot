import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';

const ITEMS = [
  { to: '/calculators', icon: Icon.calc, title: 'Калькуляторы', text: 'Бетон, кирпич, гипсокартон, отделка, древесина' },
  { to: '/finance', icon: Icon.money, title: 'Финансы', text: 'Прибыль и долги по всем объектам' },
  { to: '/assistant', icon: Icon.mic, title: 'ИИ-помощник', text: 'Сметы по голосу и тексту' },
  { to: '/notes', icon: Icon.note, title: 'Заметки', text: 'По объектам и общие' },
  { to: '/settings', icon: Icon.gear, title: 'Настройки и подписка', text: 'Тариф, ИИ, реквизиты' },
];

export default function More() {
  return (
    <>
      <h1 className="page-title">Ещё</h1>
      <div className="list">
        {ITEMS.map((i) => (
          <Link key={i.to} to={i.to} className="list-item">
            <i.icon width={24} style={{ color: 'var(--accent)', flex: 'none' }} />
            <div className="grow"><div className="title">{i.title}</div><div className="xs muted">{i.text}</div></div>
            <Icon.chevron className="chev" width={18} />
          </Link>
        ))}
      </div>
    </>
  );
}
