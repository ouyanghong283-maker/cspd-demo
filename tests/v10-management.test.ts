import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankPlan, blankProject, blankSales, createSeed } from '../src/app/core/seed';
import {
  selectV10Board,
  selectV10Exceptions,
  selectV10ProjectFinance,
  selectV10ProjectDelivery,
  type V10QueryContext,
} from '../src/app/core/v10-contracts';

function fixture() {
  const state = createSeed();
  state.roundId = 'ROUND-MANAGEMENT';
  state.dataVersion = 1;
  state.customers = [state.customers[0]];
  const sale = blankSales('O1', state.customers[0].id, 'opportunity');
  sale.grade = 'S';
  sale.stage = '洽谈';
  sale.departmentTasks = [{ id: 'TASK', name: '售前协同', department: '销售', status: '进行中' }];
  state.sales = [sale];
  state.projects = ['P1', 'P2'].map((id) => ({
    ...blankProject(id, sale.customerId, sale.id, ''),
    plans: [],
    team: [],
  }));
  const plan = {
    ...blankPlan('内部WBS'),
    id: 'WBS',
    name: '独立内部设计',
    end: '2026-10-10',
    owner: '王项目',
    status: '待开始' as const,
  };
  state.projects[0].plans = [plan, { ...plan }];
  state.projects[0].team = [
    { ...createSeed().projects[0].team[0], id: 'T1', person: '王项目', department: '未识别部门' },
  ];
  state.solutionWorkspaces = [];
  state.solutionSeries = [];
  state.solutionDocuments = [];
  state.customerDeliveryMappings = [];
  const context: V10QueryContext = {
    workspaceId: 'WS-MGMT',
    roundId: state.roundId,
    dataVersion: 1,
    contextRevision: 'READ-1',
    sources: { projects: 'ready', customers: 'ready', opportunities: 'ready' },
    fileAvailability: {},
    dates: {
      planObservationDate: '2026-10-15',
      solutionBusinessDate: '2026-10-19',
      realNowUtc: '2026-10-18T16:00:00.000Z',
      timezone: 'Asia/Shanghai',
      lastSuccessfulReadAt: null,
    },
  };
  return { state, context, sale };
}

test('S11：四部门及未知部门分别统计，稳定事项去重且底部筛选不改首屏或客户清单', () => {
  const { state, context } = fixture();
  const before = JSON.stringify(state);
  const r = selectV10Board(state, context);
  assert.deepEqual(
    r.bottom.departments.summary!.map((d) => [d.department, d.total, d.completed, d.overdueOpen]),
    [
      ['sales', 1, 0, 0],
      ['solution', 0, 0, 0],
      ['pm-pmo', 0, 0, 0],
      ['service', 0, 0, 0],
      ['unknown', 1, 0, 1],
    ],
  );
  const filtered = selectV10Board(state, context, { bottom: { department: 'sales' } });
  assert.equal(filtered.bottom.departments.items!.length, 1);
  assert.deepEqual(filtered.overview, r.overview);
  assert.deepEqual(filtered.execution, r.execution);
  assert.deepEqual(filtered.presales, r.presales);
  assert.equal(JSON.stringify(state), before);
});

function addSolution(state: ReturnType<typeof createSeed>, id: string) {
  const person = { personId: 'SOL', name: '方案负责人' };
  const w: NonNullable<typeof state.solutionWorkspaces>[number] = {
    id: 'SW-' + id,
    opportunityId: id,
    revision: 1,
    productNeedRevision: '1',
    versions: [],
    currentOutputs: {},
    schedule: {
      opportunityId: id,
      pm: person,
      owner: person,
      deadlineDate: '2026-10-18',
      timezone: 'Asia/Shanghai',
      revision: 1,
      frozenByEventId: null,
    },
    scheduleChanges: [],
    finalizations: [],
    firstFinalization: null,
    legacyFacts: [],
  };
  state.solutionWorkspaces!.push(w);
  return w;
}

