import { test } from 'node:test';
import { ContractFileOperations } from '../src/app/core/contract-file-history';
import { changedStartupSources } from '../src/app/core/project-startup';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { harness } from './v4-harness';
import { DemoStore } from '../src/app/core/store';
import {
  CONTRACT_ORIGINAL_MAX_BYTES,
  contractOriginalError,
  contractOriginalPreviewKind,
} from '../src/app/core/contract-originals';
import { ContractOriginalRecord } from '../src/app/core/contract-original-store';

function fakeBlobStore(
  behavior: { failStage?: boolean; failDiscard?: boolean; failPromote?: boolean } = {},
) {
  const map = new Map<string, ContractOriginalRecord>();
  return {
    map,
    async stage(record: ContractOriginalRecord) {
      if (behavior.failStage) throw new Error('原件暂存失败，未登记为有效版本');
      map.set(record.blobId, record);
    },
    async read(id: string) {
      return map.get(id) || null;
    },
    async promote(id: string) {
      if (behavior.failPromote) throw new Error('暂存原件转正失败');
      const record = map.get(id);
      if (record) map.set(id, { ...record, state: 'referenced' });
    },
    async discard(id: string) {
      if (behavior.failDiscard) throw new Error('暂存原件清理失败');
      map.delete(id);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

function fakeFile(name: string, type: string, bytes: number[]): File {
  const blob = new Blob([new Uint8Array(bytes)], { type });
  return Object.assign(blob, { name, lastModified: 0 }) as File;
}

async function bytes(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

function record0(blobId: string, contractId: string, content: number[]): ContractOriginalRecord {
  return {
    blob: fakeFile('合同.pdf', 'application/pdf', content),
    blobId,
    contractId,
    workspaceId: '',
    roundId: '',
    operationId: 'OP-FIXTURE',
    state: 'staged',
    stagedAt: '2026-10-16T00:00:00.000Z',
  };
}

function setup(
  behavior: { failStage?: boolean; failDiscard?: boolean; failPromote?: boolean } = {},
) {
  const { store } = harness();
  const blobs = fakeBlobStore(behavior);
  Object.assign(store, {
    contractOriginals: blobs,
    contractFileOperations: new ContractFileOperations(),
    editingWritable: signal(true),
    pendingOriginalCleanups: signal<{ blobId: string; contractId: string; markedAt: string }[]>([]),
  });
  const contractId = store.createContractDraft('DEMO-O003')!;
  return { store: store as DemoStore, blobs, contractId };
}

test('首次上传登记 V1 元数据与操作事件，真实字节可原样取回', async () => {
  const { store, blobs, contractId } = setup();
  const content = [37, 80, 68, 70, 45, 49, 46, 55, 10, 25, 231, 242];
  const ok = await store.replaceContractFile(
    contractId,
    fakeFile('销售合同-盖章版.pdf', 'application/pdf', content),
    { operationId: 'OP-UPLOAD-1' },
  );
  assert.equal(ok, true);
  const contract = store.contract(contractId)!;
  const version = store.contractFileVersion(contractId)!;
  assert.equal(contract.currentContractFileVersionId, version.id);
  assert.equal(version.version, 1);
  assert.equal(version.fileName, '销售合同-盖章版.pdf');
  assert.equal(version.mimeType, 'application/pdf');
  assert.equal(version.size, content.length);
  assert.equal(version.uploadedBy, '张销售');
  assert.equal(version.uploadedByPersonId, 'demo-person-sales-zhang');
  assert.equal(version.isRealOriginal, true);
  assert.ok(Number.isFinite(Date.parse(version.uploadedAt)));
  assert.equal(version.operationId, 'OP-UPLOAD-1');
  assert.equal(blobs.map.size, 1);
  const event = (store.state().operationEvents || []).find(
    (item) => item.action === '上传合同真实原件V1' && item.objectId === contractId,
  )!;
  assert.equal(event.module, 'contract-workspace');
  const result = await store.readContractOriginal(version.id);
  assert.ok(result.ok);
  assert.deepEqual(await bytes(result.blob), content);
});

test('拒绝不支持格式、空文件与超限文件，且不产生任何记录', async () => {
  const { store, contractId } = setup();
  const before = store.state().dataVersion || 1;
  await assert.rejects(
    store.replaceContractFile(contractId, fakeFile('说明.html', 'text/html', [60, 62])),
    /仅接受已配置的/,
  );
  await assert.rejects(
    store.replaceContractFile(contractId, fakeFile('图.svg', 'image/svg+xml', [60, 62])),
    /仅接受已配置的/,
  );
  await assert.rejects(
    store.replaceContractFile(contractId, fakeFile('空.pdf', 'application/pdf', [])),
    /文件为空/,
  );
  const oversized = {
    name: '大.pdf',
    type: 'application/pdf',
    size: CONTRACT_ORIGINAL_MAX_BYTES + 1,
  } as File;
  await assert.rejects(store.replaceContractFile(contractId, oversized), /20MiB/);
  assert.equal(store.state().dataVersion || 1, before);
  assert.equal((store.state().contractFileVersions || []).length, 0);
  assert.equal(store.contract(contractId)!.currentContractFileVersionId, undefined);
});

test('同名不同字节替换保留不可变旧版本，同一请求重试不追加版本', async () => {
  const { store, contractId } = setup();
  await store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [1, 2]), {
    operationId: 'OP-R',
  });
  const first = structuredClone(store.contractFileVersion(contractId)!);
  const contract = structuredClone(store.contract(contractId)!);
  const file = fakeFile('合同.pdf', 'application/pdf', [3, 4]);
  assert.equal(await store.replaceContractFile(contractId, file, { operationId: 'OP-NEW' }), true);
  assert.equal(await store.replaceContractFile(contractId, file, { operationId: 'OP-NEW' }), true);
  const history = store.contractFileHistory(contractId);
  assert.deepEqual(
    history.map((v) => v.version),
    [2, 1],
  );
  assert.deepEqual(history[1], first);
  assert.equal(history[0].previousVersionId, first.id);
  const old = await store.readContractOriginal(first.id);
  assert.ok(old.ok);
  assert.deepEqual(await bytes(old.blob), [1, 2]);
  const { currentContractFileVersionId: ignoredOld, ...before } = contract;
  const { currentContractFileVersionId: ignoredNew, ...after } = store.contract(contractId)!;
  assert.deepEqual(after, before);
});

test('同一操作并发只暂存一个版本，保存失败可以同操作重试', async () => {
  const { store, blobs, contractId } = setup();
  const file = fakeFile('合同.pdf', 'application/pdf', [1, 2]);
  const options = { operationId: 'OP-PARALLEL' };
  const results = await Promise.all([
    store.replaceContractFile(contractId, file, options),
    store.replaceContractFile(contractId, file, options),
  ]);
  assert.deepEqual(results, [true, true]);
  assert.equal(blobs.map.size, 1);
  assert.equal(store.contractFileHistory(contractId).length, 1);
});

test('替换快照失败时旧版本及字节保持，原操作修复后可重试', async () => {
  const { store, blobs, contractId } = setup();
  await store.replaceContractFile(contractId, fakeFile('同名.pdf', 'application/pdf', [1]));
  const first = structuredClone(store.contractFileVersion(contractId)!);
  const originalSet = localStorage.setItem;
  localStorage.setItem = () => {
    throw Error('替换快照失败');
  };
  try {
    await assert.rejects(
      store.replaceContractFile(contractId, fakeFile('同名.pdf', 'application/pdf', [2]), {
        operationId: 'RETRY-REPLACE',
      }),
      /替换快照失败/,
    );
  } finally {
    localStorage.setItem = originalSet;
  }
  assert.deepEqual(store.contractFileVersion(contractId), first);
  assert.equal(blobs.map.size, 1);
  assert.equal(
    await store.replaceContractFile(contractId, fakeFile('同名.pdf', 'application/pdf', [2]), {
      operationId: 'RETRY-REPLACE',
    }),
    true,
  );
  assert.equal(store.contractFileHistory(contractId).length, 2);
  const old = await store.readContractOriginal(first.id);
  assert.ok(old.ok);
  assert.deepEqual(await bytes(old.blob), [1]);
});

test('替换后启动门禁标识来源需复核，保留原提交确认与 G4', async () => {
  const { store, contractId } = setup();
  await store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [1]));
  const project = store.state().projects[0];
  project.contractId = contractId;
  const snapshot = Reflect.get(store, 'briefingSnapshot').call(store, project);
  project.briefing.submission = {
    version: 1,
    submittedBy: '张销售',
    submittedAt: new Date().toISOString(),
    opinion: '采用V1',
    snapshot,
  };
  project.briefing.confirmation = {
    version: 1,
    confirmedBy: '王项目',
    confirmedAt: new Date().toISOString(),
    opinion: '确认V1',
  };
  const before = structuredClone(project.briefing);
  assert.equal(store.startupGate(project.id).confirmationNeedsReview, false);
  await store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [2]));
  const current = store.project(project.id)!;
  assert.deepEqual(current.briefing, before);
  const gate = store.startupGate(project.id);
  assert.equal(gate.confirmationNeedsReview, true);
  assert.deepEqual(gate.changedSources, ['合同原件版本']);
  assert.equal(
    current.briefing.submission!.snapshot.contractFileVersionId,
    snapshot.contractFileVersionId,
  );
});

