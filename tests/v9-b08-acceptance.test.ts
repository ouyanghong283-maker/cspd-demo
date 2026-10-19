import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { financeTemplate } from '../src/app/core/v4';
import { selectBudgetComparison } from '../src/app/core/budget-comparison';
import type { BudgetCurrency } from '../src/app/core/v9-contracts';

function budgetFixture(amount: number, actual: number, currency: BudgetCurrency = 'CNY') {
  const { store } = harness();
  const state = store.state();
  const project = state.projects[0];
  const base = project.plans.find((p) => p.type === '内部WBS')!;
  project.plans = [{ ...base, id: 'B08-WBS', budgetAmount: amount, budgetCurrency: currency }];
  state.budgetDemoExpenses = [
    {
      expenseId: 'B08-E',
      projectId: project.id,
      planId: 'B08-WBS',
      scope: '全项目',
      amountMinor: actual * 100,
      currency,
      date: '2026-10-10',
      summary: '受控验收费用',
      sourceRecordId: 'B08-S',
      batchId: 'B08',
      cutoff: '2026-10-17',
      origin: 'simulated',
    },
  ];
  state.budgetComparisonSources = [
    {
      projectId: project.id,
      currency,
      expenseIds: ['B08-E'],
      scope: '全项目',
      cutoff: '2026-10-17',
      complete: true,
    },
  ];
  return { store, state, project };
}

test('BUD04/BUD05 预算100的80/95/100/120及两组零预算边界', () => {
  for (const [budget, actual, percent, overspend, status] of [
    [100, 80, 80, 0, '预算内'],
    [100, 95, 95, 0, '接近预算'],
    [100, 100, 100, 0, '接近预算'],
    [100, 120, 120, 2000, '超预算'],
    [0, 0, null, 0, '零预算无支出，执行率不适用'],
    [0, 20, null, 2000, '零预算有支出，状态异常'],
  ] as const) {
    const { state, project } = budgetFixture(budget, actual);
    const before = JSON.stringify(state);
    const result = selectBudgetComparison(state, project.id)[0];
    assert.equal(result.comparable, true);
    assert.equal(result.executionPercent, percent);
    assert.equal(result.overspendMinor, overspend);
    assert.equal(result.budgetStatus, status);
    assert.equal(JSON.stringify(state), before);
  }
});

import { ready } from './v9-finalization-fixture';
import {
  finalizeSolution,
  selectFinalizationSource,
} from '../src/app/core/solution-workflow/finalization';
import { selectLifecycleProgress, PROGRESS_NODES } from '../src/app/core/lifecycle-progress';
import { selectSolutionSchedule } from '../src/app/core/solution-workflow/schedule';
import { createV9Dates } from '../src/app/core/v9-queries';
import {
  confirmProgressMapping,
  selectProgressMapping,
} from '../src/app/core/lifecycle-progress/mapping';
import { setNodeApplicability } from '../src/app/core/lifecycle-progress/applicability';
import { knownDemoPersonId } from '../src/app/core/plan-person';

test('BUD02/BUD03 四来源共存只读指定模拟费用；缺范围/截止日/部分预算不可比', () => {
  const { state, project } = budgetFixture(100, 80);
  const financial = financeTemplate(project.id);
  financial.expenses = financial.expenses.map((e) => ({ ...e, amount: 900000, currency: 'CNY' }));
  financial.cumulativeActualCost = {
    projectId: project.id,
    source: 'SAP',
    amount: 800000,
    currency: 'CNY',
    scope: '全项目',
    cutoff: '2026-10-17',
  };
  state.financeSnapshots = [financial];
  state.finalActualCosts = [
    {
      id: 'FINAL',
      projectId: project.id,
      revision: 1,
      amount: 700000,
      currency: 'CNY',
      scope: '全项目',
      cutoff: '2026-10-17',
      confirmedDate: '2026-10-17',
      provider: '黄财务',
      documentId: 'FINAL-DOC',
      reason: '受控决算对照',
      zeroReason: '',
      operator: '黄财务',
      createdAt: '2026-10-17T00:00:00Z',
      operationId: 'FINAL',
    },
  ];
  assert.equal(selectBudgetComparison(state, project.id)[0].expenseMinor, 8000);
  const source = state.budgetComparisonSources![0];
  for (const field of ['scope', 'cutoff'] as const) {
    const previous = source[field];
    source[field] = '';
    const view = selectBudgetComparison(state, project.id)[0];
    assert.equal(view.comparable, false);
    assert.ok(view.reason);
    source[field] = previous;
  }
  delete project.plans[0].budgetAmount;
  assert.equal(selectBudgetComparison(state, project.id)[0].comparable, false);
  assert.match(selectBudgetComparison(state, project.id)[0].reason!, /部分预算/);
});

