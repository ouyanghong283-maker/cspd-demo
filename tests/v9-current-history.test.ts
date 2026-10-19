import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { uploadSolutionOutput } from '../src/app/core/solution-workflow/upload';
import { selectSolutionWorkspace } from '../src/app/core/v9-queries';
import { selectLifecycleProgress } from '../src/app/core/lifecycle-progress';
test('替换真实当前版本同次失效定稿，保留首次事实、旧组合与报价金额；缺Blob不抹交付分', async () => {
  const { store, role } = harness();
  role('solution');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const files = {
    async put() {},
    async get() {
      return null;
    },
  };
  const input = {
    opportunityId: 'DEMO-O008',
    kind: 'proposal' as const,
    file: new File(['x'], '初版.pptx'),
    note: '',
  };
  const c = { workspaceId: 'W', roundId: 'R', operationId: 'V1' };
  await uploadSolutionOutput(store, input, c, files);
  const w = store.state().solutionWorkspaces![0];
  const old = w.currentOutputs.proposal!;
  w.productNeedRevision = 'r1';
  w.firstFinalization = {
    eventId: 'FIRST',
    deadlineDate: '2026-10-18',
    timezone: 'Asia/Shanghai',
    businessDate: '2026-10-17',
    daysEarly: 1,
    result: 'early',
  };
  w.finalizations = [
    {
      id: 'FIRST',
      opportunityId: w.opportunityId,
      sequence: 1,
      firstEventId: 'FIRST',
      fourVersionIds: { proposal: old, bom: 'B', sld: 'S', degradation: 'D' },
      versionMetadataSnapshot: structuredClone(w.versions),
      productNeedRevision: 'r1',
      owner: { personId: 'P', name: '负责人' },
      operator: { personId: 'P', name: '负责人' },
      confirmedAt: '2026-10-17T00:00:00Z',
      deadlineSnapshot: '2026-10-18',
      scheduleRevision: 1,
      origin: 'operation',
    },
  ];
  const quotes = JSON.stringify(store.state().quoteSeries);
  const r = await uploadSolutionOutput(
    store,
    { ...input, file: new File(['v2'], '新版.pptx') },
    { ...c, operationId: 'V2' },
    files,
  );
  assert.equal(r.status, 'committed');
  if (r.status === 'committed') {
    assert.equal((r.value as any).reclaimCandidates.length, 1);
    assert.equal((r.value as any).reclaimCandidates[0].versionId, old);
  }
  const view = selectSolutionWorkspace(store.state(), w.opportunityId, {});
  assert.equal(view.currentStatus, 'stale');
  assert.equal(view.firstResult, 'early');
  assert.equal(view.workspace?.finalizations[0].fourVersionIds.proposal, old);
  assert.equal(JSON.stringify(store.state().quoteSeries), quotes);
  const score = selectLifecycleProgress(store.state(), w.opportunityId, null);
  assert.equal(score.nodes.find((n) => n.nodeId === 'solution.firstFinal')?.status, 'verified');
  assert.equal(score.nodes.find((n) => n.nodeId === 'solution.proposal')?.status, 'verified');
});
