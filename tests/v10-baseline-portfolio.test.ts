import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankPlan, blankProject, blankSales, createSeed } from '../src/app/core/seed';
import { selectLifecycleProgress } from '../src/app/core/lifecycle-progress';
import { selectV10Portfolio, type V10QueryContext } from '../src/app/core/v10-contracts';

function fixture() {
  const state = createSeed();
  state.roundId = 'ROUND-PORTFOLIO';
  state.dataVersion = 1;
  state.customers = [state.customers[0]];
  const sale = blankSales('OPP-PORTFOLIO', state.customers[0].id, 'opportunity');
  sale.projectName = '一个商机两个独立执行项目';
  sale.grade = 'S';
  state.sales = [sale];
  state.projects = ['PROJECT-FAST', 'PROJECT-SLOW'].map((id, i) => {
    const p = blankProject(id, sale.customerId, sale.id, '');
    p.pm = '';
    p.team = [];
    p.name = id;
    p.plans = [
      {
        ...blankPlan('内部WBS'),
        id: id + '-DESIGN',
        name: '设计工作',
        status: i === 0 ? '已完成' : '未开始',
        actual: i === 0 ? '2026-10-15' : '',
      },
    ];
    return p;
  });
  state.progressGroupMappings = state.projects.map((p) => ({
    id: p.id + '-MAPPING',
    projectId: p.id,
    groupId: 'design',
    planIds: [p.plans[0].id],
    sourceTemplateId: null,
    revision: 1,
    history: [],
  }));
  const context: V10QueryContext = {
    workspaceId: 'WS-PORTFOLIO',
    roundId: state.roundId,
    dataVersion: 1,
    contextRevision: 'READ-PORTFOLIO-1',
    dates: {
      planObservationDate: '2026-10-15',
      solutionBusinessDate: '2026-10-18',
      realNowUtc: '2026-10-18T01:00:00.000Z',
      timezone: 'Asia/Shanghai',
      lastSuccessfulReadAt: '2026-10-18T01:00:00.000Z',
    },
    fileAvailability: {},
    sources: { projects: 'ready', customers: 'ready', opportunities: 'ready' },
  };
  return { state, context, sale };
}

test('一个商机计一次、两个项目各计一次并返回自身v9.1进度，查询零写入', () => {
  const { state, context } = fixture();
  const before = structuredClone(state);
  const view = selectV10Portfolio(state, context);
  assert.equal(view.presales.counts!.opportunityCount, 1);
  assert.equal(view.execution.counts!.projectCount, 2);
  assert.deepEqual(
    view.execution.projects!.map((p) => p.progress!.displayPercent),
    ['5.0', '0.0'],
  );
  for (const p of view.execution.projects!) {
    assert.deepEqual(
      p.progress,
      selectLifecycleProgress(state, p.opportunityId!, p.projectId, context.dates),
    );
    assert.equal(p.progressVersion, 'v9.1');
    assert.equal(p.progress!.complete, false);
    assert.ok(p.incomplete);
    assert.ok(p.progress!.nodes.some((n) => n.reason?.includes('依据待补')));
  }
  assert.equal(view.presales.opportunities![0].progress!.displayPercent, '0.0');
  assert.equal(view.presales.opportunities![0].convertedToProject, true);
  assert.deepEqual(
    view.presales.opportunities![0].projects.map((p) => p.projectId),
    ['PROJECT-FAST', 'PROJECT-SLOW'],
  );
  assert.deepEqual(state, before);
});

