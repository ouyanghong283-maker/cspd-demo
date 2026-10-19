import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { selectBudgetIntegrity } from '../src/app/core/budget-comparison';
test('预算保留零与完成项，去重并说明取消、未知与异常金额', () => {
  const { store } = harness();
  const p = structuredClone(store.state().projects[0]);
  const base = p.plans.find((x) => x.type === '内部WBS')!;
  p.plans = [
    { ...base, id: 'zero', budgetAmount: 0, budgetCurrency: 'CNY' },
    { ...base, id: 'done', status: '已完成', budgetAmount: 12.34, budgetCurrency: 'CNY' },
    { ...base, id: 'done', budgetAmount: 99, budgetCurrency: 'CNY' },
    { ...base, id: 'cancel', status: '已取消', budgetAmount: 20, budgetCurrency: 'CNY' },
    { ...base, id: 'unknown', budgetAmount: undefined, budgetCurrency: 'CNY', amount: 999 },
    { ...base, id: 'unsafe', budgetAmount: Number.MAX_SAFE_INTEGER, budgetCurrency: 'CNY' },
  ];
  const view = selectBudgetIntegrity(p.id, p.plans);
  assert.equal(view.totals[0]?.amountMinor, 1234);
  assert.equal(view.complete, false);
  assert.deepEqual(view.missingPlanIds, ['unknown', 'unsafe']);
  assert.equal(view.rows.find((x) => x.planId === 'cancel')?.excluded, true);
});
import { selectBudgetComparison } from '../src/app/core/budget-comparison';
test('唯一模拟来源按费用ID和截止日读取，旧累计财务不叠加；来源不明禁比较', () => {
  const { store } = harness();
  const state = store.state();
  const p = state.projects[0];
  const base = p.plans.find((x) => x.type === '内部WBS')!;
  p.plans = [{ ...base, id: 'PLAN', budgetAmount: 100, budgetCurrency: 'CNY' }];
  state.budgetDemoExpenses = [
    {
      expenseId: 'E1',
      projectId: p.id,
      planId: 'PLAN',
      scope: '全项目',
      amountMinor: 3000,
      currency: 'CNY',
      date: '2026-10-10',
      summary: '模拟支出',
      sourceRecordId: 'SOURCE',
      batchId: 'B1',
      cutoff: '2026-10-17',
      origin: 'simulated',
    },
    {
      expenseId: 'E2',
      projectId: p.id,
      planId: 'PLAN',
      scope: '全项目',
      amountMinor: 99000,
      currency: 'CNY',
      date: '2026-10-18',
      summary: '期后',
      sourceRecordId: 'SOURCE2',
      batchId: 'B1',
      cutoff: '2026-10-17',
      origin: 'simulated',
    },
  ];
  state.budgetComparisonSources = [
    {
      projectId: p.id,
      currency: 'CNY',
      expenseIds: ['E1', 'E1', 'E2'],
      scope: '全项目',
      cutoff: '2026-10-17',
      complete: true,
    },
  ];
  const view = selectBudgetComparison(state, p.id)[0]!;
  assert.equal(view.expenseMinor, 3000);
  assert.equal(view.comparable, true);
  assert.equal(view.executionPercent, 30);
  state.budgetComparisonSources.push({ ...state.budgetComparisonSources[0]! });
  assert.equal(selectBudgetComparison(state, p.id)[0]?.comparable, false);
});
test('无效截止日不能形成可比较费用来源', () => {
  const { store } = harness();
  const state = store.state();
  const p = state.projects[0];
  p.plans = p.plans
    .filter((x) => x.type === '内部WBS')
    .map((x) => ({ ...x, budgetAmount: 0, budgetCurrency: 'CNY' }));
  state.budgetComparisonSources = [
    {
      projectId: p.id,
      currency: 'CNY',
      expenseIds: [],
      scope: '全项目',
      cutoff: 'bad-date',
      complete: true,
    },
  ];
  assert.equal(selectBudgetComparison(state, p.id)[0]?.comparable, false);
});
test('默认固定模拟来源可读且不补种；缺预算不因正常/接近/超支样例而变为完整', () => {
  const { store } = harness();
  const state = store.state();
  const before = JSON.stringify(state);
  const missing = selectBudgetComparison(state, 'DEMO-P004');
  assert.ok(missing.length);
  assert.equal(missing[0]?.comparable, false);
  assert.ok(missing[0]?.expenses.length);
  const normal = selectBudgetComparison(state, 'DEMO-P001');
  assert.deepEqual(
    normal.map((v) => v.currency),
    ['CNY', 'EUR', 'USD'],
  );
  assert.equal(normal.find((v) => v.currency === 'CNY')?.expenseMinor, 110000000);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.budgetDemoExpenses, undefined);
  // 只在测试场景明确补齐未知预算后核对三种费用水平；不修改演示种子。
  for (const p of state.projects.slice(0, 3)) {
    const missing = p.plans.find((x) => x.type === '内部WBS' && x.budgetAmount === undefined)!;
    missing.budgetAmount = 0;
    missing.budgetCurrency = 'CNY';
  }
  assert.equal(
    selectBudgetComparison(state, 'DEMO-P001').find((v) => v.currency === 'CNY')?.executionPercent,
    50,
  );
  assert.equal(
    selectBudgetComparison(state, 'DEMO-P002').find((v) => v.currency === 'CNY')?.executionPercent,
    95,
  );
  assert.equal(
    selectBudgetComparison(state, 'DEMO-P003').find((v) => v.currency === 'CNY')?.executionPercent,
    110,
  );
});
