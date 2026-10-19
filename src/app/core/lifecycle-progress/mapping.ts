import { selectProjectCompletionFacts } from './project-completion';
import { completionKind } from '../project-review';
import type { DemoStore } from '../store';
import type { DemoState, Plan } from '../models';
import type {
  ProgressGroupId,
  V9CommandResult,
  V9OperationContext,
  V9SolutionCommandInputs,
  V9ErrorCode,
} from '../v9-contracts';
import { commandInputFingerprint } from '../v9-command-input';
import { knownDemoPersonId } from '../plan-person';
import { isValidISODate } from '../rules';
export const PROGRESS_GROUPS: readonly {
  id: ProgressGroupId;
  nodeId: string;
  label: string;
  weight: number;
}[] = [
  { id: 'design', nodeId: 'execution.design', label: '执行设计', weight: 5 },
  { id: 'production', nodeId: 'execution.production', label: '生产', weight: 15 },
  { id: 'shipping', nodeId: 'execution.shipment', label: '发货', weight: 5 },
  { id: 'arrival-installation', nodeId: 'execution.arrivalInstall', label: '到货安装', weight: 8 },
];
export function confirmProgressMapping(
  store: DemoStore,
  input: V9SolutionCommandInputs['confirmProgressMapping'],
  context: V9OperationContext,
): V9CommandResult {
  const reject = (code: V9ErrorCode, message: string): V9CommandResult => ({
    status: 'rejected',
    objectId: input.projectId,
    issue: { code, message },
    message,
  });
  const t = store.v9CommandTarget();
  if (t?.workspaceId !== context.workspaceId || t.roundId !== context.roundId)
    return reject('workspace-changed', '工作区或轮次已变化');
  if (!store.v9CanEdit()) return reject('no-edit-right', '请由PM或授权代办确认关联');
  const p = store.project(input.projectId);
  if (!p) return reject('field-invalid', '项目不存在');
  if (!PROGRESS_GROUPS.some((g) => g.id === input.groupId) || !input.reason.trim())
    return reject('field-invalid', '请选择固定任务组并填写原因');
  const planIds = [...new Set(input.planIds)];
  const normalized = { ...input, planIds };
  const request = {
    ...context,
    command: 'confirmProgressMapping',
    objectId: p.id,
    input: normalized,
  };
  const receipt = store
    .state()
    .v9CommandReceipts?.find(
      (r) =>
        r.command === request.command &&
        r.objectId === p.id &&
        r.operationId === context.operationId &&
        r.workspaceId === context.workspaceId &&
        r.roundId === context.roundId,
    );
  if (receipt)
    return receipt.fingerprint === commandInputFingerprint(normalized)
      ? { ...structuredClone(receipt.result), status: 'unchanged' }
      : reject('operation-input-mismatch', '同操作号不能更改输入');
  const mappings = store.state().progressGroupMappings ?? [];
  const old = mappings.find((m) => m.projectId === p.id && m.groupId === input.groupId);
  if ((old?.revision ?? 0) !== input.expectedMappingRevision)
    return reject('revision-mismatch', '任务组已更新，请重新确认');
  if (
    !planIds.length ||
    planIds.some((id) => p.plans.filter((x) => x.id === id && x.status !== '已取消').length !== 1)
  )
    return reject('field-invalid', '请选择本项目有效稳定任务，空组不能确认为完成');
  if (
    mappings.some(
      (m) =>
        m.projectId === p.id &&
        m.groupId !== input.groupId &&
        m.planIds.some((id) => planIds.includes(id)),
    )
  )
    return reject('field-invalid', '同一任务不能重复归入不同计分组');
  const id = old?.id ?? `progress-group:${p.id}:${input.groupId}`;
  const revision = (old?.revision ?? 0) + 1;
  const next = {
    id,
    projectId: p.id,
    groupId: input.groupId,
    planIds,
    sourceTemplateId: null,
    revision,
    history: [
      ...(old?.history ?? []),
      {
        id: `${id}:${revision}`,
        fromPlanIds: [...(old?.planIds ?? [])],
        toPlanIds: planIds,
        reason: input.reason.trim(),
        operator: {
          personId: knownDemoPersonId(store.person()) ?? `demo-role:${store.role()}`,
          name: store.person(),
        },
        changedAt: new Date().toISOString(),
      },
    ],
  };
  return store.commitV9Command(request, {
    object: { type: 'project', id: p.id },
    mainlineId: p.opportunityId,
    module: '执行',
    department: 'PM/PMO',
    section: '任务组关联',
    action: '确认固定任务组',
    owner: { name: p.pm, personId: p.pmPersonId },
    changes: [
      {
        field: `progressGroupMappings.${input.groupId}`,
        valueType: 'string',
        before: JSON.stringify(old?.planIds ?? []),
        after: JSON.stringify(planIds),
      },
    ],
    recordUnchangedAction: true,
    taskSource: { kind: 'progress-mapping', id },
    change: (s) => {
      s.progressGroupMappings = (s.progressGroupMappings ?? []).filter(
        (m) => !(m.projectId === p.id && m.groupId === input.groupId),
      );
      s.progressGroupMappings.push(next);
    },
    value: { mappingId: id, mappingRevision: revision },
  });
}
export function completedPlan(state: Readonly<DemoState>, projectId: string, p: Plan): boolean {
  if (p.status !== '已完成' || !isValidISODate(p.actual)) return false;
  const project = state.projects.find((x) => x.id === projectId);
  const has = (kind: string) =>
    state.attachments.some((a) => a.entityId === projectId && a.kind === kind);
  if (p.type === 'FAT测试') return p.result === '合格' && has('FAT报告');
  if (!project) return false;
  const kind = completionKind(p);
  if (kind) {
    const facts = selectProjectCompletionFacts(state, project);
    return kind === 'briefing'
      ? facts.startup
      : kind === 'sat'
        ? facts.sat
        : kind === 'acceptance'
          ? facts.acceptance
          : facts.serviceHandover;
  }
  return true;
}
export function selectProgressMapping(state: Readonly<DemoState>, projectId: string) {
  const project = state.projects.find((p) => p.id === projectId);
  return {
    projectId,
    options: structuredClone(project?.plans.filter((p) => p.status !== '已取消') ?? []),
    groups: PROGRESS_GROUPS.map((g) => {
      const mapping = state.progressGroupMappings?.find(
        (m) => m.projectId === projectId && m.groupId === g.id,
      );
      const ids = mapping?.planIds ?? [];
      const members = ids.map((id) => project?.plans.find((p) => p.id === id));
      const pending = !mapping || !ids.length || members.some((p) => !p || p.status === '已取消');
      const done = pending ? 0 : members.filter((p) => completedPlan(state, projectId, p!)).length;
      return {
        ...g,
        groupId: g.id,
        planIds: [...ids],
        revision: mapping?.revision ?? 0,
        history: structuredClone(mapping?.history ?? []),
        pending,
        done,
        total: ids.length,
      };
    }),
  };
}