test('四个在售阶段与赢丢单分母分开，转项目依据关联且不改销售结果', () => {
  const { state, context, sale } = fixture();
  state.sales = ['意向沟通', '洽谈', '方案报价', '合同谈判', '赢单', '丢单'].map((stage, i) => ({
    ...sale,
    id: i === 0 ? sale.id : 'OPP-' + i,
    stage: stage as typeof sale.stage,
  }));
  const before = structuredClone(state);
  const view = selectV10Portfolio(state, context);
  assert.deepEqual(view.presales.counts, {
    opportunityCount: 6,
    pipelineCount: 4,
    stages: { 意向沟通: 1, 洽谈: 1, 方案报价: 1, 合同谈判: 1 },
    wonCount: 1,
    lostCount: 1,
    unknownStageCount: 0,
    convertedCount: 1,
    matchedCount: 4,
  });
  assert.equal(view.presales.opportunities!.length, 4);
  const won = selectV10Portfolio(state, context, { presalesScope: 'won' }).presales.opportunities!;
  assert.equal(won.length, 1);
  assert.equal(won[0].convertedToProject, false);
  assert.equal(won[0].salesResult, 'won');
  const converted = selectV10Portfolio(state, context, { presalesScope: 'converted' }).presales
    .opportunities!;
  assert.equal(converted.length, 1);
  assert.equal(converted[0].stage, '意向沟通');
  assert.equal(converted[0].salesResult, 'open');
  assert.equal(
    selectV10Portfolio(state, context, { presalesScope: 'lost' }).presales.opportunities![0]
      .salesResult,
    'lost',
  );
  assert.equal(
    selectV10Portfolio(state, context, { presalesScope: 'all' }).presales.opportunities!.length,
    6,
  );
  assert.deepEqual(state, before);
});

function completeExitFacts(state: ReturnType<typeof createSeed>, projectId: string) {
  const p = state.projects.find((p) => p.id === projectId)!;
  p.acceptanceComplete = true;
  for (const item of p.acceptance)
    Object.assign(item, { result: '通过', signer: '客户代表', date: '2026-10-15' });
  p.sat = { complete: true, date: '2026-10-15', result: '合格' };
  p.reviewReasons = [];
  p.handover.status = '已接收';
  p.handover.categories.forEach((c) => {
    c.status = '已有资料';
  });
  for (const kind of ['客户签字清单', 'SAT报告'])
    state.attachments.push({
      ...state.attachments[0],
      id: projectId + kind,
      entityId: projectId,
      kind,
    });
}

test('有效验收和内部移交决定完成分组，取消与完成冲突保留进行中，历史范围可单独查', () => {
  const { state, context } = fixture();
  const completed = state.projects[0];
  completeExitFacts(state, completed.id);
  const cancelled = structuredClone(state.projects[1]);
  cancelled.id = 'PROJECT-CANCELLED';
  cancelled.status = '已取消';
  const conflict = structuredClone(completed);
  conflict.id = 'PROJECT-CONFLICT';
  conflict.status = '已取消';
  state.projects.push(cancelled, conflict);
  completeExitFacts(state, conflict.id);
  const misleading = structuredClone(state.projects[1]);
  misleading.id = 'PROJECT-STATUS-ONLY';
  misleading.status = '已移交';
  state.projects.push(misleading);
  state.projects[1].plans[0].status = '已取消';
  const before = structuredClone(state);
  const all = selectV10Portfolio(state, context, { executionScope: 'all' });
  assert.deepEqual(all.execution.counts, {
    projectCount: 5,
    activeCount: 3,
    completedCount: 1,
    cancelledCount: 1,
    matchedCount: 5,
  });
  assert.equal(
    all.execution.projects!.find((p) => p.projectId === completed.id)!.executionScope,
    'completed',
  );
  assert.equal(
    all.execution.projects!.find((p) => p.projectId === completed.id)!.progress!.complete,
    false,
    '退出执行范围不要求补全所有生命周期历史',
  );
  const conflicted = all.execution.projects!.find((p) => p.projectId === conflict.id)!;
  assert.equal(conflicted.executionScope, 'active');
  assert.ok(conflicted.issues.some((i) => i.category === 'conflicting'));
  assert.ok(
    all.execution
      .projects!.find((p) => p.projectId === misleading.id)!
      .issues.some((i) => i.category === 'invalid'),
  );
  assert.equal(selectV10Portfolio(state, context).execution.projects!.length, 3);
  assert.deepEqual(
    selectV10Portfolio(state, context, { executionScope: 'completed' }).execution.projects!.map(
      (p) => p.projectId,
    ),
    [completed.id],
  );
  assert.deepEqual(
    selectV10Portfolio(state, context, { executionScope: 'cancelled' }).execution.projects!.map(
      (p) => p.projectId,
    ),
    [cancelled.id],
  );
  assert.deepEqual(state, before);
  completed.handover.status = '待接收';
  assert.equal(
    selectV10Portfolio(state, context, { executionScope: 'all' }).execution.projects!.find(
      (p) => p.projectId === completed.id,
    )!.executionScope,
    'active',
  );
});

