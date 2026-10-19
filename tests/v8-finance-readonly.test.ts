import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { createSeed } from '../src/app/core/seed';
import {
  ContractInvoice,
  migrateContractInvoices,
  summarizeInvoicesByCurrency,
  uniqueInvoicesById,
} from '../src/app/core/invoices';
import { collectDemoFinanceSummaries } from '../src/app/core/work-item-sources';

const eurShared: ContractInvoice = {
  id: 'INV-SHARED',
  number: 'INV-SHARED-EUR',
  contractId: 'CON-1',
  projectIds: ['DEMO-P001', 'DEMO-P002'],
  amount: 100.1,
  received: 0.1,
  currency: 'EUR',
  issued: '2026-10-01',
  due: '2026-11-01',
  revision: 1,
  updatedAt: '2026-10-15T00:00:00.000Z',
  cumulativeSource: 'legacy-simulation',
};

const cnySingle: ContractInvoice = {
  ...eurShared,
  id: 'INV-CNY',
  number: 'INV-CNY-001',
  projectIds: ['DEMO-P002'],
  amount: 200,
  received: 50,
  currency: 'CNY',
  updatedAt: '2026-10-14T00:00:00.000Z',
};

test('多项目重复引用同一发票ID时按记录ID去重，不同币种分别汇总', () => {
  const totals = summarizeInvoicesByCurrency(
    [eurShared, cnySingle, { ...eurShared }, { ...eurShared, amount: 999 }],
    [],
    '2026-10-16',
  );

  assert.deepEqual(totals, [
    { currency: 'EUR', amount: 100.1, received: 0.1, balance: 100, invoiceCount: 1 },
    { currency: 'CNY', amount: 200, received: 50, balance: 150, invoiceCount: 1 },
  ]);
  assert.deepEqual(
    uniqueInvoicesById([eurShared, { ...eurShared, amount: 999 }, cnySingle]).map((invoice) => [
      invoice.id,
      invoice.amount,
    ]),
    [
      ['INV-SHARED', 100.1],
      ['INV-CNY', 200],
    ],
  );
});

test('同一发票被多项目引用时各项目只读一次，跨项目汇总不重复统计', () => {
  const { store } = harness();
  store.state.update((state) => ({
    ...state,
    contractInvoices: [eurShared, cnySingle],
    financeSnapshots: [],
    invoiceReceiptClaims: [],
    migrationReviewItems: [],
  }));

  const readProject = (projectId: string) =>
    store.invoicesForProject(projectId).map((invoice) => invoice.id);
  assert.deepEqual(readProject('DEMO-P001'), ['INV-SHARED']);
  assert.deepEqual(readProject('DEMO-P002'), ['INV-SHARED', 'INV-CNY']);
  assert.deepEqual(readProject('DEMO-P003'), []);
  assert.deepEqual(
    store.invoicesForProject('DEMO-P002').map((invoice) => invoice.projectIds),
    [eurShared.projectIds, cnySingle.projectIds],
  );
  assert.deepEqual(collectDemoFinanceSummaries(store.state()), [
    {
      status: 'available',
      sourceId: 'contract-invoices',
      balances: [
        { currency: 'EUR', amount: 100 },
        { currency: 'CNY', amount: 150 },
      ],
      asOf: '2026-10-15T00:00:00.000Z',
    },
  ]);
});

test('主记录缺失的旧快照行保留待核，不重建应收也不生成新发票ID', () => {
  const state = createSeed();
  const snapshot = state.financeSnapshots![0];
  const legacy = snapshot.invoices[0];
  state.contractInvoices = [];
  state.invoiceSchemaVersion = undefined;
  state.migrationReviewItems = [];
  snapshot.invoices = [
    { ...legacy, id: '' },
    { ...legacy, id: 'LEGACY-V7-INV-1', number: 'LEGACY-V7-INV-1' },
  ];

  migrateContractInvoices(state);
  migrateContractInvoices(state);

  assert.deepEqual(
    state.contractInvoices.map((invoice) => invoice.id),
    ['LEGACY-V7-INV-1'],
  );
  assert.equal(state.contractInvoices.some((invoice) => !invoice.id.trim()), false);
  assert.deepEqual(
    state.migrationReviewItems.map((item) => [item.entityId, item.relation]),
    [[snapshot.projectId, 'invoiceId-0']],
  );
  assert.match(state.migrationReviewItems![0].reason, /缺少稳定发票ID/);
  assert.deepEqual(
    snapshot.invoices.map((invoice) => invoice.id),
    ['', 'LEGACY-V7-INV-1'],
    '旧快照原文必须原样保留',
  );
  assert.deepEqual(collectDemoFinanceSummaries(state), [
    {
      status: 'unavailable',
      sourceId: 'contract-invoices',
      reason: '有1项历史发票关联待核，暂不能提供可信的统一余额汇总。',
    },
  ]);
});
