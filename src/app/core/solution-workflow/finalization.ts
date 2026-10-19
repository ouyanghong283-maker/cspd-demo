import type { DemoState } from '../models';
import type { DemoStore } from '../store';
import { isClosed, isValidISODate } from '../rules';
import { knownDemoPersonId } from '../plan-person';
import { commandInputFingerprint } from '../v9-command-input';
import { createV9Dates } from '../v9-queries';
import { selectSolutionMigrationStatus } from '../solution-migration';
import { SOLUTION_OUTPUT_KINDS } from '../v9-contracts';
import type {
  FileAvailability,
  FinalizationEvent,
  FirstFinalization,
  SolutionOutputIds,
  V9CommandResult,
  V9ErrorCode,
  V9Issue,
  V9OperationContext,
  V9SolutionCommandInputs,
  V9Target,
} from '../v9-contracts';
import { checkSolutionFile, type SolutionFiles } from './files';

/** 与商机实际需求修订同源；不以工作区缓存覆盖当前需求。 */
export function solutionNeedRevision(
  state: Readonly<DemoState>,
  opportunityId: string,
): string | null {
  const sale = state.sales.find((s) => s.id === opportunityId && s.type === 'opportunity');
  const needs = sale?.productNeeds;
  return needs?.length &&
    new Set(needs.map((n) => n.id)).size === needs.length &&
    needs.every(
      (n) =>
        n.id && n.model.trim() && Number.isFinite(n.quantity) && n.quantity > 0 && n.unit.trim(),
    )
    ? String(sale!.productNeedRevision ?? 0)
    : null;
}
export function selectFirstAchievement(
  deadlineDate: string,
  confirmedAt: string,
): FirstFinalization {
  if (!isValidISODate(deadlineDate)) throw new Error('首次期限无效');
  const day = createV9Dates(confirmedAt, deadlineDate).solutionBusinessDate;
  const daysEarly = Math.round(
    (Date.parse(deadlineDate + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000,
  );
  return {
    eventId: '',
    deadlineDate,
    timezone: 'Asia/Shanghai',
    businessDate: day,
    daysEarly,
    result: daysEarly >= 7 ? 'early' : daysEarly < 0 ? 'late' : 'on-time',
  };
}
export function achievementLabel(first: FirstFinalization | null): string {
  return !first
    ? '未首次定稿'
    : first.result === 'early'
      ? `提前${first.daysEarly}天`
      : first.result === 'late'
        ? `逾期${-first.daysEarly}天`
        : '按时';
}
export function selectFinalizationSource(
  state: Readonly<DemoState>,
  opportunityId: string,
  availability: Readonly<Record<string, FileAvailability>> | null,
  target?: V9Target | null,
) {
  const workspaces =
    state.solutionWorkspaces?.filter((w) => w.opportunityId === opportunityId) ?? [];
  const w = workspaces.length === 1 ? workspaces[0] : null;
  const productNeedRevision = solutionNeedRevision(state, opportunityId);
  const issues: V9Issue[] = [];
  const add = (code: V9ErrorCode, message: string, field?: string) =>
    issues.push({ code, message, field });
  if (workspaces.length > 1 || !selectSolutionMigrationStatus(state, opportunityId).canFinalize)
    add('source-ambiguous', '当前方案来源歧义，请核对来源');
  if (!w?.schedule?.pm.personId) add('field-required', '业务PM待设置', 'pm');
  if (!w?.schedule?.owner.personId) add('field-required', '方案负责人待设置', 'owner');
  if (!w?.schedule || !isValidISODate(w.schedule.deadlineDate))
    add('field-required', '首次期限定稿日期待设置', 'deadline');
  if (productNeedRevision === null)
    add('field-invalid', '产品需求需填写型号、正数量和单位', 'productNeeds');
  const versions = SOLUTION_OUTPUT_KINDS.map((kind) => {
    const matches =
      w?.versions.filter(
        (v) =>
          v.id === w.currentOutputs[kind] && v.kind === kind && v.opportunityId === opportunityId,
      ) ?? [];
    const v = matches.length === 1 ? matches[0] : null;
    if (
      !v ||
      v.origin !== 'operation' ||
      !v.uploadEvidence ||
      v.contentState !== 'current' ||
      !v.file ||
      !v.uploadedAt ||
      !v.size
    )
      add(
        matches.length > 1 ? 'source-ambiguous' : 'file-missing',
        `${kind}需当前真实上传文件`,
        kind,
      );
    else if (
      target &&
      (v.file.workspaceId !== target.workspaceId || v.file.roundId !== target.roundId)
    )
      add('workspace-changed', `${kind}资料来自其他工作区或演示轮次，请在本工作区上传新版`, kind);
    else if (availability !== null) {
      const a = availability[v.id] ?? 'checking';
      if (a !== 'present')
        add(
          a === 'checking'
            ? 'file-checking'
            : a === 'missing'
              ? 'file-missing'
              : 'file-unavailable',
          `${kind}文件${a === 'missing' ? '缺失' : a === 'checking' ? '核验中' : '暂不可读'}`,
          kind,
        );
    }
    return v;
  });
  const fourVersionIds = SOLUTION_OUTPUT_KINDS.every((_, i) => versions[i])
    ? (Object.fromEntries(
        SOLUTION_OUTPUT_KINDS.map((kind, i) => [kind, versions[i]!.id]),
      ) as SolutionOutputIds)
    : null;
  const latest = w?.finalizations.at(-1) ?? null;
  const differences = SOLUTION_OUTPUT_KINDS.filter(
    (k) => latest?.fourVersionIds[k] !== w?.currentOutputs[k],
  );
  const same =
    !!latest && latest.productNeedRevision === productNeedRevision && !differences.length;
  return {
    opportunityId,
    historicalUnscored: !!w?.legacyFacts.length && !w.firstFinalization,
    productNeedRevision,
    fourVersionIds,
    versions: structuredClone(versions),
    schedule: structuredClone(w?.schedule ?? null),
    first: structuredClone(w?.firstFinalization ?? null),
    events: structuredClone(w?.finalizations ?? []),
    current: same ? structuredClone(latest) : null,
    status: (!latest ? 'missing' : same ? 'current' : 'stale') as 'missing' | 'current' | 'stale',
    differences,
    requirementChanged: !!latest && latest.productNeedRevision !== productNeedRevision,
    issues,
  };
}
/** 页面只提交核对过的组合，时间由系统取得；文件边界可替换用于故障验证。 */
export async function finalizeSolution(
  store: DemoStore,
  input: V9SolutionCommandInputs['finalizeSolution'],
  context: V9OperationContext,
  files: SolutionFiles,
): Promise<V9CommandResult> {
  const reject = (code: V9ErrorCode, message: string): V9CommandResult => ({
    status: 'rejected',
    objectId: input.opportunityId,
    issue: { code, message },
    message,
  });
  const guard = () => {
    const t = store.v9CommandTarget();
    return t?.workspaceId !== context.workspaceId || t.roundId !== context.roundId
      ? reject('workspace-changed', '工作区或轮次已变化')
      : !store.v9CanEdit()
        ? reject('no-edit-right', '当前没有修改资格')
        : null;
  };
  const denied = guard();
  if (denied) return denied;
  const sale = store.sale(input.opportunityId);
  if (!sale || sale.type !== 'opportunity') return reject('field-invalid', '商机不存在');
  if (isClosed(sale)) return reject('business-readonly', '已关闭商机只读');
  const request = {
    ...context,
    command: 'finalizeSolution',
    objectId: input.opportunityId,
    input: { ...input, fourVersionIds: { ...input.fourVersionIds } },
  };
  const receipt = store
    .state()
    .v9CommandReceipts?.find(
      (r) =>
        r.command === request.command &&
        r.objectId === request.objectId &&
        r.operationId === context.operationId &&
        r.workspaceId === context.workspaceId &&
        r.roundId === context.roundId,
    );
  if (receipt)
    return receipt.fingerprint === commandInputFingerprint(request.input)
      ? { ...structuredClone(receipt.result), status: 'unchanged' }
      : reject('operation-input-mismatch', '同操作号不能更改确认摘要');
  const before = selectFinalizationSource(store.state(), input.opportunityId, {});
  const scheduleFingerprint = JSON.stringify(before.schedule);
  const availability = Object.fromEntries(
    await Promise.all(
      before.versions
        .filter((v) => v !== null)
        .map(async (v) => [v.id, await checkSolutionFile(files, v)] as const),
    ),
  );
  const afterGuard = guard();
  if (afterGuard) return afterGuard;
  const currentSale = store.sale(input.opportunityId);
  if (!currentSale || isClosed(currentSale)) return reject('business-readonly', '商机已变化或关闭');
  // 异步核验后重新读幂等收据：重复点击只会有一次提交。
  const repeated = store
    .state()
    .v9CommandReceipts?.find(
      (r) =>
        r.command === request.command &&
        r.objectId === request.objectId &&
        r.operationId === context.operationId &&
        r.workspaceId === context.workspaceId &&
        r.roundId === context.roundId,
    );
  if (repeated)
    return repeated.fingerprint === commandInputFingerprint(request.input)
      ? { ...structuredClone(repeated.result), status: 'unchanged' }
      : reject('operation-input-mismatch', '同操作号不能更改输入');
  const source = selectFinalizationSource(store.state(), input.opportunityId, availability);
  if (
    JSON.stringify(source.schedule) !== scheduleFingerprint ||
    !source.fourVersionIds ||
    commandInputFingerprint(source.fourVersionIds) !==
      commandInputFingerprint(input.fourVersionIds) ||
    source.productNeedRevision !== input.productNeedRevision ||
    source.schedule?.owner.personId !== input.ownerPersonId ||
    source.schedule?.revision !== input.scheduleRevision
  )
    return reject('revision-mismatch', '资料、需求或期限责任已变化，请重新核对摘要');
  if (
    source.versions.some(
      (v) =>
        v?.file &&
        (v.file.workspaceId !== context.workspaceId || v.file.roundId !== context.roundId),
    )
  )
    return reject('workspace-changed', '当前资料不属于本工作区与轮次，请上传新版');
  if (source.issues.length)
    return reject(source.issues[0].code, source.issues.map((i) => i.message).join('；'));
  if (store.person() !== source.schedule!.owner.name && !input.actingOnBehalf)
    return reject('field-required', '请明确确认代方案负责人办理，记录实际操作者');
  const existing = source.events.find(
    (e) =>
      e.productNeedRevision === input.productNeedRevision &&
      commandInputFingerprint(e.fourVersionIds) === commandInputFingerprint(input.fourVersionIds),
  );
  if (existing)
    return {
      status: 'unchanged',
      objectId: input.opportunityId,
      revision: store.state().dataVersion ?? 1,
      value: { finalizationId: existing.id },
      message: '此资料与需求组合已定稿',
    };
  const w = structuredClone(
    store.state().solutionWorkspaces!.find((w) => w.opportunityId === input.opportunityId)!,
  );
  const id =
    'finalization:' +
    JSON.stringify([
      context.workspaceId,
      context.roundId,
      input.opportunityId,
      context.operationId,
    ]);
  const event: FinalizationEvent = {
    id,
    opportunityId: input.opportunityId,
    sequence: w.finalizations.length + 1,
    firstEventId: w.firstFinalization?.eventId ?? id,
    fourVersionIds: { ...input.fourVersionIds },
    versionMetadataSnapshot: source.versions.map((v) => structuredClone(v!)),
    productNeedRevision: input.productNeedRevision,
    owner: { ...source.schedule!.owner },
    pm: { ...source.schedule!.pm },
    timezone: 'Asia/Shanghai',
    operator: {
      personId: knownDemoPersonId(store.person()) ?? `demo-role:${store.role()}`,
      name: store.person(),
    },
    confirmedAt: new Date().toISOString(),
    deadlineSnapshot: source.schedule!.deadlineDate,
    scheduleRevision: source.schedule!.revision,
    origin: 'operation',
  };
  w.finalizations.push(event);
  w.productNeedRevision = input.productNeedRevision;
  w.revision++;
  if (!w.firstFinalization) {
    w.firstFinalization = {
      ...selectFirstAchievement(event.deadlineSnapshot, event.confirmedAt),
      eventId: id,
    };
    w.schedule!.frozenByEventId = id;
  }
  return store.commitV9Command(request, {
    object: { type: 'opportunity', id: input.opportunityId },
    mainlineId: input.opportunityId,
    module: '方案',
    department: '解决方案',
    section: '方案定稿',
    action: event.sequence === 1 ? '首次定稿' : '重新定稿',
    owner: { name: event.owner.name, personId: event.owner.personId },
    taskSource: { kind: 'solution-finalization', id },
    changes: [
      {
        field: 'solution.finalization',
        valueType: 'string',
        before: source.events.at(-1)?.id ?? null,
        after: id,
      },
    ],
    change: (s) => {
      s.solutionWorkspaces = s.solutionWorkspaces!.map((x) =>
        x.opportunityId === input.opportunityId ? w : x,
      );
    },
    value: { finalizationId: id, firstEventId: event.firstEventId },
  });
}
