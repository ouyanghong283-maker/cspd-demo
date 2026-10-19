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
const { DEMO_NORMAL_DATE, DEMO_COMPARISON_DATE, planRisk } = await import(
  path.join(root, 'src/app/core/rules.ts')
);
const {
  collectPlanRiskRows,
  collectPlanWarnings,
  collectPlanWarningHistory,
  isPlanWarningRead,
  planWarningPersonKey,
  planWarningStats,
  planWarningViews,
  planWarningsForPerson,
} = await import(path.join(root, 'src/app/core/plan-warnings.ts'));
const { collectDemoWorkItems } = await import(
  path.join(root, 'src/app/core/work-item-sources.ts')
);
const { harness } = await import(path.join(root, 'tests/v4-harness.ts'));

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-plan-warnings', runId);
await fs.mkdir(output, { recursive: true });

const report = {
  runAt: new Date().toISOString(),
  issue: 73,
  ticket: '08-03 将预警接入待办与追踪看板',
  acceptance: ['WAR02', 'WAR03', 'WAR04', 'WAR05', 'WAR06', 'DAT02', 'DAT03', 'DAT04'],
  checks: [],
  result: '失败',
};

const check = (name, evidence) => {
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
};

const mutate = (state, fn) => {
  const next = structuredClone(state);
  fn(next);
  return next;
};

/** 结束日 2026-10-18、提前 2 天：W=10-16 → 正常档(10-15)蓝，对比档(10-22)红。 */
function planFixture(id, owner, overrides = {}) {
  return {
    ...blankPlan('内部WBS'),
    id,
    name: `样例任务${id}`,
    owner,
    start: '2026-10-12',
    end: '2026-10-18',
    expected: '2026-10-18',
    actual: '',
    status: '进行中',
    warningLeadDays: 2,
    ...overrides,
  };
}

function fixture() {
  const state = createSeed();
  const project = state.projects[0];
  project.id = 'DEMO-P900';
  project.name = '预警验收项目';
  project.pm = '王项目';
  project.briefing.startupHandover = undefined;
  project.plans = [
    planFixture('PL-A', '王项目'),
    planFixture('PL-B', '刘工程师'),
    planFixture('PL-C', '未登记人员'),
  ];
  state.projects = [project];
  state.sales = [];
  state.notices = [];
  return state;
}

