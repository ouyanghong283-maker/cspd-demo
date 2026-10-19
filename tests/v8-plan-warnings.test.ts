import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankPlan, createSeed } from '../src/app/core/seed';
import { DemoState, Plan, Project } from '../src/app/core/models';
import { DEMO_COMPARISON_DATE, DEMO_NORMAL_DATE, planRisk, riskClass } from '../src/app/core/rules';
import {
  collectPlanRiskRows,
  collectPlanWarningHistory,
  collectPlanWarnings,
  isPlanWarningRead,
  knownPlanPeople,
  planWarningPersonKey,
  planWarningStats,
  planWarningViews,
  planWarningsForPerson,
  trackingKindForRisk,
} from '../src/app/core/plan-warnings';
import { collectDemoProjectWorkItems, collectDemoWorkItems } from '../src/app/core/work-item-sources';
import { workItemId } from '../src/app/core/work-item-registry';
import { harness } from './v4-harness';

/** 结束日 2026-10-20、提前 3 天：W=10-17；10-18 临期、10-22 逾期。 */
function planFixture(overrides: Partial<Plan> = {}): Plan {
  return {
    ...blankPlan('内部WBS'),
    id: 'PL-1',
    name: '现场安装',
    owner: '王项目',
    start: '2026-10-12',
    end: '2026-10-20',
    expected: '2026-10-20',
    actual: '',
    status: '进行中',
    warningLeadDays: 3,
    ...overrides,
  };
}

function stateFixture(plans: Plan[], project: Partial<Project> = {}): DemoState {
  const state = createSeed();
  const target = state.projects[0];
  Object.assign(target, { id: 'DEMO-P900', name: '预警测试项目', pm: '王项目' }, project);
  target.briefing.startupHandover = undefined;
  target.plans = plans;
  state.projects = [target];
  state.sales = [];
  state.notices = [];
  return state;
}

const WARN_DATE = '2026-10-18';

/**
 * harness 的对象不经构造函数创建，`activeSnapshotKey` 为空；
 * 与既有验收脚本一致，用忽略键名的单槽存储模拟一次成功提交。
 */
function installSingleSlotStorage(initial = ''): () => string {
  let saved = initial;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => saved || null,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    },
  });
  return () => saved;
}

test('WAR02 已知负责人与项目PM都收到；同一人兼任只算一个收件人', () => {
  const state = stateFixture([planFixture({ owner: '刘工程师' }), planFixture({ id: 'PL-2', name: '调试测试', owner: '王项目' })]);

  const warnings = collectPlanWarnings(state, WARN_DATE);
  assert.equal(warnings.length, 2);
  const forEngineer = planWarningsForPerson(warnings, planWarningPersonKey('刘工程师'));
  const forPm = planWarningsForPerson(warnings, planWarningPersonKey('王项目'));
  assert.deepEqual(forEngineer.map((w) => w.planId), ['PL-1']);
  assert.deepEqual(forPm.map((w) => w.planId).sort(), ['PL-1', 'PL-2']);
  assert.deepEqual(forEngineer[0].recipients.map((r) => [r.person, r.reasons]), [
    ['刘工程师', ['owner']],
    ['王项目', ['pm']],
  ]);
  // 兼任：负责人=PM 时去重为一人
  assert.deepEqual(forPm.find((w) => w.planId === 'PL-2')!.recipients.map((r) => [r.person, r.reasons]), [
    ['王项目', ['owner', 'pm']],
  ]);
});

test('WAR02 未知负责人/PM标待补但不改派，已知人员仍收到', () => {
  const state = stateFixture([planFixture({ owner: '负责人待核' })]);
  const [warning] = collectPlanWarnings(state, WARN_DATE);
  assert.equal(warning.ownerLabel, '待补');
  assert.equal(warning.pmLabel, '王项目');
  assert.deepEqual(warning.recipients.map((r) => r.person), ['王项目']);
  assert.ok(warning.missing.includes('计划负责人待补'));

  const bothUnknown = stateFixture([planFixture({ owner: '' })], { pm: '负责人待核' });
  const [orphan] = collectPlanWarnings(bothUnknown, WARN_DATE);
  assert.deepEqual(orphan.recipients, []);
  assert.deepEqual(orphan.missing.filter((m) => m.endsWith('待补')).sort(), [
    '计划负责人待补',
    '项目PM待补',
  ]);
  // 不得改派操作者/PMO/全体成员
  for (const recipient of [...warning.recipients, ...orphan.recipients])
    assert.ok(['王项目', '刘工程师'].includes(recipient.person));
});

