import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankPlan, createSeed } from '../src/app/core/seed';
import { Plan } from '../src/app/core/models';
import {
  DEMO_COMPARISON_DATE,
  DEMO_NORMAL_DATE,
  addDaysISO,
  daysBetweenISO,
  isValidISODate,
  planRisk,
  riskClass,
} from '../src/app/core/rules';
import {
  GANTT_LEGEND,
  ganttBar,
  ganttObservationMarker,
  ganttRange,
  ganttTicks,
} from '../src/app/core/gantt';
import { harness } from './v4-harness';

function planFixture(overrides: Partial<Plan>): Plan {
  return {
    ...blankPlan('内部WBS'),
    id: 'PL-001',
    name: '测试任务',
    owner: '王项目',
    start: '2026-10-12',
    end: '2026-10-20',
    expected: '2026-10-20',
    actual: '',
    status: '未开始',
    warningLeadDays: 5,
    ...overrides,
  } as Plan;
}

test('新增日期工具：非法输入不抛出', () => {
  assert.equal(isValidISODate('2026-02-30'), false);
  assert.equal(isValidISODate('2026-10-15'), true);
  assert.equal(daysBetweenISO('2026-10-15', '2026-10-20'), 5);
  assert.equal(daysBetweenISO('bad', '2026-10-20'), undefined);
  assert.equal(addDaysISO('2026-10-15', 5), '2026-10-20');
  assert.equal(addDaysISO('bad', 5), 'bad');
});

test('动态轴范围覆盖全部任务起止与当前模拟日', () => {
  const plans = [
    planFixture({ id: 'PL-A', start: '2026-10-12', end: '2026-10-20' }),
    planFixture({ id: 'PL-B', start: '2026-11-02', end: '2026-11-06' }),
  ];
  const range = ganttRange(plans, '2026-10-25');
  assert.equal(range.valid, true);
  assert.equal(range.start, '2026-10-12');
  assert.equal(range.end, '2026-11-06');
  assert.equal(range.days, daysBetweenISO('2026-10-12', '2026-11-06')! + 1);
  assert.ok(range.dayCellPx * (range.days - 1) <= range.chartWidthPx);
  assert.equal(range.dayPercent, 100 / range.days);
  assert.ok(range.gridPercent > 0);
});

test('模拟日在全部任务之外时轴自动伸展以覆盖它', () => {
  const plans = [planFixture({ start: '2026-10-12', end: '2026-10-20' })];
  const later = ganttRange(plans, '2026-10-25');
  assert.equal(later.end, '2026-10-25');
  const earlier = ganttRange(plans, '2026-10-01');
  assert.equal(earlier.start, '2026-10-01');
  assert.equal(earlier.end, '2026-10-20');
});

test('跨旧 2026-10 至 11 月窗口的计划仍可见', () => {
  const plans = [
    planFixture({ id: 'PL-OLD', start: '2026-10-12', end: '2026-10-20' }),
    planFixture({ id: 'PL-FAR', start: '2027-01-05', end: '2027-03-15' }),
  ];
  const range = ganttRange(plans, DEMO_NORMAL_DATE);
  assert.equal(range.start, '2026-10-12');
  assert.equal(range.end, '2027-03-15');
  const far = ganttBar(plans[1], range, DEMO_NORMAL_DATE);
  assert.equal(far.renderable, true);
  assert.ok(far.left > 0 && far.left < 100);
  assert.ok(far.left + far.width <= 100.001);
  assert.ok(far.width > 0);
  assert.equal(far.left + far.width > 50, true);
});

test('单日任务不小于最小日格，像素上可见', () => {
  const single = planFixture({
    id: 'PL-SINGLE',
    start: '2026-10-15',
    end: '2026-10-15',
    warningLeadDays: 0,
  });
  const longAxis = [single, planFixture({ id: 'PL-LONG', start: '2026-10-01', end: '2027-04-18' })];
  const range = ganttRange(longAxis, DEMO_NORMAL_DATE);
  const bar = ganttBar(single, range, DEMO_NORMAL_DATE);
  assert.equal(bar.renderable, true);
  assert.equal(bar.milestone, true);
  assert.ok(bar.width >= range.dayPercent - 0.001, '单日条带不得小于一个日格');
  assert.ok(bar.width >= 100 / range.days - 0.001);
  assert.ok((bar.width / 100) * range.chartWidthPx >= 20, '单日条带在屏幕上至少可见 20 像素');

  const tinyAxis = ganttRange([single], DEMO_NORMAL_DATE);
  assert.equal(tinyAxis.days, 1);
  const tiny = ganttBar(single, tinyAxis, DEMO_NORMAL_DATE);
  assert.equal(tiny.left, 0);
  assert.equal(tiny.width, 100);
  assert.ok(tinyAxis.dayCellPx >= 26);
});

