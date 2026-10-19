import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { createSeed, blankPlan } from '../src/app/core/seed';
import {
  BUDGET_REVIEW_TEXT,
  budgetCellText,
  formatBudgetAmount,
  readPlanBudget,
  summarizeProjectBudget,
  validateBudget,
} from '../src/app/core/budget';
import { Plan } from '../src/app/core/models';
import { DemoStore } from '../src/app/core/store';
import { harness } from './v4-harness';

function planFixture(overrides: Partial<Plan>): Plan {
  return {
    ...blankPlan('内部WBS'),
    id: 'PL-001',
    name: '测试任务',
    start: '2026-10-12',
    end: '2026-10-20',
    expected: '2026-10-20',
    status: '未开始',
    ...overrides,
  } as Plan;
}

/** 演示种子里可直接保存的进行中内部WBS：不触发启动/验收完成专用校验。 */
function editableWbs(store: DemoStore, projectId: string): Plan {
  const plan = store
    .project(projectId)!
    .plans.find((item) => item.type === '内部WBS' && item.status === '进行中')!;
  assert.ok(plan, '演示数据应存在进行中的内部WBS');
  return plan;
}

test('BUD01 预算校验：0 与三种币种合法，金额与币种分别规范化', () => {
  for (const currency of ['CNY', 'EUR', 'USD']) {
    const zero = validateBudget(0, currency);
    assert.equal(zero.valid, true, currency);
    assert.equal(zero.cents, 0);
    assert.equal(zero.amount, 0);
    assert.equal(zero.currency, currency);
    assert.equal(zero.message, '');

    const amount = validateBudget(1234.5, currency);
    assert.equal(amount.valid, true);
    assert.equal(amount.cents, 123450);
    assert.equal(amount.amount, 1234.5);
  }
  assert.equal(validateBudget(0.01, 'CNY').cents, 1);
  assert.equal(validateBudget(0.1, 'CNY').cents + validateBudget(0.2, 'CNY').cents, 30);
});

test('BUD01 预算校验：空/负/NaN/无穷/超两位小数被拒绝且不静默截断', () => {
  const empty = validateBudget(undefined, 'CNY');
  assert.equal(empty.valid, false);
  assert.deepEqual(empty.issues, ['amount-missing']);
  assert.match(empty.message, /请填写预计预算金额/);

  const blank = validateBudget('', 'CNY');
  assert.equal(blank.valid, false);
  assert.deepEqual(blank.issues, ['amount-missing']);

  const negative = validateBudget(-1, 'CNY');
  assert.equal(negative.valid, false);
  assert.match(negative.message, /不能为负数/);

  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const result = validateBudget(invalid, 'CNY');
    assert.equal(result.valid, false);
    assert.match(result.message, /有效数字/);
  }
  const text = validateBudget('12000' as unknown as number, 'CNY');
  assert.equal(text.valid, false);
  assert.match(text.message, /有效数字/);

  const precision = validateBudget(12.345, 'CNY');
  assert.equal(precision.valid, false);
  assert.deepEqual(precision.issues, ['amount-precision']);
  assert.match(precision.message, /最多两位小数/);
  assert.match(precision.message, /不会自动截断/);
  assert.equal(precision.cents, undefined);
  assert.equal(precision.amount, undefined);

  // 合法两位小数不因浮点尾差被误判
  assert.equal(validateBudget(1234567890.12, 'CNY').valid, true);
  assert.equal(validateBudget(0.07, 'CNY').valid, true);
  assert.equal(validateBudget(0.1 + 0.2, 'CNY').valid, true);
});

test('BUD01 币种限 CNY/EUR/USD，默认空不预选也不暗转', () => {
  const missingCurrency = validateBudget(100, '');
  assert.equal(missingCurrency.valid, false);
  assert.deepEqual(missingCurrency.issues, ['currency-missing']);
  assert.match(missingCurrency.message, /请选择预计预算币种/);

  for (const currency of ['JPY', 'RMB', 'cny', '欧元']) {
    const result = validateBudget(100, currency);
    assert.equal(result.valid, false, currency);
    assert.deepEqual(result.issues, ['currency-invalid']);
    assert.match(result.message, /只能是 CNY \/ EUR \/ USD/);
  }

  const bothMissing = validateBudget(undefined, undefined);
  assert.deepEqual(bothMissing.issues, ['amount-missing', 'currency-missing']);
});