test('WAR03 projectId+planId 稳定定位：改名、换负责人、换项目名、刷新都不新增事项', () => {
  const state = stateFixture([planFixture()]);
  const first = collectPlanWarnings(state, WARN_DATE);
  assert.equal(first.length, 1);
  const stableId = first[0].id;

  const renamed: DemoState = JSON.parse(JSON.stringify(state));
  renamed.projects[0].plans[0].name = '现场安装（改名后）';
  renamed.projects[0].name = '预警测试项目（改名后）';
  renamed.projects[0].plans[0].owner = '刘工程师';
  const after = collectPlanWarnings(renamed, WARN_DATE);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, stableId);
  assert.equal(after[0].planName, '现场安装（改名后）');
  assert.deepEqual(after[0].recipients.map((r) => r.person), ['刘工程师', '王项目']);

  // 刷新（重新解析已提交快照）后事项不变
  const reloaded: DemoState = JSON.parse(JSON.stringify(state));
  assert.deepEqual(collectPlanWarnings(reloaded, WARN_DATE).map((w) => w.id), [stableId]);

  const item = collectDemoWorkItems(state, '王项目', WARN_DATE).items.find((i) => i.warning)!;
  assert.equal(item.id, workItemId('project-plan', 'DEMO-P900:PL-1'));
  assert.equal(item.warning!.warningId, stableId);
});

test('WAR03 临期升逾期更新同一事项且不新增；普通待办与预警不重复计数', () => {
  const state = stateFixture([planFixture({ owner: '刘工程师' })]);
  const normal = collectPlanWarnings(state, WARN_DATE);
  const comparison = collectPlanWarnings(state, DEMO_COMPARISON_DATE);
  assert.equal(normal.length, 1);
  assert.equal(comparison.length, 1);
  assert.equal(normal[0].level, 'yellow');
  assert.equal(comparison[0].level, 'red');
  assert.equal(normal[0].id, comparison[0].id);
  assert.equal(normal[0].label, '预警');
  assert.equal(comparison[0].label, '已逾期');

  // 同一份快照下，待办条目集合不因预警而增加
  const items = collectDemoWorkItems(state, undefined, DEMO_COMPARISON_DATE).items;
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  const warned = items.filter((item) => item.warning);
  assert.equal(warned.length, collectPlanWarnings(state, DEMO_COMPARISON_DATE).length);
  assert.equal(new URL(warned[0].href!, 'http://demo.local').searchParams.get('focus'), 'PL-1');
  assert.equal(warned[0].sourceRecordId, 'DEMO-P900:PL-1');

  const personView = collectDemoWorkItems(state, '王项目', DEMO_COMPARISON_DATE);
  const personWarnings = planWarningsForPerson(
    collectPlanWarnings(state, DEMO_COMPARISON_DATE),
    planWarningPersonKey('王项目'),
  );
  assert.equal(personWarnings.length, 1);
  assert.equal(personView.counts.total, personView.items.length);
  assert.equal(personView.items.filter((item) => item.warning).length, personWarnings.length);
  const stats = planWarningStats(
    planWarningViews(state, personWarnings, planWarningPersonKey('王项目')),
  );
  assert.equal(stats.total, 1);
  assert.ok(stats.total <= personView.counts.total, '预警数不得超过同一清单的事项数');
});

