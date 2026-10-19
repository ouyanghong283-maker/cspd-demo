import { selectDefaultBudgetDemoData } from './budget-demo-expenses';
import type { DemoState, Plan } from './models';
import { validateBudget, BUDGET_CURRENCIES } from './budget';
import type { BudgetCurrency, BudgetComparisonView } from './v9-contracts';
const validDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
export function selectBudgetIntegrity(projectId: string, plans: readonly Plan[]) {
  const seen = new Set<string>();
  const rows = plans
    .filter((p) => p.type === '内部WBS')
    .filter((p) => {
      const key = projectId + '::' + p.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => {
      const value = validateBudget(p.budgetAmount, p.budgetCurrency);
      const safe = value.valid && Number.isSafeInteger(value.cents);
      return {
        planId: p.id,
        name: p.name,
        currency: p.budgetCurrency ?? '',
        amountMinor: safe ? value.cents! : null,
        excluded: p.status === '已取消',
        reason:
          p.status === '已取消'
            ? '已取消，不计入当前预算'
            : !safe
              ? value.message || '金额超出安全整数范围'
              : null,
      };
    });
  const missingPlanIds = rows
    .filter((r) => !r.excluded && r.amountMinor === null)
    .map((r) => r.planId);
  const totals = BUDGET_CURRENCIES.map((currency) => {
    let amountMinor = 0;
    for (const row of rows.filter(
      (r) => !r.excluded && r.currency === currency && r.amountMinor !== null,
    )) {
      amountMinor += row.amountMinor!;
    }
    return { currency, amountMinor: Number.isSafeInteger(amountMinor) ? amountMinor : null };
  }).filter((t) =>
    rows.some((r) => !r.excluded && r.currency === t.currency && r.amountMinor !== null),
  );
  return {
    projectId,
    rows,
    totals,
    missingPlanIds,
    complete: missingPlanIds.length === 0 && totals.every((t) => t.amountMinor !== null),
  };
}
/** 只读查询；不读取旧财务累计值，不将不明范围解释为全项目。 */
export function selectBudgetComparison(
  state: Readonly<DemoState>,
  projectId: string,
): BudgetComparisonView[] {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return [];
  const budget = selectBudgetIntegrity(projectId, project.plans);
  const defaults = selectDefaultBudgetDemoData();
  const selectedSources = state.budgetComparisonSources ?? defaults.sources;
  const selectedExpenses = state.budgetDemoExpenses ?? defaults.expenses;
  const currencies = new Set<BudgetCurrency>([
    ...budget.totals.map((t) => t.currency),
    ...selectedSources.filter((s) => s.projectId === projectId).map((s) => s.currency),
  ]);
  return [...currencies].map((currency) => {
    const sources = selectedSources.filter(
      (s) => s.projectId === projectId && s.currency === currency,
    );
    const source = sources.length === 1 ? sources[0] : null;
    let reason = !budget.complete
      ? '已填部分预算，存在待补或异常项'
      : !source
        ? '费用来源缺失或不唯一'
        : !source.complete || !source.scope || !source.cutoff || !validDate(source.cutoff)
          ? '来源范围、截止日或覆盖完整性待核'
          : null;
    let expenseKnown =
      !!source && source.complete && !!source.scope && !!source.cutoff && validDate(source.cutoff);
    const expenses: NonNullable<DemoState['budgetDemoExpenses']> = [];
    const seen = new Set<string>();
    for (const id of source?.expenseIds ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const matches = selectedExpenses.filter((e) => e.expenseId === id);
      const e = matches[0];
      if (
        matches.length !== 1 ||
        !e ||
        e.projectId !== projectId ||
        e.currency !== currency ||
        e.origin !== 'simulated' ||
        !e.batchId ||
        !e.sourceRecordId ||
        !e.scope ||
        e.cutoff !== source?.cutoff ||
        !validDate(e.date) ||
        !Number.isSafeInteger(e.amountMinor) ||
        e.amountMinor < 0 ||
        (!e.planId && !e.scope) ||
        (e.planId && !project.plans.some((p) => p.id === e.planId))
      ) {
        expenseKnown = false;
        reason = '费用来源记录不完整、冲突或项目归属待核';
        continue;
      }
      if (e.date <= source!.cutoff!) expenses.push(structuredClone(e));
    }
    const total = expenses.reduce((n, e) => n + e.amountMinor, 0);
    if (!Number.isSafeInteger(total)) reason = '费用合计超出安全整数范围';
    const budgetMinor = budget.totals.find((t) => t.currency === currency)?.amountMinor ?? null;
    if (budgetMinor === null) reason = reason ?? '该币种预算待补';
    // 本批只支持明示全项目范围；阶段范围需要后续明确预算成员映射。
    if (source?.scope && source.scope !== '全项目') reason = '指定范围预算尚未关联，不可比较';
    return {
      projectId,
      currency,
      scope: source?.scope ?? null,
      cutoff: source?.cutoff ?? null,
      budgetMinor,
      expenseMinor: expenseKnown && Number.isSafeInteger(total) ? total : null,
      missingPlanIds: budget.missingPlanIds,
      comparable: !reason,
      reason,
      executionPercent:
        !reason && budgetMinor! > 0 ? Number(((total / budgetMinor!) * 100).toFixed(1)) : null,
      varianceMinor: !reason ? total - budgetMinor! : null,
      overspendMinor: !reason ? Math.max(total - budgetMinor!, 0) : null,
      budgetStatus: reason
        ? '不可比较'
        : budgetMinor === 0
          ? total === 0
            ? '零预算无支出，执行率不适用'
            : '零预算有支出，状态异常'
          : total > budgetMinor!
            ? '超预算'
            : total * 10 >= budgetMinor! * 9
              ? '接近预算'
              : '预算内',

      expenses,
    };
  });
}
