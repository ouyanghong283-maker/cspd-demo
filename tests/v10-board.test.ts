import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankPlan, blankProject, blankSales, createSeed } from '../src/app/core/seed';
import { selectV10Board, type V10QueryContext } from '../src/app/core/v10-contracts';
import { emptySolutionWorkspace } from '../src/app/core/solution-workflow/versions';

function fixture() {
  const state = createSeed();
  state.roundId = 'BOARD-ROUND';
  state.dataVersion = 1;
  state.customers = ['C-A', 'C-B'].map((id) => ({ ...state.customers[0], id, name: '同名客户' }));
  state.sales = ['O-A', 'O-B'].map((id, i) => {
    const s = blankSales(id, state.customers[i].id, 'opportunity');
    s.projectName = id;
    s.grade = 'S';
    s.stage = '洽谈';
    return s;
  });
  state.projects = ['P-1', 'P-2', 'P-3'].map((id, i) => {
    const s = state.sales[i === 2 ? 1 : 0];
    return { ...blankProject(id, s.customerId, s.id, ''), name: id, plans: [] };
  });
  const context: V10QueryContext = {
    workspaceId: 'WS-BOARD',
    roundId: state.roundId,
    dataVersion: 1,
    contextRevision: 'READ-1',
    dates: {
      planObservationDate: '2026-10-15',
      solutionBusinessDate: '2026-10-18',
      realNowUtc: '2026-10-18T01:00:00.000Z',
      timezone: 'Asia/Shanghai',
      lastSuccessfulReadAt: null,
    },
    sources: { projects: 'ready', customers: 'ready', opportunities: 'ready' },
    fileAvailability: {},
  };
  return { state, context };
}

test('S01：同名客户分开，执行搜索只改变匹配子项和父组摘要', () => {
  const { state, context } = fixture();
  const before = JSON.stringify(state);
  const all = selectV10Board(state, context, { presales: { scope: 'all' } });
  const found = selectV10Board(state, context, {
    presales: { scope: 'all' },
    execution: { keyword: 'P-2' },
  });
  assert.equal(all.execution.customers!.length, 2);
  assert.deepEqual(
    found.execution.customers!.map((g) => [g.customerId, g.count, g.items.map((p) => p.projectId)]),
    [['C-A', 1, ['P-2']]],
  );
  assert.equal(found.overview.execution.counts!.activeCount, 3);
  assert.deepEqual(found.overview, all.overview);
  assert.deepEqual(found.presales, all.presales);
  assert.equal(all.presales.customers![0].items[0].projects.length, 2);
  assert.equal(all.presales.customers![0].items[0].progress, null);
  assert.equal(JSON.stringify(state), before);
});