test('BUD02 分币种以最小货币单位精确汇总，不做跨币种换算', () => {
  const summary = summarizeProjectBudget('DEMO-PX', [
    planFixture({ id: 'P1', budgetAmount: 0.01, budgetCurrency: 'CNY' }),
    planFixture({ id: 'P2', budgetAmount: 0.02, budgetCurrency: 'CNY' }),
    planFixture({ id: 'P3', budgetAmount: 1800000, budgetCurrency: 'CNY' }),
    planFixture({ id: 'P4', budgetAmount: 1500.55, budgetCurrency: 'EUR' }),
    planFixture({ id: 'P5', budgetAmount: 62000, budgetCurrency: 'USD' }),
  ]);
  assert.deepEqual(
    summary.filled.map((total) => [total.currency, total.amount, total.count]),
    [
      ['CNY', 1800000.03, 3],
      ['EUR', 1500.55, 1],
      ['USD', 62000, 1],
    ],
  );
  assert.equal(summary.filledCount, 5);
  assert.equal(summary.missingCount, 0);
  assert.equal(summary.complete, true);
});

test('BUD02 按稳定 projectId+planId 去重，父子/前置不重复计数', () => {
  const parent = planFixture({
    id: 'PL-100',
    name: '父任务',
    budgetAmount: 500,
    budgetCurrency: 'CNY',
  });
  const child = planFixture({
    id: 'PL-101',
    name: '前置子任务',
    predecessor: 'WBS-01',
    budgetAmount: 300,
    budgetCurrency: 'CNY',
  });
  const duplicate = { ...child };
  const summary = summarizeProjectBudget('DEMO-PX', [parent, child, duplicate]);
  assert.deepEqual(
    summary.filled.map((total) => [total.currency, total.amount, total.count]),
    [['CNY', 800, 2]],
  );
  assert.equal(summary.totalCount, 2);
  assert.equal(summary.filledCount, 2);
});

test('BUD02 已完成计入，已取消排除并单独标注', () => {
  const summary = summarizeProjectBudget('DEMO-PX', [
    planFixture({
      id: 'P1',
      status: '已完成',
      actual: '2026-10-20',
      budgetAmount: 100,
      budgetCurrency: 'CNY',
    }),
    planFixture({ id: 'P2', status: '进行中', budgetAmount: 200, budgetCurrency: 'CNY' }),
    planFixture({ id: 'P3', status: '已取消', budgetAmount: 900, budgetCurrency: 'CNY' }),
    planFixture({ id: 'P4', status: '已取消', budgetAmount: 50, budgetCurrency: 'EUR' }),
  ]);
  assert.deepEqual(
    summary.filled.map((total) => [total.currency, total.amount, total.count]),
    [['CNY', 300, 2]],
  );
  assert.equal(summary.filledCount, 2);
  assert.equal(summary.cancelledCount, 2);
  assert.deepEqual(
    summary.cancelled.map((total) => [total.currency, total.amount, total.count]),
    [
      ['CNY', 900, 1],
      ['EUR', 50, 1],
    ],
  );
  assert.equal(summary.missingCount, 0);
});

test('BUD03 已取消任务只填了金额时仍列为待核，不从所有分桶中消失', () => {
  const summary = summarizeProjectBudget('DEMO-PX', [
    planFixture({ id: 'P1', status: '进行中', budgetAmount: 100, budgetCurrency: 'CNY' }),
    planFixture({ id: 'P2', status: '已取消', budgetAmount: 88, budgetCurrency: '' }),
    planFixture({ id: 'P3', status: '已取消', budgetAmount: 77, budgetCurrency: 'JPY' }),
    planFixture({ id: 'P4', status: '已取消' }),
  ]);
  assert.deepEqual(
    summary.pendingReview.map((total) => [total.currency, total.amount, total.count]),
    [
      ['JPY', 77, 1],
      [BUDGET_REVIEW_TEXT, 88, 1],
    ],
  );
  assert.equal(summary.pendingReviewCount, 2);
  assert.equal(summary.cancelledCount, 0);
  assert.equal(summary.missingCount, 0, '已取消且未填金额不进入待补任务数');
  assert.equal(summary.complete, false, '存在待核币种时不算填齐');
});