test('BUD06 同合同多项目只取各项目费用，EUR/USD/CNY保持分开', () => {
  const { state, project } = budgetFixture(100, 80);
  const other = structuredClone(project);
  other.id = 'B08-P2';
  state.projects.push(other);
  const e = state.budgetDemoExpenses![0];
  state.budgetDemoExpenses!.push({
    ...e,
    expenseId: 'OTHER',
    projectId: other.id,
    amountMinor: 999900,
  });
  state.budgetComparisonSources!.push({
    ...state.budgetComparisonSources![0],
    projectId: other.id,
    expenseIds: ['OTHER'],
  });
  assert.equal(project.contractId, other.contractId);
  assert.equal(selectBudgetComparison(state, project.id)[0].expenseMinor, 8000);
  assert.equal(selectBudgetComparison(state, other.id)[0].expenseMinor, 999900);
  for (const currency of ['CNY', 'EUR', 'USD'] as const) {
    const { state, project } = budgetFixture(100, 80, currency);
    assert.deepEqual(
      selectBudgetComparison(state, project.id).map((v) => [v.currency, v.expenseMinor]),
      [[currency, 8000]],
    );
  }
});

test('PRG01 PRD04的21个固定节点逐项权重及100分一致', () => {
  assert.deepEqual(
    PROGRESS_NODES.map((n) => [n.id, n.weight]),
    [
      ['lead.converted', 5],
      ['opportunity.g1', 5],
      ['solution.proposal', 3],
      ['solution.bom', 3],
      ['solution.sld', 3],
      ['solution.degradation', 3],
      ['solution.firstFinal', 8],
      ['quote.fiveCan', 3],
      ['quote.costing', 3],
      ['quote.locked', 4],
      ['startup.contract', 3],
      ['startup.pm', 2],
      ['startup.handover', 5],
      ['execution.design', 5],
      ['execution.production', 15],
      ['execution.fat', 5],
      ['execution.shipment', 5],
      ['execution.arrivalInstall', 8],
      ['execution.sat', 5],
      ['execution.acceptance', 4],
      ['execution.serviceHandover', 3],
    ],
  );
  assert.equal(
    PROGRESS_NODES.reduce((n, x) => n + x.weight, 0),
    100,
  );
});

test('FIN03/PRG03 少一类、无期限、模拟旧文件均拒绝；四类12分首次后20分', async () => {
  const { store, input, context, files } = await ready();
  const w = store.state().solutionWorkspaces!.find((w) => w.opportunityId === input.opportunityId)!;
  const before = structuredClone(w);
  delete w.currentOutputs.degradation;
  assert.equal((await finalizeSolution(store, input, context, files)).status, 'rejected');
  assert.equal(w.firstFinalization, null);
  Object.assign(w, structuredClone(before));
  w.schedule = null;
  assert.ok(
    selectFinalizationSource(store.state(), input.opportunityId, null).issues.some(
      (i) => i.field === 'deadline',
    ),
  );
  assert.equal((await finalizeSolution(store, input, context, files)).status, 'rejected');
  Object.assign(w, structuredClone(before));
  for (const v of w.versions) v.origin = 'simulated';
  assert.equal((await finalizeSolution(store, input, context, files)).status, 'rejected');
  Object.assign(w, structuredClone(before));
  const score = () =>
    selectLifecycleProgress(store.state(), input.opportunityId, null)
      .nodes.filter((n) => n.nodeId.startsWith('solution.'))
      .reduce((s, n) => s + (n.status === 'verified' ? n.weight : 0), 0);
  assert.equal(score(), 12);
  assert.equal((await finalizeSolution(store, input, context, files)).status, 'committed');
  assert.equal(score(), 20);
});