for (const boundary of ['workspace', 'round'] as const) {
  test(`暂存期间切换同修订${boundary}拒绝提交，清理暂存并保留原版本`, async () => {
    const { store, blobs, contractId } = setup();
    await store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [1]));
    const first = structuredClone(store.contractFileVersion(contractId)!);
    const originalStage = blobs.stage;
    let release!: () => void;
    let entered!: () => void;
    const staged = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    blobs.stage = async (record) => {
      await originalStage(record);
      entered();
      await gate;
    };
    const operation = store.replaceContractFile(
      contractId,
      fakeFile('合同.pdf', 'application/pdf', [2]),
    );
    await staged;
    if (boundary === 'workspace') Object.assign(store, { activeWorkspaceId: 'OTHER-WORKSPACE' });
    else store.state.set({ ...store.state(), roundId: 'OTHER-ROUND' });
    const before = structuredClone(store.state());
    release();
    await assert.rejects(operation, /修改权或数据版本已变化/);
    assert.deepEqual(store.state(), before);
    assert.deepEqual(store.contractFileVersion(contractId), first);
    assert.deepEqual(await blobs.keys(), [first.blobId]);
    const old = await store.readContractOriginal(first.id);
    assert.ok(old.ok);
    assert.deepEqual(await bytes(old.blob), [1]);
  });
}

