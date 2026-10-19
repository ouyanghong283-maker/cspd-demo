import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { WorkspaceStorage } from '../src/app/core/workspace-storage';
import type { DemoState } from '../src/app/core/models';
import { emptySolutionWorkspace } from '../src/app/core/solution-workflow/versions';
test('公开V9升级混合快照先备份，保留真实当前及原历史，重复不保存', () => {
  const { store } = harness();
  const values = new Map<string, string>();
  let fail = '';
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem(k: string, v: string) {
      if (fail && k.includes(fail)) throw Error('quota');
      values.set(k, v);
    },
    removeItem(k: string) {
      values.delete(k);
    },
  };
  const ws = new WorkspaceStorage<DemoState>(
    storage,
    (v): v is DemoState => !!v && typeof v === 'object' && 'projects' in v,
  );
  const old = store.state();
  old.storageSchemaVersion = 2;
  old.dataVersion = 5;
  const w = emptySolutionWorkspace(old.solutionSeries![0].opportunityId);
  w.revision = 7;
  old.solutionWorkspaces = [w];
  const a = ws.createAndActivateRound(old);
  const raw = values.get(a.workspaceKey);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.assign(store, {
    workspaceStorage: ws,
    activeWorkspaceId: a.workspaceId,
    activeSnapshotKey: a.workspaceKey,
  });
  const before = JSON.stringify(store.state());
  fail = 'legacy-backup';
  assert.throws(() => store.migrateWorkspaceToV9(5));
  assert.equal(JSON.stringify(store.state()), before);
  assert.equal(values.get(a.workspaceKey), raw);
  fail = 'migration-candidate';
  assert.throws(() => store.migrateWorkspaceToV9(5));
  assert.equal(JSON.stringify(store.state()), before);
  assert.equal(values.get(a.workspaceKey), raw);
  fail = '';
  assert.equal(store.migrateWorkspaceToV9(5), true);
  assert.equal(store.state().storageSchemaVersion, 3);
  assert.equal(store.state().solutionWorkspaces!.find((x) => x.id === w.id)!.revision, 7);
  assert.deepEqual(store.state().quoteSeries, old.quoteSeries);
  assert.deepEqual(store.state().projects, old.projects);
  assert.ok([...values].some(([k, v]) => k.includes('legacy-backup') && v === raw));
  const size = values.size;
  assert.equal(store.migrateWorkspaceToV9(6), true);
  assert.equal(values.size, size);
});

test('V9升级在最终快照写入失败、只读与高版本时保留原发布状态', () => {
  const { store } = harness();
  const values = new Map<string, string>();
  let failSnapshot = false;
  let snapshotKey = '';
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem(k: string, v: string) {
      if (failSnapshot && k === snapshotKey) throw Error('commit quota');
      values.set(k, v);
    },
    removeItem(k: string) {
      values.delete(k);
    },
  };
  const ws = new WorkspaceStorage<DemoState>(
    storage,
    (v): v is DemoState => !!v && typeof v === 'object' && 'projects' in v,
  );
  store.state().storageSchemaVersion = 2;
  store.state().dataVersion = 9;
  const a = ws.createAndActivateRound(store.state());
  snapshotKey = a.workspaceKey;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.assign(store, {
    workspaceStorage: ws,
    activeWorkspaceId: a.workspaceId,
    activeSnapshotKey: a.workspaceKey,
  });
  const before = JSON.stringify(store.state()),
    raw = values.get(snapshotKey);
  failSnapshot = true;
  assert.throws(() => store.migrateWorkspaceToV9(9), /失败/);
  assert.equal(JSON.stringify(store.state()), before);
  assert.equal(values.get(snapshotKey), raw);
  failSnapshot = false;
  Object.assign(store, { editingLease: { owns: () => false } });
  assert.throws(() => store.migrateWorkspaceToV9(9), /修改资格/);
  assert.equal(values.get(snapshotKey), raw);
  Object.assign(store, { editingLease: { owns: () => true } });
  store.state().storageSchemaVersion = 99;
  const higher = JSON.stringify(store.state());
  assert.throws(() => store.migrateWorkspaceToV9(9), /修改资格/);
  assert.equal(JSON.stringify(store.state()), higher);
  assert.equal(values.get(snapshotKey), raw);
});
