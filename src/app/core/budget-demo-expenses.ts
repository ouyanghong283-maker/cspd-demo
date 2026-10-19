import type { BudgetComparisonSource, BudgetCurrency, BudgetDemoExpense } from './v9-contracts';
/** CODEX固定样例，不写全局快照；预算缺项仍由预算查询阻止比较。 */
const cases: readonly [string, string, BudgetCurrency, number, string][] = [
  ['DEMO-P001', 'DEMO-P001-W3', 'CNY', 110000000, '正常费用样例'],
  ['DEMO-P001', 'DEMO-P001-W6', 'USD', 3100000, '多币种独立费用样例'],
  ['DEMO-P001', 'DEMO-P001-W7', 'EUR', 2400000, '多币种独立费用样例'],
  ['DEMO-P002', 'DEMO-P002-W3', 'CNY', 209000000, '接近预算费用样例'],
  ['DEMO-P003', 'DEMO-P003-W3', 'CNY', 242000000, '超预算费用样例'],
  ['DEMO-P004', 'DEMO-P004-W3', 'CNY', 10000000, '预算待补费用样例'],
  ['DEMO-P005', 'DEMO-P005-W3', 'CNY', 0, '零金额费用样例'],
  ['DEMO-P006', 'DEMO-P006-W3', 'CNY', 50000000, '重复登记费用样例（同一来源第一次登记）'],
  ['DEMO-P006', 'DEMO-P006-W3', 'CNY', 50000000, '重复登记费用样例（同一来源第二次登记）'],
];
export function selectDefaultBudgetDemoData(): {
  expenses: BudgetDemoExpense[];
  sources: BudgetComparisonSource[];
} {
  const expenses = cases.map(
    ([projectId, planId, currency, amountMinor, summary], i): BudgetDemoExpense => ({
      expenseId: `V9-EXP-${i + 1}`,
      projectId,
      planId,
      currency,
      amountMinor,
      scope: '全项目',
      date: '2026-10-15',
      summary,
      sourceRecordId: `V9预置模拟:${projectId}:${currency}`,
      batchId: 'V9-DEMO-20261017',
      cutoff: '2026-10-17',
      origin: 'simulated',
    }),
  );
  // K02 样例数据（11-01/11-02）：零金额为显式 0，与预算未知（待补）分开，由预算查询判定；
  // 重复登记两行共用同一 sourceRecordId、合并为一个来源，用于验证不重复叠加（判定归 CODEX）。
  const bySource = new Map<string, BudgetComparisonSource & { expenseIds: string[] }>();
  for (const e of expenses) {
    const key = `${e.projectId}|${e.currency}|${e.sourceRecordId}`;
    const existing = bySource.get(key);
    if (existing) existing.expenseIds.push(e.expenseId);
    else
      bySource.set(key, {
        projectId: e.projectId,
        currency: e.currency,
        expenseIds: [e.expenseId],
        scope: '全项目',
        cutoff: e.cutoff,
        complete: true,
      });
  }
  const sources = [...bySource.values()];
  return { expenses, sources };
}

/** 显式一次性启用固定模拟来源；只读查询不补种，后续刷新消费已提交集合。 */
export function initializeBudgetDemoSources(
  store: import('./store').DemoStore,
  context: import('./v9-contracts').V9OperationContext,
): import('./v9-contracts').V9CommandResult {
  const objectId = 'v9-budget-demo-sources';
  const existing =
    store.state().budgetDemoExpenses !== undefined ||
    store.state().budgetComparisonSources !== undefined;
  if (
    existing &&
    store.v9CommandTarget()?.workspaceId === context.workspaceId &&
    store.v9CommandTarget()?.roundId === context.roundId &&
    store.v9CanEdit()
  )
    return {
      status: 'unchanged',
      objectId,
      revision: store.state().dataVersion ?? 1,
      value: { batchId: 'V9-DEMO-20261017' },
      message: '已有选定费用来源，未重复预置',
    };
  const defaults = selectDefaultBudgetDemoData();
  return store.commitV9Command(
    {
      ...context,
      command: 'initializeBudgetDemoSources',
      objectId,
      input: { batchId: 'V9-DEMO-20261017' },
    },
    {
      object: { type: 'workspace', id: objectId },
      mainlineId: objectId,
      module: '预算',
      department: 'PM/PMO',
      section: '模拟费用',
      action: '启用固定模拟费用',
      owner: { name: store.person() },
      changes: [
        {
          field: 'budgetDemoExpenses.batchId',
          valueType: 'string',
          before: null,
          after: 'V9-DEMO-20261017',
        },
      ],
      change: (s) => {
        s.budgetDemoExpenses = defaults.expenses;
        s.budgetComparisonSources = defaults.sources;
      },
      value: { batchId: 'V9-DEMO-20261017' },
    },
  );
}
