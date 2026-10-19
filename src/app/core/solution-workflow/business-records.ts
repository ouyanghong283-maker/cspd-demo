import type { DemoState, SolutionConfirmation } from '../models';
import { emptySolutionWorkspace } from './versions';
import { selectFinalizationSource } from './finalization';
export type SolutionBusinessRecords = NonNullable<DemoState['solutionDocuments']>[number];
/** 旧集合仅供历史回读；V9核价/五可及TIC写入统一工作区。 */
export function selectSolutionBusinessRecords(state: Readonly<DemoState>, id: string) {
  const workspace = state.solutionWorkspaces?.find((w) => w.opportunityId === id);
  return workspace?.businessRecords ?? state.solutionDocuments?.find((d) => d.opportunityId === id);
}
export function writableSolutionBusinessRecords(
  state: DemoState,
  id: string,
): SolutionBusinessRecords {
  if ((state.storageSchemaVersion ?? 0) < 3)
    return state.solutionDocuments!.find((d) => d.opportunityId === id)!;
  state.solutionWorkspaces ??= [];
  let workspace = state.solutionWorkspaces.find((w) => w.opportunityId === id);
  if (!workspace) {
    workspace = emptySolutionWorkspace(id);
    state.solutionWorkspaces.push(workspace);
  }
  return (workspace.businessRecords ??= structuredClone(
    selectSolutionBusinessRecords(state, id) ?? {
      opportunityId: id,
      current: {},
      versions: [],
      confirmations: [],
      costings: [],
      fiveCanReviews: [],
      owner: workspace.schedule?.owner.name ?? '',
      ownerHistory: [],
    },
  ));
}
export function selectBusinessConfirmation(
  state: Readonly<DemoState>,
  id: string,
): SolutionConfirmation | undefined {
  if ((state.storageSchemaVersion ?? 0) >= 3) {
    const source = selectFinalizationSource(state, id, null);
    const current = source.current;
    if (!current || current.origin !== 'operation' || source.issues.length) return undefined;
    return {
      id: current.id,
      createdAt: current.confirmedAt,
      owner: current.owner.name,
      operator: current.operator.name,
      productNeedRevision: Number(current.productNeedRevision),
      documentVersions: {},
    };
  }
  const data = selectSolutionBusinessRecords(state, id),
    confirmation = data?.confirmations.at(-1);
  return confirmation &&
    confirmation.productNeedRevision ===
      (state.sales.find((s) => s.id === id)?.productNeedRevision ?? 0) &&
    (['技术方案', 'TIC', '设计BOM', 'SLD'] as const).every(
      (k) =>
        confirmation.documentVersions[k] && confirmation.documentVersions[k] === data?.current[k],
    )
    ? confirmation
    : undefined;
}
