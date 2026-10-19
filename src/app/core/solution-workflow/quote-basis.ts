import type { DemoStore } from '../store';
import type { DemoState } from '../models';
import type {
  FileAvailability,
  QuoteSolutionBasisView,
  V9CommandResult,
  V9ErrorCode,
  V9OperationContext,
  V9SolutionCommandInputs,
  V9Target,
} from '../v9-contracts';
import { selectFinalizationSource } from './finalization';
import { checkSolutionFile, type SolutionFiles } from './files';
import { commandInputFingerprint } from '../v9-command-input';
import { knownDemoPersonId } from '../plan-person';
import { isClosed } from '../rules';
export function selectQuoteSolutionBasis(
  state: Readonly<DemoState>,
  quoteVersionId: string,
  availability: Readonly<Record<string, FileAvailability>> | null,
  target?: V9Target | null,
): QuoteSolutionBasisView {
  const matches = (state.quoteSeries ?? []).flatMap((s) =>
    s.versions.filter((v) => v.id === quoteVersionId).map((v) => ({ series: s, quote: v })),
  );
  const found = matches.length === 1 ? matches[0] : null;
  const source = selectFinalizationSource(state, found?.series.opportunityId ?? '', null, target);
  // 已采用组合的业务有效性按身份复核；字节缺失另列异常，不撤销既往采用。
  const fileIssues =
    availability === null
      ? []
      : selectFinalizationSource(
          state,
          found?.series.opportunityId ?? '',
          availability,
          target,
        ).issues.filter((i) =>
          ['file-checking', 'file-missing', 'file-unavailable'].includes(i.code),
        );
  const basis = found?.quote.solutionBasis ?? null;
  const historical = !!found && !['草稿', '退回补充'].includes(found.quote.status);
  const same =
    !!basis &&
    basis.opportunityId === found?.series.opportunityId &&
    basis.finalizationId === source.current?.id &&
    basis.productNeedRevision === source.productNeedRevision &&
    commandInputFingerprint({ ...basis.fourVersionIds }) ===
      commandInputFingerprint(source.fourVersionIds);
  const differences = source.issues.slice();
  if (!source.current || source.current.origin !== 'operation')
    differences.push({
      code: 'finalization-stale',
      message: '缺少当前有效真实定稿，请先完成方案定稿',
    });
  if (
    found &&
    found.quote.customerId !==
      state.sales.find((s) => s.id === found.series.opportunityId)?.customerId
  )
    differences.push({ code: 'source-ambiguous', message: '报价客户与商机归属不一致' });
  if (basis && !same)
    differences.push({
      code: 'finalization-stale',
      message: '采用依据与当前资料或需求不一致，请重新定稿后采用',
    });
  if (!basis) differences.push({ code: 'field-required', message: '报价尚未显式采用方案定稿' });
  if (!found) differences.push({ code: 'source-ambiguous', message: '报价来源不存在或歧义' });
  return {
    quoteVersionId,
    availableFinalization: source.current,
    adoptedBasis: structuredClone(basis),
    status: historical ? 'historical' : !basis ? 'not-adopted' : same ? 'current' : 'stale',
    differences,
    fileIssues,
    canSubmit: !historical && !!basis && same && !differences.length,
    submitIssues: differences,
  };
}
export async function adoptQuoteSolutionBasis(
  store: DemoStore,
  input: V9SolutionCommandInputs['adoptQuoteSolutionBasis'],
  context: V9OperationContext,
  files: SolutionFiles,
): Promise<V9CommandResult> {
  const reject = (code: V9ErrorCode, message: string): V9CommandResult => ({
    status: 'rejected',
    objectId: input.quoteVersionId,
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
  const request = {
    ...context,
    command: 'adoptQuoteSolutionBasis',
    objectId: input.quoteVersionId,
    input: { ...input },
  };
  const receipt = () =>
    store
      .state()
      .v9CommandReceipts?.find(
        (r) =>
          r.command === request.command &&
          r.objectId === request.objectId &&
          r.operationId === context.operationId &&
          r.workspaceId === context.workspaceId &&
          r.roundId === context.roundId,
      );
  const oldReceipt = receipt();
  if (oldReceipt)
    return oldReceipt.fingerprint === commandInputFingerprint({ ...input })
      ? { ...structuredClone(oldReceipt.result), status: 'unchanged' }
      : reject('operation-input-mismatch', '同操作号不能更改输入');
  const matches = (store.state().quoteSeries ?? []).flatMap((s) =>
    s.versions.filter((q) => q.id === input.quoteVersionId).map((q) => ({ series: s, quote: q })),
  );
  if (matches.length !== 1) return reject('source-ambiguous', '报价身份不存在或歧义');
  const { series, quote } = matches[0];
  const businessGuard = (): V9CommandResult | null => {
    const currentMatches = (store.state().quoteSeries ?? []).flatMap((s) =>
      s.versions.filter((q) => q.id === input.quoteVersionId).map((q) => ({ series: s, quote: q })),
    );
    if (
      currentMatches.length !== 1 ||
      currentMatches[0].series.id !== series.id ||
      currentMatches[0].series.opportunityId !== series.opportunityId
    )
      return reject('source-ambiguous', '报价业务归属已变化或歧义');
    const currentQuote = currentMatches[0].quote;
    const currentSale = store.sale(series.opportunityId);
    if (!currentSale || currentQuote.customerId !== currentSale.customerId)
      return reject('source-ambiguous', '报价客户与商机归属不一致');
    if (
      isClosed(currentSale) ||
      store.successfulLowPriceApproval(currentQuote) ||
      !['草稿', '退回补充'].includes(currentQuote.status)
    )
      return reject('business-readonly', '仅开放商机的报价草稿可采用');
    return null;
  };
  const initialBusinessGuard = businessGuard();
  if (initialBusinessGuard) return initialBusinessGuard;
  if ((store.quoteVersion(input.quoteVersionId)?.contentRevision ?? 0) !== input.quoteRevision)
    return reject('revision-mismatch', '报价或业务已更新，请重新核对采用摘要');
  if (
    store
      .state()
      .solutionLegacyAliases?.some(
        (a) =>
          a.opportunityId === series.opportunityId &&
          a.legacyId === quote.id &&
          a.status === 'ambiguous',
      )
  )
    return reject('source-ambiguous', '该报价旧引用存在歧义，请先核对来源');
  const source = selectFinalizationSource(store.state(), series.opportunityId, {});
  const availability = Object.fromEntries(
    await Promise.all(
      source.versions
        .filter((v) => v !== null)
        .map(async (v) => [v.id, await checkSolutionFile(files, v)] as const),
    ),
  );
  const after = guard();
  if (after) return after;
  const committed = receipt();
  if (committed)
    return committed.fingerprint === commandInputFingerprint({ ...input })
      ? { ...structuredClone(committed.result), status: 'unchanged' }
      : reject('operation-input-mismatch', '同操作号不能更改输入');
  const afterBusinessGuard = businessGuard();
  if (afterBusinessGuard) return afterBusinessGuard;
  if ((store.quoteVersion(input.quoteVersionId)?.contentRevision ?? 0) !== input.quoteRevision)
    return reject('revision-mismatch', '采用期间业务已更新，请重新核对');
  const current = selectFinalizationSource(store.state(), series.opportunityId, availability);
  if (
    !current.current ||
    current.current.origin !== 'operation' ||
    current.current.id !== input.finalizationId ||
    current.issues.length
  )
    return reject(
      'finalization-stale',
      current.issues.map((i) => i.message).join('；') || '请选择本商机当前有效定稿',
    );
  if (
    current.versions.some(
      (v) =>
        v?.file &&
        (v.file.workspaceId !== context.workspaceId || v.file.roundId !== context.roundId),
    )
  )
    return reject('workspace-changed', '当前方案文件不属于本工作区与轮次，请上传新版并重新定稿');
  if (quote.solutionBasis?.finalizationId === current.current.id)
    return {
      status: 'unchanged',
      objectId: quote.id,
      revision: input.quoteRevision,
      value: { finalizationId: current.current.id },
      message: '已采用此定稿',
    };
  const basis = {
    finalizationId: current.current.id,
    opportunityId: series.opportunityId,
    fourVersionIds: { ...current.current.fourVersionIds },
    productNeedRevision: current.current.productNeedRevision,
    adoptedAt: new Date().toISOString(),
    operator: {
      personId: knownDemoPersonId(store.person()) ?? `demo-role:${store.role()}`,
      name: store.person(),
    },
    versionMetadataSnapshot: structuredClone(current.current.versionMetadataSnapshot),
  };
  return store.commitV9Command(request, {
    object: { type: 'quoteVersion', id: quote.id },
    mainlineId: series.opportunityId,
    module: '报价',
    department: '销售',
    section: '方案依据',
    action: '采用当前有效定稿',
    owner: { name: store.sale(series.opportunityId)!.owner },
    changes: [
      {
        field: 'solutionBasis.finalizationId',
        valueType: 'string',
        before: quote.solutionBasis?.finalizationId ?? null,
        after: basis.finalizationId,
      },
    ],
    change: (s) => {
      const target = s
        .quoteSeries!.find((x) => x.id === series.id)!
        .versions.find((v) => v.id === quote.id)!;
      target.solutionBasis = basis;
      target.contentRevision = (target.contentRevision ?? 0) + 1;
    },
    value: { finalizationId: basis.finalizationId },
  });
}
