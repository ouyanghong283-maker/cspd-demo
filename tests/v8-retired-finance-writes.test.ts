import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import type { SalesOrder, SalesOrderLine } from '../src/app/core/orders';
import type { ContractInvoice } from '../src/app/core/invoices';
import type { BankReceiptClaim, BankReceiptClaimLine } from '../src/app/core/remittances';

const RETIRED = /已停用/;

function retiredOrder(contractId: string): { order: SalesOrder; lines: SalesOrderLine[] } {
  const order: SalesOrder = {
    id: 'V8-RETIRED-SO',
    contractId,
    orderNumber: 'V8-RETIRED-SO-001',
    currency: 'EUR',
    amount: 1234.56,
    status: '有效',
    revision: 0,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    owner: '验收订单专员',
  };
  return {
    order,
    lines: [
      {
        id: 'V8-RETIRED-SOL',
        orderId: order.id,
        productDescription: '退役样例设备',
        sapMaterialNumber: 'SAP-V8-RETIRED',
        quantity: 2,
        unit: '套',
      },
    ],
  };
}

test('退役的合同订单与明细提交入口被拒绝，且不写入订单、明细、历史或进展', () => {
  const { store, role } = harness();
  role('sales');
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem: () => {
        writes += 1;
      },
      getItem: () => null,
    },
  });
  const contract = store.state().contracts[0];
  const { order, lines } = retiredOrder(contract.id);
  const before = structuredClone(store.state());

  assert.throws(() => store.saveSalesOrder(order, lines), RETIRED);

  assert.deepEqual(store.state(), before);
  assert.equal(writes, 0, '退役入口不得写入本地工作区');
  assert.equal(
    store.ordersForContract(contract.id).some((item) => item.id === order.id),
    false,
  );
  assert.equal(store.orderLines().some((line) => line.id === lines[0].id), false);
  assert.deepEqual(store.operationEvents(order.id), []);
});

test('退役的合同发票提交入口与历史模拟回款入口被拒绝，余额来源保持原值', () => {
  const { store, role } = harness();
  role('finance');
  const invoice = store.state().contractInvoices!.find((item) => item.projectIds.includes('DEMO-P001'))!;
  const edited: ContractInvoice = { ...invoice, amount: invoice.amount + 500, revision: invoice.revision + 1 };
  const before = structuredClone(store.state());

  assert.throws(() => store.saveContractInvoice(edited), RETIRED);
  assert.throws(() => store.saveContractInvoice({ ...invoice, cumulativeSource: 'claims' }), RETIRED);
  assert.throws(() => store.simulateReceipt('DEMO-P001', invoice.id, false), RETIRED);
  assert.throws(() => store.simulateReceipt('DEMO-P001', invoice.id, true), RETIRED);

  assert.deepEqual(store.state(), before);
  assert.equal(store.invoiceReceiptClaims(invoice.id).received, invoice.received);
  assert.deepEqual(store.operationEvents(invoice.id), []);
});

test('退役的水单认领提交入口被拒绝，认领明细与发票认领投影都不变化', () => {
  const { store, role } = harness();
  role('finance');
  const contract = store.state().contracts[0];
  const invoice = store.state().contractInvoices!.find((item) => item.contractId === contract.id)!;
  store.state.update((state) => ({
    ...state,
    orders: [
      {
        id: 'V8-HISTORY-SO',
        contractId: contract.id,
        orderNumber: 'V8-HISTORY-SO-001',
        currency: invoice.currency,
        amount: 500,
        status: '有效',
        revision: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        owner: '历史订单专员',
      },
    ],
  }));
  const receipt: BankReceiptClaim = {
    id: 'V8-RETIRED-RECEIPT',
    number: 'V8-RETIRED-RECEIPT-001',
    contractId: contract.id,
    amount: 500,
    currency: invoice.currency,
    status: '有效',
  };
  const line: BankReceiptClaimLine = {
    id: 'V8-RETIRED-CLAIM-LINE',
    receiptId: receipt.id,
    orderId: 'V8-HISTORY-SO',
    invoiceId: invoice.id,
    amount: 200,
    currency: invoice.currency,
    status: '有效',
  };
  const before = structuredClone(store.state());
  const claimsBefore = store.invoiceReceiptClaims(invoice.id);

  assert.throws(() => store.saveBankReceiptClaim(receipt, [line]), RETIRED);

  assert.deepEqual(store.state(), before);
  assert.deepEqual(store.bankReceiptClaims(contract.id), []);
  assert.deepEqual(store.bankReceiptClaimLines(), []);
  assert.deepEqual(store.bankReceiptSummary(receipt.id), []);
  assert.deepEqual(store.invoiceReceiptClaims(invoice.id), claimsBefore);
  assert.deepEqual(store.operationEvents(receipt.id), []);
});

