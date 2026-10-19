import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/app/core/seed';
import { selectManagementBoard } from '../src/app/core/management-board';
import { selectManagementStatistics } from '../src/app/core/management-statistics';
import { createV9Dates } from '../src/app/core/v9-queries';
import type { LifecycleProgressView } from '../src/app/core/v9-contracts';
const filters = {
  projectIds: [],
  businessIds: [],
  grades: [],
  departments: [],
  firstResults: [],
  query: '',
};
const dates = createV9Dates('2026-10-17T00:00:00Z', '2026-10-15');
test('同商机多项目只计一条执行主线，最慢进度使用原始分数且传播待补', () => {
  const state = createSeed();
  const sale = state.sales.find((s) => s.type === 'opportunity')!;
  const project = state.projects[0];
  state.sales = [sale];
  state.projects = [
    { ...project, id: 'P1', opportunityId: sale.id },
    { ...project, id: 'P2', opportunityId: sale.id },
  ];
  const progress = (
    _: unknown,
    businessId: string,
    projectId: string | null,
  ): LifecycleProgressView => ({
    businessId,
    projectId,
    score: {
      numerator: projectId === 'P1' ? '10000000000000000001' : '10000000000000000000',
      denominator: '30000000000000000000',
    },
    displayPercent: '33.33%',
    complete: false,
    nodes:
      projectId === 'P1'
        ? [
            {
              nodeId: 'L5',
              weight: 5,
              status: 'missing',
              sourceIds: [],
              reason: '来源待补',
              sourceHref: null,
            },
          ]
        : [],
  });
  const before = structuredClone(state);
  const view = selectManagementBoard(
    state,
    filters,
    dates,
    {},
    { selectLifecycleProgress: progress },
  );
  assert.equal(view.businessCount, 1);
  assert.equal(view.projectCount, 2);
  assert.equal(view.businesses[0].partition, 'execution');
  assert.equal(view.businesses[0].slowestProjectId, 'P2');
  assert.equal(view.businesses[0].incomplete, true);
  assert.deepEqual(state, before);
});
test('多项目商机按项目筛选后预算、异常、部门清单和TOP5下钻统一收窄', () => {
  const state = createSeed();
  const sale = state.sales.find((s) => s.id === 'DEMO-O005')!;
  state.sales = [sale];
  state.projects = state.projects.filter((p) => p.opportunityId === sale.id);
  const before = structuredClone(state);
  const unfiltered = selectManagementBoard(
    state,
    { ...filters, businessIds: [sale.id], budgetCurrency: 'CNY' },
    dates,
    {},
  );
  assert.ok(unfiltered.budgets.some((b) => b.projectId === 'DEMO-P002'));
  assert.ok(unfiltered.exceptions.some((e) => e.projectId === 'DEMO-P002'));
  assert.ok(unfiltered.departmentItems.some((i) => i.projectId === 'DEMO-P002'));
  const view = selectManagementBoard(
    state,
    { ...filters, projectIds: ['DEMO-P001'], budgetCurrency: 'CNY' },
    dates,
    {},
  );

  assert.equal(view.businessCount, 1);
  assert.equal(view.projectCount, 1);
  assert.deepEqual(view.businesses[0].projectIds, ['DEMO-P001']);
  assert.deepEqual(
    view.projects.map((p) => p.projectId),
    ['DEMO-P001'],
  );
  assert.deepEqual(
    view.budgets.map((b) => b.projectId),
    ['DEMO-P001'],
  );
  assert.equal(
    view.exceptions.some((e) => e.projectId === 'DEMO-P002'),
    false,
  );
  assert.equal(
    view.departmentItems.some((i) => i.projectId === 'DEMO-P002'),
    false,
  );
  const statistics = selectManagementStatistics(state, dates, [sale.id], view.departmentItems);
  assert.equal(
    statistics.items.some((i) => i.projectId === 'DEMO-P002'),
    false,
  );
  assert.equal(view.topFive[0].sourceHref, '/projects/DEMO-P001');
  assert.deepEqual(state, before);
});
test('无项目商机保留售前，无法稳定关联的项目独立待核，不按同名归并', () => {
  const state = createSeed();
  const sale = state.sales.find((s) => s.type === 'opportunity')!;
  state.sales = [sale];
  state.projects = [
    { ...state.projects[0], id: 'ORPHAN', opportunityId: 'UNKNOWN', name: sale.projectName },
  ];
  const view = selectManagementBoard(state, filters, dates, {});
  assert.equal(view.businessCount, 1);
  assert.equal(view.businesses[0].partition, 'presales');
  assert.equal(view.projectCount, 0);
  assert.equal(view.pendingReviewCount, 1);
  assert.equal(view.exceptions[0].projectId, 'ORPHAN');
  assert.equal(view.businesses[0].incomplete, true);
  assert.equal(view.businesses[0].progress.nodes.length, 21);
});
test('首次成绩按首次定稿事件身份去重，不因多项目或重复来源膨胀', () => {
  const state = createSeed();
  const sale = state.sales.find((s) => s.type === 'opportunity')!;
  state.sales = [sale];
  state.projects = [];
  const workspace = {
    id: 'W1',
    opportunityId: sale.id,
    revision: 1,
    productNeedRevision: null,
    versions: [],
    currentOutputs: {},
    schedule: null,
    scheduleChanges: [],
    finalizations: [],
    legacyFacts: [],
    firstFinalization: {
      eventId: 'FINAL-1',
      deadlineDate: '2026-10-17',
      timezone: 'Asia/Shanghai' as const,
      businessDate: '2026-10-17',
      daysEarly: 0,
      result: 'on-time' as const,
    },
  };
  state.solutionWorkspaces = [workspace, { ...workspace, id: 'W2' }];
  const view = selectManagementBoard(state, filters, dates, {});
  assert.equal(view.firstResultDenominator, 1);
  assert.equal(view.firstResults[0].count, 1);
  assert.equal(view.businesses[0].sourceHref, `/sales/detail/${sale.id}`);
});