test('WAR04 已读只影响本人：他人已读与风险颜色不变，已读不等于完成', () => {
  const { store, role } = harness();
  installSingleSlotStorage();
  role('pm');
  const state = store.state();
  state.projects = state.projects.slice(0, 1);
  state.projects[0].briefing.startupHandover = undefined;
  state.projects[0].plans = [planFixture({ owner: '刘工程师' })];
  state.sales = [];
  state.notices = [];

  const warnings = collectPlanWarnings(store.state(), WARN_DATE);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].level, 'yellow');
  assert.equal(riskClass(warnings[0].level), 'risk-yellow');

  const viewerKey = planWarningPersonKey(store.person());
  assert.equal(viewerKey, planWarningPersonKey('王项目'));
  assert.equal(isPlanWarningRead(store.state(), viewerKey, warnings[0].id), false);

  const historyBefore = JSON.stringify(store.state().history);
  assert.ok(store.markPlanWarningRead(warnings[0].id));
  assert.equal(isPlanWarningRead(store.state(), viewerKey, warnings[0].id), true);
  assert.equal((store.state().operationEvents || []).length, 0);
  assert.equal(JSON.stringify(store.state().history), historyBefore, '已读不写业务历史');

  // 他人（负责人本人）未读状态保持；风险颜色与级别不变
  const otherKey = planWarningPersonKey('刘工程师');
  assert.equal(isPlanWarningRead(store.state(), otherKey, warnings[0].id), false);
  const after = collectPlanWarnings(store.state(), WARN_DATE);
  assert.equal(after[0].level, 'yellow');
  assert.equal(riskClass(after[0].level), 'risk-yellow');
  assert.equal(collectDemoWorkItems(store.state(), '王项目', WARN_DATE).items[0].status, 'open');

  // 已读状态随快照持久化
  const load = Reflect.get(store, 'load').bind(store) as () => DemoState;
  assert.equal(isPlanWarningRead(load(), viewerKey, warnings[0].id), true);
  assert.equal(load().planWarningReads!.length, 1);
});

test('WAR04/WAR05 完成或取消解除当前预警但保留历史；改期与换人同步解除或转交', () => {
  const state = stateFixture([planFixture({ owner: '刘工程师' })]);
  assert.equal(collectPlanWarnings(state, DEMO_COMPARISON_DATE).length, 1);

  const completed: DemoState = JSON.parse(JSON.stringify(state));
  completed.projects[0].plans[0].status = '已完成';
  completed.projects[0].plans[0].actual = '2026-10-25';
  assert.deepEqual(collectPlanWarnings(completed, DEMO_COMPARISON_DATE), []);
  const history = collectPlanWarningHistory(completed, DEMO_COMPARISON_DATE);
  assert.equal(history.length, 1);
  assert.equal(history[0].planId, 'PL-1');
  assert.equal(planRisk(completed.projects[0].plans[0], DEMO_COMPARISON_DATE).overdueCompleted, true);

  const cancelled: DemoState = JSON.parse(JSON.stringify(state));
  cancelled.projects[0].plans[0].status = '已取消';
  assert.deepEqual(collectPlanWarnings(cancelled, DEMO_COMPARISON_DATE), []);
  assert.equal(collectPlanWarningHistory(cancelled, DEMO_COMPARISON_DATE).length, 1);

  // 改结束日消除条件后解除
  const postponed: DemoState = JSON.parse(JSON.stringify(state));
  postponed.projects[0].plans[0].end = '2026-11-20';
  assert.deepEqual(collectPlanWarnings(postponed, DEMO_COMPARISON_DATE), []);

  // 换负责人：原负责人不再收到，新负责人按事实显示
  const transferred: DemoState = JSON.parse(JSON.stringify(state));
  transferred.projects[0].plans[0].owner = '夏质量';
  const after = collectPlanWarnings(transferred, DEMO_COMPARISON_DATE);
  assert.equal(after.length, 1);
  assert.deepEqual(after[0].recipients.map((r) => r.person).sort(), ['夏质量', '王项目'].sort());
  assert.equal(planWarningsForPerson(after, planWarningPersonKey('刘工程师')).length, 0);
});