test('退役写入被拒绝后，旧财务ID、余额、项目引用与订单明细仍可只读追溯', () => {
  const { store, role } = harness();
  role('finance');
  const contract = store.state().contracts[0];
  const projectId = 'DEMO-P001';
  const before = structuredClone(store.state());
  const invoicesBefore = store.invoicesForContract(contract.id).map((item) => ({
    id: item.id,
    number: item.number,
    currency: item.currency,
    balance: store.invoiceReceiptClaims(item.id).received,
  }));
  assert(invoicesBefore.length > 0);

  assert.throws(() => store.simulateReceipt(projectId, invoicesBefore[0].id, false), RETIRED);
  assert.throws(() => store.saveContractInvoice({ ...store.invoicesForContract(contract.id)[0] }), RETIRED);
  assert.throws(
    () => store.saveSalesOrder(retiredOrder(contract.id).order, retiredOrder(contract.id).lines),
    RETIRED,
  );

  assert.deepEqual(store.state(), before);
  assert.deepEqual(
    store.invoicesForContract(contract.id).map((item) => ({
      id: item.id,
      number: item.number,
      currency: item.currency,
      balance: store.invoiceReceiptClaims(item.id).received,
    })),
    invoicesBefore,
  );
  assert.deepEqual(
    store.invoicesForProject(projectId).map((item) => item.id),
    ['DEMO-P001-I1', 'DEMO-P001-I2', 'DEMO-P001-I3'],
  );
  assert.deepEqual(
    store.invoicesForProject(projectId).map((item) => item.contractId),
    [contract.id, contract.id, contract.id],
  );
  assert.equal(store.project(projectId)?.contractId, contract.id);
});

test('退役拒绝后水单认领的旧财务 ID 与源系统技术字段仍可只读追溯', () => {
  const { store, role } = harness();
  role('finance');
  const contract = store.state().contracts[0];
  const invoice = store.invoicesForProject('DEMO-P001')[0];
  const receipt: BankReceiptClaim = {
    id: 'V8-LEGACY-RECEIPT',
    number: 'V8-LEGACY-RECEIPT-001',
    contractId: contract.id,
    amount: 40,
    currency: invoice.currency,
    status: '有效',
    receivedAt: '2026-10-05',
    sourceIds: { alp_claim_water_bill: 'CRM-WB-77001' },
    crmFields: { alp_water_bill_no: 'WB-2026-0001' },
    sourceFields: { alp_legacy_received: 25 },
  };
  const line: BankReceiptClaimLine = {
    id: 'V8-LEGACY-CLAIM-LINE',
    receiptId: receipt.id,
    orderId: 'V8-LEGACY-SO',
    invoiceId: invoice.id,
    amount: 25,
    currency: invoice.currency,
    status: '有效',
    sourceIds: { alp_water_bill_claim_details: 'CRM-WBC-88001' },
    crmFields: { alp_claim_details_code: 'WBC-2026-0001' },
  };
  store.state.update((state) => ({
    ...state,
    bankReceiptClaims: [receipt],
    bankReceiptClaimLines: [line],
  }));
  const before = structuredClone(store.state());

  assert.throws(() => store.saveBankReceiptClaim(receipt, [line]), RETIRED);

  assert.deepEqual(store.state(), before);
  const readReceipts = store.bankReceiptClaims(contract.id);
  assert.equal(readReceipts.length, 1);
  assert.equal(readReceipts[0].sourceIds?.alp_claim_water_bill, 'CRM-WB-77001');
  assert.equal(readReceipts[0].crmFields?.alp_water_bill_no, 'WB-2026-0001');
  assert.equal(readReceipts[0].sourceFields?.alp_legacy_received, 25);
  const readLines = store.bankReceiptClaimLines(receipt.id);
  assert.equal(readLines.length, 1);
  assert.equal(readLines[0].sourceIds?.alp_water_bill_claim_details, 'CRM-WBC-88001');
  assert.equal(readLines[0].crmFields?.alp_claim_details_code, 'WBC-2026-0001');
  assert.deepEqual(store.bankReceiptSummary(receipt.id), [
    {
      currency: invoice.currency,
      receiptAmount: 40,
      claimedAmount: 25,
      remainingAmount: 15,
      lineCount: 1,
    },
  ]);
  assert.deepEqual(store.operationEvents(receipt.id), []);
});

