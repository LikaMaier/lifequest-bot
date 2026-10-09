import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcEstimate, validateLine, lineAmountKop } from '../shared/estimate';

test('сумма строки = количество × цена', () => {
  const t = calcEstimate([{ qty: 12.5, price: 650, type: 'work' }]);
  assert.equal(t.lineAmounts[0], 8125);
  assert.equal(t.total, 8125);
});

test('нет ошибок float: 0.1 × 3 и копейки', () => {
  assert.equal(lineAmountKop(3, 0.1), 30);
  const t = calcEstimate([{ qty: 3, price: 0.1 }, { qty: 1, price: 0.2 }]);
  assert.equal(t.subtotal, 0.5);
});

test('итог совпадает с суммой компонентов', () => {
  const lines = [
    { qty: 24, price: 450, type: 'work', costPrice: 250 },
    { qty: 3.6, price: 6500, type: 'material', costPrice: 5800 },
    { qty: 1, price: 15000, type: 'equipment', costPrice: 12000 },
  ];
  const p = { lossReservePct: 5, markupPct: 10, discountPct: 3, taxPct: 6, delivery: 3000, extraCosts: 1500 };
  const t = calcEstimate(lines, p);
  // подытог: 10800 + 23400 + 15000 = 49200
  assert.equal(t.subtotal, 49200);
  assert.equal(t.materialsSubtotal, 23400);
  assert.equal(t.reserve, 1170); // 5% от материалов
  assert.equal(t.markup, 5037); // 10% от 50370
  assert.equal(t.discount, 1662.21); // 3% от 55407
  assert.equal(t.taxBase, 49200 + 1170 + 5037 - 1662.21 + 3000 + 1500);
  assert.equal(t.tax, Math.round(t.taxBase * 6) / 100);
  assert.equal(t.total, Math.round((t.taxBase + t.tax) * 100) / 100);
  // себестоимость: 24×250 + 3.6×5800 + 12000 = 6000 + 20880 + 12000
  assert.equal(t.directCost, 38880);
  assert.equal(t.plannedProfit, Math.round((t.total - t.tax - 38880) * 100) / 100);
  assert.deepEqual(t.costByGroup, { labor: 6000, materials: 20880, equipment: 12000, other: 0 });
});

test('пустая смета: маржа null, без деления на ноль', () => {
  const t = calcEstimate([]);
  assert.equal(t.total, 0);
  assert.equal(t.marginPct, null);
});

test('строки без закупочной цены считаются', () => {
  const t = calcEstimate([{ qty: 2, price: 100 }, { qty: 1, price: 50, costPrice: 30 }]);
  assert.equal(t.linesWithoutCost, 1);
  assert.equal(t.directCost, 30);
});

test('валидация отрицательных значений', () => {
  assert.ok(validateLine({ qty: -1, price: 10 }));
  assert.ok(validateLine({ qty: 1, price: -10 }));
  assert.equal(validateLine({ qty: 0, price: 0 }), null);
});
