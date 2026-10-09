import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { post, get, setToken, onApiError } from './api';
import { tg, inTelegram, initTelegram } from './tg';
import { Boundary, Icon, State, ToastProvider, useToast } from './components/ui';
import Home from './pages/Home';
import Estimates from './pages/Estimates';
import EstimateEditor from './pages/EstimateEditor';
import Catalog from './pages/Catalog';
import Calculators, { CalculatorPage } from './pages/Calculators';
import Projects from './pages/Projects';
import ProjectPage from './pages/ProjectPage';
import Finance from './pages/Finance';
import Notes from './pages/Notes';
import Settings from './pages/Settings';
import Assistant from './pages/Assistant';
import More from './pages/More';

export interface Me {
  id: string; firstName?: string; companyName?: string | null; contacts?: string | null;
  aiEnabled: boolean; aiAvailable: boolean; isAdmin: boolean;
  access: { active: boolean; mode: 'trial' | 'subscription' | 'expired'; until: string; daysLeft: number };
}
const MeCtx = createContext<{ me: Me; setMe: (m: Me) => void; refreshMe: () => Promise<void> }>(null as any);
export const useMe = () => useContext(MeCtx);

const TABS = [
  { to: '/', label: 'Главная', icon: Icon.home, end: true },
  { to: '/estimates', label: 'Сметы', icon: Icon.doc },
  { to: '/projects', label: 'Объекты', icon: Icon.site },
  { to: '/catalog', label: 'Справочник', icon: Icon.book },
  { to: '/more', label: 'Ещё', icon: Icon.more },
];
const ROOTS = TABS.map((t) => t.to);

function TabBar() {
  return (
    <div className="tabbar">
      <nav>
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <t.icon />{t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Кнопка «Назад» Telegram на вложенных экранах */
function TgBack() {
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    if (!tg?.BackButton) return;
    const back = () => nav(-1);
    if (ROOTS.includes(loc.pathname)) tg.BackButton.hide(); else tg.BackButton.show();
    tg.BackButton.onClick(back);
    return () => tg.BackButton.offClick(back);
  }, [loc.pathname, nav]);
  return null;
}

function ApiErrorToasts() {
  const toast = useToast();
  useEffect(() => onApiError((e) => {
    if (e.code === 'subscription_required') toast('Требуется подписка. Данные сохранены — продлите доступ в настройках.', true);
  }), [toast]);
  return null;
}

function Shell({ me, setMe }: { me: Me; setMe: (m: Me) => void }) {
  const refreshMe = useCallback(async () => setMe(await get<Me>('/me')), [setMe]);
  return (
    <MeCtx.Provider value={{ me, setMe, refreshMe }}>
      <BrowserRouter>
        <TgBack />
        <ApiErrorToasts />
        <div className="app">
          {!me.access.active && (
            <NavLink to="/settings" className="banner bad" style={{ display: 'block' }}>
              Подписка закончилась. Сметы и финансы доступны для просмотра, изменения — после продления. Открыть тарифы
            </NavLink>
          )}
          <Boundary>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/estimates" element={<Estimates />} />
              <Route path="/estimates/:id" element={<EstimateEditor />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/calculators" element={<Calculators />} />
              <Route path="/calculators/:id" element={<CalculatorPage />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectPage />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/more" element={<More />} />
              <Route path="*" element={<State title="Страница не найдена" />} />
            </Routes>
          </Boundary>
        </div>
        <TabBar />
      </BrowserRouter>
    </MeCtx.Provider>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initTelegram();
    (async () => {
      try {
        const params = new URLSearchParams(location.search);
        let r: any;
        if (inTelegram) r = await post('/auth/telegram', { initData: tg.initData });
        else if (params.get('dev')) r = await post('/auth/dev', { tgId: Number(params.get('dev')), name: 'Разработчик' });
        else { setError('Откройте СМЕТА PRO через Telegram-бота.'); return; }
        setToken(r.token);
        setMe(r.user);
      } catch (e: any) {
        setError(e.message || 'Не удалось войти');
      }
    })();
  }, []);

  return (
    <ToastProvider>
      {error ? (
        <div className="app"><div className="logo"><img src="/icon.svg" alt="" /><div><b>СМЕТА PRO</b><span>Считай точно. Работай прибыльно.</span></div></div><State title="Вход не выполнен" text={error} /></div>
      ) : me ? <Shell me={me} setMe={setMe} /> : <div className="spinner" aria-label="Загрузка" />}
    </ToastProvider>
  );
}