test('不可靠关联项目保留计数但不冒充已转项目，重复及未知阶段商机单列待核', () => {
  const { state, context, sale } = fixture();
  state.projects[0].customerId = 'NO-CUSTOMER';
  state.projects[1].opportunityId = 'NO-OPPORTUNITY';
  state.sales.push(
    { ...sale, id: 'DUPLICATE' },
    { ...sale, id: 'DUPLICATE', stage: '赢单' },
    { ...sale, id: 'UNKNOWN-STAGE', stage: '旧未知阶段' as typeof sale.stage },
  );
  const before = structuredClone(state);
  const result = selectV10Portfolio(state, context, { presalesScope: 'all' });
  assert.equal(result.presales.counts!.opportunityCount, 3);
  assert.equal(result.presales.counts!.pipelineCount, 1);
  assert.equal(result.presales.counts!.unknownStageCount, 2);
  assert.equal(
    result.presales.opportunities!.find((o) => o.opportunityId === sale.id)!.convertedToProject,
    null,
  );
  assert.ok(
    result.presales
      .opportunities!.find((o) => o.opportunityId === 'DUPLICATE')!
      .issues.some((i) => i.category === 'ambiguous'),
  );
  assert.equal(result.execution.counts!.projectCount, 2);
  assert.equal(result.execution.projects!.length, 2);
  assert.ok(
    result.execution.projects!.every(
      (p) => p.executionScope === 'active' && p.progress === null && p.issues.length > 0,
    ),
  );
  assert.deepEqual(state, before);
});

test('各来源失败只阻断依赖项，修订错配阻断整批，缺ID旧商机不静默丢弃', () => {
  const { state, context, sale } = fixture();
  const loading = selectV10Portfolio(state, {
    ...context,
    sources: { ...context.sources, projects: 'loading' },
  });
  assert.equal(loading.execution.status, 'loading');
  assert.equal(loading.execution.counts, null);
  assert.equal(loading.presales.counts!.opportunityCount, 1);
  assert.equal(loading.presales.opportunities![0].convertedToProject, null);
  const unavailable = selectV10Portfolio(state, {
    ...context,
    sources: { ...context.sources, opportunities: 'unavailable' },
  });
  assert.equal(unavailable.presales.status, 'unavailable');
  assert.equal(unavailable.presales.counts, null);
  assert.equal(unavailable.execution.counts!.projectCount, 2);
  assert.ok(unavailable.execution.projects!.every((p) => p.progress === null));
  const mismatch = selectV10Portfolio(state, { ...context, dataVersion: 999 });
  assert.equal(mismatch.execution.counts, null);
  assert.equal(mismatch.presales.counts, null);
  const noCustomers = selectV10Portfolio(state, {
    ...context,
    sources: { ...context.sources, customers: 'unavailable' },
  });
  assert.equal(noCustomers.presales.counts!.opportunityCount, 1);
  assert.equal(noCustomers.presales.opportunities![0].progress, null);
  assert.ok(
    noCustomers.presales.opportunities![0].issues.some((i) => i.category === 'unavailable'),
  );
  state.sales.push({ ...sale, id: '' });
  const old = selectV10Portfolio(state, context, { presalesScope: 'all' });
  assert.equal(old.presales.counts!.opportunityCount, 1);
  assert.ok(
    old.presales.opportunities!.some(
      (o) => o.opportunityId === null && o.issues.some((i) => i.category === 'missing'),
    ),
  );
});

