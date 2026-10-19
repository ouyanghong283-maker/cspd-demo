import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { selectV10ProjectDelivery, type V10QueryContext } from '../src/app/core/v10-contracts';
import type { DemoState } from '../src/app/core/models';

function setup() {
  const { store, role } = harness();
  role('pm');
  const values = new Map<string, string>();
  let failing = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, raw: string) => {
        if (failing) throw Error('QuotaExceededError');
        values.set(key, raw);
      },
    },
  });
  store.state().roundId = 'ROUND-RETENTION';
  const id = 'DEMO-P001';
  const milestone = structuredClone(
    store.project(id)!.plans.find((p) => p.id === id + '-V10-shipment')!,
  );
  milestone.end = '2026-10-10';
  assert.equal(store.savePlan(id, milestone), true);
  const read = (state: DemoState = store.state()) => {
    const context: V10QueryContext = {
      workspaceId: 'WS-RETENTION',
      roundId: state.roundId!,
      dataVersion: state.dataVersion ?? null,
      contextRevision: 'READ-RETENTION',
      dates: {
        planObservationDate: '2026-10-15',
        solutionBusinessDate: '2026-10-18',
        realNowUtc: '2026-10-18T01:00:00Z',
        timezone: 'Asia/Shanghai',
        lastSuccessfulReadAt: null,
      },
      sources: { projects: 'ready', customers: 'ready', opportunities: 'ready' },
      fileAvailability: {},
    };
    return selectV10ProjectDelivery(state, context, id).delivery!;
  };
  const saved = () => JSON.parse([...values.values()].at(-1)!) as DemoState;
  return {
    store,
    id,
    read,
    saved,
    values,
    fail: (value: boolean) => {
      failing = value;
    },
  };
}

test('删除发货来源后原承诺仍延期5天，独立重读保存快照保留身份日期且查询零写入', () => {
  const f = setup();
  assert.equal(f.read().status, 'delayed');
  assert.equal(f.store.deletePlan(f.id, f.id + '-要货发货'), true);
  const raw = JSON.stringify(f.saved());
  const result = f.read(f.saved());
  assert.equal(result.status, 'delayed');
  const node = result.nodes.find((n) => n.category === 'shipment')!;
  assert.equal(node.promisedDate, '2026-10-10');
  assert.equal(node.delayedDays, 5);
  assert.equal(node.sourceHref, null);
  assert.ok(node.issues.some((i) => i.includes('删除')));
  assert.equal(JSON.stringify(f.saved()), raw);
});

test('取消、删除客户主节点、替换WBS均保留可靠承诺且来源入口如实变化', () => {
  const f = setup();
  const source = structuredClone(
    f.store.project(f.id)!.plans.find((p) => p.id === f.id + '-要货发货')!,
  );
  source.status = '已取消';
  assert.equal(f.store.savePlan(f.id, source), true);
  let node = f.read(f.saved()).nodes.find((n) => n.category === 'shipment')!;
  assert.equal(node.status, 'delayed');
  assert.equal(node.delayedDays, 5);
  assert.ok(node.issues.some((i) => i.includes('取消')));
  assert.equal(f.store.deletePlan(f.id, source.id), true);
  assert.equal(f.store.deletePlan(f.id, f.id + '-V10-shipment'), true);
  node = f.read(f.saved()).nodes.find((n) => n.category === 'shipment')!;
  assert.equal(node.delayedDays, 5);
  assert.equal(node.sourceHref, null);
  assert.equal(node.milestoneHref, null);
  const acceptance = structuredClone(
    f.store.project(f.id)!.plans.find((p) => p.id === f.id + '-V10-customerAcceptance')!,
  );
  acceptance.end = '2026-10-10';
  assert.equal(f.store.savePlan(f.id, acceptance), true);
  assert.equal(f.store.applyTemplate(f.id, false), true);
  node = f.read(f.saved()).nodes.find((n) => n.category === 'customerAcceptance')!;
  assert.equal(node.status, 'delayed');
  assert.equal(node.delayedDays, 5);
  assert.equal(node.planId, f.id + '-W8');
  assert.equal(node.sourceHref, null);
  assert.ok(node.issues.some((i) => i.includes('替换')));
});

