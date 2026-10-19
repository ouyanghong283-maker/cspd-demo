import { normalizePlanWarningReads } from '../src/app/core/plan-warning';
import { planWarningId } from '../src/app/core/plan-warnings';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankPlan, createSeed } from '../src/app/core/seed';
import type { Plan } from '../src/app/core/models';
import { buildPlanTimeline } from '../src/app/core/plan-timeline';
import {
  collectDemoProjectWorkItems,
  collectDemoWorkItems,
} from '../src/app/core/work-item-sources';
import {
  collectPlanWarningNotices,
  currentPlanWarning,
  planWarningRecipients,
} from '../src/app/core/plan-warning';
import { harness } from './v4-harness';

function fixture() {
  const state = createSeed();
  const project = state.projects[0];
  state.projects = [project];
  state.sales = [];
  project.pm = '王项目';
  project.briefing.startupHandover = undefined;
  const plan: Plan = {
    ...blankPlan('内部WBS'),
    budgetAmount: 0,
    budgetCurrency: 'CNY',
    id: 'stable-plan',
    name: '独立实施任务',
    owner: '周方案',
    start: '2026-10-01',
    end: '2026-10-20',
    expected: '2026-12-31',
    warningLeadDays: 5,
  };
  project.plans = [plan];
  return { state, project, plan };
}

test('甘特覆盖旧月份、模拟日及跨年任务，单日节点可见，非法日期不生成条带', () => {
  const single = { ...blankPlan('客户主节点'), start: '2024-02-29', end: '2024-02-29' };
  const long = { ...single, start: '2025-01-01', end: '2029-12-31' };
  const timeline = buildPlanTimeline([single, long], '2030-01-01');
  assert.equal(timeline.ticks[0].label, '2024-02-27');
  assert.equal(timeline.ticks.at(-1)?.label, '2030-01-03');
  assert.ok(timeline.today! > 0 && timeline.today! < 100);
  assert.ok((timeline.bar(single)!.width * timeline.width) / 100 >= 10);
  assert.ok(timeline.bar(long)!.left > timeline.bar(single)!.left);
  assert.ok(timeline.bar(long)!.left + timeline.bar(long)!.width <= 100);
  assert.equal(timeline.bar({ ...single, start: '2024-02-30' }), undefined);
  assert.equal(timeline.bar({ ...single, start: '2024-03-01' }), undefined);
  const finalNode = { ...single, start: '2030-01-01', end: '2030-01-01' };
  const lastBar = timeline.bar(finalNode)!;
  assert.ok(lastBar.left + lastBar.width <= 100);
  assert.ok(Number.isFinite(buildPlanTimeline([], '').width));
});

test('临期升超期更新同一工作项，负责人和PM同源可见，PMO与未知身份不接收', () => {
  const { state, project, plan } = fixture();
  const ownerView = collectDemoWorkItems(state, '周方案');
  const pmView = collectDemoWorkItems(state, '王项目');
  assert.equal(ownerView.counts.open, 1);
  assert.equal(pmView.counts.open, 1);
  assert.equal(ownerView.items[0].id, pmView.items[0].id);
  assert.equal(ownerView.items[0].warning?.level, 'yellow');
  assert.equal(collectDemoWorkItems(state, '李负责人').counts.open, 0);
  state.dateMode = 'comparison';
  plan.name = '更名的实施任务';
  const overdue = collectDemoWorkItems(state, '周方案');
  assert.equal(overdue.items[0].id, ownerView.items[0].id);
  assert.equal(overdue.items[0].warning?.level, 'red');
  assert.equal(collectDemoProjectWorkItems(state).counts.open, 1);
  const target = new URL(overdue.items[0].href!, 'http://demo.local');
  assert.equal(target.searchParams.get('focus'), plan.id);
  assert.equal(target.searchParams.get('plan'), '内部WBS');
  assert.equal(target.searchParams.get('tab'), 'plans');
  plan.owner = project.pm;
  assert.equal(planWarningRecipients(project, plan).length, 1);
  plan.owner = '未知负责人';
  project.pm = '未知PM';
  assert.deepEqual(planWarningRecipients(project, plan), []);
  assert.equal(collectDemoProjectWorkItems(state).items[0].warning, undefined);
});

test('持久化个人已读保持风险及他人未读，换负责人后转交，完成/取消后保留阅读记录', () => {
  const { store, role } = harness();
  const { state, project, plan } = fixture();
  store.state.set(state);
  role('pm');
  assert.equal(store.markPlanWarningRead(project.id, plan.id), true);
  const saved = JSON.parse(JSON.stringify(store.state()));
  assert.equal(collectDemoWorkItems(saved, '王项目').items[0].warning?.read, true);
  assert.equal(collectDemoWorkItems(saved, '周方案').items[0].warning?.read, false);
  assert.equal(collectDemoWorkItems(saved, '王项目').items[0].warning?.level, 'yellow');
  assert.equal(store.state().operationEvents?.length || 0, state.operationEvents?.length || 0);
  assert.equal(store.markPlanWarningRead(project.id, plan.id), true);
  assert.equal(store.state().planWarningReads?.length, 1);
  const transferred = { ...store.project(project.id)!.plans[0], owner: '吴运维' };
  assert.equal(store.savePlan(project.id, transferred), true);
  assert.equal(collectDemoWorkItems(store.state(), '周方案').counts.open, 0);
  assert.equal(collectDemoWorkItems(store.state(), '吴运维').items[0].warning?.read, false);
  assert.equal(store.savePlan(project.id, { ...transferred, status: '已取消' }), true);
  assert.equal(collectDemoProjectWorkItems(store.state()).counts.open, 0);
  assert.equal(store.state().planWarningReads?.length, 1);
  const completed = { ...transferred, status: '已完成', actual: '2026-10-21' };
  assert.equal(currentPlanWarning(store.state(), project, completed, '2026-10-22'), undefined);
});