test('旧确认依据不改写，原件版本变化可被启动来源规则识别；无原件旧快照兼容', () => {
  const recorded = { contractId: 'C1', contractFileVersionId: 'V1' };
  const unchanged = structuredClone(recorded);
  assert.deepEqual(changedStartupSources(recorded, { ...recorded, contractFileVersionId: 'V2' }), [
    '合同原件版本',
  ]);
  assert.deepEqual(recorded, unchanged);
  assert.deepEqual(
    changedStartupSources({ contractId: 'C1' }, { contractId: 'C1', contractFileVersionId: '' }),
    [],
  );
});

test('Blob 暂存失败不登记版本、不更新历史与数据版本', async () => {
  const { store, blobs, contractId } = setup({ failStage: true });
  const before = structuredClone(store.state());
  await assert.rejects(
    store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [1])),
    /暂存失败/,
  );
  assert.equal(store.state().dataVersion, before.dataVersion);
  assert.equal((store.state().contractFileVersions || []).length, 0);
  assert.equal(store.state().operationEvents?.length, before.operationEvents?.length);
  assert.equal(blobs.map.size, 0);
});

test('快照提交失败仅清理本次无引用暂存；清理失败标记为待处理', async () => {
  const { store, blobs, contractId } = setup({ failDiscard: true });
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = () => {
    throw new DOMException('验收容量失败', 'QuotaExceededError');
  };
  try {
    await assert.rejects(
      store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [9, 9])),
      /QuotaExceededError|验收容量失败/,
    );
  } finally {
    localStorage.setItem = originalSetItem;
  }
  assert.equal((store.state().contractFileVersions || []).length, 0);
  assert.equal(store.contract(contractId)!.currentContractFileVersionId, undefined);
  assert.equal(store.pendingOriginalCleanups().length, 1);
  assert.equal(store.pendingOriginalCleanups()[0].contractId, contractId);
  assert.equal(blobs.map.size, 1);
});