test('删除提交失败不发布部分计划或留存，重试后再独立读取才出现删除', () => {
  const f = setup();
  const before = structuredClone(f.store.state());
  const raw = JSON.stringify(f.saved());
  f.fail(true);
  assert.throws(() => f.store.deletePlan(f.id, f.id + '-要货发货'), /Quota/);
  assert.deepEqual(f.store.state(), before);
  assert.equal(JSON.stringify(f.saved()), raw);
  f.fail(false);
  assert.equal(f.store.deletePlan(f.id, f.id + '-要货发货'), true);
  assert.equal(f.read(f.saved()).nodes[0].delayedDays, 5);
});

async function workspace(input?: DemoState) {
  const { signal } = await import('@angular/core');
  const { WorkspaceStorage } = await import('../src/app/core/workspace-storage');
  const { store, role } = harness();
  role('pm');
  const state = input ?? structuredClone(store.state());
  state.roundId = 'ROUND-OLD';
  state.dataVersion = 5;
  state.storageSchemaVersion = 3;
  state.projectWarningBackfillVersion = 1;
  store.state.set(state);
  const values = new Map<string, string>();
  let fault = '';
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k.includes(fault) && fault) throw Error('QuotaExceededError');
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const adapter = new WorkspaceStorage<DemoState>(
    storage,
    (v): v is DemoState => !!v && typeof v === 'object' && 'projects' in v,
  );
  const active = adapter.createAndActivateRound(state);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.assign(store, {
    workspaceStorage: adapter,
    activeWorkspaceId: active.workspaceId,
    activeSnapshotKey: active.workspaceKey,
    workspaceRecoveryMessage: signal(''),
    v8MigrationMessage: signal(''),
    editingWritable: signal(true),
    pendingOriginalCleanups: signal([]),
    originalRecoveryMessage: signal(''),
    contractOriginals: {
      async keys() {
        return [];
      },
    },
  });
  return {
    store,
    adapter,
    active,
    values,
    fail: (key: string) => {
      fault = key;
    },
  };
}

function readState(state: DemoState, projectId = 'DEMO-P001') {
  return selectV10ProjectDelivery(
    state,
    {
      workspaceId: 'WS-RETENTION',
      roundId: state.roundId!,
      dataVersion: state.dataVersion ?? null,
      contextRevision: 'READ-OLD',
      dates: {
        planObservationDate: '2026-10-15',
        solutionBusinessDate: '2026-10-18',
        realNowUtc: '2026-10-18T01:00:00Z',
        timezone: 'Asia/Shanghai',
        lastSuccessfulReadAt: null,
      },
      sources: { projects: 'ready', customers: 'ready', opportunities: 'ready' },
      fileAvailability: {},
    },
    projectId,
  ).delivery!;
}

test('旧工作区只恢复原快照里可证明的身份类别日期，升级幂等并保留备份，缺日期或仅名称不猜测', async () => {
  const { createSeed } = await import('../src/app/core/seed');
  const old = createSeed();
  delete old.customerDeliveryMappings;
  delete old.customerDeliveryRetentionVersion;
  old.projectMilestoneBindings = [];
  const p = old.projects[0];
  const ship = p.plans.find((p) => p.type === '要货发货')!;
  const shipMilestone = p.plans.find((p) => p.id.endsWith('-V10-shipment'))!;
  shipMilestone.end = '2026-10-10';
  const acceptance = p.plans.find((p) => p.completionKind === 'acceptance')!;
  delete acceptance.completionKind;
  delete acceptance.customerMilestoneId;
  acceptance.linked = p.plans.find((p) => p.id.endsWith('-V10-customerAcceptance'))!.name;
  const f = await workspace(old);
  const before = f.values.get(f.active.workspaceKey)!;
  assert.equal(f.store.migrateWorkspaceDeliveryCommitments(5), true);
  assert.equal(f.adapter.readActive()!.customerDeliveryRetentionVersion, 1);
  assert.equal(f.values.has(f.active.workspaceKey), true);
  assert.ok(
    [...f.values.entries()].some(
      ([key, value]) => key.includes('legacy-backup') && value === before,
    ),
  );
  const view = readState(f.adapter.readActive()!);
  assert.equal(view.status, 'delayed');
  assert.equal(view.nodes.find((n) => n.category === 'shipment')!.delayedDays, 5);
  assert.equal(
    view.nodes.some((n) => n.category === 'customerAcceptance'),
    false,
  );
  const raw = f.values.get(f.active.workspaceKey);
  assert.equal(f.store.migrateWorkspaceDeliveryCommitments(6), true);
  assert.equal(f.values.get(f.active.workspaceKey), raw);
  assert.equal(f.store.resumeWorkspace(f.active.workspaceId), true);
  const source = structuredClone(f.store.project(p.id)!.plans.find((p) => p.id === ship.id)!);
  source.status = '已取消';
  assert.equal(f.store.savePlan(p.id, source), true);
  assert.equal(
    readState(f.adapter.readActive()!).nodes.some((n) => n.category === 'customerAcceptance'),
    false,
    '兼容名称补关联不能在无关保存时升级成承诺',
  );
});