test('超长跨度允许横向滚动，不无限撑开图表', () => {
  const range = ganttRange(
    [planFixture({ start: '2020-01-01', end: '2035-12-31' })],
    DEMO_NORMAL_DATE,
  );
  assert.equal(range.valid, true);
  assert.ok(range.chartWidthPx <= 24000);
  assert.ok(range.chartWidthPx > GANTT_LEGEND.length * 100);
  const bar = ganttBar(
    planFixture({ start: '2020-01-01', end: '2035-12-31' }),
    range,
    DEMO_NORMAL_DATE,
  );
  assert.equal(bar.renderable, true);
  assert.equal(bar.left, 0);
  assert.equal(bar.width, 100);
});

test('缺失与非法日期不抛出，条带不渲染但仍给出风险文字', () => {
  const range = ganttRange([planFixture({})], DEMO_NORMAL_DATE);
  for (const broken of [
    planFixture({ start: '', end: '2026-10-20' }),
    planFixture({ start: '2026-10-12', end: '' }),
    planFixture({ start: '2026-10-12', end: '2026-13-40' }),
    planFixture({ start: 'not-a-date', end: '2026-10-20' }),
  ]) {
    const bar = ganttBar(broken, range, DEMO_NORMAL_DATE);
    assert.equal(bar.renderable, false);
    assert.equal(bar.cssClass, riskClass(planRisk(broken, DEMO_NORMAL_DATE).level));
    assert.ok(bar.label.length > 0);
  }
  const noDates = ganttRange([planFixture({ start: '', end: '' })], DEMO_NORMAL_DATE);
  assert.equal(noDates.valid, true);
  assert.equal(noDates.start, DEMO_NORMAL_DATE);
  assert.equal(noDates.days, 1);
});

test('起止倒置不抛出，标记为不可渲染', () => {
  const plans = [planFixture({ start: '2026-10-20', end: '2026-10-12' })];
  const range = ganttRange(plans, DEMO_NORMAL_DATE);
  const bar = ganttBar(plans[0], range, DEMO_NORMAL_DATE);
  assert.equal(bar.renderable, false);
  assert.equal(bar.reason, '起止日期倒置');
  assert.equal(
    bar.left,
    Math.round((daysBetweenISO(range.start, plans[0].start)! / range.days) * 100 * 1000) / 1000,
  );
  assert.equal(bar.width, 0);
});

test('无可用日期与非法观察日返回不可用范围而不是抛出', () => {
  const range = ganttRange([], 'invalid');
  assert.equal(range.valid, false);
  assert.equal(range.days, 0);
  assert.ok(range.reason);
  assert.deepEqual(ganttTicks(range), []);
  assert.equal(ganttObservationMarker(range, 'invalid'), null);
  const plans = [planFixture({})];
  const bar = ganttBar(plans[0], range, 'invalid');
  assert.equal(bar.renderable, false);
  assert.equal(bar.level, 'gray');
});

test('甘特风险文字与颜色直接复用 planRisk/riskClass（GAN02/GAN03）', () => {
  const cases: Partial<Plan>[] = [
    { id: 'PL-CANCEL', status: '已取消' },
    { id: 'PL-NO-END', end: '' },
    { id: 'PL-NO-N', warningLeadDays: undefined },
    { id: 'PL-OVERDUE-DONE', status: '已完成', actual: '2026-10-21' },
    { id: 'PL-DONE', status: '已完成', actual: '2026-10-20' },
    { id: 'PL-OVERDUE', end: '2026-10-20', warningLeadDays: undefined },
    { id: 'PL-WARN', end: '2026-10-24', warningLeadDays: 3 },
    { id: 'PL-NORMAL', end: '2026-11-30', warningLeadDays: 3 },
  ];
  const plans = cases.map((partial) => planFixture(partial));
  for (const observationDate of [DEMO_NORMAL_DATE, DEMO_COMPARISON_DATE]) {
    const range = ganttRange(plans, observationDate);
    for (const plan of plans) {
      const bar = ganttBar(plan, range, observationDate);
      const table = planRisk(plan, observationDate);
      assert.equal(bar.label, table.label, `${plan.id} 甘特与表格风险文字一致`);
      assert.equal(bar.level, table.level, `${plan.id} 甘特与表格风险等级一致`);
      assert.equal(bar.cssClass, riskClass(table.level), `${plan.id} 甘特与表格颜色类一致`);
      assert.deepEqual(bar.risk.missing, table.missing, `${plan.id} 待补字段一致`);
      assert.equal(bar.risk.overdueCompleted, table.overdueCompleted);
    }
  }
});

