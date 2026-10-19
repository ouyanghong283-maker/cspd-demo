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
  const state = store.state();
  state.roundId = 'FINANCE-ROUND';
  state.dataVersion = 1;
  state.projects = ['P-A', 'P-B', 'P-C'].map((id) => ({
    ...structuredClone(state.projects[0]),
    id,
  }));
  state.financeBatches = [
    {
      batchId: 'S07',
      source: '独立手算夹具',
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
          projectId: 'P-A',
          currency: 'CNY',
          month: '2026-08',
          revenueMinor: 40000,
          grossProfitMinor: 8000,
        },
        {
          factId: 'A9',
          projectId: 'P-A',
          currency: 'CNY',
          month: '2026-09',
          revenueMinor: 60000,
          grossProfitMinor: 12000,
        },
        {
          factId: 'B8',
          projectId: 'P-B',
          currency: 'CNY',
          month: '2026-08',
          revenueMinor: 20000,
          grossProfitMinor: -2000,
        },
        {
          factId: 'B9',
          projectId: 'P-B',
          currency: 'CNY',
          month: '2026-09',
          revenueMinor: 30000,
          grossProfitMinor: -3000,
        },
      ],
    },
  ];
  const context: V10QueryContext = {
    workspaceId: 'WS-FINANCE',
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
test('S07/S08：累计、月度和下钻与手算一致且查询零写入', () => {
  const { state, context } = fixture();
  const before = JSON.stringify(state);
  const r = selectV10Finance(state, context);
  assert.equal(r.summary!.revenueMinor, 150000);
  assert.equal(r.summary!.grossProfitMinor, 15000);
  assert.equal(r.summary!.grossMargin, 0.1);
  assert.deepEqual(r.summary!.coverage, { complete: 2, total: 3 });
  assert.deepEqual(
    r.months!.map((m) => m.grossProfitMinor),
    [6000, 9000],
  );
  assert.equal(r.months![1].comparison.grossProfitChangeMinor, 3000);
  assert.equal(r.period!.asOf, '2026-09-30');
  assert.equal(selectV10ProjectFinance(state, context, 'P-A').project!.grossProfitMinor, 20000);
  assert.equal(selectV10ProjectFinance(state, context, 'P-C').project!.revenueMinor, null);
  assert.equal(JSON.stringify(state), before);
});

test('生产来源经原保存入口持久化，旧财务不覆盖，反复保存及重载保持批次事实身份', () => {
  const { store, role } = harness();
  role('pm');
  const state = store.state();
  delete state.financeBatches;
  const legacy = JSON.stringify(state.financeSnapshots);
  let saved = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => saved || null,
      setItem: (_k: string, v: string) => {
        saved = v;
      },
    },
  });
  assert.equal(store.saveProject({ ...state.projects[0], site: '财务生产来源核验' }), true);
  const persisted = JSON.parse(saved);
  assert.equal(persisted.financeBatches.length, 1);
  assert.equal(JSON.stringify(persisted.financeSnapshots), legacy);
  const original = JSON.stringify(persisted.financeBatches);
  assert.equal(store.saveProject({ ...store.state().projects[0], site: '二次保存' }), true);
  assert.equal(JSON.stringify(JSON.parse(saved).financeBatches), original);
  const { context } = fixture();
  const result = selectV10Finance(persisted, {
    ...context,
    roundId: persisted.roundId,
    dataVersion: persisted.dataVersion,
  });
  assert.equal(result.summary!.coverage.total, 8);
  assert.equal(result.summary!.coverage.complete, 7);
  assert.equal(result.summary!.revenueMinor, 10500000);
  assert.equal(result.summary!.grossProfitMinor, 1260000);
});

