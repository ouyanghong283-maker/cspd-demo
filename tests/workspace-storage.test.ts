import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkspaceStorage,
  WorkspaceStorageError,
} from '../src/app/core/workspace-storage';

interface Snapshot {
  schema: number;
  roundId: string;
  records: string[];
}

class MemoryStorage {
  values = new Map<string, string>();
  writes: string[] = [];
  failSet = new Set<string>();
  failAfterSet = new Set<string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes.push(key);
    if (this.failSet.has(key)) throw new Error(`写入失败：${key}`);
    this.values.set(key, value);
    if (this.failAfterSet.has(key)) {
      this.failAfterSet.delete(key);
      throw new Error(`写入后失败：${key}`);
    }
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function fixture(storage = new MemoryStorage()) {
  let nextId = 0;
  const workspaces = new WorkspaceStorage<Snapshot>(
    storage,
    (value): value is Snapshot =>
      typeof value === 'object' &&
      value !== null &&
      'schema' in value &&
      value.schema === 7 &&
      'roundId' in value &&
      typeof value.roundId === 'string' &&
      'records' in value &&
      Array.isArray(value.records),
    () => `id-${++nextId}`,
  );
  return { storage, workspaces };
}

const oldRaw = '{ "version": 2, "id": "legacy-id", "source": "原样保留" }';
const migrated: Snapshot = { schema: 7, roundId: 'round-old', records: ['legacy-id'] };

test('旧数据原文备份、候选回读校验后才最后切换活动工作区', () => {
  const { storage, workspaces } = fixture();

  const result = workspaces.migrateLegacy(oldRaw, migrated);

  assert.equal(storage.getItem(result.backupKey), oldRaw);
  assert.deepEqual(workspaces.readActive(), migrated);
  assert.equal(storage.writes.at(-1), workspaces.activePointerKey);
  assert.ok(storage.writes.indexOf(result.backupKey) < storage.writes.indexOf(result.workspaceKey));
  assert.ok(storage.writes.indexOf(result.workspaceKey) < storage.writes.indexOf(workspaces.activePointerKey));
});

test('备份写入失败时保留旧原文和活动指针，不写候选', () => {
  const storage = new MemoryStorage();
  const { workspaces } = fixture(storage);
  storage.values.set(workspaces.activePointerKey, 'previous-workspace');
  storage.values.set(workspaces.workspaceKey('previous-workspace'), JSON.stringify({
    workspaceId: 'previous-workspace', snapshot: migrated,
  }));
  const oldPointer = storage.getItem(workspaces.activePointerKey);
  storage.failSet.add(workspaces.backupKey('id-1'));

  assert.throws(() => workspaces.migrateLegacy(oldRaw, migrated), WorkspaceStorageError);

  assert.equal(storage.getItem(workspaces.activePointerKey), oldPointer);
  assert.equal(storage.getItem(workspaces.backupKey('id-1')), null);
  assert.equal(storage.getItem(workspaces.workspaceKey('id-2')), null);
});

test('候选写入或回读验证失败时不切换活动指针并保留源快照', () => {
  const storage = new MemoryStorage();
  const { workspaces } = fixture(storage);
  storage.values.set(workspaces.activePointerKey, 'previous-workspace');
  storage.values.set(workspaces.workspaceKey('previous-workspace'), JSON.stringify({
    workspaceId: 'previous-workspace', snapshot: migrated,
  }));
  const oldPointer = storage.getItem(workspaces.activePointerKey);
  storage.failSet.add(workspaces.workspaceKey('id-2'));

  assert.throws(() => workspaces.migrateLegacy(oldRaw, migrated), WorkspaceStorageError);
  assert.equal(storage.getItem(workspaces.activePointerKey), oldPointer);
  assert.equal(storage.getItem(workspaces.backupKey('id-1')), oldRaw);

  const invalidStorage = new MemoryStorage();
  const invalid = fixture(invalidStorage).workspaces;
  assert.throws(
    () => invalid.migrateLegacy(oldRaw, { ...migrated, schema: 6 }),
    WorkspaceStorageError,
  );
  assert.equal(invalidStorage.getItem(invalid.activePointerKey), null);
  assert.equal(invalidStorage.getItem(invalid.backupKey('id-1')), oldRaw);
  assert.equal(invalidStorage.getItem(invalid.workspaceKey('id-2')), null);
});

test('激活指针写入失败会尽力恢复原指针，且不删除已写入的候选孤儿', () => {
  const storage = new MemoryStorage();
  const { workspaces } = fixture(storage);
  storage.values.set(workspaces.activePointerKey, 'previous-workspace');
  storage.failAfterSet.add(workspaces.activePointerKey);

  assert.throws(() => workspaces.createAndActivateRound(migrated), WorkspaceStorageError);

  assert.equal(storage.getItem(workspaces.activePointerKey), 'previous-workspace');
  assert.ok(storage.getItem(workspaces.workspaceKey('id-1')));
});

test('创建并激活新轮成功后保留旧工作区快照；失败时旧活动工作区不变', () => {
  const storage = new MemoryStorage();
  const { workspaces } = fixture(storage);
  const first = workspaces.createAndActivateRound(migrated);
  const nextRound: Snapshot = { schema: 7, roundId: 'round-next', records: [] };

  const second = workspaces.createAndActivateRound(nextRound);

  assert.equal(workspaces.readActive()?.roundId, 'round-next');
  assert.deepEqual(workspaces.readWorkspace(first.workspaceId), migrated);
  assert.deepEqual(workspaces.readWorkspace(second.workspaceId), nextRound);
  assert.deepEqual(workspaces.workspaceIds(), [first.workspaceId, second.workspaceId]);
  workspaces.activateWorkspace(first.workspaceId);
  assert.equal(workspaces.readActive()?.roundId, 'round-old');

  workspaces.activateWorkspace(second.workspaceId);
  storage.failAfterSet.add(workspaces.activePointerKey);
  assert.throws(() => workspaces.createAndActivateRound(migrated), WorkspaceStorageError);
  assert.equal(workspaces.readActive()?.roundId, 'round-next');
  assert.ok(storage.getItem(workspaces.workspaceKey('id-3')));
});
