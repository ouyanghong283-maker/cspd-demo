import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankPlan, blankProject, blankSales, createSeed } from '../src/app/core/seed';
import { selectV10ProjectDelivery, type V10QueryContext } from '../src/app/core/v10-contracts';

function fixture() {
  const state = createSeed();
  state.roundId = 'ROUND-DELIVERY';
  state.dataVersion = 1;
  state.customers = [state.customers[0]];
  const sale = blankSales('OPP', state.customers[0].id, 'opportunity');
  state.sales = [sale];
  state.customerDeliveryMappings = [];
  state.projects = ['P1', 'P2', 'P3', 'P4'].map((id) => {
    const p = blankProject(id, sale.customerId, sale.id, '');
    p.plans = [];
    if (id === 'P3') return p;
    for (const category of ['shipment', 'customerAcceptance'] as const) {
      const source = {
        ...blankPlan(category === 'shipment' ? '要货发货' : '内部WBS'),
        id: id + category,
      };
      if (category === 'customerAcceptance') source.completionKind = 'acceptance';
      const milestone = {
        ...blankPlan('客户主节点'),
        id: source.id + '-M',
        end:
          category === 'shipment'
            ? { P1: '2026-10-20', P2: '2026-10-10', P4: '2026-11-20' }[id]!
            : '2026-12-20',
        warningLeadDays: 5,
      };
      source.customerMilestoneId = milestone.id;
      p.plans.push(source, milestone);
      state.customerDeliveryMappings!.push({
        id: source.id + '-MAP',
        projectId: id,
        planId: source.id,
        customerMilestoneId: milestone.id,
        category,
        source: '独立S02样例',
        revision: 1,
      });
    }
    return p;
  });
  const context: V10QueryContext = {
    workspaceId: 'WS-DELIVERY',
    roundId: state.roundId,
    dataVersion: 1,
    contextRevision: 'READ-1',
    dates: {
      planObservationDate: '2026-10-15',
      solutionBusinessDate: '2026-10-18',
      realNowUtc: '2026-10-18T01:00:00.000Z',
      timezone: 'Asia/Shanghai',
      lastSuccessfulReadAt: '2026-10-18T01:00:00.000Z',
    },
    sources: { projects: 'ready', customers: 'ready', opportunities: 'ready' },
    fileAvailability: {},
  };
  return { state, context };
}

test('S02 四个真实项目四态各一，节点解释客户约定日，查询零写入', () => {
  const { state, context } = fixture();
  const before = structuredClone(state);
  const results = state.projects.map((p) => selectV10ProjectDelivery(state, context, p.id));
  assert.deepEqual(
    results.map((r) => r.delivery!.status),
    ['warning', 'delayed', 'pending', 'normal'],
  );
  assert.deepEqual(
    results.map((r) => r.delivery!.nodes.length),
    [2, 2, 0, 2],
  );
  const warning = results[0].delivery!.nodes[0];
  assert.equal(warning.promisedDate, '2026-10-20');
  assert.equal(warning.warningStart, '2026-10-15');
  assert.equal(warning.daysUntilDue, 5);
  assert.equal(warning.daysInWarning, 0);
  assert.equal(results[1].delivery!.nodes[0].delayedDays, 5);
  assert.deepEqual(state, before);
});

test('S03 D=W和D=E预警，N=0合法，缺N已知逾期仍延期并待补', () => {
  const { state, context } = fixture();
  const p = state.projects[0];
  const m = p.plans[1];
  const read = (D: string) =>
    selectV10ProjectDelivery(
      state,
      { ...context, dates: { ...context.dates, planObservationDate: D } },
      p.id,
    ).delivery!;
  assert.equal(read('2026-10-15').nodes[0].status, 'warning');
  assert.equal(read('2026-10-20').nodes[0].reason, '今日到期');
  assert.equal(read('2026-10-20').nodes[0].delayedDays, null);
  assert.equal(read('2026-10-21').nodes[0].delayedDays, 1);
  m.warningLeadDays = 0;
  assert.equal(read('2026-10-19').status, 'normal');
  assert.equal(read('2026-10-20').status, 'warning');
  delete m.warningLeadDays;
  const delayed = read('2026-10-21');
  assert.equal(delayed.status, 'delayed');
  assert.equal(delayed.incomplete, true);
  assert.equal(delayed.nodes[0].warningStart, null);
  assert.equal(read('2026-10-19').status, 'pending');
});

function accept(state: ReturnType<typeof createSeed>, id: string) {
  const p = state.projects.find((p) => p.id === id)!;
  p.acceptanceComplete = true;
  p.reviewReasons = [];
  p.acceptance.forEach((a) =>
    Object.assign(a, { result: '通过', signer: '客户代表', date: '2026-10-12' }),
  );
  state.attachments.push({
    ...state.attachments[0],
    id: id + '-SIGNED',
    entityId: id,
    kind: '客户签字清单',
  });
  return p;
}

