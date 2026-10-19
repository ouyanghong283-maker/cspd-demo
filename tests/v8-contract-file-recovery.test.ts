import '@angular/compiler';
import { signal } from '@angular/core';
import { harness } from './v4-harness';
import { WorkspaceStorage } from '../src/app/core/workspace-storage';
import { ContractFileOperations } from '../src/app/core/contract-file-history';
import { DemoState } from '../src/app/core/models';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverContractOriginals } from '../src/app/core/contract-file-recovery';
import { ContractOriginalRecord } from '../src/app/core/contract-original-store';

const record = (blobId: string): ContractOriginalRecord => ({
  blobId,
  blob: new Blob(['pdf']),
  contractId: 'C1',
  workspaceId: 'W1',
  roundId: 'R1',
  operationId: blobId,
  state: 'staged',
  stagedAt: '2026-10-16T00:00:00Z',
});
function fixture() {
  const rows = new Map(['committed', 'orphan', 'other', 'unknown'].map((id) => [id, record(id)]));
  rows.get('other')!.workspaceId = 'W2';
  rows.get('unknown')!.roundId = '';
  const raw = new Map([
    [
      'cspd-demo:v7:workspace:W1',
      JSON.stringify({ snapshot: { contractFileVersions: [{ blobId: 'committed' }] } }),
    ],
  ]);
  const blobs = {
    async keys() {
      return [...rows.keys()];
    },
    async read(id: string) {
      return rows.get(id) || null;
    },
    async stage(r: ContractOriginalRecord) {
      rows.set(r.blobId, r);
    },
    async promote(id: string) {
      rows.get(id)!.state = 'referenced';
    },
    async discard(id: string, guard?: () => boolean) {
      if (guard && !guard()) throw Error('guard');
      rows.delete(id);
    },
  };
  const storage = {
    get length() {
      return raw.size;
    },
    key(i: number) {
      return [...raw.keys()][i] || null;
    },
    getItem(key: string) {
      return raw.get(key) ?? null;
    },
  };
  return { rows, raw, blobs, storage };
}
test('重开按保留快照恢复已引用暂存，只回收本工作区明确归属的孤立暂存', async () => {
  const { rows, blobs, storage } = fixture();
  const result = await recoverContractOriginals({
    blobs,
    storage,
    workspaceId: 'W1',
    roundId: 'R1',
    canMutate: () => true,
    liveReferences: () => [],
    inFlight: () => false,
  });
  assert.equal(rows.get('committed')!.state, 'referenced');
  assert.equal(rows.has('orphan'), false);
  assert.equal(rows.has('other'), true);
  assert.equal(rows.has('unknown'), true);
  assert.deepEqual(result.deleted, ['orphan']);
});

test('原文备份、历史及其他工作区引用均保护本轮文件；损坏备份保守停止删除', async () => {
  const f = fixture();
  f.raw.set(
    'cspd-demo:v7:legacy-backup:raw',
    JSON.stringify({ operationEvents: [{ changes: [{ before: { blobId: 'orphan' } }] }] }),
  );
  await recoverContractOriginals({
    ...f,
    workspaceId: 'W1',
    roundId: 'R1',
    canMutate: () => true,
    liveReferences: () => [],
    inFlight: () => false,
  });
  assert.equal(f.rows.has('orphan'), true);
  f.raw.set('cspd-demo:v7:legacy-backup:raw', '{broken');
  f.rows.set('new-orphan', record('new-orphan'));
  const result = await recoverContractOriginals({
    ...f,
    workspaceId: 'W1',
    roundId: 'R1',
    canMutate: () => true,
    liveReferences: () => [],
    inFlight: () => false,
  });
  assert.equal(result.blocked, true);
  assert.equal(f.rows.has('new-orphan'), true);
});
test('等待原件读取期间租约失效或新增备份引用不删除，上传在途对象不清理', async () => {
  for (const mutation of ['lease', 'backup', 'upload']) {
    const f = fixture();
    let writable = true;
    const read = f.blobs.read;
    f.blobs.read = async (id) => {
      const row = await read(id);
      if (id === 'orphan') {
        if (mutation === 'lease') writable = false;
        if (mutation === 'backup')
          f.raw.set('cspd-demo:v7:legacy-backup:new', JSON.stringify({ blobId: 'orphan' }));
      }
      return row;
    };
    await recoverContractOriginals({
      ...f,
      workspaceId: 'W1',
      roundId: 'R1',
      canMutate: () => writable,
      liveReferences: () => [],
      inFlight: (id) => mutation === 'upload' && id === 'orphan',
    });
    assert.equal(f.rows.has('orphan'), true, mutation);
  }
});
test('普通恢复保留已转正历史；重置定向回收仅无保留引用对象，清理失败返回待处理', async () => {
  const f = fixture();
  f.rows.get('orphan')!.state = 'referenced';
  const context = {
    ...f,
    workspaceId: 'W1',
    roundId: 'R1',
    canMutate: () => true,
    liveReferences: () => [],
    inFlight: () => false,
  };
  await recoverContractOriginals(context);
  assert.equal(f.rows.has('orphan'), true);
  const discard = f.blobs.discard;
  f.blobs.discard = async () => {
    throw Error('IDB failure');
  };
  const failed = await recoverContractOriginals({ ...context, includeUnreferencedHistory: true });
  assert.deepEqual(failed.pending, [{ blobId: 'orphan', contractId: 'C1' }]);
  assert.equal(f.rows.has('orphan'), true);
  f.blobs.discard = discard;
  await recoverContractOriginals({ ...context, includeUnreferencedHistory: true });
  assert.equal(f.rows.has('orphan'), false);
  assert.equal(f.rows.has('committed'), true);
});

