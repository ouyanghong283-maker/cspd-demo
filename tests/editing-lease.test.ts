import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { EditingLease } from '../src/app/core/editing-lease';
import { DemoState } from '../src/app/core/models';
import { harness } from './v4-harness';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test('同一工作区只允许一个标签页持有修改资格', () => {
  const storage = new MemoryStorage();
  const first = new EditingLease(storage, 'tab-one', () => 1000, 5000);
  const second = new EditingLease(storage, 'tab-two', () => 1000, 5000);

  assert.equal(first.acquire(), true);
  assert.equal(second.acquire(), false);
  assert.equal(first.owns(), true);
  assert.equal(second.owns(), false);
});

test('显式接管使旧标签页无法继续保存', () => {
  const storage = new MemoryStorage();
  const first = new EditingLease(storage, 'tab-one', () => 1000, 5000);
  const second = new EditingLease(storage, 'tab-two', () => 1000, 5000);
  assert.equal(first.acquire(), true);
  assert.equal(second.takeOver(), true);
  assert.equal(first.owns(), false);
  assert.equal(second.owns(), true);
});

test('标签页关闭后可接管，异常退出后租约过期可恢复', () => {
  const storage = new MemoryStorage();
  let now = 1000;
  const first = new EditingLease(storage, 'tab-one', () => now, 5000);
  const second = new EditingLease(storage, 'tab-two', () => now, 5000);
  assert.equal(first.acquire(), true);
  assert.equal(second.acquire(), false);
  first.release();
  assert.equal(second.acquire(), true);

  const crashed = new EditingLease(storage, 'tab-three', () => now, 5000);
  assert.equal(crashed.takeOver(), true);
  now += 5001;
  const recovered = new EditingLease(storage, 'tab-four', () => now, 5000);
  assert.equal(recovered.acquire(), true);
  assert.equal(crashed.owns(), false);
});

test('心跳只能续租当前标签页持有的修改资格', () => {
  const storage = new MemoryStorage();
  let now = 1000;
  const first = new EditingLease(storage, 'tab-one', () => now, 5000);
  const second = new EditingLease(storage, 'tab-two', () => now, 5000);
  assert.equal(first.acquire(), true);
  now += 4000;
  assert.equal(first.renew(), true);
  now += 4000;
  assert.equal(first.owns(), true);
  assert.equal(second.acquire(), false);
  assert.equal(second.takeOver(), true);
  assert.equal(first.renew(), false);
});

test('失去修改资格的页面不能保存商机或重置工作区', async () => {
  const { store } = harness();
  const storage = new MemoryStorage();
  const otherTab = new EditingLease(storage, 'active-tab', () => 1000, 5000);
  assert.equal(otherTab.acquire(), true);
  Object.assign(store, {
    editingLease: new EditingLease(storage, 'stale-tab', () => 1000, 5000),
    editingWritable: signal(false),
  });
  const before = structuredClone(store.state());
  const opportunity = structuredClone(store.sale('DEMO-O001')!);

  assert.throws(
    () => store.saveSales({ ...opportunity, description: '旧标签页不应提交' }),
    /没有修改权/,
  );
  await assert.rejects(() => store.reset(), /没有修改权/);
  assert.deepEqual(store.state(), before);
});

test('只读页面兼容旧快照但不在初始化时写回存储', () => {
  const { store } = harness();
  const storage = new MemoryStorage();
  const activeTab = new EditingLease(storage, 'active-tab', () => 1000, 5000);
  assert.equal(activeTab.acquire(), true);
  Object.assign(store, {
    editingLease: new EditingLease(storage, 'stale-tab', () => 1000, 5000),
    editingWritable: signal(false),
  });
  const legacy = structuredClone(store.state());
  legacy.dataVersion = undefined;
  legacy.roundId = undefined;
  legacy.operationEvents = undefined;
  legacy.quoteSchemaVersion = undefined;
  const original = JSON.stringify(legacy);
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => original,
      setItem: () => writes++,
    },
  });

  const load = Reflect.get(store, 'load').bind(store) as () => DemoState;
  const loaded = load();
  assert.equal(loaded.dataVersion, 1);
  assert.ok(loaded.roundId);
  assert.equal(writes, 0);
  assert.equal(original, JSON.stringify(legacy));
});
