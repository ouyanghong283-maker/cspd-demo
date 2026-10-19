import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, blankPlan } from '../src/app/core/seed';
import {
  DEMO_COMPARISON_DATE,
  DEMO_NORMAL_DATE,
  isValidWarningLeadDays,
  observationDateForMode,
  planRisk,
  riskClass,
} from '../src/app/core/rules';
import { DemoDateMode, Plan } from '../src/app/core/models';
import { harness } from './v4-harness';

function planFixture(overrides: Partial<Plan>): Plan {
  return {
    ...blankPlan('内部WBS'),
    id: 'PL-001',
    name: '测试任务',
    start: '2026-10-12',
    end: '2026-10-20',
    expected: '2026-10-20',
    actual: '',
    status: '未开始',
    warningLeadDays: 7,
    ...overrides,
  } as Plan;
}

test('观察日期集中配置：正常档与对比档', () => {
  assert.equal(observationDateForMode('normal'), DEMO_NORMAL_DATE);
  assert.equal(observationDateForMode('comparison'), DEMO_COMPARISON_DATE);
});

test('W=E-N 纯日期风险边界：W前一天蓝、W当天黄、E当天黄、E次日红', () => {
  const end = '2026-10-20';
  const n = 5;
  // W = 10-15
  assert.equal(planRisk(planFixture({ end, warningLeadDays: n }), '2026-10-14').level, 'blue');
  assert.equal(planRisk(planFixture({ end, warningLeadDays: n }), '2026-10-15').level, 'yellow');
  assert.equal(planRisk(planFixture({ end, warningLeadDays: n }), '2026-10-20').level, 'yellow');
  assert.equal(planRisk(planFixture({ end, warningLeadDays: n }), '2026-10-21').level, 'red');
});

test('0预警天数合法：结束当天黄，之后红', () => {
  const end = '2026-10-20';
  assert.equal(planRisk(planFixture({ end, warningLeadDays: 0 }), '2026-10-19').level, 'blue');
  assert.equal(planRisk(planFixture({ end, warningLeadDays: 0 }), '2026-10-20').level, 'yellow');
  assert.equal(planRisk(planFixture({ end, warningLeadDays: 0 }), '2026-10-21').level, 'red');
});

test('预警天数大于工期合法：观察日在预警窗口前仍蓝', () => {
  const end = '2026-11-30';
  const n = 30;
  // W = 10-31
  assert.equal(planRisk(planFixture({ start: '2026-10-10', end, warningLeadDays: n }), '2026-10-15').level, 'blue');
  assert.equal(planRisk(planFixture({ start: '2026-10-10', end, warningLeadDays: n }), '2026-10-31').level, 'yellow');
  assert.equal(planRisk(planFixture({ start: '2026-10-10', end, warningLeadDays: n }), '2026-11-30').level, 'yellow');
});

test('合法完成绿；逾期完成附标识且不缺结束日', () => {
  const end = '2026-10-20';
  const onTime = planRisk(planFixture({ end, status: '已完成', actual: '2026-10-20' }), '2026-10-22');
  assert.equal(onTime.level, 'green');
  assert.equal(onTime.overdueCompleted, false);

  const overdue = planRisk(planFixture({ end, status: '已完成', actual: '2026-10-21' }), '2026-10-22');
  assert.equal(overdue.level, 'green');
  assert.equal(overdue.overdueCompleted, true);
  assert.ok(overdue.missing.includes('实际完成日期说明'));
});

test('已取消与缺结束日均为灰', () => {
  assert.equal(planRisk(planFixture({ status: '已取消' }), '2026-10-15').level, 'gray');
  assert.equal(planRisk(planFixture({ end: '' }), '2026-10-15').level, 'gray');
  assert.equal(planRisk(planFixture({ end: 'invalid' }), '2026-10-15').level, 'gray');
});

test('已知逾期即使缺预警天数仍红并标待补', () => {
  const end = '2026-10-20';
  const risk = planRisk(planFixture({ end, warningLeadDays: undefined }), '2026-10-21');
  assert.equal(risk.level, 'red');
  assert.ok(risk.missing.includes('已逾期'));
  assert.ok(risk.missing.includes('预警天数'));
});