test('S02/S06：四态同源，3＋3去重、同级风险优先且输入倒序不影响选择', () => {
  const { state, context } = fixture();
  state.projects = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].map((id) => ({
    ...state.projects[0],
    id,
    name: id,
    plans: [],
  }));
  state.customerDeliveryMappings = [];
  for (const p of state.projects) {
    if (p.id === 'P3') continue;
    for (const category of ['shipment', 'customerAcceptance'] as const) {
      const id = p.id + category;
      const source = {
        ...blankPlan(category === 'shipment' ? '要货发货' : '内部WBS'),
        id,
        customerMilestoneId: id + '-M',
      };
      if (category === 'customerAcceptance') source.completionKind = 'acceptance';
      const end =
        category === 'customerAcceptance'
          ? '2026-12-20'
          : ['P2', 'P5', 'P6'].includes(p.id)
            ? '2026-10-10'
            : ['P1', 'P7'].includes(p.id)
              ? '2026-10-20'
              : '2026-11-20';
      p.plans.push(source, { ...blankPlan('客户主节点'), id: id + '-M', end, warningLeadDays: 5 });
      state.customerDeliveryMappings.push({
        id: id + '-MAP',
        projectId: p.id,
        planId: id,
        customerMilestoneId: id + '-M',
        category,
        source: 'S02/S06',
        revision: 1,
      });
    }
  }
  const r = selectV10Board(state, context);
  assert.deepEqual(r.overview.execution.distribution, {
    delayed: 3,
    warning: 2,
    pending: 1,
    normal: 1,
  });
  assert.deepEqual(
    r.highlights.highGrade!.map((p) => p.projectId),
    ['P2', 'P5', 'P6'],
  );
  assert.deepEqual(
    r.highlights.abnormal!.map((p) => p.projectId),
    ['P1', 'P7'],
  );
  assert.equal(r.highlights.highGrade![0].gradeSource!.opportunityId, 'O-A');
  assert.equal(r.highlights.highGrade![0].delivery!.nextNode!.promisedDate, '2026-10-10');
  state.projects.reverse();
  assert.deepEqual(selectV10Board(state, context).highlights, r.highlights);
  state.projects = state.projects.filter((p) => ['P1', 'P2', 'P3', 'P4'].includes(p.id));
  assert.deepEqual(selectV10Board(state, context).overview.execution.distribution, {
    delayed: 1,
    warning: 1,
    pending: 1,
    normal: 1,
  });
  state.projects = state.projects.filter((p) => p.id === 'P4');
  const short = selectV10Board(state, context);
  assert.equal(short.highlights.highGrade!.length, 1);
  assert.equal(short.highlights.abnormal!.length, 0);
});

test('S07：首屏复用默认整月财务，计划观察档和两块清单筛选均不改变金额', () => {
  const { state, context } = fixture();
  state.financeBatches = [
    {
      batchId: 'S07',
      source: '手算来源',
      primaryCurrency: 'CNY',
      periodStart: '2026-08-01',
      periodEnd: '2026-09-30',
      latestClosedMonth: '2026-09',
      projects: state.projects.map((p) => ({
        projectId: p.id,
        currency: 'CNY',
        months: ['2026-08', '2026-09'],
        completeness: 'complete',
      })),
      facts: [
        {
          factId: 'A8',
          projectId: 'P-1',
          currency: 'CNY',
          month: '2026-08',
          revenueMinor: 60000,
          grossProfitMinor: 8000,
        },
        {
          factId: 'A9',
          projectId: 'P-1',
          currency: 'CNY',
          month: '2026-09',
          revenueMinor: 40000,
          grossProfitMinor: 12000,
        },
        {
          factId: 'B8',
          projectId: 'P-2',
          currency: 'CNY',
          month: '2026-08',
          revenueMinor: 30000,
          grossProfitMinor: -2000,
        },
        {
          factId: 'B9',
          projectId: 'P-2',
          currency: 'CNY',
          month: '2026-09',
          revenueMinor: 20000,
          grossProfitMinor: -3000,
        },
      ],
    },
  ];
  const r = selectV10Board(state, context, {
    presales: { keyword: '不匹配' },
    execution: { status: 'normal' },
  });
  assert.equal(r.overview.finance.summary!.revenueMinor, 150000);
  assert.equal(r.overview.finance.summary!.grossProfitMinor, 15000);
  assert.equal(r.overview.finance.summary!.grossMargin, 0.1);
  assert.deepEqual(r.overview.finance.summary!.coverage, { complete: 2, total: 3 });
  assert.deepEqual(r.overview.finance.period, {
    periodStart: '2026-08-01',
    periodEnd: '2026-09-30',
    asOf: '2026-09-30',
  });
  const changed = selectV10Board(state, {
    ...context,
    dates: { ...context.dates, planObservationDate: '2026-10-22' },
  }).overview.finance;
  assert.deepEqual(changed.summary, r.overview.finance.summary);
  assert.deepEqual(changed.period, r.overview.finance.period);
});

