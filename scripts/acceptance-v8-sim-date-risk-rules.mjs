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
const { planRisk, DEMO_NORMAL_DATE, DEMO_COMPARISON_DATE } = await import(
  path.join(root, 'src/app/core/rules.ts')
);
const { harness } = await import(path.join(root, 'tests/v4-harness.ts'));

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-sim-date-risk-rules', runId);
await fs.mkdir(output, { recursive: true });

const report = {
  runAt: new Date().toISOString(),
  issue: 71,
  checks: [],
  result: '失败',
};

const check = (name, evidence) => {
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
};

const fail = (name, error) => {
  report.checks.push({ name, result: '失败', error: error instanceof Error ? error.message : String(error) });
  console.log('FAIL', name, error);
};

try {
  // 1. 规则边界场景
  const fixture = {
    id: 'PL-001',
    type: '内部WBS',
    name: '测试任务',
    start: '2026-10-12',
    end: '2026-10-20',
    expected: '2026-10-20',
    actual: '',
    status: '未开始',
    warningLeadDays: 5,
    owner: '王项目',
    product: '',
    quantity: 1,
    batch: '',
    linked: '',
    amount: 0,
    currency: 'CNY',
    result: '',
    receiver: '',
    note: '',
  };

  assert.equal(planRisk(fixture, '2026-10-14').level, 'blue');
  assert.equal(planRisk(fixture, '2026-10-15').level, 'yellow');
  assert.equal(planRisk(fixture, '2026-10-20').level, 'yellow');
  assert.equal(planRisk(fixture, '2026-10-21').level, 'red');
  check('W前一天蓝、W当天黄、E当天黄、E次日红', { fixture, dates: ['2026-10-14', '2026-10-15', '2026-10-20', '2026-10-21'] });

  assert.equal(planRisk({ ...fixture, status: '已完成', actual: '2026-10-21' }, '2026-10-22').level, 'green');
  assert.equal(planRisk({ ...fixture, status: '已完成', actual: '2026-10-21' }, '2026-10-22').overdueCompleted, true);
  check('逾期完成仍绿并附标识', {});

  assert.equal(planRisk({ ...fixture, warningLeadDays: undefined }, '2026-10-21').level, 'red');
  assert.equal(planRisk({ ...fixture, warningLeadDays: undefined }, '2026-10-15').level, 'gray');
  check('已知逾期缺N红，未逾期缺N灰', {});

  assert.equal(planRisk({ ...fixture, status: '已取消' }, '2026-10-15').level, 'gray');
  check('取消状态灰', {});

  // 2. 种子样例双档断言
  const seed = createSeed();
  for (const project of seed.projects) {
    for (const plan of project.plans.filter((p) => p.type === '内部WBS' || p.type === '客户主节点')) {
      const normal = planRisk(plan, DEMO_NORMAL_DATE);
      if (plan.status === '已完成') assert.equal(normal.level, 'green', `${project.id} ${plan.name}`);
      else assert.equal(normal.level, 'blue', `${project.id} ${plan.name}`);
    }
  }
  check('正常档下未完成 WBS/客户节点均为蓝，已完成绿', {});

  let customerRedCount = 0;
  let wbsYellowCount = 0;
  for (const project of seed.projects) {
    for (const plan of project.plans.filter((p) => p.type === '内部WBS' || p.type === '客户主节点')) {
      const comparison = planRisk(plan, DEMO_COMPARISON_DATE);
      if (plan.type === '客户主节点' && comparison.level === 'red') customerRedCount++;
      if (plan.type === '内部WBS' && comparison.level === 'yellow') wbsYellowCount++;
    }
  }
  assert.ok(customerRedCount > 0, '对比档应有客户节点红');
  assert.ok(wbsYellowCount > 0, '对比档应有 WBS 黄');
  check('对比档至少客户节点红、WBS黄', { customerRedCount, wbsYellowCount });

  // 3. Store 校验与持久化
  const { store, role } = harness();
  role('pm');
  const projectId = 'DEMO-P003';
  const plan = store.project(projectId).plans.find((p) => p.type === '客户主节点');

  assert.ok(store.savePlan(projectId, { ...plan, warningLeadDays: 3 }));
  assert.throws(() => store.savePlan(projectId, { ...plan, warningLeadDays: -1 }), /预警天数/);
  check('客户主节点预警天数非负整数校验', {});

  const oldEnd = plan.end;
  assert.ok(store.savePlan(projectId, { ...plan, end: '2026-11-01' }));
  const syncRecord = store
    .state()
    .milestoneSyncRecords.find((r) => r.sourcePlanId === plan.id && r.projectId === projectId);
  assert.ok(syncRecord);
  assert.equal(syncRecord.oldCustomerAgreedDate, oldEnd);
  assert.equal(syncRecord.customerAgreedDate, '2026-11-01');
  check('客户主节点 end 修改生成审计同步记录', { syncRecord });

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
  const beforeState = store.state();
  assert.ok(store.setDateMode('comparison'));
  assert.equal(store.dateMode(), 'comparison');
  assert.equal(store.observationDate(), DEMO_COMPARISON_DATE);
  const load = Reflect.get(store, 'load').bind(store);
  assert.equal(load().dateMode, 'comparison');
  check('模拟日期模式切换与刷新保留', {});

  assert.deepEqual(store.state().projects, beforeState.projects);
  assert.deepEqual(store.state().contracts, beforeState.contracts);
  check('切换模式不改计划、预算、合同或完成历史', {});

  report.result = '通过';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('验收证据：', output);
}