test('已取消、缺日期、逾期完成在甘特与表格均同时有文字与颜色', () => {
  const plans = [
    planFixture({ id: 'PL-CANCEL', name: '取消节点', status: '已取消' }),
    planFixture({ id: 'PL-NO-END', name: '缺结束日', end: '' }),
    planFixture({
      id: 'PL-OVERDUE-DONE',
      name: '逾期完成',
      status: '已完成',
      actual: '2026-10-21',
      end: '2026-10-20',
    }),
  ];
  const range = ganttRange(plans, DEMO_COMPARISON_DATE);
  const bars = plans.map((plan) => ganttBar(plan, range, DEMO_COMPARISON_DATE));
  assert.equal(bars[0].label, '已取消');
  assert.equal(bars[0].cssClass, 'risk-gray');
  assert.equal(bars[0].renderable, true, '已取消但有合法日期仍应绘制灰色条带');
  assert.equal(bars[1].label, '日期待补');
  assert.equal(bars[1].cssClass, 'risk-gray');
  assert.equal(bars[1].renderable, false);
  assert.equal(bars[2].label, '已完成（逾期）');
  assert.equal(bars[2].cssClass, 'risk-green');
  assert.equal(bars[2].risk.overdueCompleted, true);
  assert.ok(bars[2].risk.missing.includes('实际完成日期说明'));
});

test('图例覆盖 08-01 的五个风险等级且映射到同一批 CSS 类', () => {
  const classes = GANTT_LEGEND.map((item) => riskClass(item.level));
  assert.deepEqual(classes, ['risk-blue', 'risk-yellow', 'risk-red', 'risk-green', 'risk-gray']);
  assert.equal(new Set(GANTT_LEGEND.map((item) => item.text)).size, GANTT_LEGEND.length);
  for (const item of GANTT_LEGEND) assert.ok(item.text.length > 0);
});

test('模拟日期线落在观察日所在日格内', () => {
  const plans = [planFixture({ start: '2026-10-12', end: '2026-10-24' })];
  const range = ganttRange(plans, DEMO_COMPARISON_DATE);
  const marker = ganttObservationMarker(range, DEMO_COMPARISON_DATE);
  assert.ok(marker);
  const index = daysBetweenISO(range.start, DEMO_COMPARISON_DATE)!;
  assert.equal(marker!.index, index);
  assert.ok(marker!.left >= (index / range.days) * 100);
  assert.ok(marker!.left <= ((index + 1) / range.days) * 100);
  assert.ok(marker!.left > 0 && marker!.left < 100);
  assert.equal(ganttObservationMarker(range, ''), null);
});

test('轴刻度覆盖首尾且不超出轴范围', () => {
  const plans = [
    planFixture({ start: '2026-10-01', end: '2027-06-30' }),
    planFixture({ id: 'PL-X', start: '2026-10-01', end: '2026-10-02' }),
  ];
  const range = ganttRange(plans, DEMO_NORMAL_DATE);
  const ticks = ganttTicks(range);
  assert.ok(ticks.length >= 2);
  assert.equal(ticks[0].index, 0);
  assert.equal(ticks[0].left, 0);
  assert.equal(ticks.at(-1)!.index, range.days - 1);
  assert.ok(ticks.at(-1)!.left < 100);
  for (const tick of ticks) assert.ok(tick.left >= 0 && tick.left < 100);
  for (const tick of ticks) assert.match(tick.label, /^\d+月\d+日$/);
});

test('切换模拟日期档位只改颜色文字，不改变条带几何', () => {
  const plans = createSeed().projects[0].plans.filter(
    (plan) => plan.type === '内部WBS' || plan.type === '客户主节点',
  );
  const normalRange = ganttRange(plans, DEMO_NORMAL_DATE);
  const comparisonRange = ganttRange(plans, DEMO_COMPARISON_DATE);
  assert.equal(normalRange.start, comparisonRange.start);
  assert.equal(normalRange.end, comparisonRange.end);
  for (const plan of plans) {
    const normal = ganttBar(plan, normalRange, DEMO_NORMAL_DATE);
    const comparison = ganttBar(plan, comparisonRange, DEMO_COMPARISON_DATE);
    assert.equal(normal.left, comparison.left, `${plan.id} 位置不随档位变化`);
    assert.equal(normal.width, comparison.width, `${plan.id} 宽度不随档位变化`);
    assert.equal(normal.label, planRisk(plan, DEMO_NORMAL_DATE).label);
    assert.equal(comparison.label, planRisk(plan, DEMO_COMPARISON_DATE).label);
  }
});

