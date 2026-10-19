import type { DemoStore } from '../store';
import type { SolutionFileReference, V9OperationContext } from '../v9-contracts';
import type { SolutionFiles } from './files';
/** 不扫描孤儿、不清库；候选必须来自已提交的替换收据，文件库再核对实际归属。 */
export async function reclaimSolutionFiles(
  store: DemoStore,
  candidates: SolutionFileReference[],
  context: V9OperationContext,
  files: SolutionFiles,
) {
  const removed: string[] = [],
    retained: string[] = [];
  let recoveryNeeded = false;
  for (const c of candidates) {
    const safe = () => {
      const t = store.v9CommandTarget();
      if (
        t?.workspaceId !== context.workspaceId ||
        t.roundId !== context.roundId ||
        !store.v9CanEdit() ||
        c.workspaceId !== context.workspaceId ||
        c.roundId !== context.roundId
      )
        return false;
      const refs = store.v9SolutionCurrentReferences();
      if (!refs || refs.some((r) => r.blobId === c.blobId)) return false;
      return (
        store.state().v9CommandReceipts?.some((r) => {
          if (
            r.command !== 'registerSolutionVersion' ||
            r.workspaceId !== context.workspaceId ||
            r.roundId !== context.roundId
          )
            return false;
          const value = r.result.value as { reclaimCandidates?: SolutionFileReference[] };
          return (
            value.reclaimCandidates?.some(
              (x) =>
                x.blobId === c.blobId &&
                x.versionId === c.versionId &&
                x.workspaceId === c.workspaceId &&
                x.roundId === c.roundId,
            ) ?? false
          );
        }) ?? false
      );
    };
    try {
      if (!safe() || !files.removeOwned) {
        retained.push(c.blobId);
        continue;
      }
      const row = await files.get(c.blobId);
      const version = store
        .state()
        .solutionWorkspaces?.flatMap((w) => w.versions)
        .find((v) => v.id === c.versionId);
      if (!row) {
        continue;
      }
      if (
        !version ||
        version.file ||
        version.contentState !== 'metadataOnly' ||
        row.versionId !== c.versionId ||
        row.workspaceId !== c.workspaceId ||
        row.roundId !== c.roundId ||
        row.opportunityId !== version.opportunityId ||
        row.kind !== version.kind ||
        !safe()
      ) {
        retained.push(c.blobId);
        continue;
      }
      const { blob, ...identity } = row;
      await files.removeOwned(c.blobId, identity);
      removed.push(c.blobId);
    } catch {
      retained.push(c.blobId);
      recoveryNeeded = true;
    }
  }
  return { removed, retained, recoveryNeeded };
}

/** K12恢复控件只传原上下文；候选从已提交收据提取，不由页面推断回收归属。 */
export function recoverReplacedSolutionFiles(
  store: DemoStore,
  context: V9OperationContext,
  files: SolutionFiles,
) {
  const candidates = (store.state().v9CommandReceipts ?? [])
    .filter(
      (r) =>
        r.command === 'registerSolutionVersion' &&
        r.workspaceId === context.workspaceId &&
        r.roundId === context.roundId,
    )
    .flatMap(
      (r) =>
        (r.result.value as { reclaimCandidates?: SolutionFileReference[] }).reclaimCandidates ?? [],
    );
  return reclaimSolutionFiles(store, candidates, context, files);
}
