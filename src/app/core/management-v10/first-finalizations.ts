import type { DemoState } from '../models';
import type {
  V10BoardBottom,
  V10FirstResultItem,
  V10FirstResult,
  V10QueryContext,
} from '../v10-contracts';
import { selectSolutionWorkspace } from '../v9-queries';
import { selectFirstAchievement } from '../solution-workflow/finalization';
import { readManagementSources } from './management-sources';

/** 首次成绩沿用事件快照，核对其依据但不按当前排期重新评分。 */
export function selectFirstFinalizations(
  source: ReturnType<typeof readManagementSources>,
  context: V10QueryContext,
  filter?: V10FirstResult,
): V10BoardBottom['firstFinalizations'] {
  const statuses = [source.opportunityStatus, source.solutionStatus];
  if (statuses.some((s) => !source.readable(s)))
    return {
      status: statuses.includes('loading') ? 'loading' : 'unavailable',
      denominator: null,
      counts: null,
      items: null,
    };
  const state: Readonly<DemoState> = source.state;
  const events = new Map<string, V10FirstResultItem>();
  const all: V10FirstResultItem[] = [];
  for (const sale of state.sales.filter((s) => s.type === 'opportunity')) {
    const view = selectSolutionWorkspace(state, sale.id, context.fileAvailability);
    const w = view.workspace,
      first = w?.firstFinalization;
    const projectIds = [...(source.projectIdsByOpportunity.get(sale.id) ?? [])];
    const problems: string[] = [];
    if (source.pendingSolutionIds.has(sale.id)) problems.push('方案来源身份冲突');
    if (first) {
      const matches = w!.finalizations.filter((e) => e.id === first.eventId);
      const event = matches.length === 1 ? matches[0] : null;
      if (
        !first.eventId?.trim() ||
        !event ||
        event.firstEventId !== first.eventId ||
        event.opportunityId !== sale.id ||
        event.sequence !== 1
      )
        problems.push('首次事件依据缺失或冲突');
      if (event) {
        try {
          const expected = selectFirstAchievement(event.deadlineSnapshot, event.confirmedAt);
          if (
            ['deadlineDate', 'businessDate', 'daysEarly', 'result', 'timezone'].some(
              (k) => expected[k as keyof typeof expected] !== first[k as keyof typeof first],
            )
          )
            problems.push('首次成绩与事件快照不一致');
        } catch {
          problems.push('首次事件日期无效');
        }
      }
    }
    const item: V10FirstResultItem = {
      id: first?.eventId ? `first:${first.eventId}` : `solution:${sale.id}`,
      eventId: first?.eventId ?? null,
      opportunityIds: [sale.id],
      projectIds,
      result: problems.length ? 'pending' : view.firstResult,
      deadlineDate: first?.deadlineDate ?? null,
      businessDate: first?.businessDate ?? null,
      owner:
        w?.finalizations.find((e) => e.id === first?.eventId)?.owner ?? w?.schedule?.owner ?? null,
      sourceHref: `/sales/detail/${encodeURIComponent(sale.id)}?tab=方案`,
      issues: problems,
    };
    const previous = first?.eventId ? events.get(first.eventId) : undefined;
    if (previous) {
      previous.opportunityIds.push(sale.id);
      previous.projectIds = [...new Set([...previous.projectIds, ...projectIds])].sort();
      previous.result = 'pending';
      previous.issues.push('同一首次事件指向多个商机，归属待核');
      previous.sourceHref = null;
    } else {
      all.push(item);
      if (first?.eventId) events.set(first.eventId, item);
    }
  }
  const counts: NonNullable<V10BoardBottom['firstFinalizations']['counts']> = {
    early: 0,
    'on-time': 0,
    late: 0,
    'historical-unscored': 0,
    'not-finalized': 0,
    pending: 0,
  };
  for (const item of all) counts[item.result]++;
  return {
    status: all.length ? 'ready' : 'empty',
    denominator: counts.early + counts['on-time'] + counts.late,
    counts,
    items: all
      .filter((i) => !filter || i.result === filter)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
