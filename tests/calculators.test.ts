import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALCULATORS, getCalculator, runCalc, parseRects } from '../shared/calculators';

const primary = (id: string, v: Record<string, any>) => {
  const { errors, output } = runCalc(getCalculator(id)!, v);
  assert.deepEqual(errors, {});
  return output!.rows.find((r) => r.primary)!.value;
};

test('площадка 6×4×15 см = 3.6 м³', () => {
  assert.equal(primary('concrete-slab', { a: 6, b: 4, t: 15, reserve: 0 }), 3.6);
  assert.equal(primary('concrete-slab', { a: 6, b: 4, t: 15, reserve: 5 }), 3.78);
});

test('площадь из участков', () => {
  assert.equal(primary('area-multi', { areas: '6x4; 3х2,5' }), 31.5);
  assert.throws(() => parseRects('abc'));
});

test('комната: стены минус проёмы', () => {
  assert.equal(primary('room', { a: 5, b: 4, h: 2.7, open: 3.6 }), 45);
});

test('цилиндр: кольцо Ø1 м × 1 м', () => {
  assert.equal(primary('volume-cyl', { d: 1, h: 1 }), 0.785);
});

test('кирпич в 1 кирпич: ~394 шт/м³ одинарного со швом 10 мм', () => {
  const out = runCalc(getCalculator('brick')!, { len: 1, h: 1, open: 0, thick: '1', brick: 'single', joint: 10, reserve: 0 }).output!;
  const perM3 = 1 / (0.26 * 0.13 * 0.075);
  assert.equal(out.rows[1].value, Math.ceil(0.25 * perM3));
});

test('обои: 18 м по 1.06, высота 2.7, рулон 10.05', () => {
  // полос 17, из рулона 3 → 6 рулонов
  assert.equal(primary('wallpaper', { per: 18, h: 2.7, rw: 1.06, rl: 10.05, rap: 0 }), 6);
});

test('отрицательные размеры отклоняются', () => {
  const { errors } = runCalc(getCalculator('concrete-slab')!, { a: -6, b: 4, t: 15, reserve: 0 });
  assert.ok(errors.a);
});

test('пустой обязательный параметр рецепта', () => {
  const { errors } = runCalc(getCalculator('mix-recipe')!, { v: 1, cement: '', sand: '', gravel: 0, water: 0, bag: 50, reserve: 0 });
  assert.ok(errors.cement && errors.sand);
});

test('все калькуляторы считаются со значениями по умолчанию или выдают валидацию', () => {
  for (const c of CALCULATORS) {
    const defaults: any = {};
    c.fields.forEach((f) => (defaults[f.key] = f.default === '' ? 1 : f.default));
    const { errors, output } = runCalc(c, defaults);
    assert.deepEqual(errors, {}, c.id);
    assert.ok(output!.rows.length > 0, c.id);
    for (const r of output!.rows) assert.ok(Number.isFinite(r.value), `${c.id}: ${r.label}`);
  }
});
