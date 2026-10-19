import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// 动态加载 tsx 以便直接导入 TypeScript 源码。
await import(require.resolve('tsx')).catch(() => {});

const { createSeed } = await import(path.join(root, 'src/app/core/seed.ts'));
const { budgetCellText, readPlanBudget, summarizeProjectBudget, validateBudget } = await import(
  path.join(root, 'src/app/core/budget.ts')
);
const { harness } = await import(path.join(root, 'tests/v4-harness.ts'));

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-wbs-budget', runId);
await fs.mkdir(output, { recursive: true });

const report = {
  runAt: new Date().toISOString(),
  issue: 74,
  acceptanceIds: ['BUD01', 'BUD02', 'BUD03', 'BUD04'],
  checks: [],
  result: '失败',
};

const check = (name, evidence) => {
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
};

const wbs = (overrides) => ({
  id: 'PL-001',
  type: '内部WBS',
  name: '测试任务',
  owner: '王项目',
  start: '2026-10-12',
  end: '2026-10-20',
  expected: '2026-10-20',
  actual: '',
  status: '未开始',
  product: '储能系统',
  quantity: 1,
  batch: '',
  linked: '',
  amount: 0,
  currency: 'CNY',
  result: '待执行',
  receiver: '',
  note: '',
  sourceStatus: '待核',
  ...overrides,
});

