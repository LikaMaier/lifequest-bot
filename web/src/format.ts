const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Рубли: целые без копеек, дробные — всегда 2 знака (75 676,80 ₽) */
export const rub = (v: number | null | undefined) => (v == null ? '—' : `${Number.isInteger(Math.round(v * 100) / 100) ? nf0.format(v) : nf2.format(v)} ₽`);
/** Округлённо до рубля — для сводок */
export const rub0 = (v: number | null | undefined) => (v == null ? '—' : `${nf0.format(Math.round(v))} ₽`);
export const n = (v: number | null | undefined, digits = 2) => (v == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v));
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${nf.format(v)}%`);
export const date = (s?: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—');
export const dateInput = (s?: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : '');
export const parseNum = (s: any): number => {
  const v = Number(String(s ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

export const TYPE_LABEL: Record<string, string> = { work: 'Работа', material: 'Материал', equipment: 'Техника', service: 'Услуга', other: 'Прочее' };
export const EST_STATUS: Record<string, string> = { draft: 'Черновик', sent: 'Отправлена', approved: 'Согласована', rejected: 'Отклонена', archived: 'Архив' };
export const PROJ_STATUS: Record<string, string> = {
  draft: 'Черновик', estimated: 'Смета подготовлена', negotiation: 'Согласование', in_progress: 'В работе', paused: 'Приостановлен', done: 'Завершён', archived: 'Архив',
};
export const EXP_GROUP: Record<string, string> = { materials: 'Материалы', equipment: 'Техника', labor: 'Рабочие и подрядчики', other: 'Прочие расходы' };
export const INCOME_TYPE: Record<string, string> = { advance: 'Аванс', interim: 'Промежуточный платёж', final: 'Окончательный платёж', extra_work: 'Доп. работы (к договору)', contract_change: 'Изменение стоимости договора' };
export const groupLabel = (g: string) => EXP_GROUP[g] || g;
export const UNITS = ['м²', 'м³', 'пог. м', 'м', 'шт', 'кг', 'т', 'л', 'уп', 'рулон', 'смена', 'час', 'рейс', 'компл', 'усл'];
