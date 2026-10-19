import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import {
  setSolutionSchedule,
  changeSolutionDeadline,
  selectSolutionSchedule,
  SOLUTION_PEOPLE,
} from '../src/app/core/solution-workflow/schedule';
import { createV9Dates } from '../src/app/core/v9-queries';
function setup() {
  const { store, role } = harness();
  role('pm');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  return {
    store,
    context: { workspaceId: 'W', roundId: 'R', operationId: 'S1' },
    input: {
      opportunityId: 'DEMO-O008',
      pmPersonId: SOLUTION_PEOPLE.find((p) => p.name === '王项目')!.personId,
      ownerPersonId: SOLUTION_PEOPLE.find((p) => p.name === '周方案')!.personId,
      deadlineDate: '2028-02-29',
      note: '首次约定',
    },
  };
}
test('期限统一保存并留因改期，过时提交、同ID换输入和首次冻结拒绝', () => {
  const { store, input, context } = setup();
  assert.equal(setSolutionSchedule(store, input, context).status, 'committed');
  assert.equal(setSolutionSchedule(store, input, context).status, 'unchanged');
  const edit = {
    opportunityId: input.opportunityId,
    deadlineDate: '2028-03-01',
    reason: '客户调整',
    scheduleRevision: 1,
  };
  const ctx = { ...context, operationId: 'S2' };
  assert.equal(changeSolutionDeadline(store, edit, ctx).status, 'committed');
  assert.equal(changeSolutionDeadline(store, edit, ctx).status, 'unchanged');
  assert.equal(
    changeSolutionDeadline(store, { ...edit, deadlineDate: '2028-03-02' }, ctx).status,
    'rejected',
  );
  assert.equal(
    changeSolutionDeadline(store, edit, { ...ctx, operationId: 'S3' }).status,
    'rejected',
  );
  const w = store.state().solutionWorkspaces![0];
  assert.equal(w.scheduleChanges.length, 2);
  assert.equal(w.scheduleChanges[1].from?.deadlineDate, '2028-02-29');
  w.schedule!.frozenByEventId = 'FIRST';
  assert.equal(
    changeSolutionDeadline(store, { ...edit, scheduleRevision: 2 }, { ...ctx, operationId: 'S4' })
      .status,
    'rejected',
  );
});
test('非法日历、未知人员、空说明与保存失败均无部分设置', () => {
  const { store, input, context } = setup();
  for (const bad of [
    { deadlineDate: '2027-02-29' },
    { deadlineDate: '2028-04-31' },
    { pmPersonId: 'unknown' },
    { note: '' },
  ])
    assert.equal(setSolutionSchedule(store, { ...input, ...bad }, context).status, 'rejected');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem() {
        throw Error('QuotaExceededError');
      },
    },
  });
  assert.equal(setSolutionSchedule(store, input, context).status, 'failed');
  assert.equal(store.state().solutionWorkspaces?.length ?? 0, 0);
});
test('上海日界、闰日及模拟观察日隔离，查询不写历史', () => {
  const { store, input, context } = setup();
  setSolutionSchedule(store, input, context);
  const before = JSON.stringify(store.state());
  const day = createV9Dates('2028-02-29T15:59:59Z', '2040-01-01');
  const next = createV9Dates('2028-02-29T16:00:00Z', '2020-01-01');
  assert.equal(selectSolutionSchedule(store.state(), input.opportunityId, day).status, '未定稿');
  assert.equal(selectSolutionSchedule(store.state(), input.opportunityId, next).overdueDays, 1);
  assert.equal(
    selectSolutionSchedule(
      store.state(),
      input.opportunityId,
      createV9Dates('2028-03-31T16:00:00Z', '2028-01-01'),
    ).overdueDays,
    32,
  );
  assert.equal(JSON.stringify(store.state()), before);
});

test('跨部门演示代办不被岗位拦截，PM/负责人与实际操作者分别保留', () => {
  const { store, input, context } = setup();
  store.state().role = 'sales';
  Object.assign(store, { role: () => 'sales', person: () => '张销售' });
  assert.equal(setSolutionSchedule(store, input, context).status, 'committed');
  const w = store.state().solutionWorkspaces![0];
  assert.equal(w.schedule?.pm.name, '王项目');
  assert.equal(w.schedule?.owner.name, '周方案');
  assert.equal(w.scheduleChanges[0].operator.name, '张销售');
});
