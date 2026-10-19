import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
const term = {
  code: 'V8',
  descriptionZh: '条款',
  descriptionEn: 'Terms',
  descriptionDe: 'Bedingungen',
  status: 'active',
  crmFields: {},
};
const method = (id: string) => ({
  name: '首款',
  paymentTermId: id,
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
});
test('款清发货按显式空、嵌套、扁平优先读取，冲突保留来源并提示待核', () => {
  for (const [business, nested, flat, expected, conflict] of [
    ['', '是', '否', '', true],
    [null, '是', '否', null, true],
    [undefined, '是', '否', '是', true],
    [undefined, undefined, '否', '否', false],
    ['是', '是', '是', '是', false],
  ] as const) {
    const { store, role } = harness();
    role('finance');
    store.savePaymentTerm(term);
    const row: any = method(store.paymentTerms()[0].id);
    if (business === undefined) delete row.deliveryInFullPayment;
    else row.deliveryInFullPayment = business;
    row.id = 'OLD';
    row.revision = 1;
    row.crmFields = {
      alp_framework_protocol: {
        ...(nested === undefined ? {} : { alp_delivery_in_full_payment: nested }),
      },
      ...(flat === undefined ? {} : { alp_delivery_in_full_payment: flat }),
    };
    store.state.update((s) => ({ ...s, paymentMethods: [row] }));
    const before = structuredClone(store.state());
    const read = store.paymentMethods()[0];
    assert.equal(read.deliveryInFullPayment, expected);
    assert.equal(read.deliveryInFullPaymentNeedsReview, conflict);
    assert.deepEqual(store.state(), before);
  }
});
test('旧付款表单不能覆盖已提交版本，保存保留创建时间及来源', () => {
  const { store, role } = harness();
  role('finance');
  store.savePaymentTerm(term);
  const input = method(store.paymentTerms()[0].id);
  const version = store.state().dataVersion || 1;
  store.savePaymentMethod(input, version);
  const saved = store.paymentMethods()[0];
  const before = structuredClone(store.state());
  assert.throws(
    () => store.savePaymentMethod({ ...input, id: saved.id, name: '旧编辑' }, version),
    /版本已变化/,
  );
  assert.deepEqual(store.state(), before);
  assert.ok(saved.createdAt);
  store.savePaymentMethod({ ...saved, name: '新名称' }, store.state().dataVersion || 1);
  assert.equal(store.paymentMethods()[0].createdAt, saved.createdAt);
});
test('付款保存遇到资格丢失、存储修订或容量失败不发布业务及历史', () => {
  for (const failure of ['lease', 'revision', 'quota']) {
    const { store, role } = harness();
    role('finance');
    store.savePaymentTerm(term);
    const before = structuredClone(store.state());
    Object.assign(store, { editingWritable: { set() {} } });
    if (failure === 'lease') Object.assign(store, { editingLease: { owns: () => false } });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () =>
          failure === 'revision'
            ? JSON.stringify({ ...before, dataVersion: (before.dataVersion || 1) + 1 })
            : null,
        setItem() {
          if (failure === 'quota') throw Error('QuotaExceededError');
        },
      },
    });
    assert.throws(
      () => store.savePaymentMethod(method(store.paymentTerms()[0].id), before.dataVersion || 1),
      /修改权|版本|Quota/,
    );
    assert.deepEqual(store.state(), before);
  }
});

test('旧付款记录无创建时间时，维护后仍标未记录而不制造日期', () => {
 const {store,role}=harness(); role('finance'); store.savePaymentTerm(term);
 const input=method(store.paymentTerms()[0].id); store.savePaymentMethod(input);
 store.state.update(state=>{delete state.paymentMethods![0].createdAt; return state;});
 const previous=store.paymentMethods()[0];
 store.savePaymentMethod({...previous,name:'旧阶段更新'},store.state().dataVersion||1);
 assert.equal(store.paymentMethods()[0].createdAt,undefined);
});
