import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/app/core/seed';
import { selectManagementBoard } from '../src/app/core/management-board';
import { createV9Dates } from '../src/app/core/v9-queries';
const filters = {
  projectIds: [],
  businessIds: [],
  grades: [],
  departments: [],
  firstResults: [],
  query: '',
};
const dates = createV9Dates('2026-10-17T00:00:00Z', '2026-10-15');
test('重点先等级、再同单位容量，MW与MWh不比数值，缺日期仍保留', () => {
  const state = createSeed();
  const sale = state.sales.find((s) => s.type === 'opportunity')!;
  state.projects = [];
  state.sales = [
    { ...sale, id: 'Z', grade: 'S', capacity: 9, unit: 'MWh', expectedDate: '' },
    { ...sale, id: 'A', grade: 'S', capacity: 1, unit: 'MW', expectedDate: '' },
    { ...sale, id: 'B', grade: 'S', capacity: 5, unit: 'MW', expectedDate: '' },
    { ...sale, id: 'C', grade: 'A', capacity: 5000, unit: 'MW', expectedDate: '' },
    { ...sale, id: 'D', grade: 'S', capacity: 0, unit: 'MW', expectedDate: '' },
  ];
  const before = structuredClone(state);
  const view = selectManagementBoard(state, filters, dates, {});
  assert.deepEqual(
    view.topFive.map((x) => x.businessId),
    ['B', 'A', 'Z', 'D', 'C'],
  );
  assert.equal(view.topFive[0].deadlineDate, null);
  assert.deepEqual(state, before);
});
test('异常固定先关键延期、再方案逾期、超支；合法已完成计划排除', () => {
  const state = createSeed();
  const sale = state.sales.find((s) => s.type === 'opportunity')!;
  state.sales = [sale];
  const project = state.projects[0];
  state.projects = [
    {
      ...project,
      opportunityId: sale.id,
      plans: [
        {
          ...project.plans[0],
          id: 'OPEN',
          type: '内部WBS',
          end: '2026-10-10',
          actual: '',
          status: '未开始',
        },
        {
          ...project.plans[0],
          id: 'DONE',
          type: '内部WBS',
          end: '2026-10-01',
          actual: '2026-10-09',
          status: '已完成',
        },
      ],
    },
  ];
  const view = selectManagementBoard(state, filters, dates, {});
  assert.equal(view.exceptions[0].category, 'delivery');
  assert.match(view.exceptions[0].sourceHref, /planId=OPEN/);
  assert.equal(view.exceptions[0].daysOverdue, 5);
  assert.ok(!view.exceptions.some((e) => e.sourceHref.includes('planId=DONE')));
  assert.ok(view.exceptions.some((e) => e.reason.includes('预算不可比')));
});
test('组合筛选同时收敛TOP5、事项、预算及异常，不写业务状态', () => {
  const state = createSeed();
  const sale = state.sales.find((s) => s.type === 'opportunity')!;
  state.sales = [
    { ...sale, id: 'A', grade: 'S', projectRegion: '欧洲', stage: '方案报价', owner: '王一' },
    { ...sale, id: 'B', grade: 'A', projectRegion: '澳洲', stage: '意向沟通', owner: '李二' },
  ];
  state.projects = [];
  const before = structuredClone(state);
  const view = selectManagementBoard(
    state,
    {
      ...filters,
      regions: ['欧洲'],
      stages: ['方案报价'],
      owners: ['王一'],
      partition: 'presales',
      budgetCurrency: 'EUR',
    },
    dates,
    {},
  );
  assert.deepEqual(
    view.businesses.map((b) => b.businessId),
    ['A'],
  );
  assert.deepEqual(
    view.topFive.map((b) => b.businessId),
    ['A'],
  );
  assert.ok(view.exceptions.every((e) => e.businessId === 'A'));
  assert.deepEqual(state, before);
});
test('筛选范围外的孤立项目不混入异常计数或清单', () => {
  const state = createSeed();
  const sale = state.sales.find((s) => s.type === 'opportunity')!;
  state.sales = [{ ...sale, id: 'IN', grade: 'S' }];
  state.projects = [{ ...state.projects[0], id: 'OUT', opportunityId: 'MISSING' }];
  const view = selectManagementBoard(state, { ...filters, businessIds: ['IN'] }, dates, {});
  assert.equal(view.pendingReviewCount, 0);
  assert.ok(view.exceptions.every((x) => x.businessId === 'IN'));
});
test('商机预计成交日不冒充项目计划截止日，缺排期明确待补', () => {
  const state = createSeed();
  const sale = state.sales.find((s) => s.type === 'opportunity')!;
  state.sales = [{ ...sale, expectedDate: '2026-12-01', opportunityRoughPlans: [] }];
  state.projects = [];
  const view = selectManagementBoard(state, filters, dates, {});
  assert.equal(view.topFive[0].deadlineDate, null);
});
