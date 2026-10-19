import type { DemoState } from '../models';
import type {
  V10BoardBottom,
  V10BoardFilters,
  V10QueryContext,
  V10WorkItem,
} from '../v10-contracts';
import { selectCompleteWorkItems, selectManagementStatistics } from '../management-statistics';
import { selectFirstFinalizations } from './first-finalizations';
import { readManagementSources } from './management-sources';

export function selectBoardBottom(
  state: Readonly<DemoState>,
  context: V10QueryContext,
  filters: V10BoardFilters['bottom'] = {},
): V10BoardBottom {
  const source = readManagementSources(state, context);
  const statuses = [
    source.projectStatus,
    source.opportunityStatus,
    source.solutionStatus,
    source.workStatus,
  ];
  const unavailable = statuses.some((s) => !source.readable(s));
  const status = unavailable ? (statuses.includes('loading') ? 'loading' : 'unavailable') : 'ready';
  const first = selectFirstFinalizations(source, context);
  const pendingFirst = new Set(
    first.items?.filter((i) => i.result === 'pending').flatMap((i) => i.opportunityIds),
  );
  const all: V10WorkItem[] | null = unavailable
    ? null
    : selectCompleteWorkItems(source.state, context.dates)
        .map((i): V10WorkItem => {
          const shared = i.sourceId === 'department-task' || i.sourceId === 'solution-finalization';
          return {
            ...i,
            status:
              i.sourceId === 'solution-finalization' && pendingFirst.has(i.businessId)
                ? 'pending'
                : i.status,
            projectId: shared ? null : i.projectId,
            projectIds: shared
              ? [...(source.projectIdsByOpportunity.get(i.businessId) ?? [])]
              : i.projectId
                ? [i.projectId]
                : [],
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
  const items =
    all?.filter((i) => !filters.department || i.department === filters.department) ?? null;
  const stats = items
    ? selectManagementStatistics(
        source.state,
        context.dates,
        null,
        items.filter(
          (i): i is V10WorkItem & { status: 'open' | 'completed' } => i.status !== 'pending',
        ),
      )
    : null;
  return {
    scope: 'workspace-business-sources',
    issues: source.issues,
    departments: {
      status: items?.length === 0 ? 'empty' : status,
      summary:
        stats?.departments.map((d) => {
          const pending = items!.filter(
            (i) => i.department === d.department && i.status === 'pending',
          ).length;
          return { ...d, total: d.total + pending, pending };
        }) ?? null,
      items,
      collaboration: items
        ? [...source.state.projects]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((p) => ({
              projectId: p.id,
              name: p.name,
              sourceHref: `/projects/${encodeURIComponent(p.id)}`,
              items: items.filter((i) => i.projectIds.includes(p.id)),
            }))
            .filter((g) => g.items.length)
        : null,
    },
    firstFinalizations: {
      ...first,
      items:
        first.items?.filter((i) => !filters.firstResult || i.result === filters.firstResult) ??
        null,
    },
  };
}
