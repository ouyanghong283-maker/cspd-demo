import { comparePriority, comparableCapacity, selectBoardExceptions } from './priorities';
import { isValidISODate } from '../rules';
import { selectManagementStatistics, selectCompleteWorkItems } from '../management-statistics';
import { selectLifecycleProgress } from '../lifecycle-progress';
import { selectBudgetComparison } from '../budget-comparison';
import type { DemoState } from '../models';
import type {
  FileAvailability,
  LifecycleProgressView,
  ManagementBoardFilters,
  ManagementBoardView,
  V9Dates,
  V9ModuleQueries,
} from '../v9-contracts';

/** 接收已提交来源查询；未接入计分来源时显式待补，不把旧计划状态冒充生命周期进度。 */
export type ManagementBoardSources = Partial<
  Pick<
    V9ModuleQueries,
    'selectLifecycleProgress' | 'selectCompleteWorkItems' | 'selectBudgetComparison'
  >
>;
function needsSupplement(progress: LifecycleProgressView): boolean {
  return progress.nodes.some((n) => n.status === 'missing' || n.status === 'invalidated');
}
function compareProgress(a: LifecycleProgressView, b: LifecycleProgressView): number {
  try {
    const ad = BigInt(a.score.denominator),
      bd = BigInt(b.score.denominator);
    if (ad <= 0n || bd <= 0n) throw Error('分母非法');
    const difference = BigInt(a.score.numerator) * bd - BigInt(b.score.numerator) * ad;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  } catch {
    return 0;
  }
}

