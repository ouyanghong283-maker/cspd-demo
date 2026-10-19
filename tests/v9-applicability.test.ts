import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { setNodeApplicability } from '../src/app/core/lifecycle-progress/applicability';
import { selectLifecycleProgress } from '../src/app/core/lifecycle-progress';
import { knownDemoPersonId } from '../src/app/core/plan-person';
test('六节点允许留因免做及撤销，首次/验收/移交不可免，保存与查询不改任务事实', () => {
  const { store, role } = harness();
  role('pm');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const p = store.state().projects[0],
    before = JSON.stringify(p.plans),
    ctx = { workspaceId: 'W', roundId: 'R', operationId: 'A' };
  const input = {
    projectId: p.id,
    nodeId: 'execution.sat',
    applicability: 'not-required' as const,
    reason: '合同不涉及现场调试',
    pmPersonId: knownDemoPersonId(p.pm)!,
  };
  assert.equal(setNodeApplicability(store, input, ctx).status, 'committed');
  assert.equal(setNodeApplicability(store, input, ctx).status, 'unchanged');
  assert.equal(
    selectLifecycleProgress(store.state(), p.opportunityId, p.id).nodes.find(
      (n) => n.nodeId === input.nodeId,
    )?.status,
    'not-required',
  );
  assert.equal(JSON.stringify(store.project(p.id)!.plans), before);
  assert.equal(
    setNodeApplicability(
      store,
      { ...input, applicability: 'applicable', reason: '现场条件变化' },
      { ...ctx, operationId: 'B' },
    ).status,
    'committed',
  );
  assert.notEqual(
    selectLifecycleProgress(store.state(), p.opportunityId, p.id).nodes.find(
      (n) => n.nodeId === input.nodeId,
    )?.status,
    'not-required',
  );
  for (const nodeId of [
    'solution.firstFinal',
    'execution.acceptance',
    'execution.serviceHandover',
    'opportunity.g1',
  ])
    assert.equal(
      setNodeApplicability(store, { ...input, nodeId }, { ...ctx, operationId: nodeId }).status,
      'rejected',
    );
  assert.equal(store.state().progressNodeApplicability![0].history.length, 2);
});

test('免做失败不发布历史，其他五允许节点独立计满但不能自动完成验收移交', () => {
  const { store, role } = harness();
  role('pm');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const p = store.state().projects[0];
  const context = { workspaceId: 'W', roundId: 'R', operationId: 'A' };
  const input = {
    projectId: p.id,
    nodeId: 'execution.design',
    applicability: 'not-required' as const,
    reason: '演示适用性',
    pmPersonId: knownDemoPersonId(p.pm)!,
  };
  const before = JSON.stringify(store.state());
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem() {
        throw Error('quota');
      },
    },
  });
  assert.equal(setNodeApplicability(store, input, context).status, 'failed');
  assert.equal(JSON.stringify(store.state()), before);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
  });
  for (const nodeId of [
    'execution.design',
    'execution.production',
    'execution.fat',
    'execution.shipment',
    'execution.arrivalInstall',
  ]) {
    assert.equal(
      setNodeApplicability(store, { ...input, nodeId }, { ...context, operationId: nodeId }).status,
      'committed',
    );
    assert.equal(
      selectLifecycleProgress(store.state(), p.opportunityId, p.id).nodes.find(
        (n) => n.nodeId === nodeId,
      )?.status,
      'not-required',
    );
  }
  assert.equal(selectLifecycleProgress(store.state(), p.opportunityId, p.id).complete, false);
  assert.equal(
    setNodeApplicability(
      store,
      { ...input, pmPersonId: 'other' },
      { ...context, operationId: 'BAD' },
    ).status,
    'rejected',
  );
});
