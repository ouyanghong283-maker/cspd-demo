import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { initializeBudgetDemoSources } from '../src/app/core/budget-demo-expenses';
import { selectBudgetComparison } from '../src/app/core/budget-comparison';
test('固定费用原子保存、重复初始化不重复，真实WBS变更立即投影且分币种', () => {
  const { store, role } = harness();
  role('pm');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const c = { workspaceId: 'W', roundId: 'R', operationId: 'B1' };
  assert.equal(initializeBudgetDemoSources(store, c).status, 'committed');
  const count = store.state().budgetDemoExpenses!.length;
  assert.equal(initializeBudgetDemoSources(store, c).status, 'unchanged');
  assert.equal(store.state().budgetDemoExpenses!.length, count);
  const p = store.project('DEMO-P001')!;
  p.plans = p.plans
    .filter((p) => p.type === '内部WBS')
    .map((p) => ({ ...p, budgetAmount: 0, budgetCurrency: 'CNY' }));
  const rows = selectBudgetComparison(store.state(), p.id);
  assert.equal(rows.find((v) => v.currency === 'CNY')?.executionPercent, null);
  assert.deepEqual(rows.map((v) => v.currency).sort(), ['CNY', 'EUR', 'USD']);
  assert.equal(store.state().budgetDemoExpenses!.length, count);
});
test('只读和快照失败不发布固定费用', () => {
  const { store, role } = harness();
  role('pm');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const c = { workspaceId: 'W', roundId: 'R', operationId: 'B1' };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem() {
        throw Error('QuotaExceededError');
      },
    },
  });
  assert.equal(initializeBudgetDemoSources(store, c).status, 'failed');
  assert.equal(store.state().budgetDemoExpenses, undefined);
});
