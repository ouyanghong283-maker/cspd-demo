import { solutionNeedRevision } from './solution-workflow/finalization';
import type { DemoState } from './models';
import { SOLUTION_OUTPUT_KINDS } from './v9-contracts';
import type { FileAvailability, SolutionWorkspaceView, V9Dates } from './v9-contracts';

export function createV9Dates(realNowUtc: string, planObservationDate: string): V9Dates {
  const date = new Date(realNowUtc);
  if (!Number.isFinite(date.getTime())) throw new Error('真实时间非法');
  const solutionBusinessDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return {
    realNowUtc: date.toISOString(),
    solutionBusinessDate,
    timezone: 'Asia/Shanghai',
    planObservationDate,
  };
}

/** 文件设施提供内存状态；本查询不访问Blob、不迁移或补种。 */
export function selectSolutionWorkspace(
  state: Readonly<DemoState>,
  opportunityId: string,
  availability: Readonly<Record<string, FileAvailability>>,
): SolutionWorkspaceView {
  const workspace =
    state.solutionWorkspaces?.find((item) => item.opportunityId === opportunityId) ?? null;
  const latest = workspace?.finalizations.at(-1);
  const currentStatus = !latest
    ? 'not-finalized'
    : latest.productNeedRevision ===
          (latest.origin === 'simulated'
            ? workspace?.productNeedRevision
            : solutionNeedRevision(state, opportunityId)) &&
        SOLUTION_OUTPUT_KINDS.every(
          (kind) => latest.fourVersionIds[kind] === workspace?.currentOutputs[kind],
        )
      ? 'current'
      : 'stale';
  const hasLegacyHistory = workspace
    ? workspace.legacyFacts.length > 0
    : !!state.solutionSeries?.some((item) => item.opportunityId === opportunityId) ||
      !!state.solutionDocuments?.some((item) => item.opportunityId === opportunityId);
  return {
    currentStatus,
    workspace: workspace ? structuredClone(workspace) : null,
    firstResult:
      workspace?.firstFinalization?.result ??
      (hasLegacyHistory ? 'historical-unscored' : 'not-finalized'),
    files: SOLUTION_OUTPUT_KINDS.map((kind) => {
      const versionId = workspace?.currentOutputs[kind] ?? null;
      return {
        kind,
        versionId,
        availability: versionId
          ? (availability[versionId] ??
            (workspace?.versions.find((v) => v.id === versionId)?.file ? 'checking' : 'missing'))
          : 'missing',
      };
    }),
  };
}
