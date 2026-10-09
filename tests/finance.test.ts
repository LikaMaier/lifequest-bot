import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcProjectFinance } from '../shared/finance';

const base = {
  contractAmount: 500000,
  completionPct: 50,
  plannedBudget: { materials: 200000, labor: 100000, equipment: 30000 },
  ops: [
    { kind: 'income', incomeType: 'advance', amount: 150000 },
    { kind: 'income', incomeType: 'interim', amount: 100000 },
    { kind: 'income', incomeType: 'extra_work', amount: 40000 }, // меняет договор, не деньги
    { kind: 'expense', category: 'materials', amount: 235000, paidAmount: 200000 },
    { kind: 'expense', category: 'labor', amount: 60000, paidAmount: 60000 },
    { kind: 'expense', category: 'equipment', amount: 10000, paidAmount: 0 },
  ],
};

test('договор, поступления, долг заказчика', () => {
  const f = calcProjectFinance(base);
  assert.equal(f.contractTotal, 540000);
  assert.equal(f.received, 250000);
  assert.equal(f.customerDebt, 290000);
});

test('начисленные и оплаченные расходы не смешиваются', () => {
  const f = calcProjectFinance(base);
  assert.equal(f.expensesAccrued, 305000);
  assert.equal(f.expensesPaid, 260000);
  assert.equal(f.unpaidObligations, 45000);
  assert.equal(f.cashBalance, 250000 - 260000);
});

test('план-факт: перерасход по материалам 35 000', () => {
  const f = calcProjectFinance(base);
  const m = f.planFact.find((r) => r.group === 'materials')!;
  assert.equal(m.deviation, 35000);
  assert.equal(m.remainingForecast, 0);
});

test('прибыль: плановая, текущая, прогнозная', () => {
  const f = calcProjectFinance(base);
  assert.equal(f.plannedCost, 330000);
  assert.equal(f.plannedProfit, 540000 - 330000);
  assert.equal(f.earnedRevenue, 270000);
  assert.equal(f.currentProfit, 270000 - 305000);
  // осталось: труд 40000 + техника 20000
  assert.equal(f.remainingForecast, 60000);
  assert.equal(f.forecastProfit, 540000 - (305000 + 60000));
  // отклонение от бюджета: (305000 + 60000) − 330000
  assert.equal(f.budgetDeviation, 35000);
});

test('нулевая выручка — маржа null', () => {
  const f = calcProjectFinance({ contractAmount: 0, completionPct: 0, plannedBudget: {}, ops: [] });
  assert.equal(f.plannedMarginPct, null);
  assert.equal(f.forecastMarginPct, null);
});

test('уменьшение договора отрицательным изменением', () => {
  const f = calcProjectFinance({ contractAmount: 100000, completionPct: 0, plannedBudget: {}, ops: [{ kind: 'income', incomeType: 'contract_change', amount: -20000 }] });
  assert.equal(f.contractTotal, 80000);
});

test('переплата заказчика не даёт отрицательный долг', () => {
  const f = calcProjectFinance({ contractAmount: 100, completionPct: 100, plannedBudget: {}, ops: [{ kind: 'income', incomeType: 'final', amount: 150 }] });
  assert.equal(f.customerDebt, 0);
  assert.equal(f.overpaid, 50);
});
