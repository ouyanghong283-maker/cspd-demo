import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import {
  confirmProgressMapping,
  selectProgressMapping,
} from '../src/app/core/lifecycle-progress/mapping';
test('取消成员不自动缩分母，重新确认须原因及修订，留前后成员；保存失败不发布', () => {
  const { store, role } = harness();
  role('pm');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const p = store.state().projects[0];
  const plans = p.plans.filter((p) => p.type === '内部WBS').slice(0, 2);
  const ids = plans.map((p) => p.id);
  const context = { workspaceId: 'W', roundId: 'R', operationId: 'M1' };
  const input = {
    projectId: p.id,
    groupId: 'design' as const,
    planIds: ids,
    expectedMappingRevision: 0,
    reason: '确认稳定任务',
  };
  assert.equal(confirmProgressMapping(store, input, context).status, 'committed');
  store.project(p.id)!.plans.find((p) => p.id === ids[1])!.status = '已取消';
  let group = selectProgressMapping(store.state(), p.id).groups[0];
  assert.equal(group.total, 2);
  assert.equal(group.pending, true);
  const edit = { ...input, planIds: [ids[0]], expectedMappingRevision: 1, reason: '取消范围调整' };
  assert.equal(
    confirmProgressMapping(store, { ...edit, reason: '' }, { ...context, operationId: 'M2' })
      .status,
    'rejected',
  );
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
  assert.equal(
    confirmProgressMapping(store, edit, { ...context, operationId: 'M2' }).status,
    'failed',
  );
  assert.equal(JSON.stringify(store.state()), before);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem() {} },
  });
  assert.equal(
    confirmProgressMapping(store, edit, { ...context, operationId: 'M2' }).status,
    'committed',
  );
  group = selectProgressMapping(store.state(), p.id).groups[0];
  assert.equal(group.pending, false);
  assert.deepEqual(group.history[1].fromPlanIds, ids);
  assert.deepEqual(group.history[1].toPlanIds, [ids[0]]);
});
