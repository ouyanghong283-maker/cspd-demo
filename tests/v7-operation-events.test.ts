import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoState } from '../src/app/core/models';
import { harness } from './v4-harness';

test('商机字段变更与统一操作事件同快照保存，刷新后可恢复', () => {
  const { store } = harness();
  const opportunity = structuredClone(store.sale('DEMO-O001')!);
  const originalOwner = opportunity.owner;
  const sourceVersion = store.state().dataVersion || 1;
  let saved = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem: (_key: string, value: string) => {
        saved = value;
      },
      getItem: () => saved || null,
    },
  });

  assert.equal(store.saveSales({ ...opportunity, description: 'V7 操作事件闭环验证' }), true);

  const persisted = JSON.parse(saved) as DemoState;
  const event = persisted.operationEvents?.find((item) => item.objectId === opportunity.id);
  assert.ok(event);
  assert.equal(persisted.sales.find((item) => item.id === opportunity.id)?.description, 'V7 操作事件闭环验证');
  assert.equal(event.roundId, persisted.roundId);
  assert.equal(event.mainlineId, opportunity.leadId || opportunity.id);
  assert.equal(event.module, '商机');
  assert.equal(event.department, '销售');
  assert.equal(event.objectType, 'opportunity');
  assert.equal(event.operator, '张销售');
  assert.equal(event.owner, originalOwner);
  assert.ok(Number.isFinite(Date.parse(event.occurredAt)));
  assert.equal(event.sourceVersion, sourceVersion);
  assert.equal(event.dataVersion, sourceVersion + 1);
  assert.deepEqual(event.location, {
    objectType: 'opportunity',
    objectId: opportunity.id,
    module: '商机',
    department: '销售',
    section: '商机信息',
    action: '修改业务信息',
  });
  assert.deepEqual(event.changes, [
    {
      field: 'description',
      valueType: 'string',
      before: opportunity.description,
      after: 'V7 操作事件闭环验证',
    },
  ]);

  const load = Reflect.get(store, 'load').bind(store) as () => DemoState;
  const refreshed = load();
  assert.deepEqual(refreshed, persisted);
});

test('商机空保存不增加操作事件、旧历史或数据版本', () => {
  const { store } = harness();
  const opportunity = structuredClone(store.sale('DEMO-O001')!);
  const before = structuredClone(store.state());
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem: () => writes++,
      getItem: () => null,
    },
  });

  assert.equal(store.saveSales(opportunity), true);
  assert.equal(writes, 0);
  assert.deepEqual(store.state(), before);
});

test('商机快照写入失败时业务、历史和结构化事件均不发布', () => {
  const { store } = harness();
  const opportunity = structuredClone(store.sale('DEMO-O001')!);
  const before = structuredClone(store.state());
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem: () => {
        throw new Error('存储容量不足');
      },
      getItem: () => null,
    },
  });

  assert.throws(
    () => store.saveSales({ ...opportunity, description: '不应发布的修改' }),
    /存储容量不足/,
  );
  assert.deepEqual(store.state(), before);
});

test('当前主线和唯一关联项目写入工作区并可刷新恢复', () => {
  const { store } = harness();
  let saved = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem: (_key: string, value: string) => { saved = value; },
      getItem: () => saved || null,
    },
  });
  const opportunity = store.state().sales.find((item) => item.type === 'opportunity');
  assert.ok(opportunity);

  assert.equal(store.setRoundContext(opportunity.id), true);
  assert.equal(store.state().selectedMainlineId, opportunity.id);
  const relatedProjects = store.state().projects.filter((item) => item.opportunityId === opportunity.id);
  if (relatedProjects.length === 1) assert.equal(store.state().selectedProjectId, relatedProjects[0].id);

  const load = Reflect.get(store, 'load').bind(store) as () => DemoState;
  const refreshed = load();
  assert.equal(refreshed.selectedMainlineId, opportunity.id);
  assert.equal(refreshed.selectedProjectId, relatedProjects.length === 1 ? relatedProjects[0].id : undefined);
});

test('退役的水单认领提交入口不写入认领、发票累计来源或操作事件', () => {
  const { store } = harness();
  let saved = '';
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem: (_key: string, value: string) => { saved = value; writes += 1; },
      getItem: () => saved || null,
    },
  });
  const invoice = store.state().contractInvoices?.[0];
  assert.ok(invoice);
  const contract = store.contract(invoice.contractId);
  assert.ok(contract);
  const order = {
    id: 'TEST-ORDER-RECEIPT', contractId: contract.id, orderNumber: 'TEST-ORDER',
    currency: invoice.currency, amount: 100, status: '有效', revision: 1,
    createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', owner: '财务',
  };
  store.state().orders = [order];
  const receipt = {
    id: 'TEST-RECEIPT', number: 'TEST-RECEIPT', contractId: contract.id,
    amount: 50, currency: invoice.currency, status: '有效' as const,
  };
  const line = {
    id: 'TEST-CLAIM-LINE', receiptId: receipt.id, orderId: order.id,
    invoiceId: invoice.id, amount: 25, currency: invoice.currency, status: '有效' as const,
  };
  const beforeRetiredSave = structuredClone(store.state());

  assert.throws(() => store.saveBankReceiptClaim(receipt, [line]), /已停用/);

  assert.deepEqual(store.state(), beforeRetiredSave);
  assert.equal(writes, 0, '退役入口不得写入本地工作区');
  assert.equal(saved, '');
  assert.equal(store.bankReceiptClaims(contract.id).length, 0);
  assert.equal(store.bankReceiptClaimLines(receipt.id).length, 0);
  assert.deepEqual(store.operationEvents(receipt.id), []);
  assert.equal(
    store.state().contractInvoices?.find((item) => item.id === invoice.id)?.cumulativeSource,
    invoice.cumulativeSource,
  );
});
