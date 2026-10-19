import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_DATE } from '../src/app/core/models';
import { harness } from './v4-harness';

function ready() {
  const { store, role } = harness();
  const sale = store.sale('DEMO-O005')!;
  sale.stage = '合同谈判';
  sale.status = '进行中';
  store.state().contracts = store.state().contracts.filter((c) => c.opportunityId !== sale.id);
  store.state().activities.push({
    id: 'SIGN-COMM',
    entityId: sale.id,
    customerId: sale.customerId,
    date: BASE_DATE,
    type: '会议',
    summary: '签约沟通',
    people: '客户',
    next: '签约',
    operator: '张销售',
    stage: '合同谈判',
  });
  const contractId = store.createContractDraft(sale.id)!;
  store.updateContractDraft(contractId, { sellerEntity: '演示主体' });
  role('manager');
  return { store, role, contractId, saleId: sale.id };
}

test('签约复核合同显式引用，失去最终锁定时完整拒绝而不替换为其他报价', () => {
  const { store, contractId } = ready();
  const contract = store.contract(contractId)!;
  const quote = store.quoteVersion(contract.quoteVersionId!)!;
  const series = store.quoteSeries('DEMO-O005')!;
  const newer = structuredClone(quote);
  newer.id = 'NEW-FINAL';
  newer.number = 2;
  series.versions.push(newer);
  series.activeFinalVersionId = newer.id;
  const before = structuredClone(store.state());
  assert.throws(
    () => store.registerContractAndStartProject(contractId, BASE_DATE, '凭据'),
    /最终锁定/,
  );
  assert.deepEqual(store.state(), before);
});

test('签约冻结选定系列的商务、产品和服务摘要，保留人工合同值且新报价不覆盖', () => {
  const { store, contractId } = ready();
  const contract = store.contract(contractId)!;
  const version = store.quoteVersion(contract.quoteVersionId!)!;
  const sourceItems = structuredClone(version.items);
  const sourcePayment = version.payment;
  contract.amount = 123456;
  contract.payment = '人工约定付款';
  contract.service = '人工服务范围';
  const beforeEvents = store.state().operationEvents!.length;
  const result = store.registerContractAndStartProject(contractId, BASE_DATE, '凭据')!;
  assert.ok(result);
  const signed = store.contract(contractId)!;
  assert.equal(signed.amount, 123456);
  assert.equal(signed.payment, '人工约定付款');
  assert.deepEqual(signed.adoptedQuoteSnapshot?.products, sourceItems);
  assert.equal(signed.adoptedQuoteSnapshot?.commercial.payment, sourcePayment);
  assert.equal(signed.adoptedQuoteSnapshot?.adoptedTerms.service, '人工服务范围');
  assert.equal(signed.adoptedQuoteSnapshot?.quoteVersionId, version.id);
  const frozen = structuredClone(signed.adoptedQuoteSnapshot);
  const series = store.quoteSeries('DEMO-O005')!;
  const newer = structuredClone(version);
  newer.id = 'NEXT-VERSION';
  newer.number = 2;
  newer.items[0].name = '更新产品';
  series.versions.push(newer);
  series.activeFinalVersionId = newer.id;
  assert.deepEqual(store.registerContractAndStartProject(contractId, BASE_DATE, '重试'), result);
  assert.deepEqual(store.contract(contractId)!.adoptedQuoteSnapshot, frozen);
  assert.equal(store.state().operationEvents!.length, beforeEvents + 1);
  assert.throws(
    () =>
      store.saveContractQuoteReference(contractId, { seriesId: series.id, versionId: newer.id }),
    /草稿/,
  );
  assert.throws(() => store.updateContractDraft(contractId, { quoteVersionId: newer.id }), /草稿/);
});

for (const entry of ['atomic', 'register'] as const) {
  test(`${entry}：旧弹窗修订拒绝，持久层旧修订/失权/容量失败不发布采用摘要`, () => {
    for (const fault of ['form-version', 'stored-version', 'lease', 'quota']) {
      const { store, contractId, saleId } = ready();
      if (entry === 'register') store.sale(saleId)!.stage = '赢单';
      const version = store.state().dataVersion || 1;
      const before = structuredClone(store.state());
      if (fault === 'lease') Object.assign(store, { editingLease: { owns: () => false } });
      Object.assign(store, { editingWritable: { set() {} } });
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
          getItem: () =>
            fault === 'stored-version'
              ? JSON.stringify({ ...before, dataVersion: version + 1 })
              : null,
          setItem: () => {
            if (fault === 'quota') throw new Error('容量不足');
          },
        },
      });
      const call = () =>
        entry === 'atomic'
          ? store.registerContractAndStartProject(
              contractId,
              BASE_DATE,
              '凭据',
              fault === 'form-version' ? version - 1 : version,
            )
          : store.registerContract(
              contractId,
              BASE_DATE,
              '凭据',
              fault === 'form-version' ? version - 1 : version,
            );
      assert.throws(call, /版本|修改权|容量不足/, fault);
      assert.deepEqual(store.state(), before, fault);
    }
  });
}