try {
  const state = fixture();

  // 1. 正常档：所有样例均未进入预警窗口
  const normal = collectPlanWarnings(state, DEMO_NORMAL_DATE);
  assert.deepEqual(normal, []);
  const normalRows = collectPlanRiskRows(state, DEMO_NORMAL_DATE).filter(
    (row) => row.kind !== '正常',
  );
  assert.deepEqual(normalRows, []);
  check('正常档下计划视图、待办、看板一致判定为无预警', {
    observationDate: DEMO_NORMAL_DATE,
    levels: state.projects[0].plans.map((plan) => planRisk(plan, DEMO_NORMAL_DATE).level),
  });

  // 2. 对比档：同一份快照下三处投影同源
  const comparison = collectPlanWarnings(state, DEMO_COMPARISON_DATE);
  assert.equal(comparison.length, 3);
  assert.deepEqual([...new Set(comparison.map((warning) => warning.level))], ['red']);
  const itemWarnings = collectDemoWorkItems(state, undefined, DEMO_COMPARISON_DATE).items.filter(
    (item) => item.warning,
  );
  assert.equal(itemWarnings.length, comparison.length, '待办预警与看板必须引用同一聚合结果');
  assert.deepEqual(
    itemWarnings.map((item) => item.warning.warningId).sort(),
    comparison.map((warning) => warning.id).sort(),
  );
  const boardRows = collectPlanRiskRows(state, DEMO_COMPARISON_DATE).filter(
    (row) => row.kind !== '正常',
  );
  assert.equal(boardRows.length, comparison.length);
  check('对比档下单份快照的预警集合在计划/待办/看板一致', {
    observationDate: DEMO_COMPARISON_DATE,
    warnings: comparison.map((warning) => [warning.id, warning.level, warning.label]),
  });

  // 3. WAR02 收件人：已知负责人 + 项目PM，同人去重，未知待补不改派
  const byPlan = new Map(comparison.map((warning) => [warning.planId, warning]));
  assert.deepEqual(byPlan.get('PL-A').recipients.map((r) => [r.person, r.reasons]), [
    ['王项目', ['owner', 'pm']],
  ]);
  assert.deepEqual(byPlan.get('PL-B').recipients.map((r) => r.person).sort(), [
    '刘工程师',
    '王项目',
  ]);
  assert.equal(byPlan.get('PL-C').ownerLabel, '待补');
  assert.ok(byPlan.get('PL-C').missing.includes('计划负责人待补'));
  assert.deepEqual(byPlan.get('PL-C').recipients.map((r) => r.person), ['王项目']);
  const allowed = new Set(['王项目', '刘工程师', '夏质量', '陈物控', '李负责人', '张销售']);
  for (const warning of comparison)
    for (const recipient of warning.recipients) assert.ok(allowed.has(recipient.person));
  check('WAR02 定向收件人为已知负责人与项目PM，去重待补且不改派操作者/PMO/全体成员', {
    recipients: comparison.map((w) => [w.planId, w.recipients.map((r) => r.person)]),
  });

  // 4. WAR03 稳定身份与总数不重复
  const renamed = mutate(state, (next) => {
    next.projects[0].name = '改名后的项目';
    next.projects[0].plans[0].name = '改名后的任务';
    next.projects[0].plans[0].owner = '夏质量';
  });
  const renamedWarnings = collectPlanWarnings(renamed, DEMO_COMPARISON_DATE);
  assert.deepEqual(
    renamedWarnings.map((warning) => warning.id).sort(),
    comparison.map((warning) => warning.id).sort(),
  );
  assert.equal(renamedWarnings.find((w) => w.planId === 'PL-A').planName, '改名后的任务');
  assert.deepEqual(
    renamedWarnings.find((w) => w.planId === 'PL-A').recipients.map((r) => r.person).sort(),
    ['夏质量', '王项目'],
  );
  const items = collectDemoWorkItems(state, undefined, DEMO_COMPARISON_DATE).items;
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  assert.ok(
    items.every((item) => item.warning || item.sourceId !== 'project-plan'),
    '计划待办与预警必须挂在同一条事项上',
  );
  const pmView = collectDemoWorkItems(state, '王项目', DEMO_COMPARISON_DATE);
  assert.equal(pmView.counts.total, pmView.items.length);
  check('WAR03 改名后事项ID不变、总数不重复', {
    ids: renamedWarnings.map((warning) => warning.id),
    planItems: items.filter((item) => item.sourceId === 'project-plan').length,
    warnedItems: items.filter((item) => item.warning).length,
  });

  // 5. WAR04 已读隔离与持久化
  const { store, role } = harness();
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
  role('pm');
  const storeSeed = store.state();
  storeSeed.projects = storeSeed.projects.slice(0, 1);
  storeSeed.projects[0].briefing.startupHandover = undefined;
  storeSeed.projects[0].plans = [planFixture('PL-A', '刘工程师')];
  storeSeed.sales = [];
  storeSeed.notices = [];

  const viewerKey = planWarningPersonKey(store.person());
  const warningId = collectPlanWarnings(store.state(), DEMO_COMPARISON_DATE)[0].id;
  assert.equal(store.markPlanWarningRead(warningId), true);
  assert.equal(isPlanWarningRead(store.state(), viewerKey, warningId), true);
  assert.equal(
    isPlanWarningRead(store.state(), planWarningPersonKey('刘工程师'), warningId),
    false,
    '他人已读状态必须保持未读',
  );
  const load = Reflect.get(store, 'load').bind(store);
  assert.equal(isPlanWarningRead(load(), viewerKey, warningId), true);
  const readStats = planWarningStats(
    planWarningViews(
      store.state(),
      collectPlanWarnings(store.state(), DEMO_COMPARISON_DATE),
      viewerKey,
    ),
  );
  assert.deepEqual(readStats, { total: 1, yellow: 0, red: 1, unread: 0, projects: 1 });
  assert.equal(
    collectPlanWarnings(store.state(), DEMO_COMPARISON_DATE)[0].level,
    'red',
    '已读不得改变风险颜色',
  );
  check('WAR04 已读按人隔离并随快照持久化，风险颜色不受影响', { warningId, readStats });

  // 6. WAR05 完成/取消解除当前预警且保留历史；切档不新增业务历史
  const completed = mutate(state, (next) => {
    next.projects[0].plans[0].status = '已完成';
    next.projects[0].plans[0].actual = '2026-10-25';
  });
  assert.deepEqual(
    collectPlanWarnings(completed, DEMO_COMPARISON_DATE).map((warning) => warning.planId).sort(),
    ['PL-B', 'PL-C'],
  );
  const history = collectPlanWarningHistory(completed, DEMO_COMPARISON_DATE);
  assert.deepEqual(history.map((row) => row.planId), ['PL-A']);
  assert.equal(history[0].label, '已完成（逾期）');
  const historySnapshot = JSON.stringify(store.state().history);
  for (const mode of ['comparison', 'normal', 'comparison', 'normal', 'comparison']) {
    assert.ok(store.setDateMode(mode));
    assert.equal(store.observationDate(), mode === 'comparison' ? DEMO_COMPARISON_DATE : DEMO_NORMAL_DATE);
    assert.deepEqual(
      collectPlanWarnings(store.state(), store.observationDate()).map((w) => w.id),
      mode === 'comparison' ? [warningId] : [],
      '反复切档必须重算同一事项，不得新增或丢失',
    );
  }
  assert.equal(JSON.stringify(store.state().history), historySnapshot, '切档不得追加业务历史');
  check('WAR05 完成解除当前预警保留历史；反复切档重算同一事项且不写历史', {
    remainingPlans: ['PL-B', 'PL-C'],
    historyPlans: history.map((row) => row.planId),
  });

  // 7. WAR06 处理链接与筛选
  const warning = collectPlanWarnings(state, DEMO_COMPARISON_DATE).find((w) => w.planId === 'PL-C');
  const href = new URLSearchParams(warning.href.split('?')[1]);
  assert.equal(warning.href.startsWith('/projects/DEMO-P900?'), true);
  assert.equal(href.get('tab'), '计划执行');
  assert.equal(href.get('planId'), 'PL-C');
  assert.equal(href.get('plan'), '内部WBS');
  const forPm = planWarningsForPerson(comparison, planWarningPersonKey('王项目'));
  assert.equal(forPm.length, 3);
  assert.equal(planWarningsForPerson(comparison, planWarningPersonKey('李负责人')).length, 0);
  check('WAR06 处理链接定位到项目与 Plan ID，按人筛选只返回接收人本人事项', {
    href: warning.href,
    pmWarnings: forPm.length,
  });

  // 8. DAT04 保存失败不出现单页虚假更新
  const before = JSON.stringify(store.state());
  const ui = Reflect.get(store, 'ui');
  const originalFail = ui.fail;
  ui.fail = () => false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => saved || null,
      setItem: () => {
        throw new Error('模拟存储失败');
      },
    },
  });
  let saveResult;
  try {
    saveResult = store.markPlanWarningRead(collectPlanWarnings(store.state(), DEMO_COMPARISON_DATE)[0].id);
  } finally {
    ui.fail = originalFail;
  }
  assert.equal(saveResult, true, '同一人同一事项已读时重复标记不重复写入');
  const beforeSecond = JSON.stringify(store.state());
  ui.fail = () => false;
  try {
    store.markPlanWarningRead('plan-warning:99:DEMO-P900:2:PL-X');
  } finally {
    ui.fail = originalFail;
  }
  assert.equal(
    JSON.stringify(store.state()),
    beforeSecond,
    '保存失败时状态必须保持不变，不出现单页虚假更新',
  );
  assert.ok(before.length > 0);
  check('DAT04 存储失败时拒绝更新，页面与快照保持一致', {
    saveResult,
    warningCount: collectPlanWarnings(store.state(), DEMO_COMPARISON_DATE).length,
  });

  // 9. 种子样例在两档下的整体一致性
  const seed = createSeed();
  const seedWarnings = collectPlanWarnings(seed, DEMO_COMPARISON_DATE);
  assert.ok(seedWarnings.length > 0, '对比档种子样例应有预警');
  assert.deepEqual(
    seedWarnings.filter((warning) => warning.level === 'red').map((warning) => warning.planId).length >
      0,
    true,
  );
  assert.deepEqual(
    collectPlanWarnings(seed, DEMO_NORMAL_DATE),
    [],
    '正常档种子样例不得出现预警',
  );
  const seedRows = collectPlanRiskRows(seed, DEMO_COMPARISON_DATE).filter(
    (row) => row.kind !== '正常',
  );
  assert.equal(
    seedRows.filter((row) => row.warning).length,
    seedWarnings.length,
    '看板上的预警行数必须与预警集合一致',
  );
  check('种子样例：正常档无预警、对比档预警与看板统计一致', {
    normalWarnings: 0,
    comparisonWarnings: seedWarnings.length,
    red: seedWarnings.filter((warning) => warning.level === 'red').length,
    yellow: seedWarnings.filter((warning) => warning.level === 'yellow').length,
    boardRows: seedRows.length,
  });

  report.result = '通过';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('验收证据：', output);
}