test('退役财务入口在缺资格与存储失败下仍拒绝，且不尝试任何本地写入', () => {
  const { store, role } = harness();
  role('outsider');
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem: () => {
        writes += 1;
        throw new Error('存储容量不足');
      },
      getItem: () => null,
    },
  });
  const contract = store.state().contracts[0];
  const projectId = 'DEMO-P001';
  const invoice = store.invoicesForProject(projectId)[0];
  const { order, lines } = retiredOrder(contract.id);
  const before = structuredClone(store.state());
  const eventsBefore = (store.state().operationEvents || []).length;

  assert.throws(
    () =>
      store.saveBankReceiptClaim(
        {
          id: 'V8-FAIL-RECEIPT',
          number: 'V8-FAIL-RECEIPT',
          contractId: contract.id,
          amount: 1,
          currency: invoice.currency,
          status: '有效',
        },
        [
          {
            id: 'V8-FAIL-LINE',
            receiptId: 'V8-FAIL-RECEIPT',
            orderId: order.id,
            invoiceId: invoice.id,
            amount: 1,
            currency: invoice.currency,
            status: '有效',
          },
        ],
      ),
    RETIRED,
  );
  assert.throws(() => store.saveContractInvoice({ ...invoice, amount: invoice.amount + 1 }), RETIRED);
  assert.throws(() => store.saveSalesOrder(order, lines), RETIRED);
  assert.throws(() => store.simulateReceipt(projectId, invoice.id, true), RETIRED);

  assert.equal(writes, 0, '退役入口不得尝试写入本地工作区');
  assert.deepEqual(store.state(), before);
  assert.equal((store.state().operationEvents || []).length, eventsBefore);
});

test('带过期版本与陈旧修订的退役调用仍被无条件拒绝，旧修订与操作事件保持不变', () => {
  const { store, role } = harness();
  role('finance');
  const contract = store.state().contracts[0];
  const projectId = 'DEMO-P001';
  const invoice = store.invoicesForProject(projectId)[0];
  const { order, lines } = retiredOrder(contract.id);
  const staleOrder: SalesOrder = { ...order, revision: 0 };
  const staleInvoice: ContractInvoice = { ...invoice, revision: 0 };
  const staleReceipt: BankReceiptClaim = {
    id: 'V8-STALE-RECEIPT',
    number: 'V8-STALE-RECEIPT-001',
    contractId: contract.id,
    amount: 100,
    currency: invoice.currency,
    status: '有效',
  };
  const staleClaimLine: BankReceiptClaimLine = {
    id: 'V8-STALE-CLAIM-LINE',
    receiptId: staleReceipt.id,
    orderId: order.id,
    invoiceId: invoice.id,
    amount: 100,
    currency: invoice.currency,
    status: '有效',
  };
  // 表单打开后数据版本已推进：这批陈旧提交既带过期表单版本，也带旧修订。
  const staleFormVersion = store.state().dataVersion || 1;
  store.state.update((state) => ({ ...state, dataVersion: staleFormVersion + 1 }));
  const before = structuredClone(store.state());
  const beforeText = JSON.stringify(store.state());
  const eventsBefore = structuredClone(store.state().operationEvents || []);
  const attempts = [
    () => store.saveSalesOrder(staleOrder, lines),
    () => store.saveContractInvoice(staleInvoice),
    () => store.saveBankReceiptClaim(staleReceipt, [staleClaimLine]),
    () => store.simulateReceipt(projectId, invoice.id, false),
    () => store.simulateReceipt(projectId, invoice.id, true),
  ];

  for (const attempt of attempts) {
    assert.throws(attempt, RETIRED);
    assert.throws(
      attempt,
      (error: Error) => !/版本已变化|请刷新|修改权/.test(error.message),
    );
  }

  assert.equal(JSON.stringify(store.state()), beforeText);
  assert.deepEqual(store.state(), before);
  assert.equal(store.state().dataVersion, staleFormVersion + 1);
  assert.deepEqual(store.state().operationEvents || [], eventsBefore);
  assert.equal(store.invoicesForProject(projectId)[0].revision, invoice.revision);
  assert.deepEqual(store.ordersForContract(contract.id), []);
  assert.equal(store.bankReceiptSummary(staleReceipt.id).length, 0);
  assert.deepEqual(store.operationEvents(staleReceipt.id), []);
  assert.deepEqual(store.operationEvents(staleInvoice.id), []);
  assert.deepEqual(store.operationEvents(staleOrder.id), []);
  assert.equal(store.invoiceReceiptClaims(invoice.id).received, invoice.received);
});