test('旧承诺升级写入失败保留旧原文及公开查询结果，未知日期不补造', async () => {
  const f = await workspace();
  const before = structuredClone(f.store.state());
  const raw = f.values.get(f.active.workspaceKey);
  f.fail(':migration-candidate:');
  assert.throws(() => f.store.migrateWorkspaceDeliveryCommitments(5), /失败/);
  assert.deepEqual(f.store.state(), before);
  assert.equal(f.values.get(f.active.workspaceKey), raw);
  f.fail('');
  const milestone = f.store.state().projects[0].plans.find((p) => p.id.endsWith('-V10-shipment'))!;
  milestone.end = '';
  // 独立旧来源夹具：缺可靠客户日期不创建历史快照。
  const missing = await workspace(structuredClone(f.store.state()));
  assert.equal(missing.store.migrateWorkspaceDeliveryCommitments(5), true);
  const node = readState(missing.adapter.readActive()!).nodes[0];
  assert.equal(node.status, 'pending');
  assert.equal(node.promisedDate, null);
});

test('同轮公开续接仍保留删除承诺，新轮使用新来源，旧备份风险不混入', async () => {
  const f = await workspace();
  assert.equal(f.store.migrateWorkspaceDeliveryCommitments(5), true);
  const id = 'DEMO-P001';
  const milestone = structuredClone(
    f.store.project(id)!.plans.find((p) => p.id.endsWith('-V10-shipment'))!,
  );
  milestone.end = '2026-10-10';
  assert.equal(f.store.savePlan(id, milestone), true);
  assert.equal(f.store.deletePlan(id, id + '-要货发货'), true);
  const oldRound = f.store.state().roundId;
  const oldRaw = f.values.get(f.active.workspaceKey);
  assert.equal(f.store.resumeWorkspace(f.active.workspaceId), true);
  assert.equal(readState(f.store.state()).nodes[0].delayedDays, 5);
  await f.store.recoverContractFiles();
  assert.equal(await f.store.reset(), true);
  assert.notEqual(f.store.state().roundId, oldRound);
  assert.equal(readState(f.adapter.readActive()!).status, 'normal');
  assert.equal(f.values.get(f.active.workspaceKey), oldRaw);
  assert.equal(f.store.resumeWorkspace(f.active.workspaceId), true);
  assert.equal(f.store.state().roundId, oldRound);
  assert.equal(readState(f.store.state()).nodes[0].delayedDays, 5);
});

