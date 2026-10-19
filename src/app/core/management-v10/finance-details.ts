import { minor } from './finance-amounts';
import { isValidISODate } from '../rules';
import type { DemoState } from '../models';
import type { V10FinanceDetails } from '../v10-contracts';
import { selectBudgetComparison } from '../budget-comparison';

/** 只消费已提交集合；查询不能回退默认演示来源。 */
export function selectFinanceDetails(
  state: Readonly<DemoState>,
  projectId: string,
): V10FinanceDetails {
  const matches = state.projects.filter((p) => p.id === projectId);
  if (matches.length !== 1)
    return {
      budget: [],
      snapshot: null,
      finalCosts: [],
      sourceHref: null,
      issues: ['项目来源缺失或身份冲突'],
    };
  const project = matches[0];
  const planIds = new Map<string, (typeof project.plans)[number]>();
  let invalidPlans = false;
  for (const plan of project.plans.filter((p) => p.type === '内部WBS')) {
    const first = planIds.get(plan.id);
    if (
      !plan.id?.trim() ||
      (first &&
        ['budgetAmount', 'budgetCurrency', 'status', 'type'].some(
          (k) => first[k as keyof typeof first] !== plan[k as keyof typeof plan],
        ))
    )
      invalidPlans = true;
    else planIds.set(plan.id, plan);
  }
  const expenses = state.budgetDemoExpenses ?? [];
  const seen = new Map<string, (typeof expenses)[number]>();
  const aliases = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const expense of expenses) {
    if (expense.projectId !== projectId) continue;
    const key = JSON.stringify([expense.projectId, expense.batchId, expense.sourceRecordId]);
    const first = seen.get(key);
    if (!first) seen.set(key, expense);
    else {
      aliases.set(expense.expenseId, first.expenseId);
      if (
        ['planId', 'currency', 'amountMinor', 'scope', 'date', 'cutoff', 'origin'].some(
          (k) => first[k as keyof typeof first] !== expense[k as keyof typeof expense],
        )
      ) {
        conflicts.add(expense.currency);
        conflicts.add(first.currency);
      }
    }
  }
  const sources = (state.budgetComparisonSources ?? []).map((s) => ({
    ...s,
    expenseIds: s.expenseIds.map((id) => aliases.get(id) ?? id),
  }));
  const budget = selectBudgetComparison(
    { ...state, budgetDemoExpenses: [...seen.values()], budgetComparisonSources: sources },
    projectId,
  );
  return {
    ...selectSnapshotDetails(state, projectId),
    budget: budget.map((b) =>
      invalidPlans || conflicts.has(b.currency)
        ? {
            ...b,
            budgetMinor: invalidPlans ? null : b.budgetMinor,
            expenseMinor: null,
            comparable: false,
            reason: invalidPlans ? '预算计划ID缺失或冲突，待核' : '同来源模拟支出冲突，待核',
            executionPercent: null,
            varianceMinor: null,
            overspendMinor: null,
            budgetStatus: '不可比较',
          }
        : b,
    ),
  };
}

function selectSnapshotDetails(
  state: Readonly<DemoState>,
  projectId: string,
): Omit<V10FinanceDetails, 'budget'> {
  const issues: string[] = [];
  const snapshots = (state.financeSnapshots ?? []).filter((s) => s.projectId === projectId);
  if (snapshots.length !== 1)
    issues.push(snapshots.length ? '项目财务快照重复，待核' : '项目财务快照未提供');
  const snapshot = snapshots.length === 1 ? snapshots[0] : null;
  function amount(value: number, currency: string, cutoff: string, scope: string) {
    const amountMinor = minor(value);
    const issues: string[] = [];
    if (amountMinor === null || amountMinor < 0) issues.push('金额缺失、非法或溢出');
    if (!['CNY', 'EUR', 'USD'].includes(currency)) issues.push('币种待核');
    if (!isValidISODate(cutoff) || !scope?.trim()) issues.push('日期或范围待核');
    return { amountMinor: issues.length ? null : amountMinor, issues };
  }
  const costs = (state.finalActualCosts ?? [])
    .filter((c) => c.projectId === projectId)
    .slice()
    .sort((a, b) => b.revision - a.revision);
  const maxRevision = costs[0]?.revision;
  const finalCosts = costs.map((c) => {
    const converted = amount(c.amount, c.currency, c.cutoff, c.scope);
    const issues = [...converted.issues];
    if (
      !c.id?.trim() ||
      !Number.isSafeInteger(c.revision) ||
      c.revision < 1 ||
      costs.filter((r) => r.revision === c.revision || r.id === c.id).length !== 1
    )
      issues.push('最终成本身份或修订冲突');
    if (!isValidISODate(c.confirmedDate)) issues.push('最终成本确认日期待核');
    if (!state.attachments.some((a) => a.id === c.documentId && a.entityId === projectId))
      issues.push('最终成本资料来源缺失');
    return {
      ...structuredClone(c),
      amountMinor: issues.length ? null : converted.amountMinor,
      current: c.revision === maxRevision && !issues.length,
      issues,
    };
  });
  const cumulative = snapshot?.cumulativeActualCost;
  const sales = snapshot?.indicators;
  return {
    issues,
    sourceHref: `/projects/${encodeURIComponent(projectId)}?tab=finance`,
    snapshot: snapshot
      ? {
          scope: snapshot.scope,
          refreshedAt: snapshot.refreshedAt,
          expenses: snapshot.expenses.map((e) => ({
            ...structuredClone(e),
            ...amount(e.amount, e.currency, e.date, snapshot.scope),
          })),
          cumulativeCost: cumulative
            ? {
                ...structuredClone(cumulative),
                ...amount(
                  cumulative.amount,
                  cumulative.currency,
                  cumulative.cutoff,
                  cumulative.scope,
                ),
                ...(cumulative.projectId !== projectId
                  ? { amountMinor: null, issues: ['累计成本项目归属待核'] }
                  : {}),
              }
            : null,
          sales: sales
            ? {
                ...structuredClone(sales),
                salesMinor: amount(
                  sales.salesAmount,
                  sales.currency,
                  sales.snapshotDate,
                  snapshot.scope,
                ).amountMinor,
                label: '销售额（不是已确认收入）',
                issues: amount(
                  sales.salesAmount,
                  sales.currency,
                  sales.snapshotDate,
                  snapshot.scope,
                ).issues,
              }
            : null,
          legacyInvoices: structuredClone(
            snapshot.invoices.filter(
              (i) => !(state.contractInvoices ?? []).some((c) => c.id === i.id),
            ),
          ),
        }
      : null,
    finalCosts,
  };
}