test('S11：一商机两项目只计一次首次事件，历史未评分和未定稿单列，成绩筛选只影响自身', () => {
  const { state, context, sale } = fixture();
  const w = addSolution(state, sale.id);
  w.firstFinalization = {
    eventId: 'FIRST',
    deadlineDate: '2026-10-18',
    businessDate: '2026-10-10',
    daysEarly: 8,
    timezone: 'Asia/Shanghai',
    result: 'early',
  };
  w.finalizations = [
    {
      id: 'FIRST',
      opportunityId: sale.id,
      sequence: 1,
      firstEventId: 'FIRST',
      fourVersionIds: { proposal: 'V1', bom: 'V2', sld: 'V3', degradation: 'V4' },
      versionMetadataSnapshot: [],
      productNeedRevision: '1',
      owner: w.schedule!.owner,
      operator: w.schedule!.owner,
      confirmedAt: '2026-10-10T01:00:00.000Z',
      deadlineSnapshot: '2026-10-18',
      scheduleRevision: 1,
      origin: 'simulated',
    },
  ];
  w.finalizations.push({
    ...w.finalizations[0],
    id: 'SECOND',
    sequence: 2,
    confirmedAt: '2026-10-19T01:00:00.000Z',
  });
  for (const id of ['O2', 'O3']) state.sales.push({ ...sale, id, departmentTasks: [] });
  const historical = addSolution(state, 'O2');
  historical.legacyFacts = [{ id: 'LEGACY', type: '旧定稿', origin: 'legacy', original: {} }];
  const r = selectV10Board(state, context);
  assert.equal(r.bottom.firstFinalizations.denominator, 1);
  assert.deepEqual(r.bottom.firstFinalizations.counts, {
    early: 1,
    'on-time': 0,
    late: 0,
    'historical-unscored': 1,
    'not-finalized': 1,
    pending: 0,
  });
  assert.deepEqual(r.bottom.firstFinalizations.items![0].projectIds, ['P1', 'P2']);
  const filtered = selectV10Board(state, context, {
    bottom: { firstResult: 'historical-unscored' },
  });
  assert.equal(filtered.bottom.firstFinalizations.items!.length, 1);
  assert.deepEqual(filtered.bottom.departments, r.bottom.departments);
  assert.deepEqual(filtered.overview, r.overview);
  state.notices.forEach((n) => {
    n.read = true;
  });
  assert.deepEqual(selectV10Board(state, context).bottom, r.bottom);
});

test('方案共享只出一项，内部计划与客户交付不重复，预算不可比与超支分开', () => {
  const { state, context, sale } = fixture();
  addSolution(state, sale.id);
  const p = state.projects[0];
  p.plans[0].budgetAmount = 100;
  p.plans[0].budgetCurrency = 'CNY';
  p.plans[1] = { ...p.plans[0] };
  const ship = {
    ...blankPlan('要货发货'),
    id: 'SHIP',
    customerMilestoneId: 'PROMISE',
    end: '2026-10-09',
    expected: '2026-10-09',
  };
  p.plans.push(ship, {
    ...blankPlan('客户主节点'),
    id: 'PROMISE',
    end: '2026-10-09',
    warningLeadDays: 5,
  });
  state.customerDeliveryMappings = [
    {
      id: 'MAP',
      projectId: p.id,
      planId: 'SHIP',
      customerMilestoneId: 'PROMISE',
      category: 'shipment',
      source: '客户承诺',
      revision: 1,
    },
  ];
  state.budgetComparisonSources = [
    {
      projectId: p.id,
      currency: 'CNY',
      scope: '全项目',
      cutoff: '2026-10-10',
      complete: true,
      expenseIds: ['E'],
    },
  ];
  state.budgetDemoExpenses = [
    {
      expenseId: 'E',
      projectId: p.id,
      planId: 'WBS',
      currency: 'CNY',
      amountMinor: 12000,
      scope: '全项目',
      date: '2026-10-10',
      cutoff: '2026-10-10',
      batchId: 'B',
      sourceRecordId: 'E',
      origin: 'simulated',
    },
  ];
  const before = JSON.stringify(state);
  const r = selectV10Exceptions(state, context, { tab: 'management' });
  assert.equal(r.status, 'ready');
  const items = r.management!.items;
  const solution = items.filter((i) => i.sourceType === 'solution');
  assert.equal(solution.length, 1);
  assert.equal(solution[0].category, 'solution-overdue');
  assert.deepEqual(solution[0].projectIds, ['P1', 'P2']);
  assert.equal(items.filter((i) => i.category === 'internal-delay').length, 1);
  assert.equal(
    items.find((i) => i.category === 'internal-delay')!.sourceRecordId,
    JSON.stringify(['P1', 'WBS']),
  );
  assert.equal(items.filter((i) => i.category === 'over-budget').length, 1);
  assert.ok(items.some((i) => i.category === 'budget-incomparable' && i.projectIds.includes('P2')));
  assert.deepEqual(
    items.slice(0, 3).map((i) => i.category),
    ['internal-delay', 'solution-overdue', 'over-budget'],
  );
  assert.equal(JSON.stringify(state), before);
  const delivery = selectV10Exceptions(state, context);
  assert.equal(delivery.delivery!.projectCount, 2);
  assert.equal(
    delivery.delivery!.projects.find((p) => p.projectId === 'P1')!.delivery!.status,
    'delayed',
  );
});