test('只完成执行末端的独立预期为50.0%，历史依据缺失时完成分组仍不能显示100%', () => {
  const { state, context } = fixture();
  const p = state.projects[0];
  state.projects = [p];
  p.plans = ['design', 'production', 'shipping', 'arrival-installation'].map((group) => ({
    ...blankPlan('内部WBS'),
    id: group,
    name: group,
    status: '已完成',
    actual: '2026-10-15',
  }));
  state.progressGroupMappings = p.plans.map((plan) => ({
    id: 'MAP-' + plan.id,
    projectId: p.id,
    groupId: plan.id as 'design' | 'production' | 'shipping' | 'arrival-installation',
    planIds: [plan.id],
    sourceTemplateId: null,
    revision: 1,
    history: [],
  }));
  p.plans.push({
    ...blankPlan('FAT测试'),
    id: 'FAT-DONE',
    name: '出厂测试',
    status: '已完成',
    actual: '2026-10-15',
    result: '合格',
  });
  state.attachments.push({
    ...state.attachments[0],
    id: 'FAT-REPORT',
    entityId: p.id,
    kind: 'FAT报告',
  });
  completeExitFacts(state, p.id);
  const result = selectV10Portfolio(state, context, { executionScope: 'all' }).execution
    .projects![0];
  assert.equal(result.executionScope, 'completed');
  // 设计5+生产15+FAT5+发货5+到货安装8+SAT5+客户验收4+内部移交3=50；售前和启动依据仍缺失。
  assert.equal(result.progress!.displayPercent, '50.0');
  assert.deepEqual(result.progress!.score, { numerator: '50', denominator: '1' });
  assert.equal(result.progress!.complete, false);
  assert.equal(result.incomplete, true);
  state.attachments = state.attachments.filter((a) => a.kind !== '客户签字清单');
  const revoked = selectV10Portfolio(state, context).execution.projects![0];
  assert.equal(revoked.executionScope, 'active');
  assert.equal(revoked.progress!.displayPercent, '46.0');
});

test('独立消费可从原保存格式读取分区结果，旧身份消费仍可运行', async () => {
  const { harness } = await import('./v4-harness');
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { store, role } = harness();
  role('pm');
  const { context } = fixture();
  store.state().roundId = context.roundId;
  let raw = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => raw || null,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    },
  });
  const p = structuredClone(store.state().projects[0]);
  p.site = '01-02实际保存消费';
  assert.equal(store.saveProject(p), true);
  const state = JSON.parse(raw);
  const directory = await mkdtemp(join(tmpdir(), 'v10-portfolio-'));
  try {
    const sourcePath = join(directory, 'workspace.json'),
      contextPath = join(directory, 'context.json');
    await writeFile(
      sourcePath,
      JSON.stringify({ formatVersion: 1, workspaceId: context.workspaceId, snapshot: state }),
    );
    const before = await readFile(sourcePath, 'utf8');
    await writeFile(contextPath, JSON.stringify({ ...context, dataVersion: state.dataVersion }));
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/consume-v10-identity.ts',
        sourcePath,
        contextPath,
        '--portfolio',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.scope, 'business-portfolio');
    assert.equal(result.execution.counts.projectCount, 8);
    assert.equal(result.presales.counts.opportunityCount, 24);
    const group = result.presales.opportunities;
    assert.ok(group.every((o: any) => o.salesResult === 'open'));
    assert.equal(await readFile(sourcePath, 'utf8'), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('项目域声明矛盾不阻断独立商机计数，转项目结论保持未知', () => {
  const { state, context } = fixture();
  const result = selectV10Portfolio(state, {
    ...context,
    sources: { ...context.sources, projects: 'empty' },
  });
  assert.equal(result.execution.status, 'unavailable');
  assert.equal(result.execution.counts, null);
  assert.equal(result.presales.status, 'ready');
  assert.equal(result.presales.counts!.opportunityCount, 1);
  assert.equal(result.presales.counts!.pipelineCount, 1);
  assert.equal(result.presales.opportunities![0].convertedToProject, null);
});