test('切换观察档、改期与重新打开从当前快照重算；普通待办不随预警消失', () => {
  const { state, project, plan } = fixture();
  state.dateMode = 'comparison';
  assert.equal(collectDemoWorkItems(state, project.pm).items[0].warning?.level, 'red');
  plan.end = '2026-12-01';
  assert.equal(collectDemoWorkItems(state, project.pm).counts.open, 0);
  assert.equal(collectDemoWorkItems(state, plan.owner).counts.open, 1);
  assert.equal(collectDemoWorkItems(state, plan.owner).items[0].warning, undefined);
  const reopened = JSON.parse(JSON.stringify(state));
  assert.equal(collectDemoWorkItems(reopened, project.pm).counts.open, 0);
  assert.equal(collectDemoProjectWorkItems(reopened).counts.open, 1);
});

test('通知随同一Plan动态更新，姓名和部门变化不改变人员身份，旧阅读历史保留', () => {
  const { state, project, plan } = fixture();
  const member = project.team.find((item) => item.person === '周方案')!;
  plan.ownerPersonId = member.id;
  const first = collectPlanWarningNotices(state, '周方案', 'solution');
  assert.equal(first.length, 1);
  assert.match(first[0].title, /预警/);
  assert.equal(collectDemoWorkItems(state, '周方案').counts.open, 1);
  const personId = planWarningRecipients(project, plan)[0];
  state.planWarningReads = [
    {
      personKey: personId,
      warningId: planWarningId(project.id, plan.id),
      readAt: '2026-10-16T00:00:00Z',
    },
  ];
  plan.ownerPersonId = personId;
  plan.owner = '方案显示名称已更改';
  member.person = plan.owner;
  member.department = '新的部门';
  plan.name = '计划名称已更改';
  state.dateMode = 'comparison';
  const next = collectPlanWarningNotices(state, '周方案', 'solution');
  assert.equal(next[0].id, first[0].id);
  assert.equal(next[0].read, true);
  assert.match(next[0].title, /已逾期/);
  assert.equal(collectDemoWorkItems(state, '周方案').counts.open, 1);
  plan.end = '2026-12-01';
  assert.equal(collectPlanWarningNotices(state, '周方案', 'solution').length, 0);
  assert.equal(collectDemoWorkItems(state, '周方案').counts.open, 1);
  assert.equal(state.planWarningReads.length, 1);
});

test('固定登录身份在团队成员更名后仍接收同一预警并保留已读', () => {
  const { store, role } = harness();
  const { state, project, plan } = fixture();
  const member = project.team.find((item) => item.person === '周方案')!;
  plan.ownerPersonId = member.id;
  member.personId = 'demo-role:solution';
  store.state.set(state);
  role('solution');
  assert.equal(store.markPlanWarningRead(project.id, plan.id), true);
  const before = collectPlanWarningNotices(store.state(), store.person(), 'solution')[0];
  const renamedTeam = store
    .project(project.id)!
    .team.map((item) =>
      item.id === member.id ? { ...item, person: '方案新显示名', department: '新部门' } : item,
    );
  assert.equal(store.assignTeam(project.id, renamedTeam), true);
  assert.equal(store.person(), '周方案');
  const after = collectPlanWarningNotices(store.state(), store.person(), 'solution');
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before.id);
  assert.equal(after[0].read, true);
  assert.equal(collectDemoWorkItems(store.state(), store.person()).counts.open, 1);
});

test('已读和计划保存失败不发布虚假风险或读状态，旧版本/无修改权也拒绝写入', () => {
  const { store, role } = harness();
  const { state, project, plan } = fixture();
  store.state.set(state);
  role('pm');
  const before = structuredClone(store.state());
  const originalSet = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error('quota');
  };
  assert.throws(() => store.markPlanWarningRead(project.id, plan.id), /quota/);
  assert.deepEqual(store.state(), before);
  assert.throws(() => store.savePlan(project.id, { ...plan, end: '2026-12-01' }), /quota/);
  assert.deepEqual(store.state(), before);
  localStorage.setItem = originalSet;
  const originalGet = localStorage.getItem;
  localStorage.getItem = () =>
    JSON.stringify({ ...before, dataVersion: (before.dataVersion || 1) + 1 });
  assert.throws(() => store.markPlanWarningRead(project.id, plan.id), /版本已变化/);
  assert.deepEqual(store.state(), before);
  localStorage.getItem = originalGet;
  Object.assign(store, { canEdit: () => false, editingWritable: { set() {} } });
  assert.throws(() => store.markPlanWarningRead(project.id, plan.id), /没有修改权/);
  assert.deepEqual(store.state(), before);
});

test('合流时兼容本地预警阅读格式，保留已发布格式并去重', () => {
  const { state, project, plan } = fixture();
  Reflect.set(state, 'planWarningReads', [
    {
      projectId: project.id,
      planId: plan.id,
      personId: 'demo-role:pm',
      readAt: '2026-10-16T00:00:00Z',
    },
    {
      personKey: 'demo-person:王项目',
      warningId: planWarningId(project.id, plan.id),
      readAt: '2026-10-16T00:00:00Z',
    },
  ]);
  state.planWarningReads = normalizePlanWarningReads(state);
  assert.equal(state.planWarningReads.length, 1);
  assert.equal(currentPlanWarning(state, project, plan, '2026-10-15', '王项目')?.read, true);
});