test('来源分域不可读、首次事件冲突与任务冲突均显式待核，不任取记录', () => {
  const { state, context, sale } = fixture();
  const loading = selectV10Board(state, {
    ...context,
    sources: { ...context.sources, solutions: 'loading' },
  });
  assert.equal(loading.bottom.firstFinalizations.status, 'loading');
  assert.equal(loading.bottom.firstFinalizations.counts, null);
  assert.equal(loading.overview.execution.counts!.projectCount, 2);
  assert.equal(
    selectV10Exceptions(
      state,
      { ...context, sources: { ...context.sources, finance: 'unavailable' } },
      { tab: 'management' },
    ).management,
    null,
  );
  const w = addSolution(state, sale.id);
  state.solutionWorkspaces!.push(structuredClone(w));
  sale.departmentTasks!.push({ ...sale.departmentTasks![0], status: '已完成' });
  const r = selectV10Board(state, context);
  assert.equal(r.bottom.firstFinalizations.counts!.pending, 1);
  assert.equal(r.bottom.firstFinalizations.counts!['not-finalized'], 0);
  assert.equal(
    r.bottom.departments.items!.filter((i) => i.sourceId === 'department-task').length,
    0,
  );
  assert.ok(r.bottom.issues.some((i) => i.field.startsWith('departmentTasks:O1')));
});

test('共享商机事项保留全部项目引用且不因项目输入顺序改挂到另一项目', () => {
  const { state, context } = fixture();
  const r = selectV10Board(state, context);
  const task = r.bottom.departments.items!.find((i) => i.sourceId === 'department-task')!;
  assert.equal(task.projectId, null);
  assert.deepEqual(task.projectIds, ['P1', 'P2']);
  state.projects.reverse();
  const reversed = selectV10Board(state, context);
  assert.deepEqual(reversed.bottom, r.bottom);
});