test('快照提交失败且暂存可清理时，Blob 库无残留', async () => {
  const { store, blobs, contractId } = setup();
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = () => {
    throw new DOMException('验收容量失败', 'QuotaExceededError');
  };
  try {
    await assert.rejects(
      store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [5])),
      /QuotaExceededError|验收容量失败/,
    );
  } finally {
    localStorage.setItem = originalSetItem;
  }
  assert.equal(blobs.map.size, 0);
  assert.equal(store.pendingOriginalCleanups().length, 0);
});

test('失去修改资格与数据版本变化均拒绝上传且不残留暂存', async () => {
  const { store, blobs, contractId } = setup();
  Object.assign(store, { storageInitializationFailed: true });
  await assert.rejects(
    store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [1])),
    /没有修改权/,
  );
  assert.equal(blobs.map.size, 0);
  Object.assign(store, { storageInitializationFailed: false });
  await assert.rejects(
    store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [1]), {
      expectedDataVersion: (store.state().dataVersion || 1) + 9,
    }),
    /数据已变化/,
  );
  assert.equal(blobs.map.size, 0);
  assert.equal((store.state().contractFileVersions || []).length, 0);
});

test('原件字节缺失明确报错，绝不按同名返回别的文件；归属不符同样阻止返回', async () => {
  const { store, blobs, contractId } = setup();
  const file = fakeFile('合同.pdf', 'application/pdf', [1, 2, 3]);
  assert.equal(await store.replaceContractFile(contractId, file), true);
  const version = store.contractFileVersion(contractId)!;
  blobs.map.clear();
  blobs.map.set('other-blob', record0('other-blob', contractId, [1, 2, 3]));
  const missing = await store.readContractOriginal(version.id);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /不会按同名返回其他文件/);
  blobs.map.set(version.blobId, record0(version.blobId, 'DEMO-CON-OTHER', [1, 2, 3]));
  const foreign = await store.readContractOriginal(version.id);
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.match(foreign.error, /归属不符/);
  blobs.map.set(version.blobId, record0(version.blobId, contractId, [1, 2, 3, 4]));
  const truncated = await store.readContractOriginal(version.id);
  assert.equal(truncated.ok, false);
  if (!truncated.ok) assert.match(truncated.error, /字节不完整/);
});

test('库内记录带归属与暂存态，快照成功后转正', async () => {
  const { store, blobs, contractId } = setup();
  assert.equal(
    await store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [7, 8])),
    true,
  );
  const version = store.contractFileVersion(contractId)!;
  const stored = blobs.map.get(version.blobId)!;
  assert.equal(stored.contractId, contractId);
  assert.equal(stored.blobId, version.blobId);
  assert.equal(stored.operationId, version.operationId);
  assert.equal(stored.workspaceId, version.workspaceId);
  assert.equal(stored.roundId, version.roundId);
  assert.equal(stored.state, 'referenced');
  assert.ok(stored.stagedAt);
});

