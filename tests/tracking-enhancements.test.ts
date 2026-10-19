import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillProjectWarnings, planWarningDate } from '../src/app/core/plan-warning-backfill';
import { buildTrackingCharts, TrackingChartRow } from '../src/app/core/tracking-charts';
import { createSeed } from '../src/app/core/seed';
import { harness } from './v4-harness';
import { WorkspaceStorage } from '../src/app/core/workspace-storage';
import { DemoState } from '../src/app/core/models';

test('所有历史项目缺值补7天，保留0和3天，不重复覆盖人工清空，不改结束日或业务历史', () => {
  const state = createSeed();
  for (const project of state.projects)
    for (const plan of project.plans) delete plan.warningLeadDays;
  const [zero, three] = state.projects[0].plans;
  zero.warningLeadDays = 0;
  three.warningLeadDays = 3;
  const before = structuredClone(state);
  assert.equal(
    backfillProjectWarnings(state),
    state.projects.reduce((n, p) => n + p.plans.length, 0) - 2,
  );
  for (const project of state.projects)
    for (const plan of project.plans) {
      assert.equal(plan.warningLeadDays, plan.id === zero.id ? 0 : plan.id === three.id ? 3 : 7);
      assert.equal(
        plan.end,
        before.projects.find((p) => p.id === project.id)!.plans.find((p) => p.id === plan.id)!.end,
      );
    }
  assert.deepEqual(state.history, before.history);
  assert.deepEqual(state.operationEvents, before.operationEvents);
  delete state.projects[1].plans[0].warningLeadDays;
  assert.equal(backfillProjectWarnings(state), 0);
  assert.equal(state.projects[1].plans[0].warningLeadDays, undefined);
});

test('预警日期跨年、闰月、0天及动态日期；缺失和非法日期不补造', () => {
  for (const [end, days, expected] of [
    ['2026-01-03', 7, '2025-12-27'],
    ['2024-03-01', 1, '2024-02-29'],
    ['2026-10-20', 0, '2026-10-20'],
    ['2026-10-22', 7, '2026-10-15'],
  ] as const)
    assert.equal(planWarningDate({ end, warningLeadDays: days }), expected);
  for (const end of ['', '2026-02-30'])
    assert.equal(planWarningDate({ end, warningLeadDays: 7 }), undefined);
  assert.equal(planWarningDate({ end: '2026-10-20' }), undefined);
});

function fixture() {
  const { store } = harness();
  const values = new Map<string, string>();
  let failKey = '';
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === failKey) throw new Error('quota');
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const state = structuredClone(store.state());
  state.storageSchemaVersion = 2;
  delete state.projects[0].plans[0].warningLeadDays;
  const workspaces = new WorkspaceStorage<DemoState>(
    storage,
    (value): value is DemoState => !!value && typeof value === 'object' && 'projects' in value,
  );
  const workspace = workspaces.createAndActivateRound(state);
  store.state.set(state);
  Object.assign(store, {
    workspaceStorage: workspaces,
    activeWorkspaceId: workspace.workspaceId,
    activeSnapshotKey: workspace.workspaceKey,
  });
  return {
    store,
    values,
    storage,
    workspaces,
    workspace,
    fail: (key: string) => {
      failKey = key;
    },
  };
}

test('补齐先备份再持久化，保留轮次历史，重载不重复执行', () => {
  const f = fixture();
  const before = structuredClone(f.store.state());
  const raw = f.storage.getItem(f.workspace.workspaceKey);
  Reflect.get(f.store, 'tryMigrateWorkspaceToV8').call(f.store);
  assert.equal(f.store.state().projects[0].plans[0].warningLeadDays, 7);
  assert.equal(f.store.state().roundId, before.roundId);
  assert.deepEqual(f.store.state().operationEvents, before.operationEvents);
  assert.deepEqual(f.workspaces.readActive(), JSON.parse(JSON.stringify(f.store.state())));
  assert.ok(
    [...f.values.entries()].some(
      ([key, value]) => key !== f.workspace.workspaceKey && value === raw,
    ),
  );
  const version = f.store.state().dataVersion;
  Reflect.get(f.store, 'tryMigrateWorkspaceToV8').call(f.store);
  assert.equal(f.store.state().dataVersion, version);
});

test('补齐保存失败不发布内存且原快照保留；只读页不补齐', () => {
  const f = fixture();
  const before = structuredClone(f.store.state());
  const raw = f.storage.getItem(f.workspace.workspaceKey);
  f.fail(f.workspace.workspaceKey);
  assert.throws(() => Reflect.get(f.store, 'fillProjectWarningSettings').call(f.store), /失败/);
  assert.deepEqual(f.store.state(), before);
  assert.equal(f.storage.getItem(f.workspace.workspaceKey), raw);
  f.fail('');
  Object.assign(f.store, { editingLease: { owns: () => false } });
  Reflect.get(f.store, 'tryMigrateWorkspaceToV8').call(f.store);
  assert.deepEqual(f.store.state(), before);
});

const row = (key: string, kind: string, basisDate: string, project = 'P1'): TrackingChartRow => ({
  key,
  kind,
  basisDate,
  project: { id: project, name: '同名项目' },
});
test('图表与筛选行同源去重，按项目ID区分；到期分布排除财务与已完成，覆盖7天边界与空态', () => {
  const rows = [
    row('a', '延期', '2026-10-14'),
    row('b', '临近到期', '2026-10-15'),
    row('c', '临近到期', '2026-10-22', 'P2'),
    row('d', '预警待设置', '2026-10-23'),
    row('e', '日期待补', ''),
    row('f', '财务', '2026-10-01'),
    row('g', '已完成（逾期）', '2026-10-01'),
  ];
  const charts = buildTrackingCharts([...rows, rows[0]], '2026-10-15');
  assert.equal(charts.total, 7);
  assert.equal(
    charts.risks.reduce((n, r) => n + r.count, 0),
    7,
  );
  assert.equal(
    charts.projects.reduce((n, r) => n + r.total, 0),
    7,
  );
  assert.equal(charts.projects.length, 2);
  assert.deepEqual(
    charts.due.map((b) => b.count),
    [1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    buildTrackingCharts(
      rows.filter((r) => r.project.id === 'P2'),
      '2026-10-15',
    ).due.map((b) => b.count),
    [0, 0, 1, 0, 0],
  );
  assert.deepEqual(
    buildTrackingCharts(rows, '2026-10-22').due.map((b) => b.count),
    [2, 1, 1, 0, 1],
  );
  const empty = buildTrackingCharts([], '2026-10-15');
  assert.equal(empty.total, 0);
  assert.equal(empty.gradient, '#e9eef5');
  assert.ok(empty.due.every((b) => b.count === 0));
});