test('未逾期缺预警天数灰', () => {
  const end = '2026-10-20';
  const risk = planRisk(planFixture({ end, warningLeadDays: undefined }), '2026-10-15');
  assert.equal(risk.level, 'gray');
  assert.ok(risk.missing.includes('预警天数'));
});

test('推迟 expected 不消除 end 逾期', () => {
  const end = '2026-10-20';
  const risk = planRisk(planFixture({ end, expected: '2026-10-25', warningLeadDays: 7 }), '2026-10-22');
  assert.equal(risk.level, 'red');
});

test('风险 CSS 类映射完整', () => {
  assert.equal(riskClass('green'), 'risk-green');
  assert.equal(riskClass('blue'), 'risk-blue');
  assert.equal(riskClass('yellow'), 'risk-yellow');
  assert.equal(riskClass('red'), 'risk-red');
  assert.equal(riskClass('gray'), 'risk-gray');
});

test('预警天数校验：非负整数通过，负数/小数/字符串拒绝', () => {
  assert.equal(isValidWarningLeadDays(0), true);
  assert.equal(isValidWarningLeadDays(7), true);
  assert.equal(isValidWarningLeadDays(undefined), false);
  assert.equal(isValidWarningLeadDays(null), false);
  assert.equal(isValidWarningLeadDays(-1), false);
  assert.equal(isValidWarningLeadDays(3.5), false);
  assert.equal(isValidWarningLeadDays('7'), false);
});

test('保存计划时预警天数校验：合法通过，非法拒绝且不改旧计划', () => {
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const plan = store.project(projectId)!.plans.find((p) => p.type === '客户主节点')!;
  const before = structuredClone(plan);

  const valid = { ...plan, warningLeadDays: 5 };
  assert.ok(store.savePlan(projectId, valid));
  assert.equal(store.project(projectId)!.plans.find((p) => p.id === plan.id)!.warningLeadDays, 5);

  const invalid = { ...plan, warningLeadDays: -1 };
  assert.throws(() => store.savePlan(projectId, invalid), /预警天数/);
  assert.deepEqual(
    store.project(projectId)!.plans.find((p) => p.id === plan.id)!.warningLeadDays,
    5,
  );

  const empty = { ...plan, warningLeadDays: undefined };
  assert.ok(store.savePlan(projectId, empty));
  assert.equal(
    store.project(projectId)!.plans.find((p) => p.id === plan.id)!.warningLeadDays,
    undefined,
  );
});

test('客户主节点 end 修改生成里程碑同步记录，失败时不改旧计划', () => {
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const plan = store.project(projectId)!.plans.find((p) => p.type === '客户主节点')!;
  const oldEnd = plan.end;
  const updated = { ...plan, end: '2026-11-01' };
  assert.ok(store.savePlan(projectId, updated));
  const record = store
    .state()
    .milestoneSyncRecords!.find((r) => r.sourcePlanId === plan.id && r.projectId === projectId);
  assert.ok(record);
  assert.equal(record!.oldCustomerAgreedDate, oldEnd);
  assert.equal(record!.customerAgreedDate, '2026-11-01');
  assert.ok(record!.operator);
  assert.ok(record!.createdAt);

  const beforeFail = structuredClone(store.project(projectId)!.plans.find((p) => p.id === plan.id));
  assert.throws(
    () => store.savePlan(projectId, { ...beforeFail, end: 'not-a-date' }),
    /起止日期/,
  );
  assert.deepEqual(
    store.project(projectId)!.plans.find((p) => p.id === plan.id),
    beforeFail,
  );
});