try {
  // ---------- BUD01：独立预算字段校验 ----------
  for (const currency of ['CNY', 'EUR', 'USD']) {
    const zero = validateBudget(0, currency);
    assert.equal(zero.valid, true, `${currency} 的 0 应合法`);
    assert.equal(zero.cents, 0);
    assert.equal(zero.amount, 0);
  }
  check('BUD01 · 0 合法且三种币种 CNY/EUR/USD 均可选', {
    currencies: ['CNY', 'EUR', 'USD'],
    zeroCents: 0,
  });

  const rejected = [
    ['空金额', undefined, 'CNY'],
    ['空币种', 100, ''],
    ['负金额', -1, 'CNY'],
    ['NaN', Number.NaN, 'CNY'],
    ['正无穷', Number.POSITIVE_INFINITY, 'CNY'],
    ['负无穷', Number.NEGATIVE_INFINITY, 'CNY'],
    ['字符串金额', '12000', 'CNY'],
    ['超两位小数', 12.345, 'CNY'],
    ['异常币种', 100, 'JPY'],
    ['小写币种', 100, 'cny'],
  ];
  const rejectedEvidence = [];
  for (const [name, amount, currency] of rejected) {
    const result = validateBudget(amount, currency);
    assert.equal(result.valid, false, `${name} 应被拒绝`);
    assert.ok(result.message.length > 0, `${name} 应有修正提示`);
    rejectedEvidence.push({ name, message: result.message });
  }
  assert.match(validateBudget(12.345, 'CNY').message, /不会自动截断/);
  check('BUD01 · 空/负/NaN/无穷/超两位/异常币种均明确报错且不静默截断', rejectedEvidence);

  // ---------- BUD02：分币种最小单位精确汇总 ----------
  const summary = summarizeProjectBudget('DEMO-A', [
    wbs({ id: 'P1', budgetAmount: 0.01, budgetCurrency: 'CNY' }),
    wbs({ id: 'P2', budgetAmount: 0.02, budgetCurrency: 'CNY' }),
    wbs({ id: 'P3', budgetAmount: 1800000, budgetCurrency: 'CNY' }),
    wbs({ id: 'P4', budgetAmount: 1500.55, budgetCurrency: 'EUR' }),
    wbs({ id: 'P5', budgetAmount: 62000, budgetCurrency: 'USD' }),
    wbs({ id: 'P5', budgetAmount: 62000, budgetCurrency: 'USD' }),
    wbs({
      id: 'P6',
      status: '已完成',
      actual: '2026-10-20',
      budgetAmount: 300,
      budgetCurrency: 'CNY',
    }),
    wbs({ id: 'P7', status: '已取消', budgetAmount: 900, budgetCurrency: 'CNY' }),
  ]);
  assert.deepEqual(
    summary.filled.map((total) => [total.currency, total.amount, total.count]),
    [
      ['CNY', 1800300.03, 4],
      ['EUR', 1500.55, 1],
      ['USD', 62000, 1],
    ],
  );
  assert.equal(summary.cancelledCount, 1);
  assert.deepEqual(
    summary.cancelled.map((total) => [total.currency, total.amount]),
    [['CNY', 900]],
  );
  assert.equal(summary.totalCount, 7);
  assert.equal(summary.missingCount, 0);
  check('BUD02 · 稳定 Plan ID 去重、按分币种精确汇总、已完成计入、已取消单独标注', {
    filled: summary.filled,
    cancelled: summary.cancelled,
    totalCount: summary.totalCount,
  });

  // ---------- BUD03：缺值、待核与旧数据 ----------
  const gaps = summarizeProjectBudget('DEMO-A', [
    wbs({ id: 'G1', budgetAmount: 100, budgetCurrency: 'CNY' }),
    wbs({ id: 'G2' }),
    // 开票回款 amount/currency 有值，但不得被当成预算
    wbs({ id: 'G3', amount: 1200000, currency: 'USD' }),
    wbs({ id: 'G4', budgetAmount: 200, budgetCurrency: 'JPY' }),
    wbs({ id: 'G5', budgetAmount: 300, budgetCurrency: '' }),
  ]);
  assert.deepEqual(
    gaps.filled.map((total) => [total.currency, total.amount]),
    [['CNY', 100]],
  );
  assert.equal(gaps.missingCount, 2);
  assert.deepEqual(gaps.missingPlanIds, ['G2', 'G3']);
  assert.equal(gaps.pendingReviewCount, 2);
  assert.deepEqual(
    gaps.pendingReview.map((total) => [total.currency, total.amount]),
    [
      ['JPY', 200],
      ['币种待核', 300],
    ],
  );
  assert.equal(gaps.complete, false);
  assert.equal(
    readPlanBudget(wbs({ id: 'G3', amount: 1200000, currency: 'USD' })).amountCents,
    null,
  );
  assert.equal(budgetCellText(wbs({ id: 'G2' })), '预算待补');
  check('BUD03 · 缺值显示待补数、已填部分合计、异常币种待核且不迁移回款金额', {
    missingCount: gaps.missingCount,
    missingPlanIds: gaps.missingPlanIds,
    pendingReview: gaps.pendingReview,
    legacyCell: budgetCellText(wbs({ id: 'G2' })),
  });

  const seed = createSeed();
  const seedProject = seed.projects[0];
  const seedSummary = summarizeProjectBudget(seedProject.id, seedProject.plans);
  assert.equal(seedSummary.totalCount, 10);
  assert.equal(seedSummary.simulatedCount, seedSummary.filledCount);
  assert.equal(seedSummary.missingCount, 1);
  const seedPending = seedProject.plans.find((plan) => plan.id === seedSummary.missingPlanIds[0]);
  assert.equal(budgetCellText(seedPending), '预算待补');
  assert.match(budgetCellText(seedProject.plans[0]), /模拟$/);
  check('BUD03 · 种子样例带模拟预算并保留一个待补样例，不冒充业务原值', {
    filled: seedSummary.filled,
    missingPlanIds: seedSummary.missingPlanIds,
    simulatedCount: seedSummary.simulatedCount,
  });

  // ---------- BUD01/BUD04：真实保存入口 ----------
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const target = store
    .project(projectId)
    .plans.find((plan) => plan.type === '内部WBS' && plan.status === '进行中');
  assert.ok(target, '演示数据应存在进行中的内部WBS');
  const beforeSummary = store.planBudgetSummary(projectId);
  const beforeState = store.state();

  const saved = store.savePlan(projectId, {
    ...target,
    budgetAmount: 250000.25,
    budgetCurrency: 'USD',
  });
  assert.equal(saved, true, '真实 savePlan 应保存合法预算');
  const stored = store.project(projectId).plans.find((plan) => plan.id === target.id);
  assert.equal(stored.budgetAmount, 250000.25);
  assert.equal(stored.budgetCurrency, 'USD');
  const afterSummary = store.planBudgetSummary(projectId);
  const usd = afterSummary.filled.find((total) => total.currency === 'USD');
  assert.equal(usd.amount, 62000 + 250000.25);
  assert.equal(usd.count, 2);
  assert.equal(afterSummary.missingCount, beforeSummary.missingCount);
  assert.equal(
    (store.state().operationEvents || []).length,
    (beforeState.operationEvents || []).length + 1,
  );
  check('BUD01/BUD04 · 真实 savePlan 保存预算后表格、摘要与历史同次更新', {
    stored: { budgetAmount: stored.budgetAmount, budgetCurrency: stored.budgetCurrency },
    usd,
  });

  const rejectedSaves = [
    { budgetAmount: undefined, budgetCurrency: 'CNY' },
    { budgetAmount: 100, budgetCurrency: '' },
    { budgetAmount: -1, budgetCurrency: 'CNY' },
    { budgetAmount: 12.345, budgetCurrency: 'CNY' },
    { budgetAmount: Number.NaN, budgetCurrency: 'CNY' },
    { budgetAmount: 100, budgetCurrency: 'JPY' },
  ];
  const saveFailures = [];
  for (const invalid of rejectedSaves) {
    let message = '';
    try {
      store.savePlan(projectId, { ...stored, ...invalid });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.ok(message.length > 0, `非法预算应被拒绝：${JSON.stringify(invalid)}`);
    saveFailures.push({ invalid, message });
  }
  const afterFailures = store.project(projectId).plans.find((plan) => plan.id === target.id);
  assert.equal(afterFailures.budgetAmount, 250000.25);
  assert.equal(afterFailures.budgetCurrency, 'USD');
  assert.deepEqual(store.planBudgetSummary(projectId), afterSummary);
  check('BUD01/BUD04 · 非法预算保存失败且旧汇总与旧值保持不变', saveFailures);

  // 取消任务：从有效合计排除并在汇总单独标注
  assert.equal(store.savePlan(projectId, { ...afterFailures, status: '已取消' }), true);
  const cancelledSummary = store.planBudgetSummary(projectId);
  assert.equal(cancelledSummary.cancelledCount, 1);
  assert.equal(cancelledSummary.cancelled[0].currency, 'USD');
  assert.equal(cancelledSummary.cancelled[0].amount, 250000.25);
  assert.equal(cancelledSummary.filled.find((total) => total.currency === 'USD').amount, 62000);
  check('BUD04 · 取消任务后同次提交内从有效合计排除并单独标注', {
    cancelled: cancelledSummary.cancelled,
    filled: cancelledSummary.filled,
  });

  // 改日期/预警、切档、标已读不改预算
  const beforeDate = structuredClone(cancelledSummary);
  assert.equal(
    store.savePlan(projectId, {
      ...store.project(projectId).plans.find((plan) => plan.id === target.id),
      end: '2026-12-05',
      expected: '2026-12-05',
      warningLeadDays: 4,
    }),
    true,
  );
  assert.deepEqual(store.planBudgetSummary(projectId), beforeDate);
  assert.equal(store.setDateMode('comparison'), true);
  assert.deepEqual(store.planBudgetSummary(projectId), beforeDate);
  const notice = store.state().notices.find((item) => item.entityId === projectId);
  if (notice) {
    store.markNotice(notice.id);
    assert.deepEqual(store.planBudgetSummary(projectId), beforeDate);
  }
  assert.equal(store.setDateMode('normal'), true);
  check('BUD04 · 改日期/预警、切档、标已读不改变预算汇总', { noticeId: notice?.id || null });

  // 无关既有动作不被旧缺值全局阻断：客户主节点仍可保存，预算字段被隔离
  const milestone = store.project(projectId).plans.find((plan) => plan.type === '客户主节点');
  assert.equal(
    store.savePlan(projectId, {
      ...milestone,
      warningLeadDays: 6,
      budgetAmount: 5,
      budgetCurrency: 'CNY',
    }),
    true,
  );
  const storedMilestone = store.project(projectId).plans.find((plan) => plan.id === milestone.id);
  assert.equal(storedMilestone.warningLeadDays, 6);
  assert.equal(storedMilestone.budgetAmount, undefined);
  assert.equal(
    store.planBudgetSummary(projectId).filled.some((total) => total.amount === 5),
    false,
  );
  check('BUD04 · 无关计划类型与只读查看不被旧缺值阻断，预算字段按类型隔离', {
    milestoneId: milestone.id,
  });

  report.result = '通过';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.stack = error instanceof Error ? error.stack : undefined;
  throw error;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('验收证据：', output);
}
