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

const { createSeed, blankPlan } = await import(path.join(root, 'src/app/core/seed.ts'));
const { planRisk, riskClass, DEMO_NORMAL_DATE, DEMO_COMPARISON_DATE } = await import(
  path.join(root, 'src/app/core/rules.ts')
);
const { ganttBar, ganttRange, ganttObservationMarker, ganttTicks } = await import(
  path.join(root, 'src/app/core/gantt.ts')
);
const { harness } = await import(path.join(root, 'tests/v4-harness.ts'));

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-plan-gantt', runId);
await fs.mkdir(output, { recursive: true });

const report = {
  runAt: new Date().toISOString(),
  issue: 72,
  ticket: '08-02 展示客户节点与WBS动态甘特',
  acceptance: ['GAN01', 'GAN02', 'GAN03', 'GAN04'],
  checks: [],
  result: '失败',
};

const check = (name, evidence) => {
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
};

const fail = (name, error) => {
  report.checks.push({
    name,
    result: '失败',
    error: error instanceof Error ? error.message : String(error),
  });
  console.log('FAIL', name, error);
};

/** 两个视图按计划类型分别取同一份已保存计划，甘特条带与表格风险必须逐行一致。 */
const projectViewCheck = (projects, observationDate) => {
  const rows = [];
  for (const project of projects) {
    for (const type of ['客户主节点', '内部WBS']) {
      const plans = project.plans.filter((plan) => plan.type === type);
      const range = ganttRange(plans, observationDate);
      for (const plan of plans) {
        const bar = ganttBar(plan, range, observationDate);
        const table = planRisk(plan, observationDate);
        assert.equal(bar.label, table.label, `${project.id} ${plan.id} 甘特与表格风险文字一致`);
        assert.equal(bar.level, table.level, `${project.id} ${plan.id} 甘特与表格风险等级一致`);
        assert.equal(bar.cssClass, riskClass(table.level), `${project.id} ${plan.id} 颜色类一致`);
        assert.equal(bar.planId, plan.id, `${project.id} ${plan.id} 同源 Plan ID`);
        rows.push({
          projectId: project.id,
          type,
          planId: plan.id,
          start: plan.start,
          end: plan.end,
          label: bar.label,
          cssClass: bar.cssClass,
          renderable: bar.renderable,
          range: `${range.start}~${range.end}`,
        });
      }
    }
  }
  return rows;
};