test('新建 WBS 与客户主节点同样校验预警天数，0 与大于工期合法', () => {
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const created = (id: string, type: '内部WBS' | '客户主节点', warningLeadDays?: number) => ({
    ...blankPlan(type),
    id,
    name: `新建${type}`,
    warningLeadDays,
    // BUD01：仅内部WBS保存时要求预算齐全（客户主节点不承载预算）。
    ...(type === '内部WBS' ? { budgetAmount: 1000, budgetCurrency: 'CNY' } : {}),
  });

  assert.throws(() => store.savePlan(projectId, created('PL-NEW-WBS', '内部WBS', -1)), /预警天数/);
  assert.throws(
    () => store.savePlan(projectId, created('PL-NEW-NODE', '客户主节点', 2.5)),
    /预警天数/,
  );
  assert.equal(
    store.project(projectId)!.plans.some((p) => p.id === 'PL-NEW-WBS' || p.id === 'PL-NEW-NODE'),
    false,
  );

  assert.ok(store.savePlan(projectId, created('PL-NEW-WBS', '内部WBS', 0)));
  assert.ok(store.savePlan(projectId, created('PL-NEW-NODE', '客户主节点', 40)));
  assert.equal(
    store.project(projectId)!.plans.find((p) => p.id === 'PL-NEW-WBS')!.warningLeadDays,
    0,
  );
  assert.equal(
    store.project(projectId)!.plans.find((p) => p.id === 'PL-NEW-NODE')!.warningLeadDays,
    40,
  );
});

test('模拟日期模式持久化：切换后刷新保留', () => {
  const { store } = harness();
  let saved = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => saved || null,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    },
  });
  assert.equal(store.dateMode(), 'normal');
  assert.ok(store.setDateMode('comparison'));
  assert.equal(store.dateMode(), 'comparison');

  const load = Reflect.get(store, 'load').bind(store) as () => { dateMode: DemoDateMode };
  assert.equal(load().dateMode, 'comparison');

  assert.ok(store.setDateMode('normal'));
  assert.equal(load().dateMode, 'normal');
});

test('切换模式不追加业务历史，对比档下的操作日志仍用真实时间', () => {
  const { store, role } = harness();
  role('pm');
  const businessHistory = JSON.stringify(store.state().history);
  assert.ok(store.setDateMode('comparison'));
  assert.equal(JSON.stringify(store.state().history), businessHistory);
  assert.equal((store.state().operationEvents || []).length, 0);

  const projectId = 'DEMO-P003';
  const plan = store.project(projectId)!.plans.find((p) => p.type === '客户主节点')!;
  assert.ok(store.savePlan(projectId, { ...plan, warningLeadDays: 4 }));
  const latest = (store.state().operationEvents || []).at(-1)!;
  assert.equal(latest.occurredAt.slice(0, 10), new Date().toISOString().slice(0, 10));
  assert.ok(!latest.occurredAt.startsWith(DEMO_COMPARISON_DATE));
});

test('切换模式不改计划、预算、合同或完成历史', () => {
  const { store } = harness();
  const before = structuredClone(store.state());
  store.setDateMode('comparison');
  const after = store.state();
  assert.deepEqual(after.projects, before.projects);
  assert.deepEqual(after.contracts, before.contracts);
  assert.deepEqual(after.financeSnapshots, before.financeSnapshots);
  assert.notEqual(after.dateMode, before.dateMode);
});

test('种子样例在正常档下未完成 WBS/客户节点为蓝或绿，对比档至少客户节点红、WBS黄', () => {
  const state = createSeed();
  for (const project of state.projects) {
    for (const plan of project.plans.filter(
      (p) => p.type === '内部WBS' || p.type === '客户主节点',
    )) {
      const normal = planRisk(plan, DEMO_NORMAL_DATE);
      if (plan.status === '已完成') {
        assert.equal(normal.level, 'green', `${project.id} ${plan.id} ${plan.name}`);
      } else {
        assert.equal(normal.level, 'blue', `${project.id} ${plan.id} ${plan.name}`);
      }
    }
  }

  const comparisonChecks = state.projects.map((project) => {
    const risks = project.plans
      .filter((p) => p.type === '内部WBS' || p.type === '客户主节点')
      .map((p) => ({ plan: p, risk: planRisk(p, DEMO_COMPARISON_DATE) }));
    const customerRed = risks.some((r) => r.plan.type === '客户主节点' && r.risk.level === 'red');
    const wbsYellow = risks.some((r) => r.plan.type === '内部WBS' && r.risk.level === 'yellow');
    return { projectId: project.id, customerRed, wbsYellow };
  });
  for (const check of comparisonChecks) {
    assert.ok(check.customerRed, `${check.projectId} 对比档客户节点应红`);
    assert.ok(check.wbsYellow, `${check.projectId} 对比档至少一个 WBS 应黄`);
  }
});
