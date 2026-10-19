import type { DemoState } from '../models';
import type { V10QueryContext, V10SourceIssue, V10SourceStatus } from '../v10-contracts';
import { selectV10ProjectIdentity, issue } from './identity';
import { indexById, stableId } from './identity-index';

/** 来源冲突不任取一条；完全相同的重复事项只保留一个。 */
export function readManagementSources(state: Readonly<DemoState>, context: V10QueryContext) {
  const identity = selectV10ProjectIdentity(state, context);
  const issues = [...identity.issues];
  const invalidContext = issues.some(
    (i) => i.objectType === 'context' && ['revision', 'dates'].includes(i.field),
  );
  const status = (
    domain: keyof V10QueryContext['sources'],
    populated: boolean,
  ): V10SourceStatus => {
    if (invalidContext) return 'unavailable';
    const declared = context.sources[domain] ?? 'ready';
    if (declared === 'empty' && populated) {
      issues.push(issue('context', null, 'conflicting', domain, '来源声明为空但快照包含记录'));
      return 'unavailable';
    }
    return declared;
  };
  function unique<T extends { id: string }>(
    rows: readonly T[],
    type: V10SourceIssue['objectType'],
    field: string,
    allowIdentical = false,
    parentId?: string,
  ): T[] {
    const good: T[] = [];
    for (const [id, matches] of indexById(rows)) {
      if (
        matches.length === 1 ||
        (allowIdentical && matches.every((r) => JSON.stringify(r) === JSON.stringify(matches[0])))
      )
        good.push(matches[0]);
      else
        issues.push(
          issue(
            type,
            parentId ?? id,
            parentId ? 'conflicting' : 'ambiguous',
            parentId ? `${field}:${id}` : field,
            '稳定来源ID冲突，未选用其中任何一条',
          ),
        );
    }
    if (rows.some((r) => !stableId(r.id)))
      issues.push(issue(type, parentId ?? null, 'missing', field, '来源缺少稳定ID'));
    return good;
  }
  const projectStatus = status('projects', state.projects.length > 0);
  const opportunityStatus = status(
    'opportunities',
    state.sales.some((s) => s.type === 'opportunity'),
  );
  const solutionStatus = status(
    'solutions',
    (state.solutionWorkspaces?.length ?? 0) > 0 ||
      (state.solutionSeries?.length ?? 0) > 0 ||
      (state.solutionDocuments?.length ?? 0) > 0,
  );
  const workStatus = status(
    'workItems',
    state.projects.some((p) => p.plans.length > 0) ||
      state.sales.some((s) => s.departmentTasks?.length) ||
      state.projects.some((p) => p.briefing.startupHandover?.status === '待移交') ||
      (state.solutionWorkspaces ?? []).some((w) => !!w.schedule || !!w.firstFinalization),
  );
  const readable = (s: V10SourceStatus) => s === 'ready' || s === 'empty';
  const sales = readable(opportunityStatus)
    ? unique(state.sales, 'opportunity', 'id').map((s) => ({
        ...s,
        departmentTasks: unique(
          s.departmentTasks ?? [],
          'opportunity',
          `departmentTasks:${s.id}`,
          true,
          s.id,
        ),
      }))
    : [];
  const projects = readable(projectStatus)
    ? unique(state.projects, 'project', 'id').map((p) => ({
        ...p,
        plans: unique(p.plans, 'project', `plans:${p.id}`, true, p.id),
      }))
    : [];
  const solutionWorkspaces = readable(solutionStatus)
    ? unique(state.solutionWorkspaces ?? [], 'opportunity', 'solutionWorkspaces').filter((w) => {
        const count = (state.solutionWorkspaces ?? []).filter(
          (other) => other.opportunityId === w.opportunityId,
        ).length;
        if (count === 1 && sales.some((s) => s.type === 'opportunity' && s.id === w.opportunityId))
          return true;
        issues.push(
          issue(
            'opportunity',
            w.opportunityId,
            'ambiguous',
            'solutionWorkspaces',
            '方案与商机归属缺失或冲突',
          ),
        );
        return false;
      })
    : [];
  const pendingSolutionIds = new Set(
    (state.solutionWorkspaces ?? [])
      .filter((w) => !solutionWorkspaces.some((g) => g.opportunityId === w.opportunityId))
      .map((w) => w.opportunityId),
  );
  const projectIdsByOpportunity = new Map<string, string[]>();
  for (const p of identity.customers?.flatMap((g) => g.projects) ?? []) {
    if (!p.projectId || !p.opportunityId) continue;
    const ids = projectIdsByOpportunity.get(p.opportunityId) ?? [];
    ids.push(p.projectId);
    projectIdsByOpportunity.set(p.opportunityId, ids.sort());
  }
  return {
    projectIdsByOpportunity,
    state: { ...state, sales, projects, solutionWorkspaces },
    pendingSolutionIds,
    issues,
    projectStatus,
    opportunityStatus,
    solutionStatus,
    workStatus,
    readable,
  };
}
