import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_DATE } from '../src/app/core/models';
import { harness, prepareSigningQuote } from './v4-harness';

const termInput = () => ({
  code: 'REVIEW-TERM',
  descriptionZh: '签约付款',
  descriptionEn: '',
  descriptionDe: '',
  status: 'active',
  crmFields: { source: { value: 'before' } },
});
const methodInput = (paymentTermId: string) => ({
  name: '首付款',
  paymentTermId,
  condition: '签约后',
  method: '按比例',
  proportion: 30,
  days: null,
  fixedAmount: null,
  followFixedAmount: false,
  deliveryInFullPayment: '',
  remarks: '',
  active: true,
  crmFields: { source: { value: 'before' } },
});

function readyContract() {
  const context = harness();
  const { store, role } = context;
  store.state.update((state) => {
    const sale = state.sales.find((item) => item.id === 'DEMO-O003')!;
    sale.stage = '合同谈判';
    sale.status = '进行中';
    sale.quoteFlowMode = 'legacy';
    state.activities.push({
      id: 'REVIEW-ACT',
      entityId: sale.id,
      customerId: sale.customerId,
      date: BASE_DATE,
      type: '会议',
      summary: '签约沟通',
      people: '客户采购',
      next: '签约',
      operator: '张销售',
      stage: '合同谈判',
    });
    return state;
  });
  const contractId = store.createContractDraft('DEMO-O003')!;
  store.updateContractDraft(contractId, {
    title: '回归合同',
    sellerEntity: '演示主体',
    scope: '设备供货',
    payment: '签约付款',
  });
  role('finance');
  store.savePaymentTerm(termInput());
  const term = store.paymentTerms()[0];
  store.savePaymentMethod(methodInput(term.id));
  const method = store.paymentMethods(term.id)[0];
  role('sales');
  store.setContractPaymentSelection(contractId, term.id, [method.id]);
  prepareSigningQuote(store, contractId);
  role('manager');
  return { ...context, contractId, term, method };
}

test('只修改付款方式备注时保留未传入的合同与订单关联', () => {
  const { store, role } = harness();
  role('finance');
  store.savePaymentTerm(termInput());
  const input = methodInput(store.paymentTerms()[0].id);
  store.savePaymentMethod({ ...input, contractId: 'CONTRACT-REF', orderId: 'ORDER-REF' });
  const saved = store.paymentMethods()[0];
  store.savePaymentMethod({ ...input, id: saved.id, remarks: '只改备注' });
  assert.equal(store.paymentMethods()[0].remarks, '只改备注');
  assert.equal(store.paymentMethods()[0].contractId, 'CONTRACT-REF');
  assert.equal(store.paymentMethods()[0].orderId, 'ORDER-REF');
});

test('支付条款和方式隔离调用方嵌套输入，历史与持久化不会被随后修改', () => {
  for (const kind of ['term', 'method'] as const) {
    const { store, role } = harness();
    role('finance');
    if (kind === 'method') store.savePaymentTerm(termInput());
    let persisted = '';
    let writes = 0;
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: (_key: string, value: string) => {
          persisted = value;
          writes += 1;
        },
      },
    });
    try {
      const input = kind === 'term' ? termInput() : methodInput(store.paymentTerms()[0].id);
      if (kind === 'term') store.savePaymentTerm(input as ReturnType<typeof termInput>);
      else store.savePaymentMethod(input as ReturnType<typeof methodInput>);
      const committed = structuredClone(store.state());
      const savedRaw = persisted;
      input.crmFields.source.value = 'outside-save';
      assert.deepEqual(store.state(), committed);
      assert.equal(persisted, savedRaw);
      assert.equal(writes, 1);
      assert.deepEqual(JSON.parse(savedRaw), JSON.parse(JSON.stringify(committed)));
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
  }
});

test('支付条款和方式存储失败时业务记录与历史均不发布', () => {
  for (const kind of ['term', 'method'] as const) {
    const { store, role } = harness();
    role('finance');
    store.savePaymentTerm(termInput());
    const before = structuredClone(store.state());
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('回归存储失败');
        },
      },
    });
    try {
      assert.throws(
        () =>
          kind === 'term'
            ? store.savePaymentTerm({ ...termInput(), code: 'NEW' })
            : store.savePaymentMethod(methodInput(store.paymentTerms()[0].id)),
        /回归存储失败/,
      );
      assert.deepEqual(store.state(), before);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
  }
});

test('销售跨部门维护支付主数据时保持合同及商机负责人', () => {
  const { store, role, contractId } = readyContract();
  const contractBefore = structuredClone(
    store.state().contracts.find((item) => item.id === contractId),
  );
  const saleBefore = structuredClone(store.sale('DEMO-O003'));
  role('sales');
  assert.equal(store.savePaymentTerm({ ...termInput(), code: 'SALES-TERM' }), true);
  assert.equal(store.savePaymentMethod(methodInput(store.paymentTerms().at(-1)!.id)), true);
  assert.deepEqual(
    store.state().contracts.find((item) => item.id === contractId),
    contractBefore,
  );
  assert.deepEqual(store.sale('DEMO-O003'), saleBefore);
});

for (const invalidity of [
  'changed-term',
  'inactive',
  'missing',
  'other-contract',
  'missing-term',
  'unverified-order',
] as const) {
  test(`签约复验付款方式：${invalidity} 时拒绝并保持合同商机项目及事件原样`, () => {
    const { store, contractId, method } = readyContract();
    store.state.update((state) => {
      const target = state.paymentMethods!.find((item) => item.id === method.id)!;
      if (invalidity === 'changed-term') target.paymentTermId = 'ANOTHER-TERM';
      if (invalidity === 'inactive') target.active = false;
      if (invalidity === 'missing') state.paymentMethods = [];
      if (invalidity === 'other-contract') target.contractId = 'ANOTHER-CONTRACT';
      if (invalidity === 'missing-term') state.paymentTerms = [];
      if (invalidity === 'unverified-order') target.orderId = 'UNVERIFIED-ORDER';
      return state;
    });
    const before = structuredClone(store.state());
    assert.throws(() => store.registerContractAndStartProject(contractId, BASE_DATE, '签约凭据'));
    assert.deepEqual(store.state(), before);
  });
}

test('生产错误提示返回false时无效付款方式仍拒绝签约且不发布半状态', () => {
  const { store, contractId, method } = readyContract();
  store.state.update((state) => {
    state.paymentMethods!.find((item) => item.id === method.id)!.active = false;
    return state;
  });
  const before = structuredClone(store.state());
  let errorCount = 0;
  Object.assign(store.ui, {
    fail: () => {
      errorCount += 1;
      return false;
    },
  });
  assert.equal(store.registerContractAndStartProject(contractId, BASE_DATE, '签约凭据'), null);
  assert.equal(errorCount, 1);
  assert.deepEqual(store.state(), before);
});
