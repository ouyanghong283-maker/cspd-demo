import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { harness } from './v4-harness';
import { WorkspaceStorage } from '../src/app/core/workspace-storage';
import type { DemoState } from '../src/app/core/models';

test('公开重新开始保留旧工作区遗留资料且新轮不复制', async () => {
  const { store } = harness();
  Object.assign(store, {
    editingWritable: signal(true),
    workspaceRecoveryMessage: signal(''),
    originalRecoveryMessage: signal(''),
    pendingOriginalCleanups: signal([]),
    contractOriginals: {
      async records() {
        return [];
      },
    },
  });
  // Start with a real legacy record so reentry checks cover preserved data,
  // not only an empty seed collection.
  const legacyOpportunityId = store.state().sales[0].id;
  store.state().storageSchemaVersion = 2;
  store.addSolutionDocument(legacyOpportunityId, '技术方案', '历史方案.pdf', '周方案');
  const legacyDocuments = structuredClone(store.state().solutionDocuments);
  store.state().roundId = 'OLD';
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const ws = new WorkspaceStorage<DemoState>(
    storage,
    (s): s is DemoState => !!s && typeof s === 'object' && 'projects' in s,
  );
  const old = ws.createAndActivateRound(store.state());
  Object.assign(store, {
    workspaceStorage: ws,
    activeWorkspaceId: old.workspaceId,
    activeSnapshotKey: old.workspaceKey,
  });
  assert.equal(await store.reset(), true);
  assert.equal(store.state().storageSchemaVersion, 3);
  assert.notEqual(store.state().roundId, 'OLD');
  assert.deepEqual(store.state().operationEvents, []);
  assert.ok(store.state().solutionWorkspaces?.length);
  assert.ok(
    store
      .state()
      .solutionWorkspaces!.every(
        (w) =>
          !w.firstFinalization &&
          !w.finalizations.length &&
          w.versions.every((v) => v.origin !== 'operation'),
      ),
  );
  assert.equal(ws.readWorkspace(old.workspaceId)!.roundId, 'OLD');
  assert.deepEqual(ws.readWorkspace(old.workspaceId)!.solutionDocuments, legacyDocuments);
  assert.equal(
    store.state().solutionDocuments?.some((row) => row.opportunityId === legacyOpportunityId),
    false,
    '新轮不能复制旧工作区的遗留方案集合',
  );
  assert.equal(ws.readActive()!.storageSchemaVersion, 3);
  assert.equal(store.resumeWorkspace(old.workspaceId), true);
  assert.deepEqual(store.state().solutionDocuments, legacyDocuments);
});

test('仅元数据恢复保留首次与上传时间，缺件不允许新定稿，重传生成新版且失败可重试', async () => {
  const { ready } = await import('./v9-finalization-fixture');
  const { finalizeSolution, selectFinalizationSource } =
    await import('../src/app/core/solution-workflow/finalization');
  const { uploadSolutionOutput } = await import('../src/app/core/solution-workflow/upload');
  const f = await ready();
  await finalizeSolution(f.store, f.input, f.context, f.files);
  f.store.state.set(JSON.parse(JSON.stringify(f.store.state())));
  const old = structuredClone(
    f.store.state().solutionWorkspaces!.find((w) => w.opportunityId === f.input.opportunityId)!,
  );
  f.rows.clear();
  const missing = { get: async () => null, put: f.files.put };
  const unavailable = {
    get: async () => {
      throw Error('unavailable');
    },
    put: f.files.put,
  };
  for (const files of [missing, unavailable]) {
    const r = await finalizeSolution(
      f.store,
      f.input,
      { ...f.context, operationId: 'RESTORED' },
      files,
    );
    assert.equal(r.status, 'rejected');
    assert.match(r.message, files === missing ? /缺失/ : /不可读/);
  }
  let fail = true;
  globalThis.localStorage.setItem = () => {
    if (fail) throw Error('quota');
  };
  const input = {
    opportunityId: f.input.opportunityId,
    kind: 'proposal' as const,
    file: new File(['new'], 'restored.pptx'),
    note: '恢复重传',
  };
  const c = { ...f.context, operationId: 'RESTORE-UPLOAD' };
  assert.equal((await uploadSolutionOutput(f.store, input, c, f.files)).status, 'failed');
  assert.deepEqual(
    f.store.state().solutionWorkspaces!.find((w) => w.id === old.id),
    old,
  );
  fail = false;
  assert.equal((await uploadSolutionOutput(f.store, input, c, f.files)).status, 'committed');
  assert.equal((await uploadSolutionOutput(f.store, input, c, f.files)).status, 'unchanged');
  const next = f.store.state().solutionWorkspaces!.find((w) => w.id === old.id)!;
  assert.equal(next.versions.length, old.versions.length + 1);
  assert.deepEqual(next.firstFinalization, old.firstFinalization);
  assert.deepEqual(next.finalizations, old.finalizations);
  assert.equal(
    next.versions.find((v) => v.id === old.currentOutputs.proposal)!.uploadedAt,
    old.versions.find((v) => v.id === old.currentOutputs.proposal)!.uploadedAt,
  );
  assert.equal(
    selectFinalizationSource(f.store.state(), f.input.opportunityId, {}).status,
    'stale',
  );
});
