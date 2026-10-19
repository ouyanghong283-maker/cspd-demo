import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import {
  confirmProgressMapping,
  selectProgressMapping,
} from '../src/app/core/lifecycle-progress/mapping';
import { selectLifecycleProgress } from '../src/app/core/lifecycle-progress';
function setup() {
  const { store, role } = harness();
  role('pm');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const p = store.state().projects[0];
  p.plans = p.plans
    .filter((x) => x.type === '内部WBS')
    .slice(0, 3)
    .map((x, i) => ({
      ...x,
      status: i === 0 ? '已完成' : '未开始',
      actual: i === 0 ? '2026-10-10' : '',
      completionKind: undefined,
      name: '普通任务' + i,
    }));
  return { store, p, context: { workspaceId: 'W', roundId: 'R', operationId: 'M1' } };
}
test('固定成员三分之一精确计分，重命名与新增任务不扩分母，撤销完成降分', () => {
  const { store, p, context } = setup();
  const ids = p.plans.map((x) => x.id);
  assert.equal(
    confirmProgressMapping(
      store,
      {
        projectId: p.id,
        groupId: 'design',
        planIds: [...ids, ids[0]],
        expectedMappingRevision: 0,
        reason: '确认任务组',
      },
      context,
    ).status,
    'committed',
  );
  assert.equal(
    selectProgressMapping(store.state(), p.id).groups.find((g) => g.groupId === 'design')?.planIds
      .length,
    3,
  );
  let v = selectLifecycleProgress(store.state(), p.opportunityId, p.id);
  const n = v.nodes.find((x) => x.nodeId === 'execution.design')!;
  assert.equal(n.status, 'partial');
  assert.equal(n.score?.numerator, '5');
  assert.equal(n.score?.denominator, '3');
  const current = store.project(p.id)!;
  current.plans[0].name = '更名';
  current.plans.push({ ...current.plans[1], id: 'NEW' });
  assert.deepEqual(selectLifecycleProgress(store.state(), p.opportunityId, p.id).score, v.score);
  current.plans[0].status = '未开始';
  assert.equal(
    selectLifecycleProgress(store.state(), p.opportunityId, p.id).nodes.find(
      (x) => x.nodeId === 'execution.design',
    )?.status,
    'incomplete',
  );
});
test('跨组重复、归属错误及过时修订拒绝；取消成员不缩分母', () => {
  const { store, p, context } = setup();
  const input = {
    projectId: p.id,
    groupId: 'design' as const,
    planIds: p.plans.map((x) => x.id),
    expectedMappingRevision: 0,
    reason: '确认',
  };
  confirmProgressMapping(store, input, context);
  assert.equal(
    confirmProgressMapping(
      store,
      { ...input, groupId: 'production' },
      { ...context, operationId: 'M2' },
    ).status,
    'rejected',
  );
  assert.equal(
    confirmProgressMapping(
      store,
      { ...input, planIds: ['OTHER'] },
      { ...context, operationId: 'M3' },
    ).status,
    'rejected',
  );
  assert.equal(
    confirmProgressMapping(store, input, { ...context, operationId: 'M4' }).status,
    'rejected',
  );
  const current = store.project(p.id)!;
  current.plans[1].status = '已取消';
  assert.equal(
    selectLifecycleProgress(store.state(), p.opportunityId, p.id).nodes.find(
      (x) => x.nodeId === 'execution.design',
    )?.status,
    'missing',
  );
});