test('S04 有效逾期完成保留成绩并退出当前延期，完成不依赖预警设置，待移交仍active', () => {
  const { state, context } = fixture();
  const p = accept(state, 'P2');
  for (const source of [p.plans[0], p.plans[2]])
    Object.assign(source, { status: '已完成', actual: '2026-10-12' });
  delete p.plans[1].warningLeadDays;
  let result = selectV10ProjectDelivery(state, context, p.id);
  assert.equal(result.delivery!.status, 'normal');
  assert.equal(result.delivery!.nextNode, null);
  assert.equal(result.executionScope, 'active');
  assert.deepEqual(
    result.delivery!.historicalLateCompletions.map((n) => [n.mappingId, n.completedLateDays]),
    [['P2shipment-MAP', 2]],
  );
  p.reviewReasons = ['acceptance'];
  p.plans[3].end = '2026-10-10';
  result = selectV10ProjectDelivery(state, context, p.id);
  assert.equal(result.delivery!.status, 'delayed');
  assert.equal(result.delivery!.incomplete, true);
  assert.equal(result.delivery!.nodes[1].completionValid, false);
  p.reviewReasons = [];
  p.acceptance[0].date = '2026-02-30';
  assert.equal(
    selectV10ProjectDelivery(state, context, p.id).delivery!.nodes[1].completionValid,
    false,
  );
});

test('多批发货全部检查，普通到货/FAT/WBS及名称不冒充客户承诺；错误与重复映射待核', () => {
  const { state, context } = fixture();
  const p = state.projects[3];
  const source = {
    ...p.plans[0],
    id: 'BATCH-2',
    customerMilestoneId: 'BATCH-2-M',
    name: '任意改名',
    end: '2026-12-30',
  };
  const milestone = { ...p.plans[1], id: 'BATCH-2-M', end: '2026-10-10' };
  p.plans.push(source, milestone);
  state.customerDeliveryMappings!.push({
    ...state.customerDeliveryMappings![0],
    id: 'BATCH-2-MAP',
    projectId: p.id,
    planId: source.id,
    customerMilestoneId: milestone.id,
  });
  for (const type of ['FAT测试', '内部WBS', '客户主节点'] as const)
    p.plans.push({ ...blankPlan(type), name: '发货客户验收', end: '2026-01-01' });
  let result = selectV10ProjectDelivery(state, context, p.id).delivery!;
  assert.equal(result.status, 'delayed');
  assert.equal(result.nodes.length, 3);
  assert.equal(result.nextNode!.mappingId, 'BATCH-2-MAP');
  assert.equal(result.nextNode!.delayedDays, 5);
  source.type = 'FAT测试';
  result = selectV10ProjectDelivery(state, context, p.id).delivery!;
  assert.equal(result.status, 'pending');
  assert.equal(result.nodes[2].promisedDate, null);
  source.type = '要货发货';
  source.customerMilestoneId = state.projects[0].plans[1].id;
  assert.equal(selectV10ProjectDelivery(state, context, p.id).delivery!.status, 'pending');
  source.customerMilestoneId = milestone.id;
  state.customerDeliveryMappings!.push({
    ...state.customerDeliveryMappings!.at(-1)!,
    id: 'DUP-MAP',
  });
  assert.equal(selectV10ProjectDelivery(state, context, p.id).delivery!.status, 'pending');
});

test('仅完成文字、非法实际日期、缺签字报告或非法签认日期均不能消除已知风险', () => {
  const { state, context } = fixture();
  const p = state.projects[1];
  const source = p.plans[0];
  source.status = '已完成';
  for (const actual of ['', '2026-02-30']) {
    source.actual = actual;
    const view = selectV10ProjectDelivery(state, context, p.id).delivery!;
    assert.equal(view.status, 'delayed');
    assert.equal(view.incomplete, true);
  }
  source.actual = '2026-10-12';
  assert.equal(
    selectV10ProjectDelivery(state, context, p.id).delivery!.nodes[0].completionValid,
    true,
    '发货不新增报告或审批',
  );
  accept(state, p.id);
  p.plans[2].status = '已完成';
  p.plans[2].actual = '2026-10-13';
  p.plans[3].end = '2026-10-10';
  p.acceptance[0].date = '2026-02-30';
  assert.equal(selectV10ProjectDelivery(state, context, p.id).delivery!.status, 'delayed');
  p.acceptance[0].date = '2026-10-12';
  assert.equal(selectV10ProjectDelivery(state, context, p.id).delivery!.status, 'normal');
  state.attachments = state.attachments.filter((a) => a.entityId !== p.id);
  assert.equal(selectV10ProjectDelivery(state, context, p.id).delivery!.status, 'delayed');
});