test('DAT03 无期限待设置、截止当天未定稿、上海次日逾期1天无临期类别', async () => {
  const { store, input } = await ready();
  const state = store.state();
  const dates = (utc: string) => createV9Dates(utc, '2026-10-15');
  assert.equal(
    selectSolutionSchedule(state, input.opportunityId, dates('2026-10-20T15:59:59Z')).status,
    '未定稿',
  );
  const next = selectSolutionSchedule(state, input.opportunityId, dates('2026-10-20T16:00:00Z'));
  assert.equal(next.status, '逾期未定稿');
  assert.equal(next.overdueDays, 1);
  state.solutionWorkspaces!.find((w) => w.opportunityId === input.opportunityId)!.schedule = null;
  assert.equal(
    selectSolutionSchedule(state, input.opportunityId, dates('2026-10-20T16:00:00Z')).status,
    '待设置',
  );
});

test('PRG05 删除和取消固定成员都保留分母并标映射待处理', () => {
  for (const action of ['delete', 'cancel']) {
    const { store, role } = harness();
    role('pm');
    store.state().roundId = 'R';
    Object.assign(store, { activeWorkspaceId: 'W' });
    const p = store.state().projects[0];
    p.plans = p.plans.filter((p) => p.type === '内部WBS').slice(0, 2);
    assert.equal(
      confirmProgressMapping(
        store,
        {
          projectId: p.id,
          groupId: 'design',
          planIds: p.plans.map((p) => p.id),
          expectedMappingRevision: 0,
          reason: '固定两项',
        },
        { workspaceId: 'W', roundId: 'R', operationId: 'mapping' },
      ).status,
      'committed',
    );
    const current = store.project(p.id)!;
    if (action === 'delete') current.plans.pop();
    else current.plans[1].status = '已取消';
    const g = selectProgressMapping(store.state(), p.id).groups.find(
      (g) => g.groupId === 'design',
    )!;
    assert.equal(g.total, 2);
    assert.equal(g.pending, true);
    assert.equal(g.done, 0);
  }
});

test('PRG06 免做缺原因拒绝；可免FAT不补造FAT报告或验收移交事实', () => {
  const { store, role } = harness();
  role('pm');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const p = store.state().projects[0];
  const ctx = { workspaceId: 'W', roundId: 'R', operationId: 'optional' };
  const input = {
    projectId: p.id,
    nodeId: 'execution.fat',
    applicability: 'not-required' as const,
    pmPersonId: knownDemoPersonId(p.pm)!,
    reason: '',
  };
  const before = JSON.stringify(store.state());
  assert.equal(setNodeApplicability(store, input, ctx).status, 'rejected');
  assert.equal(JSON.stringify(store.state()), before);
  const attachments = JSON.stringify(store.state().attachments),
    plans = JSON.stringify(p.plans);
  assert.equal(
    setNodeApplicability(store, { ...input, reason: '合同无需工厂验收' }, ctx).status,
    'committed',
  );
  assert.equal(JSON.stringify(store.state().attachments), attachments);
  assert.equal(JSON.stringify(store.project(p.id)!.plans), plans);
  for (const nodeId of [
    'solution.proposal',
    'solution.bom',
    'solution.sld',
    'solution.degradation',
    'execution.acceptance',
    'execution.serviceHandover',
  ])
    assert.equal(
      setNodeApplicability(
        store,
        { ...input, nodeId, reason: '尝试越权免做' },
        { ...ctx, operationId: nodeId },
      ).status,
      'rejected',
    );
});

import { selectManagementBoard } from '../src/app/core/management-board';
import {
  selectCompleteWorkItems,
  selectManagementStatistics,
} from '../src/app/core/management-statistics';