test('种子样例：正常档甘特全部为蓝/绿，对比档客户节点红、WBS 黄', () => {
  const state = createSeed();
  let customerRed = 0;
  let wbsYellow = 0;
  for (const project of state.projects) {
    const plans = project.plans.filter(
      (plan) => plan.type === '内部WBS' || plan.type === '客户主节点',
    );
    const normalRange = ganttRange(plans, DEMO_NORMAL_DATE);
    for (const plan of plans) {
      const bar = ganttBar(plan, normalRange, DEMO_NORMAL_DATE);
      const expected = plan.status === '已完成' ? 'green' : 'blue';
      assert.equal(bar.level, expected, `${project.id} ${plan.id} 正常档应为 ${expected}`);
    }
    const comparisonRange = ganttRange(plans, DEMO_COMPARISON_DATE);
    for (const plan of plans) {
      const bar = ganttBar(plan, comparisonRange, DEMO_COMPARISON_DATE);
      if (plan.type === '客户主节点' && bar.level === 'red') customerRed++;
      if (plan.type === '内部WBS' && bar.level === 'yellow') wbsYellow++;
    }
  }
  assert.ok(customerRed > 0, '对比档应有客户节点红');
  assert.ok(wbsYellow > 0, '对比档应有 WBS 黄');
});

test('GAN01：客户主节点与内部WBS读取同一份已保存计划，编辑保存后两视图一致', () => {
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const customer = store.project(projectId)!.plans.find((plan) => plan.type === '客户主节点')!;
  const wbs = store.project(projectId)!.plans.find((plan) => plan.type === '内部WBS')!;

  const before = {
    customer: { id: customer.id, start: customer.start, end: customer.end },
    wbs: { id: wbs.id, start: wbs.start, end: wbs.end },
  };
  assert.ok(store.savePlan(projectId, { ...customer, end: '2026-11-05' }));

  const saved = store.project(projectId)!;
  const savedCustomer = saved.plans.find((plan) => plan.id === customer.id)!;
  const savedWbs = saved.plans.find((plan) => plan.id === wbs.id)!;
  assert.equal(savedCustomer.id, before.customer.id, '同一 Plan ID');
  assert.equal(savedCustomer.end, '2026-11-05');
  assert.equal(savedWbs.end, before.wbs.end);

  for (const type of ['客户主节点', '内部WBS'] as const) {
    const plans = saved.plans.filter((plan) => plan.type === type);
    const range = ganttRange(plans, store.observationDate());
    for (const plan of plans) {
      const bar = ganttBar(plan, range, store.observationDate());
      const table = planRisk(plan, store.observationDate());
      assert.equal(bar.label, table.label, `${type} ${plan.id} 甘特与表格文字一致`);
      assert.equal(bar.cssClass, riskClass(table.level));
      assert.equal(bar.planId, plan.id);
    }
  }
  const customerBar = ganttBar(
    savedCustomer,
    ganttRange([savedCustomer, savedWbs], store.observationDate()),
    store.observationDate(),
  );
  assert.equal(customerBar.planId, before.customer.id);
  assert.ok(customerBar.width > 0);
});

test('GAN01：刷新后甘特与表格仍读取同一份已保存日期', () => {
  const { store, role } = harness();
  role('pm');
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
  const projectId = 'DEMO-P003';
  const plan = store.project(projectId)!.plans.find((p) => p.type === '客户主节点')!;
  assert.ok(store.savePlan(projectId, { ...plan, start: '2026-11-01', end: '2026-11-12' }));

  const load = Reflect.get(store, 'load').bind(store) as () => ReturnType<typeof createSeed>;
  const reloaded = load();
  const reloadedPlan = reloaded.projects
    .find((project) => project.id === projectId)!
    .plans.find((p) => p.id === plan.id)!;
  assert.equal(reloadedPlan.start, '2026-11-01');
  assert.equal(reloadedPlan.end, '2026-11-12');

  const range = ganttRange([reloadedPlan], store.observationDate());
  const bar = ganttBar(reloadedPlan, range, store.observationDate());
  const table = planRisk(reloadedPlan, store.observationDate());
  assert.equal(bar.renderable, true);
  assert.equal(bar.label, table.label);
  assert.equal(bar.cssClass, riskClass(table.level));
  assert.equal(range.start, DEMO_NORMAL_DATE, '轴仍需覆盖当前模拟日');
  assert.equal(range.end, '2026-11-12', '轴终点来自刷新后读到的已保存计划');
});
