import type { DemoStore } from '../store';
import type { DemoState } from '../models';
import type {
  V9SolutionCommandInputs,
  V9OperationContext,
  V9CommandResult,
  V9ErrorCode,
  ProgressNodeApplicability,
} from '../v9-contracts';
import { knownDemoPersonId } from '../plan-person';
import { commandInputFingerprint } from '../v9-command-input';
export const OPTIONAL_EXECUTION_NODES = [
  { id: 'execution.design', label: '执行设计' },
  { id: 'execution.production', label: '生产' },
  { id: 'execution.fat', label: 'FAT' },
  { id: 'execution.shipment', label: '发货' },
  { id: 'execution.arrivalInstall', label: '到货安装' },
  { id: 'execution.sat', label: 'SAT' },
] as const;
export function selectNodeApplicability(state: Readonly<DemoState>, projectId: string) {
  return OPTIONAL_EXECUTION_NODES.map((n) => ({
    ...n,
    record: structuredClone(
      state.progressNodeApplicability?.find(
        (a) => a.projectId === projectId && a.nodeId === n.id,
      ) ?? null,
    ),
  }));
}
export function setNodeApplicability(
  store: DemoStore,
  input: V9SolutionCommandInputs['setNodeApplicability'],
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
  if (!store.v9CanEdit()) return reject('no-edit-right', '当前没有修改资格');
  const p = store.project(input.projectId);
  if (!p) return reject('field-invalid', '项目不存在');
  if (!OPTIONAL_EXECUTION_NODES.some((n) => n.id === input.nodeId))
    return reject('field-invalid', '该节点不能免做');
  const pmPersonId = p.pmPersonId ?? knownDemoPersonId(p.pm);
  if (
    !pmPersonId ||
    pmPersonId !== input.pmPersonId ||
    !input.reason.trim() ||
    !['applicable', 'not-required'].includes(input.applicability)
  )
    return reject('field-required', '需本项目业务PM、合法适用性及原因');
  const receipt = store
    .state()
    .v9CommandReceipts?.find(
      (r) =>
        r.command === 'setNodeApplicability' &&
        r.objectId === p.id &&
        r.operationId === context.operationId &&
        r.workspaceId === context.workspaceId &&
        r.roundId === context.roundId,
    );
  if (receipt)
    return receipt.fingerprint === commandInputFingerprint({ ...input })
      ? { ...structuredClone(receipt.result), status: 'unchanged' }
      : reject('operation-input-mismatch', '同操作号不能更改输入');
  const old = store
    .state()
    .progressNodeApplicability?.find((a) => a.projectId === p.id && a.nodeId === input.nodeId);
  if (old?.applicability === input.applicability)
    return {
      status: 'unchanged',
      objectId: p.id,
      revision: store.state().dataVersion ?? 1,
      value: { nodeId: input.nodeId },
      message: '适用性未变化',
    };
  const now = new Date().toISOString();
  const operator = {
    personId: knownDemoPersonId(store.person()) ?? `demo-role:${store.role()}`,
    name: store.person(),
  };
  const pm = { personId: pmPersonId, name: p.pm };
  const next: ProgressNodeApplicability = {
    projectId: p.id,
    nodeId: input.nodeId,
    applicability: input.applicability,
    reason: input.reason.trim(),
    pm,
    operator,
    confirmedAt: now,
    revision: (old?.revision ?? 0) + 1,
    history: [
      ...(old?.history ?? []),
      {
        id: `applicability:${JSON.stringify([p.id, input.nodeId, context.operationId])}`,
        applicability: input.applicability,
        reason: input.reason.trim(),
        operator,
        pm,
        confirmedAt: now,
      },
    ],
  };
  return store.commitV9Command(
    { ...context, command: 'setNodeApplicability', objectId: p.id, input: { ...input } },
    {
      object: { type: 'project', id: p.id },
      mainlineId: p.opportunityId,
      module: '执行',
      department: 'PM/PMO',
      section: '执行适用性',
      action: input.applicability === 'not-required' ? '确认无需执行' : '撤销无需执行',
      owner: { name: p.pm, personId: pmPersonId },
      changes: [
        {
          field: `progressNodeApplicability.${input.nodeId}`,
          valueType: 'string',
          before: old?.applicability ?? null,
          after: next.applicability,
        },
      ],
      change: (s) => {
        s.progressNodeApplicability = (s.progressNodeApplicability ?? []).filter(
          (a) => a.projectId !== p.id || a.nodeId !== input.nodeId,
        );
        s.progressNodeApplicability.push(next);
      },
      value: { nodeId: input.nodeId, revision: next.revision },
    },
  );
}
