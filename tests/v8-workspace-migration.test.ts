import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { retainedOriginalReferences } from '../src/app/core/contract-file-recovery';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { harness } from './v4-harness';
import { WorkspaceStorage } from '../src/app/core/workspace-storage';
import { DemoState } from '../src/app/core/models';
import { BusinessForms } from '../src/app/core/forms';
import { DialogRequest } from '../src/app/core/models';

function setup(input?: DemoState, schemaVersion = 1) {
  const { store } = harness();
  if (input) store.state.set(structuredClone(input));
  const legacy = store.state();
  legacy.storageSchemaVersion = schemaVersion;
  legacy.dataVersion = 9;
  if (!input) legacy.contractFileVersions = undefined;
  if (!input) legacy.contractMilestones = undefined;
  if (!input) delete legacy.projects[0].plans[0].warningLeadDays;
  if (!input) delete legacy.projects[0].plans[0].budgetAmount;
  if (!input) delete legacy.projects[0].plans[0].budgetCurrency;
  const values = new Map<string, string>();
  let fail = '';
  let beforeWrite = (_key: string): boolean | void => {};
  let afterRead = (_key: string, raw: string | null) => raw;
  const storage = {
    get length() {
      return values.size;
    },
    key(index: number) {
      return [...values.keys()][index] || null;
    },
    getItem(key: string) {
      return afterRead(key, values.get(key) ?? null);
    },
    setItem(key: string, raw: string) {
      if (beforeWrite(key) === false) return;
      if (key === fail) throw new Error('QuotaExceededError');
      values.set(key, raw);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
  const workspaces = new WorkspaceStorage<DemoState>(
    storage,
    (v): v is DemoState => !!v && typeof v === 'object' && 'projects' in v,
  );
  const activated = workspaces.createAndActivateRound(legacy);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.assign(store, {
    workspaceStorage: workspaces,
    activeWorkspaceId: activated.workspaceId,
    activeSnapshotKey: activated.workspaceKey,
    contractOriginals: {
      async keys() {
        return [];
      },
    },
    workspaceRecoveryMessage: signal(''),
    v8MigrationMessage: signal(''),
    pendingOriginalCleanups: signal([]),
    originalRecoveryMessage: signal(''),
    editingWritable: signal(true),
  });
  const raw = values.get(activated.workspaceKey)!;
  return {
    store,
    legacy: structuredClone(legacy),
    values,
    raw,
    workspaces,
    ...activated,
    afterRead: (fn: typeof afterRead) => {
      afterRead = fn;
    },
    failAt: (key: string) => {
      fail = key;
    },
    beforeWrite: (fn: typeof beforeWrite) => {
      beforeWrite = fn;
    },
  };
}

test('公开迁移保留原工作区、ID、历史和财务，缺失值不补零，重复执行不生成副本', () => {
  const f = setup();
  assert.equal(f.store.migrateWorkspaceToV8(9), true);
  const state = f.store.state();
  assert.equal(state.storageSchemaVersion, 2);
  assert.equal(state.dataVersion, 10);
  assert.equal(f.workspaces.activeWorkspaceId(), f.workspaceId);
  assert.deepEqual(state.projects, f.legacy.projects);
  assert.deepEqual(state.contracts, f.legacy.contracts);
  assert.deepEqual(state.history, f.legacy.history);
  assert.deepEqual(state.financeSnapshots, f.legacy.financeSnapshots);
  assert.deepEqual(state.attachments, f.legacy.attachments);
  assert.deepEqual(state.contractFileVersions, []);
  const backups = [...f.values.entries()].filter(([key]) => key.includes('legacy-backup'));
  assert.equal(backups.length, 1);
  assert.equal(backups[0][1], f.raw);
  const migratedRaw = f.values.get(f.workspaceKey);
  assert.equal(f.store.migrateWorkspaceToV8(10), true);
  assert.equal(f.values.get(f.workspaceKey), migratedRaw);
  assert.equal([...f.values.keys()].filter((key) => key.includes('legacy-backup')).length, 1);
});

for (const fault of [
  'form-version',
  'persisted-version',
  'lease-before',
  'lease-after-backup',
  'backup-quota',
  'candidate-quota',
  'commit-quota',
  'candidate-readback',
  'workspace-switch',
]) {
  test(`迁移 ${fault} 失败保持旧发布快照、旧schema和业务历史`, () => {
    const f = setup();
    const before = structuredClone(f.store.state());
    if (fault === 'persisted-version')
      f.values.set(
        f.workspaceKey,
        JSON.stringify({
          formatVersion: 1,
          workspaceId: f.workspaceId,
          snapshot: { ...f.legacy, dataVersion: 10 },
        }),
      );
    let writable = fault !== 'lease-before';
    Object.assign(f.store, { editingLease: { owns: () => writable } });
    if (fault === 'commit-quota') f.failAt(f.workspaceKey);
    if (fault === 'candidate-readback')
      f.afterRead((key, raw) => (key.includes('migration-candidate') ? null : raw));
    f.beforeWrite((key) => {
      if (key.includes('legacy-backup') && fault === 'lease-after-backup') writable = false;
      if (key.includes('migration-candidate') && fault === 'candidate-quota')
        throw Error('候选容量不足');
      if (key.includes('migration-candidate') && fault === 'workspace-switch')
        f.values.set(f.workspaces.activePointerKey, 'OTHER');
      if (key.includes('legacy-backup') && fault === 'backup-quota') throw Error('备份容量不足');
    });
    const oldRaw = f.values.get(f.workspaceKey);
    assert.throws(
      () => f.store.migrateWorkspaceToV8(fault === 'form-version' ? 8 : 9),
      /版本|资格|修改权|失败/,
    );
    assert.deepEqual(f.store.state(), before);
    assert.equal(f.values.get(f.workspaceKey), oldRaw);
  });
}

for (const mode of ['write-then-throw', 'ignored-commit']) {
  test(`非标准存储适配器 ${mode} 不误报成功`, () => {
    const f = setup();
    const before = structuredClone(f.store.state());
    let once = true;
    f.beforeWrite((key) => {
      if (key === f.workspaceKey && once) {
        once = false;
        if (mode === 'write-then-throw') {
          const staged = [...f.values.entries()].find(([key]) =>
            key.includes('migration-candidate'),
          )![1];
          f.values.set(f.workspaceKey, staged);
          throw Error('写后报错');
        }
        return false;
      }
    });
    assert.throws(() => f.store.migrateWorkspaceToV8(9), /失败/);
    assert.deepEqual(f.store.state(), before);
    assert.equal(f.values.get(f.workspaceKey), f.raw);
  });
}

const legacySample = (): DemoState =>
  JSON.parse(readFileSync(new URL('./fixtures/v8-legacy-workspace.json', import.meta.url), 'utf8'));
test('受控旧样例：缺失与显式null、财务历史、模拟附件和付款来源冲突逐项保留', () => {
  const sample = legacySample(),
    f = setup(sample);
  assert.equal(f.store.migrateWorkspaceToV8(9), true);
  const migrated = f.store.state();
  assert.deepEqual(migrated.projects, sample.projects);
  assert.deepEqual(migrated.financeSnapshots, sample.financeSnapshots);
  assert.deepEqual(migrated.history, sample.history);
  assert.deepEqual(migrated.attachments, sample.attachments);
  assert.deepEqual(migrated.contracts, sample.contracts);
  assert.equal(migrated.paymentMethods![0].deliveryInFullPayment, null);
  assert.deepEqual(migrated.paymentMethods![0].crmFields, sample.paymentMethods![0].crmFields);
  assert.equal(migrated.paymentMethods![0].deliveryInFullPaymentNeedsReview, true);
  for (const relation of ['budget', 'warningLeadDays', 'quoteReference', 'deliveryInFullPayment'])
    assert(
      migrated.migrationReviewItems!.some((row) => row.relation === relation),
      relation,
    );
  assert.equal(migrated.contractFileVersions?.length, 0, '只有文件名的模拟资料不升级为真实原件');
  assert.equal(f.store.setDateMode('comparison'), true, '缺失值不阻断无关操作');
  assert.equal(f.store.state().storageSchemaVersion, 2, '普通保存不降级schema');
});

test('款清发货仅业务字段不存在时承接来源，嵌套优先且不改变来源原值', () => {
  const sample = legacySample();
  const method = sample.paymentMethods![0];
  delete (method as Partial<typeof method>).deliveryInFullPayment;
  const f = setup(sample);
  f.store.migrateWorkspaceToV8(9);
  assert.equal(f.store.state().paymentMethods![0].deliveryInFullPayment, '是');
  assert.equal(f.store.state().paymentMethods![0].deliveryInFullPaymentNeedsReview, true);
  assert.deepEqual(f.store.state().paymentMethods![0].crmFields, method.crmFields);
});

test('完整原字节备份及候选都被原件引用扫描保护，迁移不调用文件清理', () => {
  const sample = legacySample();
  // 旧历史引用不代表当前原件，但保留备份仍必须保护Blob。
  sample.operationEvents!.push({
    id: 'H-BLOB',
    roundId: sample.roundId!,
    mainlineId: 'OLD',
    module: 'OLD',
    department: 'OLD',
    objectType: 'contract',
    objectId: 'OLD',
    action: 'OLD',
    operator: '旧操作人',
    owner: '旧负责人',
    occurredAt: '2026-10-01',
    sourceVersion: 1,
    dataVersion: 2,
    location: {
      objectType: 'contract',
      objectId: 'OLD',
      module: 'OLD',
      department: 'OLD',
      section: 'OLD',
      action: 'OLD',
    },
    changes: [
      {
        field: 'oldOriginal',
        valueType: 'object',
        before: { blobId: 'BACKUP-ONLY-BLOB' },
        after: null,
      },
    ],
  });
  const f = setup(sample);
  f.store.migrateWorkspaceToV8(9);
  const storage = {
    get length() {
      return f.values.size;
    },
    key: (index: number) => [...f.values.keys()][index] || null,
    getItem: (key: string) => f.values.get(key) || null,
  };
  assert(retainedOriginalReferences(storage)?.has('BACKUP-ONLY-BLOB'));
  const backup = [...f.values.entries()].find(([key]) => key.includes('legacy-backup'))!;
  assert.equal(backup[1], f.raw);
});

test('公开重置直接提交V9统一新轮，schema3与持久快照一致，无需刷新二次迁移', async () => {
  const f = setup();
  f.store.migrateWorkspaceToV8(9);
  const beforeBackups = [...f.values.keys()].filter((key) => key.includes('legacy-backup')).length;
  assert.equal(await f.store.reset(), true);
  assert.equal(f.store.state().storageSchemaVersion, 3);
  assert.equal(f.workspaces.readActive()?.storageSchemaVersion, 3);
  assert.equal(f.store.dateMode(), 'normal');
  assert.equal(
    [...f.values.keys()].filter((key) => key.includes('legacy-backup')).length,
    beforeBackups,
  );
});

test('备份后同修订但原字节已变更时保留最新存储，不覆盖他人快照', () => {
  const f=setup();const before=structuredClone(f.store.state());
  const newer=JSON.stringify({formatVersion:1,workspaceId:f.workspaceId,snapshot:{...f.legacy,role:'pm'}});
  f.beforeWrite(key=>{if(key.includes('legacy-backup'))f.values.set(f.workspaceKey,newer);});
  assert.throws(()=>f.store.migrateWorkspaceToV8(9),/版本已变化/);
  assert.deepEqual(f.store.state(),before);assert.equal(f.values.get(f.workspaceKey),newer);
});

function legacyCountrySetup() {
  const { store } = harness();
  const state = structuredClone(store.state());
  state.projectWarningBackfillVersion = 1;
  state.customers[0].country = '德国';
  state.customers[1].country = '荷兰';
  state.customers[2].country = '未知历史国家';
  return setup(state, 2);
}

test('启动修复历史国家并升级V9后仍可跟随关联保存，原快照备份且历史不改', () => {
  const f = legacyCountrySetup();
  Reflect.get(f.store, 'tryMigrateWorkspaceToV8').call(f.store);
  const legacy: DemoState = JSON.parse(JSON.stringify(f.legacy));
  const expected = structuredClone(legacy);
  expected.customers[0].country = 'Germany';
  expected.customers[1].country = 'Netherlands';
  expected.dataVersion = 11;
  expected.storageSchemaVersion = 3;
  const {solutionWorkspaces, solutionLegacyAliases, ...existingFields} = f.store.state();
  assert.deepEqual(existingFields, expected, '国家修复与V9升级之外，原历史及业务字段保留');
  assert.ok(solutionWorkspaces?.length);
  assert.ok(solutionWorkspaces.every(w => w.firstFinalization === null));
  assert.ok(solutionLegacyAliases?.some(a => a.legacyType === 'solutionSeries' && a.status === 'resolved'));
  let dialog!: DialogRequest;
  const forms = Object.create(BusinessForms.prototype) as BusinessForms;
  Object.assign(forms, {
    store: f.store,
    router: { navigate() {} },
    ui: { open: (request: DialogRequest) => { dialog = request; }, fail: f.store.ui.fail },
  });
  forms.newLead();
  for (const customer of f.store.state().customers.slice(0, 2)) {
    assert.equal(dialog.onSave({
      customer: customer.name, existingCustomerId: customer.id,
      country: '__follow_linked_country__', project: '旧工作区国家修复回归',
      contact: '', email: '', owner: '', source: '自有开发', description: '',
    }), true);
    assert.equal(f.store.state().sales.at(-1)!.customerCountrySnapshot, customer.country);
  }
  assert.equal(f.store.state().customers[0].country, 'Germany');
  assert.equal(f.store.state().customers[1].country, 'Netherlands');
  assert.equal(f.store.state().customers[2].country, '未知历史国家');
  const beforeRejectedSave = structuredClone(f.store.state());
  assert.throws(() => dialog.onSave({
    customer: f.store.state().customers[2].name,
    existingCustomerId: f.store.state().customers[2].id,
    country: '__follow_linked_country__', contact: '', email: '',
  }), /关联客户的国家“未知历史国家”/);
  assert.deepEqual(f.store.state(), beforeRejectedSave);
  const backup = [...f.values.entries()].find(([key]) => key.includes('legacy-backup'));
  assert.equal(backup?.[1], f.raw);
  assert.deepEqual(f.store.state().sales.slice(0, legacy.sales.length), legacy.sales);
  assert.deepEqual(f.store.state().projects, legacy.projects);
  assert.deepEqual(f.store.state().contracts, legacy.contracts);
  const customers = structuredClone(legacy.customers);
  customers[0].country = 'Germany';
  customers[1].country = 'Netherlands';
  assert.deepEqual(f.store.state().customers, customers);
  const raw = f.values.get(f.workspaceKey);
  const size = f.values.size;
  Reflect.get(f.store, 'tryMigrateWorkspaceToV8').call(f.store);
  assert.equal(f.values.get(f.workspaceKey), raw);
  assert.equal(f.values.size, size, '重复启动不重复修复或备份');
});

test('历史国家写入失败后，现有重试升级入口能完成修复并清除提示', () => {
  const f = legacyCountrySetup();
  f.failAt(f.workspaceKey);
  Reflect.get(f.store, 'tryMigrateWorkspaceToV8').call(f.store);
  assert.ok(f.store.v8MigrationMessage());
  assert.equal(f.store.state().customers[0].country, '德国');
  f.failAt('');
  assert.equal(f.store.migrateWorkspaceToV8(9), true);
  assert.equal(f.store.state().customers[0].country, 'Germany');
  assert.equal(f.store.v8MigrationMessage(), '');
  assert.deepEqual(f.workspaces.readActive(), JSON.parse(JSON.stringify(f.store.state())));
});

for (const fault of ['readonly', 'backup', 'commit', 'lease-after-backup', 'persisted-version']) {
  test(`历史国家修复 ${fault} 时不发布候选或覆盖旧快照`, () => {
    const f = legacyCountrySetup();
    const before = structuredClone(f.store.state());
    let writable = fault !== 'readonly';
    Object.assign(f.store, { editingLease: { owns: () => writable } });
    if (fault === 'commit') f.failAt(f.workspaceKey);
    if (fault === 'persisted-version')
      f.values.set(f.workspaceKey, JSON.stringify({
        formatVersion: 1, workspaceId: f.workspaceId,
        snapshot: { ...f.legacy, dataVersion: 10 },
      }));
    f.beforeWrite((key) => {
      if (!key.includes('legacy-backup')) return;
      if (fault === 'backup') throw Error('备份容量不足');
      if (fault === 'lease-after-backup') writable = false;
    });
    const raw = f.values.get(f.workspaceKey);
    Reflect.get(f.store, 'tryMigrateWorkspaceToV8').call(f.store);
    assert.deepEqual(f.store.state(), before);
    assert.equal(f.values.get(f.workspaceKey), raw);
    if (fault !== 'readonly') assert.ok(f.store.v8MigrationMessage());
  });
}
