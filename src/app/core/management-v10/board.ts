import type { DemoState } from '../models';
import { V10_BOARD_CONTRACT_VERSION } from '../v10-contracts';
import type {
  V10BoardFilters,
  V10BoardResult,
  V10BoardProject,
  V10BoardList,
  V10BoardCustomerGroup,
  V10OpportunitySummary,
  V10QueryContext,
  V10SourceIssue,
} from '../v10-contracts';
import { selectV10Portfolio } from './portfolio';
import { selectV10ProjectDelivery } from './delivery';
import { selectV10Finance } from './finance';
import { indexById } from './identity-index';
import { selectBoardBottom } from './bottom';

/** 只组合公开业务结果；局部清单条件不传入首屏查询。 */
export function selectV10Board(
  state: Readonly<DemoState>,
  context: V10QueryContext,
  filters: V10BoardFilters = {},
): V10BoardResult {
  const portfolio = selectV10Portfolio(state, context, {
    presalesScope: 'all',
    executionScope: 'all',
  });
  const defaults = selectV10Portfolio(state, context);
  const normalized: V10BoardResult['filters'] = {
    bottom: { ...filters.bottom },
    presales: {
      scope: filters.presales?.scope ?? 'pipeline',
      keyword: filters.presales?.keyword?.trim() ?? '',
      stage: filters.presales?.stage,
    },
    execution: {
      scope: filters.execution?.scope ?? 'active',
      keyword: filters.execution?.keyword?.trim() ?? '',
      status: filters.execution?.status,
    },
  };
  const sales = indexById(state.sales);
  const customers = indexById(state.customers);
  const projects: V10BoardProject[] | null =
    portfolio.execution.projects?.map((p) => {
      const rows = p.opportunityId ? sales.get(p.opportunityId) : undefined;
      const rawGrade =
        rows?.length === 1 &&
        !p.issues.some((i) => !['execution-scope', 'stage'].includes(i.field)) &&
        context.sources.opportunities === 'ready'
          ? rows[0].grade
          : null;
      const grade = ['S', 'A', 'B1', 'B2'].includes(rawGrade ?? '')
        ? (rawGrade as V10BoardProject['grade'])
        : null;
      return {
        ...p,
        grade,
        gradeIssue: grade ? null : '关联商机人工等级待核',
        gradeSource:
          grade && p.opportunityId
            ? {
                opportunityId: p.opportunityId,
                sourceHref: `/sales/detail/${encodeURIComponent(p.opportunityId)}`,
              }
            : null,
        delivery: selectV10ProjectDelivery(state, context, p.projectId!).delivery,
        selectionReason: null,
      };
    }) ?? null;
  const active = projects?.filter((p) => p.executionScope === 'active') ?? null;
  const distribution = active ? { delayed: 0, warning: 0, pending: 0, normal: 0 } : null;
  if (distribution) for (const p of active!) distribution[p.delivery?.status ?? 'pending']++;
  const matches = (keyword: string, id: string | null, name: string, customerId: string | null) => {
    const customer = customerId ? customers.get(customerId) : undefined;
    const values = [id, name, customerId, ...(customer?.length === 1 ? [customer[0].name] : [])];
    return values.some((v) => v?.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()));
  };
  function group<
    T extends { customerId: string | null; issues: V10SourceIssue[]; incomplete: boolean },
  >(
    items: T[] | null,
    status: V10BoardList<T>['status'],
    summary: (item: T) => { key: string; abnormal: boolean; pending: boolean },
  ): V10BoardList<T> {
    if (!items) return { status, matchedCount: null, customers: null, pending: null };
    const groups = new Map<string, V10BoardCustomerGroup<T>>();
    const pending: T[] = [];
    for (const item of items) {
      const customer = item.customerId ? customers.get(item.customerId) : undefined;
      if (
        item.issues.some((i) => !['execution-scope', 'stage'].includes(i.field)) ||
        context.sources.customers !== 'ready' ||
        customer?.length !== 1
      ) {
        pending.push(item);
        continue;
      }
      const id = item.customerId!;
      let g = groups.get(id);
      if (!g) {
        g = {
          customerId: id,
          name: customer[0].name,
          sourceHref: `/sales/customers/${encodeURIComponent(id)}`,
          items: [],
          count: 0,
          distribution: {},
          abnormalCount: 0,
          pendingCount: 0,
        };
        groups.set(id, g);
      }
      g.items.push(item);
      g.count++;
      const { key, abnormal, pending: isPending } = summary(item);
      g.distribution[key] = (g.distribution[key] ?? 0) + 1;
      if (abnormal) g.abnormalCount++;
      if (isPending) g.pendingCount++;
    }
    return {
      status,
      matchedCount: items.length,
      customers: [...groups.values()].sort((a, b) => a.customerId.localeCompare(b.customerId)),
      pending,
    };
  }
  const presales =
    portfolio.presales.opportunities
      ?.filter((o) => {
        const f = normalized.presales;
        return (
          (f.scope === 'all' ||
            (f.scope === 'pipeline'
              ? o.salesResult === 'open'
              : f.scope === 'converted'
                ? o.convertedToProject === true
                : o.salesResult === f.scope)) &&
          (!f.stage || o.stage === f.stage) &&
          matches(f.keyword, o.opportunityId, o.name, o.customerId)
        );
      })
      .map((o) => (o.convertedToProject ? { ...o, progress: null } : o)) ?? null;
  const execution =
    projects?.filter((p) => {
      const f = normalized.execution;
      return (
        (f.scope === 'all' || p.executionScope === f.scope) &&
        (!f.status || (p.delivery?.status ?? 'pending') === f.status) &&
        matches(f.keyword, p.projectId, p.name, p.customerId)
      );
    }) ?? null;
  const gradeRank = (p: V10BoardProject) => (p.grade ? ['S', 'A', 'B1', 'B2'].indexOf(p.grade) : 4);
  const riskRank = (p: V10BoardProject) =>
    p.delivery?.status === 'delayed' ? 0 : p.delivery?.status === 'warning' ? 1 : 2;
  const date = (p: V10BoardProject) => p.delivery?.nextNode?.promisedDate ?? '9999-99-99';
  const byDateId = (a: V10BoardProject, b: V10BoardProject) =>
    date(a).localeCompare(date(b)) || a.projectId!.localeCompare(b.projectId!);
  const highGrade = active
    ? [...active]
        .sort((a, b) => gradeRank(a) - gradeRank(b) || riskRank(a) - riskRank(b) || byDateId(a, b))
        .slice(0, 3)
        .map((p) => ({ ...p, selectionReason: 'grade' as const }))
    : null;
  const selected = new Set(highGrade?.map((p) => p.projectId));
  const abnormal = active
    ? active
        .filter((p) => !selected.has(p.projectId) && riskRank(p) < 2)
        .sort(
          (a, b) =>
            riskRank(a) - riskRank(b) ||
            date(a).localeCompare(date(b)) ||
            gradeRank(a) - gradeRank(b) ||
            a.projectId!.localeCompare(b.projectId!),
        )
        .slice(0, 3)
        .map((p) => ({ ...p, selectionReason: 'delivery-risk' as const }))
    : null;
  return {
    contractVersion: V10_BOARD_CONTRACT_VERSION,
    scope: 'management-board',
    workspaceId: portfolio.workspaceId,
    roundId: portfolio.roundId,
    dataVersion: portfolio.dataVersion,
    contextRevision: portfolio.contextRevision,
    dates: portfolio.dates,
    sources: portfolio.sources,
    units: portfolio.units,
    filters: normalized,
    issues: portfolio.issues,
    overview: {
      presales: defaults.presales,
      execution: {
        status: defaults.execution.status,
        counts: defaults.execution.counts,
        distribution,
      },
      finance: selectV10Finance(state, context),
    },
    presales: group<V10OpportunitySummary>(presales, portfolio.presales.status, (o) => ({
      key: o.stage ?? 'pending',
      abnormal: false,
      pending: o.incomplete || o.issues.length > 0,
    })),
    execution: {
      ...group(execution, portfolio.execution.status, (p) => ({
        key: p.delivery?.status ?? 'pending',
        abnormal: p.delivery?.status === 'delayed' || p.delivery?.status === 'warning',
        pending:
          p.incomplete ||
          p.gradeIssue !== null ||
          !p.delivery ||
          p.delivery.incomplete ||
          p.delivery.status === 'pending',
      })),
      unidentified: portfolio.execution.unidentified,
    },
    bottom: selectBoardBottom(state, context, normalized.bottom),
    highlights: { status: portfolio.execution.status, highGrade, abnormal },
  };
}