test('独立CLI仅消费公开组合结果，输出与查询一致且原始文件未改写', () => {
  const { state, context } = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'v10-board-'));
  try {
    const input = join(dir, 'workspace.json'),
      ctx = join(dir, 'context.json'),
      filters = join(dir, 'filters.json');
    const raw = JSON.stringify(state);
    writeFileSync(input, raw);
    writeFileSync(ctx, JSON.stringify(context));
    writeFileSync(filters, JSON.stringify({ execution: { keyword: 'P-2' } }));
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/consume-v10-identity.ts', input, ctx, '--board', filters],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.deepEqual(
      JSON.parse(run.stdout),
      JSON.parse(JSON.stringify(selectV10Board(state, context, { execution: { keyword: 'P-2' } }))),
    );
    assert.equal(readFileSync(input, 'utf8'), raw);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('待核关联保留、来源不可读不伪装为零，另一个来源域仍可用', () => {
  const { state, context } = fixture();
  state.projects[0].customerId = 'UNKNOWN';
  const r = selectV10Board(state, context, { presales: { scope: 'all' } });
  assert.equal(r.execution.pending![0].projectId, 'P-1');
  assert.equal(r.overview.execution.counts!.activeCount, 3);
  const fail = selectV10Board(state, {
    ...context,
    sources: { ...context.sources, projects: 'loading' },
  });
  assert.equal(fail.execution.status, 'loading');
  assert.equal(fail.execution.customers, null);
  assert.equal(fail.overview.execution.distribution, null);
  assert.equal(fail.highlights.highGrade, null);
  assert.equal(fail.presales.status, 'ready');
  const emptyState = { ...state, projects: [], sales: [], customers: [] };
  const empty = selectV10Board(emptyState, {
    ...context,
    sources: { projects: 'empty', customers: 'empty', opportunities: 'empty' },
  });
  assert.deepEqual(empty.overview.execution.distribution, {
    delayed: 0,
    warning: 0,
    pending: 0,
    normal: 0,
  });
  assert.deepEqual(empty.execution.customers, []);
});

test('S06：同商机两个项目保留各自进度，等级缺失明确待核且排合法等级后', () => {
  const { state, context } = fixture();
  state.projects.forEach((p, i) => {
    p.pm = '';
    p.team = [];
    p.plans = [
      {
        ...blankPlan('内部WBS'),
        id: p.id + '-DESIGN',
        status: i === 0 ? '已完成' : '未开始',
        actual: i === 0 ? '2026-10-15' : '',
      },
    ];
  });
  state.progressGroupMappings = state.projects.map((p) => ({
    id: p.id + '-MAP',
    projectId: p.id,
    groupId: 'design',
    planIds: [p.plans[0].id],
    sourceTemplateId: null,
    revision: 1,
    history: [],
  }));
  state.sales[0].grade = '';
  const r = selectV10Board(state, context);
  assert.deepEqual(
    r.execution.customers![0].items.map((p) => p.progress!.displayPercent),
    ['5.0', '0.0'],
  );
  assert.deepEqual(
    r.highlights.highGrade!.map((p) => p.projectId),
    ['P-3', 'P-1', 'P-2'],
  );
  assert.equal(r.highlights.highGrade![1].gradeIssue, '关联商机人工等级待核');
});

test('项目结束事实待核不抹掉已可靠关联的人工等级', () => {
  const { state, context } = fixture();
  state.sales[0].grade = 'S';
  state.sales[1].grade = 'A';
  state.projects[0].status = '已完成';
  const r = selectV10Board(state, context);
  const p = r.execution.customers![0].items[0];
  assert.equal(p.executionScope, 'active');
  assert.equal(p.grade, 'S');
  assert.equal(r.highlights.highGrade![0].projectId, 'P-1');
});

