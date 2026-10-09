// Денежная арифметика в копейках (целые числа), чтобы избежать ошибок float.
export const toKop = (rub: number): number => Math.round((Number(rub) || 0) * 100);
export const fromKop = (kop: number): number => Math.round(kop) / 100;
/** Округление до 2 знаков (рубли с копейками) */
export const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
export const roundTo = (v: number, digits: number): number => {
  const m = 10 ** digits;
  return Math.round((v + Number.EPSILON) * m) / m;
};
/** Процент от суммы в копейках */
export const pctOfKop = (kop: number, pct: number): number => Math.round((kop * (Number(pct) || 0)) / 100);

export const formatRub = (v: number): string =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v) + ' ₽';