test('WAR05/WAR06 切档只改观察日期：反复切换不新增业务历史与通知，重开按当前档重算', () => {
  const { store, role } = harness();
  installSingleSlotStorage();
  role('pm');
  const seed = store.state();
  seed.projects = seed.projects.slice(0, 1);
  seed.projects[0].briefing.startupHandover = undefined;
  seed.projects[0].plans = [
    planFixture({ owner: '刘工程师', end: '2026-10-17', expected: '2026-10-17' }),
  ];
  seed.sales = [];
  seed.notices = [];

  const historyBefore = JSON.stringify(store.state().history);
  const baseline = collectPlanWarnings(store.state(), DEMO_NORMAL_DATE).map((w) => [w.id, w.level]);
  for (let round = 0; round < 3; round += 1) {
    assert.ok(store.setDateMode('comparison'));
    assert.equal(store.observationDate(), DEMO_COMPARISON_DATE);
    assert.deepEqual(
      collectPlanWarnings(store.state(), store.observationDate()).map((w) => [w.id, w.level]),
      [[baseline[0][0], 'red']],
    );
    assert.ok(store.setDateMode('normal'));
    assert.equal(store.observationDate(), DEMO_NORMAL_DATE);
    assert.deepEqual(
      collectPlanWarnings(store.state(), store.observationDate()).map((w) => [w.id, w.level]),
      baseline,
    );
  }
  assert.equal(JSON.stringify(store.state().history), historyBefore);
  assert.equal((store.state().operationEvents || []).length, 0);
  // 切档只触及既有的幂等同步（例如应收逾期提醒），不得重复累积通知。
  const noticesAfterFirstSwitch = [...store.state().notices.map((notice) => notice.id)].sort();
  for (let round = 0; round < 3; round += 1) {
    assert.ok(store.setDateMode(round % 2 === 0 ? 'comparison' : 'normal'));
    assert.deepEqual(
      [...store.state().notices.map((notice) => notice.id)].sort(),
      noticesAfterFirstSwitch,
    );
  }
  assert.equal(store.state().notices.length, noticesAfterFirstSwitch.length);

  // 重开（重新加载快照）后按当前模式重算
  assert.equal(store.dateMode(), 'comparison');
  const load = Reflect.get(store, 'load').bind(store) as () => DemoState;
  assert.equal(load().dateMode, 'comparison');
  assert.equal(
    collectPlanWarnings(load(), store.observationDate())[0].level,
    'red',
  );
  assert.ok(store.setDateMode('normal'));
  const reopened = Reflect.get(store, 'load').bind(store) as () => DemoState;
  assert.equal(reopened().dateMode, 'normal');
  assert.equal(collectPlanWarnings(reopened(), DEMO_NORMAL_DATE)[0].level, 'yellow');
});

test('WAR06 事项按项目/负责人/状态可筛，处理链接准确定位项目与 Plan', () => {
  const state = stateFixture([
    planFixture({ id: 'PL-1', owner: '刘工程师' }),
    planFixture({ id: 'PL-2', name: '调试测试', owner: '夏质量', end: '2026-10-24', warningLeadDays: 2 }),
  ]);
  const warnings = collectPlanWarnings(state, DEMO_COMPARISON_DATE);
  assert.equal(warnings.length, 2);
  assert.deepEqual(
    warnings.map((w) => w.href),
    [
      '/projects/DEMO-P900?tab=%E8%AE%A1%E5%88%92%E6%89%A7%E8%A1%8C&plan=%E5%86%85%E9%83%A8WBS&planId=PL-1',
      '/projects/DEMO-P900?tab=%E8%AE%A1%E5%88%92%E6%89%A7%E8%A1%8C&plan=%E5%86%85%E9%83%A8WBS&planId=PL-2',
    ],
  );
  const decoded = new URLSearchParams(warnings[1].href.split('?')[1]);
  assert.equal(decoded.get('tab'), '计划执行');
  assert.equal(decoded.get('plan'), '内部WBS');
  assert.equal(decoded.get('planId'), 'PL-2');

  const rows = collectPlanRiskRows(state, DEMO_COMPARISON_DATE);
  assert.equal(rows.filter((row) => row.kind !== '正常').length, 2);
  assert.equal(rows.find((row) => row.planId === 'PL-2')!.kind, trackingKindForRisk(planRisk(planFixture({ end: '2026-10-24', warningLeadDays: 2 }), DEMO_COMPARISON_DATE)));
  assert.equal(
    planWarningsForPerson(warnings, planWarningPersonKey('夏质量')).length,
    1,
  );
  assert.equal(planWarningsForPerson(warnings, planWarningPersonKey('李负责人')).length, 0);
});

test('WAR06 看板覆盖全部计划类型但定向预警只限客户主节点与内部WBS', () => {
  const state = stateFixture([
    planFixture({ id: 'PL-1', type: '内部WBS', owner: '刘工程师' }),
    planFixture({ id: 'PL-2', type: '客户主节点', name: '客户要求到货', owner: '刘工程师' }),
    planFixture({ id: 'PL-3', type: '要货发货', name: '第一批储能柜', owner: '陈物控' }),
  ]);
  const rows = collectPlanRiskRows(state, DEMO_COMPARISON_DATE).filter((row) => row.kind !== '正常');
  assert.equal(rows.length, 3, '看板保留全部计划类型的逾期');
  const warnings = collectPlanWarnings(state, DEMO_COMPARISON_DATE);
  assert.deepEqual(warnings.map((w) => w.planId).sort(), ['PL-1', 'PL-2']);
});