test('文件库连接延迟后删除事务复核新增备份，corrupt-backup无法解析时停止回收', async () => {
  const f = fixture();
  const discard = f.blobs.discard;
  f.blobs.discard = async (id, guard) => {
    await Promise.resolve();
    f.raw.set('cspd-demo-v2-corrupt-backup-1', JSON.stringify({ blobId: id }));
    await discard(id, guard);
  };
  const context = {
    ...f,
    workspaceId: 'W1',
    roundId: 'R1',
    canMutate: () => true,
    liveReferences: () => [],
    inFlight: () => false,
  };
  await recoverContractOriginals(context);
  assert.equal(f.rows.has('orphan'), true);
  f.raw.set('cspd-demo-v2-corrupt-backup-1', 'broken');
  assert.equal((await recoverContractOriginals(context)).blocked, true);
});

function storeFixture() {
  const { store } = harness();
  const f = fixture();
  store.state.update((s) => ({ ...s, roundId: 'R1', dateMode: 'comparison' }));
  const storage = {
    ...f.storage,
    get length() {
      return f.raw.size;
    },
    setItem(key: string, value: string) {
      f.raw.set(key, value);
    },
    removeItem(key: string) {
      f.raw.delete(key);
    },
  };
  f.raw.set(
    'cspd-demo:v7:workspace:W1',
    JSON.stringify({ formatVersion: 1, workspaceId: 'W1', snapshot: store.state() }),
  );
  f.raw.set('cspd-demo:v7:active-workspace', 'W1');
  f.raw.set('cspd-demo:v7:workspace-index', '["W1"]');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.assign(store, {
    contractOriginals: f.blobs,
    contractFileOperations: new ContractFileOperations(),
    activeWorkspaceId: 'W1',
    activeSnapshotKey: 'cspd-demo:v7:workspace:W1',
    workspaceStorage: new WorkspaceStorage<DemoState>(
      storage,
      (v): v is DemoState => !!v,
      () => 'WNEW',
    ),
    pendingOriginalCleanups: signal([]),
    originalRecoveryMessage: signal(''),
    originalUploadsInFlight: new Set(),
  });
  return { ...f, store, storage };
}
test('公开Store重置失败保留旧轮原件；成功发布normal新轮后清理失败只显示待处理', async () => {
  const f = storeFixture();
  const before = JSON.stringify(f.store.state());
  const set = f.storage.setItem;
  f.storage.setItem = () => {
    throw Error('quota');
  };
  await assert.rejects(f.store.reset(), /候选工作区写入失败/);
  assert.equal(JSON.stringify(f.store.state()), before);
  assert.equal(f.rows.has('orphan'), true);
  f.storage.setItem = set;
  f.blobs.discard = async () => {
    throw Error('IDB cleanup failure');
  };
  assert.equal(await f.store.reset(), true);
  assert.equal(f.store.dateMode(), 'normal');
  assert.notEqual(f.store.state().roundId, 'R1');
  assert.equal(f.rows.has('orphan'), true);
  assert.equal(f.store.pendingOriginalCleanups().length, 2);
  assert.match(f.store.originalRecoveryMessage(), /未完成/);
  assert.equal(f.raw.has('cspd-demo:v7:workspace:W1'), true);
  f.blobs.discard = async (id, guard) => {
    if (guard && !guard()) throw Error('guard');
    f.rows.delete(id);
  };
  await f.store.recoverContractFiles();
  assert.equal(f.store.pendingOriginalCleanups().length, 0);
  assert.equal(f.rows.has('orphan'), false);
});
test('公开Store恢复执行时上传被阻止，上传排队时重置被阻止', async () => {
  const f = storeFixture();
  const keys = f.blobs.keys;
  let release!: () => void;
  f.blobs.keys = async () => {
    await new Promise<void>((r) => (release = r));
    return keys();
  };
  const recovery = f.store.recoverContractFiles();
  await assert.rejects(
    async () => f.store.replaceContractFile('C1', new File(['x'], 'x.pdf')),
    /正在复核/,
  );
  release();
  await recovery;
  const contract = f.store.createContractDraft('DEMO-O003')!;
  // createContractDraft writes active snapshot; no attachment write may overlap reset.
  const upload = f.store.replaceContractFile(
    contract,
    new File(['pdf'], 'x.pdf', { type: 'application/pdf' }),
  );
  await assert.rejects(f.store.reset(), /原件正在保存或复核/);
  await upload;
});
test('当前工作区恢复不能从全局旧pending擅自取得其他工作区已转正文件的删除授权', async () => {
  const f = storeFixture();
  f.rows.set('foreign-pending', {
    ...record('foreign-pending'),
    workspaceId: 'W2',
    roundId: 'R2',
    state: 'referenced',
  });
  f.store.pendingOriginalCleanups.set([
    { blobId: 'foreign-pending', contractId: 'C1', markedAt: 'old' },
  ]);
  await f.store.recoverContractFiles();
  assert.equal(f.rows.has('foreign-pending'), true);
  assert.equal(
    f.store.pendingOriginalCleanups().some((p) => p.blobId === 'foreign-pending'),
    true,
  );
});
