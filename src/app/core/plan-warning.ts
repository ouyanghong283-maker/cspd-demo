import { DemoState, Notice, Plan, Project, Role, ROLES } from './models';
import { observationDateForMode } from './rules';
import { collectPlanWarnings, isPlanWarningRead, planWarningId } from './plan-warnings';
import { knownProjectPersonId } from './plan-person';
export { knownDemoPersonId, knownProjectPersonId } from './plan-person';

export interface PlanWarning {
  level: 'yellow' | 'red';
  label: string;
  recipients: string[];
  read: boolean;
}

export function planWarningRecipients(project: Project, plan: Plan): string[] {
  return [
    knownProjectPersonId(project, plan.owner, plan.ownerPersonId),
    knownProjectPersonId(project, project.pm, project.pmPersonId),
  ].filter((id, index, all): id is string => !!id && all.indexOf(id) === index);
}

export function planWarningIdentityGaps(project: Project, plan: Plan): string[] {
  return [
    !knownProjectPersonId(project, plan.owner, plan.ownerPersonId) ? '计划负责人' : '',
    !knownProjectPersonId(project, project.pm, project.pmPersonId) ? '项目PM' : '',
  ].filter(Boolean);
}

export function currentPlanWarning(
  state: DemoState,
  project: Project,
  plan: Plan,
  observationDate: string,
  reader?: string,
): PlanWarning | undefined {
  const warning = collectPlanWarnings(state, observationDate).find(
    (item) => item.projectId === project.id && item.planId === plan.id,
  );
  if (!warning || !warning.recipients.length) return undefined;
  const recipients = warning.recipients.map((item) => item.personKey);
  const personId = reader ? knownProjectPersonId(project, reader) : undefined;
  if (reader && (!personId || !recipients.includes(personId))) return undefined;
  return {
    level: warning.level,
    label: warning.label,
    recipients,
    read: !!personId && isPlanWarningRead(state, personId, warning.id),
  };
}

/** Recomputed notices share the plan identity; only acknowledgement is persisted. */
export function collectPlanWarningNotices(state: DemoState, reader: string, role: Role): Notice[] {
  const date = observationDateForMode(state.dateMode || 'normal');
  const sources = new Map(
    state.projects.flatMap((project) =>
      project.plans.map((plan) => [planWarningId(project.id, plan.id), { project, plan }] as const),
    ),
  );
  return collectPlanWarnings(state, date).flatMap((warning) => {
    const source = sources.get(warning.id)!;
    const personKey = knownProjectPersonId(source.project, reader);
    if (!personKey || !warning.recipients.some((recipient) => recipient.personKey === personKey))
      return [];
    return [
      {
        id: warning.id,
        key: warning.id,
        entityId: warning.projectId,
        planId: warning.planId,
        role,
        title: `${warning.label}：${warning.planName}`,
        text: `${warning.projectName} · 计划结束 ${warning.basisDate} · ${warning.owner || '负责人待补'}`,
        read: isPlanWarningRead(state, personKey, warning.id),
        resolved: false,
        date,
        href: planTarget(warning.projectId, source.plan),
      },
    ];
  });
}

export function planTarget(projectId: string, plan: Plan): string {
  return `/projects/${encodeURIComponent(projectId)}?tab=plans&plan=${encodeURIComponent(plan.type)}&focus=${encodeURIComponent(plan.id)}`;
}

export function isSupersededPlanNotice(state: DemoState, notice: Notice): boolean {
  if (!notice.key.startsWith('v4-milestone-')) return false;
  return !!state.projects
    .find((project) => project.id === notice.entityId)
    ?.plans.some(
      (plan) =>
        (plan.type === '内部WBS' || plan.type === '客户主节点') &&
        notice.key === `v4-milestone-${notice.entityId}-${plan.id}`,
    );
}

/** Preserve acknowledgements from the local optimization snapshot when joining the published schema. */
export function normalizePlanWarningReads(
  state: DemoState,
): NonNullable<DemoState['planWarningReads']> {
  const seen = new Set<string>();
  return (state.planWarningReads || [])
    .map((record) => {
      if (record.personKey && record.warningId) return record;
      const projectId = Reflect.get(record, 'projectId');
      const planId = Reflect.get(record, 'planId');
      const personId = Reflect.get(record, 'personId');
      if (
        typeof projectId !== 'string' ||
        typeof planId !== 'string' ||
        typeof personId !== 'string'
      )
        return record;
      const project = state.projects.find((item) => item.id === projectId);
      return {
        personKey: project ? knownProjectPersonId(project, '', personId) || personId : personId,
        warningId: planWarningId(projectId, planId),
        readAt: record.readAt,
      };
    })
    .filter((record) => {
      const key = JSON.stringify([record.personKey, record.warningId]);
      if (!record.personKey || !record.warningId) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