test('已知风险与客户关联缺项并存，来源失败及上下文错配不伪装正常；未知项目不可读', () => {
  const { state, context } = fixture();
  state.projects[1].customerId = 'UNKNOWN';
  const view = selectV10ProjectDelivery(state, context, 'P2').delivery!;
  assert.equal(view.status, 'delayed');
  assert.equal(view.incomplete, true);
  assert.equal(
    selectV10ProjectDelivery(state, { ...context, dataVersion: 99 }, 'P2').delivery,
    null,
  );
  assert.equal(
    selectV10ProjectDelivery(
      state,
      { ...context, sources: { ...context.sources, projects: 'loading' } },
      'P2',
    ).status,
    'loading',
  );
  assert.equal(selectV10ProjectDelivery(state, context, 'UNKNOWN').status, 'unavailable');
  state.projects.push(structuredClone(state.projects[1]));
  assert.equal(selectV10ProjectDelivery(state, context, 'P2').delivery, null);
});

test('新演示预置明确发货和客户验收关联，现有保存入口提交后独立命令消费且不改文件', async () => {
  const { harness } = await import('./v4-harness');
  const { store, role } = harness();
  role('pm');
  const seed = store.state();
  assert.equal(seed.customerDeliveryMappings!.length, 14);
  let raw = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => raw || null,
      setItem: (_: string, value: string) => {
        raw = value;
      },
    },
  });
  const p = structuredClone(seed.projects[0]);
  p.site = '01-03实际提交消费';
  assert.equal(store.saveProject(p), true);
  const snapshot = JSON.parse(raw);
  const { context } = fixture();
  Object.assign(context, { roundId: snapshot.roundId, dataVersion: snapshot.dataVersion });
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'v10-delivery-'));
  try {
    const sourcePath = join(directory, 'workspace.json'),
      contextPath = join(directory, 'context.json');
    await writeFile(
      sourcePath,
      JSON.stringify({ formatVersion: 1, workspaceId: context.workspaceId, snapshot }),
    );
    await writeFile(contextPath, JSON.stringify(context));
    const before = await readFile(sourcePath, 'utf8');
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/consume-v10-identity.ts', sourcePath, contextPath, '--delivery'],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.projectCount, 8);
    assert.deepEqual(result.counts, { delayed: 0, warning: 0, pending: 1, normal: 7 });
    assert.equal(result.projects[0].delivery.nodes[0].planId, 'DEMO-P001-要货发货');
    assert.equal(await readFile(sourcePath, 'utf8'), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('原逐项签认和完成入口采用真实签认日期，不把旧BASE_DATE同步日当验收实际日', async () => {
  const { harness } = await import('./v4-harness');
  const { store, role } = harness();
  role('pm');
  const id = 'DEMO-P001';
  assert.equal(store.simulateDocument(id, '客户签字清单', '客户签字.pdf'), true);
  for (const a of store.project(id)!.acceptance)
    assert.equal(store.saveAcceptance(id, a.id, '通过', '客户代表', '2026-10-09', ''), true);
  assert.equal(store.completeAcceptance(id), true);
  const milestone = structuredClone(
    store.project(id)!.plans.find((p) => p.id === id + '-V10-customerAcceptance')!,
  );
  milestone.end = '2026-10-08';
  assert.equal(store.savePlan(id, milestone), true);
  const { context } = fixture();
  Object.assign(context, {
    roundId: store.state().roundId,
    dataVersion: store.state().dataVersion,
  });
  const result = selectV10ProjectDelivery(store.state(), context, id).delivery!;
  assert.equal(result.status, 'normal');
  const node = result.nodes.find((n) => n.category === 'customerAcceptance')!;
  assert.equal(node.completionValid, true);
  assert.equal(node.actualDate, '2026-10-09');
  assert.equal(node.completedLateDays, 1);
  assert.ok(node.evidence.some((e) => e.kind === '客户逐项签认'));
});

test('预警与更早的资料待补并存，主原因解释预警，下一节点仍为最近未完成承诺', () => {
  const { state, context } = fixture();
  const p = state.projects[0];
  p.plans[1].end = '2026-10-17';
  delete p.plans[1].warningLeadDays;
  p.plans[3].end = '2026-10-20';
  const view = selectV10ProjectDelivery(state, context, p.id).delivery!;
  assert.equal(view.status, 'warning');
  assert.equal(view.incomplete, true);
  assert.equal(view.nextNode!.category, 'shipment');
  assert.equal(view.reason, '距承诺日5天，已进入预警0天');
  assert.ok(view.nodes[0].issues.includes('预警天数或预警起点待补'));
});