test('验收来源被模板替换后仍可核对有效完成成绩，复核撤销后重新延期', () => {
  const f = setup();
  const shipping = structuredClone(
    f.store.project(f.id)!.plans.find((p) => p.id.endsWith('-V10-shipment'))!,
  );
  shipping.end = '2026-11-20';
  assert.equal(f.store.savePlan(f.id, shipping), true);
  const acceptance = structuredClone(
    f.store.project(f.id)!.plans.find((p) => p.id.endsWith('-V10-customerAcceptance'))!,
  );
  acceptance.end = '2026-10-08';
  assert.equal(f.store.savePlan(f.id, acceptance), true);
  assert.equal(f.store.simulateDocument(f.id, '客户签字清单', '签字.pdf'), true);
  for (const a of f.store.project(f.id)!.acceptance)
    assert.equal(f.store.saveAcceptance(f.id, a.id, '通过', '客户代表', '2026-10-09', ''), true);
  assert.equal(f.store.completeAcceptance(f.id), true);
  assert.equal(f.store.applyTemplate(f.id, true), true);
  const node = f.read(f.saved()).nodes.find((n) => n.category === 'customerAcceptance')!;
  assert.equal(node.completionValid, true);
  assert.equal(node.completedLateDays, 1);
  assert.equal(f.read(f.saved()).status, 'normal');
  const first = f.store.project(f.id)!.acceptance[0];
  assert.equal(
    f.store.saveAcceptance(f.id, first.id, '待整改', '客户代表', '2026-10-09', '复核'),
    true,
  );
  assert.equal(
    f.read(f.saved()).nodes.find((n) => n.category === 'customerAcceptance')!.delayedDays,
    7,
  );
});

test('来源删除后客户主节点的新约定仍可保存并更新留存日期，不退回更旧日期', () => {
  const f = setup();
  assert.equal(f.store.deletePlan(f.id, f.id + '-要货发货'), true);
  const milestone = structuredClone(
    f.store.project(f.id)!.plans.find((p) => p.id.endsWith('-V10-shipment'))!,
  );
  milestone.end = '2026-10-09';
  assert.equal(f.store.savePlan(f.id, milestone), true);
  assert.equal(f.read(f.saved()).nodes[0].promisedDate, '2026-10-09');
  assert.equal(f.read(f.saved()).nodes[0].delayedDays, 6);
});

test('取消和模板替换保存失败均原子保留，新轮不消费旧轮留存', () => {
  for (const action of ['cancel', 'template'] as const) {
    const f = setup();
    const before = structuredClone(f.store.state());
    const raw = JSON.stringify(f.saved());
    f.fail(true);
    if (action === 'cancel') {
      const p = structuredClone(
        f.store.project(f.id)!.plans.find((p) => p.id === f.id + '-要货发货')!,
      );
      p.status = '已取消';
      assert.throws(() => f.store.savePlan(f.id, p), /Quota/);
    } else assert.throws(() => f.store.applyTemplate(f.id, true), /Quota/);
    assert.deepEqual(f.store.state(), before);
    assert.equal(JSON.stringify(f.saved()), raw);
  }
  const f = setup();
  assert.equal(f.store.deletePlan(f.id, f.id + '-要货发货'), true);
  const otherRound = f.saved();
  otherRound.roundId = 'NEW-ROUND';
  assert.equal(f.read(otherRound).nodes[0].promisedDate, null);
  assert.equal(f.read(otherRound).nodes[0].status, 'pending');
});

test('后续新建有明确类别和稳定关联的发货批次同次保存留存，删除后仍延期', () => {
  const f = setup();
  const id = 'DEMO-P003';
  const p = f.store.project(id)!;
  const milestone = {
    ...structuredClone(p.plans.find((p) => p.type === '客户主节点')!),
    id: 'NEW-MILESTONE',
    name: '新约定（模拟）',
    start: '2026-10-01',
    end: '2026-10-10',
  };
  assert.equal(f.store.savePlan(id, milestone), true);
  const source = {
    ...structuredClone(p.plans.find((p) => p.type === '要货发货')!),
    id: 'NEW-BATCH',
    name: '新批次（模拟）',
    customerMilestoneId: milestone.id,
  };
  assert.equal(f.store.savePlan(id, source), true);
  assert.equal(f.store.deletePlan(id, source.id), true);
  const state = f.saved();
  const view = readState(state, id);
  assert.equal(view.status, 'delayed');
  const node = view.nodes.find((n) => n.planId === source.id)!;
  assert.equal(node.delayedDays, 5);
  assert.equal(node.sourceHref, null);
  assert.equal(node.promiseOrigin, 'retained');
});

