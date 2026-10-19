import { isClosed } from '../rules';
import { knownDemoPersonId } from '../plan-person';
import type { DemoState } from '../models';
import type { DemoStore } from '../store';
import { SOLUTION_OUTPUT_KINDS } from '../v9-contracts';
import type {
  FileAvailability,
  SolutionOutputKind,
  SolutionOutputVersion,
  SolutionWorkspace,
  V9CommandResult,
  V9ErrorCode,
  V9OperationContext,
  V9Person,
} from '../v9-contracts';

export function emptySolutionWorkspace(opportunityId: string): SolutionWorkspace {
  return {
    id: `solution:${opportunityId}`,
    opportunityId,
    revision: 0,
    productNeedRevision: null,
    versions: [],
    currentOutputs: {},
    schedule: null,
    scheduleChanges: [],
    finalizations: [],
    firstFinalization: null,
    legacyFacts: [],
  };
}
export interface RegisterSolutionVersionInput {
  opportunityId: string;
  kind: SolutionOutputKind;
  fileName: string;
  size: number;
  mime: string;
  blobId: string;
  owner: V9Person | null;
  note: string;
}
/** 04-01受控存在性接缝；真实Blob设施由03-01提供，页面不得直接调用受控环境。 */
export function registerSolutionVersion(
  store: DemoStore,
  input: RegisterSolutionVersionInput,
  context: V9OperationContext,
  environment: { availability: FileAvailability; now: string },
): V9CommandResult {
  const reject = (code: V9ErrorCode, message: string): V9CommandResult => ({
    status: 'rejected',
    objectId: input.opportunityId,
    issue: { code, message },
    message,
  });
  const sale = store.sale(input.opportunityId);
  if (!sale || sale.type !== 'opportunity') return reject('field-invalid', '商机不存在');
  if (isClosed(sale)) return reject('business-readonly', '已关闭商机只读');
  if (
    !SOLUTION_OUTPUT_KINDS.includes(input.kind) ||
    !input.fileName?.trim() ||
    !input.blobId?.trim() ||
    (input.owner !== null && (!input.owner?.personId?.trim() || !input.owner.name?.trim())) ||
    !Number.isSafeInteger(input.size) ||
    input.size < 0 ||
    !Number.isFinite(Date.parse(environment.now))
  )
    return reject('field-invalid', '资料类别、文件元数据、责任人与时间必须合法');
  const request = {
    ...context,
    command: 'registerSolutionVersion',
    objectId: input.opportunityId,
    input: { ...input, owner: input.owner ? { ...input.owner } : null },
  };
  // 已提交重试先交统一入口复用收据，不因外部文件后来不可读而伪造新失败。
  const retry = store
    .state()
    .v9CommandReceipts?.some(
      (r) =>
        r.command === request.command &&
        r.objectId === request.objectId &&
        r.operationId === request.operationId &&
        r.workspaceId === request.workspaceId &&
        r.roundId === request.roundId,
    );
  if (!retry && environment.availability !== 'present')
    return reject(
      environment.availability === 'checking'
        ? 'file-checking'
        : environment.availability === 'missing'
          ? 'file-missing'
          : 'file-unavailable',
      '文件尚未确认可读，未登记版本',
    );
  const old = store
    .state()
    .solutionWorkspaces?.find((w) => w.opportunityId === input.opportunityId);
  const workspace = structuredClone(old ?? emptySolutionWorkspace(input.opportunityId));
  const previousId = workspace.currentOutputs[input.kind] ?? null;
  const number =
    Math.max(0, ...workspace.versions.filter((v) => v.kind === input.kind).map((v) => v.number)) +
    1;
  const id = solutionVersionId(input.opportunityId, input.kind, context);
  const version: SolutionOutputVersion = {
    id,
    opportunityId: input.opportunityId,
    kind: input.kind,
    number,
    documentId: null,
    fileName: input.fileName,
    size: input.size,
    mime: input.mime,
    uploadedAt: environment.now,
    owner: structuredClone(input.owner),
    operator: {
      personId: knownDemoPersonId(store.person()) ?? `demo-role:${store.role()}`,
      name: store.person(),
    },
    note: input.note,
    origin: 'operation',
    uploadEvidence: context.operationId,
    contentState: 'current',
    file: {
      workspaceId: context.workspaceId,
      roundId: context.roundId,
      versionId: id,
      blobId: input.blobId,
    },
    supersedesVersionId: previousId,
  };
  const reclaimCandidates = workspace.versions
    .filter((v) => v.kind === input.kind && v.file)
    .map((v) => v.file!);
  for (const v of workspace.versions)
    if (v.kind === input.kind) {
      v.contentState = 'metadataOnly';
      v.file = null;
    }
  workspace.versions.push(version);
  workspace.currentOutputs[input.kind] = id;
  workspace.revision++;
  return store.commitV9Command(request, {
    object: { type: 'opportunity', id: input.opportunityId },
    mainlineId: input.opportunityId,
    module: '方案',
    department: '解决方案',
    section: '四类资料',
    action: '登记资料版本',
    owner: { name: input.owner?.name ?? '负责人待指定', personId: input.owner?.personId },
    taskSource: { kind: 'solution-version', id },
    changes: [
      { field: `currentOutputs.${input.kind}`, valueType: 'string', before: previousId, after: id },
    ],
    change: (state) => {
      state.solutionWorkspaces ??= [];
      const index = state.solutionWorkspaces.findIndex(
        (w) => w.opportunityId === input.opportunityId,
      );
      if (index < 0) state.solutionWorkspaces.push(workspace);
      else state.solutionWorkspaces[index] = workspace;
    },
    value: {
      versionId: id,
      number,
      supersedesVersionId: previousId,
      reclaimCandidates: reclaimCandidates.map((r) => ({ ...r })),
    },
  });
}
export function selectSolutionVersions(
  state: Readonly<DemoState>,
  opportunityId: string,
  kind: SolutionOutputKind,
) {
  const w = state.solutionWorkspaces?.find((w) => w.opportunityId === opportunityId);
  const currentId = w?.currentOutputs[kind];
  return {
    current: structuredClone(w?.versions.find((v) => v.id === currentId) ?? null),
    history: structuredClone(
      w?.versions.filter((v) => v.kind === kind && v.id !== currentId) ?? [],
    ),
  };
}

export function solutionVersionId(
  opportunityId: string,
  kind: SolutionOutputKind,
  context: V9OperationContext,
): string {
  return `solution-version:${JSON.stringify([context.workspaceId, context.roundId, opportunityId, kind, context.operationId])}`;
}