test('单月／整月回退、上海月界及观察档独立，不按天拆月额', () => {
  const { state, context } = fixture();
  const september = selectV10Finance(state, context, {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
  });
  assert.equal(september.summary!.grossProfitMinor, 9000);
  for (const filters of [
    { periodStart: '2026-08-15' },
    { periodEnd: '2026-09-15' },
    { periodEnd: '2026-10-31' },
    { asOf: '2026-10-15' },
  ]) {
    const r = selectV10Finance(state, context, filters);
    assert.equal(r.period!.periodStart, '2026-08-01');
    assert.equal(r.period!.periodEnd, '2026-09-30');
    assert.equal(r.summary!.grossProfitMinor, 15000);
    assert.equal(r.resetReasons.length, 1);
  }
  assert.deepEqual(
    selectV10Finance(state, {
      ...context,
      dates: { ...context.dates, planObservationDate: '2026-10-22' },
    }).summary,
    selectV10Finance(state, context).summary,
  );
  const justBefore = selectV10Finance(state, {
    ...context,
    dates: { ...context.dates, realNowUtc: '2026-09-30T15:59:59Z' },
  });
  assert.equal(justBefore.period!.periodEnd, '2026-08-31');
  const justAfter = selectV10Finance(state, {
    ...context,
    dates: { ...context.dates, realNowUtc: '2026-09-30T16:00:00Z' },
  });
  assert.equal(justAfter.period!.periodEnd, '2026-09-30');
});
test('缺月不可补0；不同完整集合的月度比较不可比；单项已知额不混算毛利率', () => {
  const { state, context } = fixture();
  state.financeBatches![0].facts.splice(3, 1);
  let r = selectV10Finance(state, context);
  assert.equal(r.projects!.find((p) => p.projectId === 'P-B')!.revenueMinor, null);
  assert.deepEqual(r.summary!.coverage, { complete: 1, total: 3 });
  assert.equal(r.months![1].comparison.comparable, false);
  state.financeBatches![0].facts[1].grossProfitMinor = null;
  r = selectV10Finance(state, context);
  const a = r.projects!.find((p) => p.projectId === 'P-A')!;
  assert.equal(a.revenueMinor, 100000);
  assert.equal(a.grossProfitMinor, null);
  assert.equal(a.grossMargin, null);
  assert.equal(r.summary!.revenueMinor, null);
});
test('0、负毛利、零收入分别保留，货币和历史项目范围按声明筛选', () => {
  const { state, context } = fixture();
  const batch = state.financeBatches![0];
  batch.facts[0].revenueMinor = 0;
  batch.facts[0].grossProfitMinor = 0;
  batch.facts[1].revenueMinor = 0;
  batch.facts[1].grossProfitMinor = -100;
  const a = selectV10ProjectFinance(state, context, 'P-A').project!;
  assert.equal(a.revenueMinor, 0);
  assert.equal(a.grossProfitMinor, -100);
  assert.equal(a.grossMargin, null);
  assert.match(a.marginReason!, /零收入/);
  batch.projects[1].currency = 'EUR';
  assert.deepEqual(selectV10Finance(state, context).summary!.coverage, { complete: 1, total: 2 });
  assert.equal(selectV10Finance(state, context, { currency: 'EUR' }).summary!.coverage.total, 1);
  state.projects[0].status = '已取消';
  assert.equal(selectV10Finance(state, context).summary!.coverage.total, 2);
});
test('重复同值事实去重，冲突／非整数／聚合溢出明确待核', () => {
  for (const kind of ['same', 'conflict', 'fraction', 'overflow'] as const) {
    const { state, context } = fixture();
    const facts = state.financeBatches![0].facts;
    if (kind === 'same') facts.push({ ...facts[0] });
    if (kind === 'conflict') facts.push({ ...facts[0], grossProfitMinor: 999 });
    if (kind === 'fraction') facts[0].revenueMinor = 1.5;
    if (kind === 'overflow') {
      facts[0].revenueMinor = Number.MAX_SAFE_INTEGER;
      facts[1].revenueMinor = 1;
    }
    const r = selectV10Finance(state, context);
    assert.equal(r.summary!.coverage.complete, kind === 'same' ? 2 : 1);
    assert.equal(r.summary!.grossProfitMinor, kind === 'same' ? 15000 : -5000);
    if (kind === 'overflow') assert.ok(r.projects![0].issues.some((i) => i.includes('溢出')));
  }
  const { state, context } = fixture();
  const facts = state.financeBatches![0].facts;
  facts[0].revenueMinor = Number.MAX_SAFE_INTEGER - 1;
  facts[1].revenueMinor = 0;
  assert.equal(selectV10Finance(state, context).summary!.revenueMinor, null);
});
test('来源不可用／批次冲突／上下文错配不伪造零，缺失币种不丢分母', () => {
  const { state, context } = fixture();
  assert.equal(selectV10Finance(state, { ...context, dataVersion: 2 }).summary, null);
  assert.equal(
    selectV10Finance(state, { ...context, sources: { ...context.sources, finance: 'unavailable' } })
      .summary,
    null,
  );
  state.financeBatches![0].projects[0].currency = null;
  assert.equal(selectV10Finance(state, context).summary!.coverage.total, 3);
  assert.equal(selectV10Finance(state, context).summary!.coverage.complete, 1);
  state.financeBatches!.push(structuredClone(state.financeBatches![0]));
  assert.equal(selectV10Finance(state, context).summary, null);
  delete state.financeBatches;
  assert.equal(selectV10Finance(state, context).summary, null);
});