test('参考快照提交返回失败时清理本次暂存并保持零登记（生产分支）', async () => {
  const { store, blobs, contractId } = setup();
  const original = store.commitOperation.bind(store);
  const eventsBefore = (store.state().operationEvents || []).length;
  store.commitOperation = () => false;
  try {
    assert.equal(
      await store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [3, 4])),
      false,
    );
  } finally {
    store.commitOperation = original;
  }
  assert.equal(blobs.map.size, 0);
  assert.equal((store.state().contractFileVersions || []).length, 0);
  assert.equal((store.state().operationEvents || []).length, eventsBefore);
  assert.equal(store.contract(contractId)!.currentContractFileVersionId, undefined);
});

test('转正失败不回退已提交版本，恢复以快照引用为事实', async () => {
  const { store, blobs, contractId } = setup({ failPromote: true });
  assert.equal(
    await store.replaceContractFile(contractId, fakeFile('合同.pdf', 'application/pdf', [5, 6])),
    true,
  );
  const version = store.contractFileVersion(contractId)!;
  assert.equal(store.contract(contractId)!.currentContractFileVersionId, version.id);
  const stored = blobs.map.get(version.blobId)!;
  assert.equal(stored.state, 'staged');
  assert.equal(stored.contractId, contractId);
  const result = await store.readContractOriginal(version.id);
  assert.ok(result.ok);
});

test('声明类型与扩展名不符时按已配置规则归一，落库类型不带 HTML/SVG', async () => {
  const { store, blobs, contractId } = setup();
  assert.equal(
    await store.replaceContractFile(
      contractId,
      fakeFile('冒名合同.pdf', 'text/html', [60, 104, 116, 109, 108, 62]),
    ),
    true,
  );
  const version = store.contractFileVersion(contractId)!;
  assert.equal(version.mimeType, 'application/pdf');
  assert.equal(blobs.map.get(version.blobId)!.blob.type, 'application/pdf');
  const result = await store.readContractOriginal(version.id);
  assert.ok(result.ok);
  assert.equal(result.blob.type, 'application/pdf');
  assert.equal(contractOriginalPreviewKind(result.blob.type), 'pdf');
});

test('旧模拟附件保持无原件标识；未上传合同无原件版本', async () => {
  const { store, contractId } = setup();
  assert.equal(store.contractFileVersion(contractId), undefined);
  const opportunityId = store.contract(contractId)!.opportunityId;
  assert.equal(
    store.simulateDocument(opportunityId, '合同扫描件', '演示_合同扫描件.pdf', '历史模拟'),
    true,
  );
  const legacy = store.contractLegacyAttachments(contractId).filter((x) => x.kind === '合同扫描件');
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].mode, 'simulated');
  assert.equal(store.contractFileVersion(contractId), undefined);
  assert.equal(store.contract(contractId)!.currentContractFileVersionId, undefined);
});

test('格式校验与受限预览分类', () => {
  assert.equal(contractOriginalError({ name: 'a.pdf', size: 1, type: 'application/pdf' }), null);
  assert.equal(contractOriginalError({ name: 'a.DOCX', size: 1, type: '' }), null);
  assert.equal(contractOriginalError({ name: 'a.jpeg', size: 1, type: 'image/jpeg' }), null);
  assert.match(contractOriginalError({ name: 'a.png', size: 0, type: 'image/png' })!, /为空/);
  assert.equal(contractOriginalPreviewKind('application/pdf'), 'pdf');
  assert.equal(contractOriginalPreviewKind('image/png'), 'image');
  assert.equal(contractOriginalPreviewKind('image/jpeg'), 'image');
  assert.equal(
    contractOriginalPreviewKind(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ),
    'download',
  );
  assert.equal(contractOriginalPreviewKind('text/html'), 'download');
});