const retiredGuardTerm = {
  code: 'V8-RETIRED-GUARD',
  descriptionZh: '退役守卫条款',
  descriptionEn: 'Retired guard term',
  descriptionDe: 'Stillstandsbedingung',
  status: 'active',
  crmFields: {},
};

test('付款方式与付款阶段不被退役，项目订单与交付引用职责继续可用', () => {
  const { store, role } = harness();
  role('finance');
  const contract = store.state().contracts[0];
  const projectId = 'DEMO-P001';
  const invoice = store.invoicesForProject(projectId)[0];
  const { order, lines } = retiredOrder(contract.id);
  const historyOrder: SalesOrder = {
    ...order,
    projectId,
    status: '历史有效',
    deliveryDate: '2026-11-20',
  };
  store.state.update((state) => ({
    ...state,
    orders: [historyOrder],
    orderLines: [{ ...lines[0], batchNumber: 'V8-BATCH', requestedDeliveryDate: '2026-11-18' }],
  }));

  store.savePaymentTerm(retiredGuardTerm);
  const term = store.paymentTerms().find((item) => item.code === retiredGuardTerm.code)!;
  const methodInput = {
    name: '首款',
    paymentTermId: term.id,
    condition: '签约',
    method: '按比例',
    proportion: 30,
    days: 7,
    fixedAmount: null,
    followFixedAmount: false,
    deliveryInFullPayment: '',
    remarks: '',
    active: true,
    crmFields: {},
  };
  assert.equal(store.savePaymentMethod(methodInput), true);
  const savedMethod = store.paymentMethods().find((item) => item.name === '首款')!;
  assert.ok(savedMethod.createdAt);
  const termsBefore = structuredClone(store.paymentTerms());
  const methodsBefore = structuredClone(store.paymentMethods());
  const historyBefore = structuredClone(store.ordersForContract(contract.id));

  assert.throws(() => store.saveSalesOrder(historyOrder, lines), RETIRED);
  assert.throws(() => store.saveContractInvoice({ ...invoice }), RETIRED);
  assert.throws(() => store.simulateReceipt(projectId, invoice.id, false), RETIRED);

  // 退役不得牵连付款方式、付款阶段与项目订单／交付协同的只读引用。
  assert.deepEqual(store.paymentTerms(), termsBefore);
  assert.deepEqual(store.paymentMethods(), methodsBefore);
  assert.deepEqual(store.ordersForContract(contract.id), historyBefore);
  assert.equal(store.ordersForProject(projectId)[0]?.orderNumber, historyOrder.orderNumber);
  assert.equal(store.orderLines(historyOrder.id)[0]?.batchNumber, 'V8-BATCH');
  assert.deepEqual(
    store.invoicesForProject(projectId).map((item) => item.id),
    ['DEMO-P001-I1', 'DEMO-P001-I2', 'DEMO-P001-I3'],
  );
  assert.equal(store.invoicesForProject(projectId)[0].contractId, contract.id);

  // 退役之后付款方式与付款阶段仍可维护。
  assert.equal(
    store.savePaymentMethod({ ...savedMethod, name: '尾款' }, store.state().dataVersion || 1),
    true,
  );
  const updated = store.paymentMethods().find((item) => item.name === '尾款')!;
  assert.equal(updated.createdAt, savedMethod.createdAt);
  assert.equal(updated.revision, savedMethod.revision + 1);
  assert.equal(store.paymentMethods().length, 1);

  // 合同草稿采用付款阶段选择仍可用，且不产生财务退役提示。
  const draftId = store.createContractDraft('DEMO-O003')!;
  assert.equal(store.state().contracts.find((item) => item.id === draftId)?.status, '草稿');
  assert.equal(store.setContractPaymentSelection(draftId, term.id, [updated.id]), true);
  const draft = store.state().contracts.find((item) => item.id === draftId)!;
  assert.equal(draft.paymentTermId, term.id);
  assert.deepEqual(draft.paymentMethodIds, [updated.id]);
  assert.deepEqual(store.paymentMethods(term.id).map((item) => item.name), ['尾款']);
});
