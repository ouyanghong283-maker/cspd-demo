import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import {
  selectV10Finance,
  selectV10ProjectFinance,
  type V10QueryContext,
} from '../src/app/core/v10-contracts';
function fixture() {
  const { store } = harness();
  const state = structuredClone(store.state());
  state.roundId = 'DETAIL-ROUND';
  state.dataVersion = 1;
  const template = state.projects[0];
  const plan = template.plans.find((p) => p.type === '内部WBS')!;
  state.projects = ['P1', 'P2'].map((id) => ({
    ...structuredClone(template),
    id,
    plans: [
      { ...plan, id: 'W1', budgetAmount: 100, budgetCurrency: 'CNY', status: '未开始' as const },
    ],
  }));
  state.financeBatches = [
    {
      batchId: 'DETAIL',
      source: '独立样例',
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
      facts: state.projects.map((p) => ({
        factId: p.id,
        projectId: p.id,
        currency: 'CNY',
        month: '2026-09',
        revenueMinor: 1000,
        grossProfitMinor: 100,
      })),
    },
  ];
  state.budgetComparisonSources = [
    {
      projectId: 'P1',
      currency: 'CNY',
      scope: '全项目',
      cutoff: '2026-10-15',
      complete: true,
      expenseIds: ['E1', 'E2'],
    },
  ];
  state.budgetDemoExpenses = ['E1', 'E2'].map((expenseId) => ({
    expenseId,
    projectId: 'P1',
    planId: 'W1',
    currency: 'CNY',
    amountMinor: 9000,
    scope: '全项目',
    date: '2026-10-10',
    summary: '同来源重复登记',
    sourceRecordId: 'SRC1',
    batchId: 'B1',
    cutoff: '2026-10-15',
    origin: 'simulated',
  }));
  state.financeSnapshots = [];
  state.contractInvoices = [];
  state.finalActualCosts = [];
  const context: V10QueryContext = {
    workspaceId: 'DETAIL-WS',
    roundId: state.roundId,
    dataVersion: 1,
    contextRevision: 'D1',
    dates: {
      planObservationDate: '2026-10-15',
      solutionBusinessDate: '2026-10-15',
      realNowUtc: '2026-10-18T00:00:00Z',
      timezone: 'Asia/Shanghai',
      lastSuccessfulReadAt: null,
    },
    fileAvailability: {},
    sources: { projects: 'ready', customers: 'ready', opportunities: 'ready', finance: 'ready' },
  };
  return { state, context };
}
test('公开财务读取原预算、重复模拟支出只计一次且保留自身截止日', () => {
  const { state, context } = fixture();
  state.projects[0].plans.push(structuredClone(state.projects[0].plans[0]));
  const before = JSON.stringify(state);
  const r = selectV10ProjectFinance(state, context, 'P1');
  const b = r.project!.details.budget[0];
  assert.equal(b.budgetMinor, 10000);
  assert.equal(b.expenseMinor, 9000);
  assert.equal(b.executionPercent, 90);
  assert.equal(b.budgetStatus, '接近预算');
  assert.equal(b.cutoff, '2026-10-15');
  assert.equal(b.expenses.length, 1);
  assert.equal(JSON.stringify(state), before);
});
test('预算边界90%、100%、超支及零预算有无支出，缺项不判全项目超支', () => {
  for (const [budget, expense, percent, status, overspend] of [
    [100, 9000, 90, '接近预算', 0],
    [100, 10000, 100, '接近预算', 0],
    [100, 11000, 110, '超预算', 1000],
    [0, 0, null, '零预算无支出，执行率不适用', 0],
    [0, 1200, null, '零预算有支出，状态异常', 1200],
  ] as const) {
    const { state, context } = fixture();
    state.projects[0].plans[0].budgetAmount = budget;
    for (const e of state.budgetDemoExpenses!) e.amountMinor = expense;
    const b = selectV10ProjectFinance(state, context, 'P1').project!.details.budget[0];
    assert.equal(b.executionPercent, percent);
    assert.equal(b.budgetStatus, status);
    assert.equal(b.overspendMinor, overspend);
    state.projects[0].plans.push({
      ...state.projects[0].plans[0],
      id: 'MISSING',
      budgetAmount: undefined,
    });
    const partial = selectV10ProjectFinance(state, context, 'P1').project!.details.budget[0];
    assert.equal(partial.comparable, false);
    assert.equal(partial.overspendMinor, null);
  }
});
test('取消项排除、多币种独立、预算ID冲突和缺失来源均待核，不补默认费用', () => {
  const { state, context } = fixture();
  state.projects[0].plans.push({
    ...state.projects[0].plans[0],
    id: 'CANCEL',
    status: '已取消',
    budgetAmount: 999,
  });
  state.projects[0].plans.push({
    ...state.projects[0].plans[0],
    id: 'EUR',
    budgetCurrency: 'EUR',
    budgetAmount: 20,
  });
  let details = selectV10ProjectFinance(state, context, 'P1').project!.details;
  assert.deepEqual(
    details.budget.map((b) => b.budgetMinor),
    [10000, 2000],
  );
  assert.equal(details.budget[1].expenseMinor, null);
  state.projects[0].plans.push({ ...state.projects[0].plans[0], budgetAmount: 200 });
  assert.equal(
    selectV10ProjectFinance(state, context, 'P1').project!.details.budget[0].comparable,
    false,
  );
  delete state.budgetComparisonSources;
  delete state.budgetDemoExpenses;
  details = selectV10ProjectFinance(state, context, 'P1').project!.details;
  assert.ok(details.budget.every((b) => b.expenseMinor === null));
});
test('同一合同发票跨两项目仅合计一次，金额100000／40000／60000分、回款率40%', () => {
  const { state, context } = fixture();
  state.contractInvoices = [
    {
      id: 'I1',
      number: 'INV1',
      contractId: state.contracts[0].id,
      projectIds: ['P1', 'P2'],
      revision: 1,
      updatedAt: '2026-10-12',
      cumulativeSource: 'legacy-simulation',
      amount: 1000,
      currency: 'CNY',
      issued: '2026-10-10',
      due: '2026-11-10',
      received: 400,
    },
  ];
  const r = selectV10Finance(state, context);
  assert.equal(r.contractFinance!.invoices.length, 1);
  assert.deepEqual(r.contractFinance!.totals[0], {
    currency: 'CNY',
    invoiceMinor: 100000,
    receivedMinor: 40000,
    balanceMinor: 60000,
    collectionRatio: 0.4,
    complete: true,
  });
  assert.equal(r.contractFinance!.invoices[0].allocation, '合同口径，未提供项目分摊依据');
  for (const id of ['P1', 'P2']) {
    const p = selectV10ProjectFinance(state, context, id);
    assert.equal(p.contractFinance!.totals[0].invoiceMinor, 100000);
    assert.equal(p.contractFinance!.invoices[0].contractId, state.contracts[0].id);
  }
  state.contractInvoices.push({ ...state.contractInvoices[0], amount: 999 });
  assert.equal(selectV10Finance(state, context).contractFinance!.totals[0].invoiceMinor, null);
});
test('费用、累计成本、最终成本及销售额各保留来源日期与范围，互不相加', () => {
  const { state, context } = fixture();
  state.financeSnapshots = [
    {
      projectId: 'P1',
      sc: 'SC1',
      scope: '演示范围',
      refreshedAt: '2026-10-16T00:00:00Z',
      expenses: [
        {
          id: 'FE1',
          category: '差旅',
          subtype: '交通',
          date: '2026-10-10',
          amount: 12.34,
          currency: 'EUR',
          person: '甲',
          sourceNumber: 'SAP1',
          source: 'SAP',
        },
      ],
      invoices: [],
      events: [],
      indicators: {
        source: 'CRM',
        snapshotDate: '2026-10-10',
        currency: 'CNY',
        salesAmount: 999,
        grossProfitAmount: 99,
        prepaymentRatio: 30,
      },
      cumulativeActualCost: {
        projectId: 'P1',
        source: 'SAP',
        amount: 50,
        currency: 'CNY',
        cutoff: '2026-10-10',
        scope: '累计采购',
      },
    },
  ];
  state.attachments.push({ ...state.attachments[0], id: 'D1', entityId: 'P1' });
  state.finalActualCosts = [
    {
      id: 'FC1',
      projectId: 'P1',
      revision: 1,
      amount: 80,
      currency: 'CNY',
      scope: '全项目',
      cutoff: '2026-10-12',
      confirmedDate: '2026-10-13',
      provider: '甲',
      documentId: 'D1',
      reason: '',
      zeroReason: '',
      operator: '甲',
      createdAt: '2026-10-13T00:00:00Z',
      operationId: 'OP1',
    },
  ];
  const r = selectV10ProjectFinance(state, context, 'P1');
  const d = r.project!.details;
  assert.equal(d.snapshot!.expenses[0].amountMinor, 1234);
  assert.equal(d.snapshot!.cumulativeCost!.amountMinor, 5000);
  assert.equal(d.snapshot!.sales!.salesMinor, 99900);
  assert.equal(d.finalCosts[0].amountMinor, 8000);
  assert.equal(d.finalCosts[0].current, true);
  assert.equal(d.snapshot!.cumulativeCost!.cutoff, '2026-10-10');
  state.attachments = state.attachments.filter((a) => a.id !== 'D1');
  assert.equal(
    selectV10ProjectFinance(state, context, 'P1').project!.details.finalCosts[0].current,
    false,
  );
  assert.equal(r.project!.revenueMinor, 1000);
  assert.equal(d.budget[0].expenseMinor, 9000);
  state.financeSnapshots.push(structuredClone(state.financeSnapshots[0]));
  assert.equal(selectV10ProjectFinance(state, context, 'P1').project!.details.snapshot, null);
});
test('来源失效、支出冲突、认领冲突、金额溢出和最终成本资料失效均有外部结果', () => {
  const { state, context } = fixture();
  state.budgetDemoExpenses![1].amountMinor = 1;
  assert.equal(
    selectV10ProjectFinance(state, context, 'P1').project!.details.budget[0].expenseMinor,
    null,
  );
  state.contractInvoices = [
    {
      id: 'I1',
      number: 'INV1',
      contractId: state.contracts[0].id,
      projectIds: ['P1', 'P2'],
      revision: 1,
      updatedAt: '2026-10-12',
      cumulativeSource: 'claims',
      amount: 1000,
      currency: 'CNY',
      issued: '2026-10-10',
      due: '2026-11-10',
      received: 999,
    },
  ];
  state.invoiceReceiptClaims = [
    { id: 'C1', invoiceId: 'I1', amount: 400, currency: 'CNY', status: '有效' },
  ];
  state.invoiceReceiptClaims.push({ ...state.invoiceReceiptClaims[0] });
  assert.equal(selectV10Finance(state, context).contractFinance!.totals[0].receivedMinor, 40000);
  state.invoiceReceiptClaims.push({ ...state.invoiceReceiptClaims[0], amount: 401 });
  assert.equal(selectV10Finance(state, context).contractFinance!.totals[0].receivedMinor, null);
  state.contractInvoices[0].amount = Number.MAX_SAFE_INTEGER;
  assert.equal(selectV10Finance(state, context).contractFinance!.totals[0].invoiceMinor, null);
  assert.equal(selectV10Finance(state, { ...context, dataVersion: 2 }).contractFinance, null);
  assert.equal(
    selectV10Finance(state, { ...context, sources: { ...context.sources, finance: 'unavailable' } })
      .projects,
    null,
  );
  delete state.contractInvoices;
  assert.equal(selectV10Finance(state, context).contractFinance!.status, 'unavailable');
  state.projects.splice(0, 1);
  assert.equal(selectV10ProjectFinance(state, context, 'P1').project!.details.sourceHref, null);
});
test('独立命令消费两项目合同去重与预算结果，输入和只读存储零写入', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { state, context } = fixture();
  state.contractInvoices = [
    {
      id: 'I1',
      number: 'INV1',
      contractId: state.contracts[0].id,
      projectIds: ['P1', 'P2'],
      revision: 1,
      updatedAt: '2026-10-12',
      cumulativeSource: 'legacy-simulation',
      amount: 1000,
      currency: 'CNY',
      issued: '2026-10-10',
      due: '2026-11-10',
      received: 400,
    },
  ];
  const before = JSON.stringify(state);
  function freeze(value: any) {
    if (value && typeof value === 'object') {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
  }
  freeze(state);
  freeze(context);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => {
        throw Error('查询不应读存储');
      },
      setItem: () => {
        throw Error('只读存储禁止写入');
      },
    },
  });
  assert.equal(selectV10Finance(state, context).contractFinance!.totals[0].balanceMinor, 60000);
  assert.equal(JSON.stringify(state), before);
  const dir = await mkdtemp(join(tmpdir(), 'v10-details-'));
  try {
    const source = join(dir, 'source.json'),
      ctx = join(dir, 'context.json');
    await writeFile(source, before);
    await writeFile(ctx, JSON.stringify(context));
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/consume-v10-identity.ts', source, ctx, '--finance'],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout);
    assert.equal(r.contractFinance.totals[0].invoiceMinor, 100000);
    assert.equal(r.contractFinance.totals[0].receivedMinor, 40000);
    assert.equal(r.contractFinance.totals[0].balanceMinor, 60000);
    assert.equal(r.contractFinance.totals[0].collectionRatio, 0.4);
    assert.equal(r.projectDrilldowns[0].project.details.budget[0].expenseMinor, 9000);
    assert.equal(r.projectDrilldowns[1].contractFinance.totals[0].invoiceMinor, 100000);
    assert.equal(await readFile(source, 'utf8'), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('负数历史回款不能被有效认领抵消成完整，销售快照非法日期不输出可信金额', () => {
  const { state, context } = fixture();
  state.contractInvoices = [
    {
      id: 'I1',
      number: 'INV1',
      contractId: state.contracts[0].id,
      projectIds: ['P1'],
      revision: 1,
      updatedAt: '2026-10-12',
      cumulativeSource: 'claims',
      amount: 1000,
      currency: 'CNY',
      issued: '2026-10-10',
      due: '2026-11-10',
      received: 0,
      legacyReceived: -100,
    },
  ];
  state.invoiceReceiptClaims = [
    { id: 'C1', invoiceId: 'I1', amount: 400, currency: 'CNY', status: '有效' },
  ];
  assert.equal(selectV10Finance(state, context).contractFinance!.totals[0].receivedMinor, null);
  assert.equal(selectV10Finance(state, context).contractFinance!.totals[0].complete, false);
  state.financeSnapshots = [
    {
      projectId: 'P1',
      sc: 'SC1',
      scope: '全项目',
      refreshedAt: '2026-10-10T00:00:00Z',
      expenses: [],
      invoices: [],
      events: [],
      indicators: {
        source: 'SAP',
        snapshotDate: '2026-02-30',
        currency: 'CNY',
        salesAmount: 100,
        grossProfitAmount: 10,
        prepaymentRatio: 30,
      },
    },
  ];
  assert.equal(
    selectV10ProjectFinance(state, context, 'P1').project!.details.snapshot!.sales!.salesMinor,
    null,
  );
});
test('认领ID在有效／撤销及跨发票归属冲突时不得静默累计', () => {
  for (const other of ['撤销', 'other-invoice'] as const) {
    const { state, context } = fixture();
    state.contractInvoices = [
      {
        id: 'I1',
        number: 'INV1',
        contractId: state.contracts[0].id,
        projectIds: ['P1'],
        revision: 1,
        updatedAt: '2026-10-12',
        cumulativeSource: 'claims',
        amount: 1000,
        currency: 'CNY',
        issued: '2026-10-10',
        due: '2026-11-10',
        received: 0,
      },
    ];
    state.invoiceReceiptClaims = [
      { id: 'C1', invoiceId: 'I1', amount: 400, currency: 'CNY', status: '有效' },
      {
        id: 'C1',
        invoiceId: other === '撤销' ? 'I1' : 'I2',
        amount: 400,
        currency: 'CNY',
        status: other === '撤销' ? '撤销' : '有效',
      },
    ];
    const r = selectV10Finance(state, context).contractFinance!;
    assert.equal(r.totals[0].receivedMinor, null);
    assert.equal(r.totals[0].complete, false);
    assert.ok(r.issues.some((i) => i.includes('冲突')));
  }
});