export function selectManagementBoard(
  state: Readonly<DemoState>,
  filters: ManagementBoardFilters,
  dates: V9Dates,
  availability: Readonly<Record<string, FileAvailability>>,
  sources: ManagementBoardSources = {},
): ManagementBoardView {
  const progress = sources.selectLifecycleProgress ?? selectLifecycleProgress;
  const sales = state.sales.filter((s) => s.type === 'opportunity');
  const saleIds = new Set(sales.map((s) => s.id));
  const duplicateIds = new Set(
    sales.filter((s, i) => sales.findIndex((other) => other.id === s.id) !== i).map((s) => s.id),
  );
  const duplicateProjects = new Set(
    state.projects
      .filter((p, i) => state.projects.findIndex((other) => other.id === p.id) !== i)
      .map((p) => p.id),
  );
  const pending = state.projects.filter(
    (p) =>
      !saleIds.has(p.opportunityId) ||
      duplicateIds.has(p.opportunityId) ||
      duplicateProjects.has(p.id),
  );
  const allItems = (sources.selectCompleteWorkItems ?? selectCompleteWorkItems)(state, dates);
  const businesses: ManagementBoardView['businesses'] = [];
  const projects: ManagementBoardView['projects'] = [];
  for (const sale of sales) {
    if (duplicateIds.has(sale.id)) continue;
    const associated = state.projects.filter(
      (p) => p.opportunityId === sale.id && !duplicateProjects.has(p.id),
    );
    const linked = filters.projectIds.length
      ? associated.filter((p) => filters.projectIds.includes(p.id))
      : associated;
    if (filters.businessIds.length && !filters.businessIds.includes(sale.id)) continue;
    if (filters.projectIds.length && linked.length === 0) continue;
    const businessItems = allItems.filter(
      (i) =>
        i.businessId === sale.id &&
        (!filters.projectIds.length ||
          i.projectId === null ||
          linked.some((p) => p.id === i.projectId)),
    );
    if (
      filters.partition &&
      filters.partition !== 'all' &&
      filters.partition !== (linked.length ? 'execution' : 'presales')
    )
      continue;
    if (filters.regions?.length && !filters.regions.includes(sale.projectRegion ?? '')) continue;
    if (filters.stages?.length && !filters.stages.includes(sale.stage)) continue;
    if (
      filters.owners?.length &&
      !filters.owners.includes(sale.owner) &&
      !linked.some((p) => filters.owners!.includes(p.pm)) &&
      !businessItems.some((i) => i.owner && filters.owners!.includes(i.owner.name))
    )
      continue;
    if (filters.grades.length && !filters.grades.includes(sale.grade)) continue;
    if (
      filters.query &&
      !`${sale.id} ${sale.projectName} ${linked.map((p) => p.name).join(' ')}`
        .toLocaleLowerCase()
        .includes(filters.query.toLocaleLowerCase())
    )
      continue;
    if (
      filters.departments.length &&
      !businessItems.some((i) => filters.departments.includes(i.department))
    )
      continue;
    const first = state.solutionWorkspaces?.find(
      (w) => w.opportunityId === sale.id,
    )?.firstFinalization;
    if (filters.firstResults.length && (!first || !filters.firstResults.includes(first.result)))
      continue;
    const scored = linked.map((p) => ({
      projectId: p.id,
      businessId: sale.id,
      progress: progress(state, sale.id, p.id, dates),
      sourceHref: `/projects/${encodeURIComponent(p.id)}`,
    }));
    projects.push(...scored);
    const slowest = [...scored].sort(
      (a, b) => compareProgress(a.progress, b.progress) || a.projectId.localeCompare(b.projectId),
    )[0];
    const shared = slowest?.progress ?? progress(state, sale.id, null, dates);
    businesses.push({
      businessId: sale.id,
      opportunityId: sale.id,
      projectIds: linked.map((p) => p.id),
      partition: linked.length ? 'execution' : 'presales',
      progress: shared,
      slowestProjectId: slowest?.projectId ?? null,
      incomplete: needsSupplement(shared) || scored.some((p) => needsSupplement(p.progress)),
      sourceHref: linked.length
        ? `/projects/${encodeURIComponent(slowest!.projectId)}`
        : `/sales/detail/${encodeURIComponent(sale.id)}`,
    });
  }
  let budgets = projects
    .flatMap((p) => (sources.selectBudgetComparison ?? selectBudgetComparison)(state, p.projectId))
    .filter((b) => !filters.budgetCurrency || b.currency === filters.budgetCurrency);
  let actionable = selectBoardExceptions(state, businesses, budgets, dates, availability);
  if (filters.exceptionOnly) {
    const ids = new Set(actionable.map((e) => e.businessId));
    for (let i = businesses.length - 1; i >= 0; i--)
      if (!ids.has(businesses[i].businessId)) businesses.splice(i, 1);
    for (let i = projects.length - 1; i >= 0; i--)
      if (!ids.has(projects[i].businessId)) projects.splice(i, 1);
    budgets = budgets.filter((b) => projects.some((p) => p.projectId === b.projectId));
    actionable = actionable.filter((e) => ids.has(e.businessId));
  }
  const included = new Set(businesses.map((b) => b.businessId));
  const { firstResults, firstResultDenominator } = selectManagementStatistics(state, dates, [
    ...included,
  ]);
  // 关联不明项单列；无法判定的维度不冒充符合筛选。
  const matchesPending = (businessId: string, projectId: string | null, name: string) => {
    if (filters.businessIds.length && !filters.businessIds.includes(businessId)) return false;
    if (filters.projectIds.length && (!projectId || !filters.projectIds.includes(projectId)))
      return false;
    if (
      filters.query &&
      !`${businessId} ${projectId ?? ''} ${name}`
        .toLowerCase()
        .includes(filters.query.toLowerCase())
    )
      return false;
    if (filters.partition === 'presales') return false;
    const sale = sales.filter((s) => s.id === businessId);
    if (filters.grades.length && (sale.length !== 1 || !filters.grades.includes(sale[0].grade)))
      return false;
    if (
      filters.regions?.length &&
      (sale.length !== 1 || !filters.regions.includes(sale[0].projectRegion ?? ''))
    )
      return false;
    if (filters.stages?.length && (sale.length !== 1 || !filters.stages.includes(sale[0].stage)))
      return false;
    if (filters.owners?.length || filters.departments.length || filters.firstResults.length)
      return false;
    return true;
  };
  const pendingProjects = pending.filter((p) => matchesPending(p.opportunityId, p.id, p.name));
  const pendingBusinesses = [...duplicateIds].filter((id) => matchesPending(id, null, ''));
  return {
    filters: structuredClone(filters),
    businessCount: businesses.length,
    projectCount: projects.length,
    pendingReviewCount: pendingProjects.length + pendingBusinesses.length,
    businesses,
    projects,
    topFive: sales
      .filter((s) => included.has(s.id))
      .sort(comparePriority)
      .slice(0, 5)
      .map((s) => {
        const capacity = comparableCapacity(s);
        const b = businesses.find((b) => b.businessId === s.id)!;
        const project = state.projects.find((p) => p.id === b.slowestProjectId);
        const candidates = project
          ? project.plans.filter(
              (p) => p.type === '客户主节点' && p.status !== '已取消' && p.status !== '已完成',
            )
          : (s.opportunityRoughPlans ?? []);
        const nextPlan = [...candidates].sort((a, b) => {
          const av = isValidISODate(a.end),
            bv = isValidISODate(b.end);
          return Number(bv) - Number(av) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id);
        })[0];
        const end = nextPlan?.end ?? '';
        const start = nextPlan?.start ?? '';
        return {
          businessId: s.id,
          grade: s.grade || null,
          capacity: capacity?.value ?? null,
          capacityUnit: capacity?.unit ?? null,
          deadlineDate: isValidISODate(end) ? end : null,
          startDate: isValidISODate(start) && isValidISODate(end) && start <= end ? start : null,
          timelineLabel: nextPlan
            ? `${project ? '客户主节点' : '商机粗计划'}：${nextPlan.name}（${nextPlan.id}）`
            : '关键节点排期待补',
          ownerName: nextPlan?.owner || project?.pm || s.owner || null,
          progressLabel: b.progress.displayPercent,
          sourceHref: b.sourceHref,
        };
      }),
    exceptions: [
      ...pendingProjects.map((p) => ({
        id: `association:${p.id}`,
        businessId: p.opportunityId,
        projectId: p.id,
        reason: '关联待核：缺失或重复稳定身份，未计入主线汇总',
        owner: null,
        sourceHref: `/projects/${encodeURIComponent(p.id)}`,
      })),
      ...pendingBusinesses.map((id) => ({
        id: `association:business:${id}`,
        businessId: id,
        projectId: null,
        reason: '关联待核：商机稳定身份重复，原记录保留且未汇总',
        owner: null,
        sourceHref: `/sales/detail/${encodeURIComponent(id)}`,
      })),
      ...actionable,
    ],
    departmentItems: allItems.filter(
      (i) =>
        included.has(i.businessId) &&
        (!filters.projectIds.length ||
          i.projectId === null ||
          filters.projectIds.includes(i.projectId)),
    ),
    firstResults: firstResults.filter((group) => group.count > 0),
    firstResultDenominator,
    budgets,
  };
}