test('DAT02/DAT03/DAT04 计划、待办、看板共用同一观察日与同一快照；保存失败不留虚假更新', () => {
  const { store, role } = harness();
  let failing = false;
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failing) throw new Error('模拟存储失败');
        memory.set(key, value);
      },
    },
  });
  role('pm');
  const seed = store.state();
  seed.projects = seed.projects.slice(0, 1);
  seed.projects[0].briefing.startupHandover = undefined;
  seed.projects[0].plans = [planFixture({ owner: '刘工程师' })];
  seed.sales = [];
  seed.notices = [];

  const planLevel = planRisk(store.state().projects[0].plans[0], store.observationDate()).level;
  const todoItem = collectDemoWorkItems(
    store.state(),
    store.person(),
    store.observationDate(),
  ).items.find((item) => item.warning);
  const boardRows = collectPlanRiskRows(store.state(), store.observationDate()).filter(
    (row) => row.kind !== '正常',
  );
  assert.equal(store.observationDate(), DEMO_NORMAL_DATE);
  assert.equal(planLevel, 'blue');
  assert.equal(todoItem?.warning ?? undefined, undefined);
  assert.deepEqual(boardRows, []);

  assert.ok(store.setDateMode('comparison'));
  const comparisonDate = store.observationDate();
  assert.equal(comparisonDate, DEMO_COMPARISON_DATE);
  assert.equal(planRisk(store.state().projects[0].plans[0], comparisonDate).level, 'red');
  const todoAfter = collectDemoWorkItems(store.state(), store.person(), comparisonDate).items;
  assert.equal(todoAfter.filter((item) => item.warning).length, 1);
  assert.equal(
    collectPlanRiskRows(store.state(), comparisonDate).filter((row) => row.kind !== '正常').length,
    1,
    '计划、待办、看板必须由同一观察日得出同一结论',
  );

  // 保存失败：状态保持，不出现单页虚假更新
  const warningId = collectPlanWarnings(store.state(), comparisonDate)[0].id;
  const before = JSON.stringify(store.state());
  failing = true;
  const ui = (store as unknown as { ui: { fail: (message: string) => false } }).ui;
  const originalFail = ui.fail;
  ui.fail = () => false;
  try {
    assert.equal(store.markPlanWarningRead(warningId), false);
  } finally {
    ui.fail = originalFail;
    failing = false;
  }
  assert.equal(JSON.stringify(store.state()), before, '保存失败不得更新页面状态');
  assert.equal(
    isPlanWarningRead(store.state(), planWarningPersonKey(store.person()), warningId),
    false,
  );
});

test('已知人员名单只包含内部人员与项目团队，占位值不接收提醒', () => {
  const state = stateFixture([planFixture({ owner: '外部张' })]);
  const known = knownPlanPeople(state);
  assert.ok(known.has('王项目'));
  assert.equal(known.has('外部张'), false);
  assert.equal(planWarningPersonKey(''), '');
  assert.equal(collectPlanWarnings(state, WARN_DATE)[0].ownerLabel, '待补');
});

test('WAR06 看板统计与预警集合一致，已读不计入未读但不改变级别', () => {
  const state = stateFixture([planFixture({ owner: '刘工程师' })]);
  const warnings = collectPlanWarnings(state, DEMO_COMPARISON_DATE);
  const views = planWarningViews(state, warnings, planWarningPersonKey('王项目'));
  const stats = planWarningStats(views);
  assert.deepEqual(stats, { total: 1, yellow: 0, red: 1, unread: 1, projects: 1 });
  const readState: DemoState = {
    ...state,
    planWarningReads: [{ personKey: planWarningPersonKey('王项目'), warningId: warnings[0].id, readAt: '2026-10-22T00:00:00.000Z' }],
  };
  const after = planWarningStats(planWarningViews(readState, warnings, planWarningPersonKey('王项目')));
  assert.deepEqual(after, { total: 1, yellow: 0, red: 1, unread: 0, projects: 1 });
  assert.equal(collectPlanWarnings(readState, DEMO_COMPARISON_DATE)[0].level, 'red');
});
