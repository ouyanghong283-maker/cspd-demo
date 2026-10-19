import { selectContractFinance } from './contract-finance';
import { selectFinanceDetails } from './finance-details';
import type { DemoState } from '../models';
import { isValidISODate } from '../rules';
import { indexById, stableId } from './identity';
import {
  selectV10ProjectIdentity,
  V10_FINANCE_CONTRACT_VERSION,
  type V10QueryContext,
  type V10FinanceFilters,
  type V10FinanceResult,
  type V10FinanceMetrics,
  type V10FinanceProject,
  type V10ProjectFinanceResult,
} from '../v10-contracts';

function validMonth(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month) && isValidISODate(`${month}-01`);
}
function endOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`;
}
function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  let [year, month] = start.slice(0, 7).split('-').map(Number);
  while (`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}` <= end.slice(0, 7)) {
    months.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
    if (++month === 13) {
      year++;
      month = 1;
    }
  }
  return months;
}
function sum(values: number[]): number | null {
  const total = values.reduce((acc, value) => acc + BigInt(value), 0n);
  return total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)
    ? null
    : Number(total);
}
function metrics(
  rows: {
    projectId: string;
    revenueMinor: number | null;
    grossProfitMinor: number | null;
    complete: boolean;
  }[],
): V10FinanceMetrics {
  const comparable = rows.filter((r) => r.complete);
  const revenueMinor = comparable.length
    ? sum(comparable.map((r) => r.revenueMinor!))
    : rows.length
      ? null
      : 0;
  const grossProfitMinor = comparable.length
    ? sum(comparable.map((r) => r.grossProfitMinor!))
    : rows.length
      ? null
      : 0;
  const issues =
    revenueMinor === null || grossProfitMinor === null
      ? [comparable.length ? '聚合金额溢出' : '没有完整可比指标']
      : [];
  return {
    revenueMinor,
    grossProfitMinor,
    grossMargin:
      revenueMinor !== null && revenueMinor !== 0 && grossProfitMinor !== null
        ? grossProfitMinor / revenueMinor
        : null,
    marginReason: issues[0] ?? (revenueMinor === 0 ? '零收入，毛利率不可计算' : null),
    complete: comparable.length === rows.length && !issues.length,
    projectIds: comparable.map((r) => r.projectId).sort(),
    coverage: { complete: comparable.length, total: rows.length },
    issues,
  };
}

/** 纯查询：范围、币种、月份和批次均来自已提交来源；不迁移或补种。 */
export function selectV10Finance(
  state: Readonly<DemoState>,
  context: V10QueryContext,
  filters: V10FinanceFilters = {},
): V10FinanceResult {
  const identity = selectV10ProjectIdentity(state, context);
  const base: V10FinanceResult = {
    contractVersion: V10_FINANCE_CONTRACT_VERSION,
    scope: 'finance',
    workspaceId: context.workspaceId,
    roundId: context.roundId,
    dataVersion: context.dataVersion,
    contextRevision: context.contextRevision,
    dates: { ...context.dates },
    sources: { ...context.sources },
    status: 'unavailable',
    source: null,
    batchId: null,
    currency: null,
    units: { amount: 'minor', rate: 'ratio' },
    filters: { ...filters },
    period: null,
    resetReasons: [],
    issues: [],
    contractFinance: null,
    summary: null,
    projects: null,
    months: null,
  };
  if (['loading', 'unavailable'].includes(identity.status))
    return { ...base, status: identity.status, issues: identity.issues.map((i) => i.reason) };
  if (context.sources.finance === 'unavailable' || context.sources.finance === 'loading')
    return { ...base, status: context.sources.finance, issues: ['财务来源未成功读取'] };
  const batches = state.financeBatches;
  if (context.sources.finance === 'empty' && batches?.length)
    return { ...base, issues: ['财务来源声明为空但存在批次'] };
  if (!Array.isArray(batches))
    return { ...base, issues: ['整月财务来源尚未提供，旧快照不能倒推月额'] };
  if (!batches.length)
    return { ...base, status: 'empty', issues: ['已读取空财务来源，无合法期间'] };
  const candidates = filters.batchId
    ? batches.filter((b) => b.batchId === filters.batchId)
    : [batches[0]];
  const batch = candidates[0];
  if (
    candidates.length !== 1 ||
    !batch ||
    !stableId(batch.batchId) ||
    batches.filter((b) => b.batchId === batch.batchId).length !== 1
  )
    return { ...base, issues: ['财务批次不存在或身份冲突'] };
  base.batchId = batch.batchId;
  base.source = batch.source;
  const currency = filters.currency ?? batch.primaryCurrency;
  if (!['CNY', 'USD', 'EUR'].includes(currency)) return { ...base, issues: ['财务币种无效'] };
  base.currency = currency;
  if (
    !isValidISODate(batch.periodStart) ||
    !isValidISODate(batch.periodEnd) ||
    !batch.periodStart.endsWith('-01') ||
    batch.periodEnd !== endOfMonth(batch.periodEnd.slice(0, 7)) ||
    batch.periodStart > batch.periodEnd ||
    !validMonth(batch.latestClosedMonth) ||
    !Array.isArray(batch.projects) ||
    !Array.isArray(batch.facts)
  )
    return { ...base, issues: ['批次期间或供数声明无效'] };
  // realNowUtc按上海自然日确定已结束月份；计划观察日不参与财务期间。
  const today = new Date(new Date(context.dates.realNowUtc).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const closedMonths = monthsBetween(batch.periodStart, batch.periodEnd).filter(
    (m) => m <= batch.latestClosedMonth && endOfMonth(m) < today,
  );
  if (!closedMonths.length) return { ...base, issues: ['来源内没有已结束的完整自然月'] };
  const defaultStart = `${closedMonths[0]}-01`,
    defaultEnd = endOfMonth(closedMonths.at(-1)!);
  let periodStart = filters.periodStart ?? defaultStart,
    periodEnd = filters.periodEnd ?? defaultEnd;
  if (
    !isValidISODate(periodStart) ||
    !isValidISODate(periodEnd) ||
    !periodStart.endsWith('-01') ||
    periodEnd !== endOfMonth(periodEnd.slice(0, 7)) ||
    periodStart > periodEnd ||
    periodStart < defaultStart ||
    periodEnd > defaultEnd ||
    (filters.asOf !== undefined && filters.asOf !== periodEnd)
  ) {
    base.resetReasons.push('非法、非整月或超出来源期间的条件已恢复为批次完整月累计范围');
    periodStart = defaultStart;
    periodEnd = defaultEnd;
  }
  base.period = { periodStart, periodEnd, asOf: periodEnd };
  base.filters = { ...filters, batchId: batch.batchId, currency, ...base.period };
  const months = monthsBetween(periodStart, periodEnd);
  const projectIndex = indexById(state.projects);
  const declarations = new Map<string, typeof batch.projects>();
  for (const entry of batch.projects) {
    if (!stableId(entry.projectId)) {
      base.issues.push('供数范围含无稳定项目ID的声明');
      continue;
    }
    const list = declarations.get(entry.projectId) ?? [];
    list.push(entry);
    declarations.set(entry.projectId, list);
  }
  const factIndex = new Map<string, typeof batch.facts>();
  for (const fact of batch.facts) {
    const list = factIndex.get(fact.factId) ?? [];
    list.push(fact);
    factIndex.set(fact.factId, list);
  }
  const projects: V10FinanceProject[] = [];
  for (const [id, entries] of declarations) {
    if (filters.projectId && id !== filters.projectId) continue;
    const rows = projectIndex.get(id) ?? [];
    const project = rows.length === 1 ? rows[0] : null;
    if (filters.customerId && project?.customerId !== filters.customerId) continue;
    if (
      filters.keyword &&
      !`${id} ${project?.name ?? ''}`.toLowerCase().includes(filters.keyword.trim().toLowerCase())
    )
      continue;
    // 未知币种必须留在待核范围，不能从分母中消失。
    if (
      entries.every(
        (e) =>
          e.currency !== null &&
          ['CNY', 'EUR', 'USD'].includes(e.currency) &&
          e.currency !== currency,
      )
    )
      continue;
    if (
      entries.every(
        (e) =>
          Array.isArray(e.months) &&
          e.months.length > 0 &&
          e.months.every(validMonth) &&
          !e.months.some((m) => months.includes(m)),
      )
    )
      continue;
    const entry = entries[0];
    const issues: string[] = [];
    if (entries.length !== 1) issues.push('项目供数范围声明重复，待核');
    if (!project) issues.push('项目关联缺失或身份重复，待核');
    if (
      !Array.isArray(entry.months) ||
      !entry.months.length ||
      entry.months.some((m) => !validMonth(m))
    )
      issues.push('项目适用月份声明缺失或无效');
    if (entry.currency !== currency) issues.push('项目币种归属待核');
    if (!['complete', 'partial', 'missing'].includes(entry.completeness))
      issues.push('供数完整性声明无效');
    const details = months.map((month) => {
      const issuesForMonth = [...issues];
      if (!Array.isArray(entry.months) || !entry.months.includes(month))
        issuesForMonth.push('该月不在项目声明适用月份内');
      const matching = batch.facts.filter(
        (f) => f.projectId === id && f.currency === currency && f.month === month,
      );
      const unique = [...new Map(matching.map((f) => [f.factId, f])).values()];
      if (unique.length !== 1)
        issuesForMonth.push(unique.length ? '同项目月份存在多条不同事实，待核' : '缺少月度事实');
      const fact = unique.length === 1 ? unique[0] : null;
      if (
        fact &&
        (!stableId(fact.factId) ||
          (factIndex.get(fact.factId) ?? []).some(
            (f) =>
              f.projectId !== fact.projectId ||
              f.currency !== fact.currency ||
              f.month !== fact.month ||
              f.revenueMinor !== fact.revenueMinor ||
              f.grossProfitMinor !== fact.grossProfitMinor,
          ))
      )
        issuesForMonth.push('事实ID缺失或同ID事实冲突');
      const structuralIssue = issuesForMonth.length > 0;
      if (entry.completeness !== 'complete')
        issuesForMonth.push('项目供数未完整，金额仅为已知部分');
      function amount(value: unknown, label: string): number | null {
        if (!Number.isSafeInteger(value)) {
          issuesForMonth.push(`${label}缺失或不是安全整数分`);
          return null;
        }
        return value as number;
      }
      const revenueMinor = fact ? amount(fact.revenueMinor, '收入') : null;
      const grossProfitMinor = fact ? amount(fact.grossProfitMinor, '毛利') : null;
      return {
        month,
        factIds: unique.map((f) => f.factId),
        revenueMinor: structuralIssue ? null : revenueMinor,
        grossProfitMinor: structuralIssue ? null : grossProfitMinor,
        complete: !issuesForMonth.length,
        issues: issuesForMonth,
      };
    });
    const revenueMinor = details.every((d) => d.revenueMinor !== null)
      ? sum(details.map((d) => d.revenueMinor!))
      : null;
    const grossProfitMinor = details.every((d) => d.grossProfitMinor !== null)
      ? sum(details.map((d) => d.grossProfitMinor!))
      : null;
    const complete =
      details.every((d) => d.complete) && revenueMinor !== null && grossProfitMinor !== null;
    if (
      details.every((d) => d.revenueMinor !== null && d.grossProfitMinor !== null) &&
      (revenueMinor === null || grossProfitMinor === null)
    )
      issues.push('项目累计金额溢出');
    const calculated = metrics([{ projectId: id, revenueMinor, grossProfitMinor, complete }]);
    projects.push({
      ...calculated,
      details: selectFinanceDetails(state, id),
      revenueMinor,
      grossProfitMinor,
      projectId: id,
      name: project?.name ?? null,
      customerId: project?.customerId ?? null,
      currency: entry.currency,
      sourceHref: project ? `/projects/${encodeURIComponent(id)}` : null,
      months: details,
      issues: [...issues, ...details.flatMap((d) => d.issues), ...calculated.issues],
    });
  }
  const monthly: NonNullable<V10FinanceResult['months']> = months.map((month, i) => {
    const current = metrics(projects.map((p) => ({ projectId: p.projectId, ...p.months[i] })));
    return {
      ...current,
      month,
      comparison: { comparable: false, grossProfitChangeMinor: null, reason: '所选范围没有上月' },
    };
  });
  for (let i = 1; i < monthly.length; i++) {
    const current = monthly[i],
      previous = monthly[i - 1];
    const comparable =
      current.projectIds.length > 0 &&
      JSON.stringify(current.projectIds) === JSON.stringify(previous.projectIds) &&
      current.grossProfitMinor !== null &&
      previous.grossProfitMinor !== null &&
      current.revenueMinor !== null &&
      previous.revenueMinor !== null;
    const change = comparable
      ? sum([current.grossProfitMinor!, -previous.grossProfitMinor!])
      : null;
    current.comparison = {
      comparable: comparable && change !== null,
      grossProfitChangeMinor: change,
      reason: !comparable
        ? '完整可比项目集合不同或指标缺失'
        : change === null
          ? '环比差额溢出'
          : null,
    };
  }
  if (filters.projectId && !projects.length) base.issues.push('目标项目不存在或不在所选财务范围');
  return {
    ...base,
    status: 'ready',
    contractFinance: selectContractFinance(
      state,
      projects.map((p) => p.projectId),
    ),
    summary: metrics(projects),
    projects,
    months: monthly,
  };
}
export function selectV10ProjectFinance(
  state: Readonly<DemoState>,
  context: V10QueryContext,
  projectId: string,
  filters: V10FinanceFilters = {},
): V10ProjectFinanceResult {
  const result = selectV10Finance(state, context, { ...filters, projectId });
  return {
    ...result,
    scope: 'project-finance',
    projectId,
    project: result.projects?.find((p) => p.projectId === projectId) ?? null,
  };
}
