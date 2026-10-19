import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/app/core/seed';
import {
  selectCompleteWorkItems,
  selectManagementStatistics,
} from '../src/app/core/management-statistics';
import { collectDemoWorkItems } from '../src/app/core/work-item-sources';
import { createV9Dates } from '../src/app/core/v9-queries';
test('完整事项包含已完成计划但既有待办仍只含未完成计划，身份不变', () => {
  const state = createSeed();
  const p = state.projects[0];
  p.plans[0].status = '已完成';
  const complete = selectCompleteWorkItems(
    state,
    createV9Dates('2026-10-17T00:00:00Z', '2026-10-15'),
  );
  assert.ok(
    complete.some(
      (i) =>
        i.sourceId === 'project-plan' &&
        i.sourceRecordId === `${p.id}:${p.plans[0].id}` &&
        i.status === 'completed',
    ),
  );
  assert.ok(
    !collectDemoWorkItems(state).items.some(
      (i) => i.sourceId === 'project-plan' && i.sourceRecordId === `${p.id}:${p.plans[0].id}`,
    ),
  );
  assert.equal(new Set(complete.map((i) => i.id)).size, complete.length);
});
test('首次分布按商机去重，历史未评分和未定稿不加入三类分母', () => {
  const state = createSeed();
  const dates = createV9Dates('2026-10-17T00:00:00Z', '2026-10-15');
  const summary = selectManagementStatistics(state, dates);
  assert.equal(summary.firstResultDenominator, 0);
  assert.equal(
    summary.firstResults.reduce((n, r) => n + r.count, 0),
    0,
  );
  for (const d of summary.departments)
    assert.ok(d.overdueOpen <= d.open && d.total === d.open + d.completed);
});

test('没有统一方案工作区的商机仍区分历史未评分与未定稿，非法日期不判逾期', () => {
  const state = createSeed();
  const dates = createV9Dates('2026-10-17T00:00:00Z', '2026-10-15');
  const summary = selectManagementStatistics(state, dates);
  assert.equal(
    summary.historicalUnscored + summary.notFinalized,
    new Set(state.sales.filter((s) => s.type === 'opportunity').map((s) => s.id)).size,
  );
  state.projects[0].plans[0].end = '2026-02-31';
  state.projects[0].plans[0].status = '待开始';
  const item = selectCompleteWorkItems(state, dates).find(
    (i) => i.sourceRecordId === `${state.projects[0].id}:${state.projects[0].plans[0].id}`,
  )!;
  assert.equal(item.dueDate, null);
});

test('首次成绩按事件ID去重，避免同一首次事件多业务引用重复计分母', () => {
  const state = createSeed();
  const dates = createV9Dates('2026-10-17T00:00:00Z', '2026-10-15');
  state.solutionWorkspaces = ['DEMO-O001', 'DEMO-O002'].map((opportunityId) => ({
    id: opportunityId,
    opportunityId,
    revision: 1,
    productNeedRevision: null,
    versions: [],
    currentOutputs: {},
    schedule: null,
    scheduleChanges: [],
    finalizations: [],
    legacyFacts: [],
    firstFinalization: {
      eventId: 'SHARED-FIRST',
      deadlineDate: '2026-10-17',
      timezone: 'Asia/Shanghai' as const,
      businessDate: '2026-10-16',
      daysEarly: 1,
      result: 'early' as const,
    },
  }));
  const result = selectManagementStatistics(state, dates);
  assert.equal(result.firstResultDenominator, 1);
  assert.equal(result.firstResults[0].count, 1);
});