test('五个公开查询有正常、空集合、不可读的CLI消费，查询及输入文件零写入', () => {
  const directory = mkdtempSync(join(tmpdir(), 'v10-management-'));
  try {
    for (const scenario of ['ready', 'empty', 'unavailable'] as const) {
      const { state, context } = fixture();
      state.financeBatches = [
        {
          batchId: 'CONSUME',
          source: '独立消费样例',
          primaryCurrency: 'CNY',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          latestClosedMonth: '2026-09',
          projects: state.projects.map((p) => ({
            projectId: p.id,
            currency: 'CNY',
            months: ['2026-09'],
            completeness: 'complete',
          })),
          facts: [
            {
              factId: 'F1',
              projectId: 'P1',
              currency: 'CNY',
              month: '2026-09',
              revenueMinor: 50000,
              grossProfitMinor: 10000,
            },
          ],
        },
      ];
      if (scenario === 'empty') {
        state.projects = [];
        state.sales = [];
        state.customers = [];
        state.solutionWorkspaces = [];
        state.financeBatches = [];
      }
      if (scenario !== 'ready')
        context.sources = {
          projects: scenario,
          opportunities: scenario,
          customers: scenario,
          finance: scenario,
          solutions: scenario,
          workItems: scenario,
        };
      const raw = JSON.stringify(state),
        original = structuredClone(state);
      const input = join(directory, 'input.json'),
        ctx = join(directory, 'context.json'),
        conditions = join(directory, 'filters.json');
      writeFileSync(input, raw);
      writeFileSync(ctx, JSON.stringify(context));
      for (const mode of ['--board', '--exceptions', '--delivery', '--finance']) {
        const filters = mode === '--exceptions' ? { tab: 'management' } : {};
        writeFileSync(conditions, JSON.stringify(filters));
        const run = spawnSync(
          process.execPath,
          ['--import', 'tsx', 'scripts/consume-v10-identity.ts', input, ctx, mode, conditions],
          { encoding: 'utf8' },
        );
        assert.equal(run.status, scenario === 'unavailable' ? 1 : 0, run.stdout + run.stderr);
        const result = JSON.parse(run.stdout);
        if (mode === '--board')
          assert.deepEqual(result, JSON.parse(JSON.stringify(selectV10Board(state, context))));
        if (mode === '--exceptions')
          assert.deepEqual(
            result,
            JSON.parse(JSON.stringify(selectV10Exceptions(state, context, { tab: 'management' }))),
          );
        if (mode === '--delivery' && scenario === 'empty')
          assert.deepEqual(result.counts, { delayed: 0, warning: 0, pending: 0, normal: 0 });
        if (mode === '--finance' && scenario === 'empty')
          assert.equal(result.projectDrilldowns, null);
        if (mode === '--finance' && scenario === 'ready') {
          assert.ok(Array.isArray(result.projectDrilldowns));
          assert.equal(result.projectDrilldowns.length, 2);
          assert.equal(result.summary.revenueMinor, 50000);
          assert.equal(result.projectDrilldowns[0].project.grossProfitMinor, 10000);
          assert.ok(
            result.projectDrilldowns.every((p: { scope: string }) => p.scope === 'project-finance'),
          );
        }
      }
      const projectFinance = selectV10ProjectFinance(state, context, 'P1');
      const projectDelivery = selectV10ProjectDelivery(state, context, 'P1');
      if (scenario === 'ready') {
        assert.equal(projectFinance.project!.grossProfitMinor, 10000);
        assert.equal(projectDelivery.delivery!.status, 'pending');
      }
      if (scenario === 'unavailable') {
        assert.equal(projectFinance.project, null);
        assert.equal(projectDelivery.delivery, null);
      }
      assert.equal(readFileSync(input, 'utf8'), raw);
      assert.deepEqual(state, original);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('客户关联待核不冒充共享事项的项目归属', () => {
  const { state, context } = fixture();
  state.projects[1].customerId = 'CONFLICTING-CUSTOMER';
  const board = selectV10Board(state, context);
  assert.deepEqual(
    board.bottom.departments.items!.find((i) => i.sourceId === 'department-task')!.projectIds,
    ['P1'],
  );
  assert.ok(!board.bottom.departments.collaboration!.some((g) => g.projectId === 'P2'));
});

test('内部事项不可读不判延期，缺负责人或期限的计划有独立待核入口', () => {
  const { state, context } = fixture();
  const failed = selectV10Exceptions(
    state,
    { ...context, sources: { ...context.sources, workItems: 'unavailable' } },
    { tab: 'management' },
  );
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.management, null);
  state.projects[0].plans = [{ ...state.projects[0].plans[0], end: '', owner: '' }];
  const r = selectV10Exceptions(state, context, { tab: 'management', projectId: 'P1' });
  const pending = r.management!.items.find(
    (i) => i.sourceType === 'plan' && i.category === 'data-review',
  )!;
  assert.ok(pending);
  assert.ok(pending.reasons.some((s) => s.includes('期限')));
  assert.ok(pending.reasons.some((s) => s.includes('责任')));
  assert.ok(pending.sourceHref!.includes('planId=WBS'));
  state.projects[0].plans[0].owner = '王项目';
  state.projects[0].team[0].department = 'PMO';
  const byDepartment = selectV10Exceptions(state, context, {
    tab: 'management',
    department: 'pm-pmo',
  });
  assert.ok(
    byDepartment.management!.items.some(
      (i) => i.sourceType === 'plan' && i.category === 'data-review',
    ),
  );
});

test('冲突计划的关联问题回到真实项目，不生成同名虚假项目入口', () => {
  const { state, context } = fixture();
  state.projects[0].plans[1].end = '2026-11-01';
  const issues = selectV10Exceptions(state, context, { tab: 'management' }).management!.items;
  const conflict = issues.find(
    (i) => i.sourceType === 'association' && i.reasons.some((s) => s.includes('冲突')),
  )!;
  assert.deepEqual(conflict.projectIds, ['P1']);
  assert.equal(conflict.sourceHref, '/projects/P1');
});

test('首次事件依据缺失不算部门已完成，明确列为待核', () => {
  const { state, context, sale } = fixture();
  const w = addSolution(state, sale.id);
  w.firstFinalization = {
    eventId: 'NO-EVIDENCE',
    deadlineDate: '2026-10-18',
    businessDate: '2026-10-10',
    daysEarly: 8,
    timezone: 'Asia/Shanghai',
    result: 'early',
  };
  const r = selectV10Board(state, context);
  assert.equal(r.bottom.firstFinalizations.counts!.pending, 1);
  assert.equal(r.bottom.firstFinalizations.denominator, 0);
  const dept = r.bottom.departments.summary!.find((d) => d.department === 'solution')!;
  assert.equal(dept.completed, 0);
  assert.equal(dept.pending, 1);
  assert.equal(
    r.bottom.departments.items!.find((i) => i.sourceId === 'solution-finalization')!.status,
    'pending',
  );
});

test('预算超支只在同币种内按偏差排序，零预算有支出优先，跨币种和输入倒序保持稳定', () => {
  const { state, context } = fixture();
  state.projects = ['P1', 'P2', 'P3'].map((id, i) => ({
    ...state.projects[0],
    id,
    name: id,
    plans: [
      {
        ...state.projects[0].plans[0],
        id: 'B',
        budgetAmount: i === 2 ? 0 : 100,
        budgetCurrency: i === 1 ? 'EUR' : 'CNY',
      },
    ],
  }));
  state.budgetComparisonSources = state.projects.map((p, i) => ({
    projectId: p.id,
    currency: i === 1 ? 'EUR' : 'CNY',
    scope: '全项目',
    cutoff: '2026-10-10',
    complete: true,
    expenseIds: [p.id + '-E'],
  }));
  state.budgetDemoExpenses = state.projects.map((p, i) => ({
    expenseId: p.id + '-E',
    projectId: p.id,
    planId: 'B',
    currency: i === 1 ? 'EUR' : 'CNY',
    amountMinor: [11000, 30000, 50][i],
    scope: '全项目',
    date: '2026-10-10',
    cutoff: '2026-10-10',
    batchId: 'B',
    sourceRecordId: p.id + '-E',
    origin: 'simulated',
  }));
  const get = () =>
    selectV10Exceptions(state, context, { tab: 'management', category: 'over-budget' }).management!
      .items;
  assert.deepEqual(
    get().map((i) => i.projectIds[0]),
    ['P3', 'P1', 'P2'],
  );
  const original = get();
  state.projects.reverse();
  assert.deepEqual(get(), original);
});

test('尚未转项目的商机客户关联待核也有独立的关联异常入口', () => {
  const { state, context, sale } = fixture();
  state.projects = [];
  sale.customerId = 'MISSING-CUSTOMER';
  const r = selectV10Exceptions(state, context, { tab: 'management', category: 'data-review' });
  const pending = r.management!.items.find(
    (i) => i.sourceType === 'association' && i.opportunityIds.includes(sale.id),
  );
  assert.ok(pending);
  assert.equal(pending.sourceHref, '/sales/detail/O1');
  assert.ok(r.issues.some((i) => i.objectId === 'O1' && i.field === 'customerId'));
});