test('独立消费命令读取已提交生产来源，累计／月度／所有项目下钻一致且原文不变', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { store, role } = harness();
  role('pm');
  let raw = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => raw || null,
      setItem: (_key: string, v: string) => {
        raw = v;
      },
    },
  });
  store.saveProject({ ...store.state().projects[0], site: '独立消费核验' });
  const state = JSON.parse(raw);
  const { context } = fixture();
  const dir = await mkdtemp(join(tmpdir(), 'v10-finance-'));
  try {
    const source = join(dir, 'source.json'),
      ctx = join(dir, 'context.json');
    const envelope = JSON.stringify({
      formatVersion: 1,
      workspaceId: context.workspaceId,
      snapshot: state,
    });
    await writeFile(source, envelope);
    await writeFile(
      ctx,
      JSON.stringify({ ...context, roundId: state.roundId, dataVersion: state.dataVersion }),
    );
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/consume-v10-identity.ts', source, ctx, '--finance'],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    const r = JSON.parse(run.stdout);
    assert.equal(r.summary.revenueMinor, 10500000);
    assert.equal(r.summary.grossProfitMinor, 1260000);
    assert.equal(r.summary.grossMargin, 0.12);
    assert.deepEqual(
      r.months.map((m: any) => m.grossProfitMinor),
      [504000, 756000],
    );
    assert.equal(r.projectDrilldowns.length, 8);
    assert.equal(r.projectDrilldowns[0].project.grossProfitMinor, 450000);
    assert.equal(r.projectDrilldowns[2].project.grossProfitMinor, null);
    assert.equal(await readFile(source, 'utf8'), envelope);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('原保存失败不发布新增财务来源，重试成功且用户已有来源不覆盖', () => {
  const { store, role } = harness();
  role('pm');
  delete store.state().financeBatches;
  const before = JSON.stringify(store.state());
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw Error('模拟容量不足');
      },
    },
  });
  assert.throws(
    () => store.saveProject({ ...store.state().projects[0], site: '不应保存' }),
    /容量不足/,
  );
  assert.equal(JSON.stringify(store.state()), before);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} },
  });
  store.saveProject({ ...store.state().projects[0], site: '重试' });
  assert.equal(store.state().financeBatches!.length, 1);
  store.state().financeBatches = [];
  store.saveProject({ ...store.state().projects[0], site: '用户明确空来源' });
  assert.deepEqual(store.state().financeBatches, []);
});

test('部分供数保留可信已知金额但不计入完整可比集合或毛利率', () => {
  const { state, context } = fixture();
  state.financeBatches![0].projects[0].completeness = 'partial';
  const r = selectV10ProjectFinance(state, context, 'P-A');
  assert.equal(r.project!.months[0].revenueMinor, 40000);
  assert.equal(r.project!.revenueMinor, 100000);
  assert.equal(r.project!.grossProfitMinor, 20000);
  assert.equal(r.project!.complete, false);
  assert.equal(r.project!.grossMargin, null);
  assert.deepEqual(r.summary!.coverage, { complete: 0, total: 1 });
  assert.ok(r.project!.issues.some((i) => i.includes('已知部分')));
});