test('BUD03 缺值显示待补数与已填部分合计，不把缺失当 0，也不迁移回款金额', () => {
  const summary = summarizeProjectBudget('DEMO-PX', [
    planFixture({ id: 'P1', budgetAmount: 100, budgetCurrency: 'CNY' }),
    planFixture({ id: 'P2' }),
    // 开票回款语义：amount/currency 有值但没有预算，不能被当成预算。
    planFixture({ id: 'P3', amount: 1200000, currency: 'USD' }),
    planFixture({ id: 'P4', status: '已取消' }),
  ]);
  assert.deepEqual(
    summary.filled.map((total) => [total.currency, total.amount, total.count]),
    [['CNY', 100, 1]],
  );
  assert.equal(summary.filledCount, 1);
  assert.equal(summary.missingCount, 2);
  assert.deepEqual(summary.missingPlanIds, ['P2', 'P3']);
  assert.equal(summary.complete, false);
  assert.equal(
    summary.filled.some((total) => total.currency === 'USD'),
    false,
    '回款金额不得进入预算合计',
  );

  const legacy = readPlanBudget(planFixture({ id: 'P3', amount: 1200000, currency: 'USD' }));
  assert.equal(legacy.amountCents, null);
  assert.equal(legacy.usable, false);
  assert.equal(budgetCellText(planFixture({ id: 'P3' })), '预算待补');
});

test('BUD03 异常币种标待核、不暗转 CNY', () => {
  const summary = summarizeProjectBudget('DEMO-PX', [
    planFixture({ id: 'P1', budgetAmount: 100, budgetCurrency: 'JPY' }),
    planFixture({ id: 'P2', budgetAmount: 200 }),
    planFixture({ id: 'P3', budgetAmount: 300, budgetCurrency: 'CNY' }),
    // 币种未选择时同样不计入合计，也不静默补齐
    planFixture({ id: 'P4', budgetAmount: 400, budgetCurrency: '' }),
  ]);
  assert.deepEqual(
    summary.filled.map((total) => [total.currency, total.amount, total.count]),
    [['CNY', 300, 1]],
  );
  assert.equal(summary.pendingReviewCount, 3);
  assert.deepEqual(
    summary.pendingReview.map((total) => [total.currency, total.amount, total.count]),
    [
      ['JPY', 100, 1],
      ['币种待核', 600, 2],
    ],
  );
  assert.equal(summary.complete, false);
  const jpy = readPlanBudget(planFixture({ id: 'P1', budgetAmount: 100, budgetCurrency: 'JPY' }));
  assert.equal(jpy.usable, false);
  assert.equal(jpy.currencyValid, false);
  assert.match(
    budgetCellText(planFixture({ id: 'P1', budgetAmount: 100, budgetCurrency: 'JPY' })),
    /币种待核/,
  );
  assert.match(formatBudgetAmount(10000, 'JPY'), /100\.00 JPY/);
});

test('BUD03 非内部WBS计划不承载预算，文档与样例口径一致', () => {
  const summary = summarizeProjectBudget('DEMO-PX', [
    { ...blankPlan('客户主节点'), id: 'M1', budgetAmount: 999, budgetCurrency: 'CNY' } as Plan,
    { ...blankPlan('开票回款'), id: 'B1', amount: 800000, currency: 'CNY' } as Plan,
    { ...blankPlan('内部WBS'), id: 'W1', budgetAmount: 50, budgetCurrency: 'EUR' } as Plan,
  ]);
  assert.equal(summary.totalCount, 1);
  assert.deepEqual(
    summary.filled.map((total) => [total.currency, total.amount, total.count]),
    [['EUR', 50, 1]],
  );
  assert.equal(budgetCellText({ ...blankPlan('客户主节点'), id: 'M1' } as Plan), '—');
});

test('种子样例：内部WBS带模拟预算，待补样例不被算成0', () => {
  const state = createSeed();
  const project = state.projects[0];
  const summary = summarizeProjectBudget(project.id, project.plans);
  const wbs = project.plans.filter((plan) => plan.type === '内部WBS');
  assert.equal(summary.totalCount, wbs.length);
  assert.deepEqual(
    summary.filled.map((total) => [total.currency, total.amount, total.count]),
    [
      ['CNY', 2200000, 7],
      ['EUR', 48000, 1],
      ['USD', 62000, 1],
    ],
  );
  assert.equal(summary.missingCount, 1);
  assert.equal(summary.complete, false);
  assert.equal(summary.simulatedCount, summary.filledCount);
  const pending = wbs.find((plan) => plan.id === summary.missingPlanIds[0])!;
  assert.equal(pending.name, '内部移交');
  assert.equal(budgetCellText(pending), '预算待补');
  assert.match(budgetCellText(wbs[0]), /· 模拟$/);
});

