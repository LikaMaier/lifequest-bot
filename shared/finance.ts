import { toKop, fromKop } from './money';

/**
 * Финансы объекта. Понятия не смешиваются:
 *  - Сумма договора (итоговая) = базовая сумма договора + Σ доп. работ и изменений стоимости
 *  - Получено от заказчика      = Σ поступлений (аванс, промежуточные, окончательный платёж)
 *  - Долг заказчика             = сумма договора − получено (не меньше 0)
 *  - Начисленные расходы        = Σ amount по расходам
 *  - Оплаченные расходы         = Σ paidAmount по расходам
 *  - Неоплаченные обязательства = начислено − оплачено
 *  - Плановая себестоимость     = Σ плановых бюджетов по группам (из сметы или вручную)
 *  - Плановая прибыль           = сумма договора − плановая себестоимость
 *  - Начисленный доход          = сумма договора × % выполнения
 *  - Прибыль на текущий момент  = начисленный доход − начисленные расходы
 *  - Прогноз оставшихся затрат  = Σ по группам max(план − факт, 0)
 *  - Прогноз итоговой прибыли   = сумма договора − (факт расходов + прогноз оставшихся затрат)
 *  - Денежный остаток           = получено − оплаченные расходы
 *  - Маржа = прибыль / доход × 100%, только если доход > 0 (иначе null)
 */
export const PAYMENT_TYPES = ['advance', 'interim', 'final'] as const;
export const CONTRACT_CHANGE_TYPES = ['extra_work', 'contract_change'] as const;
export const EXPENSE_GROUPS = ['materials', 'equipment', 'labor', 'other'] as const;

export interface FinanceOpInput {
  kind: 'income' | 'expense' | string;
  incomeType?: string | null;
  category?: string | null;
  amount: number;
  paidAmount?: number;
}

export interface ProjectFinanceInput {
  contractAmount: number;
  completionPct: number;
  plannedBudget: Record<string, number>; // группа -> план
  ops: FinanceOpInput[];
}

export interface PlanFactRow {
  group: string;
  planned: number;
  actual: number;
  paid: number;
  deviation: number; // факт − план (положительное = перерасход)
  remainingForecast: number;
}

export interface ProjectFinance {
  contractBase: number;
  contractChanges: number;
  contractTotal: number;
  received: number;
  customerDebt: number;
  overpaid: number;
  expensesAccrued: number;
  expensesPaid: number;
  unpaidObligations: number;
  plannedCost: number;
  plannedProfit: number;
  plannedMarginPct: number | null;
  earnedRevenue: number;
  currentProfit: number;
  remainingForecast: number;
  forecastProfit: number;
  forecastMarginPct: number | null;
  cashBalance: number;
  budgetDeviation: number;
  planFact: PlanFactRow[];
}

export function groupOfExpense(category?: string | null): string {
  return category && category.trim() ? category : 'other';
}

const margin = (profitKop: number, revenueKop: number) =>
  revenueKop > 0 ? Math.round((profitKop / revenueKop) * 10000) / 100 : null;

export function calcProjectFinance(input: ProjectFinanceInput): ProjectFinance {
  const contractBaseKop = toKop(input.contractAmount);
  let changesKop = 0, receivedKop = 0, accruedKop = 0, paidKop = 0;
  const actualByGroup = new Map<string, number>();
  const paidByGroup = new Map<string, number>();

  for (const op of input.ops) {
    const a = toKop(op.amount);
    if (op.kind === 'income') {
      if ((CONTRACT_CHANGE_TYPES as readonly string[]).includes(op.incomeType || '')) changesKop += a;
      else receivedKop += a; // любое другое поступление = полученные деньги
    } else if (op.kind === 'expense') {
      const p = toKop(op.paidAmount || 0);
      accruedKop += a;
      paidKop += p;
      const g = groupOfExpense(op.category);
      actualByGroup.set(g, (actualByGroup.get(g) || 0) + a);
      paidByGroup.set(g, (paidByGroup.get(g) || 0) + p);
    }
  }

  const contractTotalKop = contractBaseKop + changesKop;
  const groups = new Set<string>([...EXPENSE_GROUPS, ...Object.keys(input.plannedBudget || {}), ...actualByGroup.keys()]);
  let plannedKop = 0, remainingKop = 0;
  const planFact: PlanFactRow[] = [];
  for (const g of groups) {
    const pl = toKop(input.plannedBudget?.[g] || 0);
    const ac = actualByGroup.get(g) || 0;
    const rem = Math.max(pl - ac, 0);
    plannedKop += pl;
    remainingKop += rem;
    if (pl || ac) {
      planFact.push({
        group: g,
        planned: fromKop(pl),
        actual: fromKop(ac),
        paid: fromKop(paidByGroup.get(g) || 0),
        deviation: fromKop(ac - pl),
        remainingForecast: fromKop(rem),
      });
    }
  }

  const pct = Math.min(Math.max(Number(input.completionPct) || 0, 0), 100);
  const earnedKop = Math.round((contractTotalKop * pct) / 100);
  const plannedProfitKop = contractTotalKop - plannedKop;
  const forecastProfitKop = contractTotalKop - (accruedKop + remainingKop);

  return {
    contractBase: fromKop(contractBaseKop),
    contractChanges: fromKop(changesKop),
    contractTotal: fromKop(contractTotalKop),
    received: fromKop(receivedKop),
    customerDebt: fromKop(Math.max(contractTotalKop - receivedKop, 0)),
    overpaid: fromKop(Math.max(receivedKop - contractTotalKop, 0)),
    expensesAccrued: fromKop(accruedKop),
    expensesPaid: fromKop(paidKop),
    unpaidObligations: fromKop(accruedKop - paidKop),
    plannedCost: fromKop(plannedKop),
    plannedProfit: fromKop(plannedProfitKop),
    plannedMarginPct: margin(plannedProfitKop, contractTotalKop),
    earnedRevenue: fromKop(earnedKop),
    currentProfit: fromKop(earnedKop - accruedKop),
    remainingForecast: fromKop(remainingKop),
    forecastProfit: fromKop(forecastProfitKop),
    forecastMarginPct: margin(forecastProfitKop, contractTotalKop),
    cashBalance: fromKop(receivedKop - paidKop),
    budgetDeviation: fromKop(accruedKop + remainingKop - plannedKop),
    planFact,
  };
}