test('BRD03 延期、逾期已完成、缺责任、超支共存且完成事项不算当前延期', () => {
  const { state, project } = budgetFixture(100, 120);
  const base = project.plans[0];
  project.pm = '';
  project.plans.push(
    {
      ...base,
      id: 'OPEN',
      budgetAmount: 0,
      name: 'B08延期',
      end: '2026-10-10',
      status: '进行中',
      actual: '',
    },
    {
      ...base,
      id: 'DONE',
      budgetAmount: 0,
      name: 'B08逾期已完成',
      end: '2026-10-10',
      status: '已完成',
      actual: '2026-10-12',
    },
  );
  const view = selectManagementBoard(
    state,
    { projectIds: [], businessIds: [], grades: [], departments: [], firstResults: [], query: '' },
    createV9Dates('2026-10-17T00:00:00Z', '2026-10-15'),
    {},
  );
  assert.ok(view.exceptions.some((e) => e.reason.includes('B08延期')));
  assert.ok(!view.exceptions.some((e) => e.reason.includes('B08逾期已完成')));
  assert.ok(view.exceptions.some((e) => e.reason === '项目负责人待补' && e.owner === null));
  assert.ok(
    view.exceptions.some((e) => e.category === 'over-budget' && e.projectId === project.id),
  );
});

test('BRD04 同一稳定事项不因多人团队放大，无法归属的部门单列unknown', () => {
  const { store } = harness();
  const state = store.state(),
    project = state.projects[0];
  const base = project.plans[0];
  project.plans = [
    { ...base, id: 'TEAM-ONE', owner: '主责甲', ownerPersonId: 'PERSON-A', status: '进行中' },
  ];
  project.team = [
    {
      ...project.team[0],
      id: 'MEMBER-A',
      personId: 'PERSON-A',
      person: '主责甲',
      department: '解决方案',
    },
    {
      ...project.team[0],
      id: 'MEMBER-B',
      personId: 'PERSON-B',
      person: '参与乙',
      department: '销售',
    },
  ];
  const dates = createV9Dates('2026-10-17T00:00:00Z', '2026-10-15');
  let items = selectCompleteWorkItems(state, dates).filter(
    (i) => i.sourceRecordId === project.id + ':TEAM-ONE',
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].department, 'solution');
  const before = selectManagementStatistics(state, dates).departments.find(
    (d) => d.department === 'unknown',
  )!.total;
  project.team[0].department = '未识别部门';
  items = selectCompleteWorkItems(state, dates).filter(
    (i) => i.sourceRecordId === project.id + ':TEAM-ONE',
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].department, 'unknown');
  assert.equal(
    selectManagementStatistics(state, dates).departments.find((d) => d.department === 'unknown')!
      .total,
    before + 1,
  );
});

import { backfillProjectWarnings } from '../src/app/core/plan-warning-backfill';

test('MIG04 历史预警0/7保留、缺值只补一次，观察档不改且主动清空不再补写', () => {
  const { store } = harness();
  const state = store.state(),
    p = state.projects[0];
  const base = p.plans[0];
  state.projects = [p];
  delete state.projectWarningBackfillVersion;
  p.plans = [
    { ...base, id: 'ZERO', warningLeadDays: 0 },
    { ...base, id: 'SEVEN', warningLeadDays: 7 },
    { ...base, id: 'MISSING', warningLeadDays: undefined },
  ];
  const beforeMode = state.dateMode;
  assert.equal(backfillProjectWarnings(state), 1);
  assert.deepEqual(
    p.plans.map((p) => p.warningLeadDays),
    [0, 7, 7],
  );
  assert.equal(state.dateMode, beforeMode);
  const before = JSON.stringify(state);
  assert.equal(backfillProjectWarnings(state), 0);
  assert.equal(JSON.stringify(state), before);
  delete p.plans[2].warningLeadDays;
  assert.equal(backfillProjectWarnings(state), 0);
  assert.equal(p.plans[2].warningLeadDays, undefined);
});
