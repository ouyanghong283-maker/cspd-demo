import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/app/core/seed';
import { selectManagementBoard } from '../src/app/core/management-board';
import { selectLifecycleProgress } from '../src/app/core/lifecycle-progress';
import { selectBudgetComparison } from '../src/app/core/budget-comparison';
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
test('看板默认组合已提交的真实计分、完整事项与预算查询，不再返回空接线', () => {
  const state = createSeed();
  const project = state.projects[0];
  const before = structuredClone(state);
  const view = selectManagementBoard(
    state,
    { ...filters, businessIds: [project.opportunityId], budgetCurrency: 'CNY' },
    dates,
    {},
  );
  assert.deepEqual(
    view.projects.find((p) => p.projectId === project.id)?.progress,
    selectLifecycleProgress(state, project.opportunityId, project.id, dates),
  );
  assert.deepEqual(
    view.budgets.filter((b) => b.projectId === project.id),
    selectBudgetComparison(state, project.id).filter((b) => b.currency === 'CNY'),
  );
  assert.ok(view.departmentItems.length > 0);
  assert.deepEqual(state, before);
});
test('看板缺少费用来源显示未知，不把未读取的费用画成零', () => {
  const state = createSeed();
  const project = state.projects[0];
  project.plans = project.plans
    .filter((p) => p.type === '内部WBS')
    .map((p) => ({ ...p, budgetAmount: 10, budgetCurrency: 'CNY' }));
  state.budgetComparisonSources = [];
  state.budgetDemoExpenses = [];
  const view = selectManagementBoard(
    state,
    { ...filters, businessIds: [project.opportunityId], budgetCurrency: 'CNY' },
    dates,
    {},
  );
  const budget = view.budgets.find((b) => b.projectId === project.id)!;
  assert.equal(budget.comparable, false);
  assert.equal(budget.expenseMinor, null);
  assert.match(budget.reason!, /来源/);
});

import { ready } from './v9-finalization-fixture';
import { finalizeSolution } from '../src/app/core/solution-workflow/finalization';
import { selectManagementStatistics } from '../src/app/core/management-statistics';
import { checkSolutionFile } from '../src/app/core/solution-workflow/files';
import type { FileAvailability } from '../src/app/core/v9-contracts';

test('真实保存首次后文件核验四态不抹历史，观察日变化不重算首次；图表组合范围一致', async () => {
  const f = await ready();
  assert.equal((await finalizeSolution(f.store, f.input, f.context, f.files)).status, 'committed');
  const state = f.store.state();
  const w = state.solutionWorkspaces!.find((w) => w.opportunityId === f.input.opportunityId)!;
  const project = state.projects[0];
  state.projects = [
    { ...project, id: 'P1', opportunityId: w.opportunityId },
    { ...project, id: 'P2', opportunityId: w.opportunityId },
  ];
  const first = structuredClone(w.firstFinalization);
  for (const status of ['checking', 'present', 'missing', 'unavailable'] as const) {
    const availability: Record<string, FileAvailability> = Object.fromEntries(
      w.versions.map((v) => [v.id, status]),
    );
    const snapshot = JSON.stringify(state);
    const view = selectManagementBoard(
      state,
      { ...filters, grades: ['B2'], departments: ['solution'], firstResults: [first!.result] },
      dates,
      availability,
    );
    assert.equal(view.businessCount, 1);
    assert.equal(view.projectCount, 2);
    assert.deepEqual(
      view.topFive.map((b) => b.businessId),
      ['DEMO-O008'],
    );
    assert.equal(view.firstResultDenominator, 1);
    assert.equal(view.firstResults[0].count, 1);
    assert.equal(
      view.departmentItems.filter((i) => i.sourceId === 'solution-finalization').length,
      1,
    );
    assert.deepEqual(
      view.firstResults,
      selectManagementStatistics(state, dates, ['DEMO-O008']).firstResults.filter((r) => r.count),
    );
    assert.equal(
      view.exceptions.some((e) => e.id.endsWith('solution-files')),
      status !== 'present',
    );
    assert.equal(
      view.businesses[0].progress.nodes.find((n) => n.nodeId === 'solution.firstFinal')?.status,
      'verified',
    );
    assert.equal(JSON.stringify(state), snapshot);
    assert.deepEqual(w.firstFinalization, first);
    const later = selectManagementBoard(
      state,
      filters,
      createV9Dates('2027-01-01T00:00:00Z', '2026-10-22'),
      availability,
    );
    assert.deepEqual(later.firstResults, view.firstResults);
  }
  assert.equal(await checkSolutionFile(f.files, w.versions[0]), 'present');
  f.rows.clear();
  assert.equal(await checkSolutionFile(f.files, w.versions[0]), 'missing');
  assert.deepEqual(w.firstFinalization, first);
});

import { harness } from './v4-harness';
import { confirmProgressMapping } from '../src/app/core/lifecycle-progress/mapping';
test('计划和映射经公开保存后看板重算最慢精确进度；失败保存不发布预算或进度', () => {
  const { store, role } = harness();
  role('pm');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const p = store.state().projects[0];
  const task = p.plans.find((t) => t.type === '内部WBS' && !t.completionKind)!;
  const save = {
    ...task,
    budgetAmount: 123.45,
    budgetCurrency: 'CNY',
    warningLeadDays: 7,
    status: '未开始',
    actual: '',
  };
  assert.equal(store.savePlan(p.id, save, 'BOARD-PLAN'), true);
  assert.equal(
    confirmProgressMapping(
      store,
      {
        projectId: p.id,
        groupId: 'design',
        planIds: [task.id],
        expectedMappingRevision: 0,
        reason: '真实任务组',
      },
      { workspaceId: 'W', roundId: 'R', operationId: 'BOARD-MAP' },
    ).status,
    'committed',
  );
  const view = () =>
    selectManagementBoard(
      store.state(),
      { ...filters, businessIds: [p.opportunityId], budgetCurrency: 'CNY' },
      dates,
      {},
    );
  const before = view();
  assert.deepEqual(
    before.projects
      .find((v) => v.projectId === p.id)
      ?.progress.nodes.find((n) => n.nodeId === 'execution.design')?.sourceIds,
    [task.id],
  );
  assert.equal(
    store.savePlan(
      p.id,
      {
        ...store.project(p.id)!.plans.find((t) => t.id === task.id)!,
        status: '已完成',
        actual: '2026-10-10',
      },
      'BOARD-DONE',
    ),
    true,
  );
  const after = view();
  assert.equal(
    after.projects
      .find((v) => v.projectId === p.id)
      ?.progress.nodes.find((n) => n.nodeId === 'execution.design')?.status,
    'verified',
  );
  assert.ok(
    after.departmentItems.some(
      (i) => i.sourceRecordId === `${p.id}:${task.id}` && i.status === 'completed',
    ),
  );
  assert.deepEqual(
    view(),
    selectManagementBoard(
      JSON.parse(JSON.stringify(store.state())),
      { ...filters, businessIds: [p.opportunityId], budgetCurrency: 'CNY' },
      dates,
      {},
    ),
  );
  const snapshot = JSON.stringify(store.state());
  globalThis.localStorage.setItem = () => {
    throw Error('quota');
  };
  assert.throws(() => store.savePlan(p.id, { ...save, budgetAmount: 999 }, 'BOARD-FAIL'), /quota/);
  assert.equal(JSON.stringify(store.state()), snapshot);
  assert.deepEqual(view(), after);
});