test('BUD01/BUD04 Store：内部WBS新建与编辑保存要求预算齐全，0 合法，非法值保持旧数据', () => {
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const wbs = editableWbs(store, projectId);

  const before = structuredClone(store.state());
  const beforeSummary = store.planBudgetSummary(projectId);
  for (const invalid of [
    { budgetAmount: undefined, budgetCurrency: 'CNY' },
    { budgetAmount: 100, budgetCurrency: '' },
    { budgetAmount: -1, budgetCurrency: 'CNY' },
    { budgetAmount: 12.345, budgetCurrency: 'CNY' },
    { budgetAmount: Number.NaN, budgetCurrency: 'CNY' },
    { budgetAmount: 100, budgetCurrency: 'JPY' },
  ]) {
    assert.throws(
      () => store.savePlan(projectId, { ...wbs, ...invalid }),
      /预算/,
      JSON.stringify(invalid),
    );
  }
  assert.deepEqual(store.state().projects, before.projects);
  assert.deepEqual(store.planBudgetSummary(projectId), beforeSummary);

  assert.equal(store.savePlan(projectId, { ...wbs, budgetAmount: 0, budgetCurrency: 'USD' }), true);
  const saved = store.project(projectId)!.plans.find((plan) => plan.id === wbs.id)!;
  assert.equal(saved.budgetAmount, 0);
  assert.equal(saved.budgetCurrency, 'USD');
  assert.equal(saved.budgetSource, '业务填报');

  // 新建内部WBS同样要求预算
  const created = {
    ...blankPlan('内部WBS'),
    id: 'PL-BUDGET-NEW',
    name: '新建内部WBS',
    warningLeadDays: 7,
  };
  assert.throws(() => store.savePlan(projectId, created), /预算/);
  assert.equal(
    store.project(projectId)!.plans.some((plan) => plan.id === 'PL-BUDGET-NEW'),
    false,
  );
  assert.equal(
    store.savePlan(projectId, { ...created, budgetAmount: 88.8, budgetCurrency: 'EUR' }),
    true,
  );
  assert.equal(
    store.project(projectId)!.plans.find((plan) => plan.id === 'PL-BUDGET-NEW')!.budgetAmount,
    88.8,
  );
});

test('BUD04 Store：编辑金额/币种与取消任务在同一次提交内更新表格、摘要与历史', () => {
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const wbs = editableWbs(store, projectId);
  const beforeSummary = store.planBudgetSummary(projectId);
  const beforeEvents = (store.state().operationEvents || []).length;

  assert.equal(
    store.savePlan(projectId, { ...wbs, budgetAmount: 999999.99, budgetCurrency: 'EUR' }),
    true,
  );
  const updated = store.planBudgetSummary(projectId);
  const eur = updated.filled.find((total) => total.currency === 'EUR')!;
  const oldEur = beforeSummary.filled.find((total) => total.currency === 'EUR')!;
  const cny = updated.filled.find((total) => total.currency === 'CNY')!;
  const oldCny = beforeSummary.filled.find((total) => total.currency === 'CNY')!;
  // 该任务原为 CNY 1800000 的模拟样例预算，本次改为 EUR 999999.99。
  assert.equal(eur.amount, oldEur.amount + 999999.99);
  assert.equal(eur.count, oldEur.count + 1);
  assert.equal(cny.amount, oldCny.amount - 1800000);
  assert.equal((store.state().operationEvents || []).length, beforeEvents + 1);
  assert.ok(store.history(projectId).at(-1)!.action.includes(wbs.name));
  const budgetChanges = (store.state().operationEvents || [])
    .at(-1)!
    .changes.filter((change) => change.field.startsWith('budget'))
    .map((change) => [change.field, change.before, change.after])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(
    budgetChanges,
    [
      ['budgetAmount', 1800000, 999999.99],
      ['budgetCurrency', 'CNY', 'EUR'],
      ['budgetSource', '模拟', '业务填报'],
    ],
    '预算变更应在同一次提交内进入操作历史（含变更前值）',
  );

  const cancelled = store.project(projectId)!.plans.find((plan) => plan.id === wbs.id)!;
  assert.equal(store.savePlan(projectId, { ...cancelled, status: '已取消' }), true);
  const afterCancel = store.planBudgetSummary(projectId);
  assert.equal(afterCancel.filled.find((total) => total.currency === 'EUR')!.amount, oldEur.amount);
  assert.equal(afterCancel.cancelled.find((total) => total.currency === 'EUR')!.amount, 999999.99);
  assert.equal(afterCancel.cancelledCount, 1);
});