test('客户待核摘要独立计入等级和交付待补，不依赖生命周期资料缺失', () => {
  const { state, context } = fixture();
  const sale = state.sales[0],
    project = state.projects[0];
  state.projects = [project];
  state.sales = [sale, { ...blankSales('L-1', sale.customerId, 'lead'), convertedTo: sale.id }];
  sale.leadId = 'L-1';
  sale.productNeeds = [{ id: 'N-1', model: 'PCS', quantity: 1, unit: '台' }];
  sale.productNeedRevision = 1;
  state.storageSchemaVersion = 2;
  const at = context.dates.realNowUtc;
  const person = { personId: 'demo-role:pm', name: '项目经理' };
  state.opportunityG1Checks = [
    {
      id: 'G1',
      opportunityId: sale.id,
      checkVersion: 'v9.1-existing-entry-check',
      sourceRevision: 'R1',
      evidenceIds: ['G1-E'],
      operator: person,
      occurredAt: at,
      origin: 'operation',
    },
  ];
  const outputs = { proposal: 'V-P', bom: 'V-B', sld: 'V-S', degradation: 'V-D' };
  const workspace = emptySolutionWorkspace(sale.id);
  workspace.currentOutputs = outputs;
  workspace.versions = (['proposal', 'bom', 'sld', 'degradation'] as const).map((kind) => ({
    id: outputs[kind],
    opportunityId: sale.id,
    kind,
    number: 1,
    documentId: null,
    fileName: kind + '.pdf',
    size: 1,
    mime: 'application/pdf',
    uploadedAt: at,
    owner: person,
    operator: person,
    note: '已提交来源',
    origin: 'operation',
    uploadEvidence: outputs[kind] + '-E',
    contentState: 'current',
    file: {
      workspaceId: context.workspaceId,
      roundId: context.roundId,
      blobId: outputs[kind],
      versionId: outputs[kind],
    },
  }));
  workspace.finalizations = [
    {
      id: 'F-1',
      opportunityId: sale.id,
      sequence: 1,
      firstEventId: 'F-1',
      fourVersionIds: outputs,
      versionMetadataSnapshot: structuredClone(workspace.versions),
      productNeedRevision: '1',
      owner: person,
      operator: person,
      confirmedAt: at,
      deadlineSnapshot: '2026-10-18',
      scheduleRevision: 1,
      origin: 'operation',
    },
  ];
  workspace.firstFinalization = {
    eventId: 'F-1',
    deadlineDate: '2026-10-18',
    timezone: 'Asia/Shanghai',
    businessDate: '2026-10-18',
    daysEarly: 0,
    result: 'on-time',
  };
  state.solutionWorkspaces = [workspace];
  const documentVersions = { 技术方案: 'D-P', TIC: 'D-T', 设计BOM: 'D-B', SLD: 'D-S' };
  state.solutionDocuments = [
    {
      opportunityId: sale.id,
      current: documentVersions,
      versions: [],
      owner: '方案负责人',
      ownerHistory: [],
      confirmations: [
        {
          id: 'CONF-1',
          createdAt: at,
          owner: '负责人',
          operator: '执行人',
          productNeedRevision: 1,
          documentVersions,
        },
      ],
      fiveCanReviews: [
        {
          id: 'FIVE-1',
          createdAt: at,
          operator: '执行人',
          simulated: true,
          source: '明确会签',
          confirmationId: 'CONF-1',
          solutionOutputIds: outputs,
          conditions: [],
          items: {
            可承诺: { result: '满足', owner: '负责人', opinion: '已核实' },
            可交付: { result: '满足', owner: '负责人', opinion: '已核实' },
            可运维: { result: '满足', owner: '负责人', opinion: '已核实' },
            可验收: { result: '满足', owner: '负责人', opinion: '已核实' },
            可续约: { result: '满足', owner: '负责人', opinion: '已核实' },
          },
        },
      ],
      costings: [
        {
          id: 'COST-1',
          confirmationId: 'CONF-1',
          createdAt: at,
          operator: '执行人',
          simulated: true,
          coefficientSource: '明确核价',
          solutionOutputIds: outputs,
          rows: [
            {
              productNeedId: 'N-1',
              model: 'PCS',
              quantity: 1,
              unit: '台',
              cost: 10,
              guidePrice: 12,
              currency: 'CNY',
              taxBasis: '不含税',
              coefficient: 1.2,
              source: '核价来源',
            },
          ],
        },
      ],
    },
  ];
  const series = structuredClone(state.quoteSeries![0]);
  series.opportunityId = sale.id;
  const quote = series.versions[0];
  delete quote.solutionBasis;
  quote.status = '最终锁定';
  quote.customerId = sale.customerId;
  quote.costingId = 'COST-1';
  quote.sourceSolutionConfirmationId = 'CONF-1';
  quote.sourceProductNeedRevision = 1;
  series.activeFinalVersionId = quote.id;
  state.quoteSeries = [series];
  const contract = structuredClone(state.contracts[0]);
  contract.id = 'CON-1';
  contract.opportunityId = sale.id;
  contract.customerId = sale.customerId;
  contract.status = '已签约';
  state.contracts = [contract];
  project.contractId = contract.id;
  project.pmPersonId = person.personId;
  project.briefing.submission = {
    version: 1,
    submittedBy: '项目经理',
    submittedAt: at,
    opinion: '交底已提交，待后续确认',
    snapshot: {
      contractId: contract.id,
      quoteVersionId: contract.quoteVersionId || '',
      contract: {
        title: contract.title,
        amount: contract.amount,
        currency: contract.currency,
        payment: contract.payment,
        penalty: contract.penalty,
        product: contract.product,
        scope: contract.scope,
      },
      projectName: project.name,
      start: project.start,
      acceptance: project.briefing.acceptance,
      attachmentIds: [],
    },
  };
  project.plans = [blankPlan('FAT测试')];
  state.progressGroupMappings = (
    ['design', 'production', 'shipping', 'arrival-installation'] as const
  ).map((groupId, i) => {
    const plan = { ...blankPlan('内部WBS'), id: 'PROGRESS-' + i };
    project.plans.push(plan);
    return {
      id: 'GROUP-' + i,
      projectId: project.id,
      groupId,
      planIds: [plan.id],
      sourceTemplateId: null,
      revision: 1,
      history: [],
    };
  });
  state.customerDeliveryMappings = [];
  for (const category of ['shipment', 'customerAcceptance'] as const) {
    const id = category + '-SOURCE';
    project.plans.push(
      {
        ...blankPlan(category === 'shipment' ? '要货发货' : '内部WBS'),
        id,
        customerMilestoneId: id + '-M',
        ...(category === 'customerAcceptance' ? { completionKind: 'acceptance' as const } : {}),
      },
      { ...blankPlan('客户主节点'), id: id + '-M', end: '2026-12-20', warningLeadDays: 5 },
    );
    state.customerDeliveryMappings.push({
      id: id + '-MAP',
      projectId: project.id,
      planId: id,
      customerMilestoneId: id + '-M',
      category,
      source: '可靠客户来源',
      revision: 1,
    });
  }
  const baseline = selectV10Board(state, context).execution.customers![0];
  assert.equal(baseline.items[0].incomplete, false, JSON.stringify(baseline.items[0].progress));
  assert.equal(baseline.pendingCount, 0);
  sale.grade = '';
  const gradePending = selectV10Board(state, context).execution.customers![0];
  assert.equal(gradePending.items[0].incomplete, false);
  assert.ok(gradePending.items[0].gradeIssue);
  assert.equal(gradePending.pendingCount, 1);
  sale.grade = 'S';
  const shipment = project.plans.find((p) => p.id === 'shipment-SOURCE')!;
  shipment.status = '已取消';
  project.plans.find((p) => p.id === 'shipment-SOURCE-M')!.end = '2026-10-10';
  const deliveryPending = selectV10Board(state, context).execution.customers![0];
  assert.equal(deliveryPending.items[0].incomplete, false);
  assert.equal(deliveryPending.items[0].delivery!.status, 'delayed');
  assert.equal(deliveryPending.items[0].delivery!.incomplete, true);
  assert.equal(deliveryPending.abnormalCount, 1);
  assert.equal(deliveryPending.pendingCount, 1);
});