for (const entry of ['atomic', 'register'] as const) {
  for (const invalidity of [
    'missing-series',
    'missing-version',
    'wrong-series-pointer',
    'wrong-customer',
    'wrong-opportunity',
    'unlocked',
    'not-active-final',
    'missing-reference',
  ]) {
    test(`${entry}：${invalidity} 拒绝且不生成业务历史或首项目`, () => {
      const { store, contractId, saleId } = ready();
      if (entry === 'register') store.sale(saleId)!.stage = '赢单';
      const contract = store.contract(contractId)!;
      const series = store.quoteSeries(saleId)!;
      const quote = store.quoteVersion(contract.quoteVersionId!)!;
      if (invalidity === 'missing-series') contract.quoteSeriesId = 'NO-SERIES';
      if (invalidity === 'missing-version') contract.quoteVersionId = 'NO-VERSION';
      if (invalidity === 'wrong-series-pointer') quote.seriesId = 'OTHER-SERIES';
      if (invalidity === 'wrong-customer') quote.customerId = 'OTHER-CUSTOMER';
      if (invalidity === 'wrong-opportunity') series.opportunityId = 'OTHER-OPPORTUNITY';
      if (invalidity === 'unlocked') quote.status = '草稿';
      if (invalidity === 'not-active-final') series.activeFinalVersionId = '';
      if (invalidity === 'missing-reference') {
        delete contract.quoteSeriesId;
        delete contract.quoteVersionId;
      }
      const before = structuredClone(store.state());
      Object.assign(store.ui, { fail: () => false });
      assert.equal(
        entry === 'atomic'
          ? store.registerContractAndStartProject(contractId, BASE_DATE, '凭据')
          : store.registerContract(contractId, BASE_DATE, '凭据'),
        entry === 'atomic' ? null : false,
      );
      assert.deepEqual(store.state(), before);
    });
  }
}

test('已登记旧合同重复登记不补造采用摘要，普通保存与浏览不签约', () => {
  const { store, contractId } = ready();
  const before = structuredClone(store.state());
  store.contractQuoteReference(contractId);
  assert.deepEqual(store.state(), before);
  store.contract(contractId)!.status = '已登记';
  const legacy = structuredClone(store.state());
  assert.equal(store.registerContract(contractId, BASE_DATE, '重试'), true);
  assert.deepEqual(store.state(), legacy);
  assert.equal(store.contract(contractId)!.adoptedQuoteSnapshot, undefined);
});

test('签约后无关保存不触发旧兼容付款覆盖，摘要与实际采用条款保持一致', () => {
  const { store, contractId } = ready();
  store.contract(contractId)!.payment = '人工协商付款';
  const result = store.registerContractAndStartProject(contractId, BASE_DATE, '凭据');
  assert.ok(result);
  assert.equal(store.contract(contractId)!.payment, '人工协商付款');
  store.setDateMode('comparison');
  assert.equal(store.contract(contractId)!.payment, '人工协商付款');
  assert.equal(
    store.contract(contractId)!.adoptedQuoteSnapshot?.adoptedTerms.payment,
    '人工协商付款',
  );
});

test('合同选定另一报价系列时按其登记，签约后旧来源内容变化不改冻结产品与商务', () => {
  const { store, role, contractId, saleId } = ready();
  const original = store.quoteSeries(saleId)!;
  const second = structuredClone(original);
  second.id = 'SECOND-SERIES';
  second.number = 'SECOND-NUMBER';
  second.versions = second.versions.slice(0, 1);
  second.versions[0].id = 'SECOND-V1';
  second.versions[0].seriesId = second.id;
  second.versions[0].payment = '第二系列付款';
  second.versions[0].items[0].name = '第二系列产品';
  second.activeFinalVersionId = second.versions[0].id;
  store.state().quoteSeries!.push(second);
  role('sales');
  store.saveContractQuoteReference(contractId, {
    seriesId: second.id,
    versionId: second.activeFinalVersionId,
  });
  role('manager');
  assert.ok(store.registerContractAndStartProject(contractId, BASE_DATE, '凭据'));
  const adopted = structuredClone(store.contract(contractId)!.adoptedQuoteSnapshot);
  assert.equal(adopted?.quoteSeriesId, second.id);
  assert.equal(adopted?.commercial.payment, '第二系列付款');
  const source = store.quoteVersion('SECOND-V1')!;
  source.items[0].name = '来源后续被改';
  source.payment = '被改付款';
  assert.deepEqual(store.contract(contractId)!.adoptedQuoteSnapshot, adopted);
  assert.deepEqual(
    store
      .state()
      .operationEvents!.at(-1)!
      .changes.find((c) => c.field === 'contract.adoptedQuoteSnapshot')!.after,
    adopted,
  );
});