test('BUD04 Store：日期/预警、切档、标已读不改预算；无关类型不被旧缺值阻断', () => {
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const wbs = editableWbs(store, projectId);
  const beforeSummary = store.planBudgetSummary(projectId);

  assert.equal(
    store.savePlan(projectId, {
      ...wbs,
      end: '2026-12-01',
      expected: '2026-12-01',
      warningLeadDays: 3,
    }),
    true,
  );
  assert.deepEqual(store.planBudgetSummary(projectId), beforeSummary);

  assert.equal(store.setDateMode('comparison'), true);
  assert.deepEqual(store.planBudgetSummary(projectId), beforeSummary);

  const notice = store.state().notices.find((item) => item.entityId === projectId);
  if (notice) store.markNotice(notice.id);
  assert.deepEqual(store.planBudgetSummary(projectId), beforeSummary);

  // 旧内部WBS缺预算只锁该计划的预算编辑，不阻断其他计划类型与只读查看
  const legacy = { ...blankPlan('内部WBS'), id: 'PL-LEGACY-NO-BUDGET', name: '旧样例任务' };
  store.state.update((state) => {
    state.projects.find((item) => item.id === projectId)!.plans.push(legacy);
    return state;
  });
  assert.equal(store.planBudgetSummary(projectId).missingCount, beforeSummary.missingCount + 1);
  const milestone = store.project(projectId)!.plans.find((plan) => plan.type === '客户主节点')!;
  // 客户主节点不是内部WBS：预算字段被隔离丢弃，也不进入分币种汇总，同时不被旧缺值阻断。
  assert.equal(
    store.savePlan(projectId, {
      ...milestone,
      warningLeadDays: 2,
      budgetAmount: 5,
      budgetCurrency: 'CNY',
    }),
    true,
  );
  const savedMilestone = store.project(projectId)!.plans.find((plan) => plan.id === milestone.id)!;
  assert.equal(savedMilestone.warningLeadDays, 2);
  assert.equal(savedMilestone.budgetAmount, undefined);
  assert.equal(savedMilestone.budgetCurrency, undefined);
  assert.equal(
    store.planBudgetSummary(projectId).filled.some((total) => total.amount === 5),
    false,
  );
});

test('BUD04 Store：校验失败、修改权失败与存储版本失败都保持旧汇总不变', () => {
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const wbs = editableWbs(store, projectId);
  const snapshot = structuredClone(store.state());
  const beforeSummary = store.planBudgetSummary(projectId);

  assert.throws(
    () => store.savePlan(projectId, { ...wbs, budgetAmount: 1.005, budgetCurrency: 'CNY' }),
    /两位小数/,
  );
  assert.deepEqual(store.state(), snapshot);
  assert.deepEqual(store.planBudgetSummary(projectId), beforeSummary);

  const lease = { owns: () => false };
  Object.assign(store, { editingLease: lease, editingWritable: signal(true) });
  assert.throws(
    () => store.savePlan(projectId, { ...wbs, budgetAmount: 12345, budgetCurrency: 'CNY' }),
    /修改权/,
  );
  Object.assign(store, { editingLease: undefined });
  assert.deepEqual(store.state(), snapshot);
  assert.deepEqual(store.planBudgetSummary(projectId), beforeSummary);

  const versionConflict = { ...snapshot, dataVersion: (snapshot.dataVersion || 1) + 99 };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => JSON.stringify(versionConflict),
      setItem: () => {},
    },
  });
  assert.throws(
    () => store.savePlan(projectId, { ...wbs, budgetAmount: 12345, budgetCurrency: 'CNY' }),
    /存储中的数据版本已变化/,
  );
  assert.deepEqual(store.state(), snapshot);
  assert.deepEqual(store.planBudgetSummary(projectId), beforeSummary);
});
