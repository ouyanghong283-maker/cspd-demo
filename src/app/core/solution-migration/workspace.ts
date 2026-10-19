import type { DemoState } from '../models';
import { convertLegacySolutions } from './index';
export const V9_STORAGE_SCHEMA_VERSION = 3;
/** 先独立转换旧源，再吸收进已有真实工作区；真实当前/首次/期限永不被旧标记覆盖。 */
export function prepareV9Workspace(input: Readonly<DemoState>): DemoState {
  if ((input.storageSchemaVersion ?? 0) > V9_STORAGE_SCHEMA_VERSION)
    throw Error('快照来自更高版本，拒绝降级写入');
  if (input.storageSchemaVersion === V9_STORAGE_SCHEMA_VERSION) return structuredClone(input);
  const legacy: DemoState = structuredClone(input);
  legacy.solutionWorkspaces = [];
  legacy.solutionLegacyAliases = [];
  const converted = convertLegacySolutions(legacy);
  if (!converted.canContinue) throw Error(converted.issues.map((i) => i.message).join('；'));
  const state: DemoState = structuredClone(input);
  state.solutionWorkspaces ??= [];
  state.solutionLegacyAliases ??= [];
  for (const migrated of converted.state.solutionWorkspaces ?? []) {
    const matches = state.solutionWorkspaces.filter(
      (w) => w.opportunityId === migrated.opportunityId,
    );
    if (matches.length > 1) throw Error('同商机统一工作区重复，原状态保留');
    const current = matches[0];
    if (!current) {
      state.solutionWorkspaces.push(migrated);
      continue;
    }
    for (const fact of migrated.legacyFacts)
      if (
        !current.legacyFacts.some(
          (f) =>
            f.type === fact.type && JSON.stringify(f.original) === JSON.stringify(fact.original),
        )
      )
        current.legacyFacts.push(fact);
    for (const version of migrated.versions) {
      const previous = current.versions.find((v) => v.id === version.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(version))
        throw Error('统一版本身份冲突，停止升级');
      if (!previous)
        current.versions.push({ ...version, contentState: 'metadataOnly', file: null });
    }
    for (const kind of ['proposal', 'bom', 'sld', 'degradation'] as const)
      current.currentOutputs[kind] ??= migrated.currentOutputs[kind];
  }
  for (const alias of converted.state.solutionLegacyAliases ?? []) {
    const old = state.solutionLegacyAliases.find(
      (a) =>
        a.legacyType === alias.legacyType &&
        a.legacyId === alias.legacyId &&
        a.opportunityId === alias.opportunityId,
    );
    if (old && JSON.stringify(old) !== JSON.stringify(alias))
      throw Error('旧新别名冲突，停止升级并保留原状态');
    if (!old) state.solutionLegacyAliases.push(alias);
  }
  // 原核价/五可命令仍消费既有字段；保留兼容源，统一方案输出只从solutionWorkspaces读取。
  // 旧集合同步续接/重开及写入收敛由15-02完成，禁止在本票删除仍有消费者的事实。
  state.storageSchemaVersion = V9_STORAGE_SCHEMA_VERSION;
  return state;
}
