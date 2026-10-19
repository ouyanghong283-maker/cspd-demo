import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';

test('报价金额按逐行两位舍入、币种留在版本内且含税待确认不会伪造总额', () => {
  const { store } = harness();
  const seed = store.quoteSeries('DEMO-O014')!.versions[0];
  const quote = structuredClone(seed);
  quote.currency = 'EUR';
  quote.taxMode = '含税样例';
  quote.vatAmount = 0.21;
  quote.freightTreatment = '另收';
  quote.freightAmount = 0.105;
  quote.dutyTreatment = '已含在明细';
  quote.otherFeeTreatment = '已含在明细';
  quote.discount = 0;
  quote.items = [
    { ...quote.items[0], id: 'round-1', quantity: 1, unitPrice: 1.005, discountPercent: 0 },
    { ...quote.items[0], id: 'round-2', quantity: 1, unitPrice: 1.005, discountPercent: 0 },
  ];
  const totals = store.quoteTotals(quote);
  assert.equal(totals.lines, 2.02, '每行先舍入再合计');
  assert.equal(totals.added, 0.11);
  assert.equal(totals.net, 2.13);
  assert.equal(totals.total, 2.34);
  assert.equal(quote.currency, 'EUR', '计算不把版本币种转换或混加');
  quote.taxMode = '含税待确认';
  assert.equal(store.quoteTotals(quote).total, null);
});
