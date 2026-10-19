import type { DemoState, SolutionDocumentKind } from '../models';
import type { JsonValue, SolutionLegacyAlias, SolutionOutputVersion } from '../v9-contracts';
import { emptySolutionWorkspace } from '../solution-workflow/versions';

export interface MigrationIssue {
  status: 'resolved' | 'ambiguous' | 'missing' | 'fatal';
  sourceType: string;
  sourceId: string;
  message: string;
}
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const kindMap: Record<SolutionDocumentKind, SolutionOutputVersion['kind']> = {
  技术方案: 'proposal',
  设计BOM: 'bom',
  SLD: 'sld',
  TIC: 'tic',
};
/** 只转换给定快照，不读写存储，不启动全局升级。 */
export function convertLegacySolutions(input: Readonly<DemoState>): {
  state: DemoState;
  issues: MigrationIssue[];
  canContinue: boolean;
} {
  const state: DemoState = structuredClone(input);
  const issues: MigrationIssue[] = [];
  if (
    !Array.isArray(state.sales) ||
    !Array.isArray(state.attachments) ||
    !Array.isArray(state.quoteSeries ?? [])
  )
    return {
      state,
      issues: [
        {
          status: 'fatal',
          sourceType: 'snapshot',
          sourceId: 'root',
          message: '快照结构不完整，不能继续转换',
        },
      ],
      canContinue: false,
    };
  const mixed = [...(state.solutionSeries ?? []), ...(state.solutionDocuments ?? [])].some(
    (record) => state.solutionWorkspaces?.some((w) => w.opportunityId === record.opportunityId),
  );
  if (mixed)
    return {
      state,
      issues: [
        {
          status: 'fatal',
          sourceType: 'snapshot',
          sourceId: 'mixed-solution-model',
          message: '统一工作区与尚未吸收的旧集合同时存在；停止转换并保留原快照，需先核对来源。',
        },
      ],
      canContinue: false,
    };
  state.solutionWorkspaces ??= [];
  state.solutionLegacyAliases ??= [];
  const aliases = state.solutionLegacyAliases;
  const addAlias = (
    type: string,
    id: string,
    opportunityId: string | null,
    unifiedId: string | null,
    original: unknown,
    status: SolutionLegacyAlias['status'] = 'resolved',
  ) => {
    const previous = aliases.find(
      (a) => a.legacyType === type && a.legacyId === id && a.opportunityId === opportunityId,
    );
    if (previous) {
      if (
        previous.unifiedId !== unifiedId ||
        JSON.stringify(previous.originalReference) !== JSON.stringify(json(original))
      ) {
        previous.status = 'ambiguous';
        issues.push({
          status: 'ambiguous',
          sourceType: type,
          sourceId: id,
          message: '同一旧身份有多个不同记录，保留双方待核',
        });
      }
      return;
    }
    aliases.push({
      legacyType: type,
      legacyId: id,
      opportunityId,
      unifiedId,
      status,
      originalReference: json(original),
    });
  };
  const opportunityIds = new Set([
    ...(state.solutionSeries ?? []).map((s) => s.opportunityId),
    ...(state.solutionDocuments ?? []).map((d) => d.opportunityId),
  ]);
  for (const opportunityId of [...opportunityIds].sort()) {
    if (state.solutionWorkspaces.some((w) => w.opportunityId === opportunityId)) {
      continue;
    }
    const w = emptySolutionWorkspace(opportunityId);
    state.solutionWorkspaces.push(w);
    const fact = (type: string, id: string, original: unknown) => {
      const unique = `${type}:${id}:${w.legacyFacts.length}`;
      w.legacyFacts.push({ id: unique, type, origin: 'legacy', original: json(original) });
      return unique;
    };
    const reliableOpportunity =
      state.sales.filter((s) => s.id === opportunityId && s.type === 'opportunity').length === 1;
    if (!reliableOpportunity)
      issues.push({
        status: 'missing',
        sourceType: 'opportunity',
        sourceId: opportunityId,
        message: '商机关联不存在或歧义，原记录保留待核',
      });
    const version = (
      type: string,
      v: {
        id: string;
        number: number;
        documentId: string;
        owner: string;
        operator: string;
        createdAt: string;
        note: string;
      },
      kind: SolutionOutputVersion['kind'],
    ) => {
      const documents = state.attachments.filter(
        (a) => a.id === v.documentId && a.entityId === opportunityId,
      );
      const doc = documents.length === 1 ? documents[0] : null;
      const existing = doc
        ? w.versions.find((item) => item.documentId === v.documentId && item.kind === kind)
        : null;
      const id = existing?.id ?? `legacy-version:${JSON.stringify([opportunityId, type, v.id])}`;
      if (!existing)
        w.versions.push({
          id,
          opportunityId,
          kind,
          number: v.number,
          documentId: v.documentId || null,
          fileName: doc?.name ?? '',
          size: doc?.size ?? null,
          mime: null,
          uploadedAt: v.createdAt || null,
          owner: v.owner ? { personId: '', name: v.owner } : null,
          operator: v.operator ? { personId: '', name: v.operator } : null,
          note: v.note,
          origin: 'legacy',
          uploadEvidence: null,
          contentState: 'metadataOnly',
          file: null,
        });
      fact(type, v.id, v);
      const status =
        !reliableOpportunity || !doc
          ? 'missing'
          : w.versions.some(
                (item) =>
                  item.id !== id && item.kind === kind && !!doc.name && item.fileName === doc.name,
              )
            ? 'ambiguous'
            : 'resolved';
      if (status !== 'resolved')
        issues.push({
          status,
          sourceType: type,
          sourceId: v.id,
          message:
            status === 'missing'
              ? '原文件或商机关联待补；不生成真实上传证据'
              : '同名资料身份不同，双方保留并待核',
        });
      if (status === 'ambiguous')
        for (const alias of aliases.filter(
          (a) =>
            a.opportunityId === opportunityId &&
            a.unifiedId !== id &&
            w.versions.some((v) => v.id === a.unifiedId && v.fileName === doc?.name),
        ))
          alias.status = 'ambiguous';
      addAlias(type, v.id, opportunityId, id, v, status);
      return id;
    };
    for (const s of state.solutionSeries?.filter((s) => s.opportunityId === opportunityId) ?? []) {
      fact('solutionSeries', s.id, s);
      addAlias(
        'solutionSeries',
        s.id,
        opportunityId,
        w.id,
        s,
        reliableOpportunity ? 'resolved' : 'missing',
      );
      for (const v of s.versions) {
        const id = version('solutionVersion', v, 'proposal');
        if (v.id === s.latestVersionId) w.currentOutputs.proposal = id;
      }
    }
    for (const d of state.solutionDocuments?.filter((d) => d.opportunityId === opportunityId) ??
      []) {
      fact('solutionDocuments', opportunityId, d);
      addAlias('solutionDocuments', opportunityId, opportunityId, w.id, d);
      for (const v of d.versions) {
        const kind = kindMap[v.kind];
        if (!kind) {
          issues.push({
            status: 'fatal',
            sourceType: 'solutionDocumentVersion',
            sourceId: v.id,
            message: '无法识别旧资料类型',
          });
          continue;
        }
        const id = version('solutionDocumentVersion', v, kind);
        if (kind !== 'tic' && v.id === d.current[v.kind]) {
          const prior = w.currentOutputs[kind];
          if (prior && prior !== id) {
            issues.push({
              status: 'ambiguous',
              sourceType: 'currentOutput',
              sourceId: opportunityId,
              message: '两个来源的当前资料不同，保留双方待核',
            });
            for (const a of aliases.filter((a) => a.unifiedId === prior || a.unifiedId === id))
              a.status = 'ambiguous';
          }
          w.currentOutputs[kind] = id;
        }
      }
      for (const [type, records] of [
        ['solutionConfirmation', d.confirmations],
        ['solutionCosting', d.costings],
        ['fiveCanReview', d.fiveCanReviews],
      ] as const)
        for (const record of records) {
          const id = fact(type, record.id, record);
          addAlias(type, record.id, opportunityId, id, record);
        }
    }
    for (const q of state.quoteSeries?.filter((q) => q.opportunityId === opportunityId) ?? [])
      for (const v of q.versions) {
        const id = fact('quoteVersion', v.id, v);
        addAlias('quoteVersion', v.id, opportunityId, id, v);
      }
    for (const kind of ['proposal', 'bom', 'sld', 'degradation'] as const)
      if (!w.currentOutputs[kind])
        issues.push({
          status: 'missing',
          sourceType: 'currentOutput',
          sourceId: `${opportunityId}:${kind}`,
          message: `${kind}当前资料缺失，不补造`,
        });
  }
  // 历史引用按旧类型、ID和商机归属解析，绝不用当前最新版本替换旧依据。
  for (const w of state.solutionWorkspaces) {
    const link = (
      ownerType: string,
      ownerId: string,
      field: string,
      targetType: string,
      targetId: string | undefined,
    ) => {
      const targets = aliases.filter(
        (a) =>
          a.legacyType === targetType &&
          a.legacyId === targetId &&
          a.opportunityId === w.opportunityId,
      );
      const target = targets.length === 1 ? targets[0] : null;
      const status = target?.status ?? 'missing';
      addAlias(
        `${ownerType}Reference:${field}`,
        ownerId,
        w.opportunityId,
        target?.unifiedId ?? null,
        { originalId: targetId ?? null, targetType },
        status,
      );
      if (status !== 'resolved')
        issues.push({
          status,
          sourceType: ownerType,
          sourceId: ownerId,
          message: `${field}原引用${targetId || '缺失'}待核，未替换为当前资料`,
        });
    };
    for (const q of state.quoteSeries ?? [])
      if (q.opportunityId === w.opportunityId)
        for (const v of q.versions) {
          link('quote', v.id, 'solutionVersionId', 'solutionVersion', v.solutionVersionId);
          if (v.sourceSolutionConfirmationId)
            link(
              'quote',
              v.id,
              'sourceSolutionConfirmationId',
              'solutionConfirmation',
              v.sourceSolutionConfirmationId,
            );
          if (v.costingId) link('quote', v.id, 'costingId', 'solutionCosting', v.costingId);
          for (const [kind, id] of Object.entries(v.sourceDocumentVersions ?? {}))
            link('quote', v.id, `sourceDocumentVersions.${kind}`, 'solutionDocumentVersion', id);
        }
    for (const f of w.legacyFacts) {
      if (f.type === 'solutionCosting') {
        const original = f.original as { id: string; confirmationId: string };
        link(
          'costing',
          original.id,
          'confirmationId',
          'solutionConfirmation',
          original.confirmationId,
        );
      }
      if (f.type === 'solutionConfirmation') {
        const original = f.original as { id: string; documentVersions: Record<string, string> };
        for (const [kind, id] of Object.entries(original.documentVersions ?? {}))
          link(
            'confirmation',
            original.id,
            `documentVersions.${kind}`,
            'solutionDocumentVersion',
            id,
          );
      }
    }
  }
  // 输出统一模型，原事实已收进legacyFacts/aliases；全局备份与启用归15-01。
  delete state.solutionSeries;
  delete state.solutionDocuments;
  return { state, issues, canContinue: !issues.some((i) => i.status === 'fatal') };
}
export function resolveLegacySolution(
  state: Readonly<DemoState>,
  legacyType: string,
  legacyId: string,
  opportunityId: string,
) {
  const aliases =
    state.solutionLegacyAliases?.filter(
      (a) =>
        a.legacyType === legacyType && a.legacyId === legacyId && a.opportunityId === opportunityId,
    ) ?? [];
  const alias = aliases[0];
  return {
    status: aliases.length === 1 ? alias.status : ('missing' as const),
    unifiedId: alias?.unifiedId ?? null,
    original: alias ? structuredClone(alias.originalReference) : null,
  };
}

/** 历史歧义保留；正式重传后的新当前身份不再继承旧来源歧义。 */
export function selectSolutionMigrationStatus(state: Readonly<DemoState>, opportunityId: string) {
  const workspace = state.solutionWorkspaces?.find((w) => w.opportunityId === opportunityId);
  const currentIds = new Set(Object.values(workspace?.currentOutputs ?? {}));
  const unresolved = (state.solutionLegacyAliases ?? []).filter(
    (a) => a.opportunityId === opportunityId && a.status !== 'resolved',
  );
  const currentAmbiguities = unresolved.filter(
    (a) => a.status === 'ambiguous' && a.unifiedId && currentIds.has(a.unifiedId),
  );
  return {
    canFinalize: currentAmbiguities.length === 0,
    currentAmbiguities: structuredClone(currentAmbiguities),
    unresolved: structuredClone(unresolved),
  };
}