test('公开续接先核验原始承诺来源，预警或国家修复不能把名称推断洗成历史依据', async () => {
  const { createSeed } = await import('../src/app/core/seed');
  for (const repair of ['warnings', 'country'] as const) {
    const old = createSeed();
    delete old.customerDeliveryMappings;
    delete old.customerDeliveryRetentionVersion;
    old.projectMilestoneBindings = [];
    const p = old.projects[0];
    for (const [category, sourceId] of [
      ['shipment', p.id + '-要货发货'],
      ['customerAcceptance', p.id + '-W8'],
    ]) {
      const source = p.plans.find((plan) => plan.id === sourceId)!;
      const milestone = p.plans.find((plan) => plan.id === p.id + '-V10-' + category)!;
      delete source.customerMilestoneId;
      delete source.completionKind;
      source.linked = milestone.name;
    }
    const f = await workspace(old);
    const raw = JSON.parse(f.values.get(f.active.workspaceKey)!);
    if (repair === 'warnings') delete raw.snapshot.projectWarningBackfillVersion;
    else raw.snapshot.customers[0].country = '德国';
    f.values.set(f.active.workspaceKey, JSON.stringify(raw));
    assert.equal(f.store.resumeWorkspace(f.active.workspaceId), true);
    await f.store.recoverContractFiles();
    const persisted = f.adapter.readActive()!;
    assert.equal(persisted.customerDeliveryRetentionVersion, 1);
    assert.equal(
      (persisted.customerDeliveryMappings ?? []).some((m) => m.projectId === p.id),
      false,
      repair,
    );
    assert.equal(readState(persisted).status, 'pending');
    assert.equal(readState(persisted).nodes.length, 0);
    assert.equal(persisted.projectWarningBackfillVersion, 1);
    if (repair === 'country') assert.equal(persisted.customers[0].country, 'Germany');
  }
});

test('原文升级失败后直接重试业务保存仍按原文核验，不从兼容推断内存补种', async () => {
  const { createSeed } = await import('../src/app/core/seed');
  const old = createSeed();
  delete old.customerDeliveryMappings;
  old.projectMilestoneBindings = [];
  const p = old.projects[0];
  const acceptance = p.plans.find((p) => p.id.endsWith('-W8'))!;
  delete acceptance.customerMilestoneId;
  delete acceptance.completionKind;
  acceptance.linked = p.plans.find((p) => p.id.endsWith('-V10-customerAcceptance'))!.name;
  const f = await workspace(old);
  f.fail(':migration-candidate:');
  assert.equal(f.store.resumeWorkspace(f.active.workspaceId), true);
  await f.store.recoverContractFiles();
  assert.equal(f.adapter.readActive()!.customerDeliveryRetentionVersion, undefined);
  const ship = structuredClone(
    f.store.project(p.id)!.plans.find((p) => p.id.endsWith('-V10-shipment'))!,
  );
  const beforeRetry = structuredClone(f.store.state());
  const beforeRaw = f.values.get(f.active.workspaceKey);
  f.fail(f.active.workspaceKey);
  assert.throws(() => f.store.savePlan(p.id, ship), /Quota/);
  assert.deepEqual(f.store.state(), beforeRetry);
  assert.equal(f.values.get(f.active.workspaceKey), beforeRaw);
  f.fail('');
  assert.equal(f.store.savePlan(p.id, ship), true);
  assert.equal(f.adapter.readActive()!.customerDeliveryRetentionVersion, 1);
  assert.equal(
    readState(f.adapter.readActive()!).nodes.some((n) => n.category === 'customerAcceptance'),
    false,
  );
  // 对只有兼容推断关联的原验收来源保存说明，也不能把名称变成历史证明。
  const inferred = structuredClone(
    f.store.project(p.id)!.plans.find((p) => p.id === acceptance.id)!,
  );
  inferred.note = '只补说明，不确认关联';
  assert.equal(f.store.savePlan(p.id, inferred), true);
  assert.equal(
    readState(f.adapter.readActive()!).nodes.some((n) => n.category === 'customerAcceptance'),
    false,
  );
});