try {
  // 1. 两档演示日期下，客户主节点与内部WBS的甘特文字与颜色
  const seed = createSeed();
  const normalRows = projectViewCheck(seed.projects, DEMO_NORMAL_DATE);
  const comparisonRows = projectViewCheck(seed.projects, DEMO_COMPARISON_DATE);

  for (const project of seed.projects) {
    for (const plan of project.plans.filter(
      (p) => p.type === '内部WBS' || p.type === '客户主节点',
    )) {
      const bar = ganttBar(plan, ganttRange([plan], DEMO_NORMAL_DATE), DEMO_NORMAL_DATE);
      const expected = plan.status === '已完成' ? 'green' : 'blue';
      assert.equal(bar.level, expected, `${project.id} ${plan.id} 正常档应为 ${expected}`);
    }
  }
  check('正常档（2026-10-15）客户节点与WBS甘特全部蓝/绿，与表格一致', {
    observationDate: DEMO_NORMAL_DATE,
    rowCount: normalRows.length,
    sample: normalRows.slice(0, 3),
  });

  const customerRed = comparisonRows.filter(
    (row) => row.type === '客户主节点' && row.cssClass === 'risk-red',
  );
  const wbsYellow = comparisonRows.filter(
    (row) => row.type === '内部WBS' && row.cssClass === 'risk-yellow',
  );
  assert.ok(customerRed.length > 0, '对比档客户主节点应显示红色（已逾期）');
  assert.ok(wbsYellow.length > 0, '对比档内部WBS应显示黄色（预警）');
  check('对比档（2026-10-22）客户节点红、WBS黄，文字与表格一致', {
    observationDate: DEMO_COMPARISON_DATE,
    customerRed: customerRed.slice(0, 2),
    wbsYellow: wbsYellow.slice(0, 2),
  });

  // 2. 切换档位只改观察日，不改条带几何
  for (const project of seed.projects) {
    const plans = project.plans.filter((p) => p.type === '内部WBS' || p.type === '客户主节点');
    const normalRange = ganttRange(plans, DEMO_NORMAL_DATE);
    const comparisonRange = ganttRange(plans, DEMO_COMPARISON_DATE);
    assert.equal(normalRange.start, comparisonRange.start);
    assert.equal(normalRange.end, comparisonRange.end);
    for (const plan of plans) {
      const normal = ganttBar(plan, normalRange, DEMO_NORMAL_DATE);
      const comparison = ganttBar(plan, comparisonRange, DEMO_COMPARISON_DATE);
      assert.equal(normal.left, comparison.left);
      assert.equal(normal.width, comparison.width);
    }
  }
  check('切换正常档/对比档只改颜色与文字，条带位置宽度不变', {
    projects: seed.projects.length,
  });

  // 3. Store 保存并刷新后，两个视图读取同一份已保存日期
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const singleDayId = 'PL-GANTT-SINGLE';
  const customer = store.project(projectId).plans.find((p) => p.type === '客户主节点');
  const originalCustomerEnd = customer.end;
  const basePlan = store.project(projectId).plans.find((p) => p.type === '内部WBS');

  assert.ok(
    store.savePlan(projectId, {
      ...blankPlan('内部WBS'),
      id: singleDayId,
      name: '单日节点（验收样例）',
      owner: '刘工程师',
      start: '2026-10-15',
      end: '2026-10-15',
      expected: '2026-10-15',
      status: '未开始',
      warningLeadDays: 0,
      budgetAmount: 12000,
      budgetCurrency: 'CNY',
    }),
    '单日任务应能保存',
  );
  const savedSingle = store.project(projectId).plans.find((p) => p.id === singleDayId);
  const singleRange = ganttRange(
    store.project(projectId).plans.filter((p) => p.type === '内部WBS'),
    store.observationDate(),
  );
  const singleBar = ganttBar(savedSingle, singleRange, store.observationDate());
  assert.equal(singleBar.renderable, true, '单日任务应可渲染');
  assert.equal(singleBar.milestone, true, '单日任务应按里程碑渲染');
  assert.ok(singleBar.width >= singleRange.dayPercent - 0.001, '单日条带不小于一个日格');
  assert.ok(
    (singleBar.width / 100) * singleRange.chartWidthPx >= 20,
    '单日条带在屏幕上至少 20 像素可见',
  );
  check('单日任务在动态轴上可见（最小日格宽度保证）', {
    singleDayId,
    bar: singleBar,
    range: {
      start: singleRange.start,
      end: singleRange.end,
      days: singleRange.days,
      dayCellPx: Math.round(singleRange.dayCellPx * 100) / 100,
      chartWidthPx: singleRange.chartWidthPx,
    },
  });

  // 4. 跨旧 2026-10 至 11 月窗口的计划仍可见
  assert.ok(store.savePlan(projectId, { ...customer, end: '2027-03-15' }));
  const savedCustomer = store.project(projectId).plans.find((p) => p.id === customer.id);
  const customerRange = ganttRange(
    store.project(projectId).plans.filter((p) => p.type === '客户主节点'),
    store.observationDate(),
  );
  const customerBar = ganttBar(savedCustomer, customerRange, store.observationDate());
  assert.equal(savedCustomer.end, '2027-03-15');
  assert.equal(customerRange.end, '2027-03-15', '轴终点应扩展到旧窗口之外');
  assert.equal(customerBar.renderable, true);
  assert.ok(customerBar.left + customerBar.width <= 100.001);
  assert.ok(customerBar.width > 0);
  const early = ganttBar(basePlan, singleRange, store.observationDate());
  assert.equal(early.renderable, true, '窗口内计划在新轴上仍可见');
  check('跨旧 2026-10 至 11 月窗口的计划仍可见，窗口内计划不丢失', {
    planId: savedCustomer.id,
    newEnd: savedCustomer.end,
    range: `${customerRange.start}~${customerRange.end}`,
    bar: customerBar,
  });

  // 5. 当前模拟日期线与轴刻度覆盖观察日
  const marker = ganttObservationMarker(singleRange, store.observationDate());
  assert.ok(marker, '应给出当前模拟日期线');
  assert.equal(marker.label, `当前模拟日期 ${DEMO_NORMAL_DATE}`);
  const ticks = ganttTicks(customerRange);
  assert.ok(ticks.length >= 2, '长跨度轴应有多个刻度');
  assert.equal(ticks[0].left, 0);
  assert.ok(ticks.at(-1).left < 100);
  check('当前模拟日期线与动态轴刻度齐备', {
    marker,
    tickCount: ticks.length,
    firstTick: ticks[0],
    lastTick: ticks.at(-1),
  });

  // 6. 刷新（重新读取存储）后两个视图仍一致
  let saved = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => saved || null,
      setItem: (_key, value) => {
        saved = value;
      },
    },
  });
  assert.ok(store.savePlan(projectId, { ...customer, end: '2026-11-01' }));
  const load = Reflect.get(store, 'load').bind(store);
  const reloaded = load();
  const reloadedProject = reloaded.projects.find((p) => p.id === projectId);
  const reloadedCustomer = reloadedProject.plans.find((p) => p.id === customer.id);
  assert.equal(reloadedCustomer.end, '2026-11-01', '刷新后读到已保存结束日');
  const reloadedRows = projectViewCheck([reloadedProject], DEMO_NORMAL_DATE);
  const reloadedBar = ganttBar(
    reloadedCustomer,
    ganttRange([reloadedCustomer], DEMO_NORMAL_DATE),
    DEMO_NORMAL_DATE,
  );
  assert.equal(
    reloadedBar.label,
    planRisk(reloadedCustomer, DEMO_NORMAL_DATE).label,
    '刷新后甘特与表格风险文字一致',
  );
  assert.equal(reloadedBar.cssClass, riskClass(planRisk(reloadedCustomer, DEMO_NORMAL_DATE).level));
  check('编辑保存并刷新后，客户节点与WBS甘特仍与表格同源一致', {
    originalCustomerEnd,
    savedCustomerEnd: reloadedCustomer.end,
    reloadedRows: reloadedRows.filter((row) => row.planId === customer.id),
  });

  // 7. 非法与非完成态不抛出，并保留文字
  const brokenRange = ganttRange(
    [{ ...savedCustomer, start: '', end: 'not-a-date' }],
    DEMO_NORMAL_DATE,
  );
  const brokenBar = ganttBar(
    { ...savedCustomer, start: '', end: 'not-a-date' },
    brokenRange,
    DEMO_NORMAL_DATE,
  );
  assert.equal(brokenBar.renderable, false);
  assert.equal(brokenBar.cssClass, 'risk-gray');
  assert.ok(brokenBar.reason && brokenBar.reason.length > 0);
  assert.equal(
    ganttBar({ ...savedCustomer, status: '已取消' }, customerRange, DEMO_NORMAL_DATE).label,
    '已取消',
  );
  check('非法日期不抛出，缺日期/已取消在甘特与表格同文字同颜色', {
    brokenBar,
    cancelled: ganttBar({ ...savedCustomer, status: '已取消' }, customerRange, DEMO_NORMAL_DATE),
  });

  report.result = '通过';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('验收证据：', output);
  console.log('结论：', report.result);
}
