import type { DemoState } from './models';
import { collectDemoWorkItems } from './work-item-sources';
import type { CompleteWorkItemView, V9Dates } from './v9-contracts';
import { workItemId } from './work-item-registry';
import { isValidISODate } from './rules';
import { selectSolutionWorkspace } from './v9-queries';
const departments = ['sales', 'solution', 'pm-pmo', 'service', 'unknown'] as const;
export function managementDepartment(value: string): CompleteWorkItemView['department'] {
  const map: Record<string, CompleteWorkItemView['department']> = {
    销售: 'sales',
    销售部: 'sales',
    解决方案: 'solution',
    方案: 'solution',
    'PMO / PM': 'pm-pmo',
    PMO: 'pm-pmo',
    PM: 'pm-pmo',
    项目管理: 'pm-pmo',
    质量: 'pm-pmo',
    FAT: 'pm-pmo',
    订单: 'pm-pmo',
    物流: 'pm-pmo',
    调试: 'service',
    运维售后: 'service',
    运维: 'service',
    售后: 'service',
  };
  return map[value] ?? 'unknown';
}
export function selectCompleteWorkItems(
  state: Readonly<DemoState>,
  dates: V9Dates,
): CompleteWorkItemView[] {
  const items = collectDemoWorkItems(
    state as DemoState,
    undefined,
    dates.planObservationDate,
    true,
  ).items.map((item) => {
    const project = state.projects.find((p) => p.id === item.projectId);
    const departmentSale =
      item.sourceId === 'department-task'
        ? state.sales.find((s) => item.sourceRecordId.startsWith(`${s.id}:`))
        : null;
    const ownerMembers =
      project?.team.filter((m) =>
        item.ownerPersonId
          ? m.personId === item.ownerPersonId || m.id === item.ownerPersonId
          : m.person === item.owner,
      ) ?? [];
    const department =
      item.sourceId === 'project-plan'
        ? ownerMembers.length === 1
          ? managementDepartment(ownerMembers[0].department)
          : 'unknown'
        : managementDepartment(item.department);
    return {
      id: item.id,
      sourceId: item.sourceId,
      sourceRecordId: item.sourceRecordId,
      businessId: departmentSale?.id ?? project?.opportunityId ?? '',
      projectId: item.projectId ?? null,
      owner:
        item.owner && item.owner !== '负责人待核'
          ? { personId: item.ownerPersonId ?? '', name: item.owner }
          : null,
      department,
      status: item.status,
      dueDate: item.dueDate && isValidISODate(item.dueDate) ? item.dueDate : null,
      sourceHref: item.href ?? '',
    };
  });
  for (const w of state.solutionWorkspaces ?? []) {
    if (!w.schedule && !w.firstFinalization) continue;
    const sourceId = 'solution-finalization';
    const sourceRecordId = w.opportunityId;
    items.push({
      id: workItemId(sourceId, sourceRecordId),
      sourceId,
      sourceRecordId,
      businessId: w.opportunityId,
      projectId: null,
      owner: w.schedule?.owner ?? null,
      department: 'solution',
      status: w.firstFinalization ? 'completed' : 'open',
      dueDate:
        w.schedule?.deadlineDate && isValidISODate(w.schedule.deadlineDate)
          ? w.schedule.deadlineDate
          : null,
      sourceHref: `/sales/detail/${encodeURIComponent(w.opportunityId)}?tab=方案`,
    });
  }
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
export function selectManagementStatistics(
  state: Readonly<DemoState>,
  dates: V9Dates,
  businessIds: readonly string[] | null = null,
  scopedItems?: readonly CompleteWorkItemView[],
) {
  const allowed = (id: string) => businessIds === null || businessIds.includes(id);
  const items = (scopedItems ?? selectCompleteWorkItems(state, dates)).filter((i) =>
    allowed(i.businessId),
  );
  const workspaces = [
    ...new Map(
      (state.solutionWorkspaces ?? [])
        .filter((w) => allowed(w.opportunityId))
        .map((w) => [w.opportunityId, w]),
    ).values(),
  ];
  const seenEvents = new Set<string>();
  const scoredWorkspaces = workspaces.filter((w) => {
    const id = w.firstFinalization?.eventId;
    if (!id || seenEvents.has(id)) return false;
    seenEvents.add(id);
    return true;
  });
  const firstResults = (['early', 'on-time', 'late'] as const).map((result) => ({
    result,
    businessIds: scoredWorkspaces
      .filter((w) => w.firstFinalization?.result === result)
      .map((w) => w.opportunityId),
    count: scoredWorkspaces.filter((w) => w.firstFinalization?.result === result).length,
  }));
  const dateFor = (item: CompleteWorkItemView) =>
    item.sourceId === 'solution-finalization'
      ? dates.solutionBusinessDate
      : dates.planObservationDate;
  return {
    items,
    departments: departments.map((department) => {
      const group = items.filter((i) => i.department === department);
      return {
        department,
        total: group.length,
        completed: group.filter((i) => i.status === 'completed').length,
        open: group.filter((i) => i.status === 'open').length,
        overdueOpen: group.filter(
          (i) => i.status === 'open' && i.dueDate !== null && i.dueDate < dateFor(i),
        ).length,
      };
    }),
    firstResults,
    firstResultDenominator: firstResults.reduce((n, g) => n + g.count, 0),
    historicalUnscored: new Set(
      state.sales
        .filter(
          (s) =>
            s.type === 'opportunity' &&
            allowed(s.id) &&
            selectSolutionWorkspace(state, s.id, {}).firstResult === 'historical-unscored',
        )
        .map((s) => s.id),
    ).size,
    notFinalized: new Set(
      state.sales
        .filter(
          (s) =>
            s.type === 'opportunity' &&
            allowed(s.id) &&
            selectSolutionWorkspace(state, s.id, {}).firstResult === 'not-finalized',
        )
        .map((s) => s.id),
    ).size,
  };
}
