import { toKop, fromKop, pctOfKop } from './money';

/**
 * Расчёт итогов сметы. Порядок применения (един для всего приложения):
 *  1. Сумма строки            = кол-во × цена (округление до копеек)
 *  2. Подытог                 = Σ сумм строк
 *  3. Резерв на потери        = подытог материалов × резерв%
 *  4. Наценка                 = (подытог + резерв) × наценка%
 *  5. Скидка                  = (подытог + резерв + наценка) × скидка%
 *  6. Доставка, доп. расходы  — фиксированные суммы
 *  7. База налога             = подытог + резерв + наценка − скидка + доставка + доп. расходы
 *  8. Налог                   = база × налог%  (начисляется сверху)
 *  9. Итого заказчику         = база + налог
 * Себестоимость (прямые затраты) = Σ кол-во × закупочная цена.
 * Плановая прибыль = (итого − налог) − себестоимость. Маржа = прибыль / (итого − налог), если выручка > 0.
 */
export type LineType = 'work' | 'material' | 'equipment' | 'service' | 'other';

export interface LineInput {
  qty: number;
  price: number;
  costPrice?: number | null;
  type?: LineType | string;
  category?: string | null;
}

export interface EstimateParams {
  discountPct?: number;
  markupPct?: number;
  taxPct?: number;
  lossReservePct?: number;
  delivery?: number;
  extraCosts?: number;
}

export interface EstimateTotals {
  lineAmounts: number[];
  subtotal: number;
  worksSubtotal: number;
  materialsSubtotal: number;
  otherSubtotal: number;
  reserve: number;
  markup: number;
  discount: number;
  delivery: number;
  extraCosts: number;
  taxBase: number;
  tax: number;
  total: number;
  revenueExTax: number;
  directCost: number;
  linesWithoutCost: number;
  plannedProfit: number;
  marginPct: number | null;
  byCategory: { category: string; amount: number }[];
  costByGroup: { materials: number; equipment: number; labor: number; other: number };
}

export function validateLine(l: LineInput): string | null {
  if (!Number.isFinite(Number(l.qty)) || Number(l.qty) < 0) return 'Количество не может быть отрицательным';
  if (!Number.isFinite(Number(l.price)) || Number(l.price) < 0) return 'Цена не может быть отрицательной';
  if (l.costPrice != null && (!Number.isFinite(Number(l.costPrice)) || Number(l.costPrice) < 0))
    return 'Закупочная цена не может быть отрицательной';
  return null;
}

export function lineAmountKop(qty: number, price: number): number {
  // qty до 4 знаков, price до 2 — считаем в копейках и округляем один раз
  return Math.round(Number(qty) * toKop(price));
}

/** Группа фактических расходов, к которой относится тип строки сметы */
export function costGroupOf(type?: string): 'materials' | 'equipment' | 'labor' | 'other' {
  if (type === 'material') return 'materials';
  if (type === 'equipment') return 'equipment';
  if (type === 'work') return 'labor';
  return 'other';
}

export function calcEstimate(lines: LineInput[], p: EstimateParams = {}): EstimateTotals {
  const amountsKop = lines.map((l) => lineAmountKop(l.qty, l.price));
  const subtotalKop = amountsKop.reduce((a, b) => a + b, 0);
  let worksKop = 0, materialsKop = 0, otherKop = 0;
  const catMap = new Map<string, number>();
  const costGroups = { materials: 0, equipment: 0, labor: 0, other: 0 };
  let directCostKop = 0;
  let withoutCost = 0;

  lines.forEach((l, i) => {
    const a = amountsKop[i];
    if (l.type === 'material') materialsKop += a;
    else if (l.type === 'work') worksKop += a;
    else otherKop += a;
    const cat = l.category || 'Без категории';
    catMap.set(cat, (catMap.get(cat) || 0) + a);
    if (l.costPrice != null && l.costPrice !== ('' as any)) {
      const c = lineAmountKop(l.qty, Number(l.costPrice));
      directCostKop += c;
      costGroups[costGroupOf(l.type as string)] += c;
    } else if (Number(l.qty) > 0) {
      withoutCost++;
    }
  });

  const reserveKop = pctOfKop(materialsKop, p.lossReservePct || 0);
  const markupKop = pctOfKop(subtotalKop + reserveKop, p.markupPct || 0);
  const discountKop = pctOfKop(subtotalKop + reserveKop + markupKop, p.discountPct || 0);
  const deliveryKop = toKop(p.delivery || 0);
  const extraKop = toKop(p.extraCosts || 0);
  const taxBaseKop = subtotalKop + reserveKop + markupKop - discountKop + deliveryKop + extraKop;
  const taxKop = pctOfKop(taxBaseKop, p.taxPct || 0);
  const totalKop = taxBaseKop + taxKop;
  const revenueExTaxKop = totalKop - taxKop;
  const profitKop = revenueExTaxKop - directCostKop;

  return {
    lineAmounts: amountsKop.map(fromKop),
    subtotal: fromKop(subtotalKop),
    worksSubtotal: fromKop(worksKop),
    materialsSubtotal: fromKop(materialsKop),
    otherSubtotal: fromKop(otherKop),
    reserve: fromKop(reserveKop),
    markup: fromKop(markupKop),
    discount: fromKop(discountKop),
    delivery: fromKop(deliveryKop),
    extraCosts: fromKop(extraKop),
    taxBase: fromKop(taxBaseKop),
    tax: fromKop(taxKop),
    total: fromKop(totalKop),
    revenueExTax: fromKop(revenueExTaxKop),
    directCost: fromKop(directCostKop),
    linesWithoutCost: withoutCost,
    plannedProfit: fromKop(profitKop),
    marginPct: revenueExTaxKop > 0 ? Math.round((profitKop / revenueExTaxKop) * 10000) / 100 : null,
    byCategory: [...catMap.entries()].map(([category, a]) => ({ category, amount: fromKop(a) })),
    costByGroup: {
      materials: fromKop(costGroups.materials),
      equipment: fromKop(costGroups.equipment),
      labor: fromKop(costGroups.labor),
      other: fromKop(costGroups.other),
    },
  };
}
