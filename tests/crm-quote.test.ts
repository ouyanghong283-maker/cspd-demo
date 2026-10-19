import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CRM_DETAIL_FIELDS, CRM_SUMMARY_FIELDS } from '../src/app/core/crm-quote-schema';
import { CRM_QUOTE_CATALOG } from '../src/app/core/crm-quote-reference';
import {
  applyCrmProduct,
  calculateCrmLine,
  crmAggregate,
  crmFieldReadonly,
  crmFieldVisible,
  crmInteger,
  crmQuoteErrors,
  crmReferences,
  persistCrmFields,
} from '../src/app/core/crm-quote';
import { harness } from './v4-harness';
import { completeCrmDraft, prepareQuoteSolutionBasis } from './crm-quote-fixture';

function editableQuote() {
  const context = harness();
  const version = context.store.quoteSeries('DEMO-O008')!.versions[0];
  version.status = '草稿';
  return { ...context, id: version.id, original: structuredClone(version) };
}
function savedQuote() {
  const context = editableQuote();
  assert.equal(context.store.saveCrmQuote(completeCrmDraft(context.store, context.id)), true);
  return context;
}

test('覆盖摘要39控件、明细37属性及源配置精度', () => {
  assert.equal(CRM_SUMMARY_FIELDS.length, 39);
  assert.equal(CRM_DETAIL_FIELDS.length, 37);
  for (const fields of [CRM_SUMMARY_FIELDS, CRM_DETAIL_FIELDS])
    assert.equal(new Set(fields.map((field) => field.name)).size, fields.length);
  assert.equal(CRM_SUMMARY_FIELDS.filter((field) => field.type === 'decimal').length, 7);
  assert.equal(CRM_DETAIL_FIELDS.find((field) => field.name === 'quantity')!.precision, 0);
  assert.ok(
    CRM_DETAIL_FIELDS.filter(
      (field) => field.type === 'decimal' && field.name !== 'quantity',
    ).every((field) => field.precision === 2),
  );
});

test('六种折扣按源顺序计算，中间值不提前舍入', () => {
  const fields = calculateCrmLine({
    quantity: 2,
    alp_priceperunit: 100,
    alp_beforedispriceintax: 113,
    alp_taxpercentage: 13,
    alp_freightfee: 10,
    alp_one_way_discount: 10,
    alp_customer_discount: 5,
    alp_customer_or_material_discount: 3,
    alp_discount_materials: 2,
    alp_special_discounts: 4,
    alp_rebate: 1,
  });
  assert.equal(fields['alp_afterdistotal'], 166.25);
  assert.equal(fields['alp_afterdiscountamount'], 83.125);
  assert.ok(Math.abs(Number(fields['alp_afterdistotalintax']) - 187.8625) < 1e-9);
  assert.equal(fields['alp_beforedistotalintax'], 236);
  assert.equal(persistCrmFields(fields, CRM_DETAIL_FIELDS)['alp_afterdiscountamount'], 83.13);
  assert.equal(persistCrmFields(fields, CRM_DETAIL_FIELDS)['alp_afterdistotalintax'], 187.86);
});

test('无折扣运费计税、含税单价反算、未税与零数量分支', () => {
  const fields = calculateCrmLine(
    { quantity: 2, alp_priceperunit: 100, alp_taxpercentage: 13, alp_freightfee: 10 },
    'alp_priceperunit',
  );
  assert.equal(fields['alp_afterdistotalintax'], 237.3);
  const gross = calculateCrmLine(
    { quantity: 2, alp_beforedispriceintax: 113, alp_taxpercentage: 13 },
    'alp_beforedispriceintax',
  );
  assert.equal(gross['alp_priceperunit'], 100);
  assert.equal(
    calculateCrmLine({ ...gross, alp_isintax: 20 }, 'alp_taxpercentage')['alp_taxpercentage'],
    0,
  );
  const zero = calculateCrmLine({
    quantity: 0,
    alp_special_discounts: 10,
    alp_priceperunit: 100,
    alp_beforedispriceintax: 100,
  });
  assert.equal(zero['alp_afterdiscountamount'], 0);
  assert.equal(zero['alp_afterdistotal'], 0);
});

test('S.行仅从毛利排除，缺成本留空，删空明细清零，整数转换保留.NET中点规则', () => {
  const { store, id } = editableQuote();
  const item = completeCrmDraft(store, id).items[0];
  const first = {
    ...item,
    crmFields: {
      alp_afterdistotal: 100,
      alp_afterdistotalintax: 113,
      alp_refertotalcost: 60,
      alp_refertotalcost_noamortize: 50,
      productCode: 'P.1',
    },
  };
  const service = {
    ...item,
    id: 'service',
    crmFields: {
      alp_afterdistotal: 20,
      alp_afterdistotalintax: 22.6,
      alp_refertotalcost: 10,
      productCode: 'S.1',
    },
  };
  assert.equal(crmAggregate([first, service])['alp_quototalpriceofftax'], 120);
  assert.equal(crmAggregate([first, service])['alp_totalgrossprofit'], 50);
  assert.equal(
    crmAggregate([{ ...first, crmFields: { alp_afterdistotal: 100 } }])['alp_totalgrossprofit'],
    null,
  );
  assert.equal(crmAggregate([])['alp_totalgrossprofit'], 0);
  assert.equal(crmInteger(2.5), 2);
  assert.equal(crmInteger(3.5), 4);
});

test('已有明细锁定基础选择，按组织显示折扣，SKU隐藏普通价目表', () => {
  assert.equal(
    crmFieldReadonly(
      CRM_SUMMARY_FIELDS.find((field) => field.name === 'transactioncurrencyid')!,
      {},
      true,
    ),
    true,
  );
  assert.equal(
    crmFieldVisible(
      CRM_SUMMARY_FIELDS.find((field) => field.name === 'alp_price_list')!,
      { alp_sku_pricelevelid: 'SKU' },
      {},
    ),
    false,
  );
  const discount = CRM_DETAIL_FIELDS.find((field) => field.name === 'alp_one_way_discount')!;
  assert.equal(crmFieldVisible(discount, {}, {}, '8210'), true);
  assert.equal(crmFieldVisible(discount, {}, {}, '9999'), false);
});

test('关联快照覆盖SKU、产品、付款阶段，按用户取舍不做客户专属条款过滤', () => {
  assert.equal(CRM_QUOTE_CATALOG.prices.filter((row) => !row.sku).length, 672);
  assert.equal(CRM_QUOTE_CATALOG.prices.filter((row) => row.sku).length, 46);
  assert.equal(CRM_QUOTE_CATALOG.paymentStages.length, 168);
  const customer = CRM_QUOTE_CATALOG.references.find((row) => row.entity === 'account')!;
  const field = CRM_SUMMARY_FIELDS.find((field) => field.name === 'alp_paymenttermsid')!;
  assert.equal(crmReferences(CRM_QUOTE_CATALOG, field, { customerid: customer.id }).length, 84);
});

test('SKU同币种取定价原值，成本空值保留', () => {
  const point = CRM_QUOTE_CATALOG.prices.find((row) => row.sku && row.foreignGuide != null)!;
  assert.equal(
    applyCrmProduct(
      { alp_skuid: point.productId },
      { alp_sku_pricelevelid: point.priceListId, transactioncurrencyid: point.currencyId! },
      CRM_QUOTE_CATALOG,
    )['alp_salesguidanceprice'],
    point.foreignGuide,
  );
  const noCost = CRM_QUOTE_CATALOG.prices.find((row) => !row.sku && row.cost == null)!;
  assert.equal(
    applyCrmProduct(
      { alp_productcode: noCost.productId },
      { alp_price_list: noCost.priceListId },
      CRM_QUOTE_CATALOG,
    )['alp_refercostup'],
    null,
  );
});

test('保存校验必填、重算只读金额；保存成功前不迁移旧记录', () => {
  const { store, id, original } = editableQuote();
  assert.throws(
    () => store.saveCrmQuote({ ...store.crmQuoteDraft(original), crmSchemaVersion: 1 }),
    /关联价目表/,
  );
  assert.deepEqual(store.quoteVersion(id), original);
  const draft = completeCrmDraft(store, id);
  draft.crmFields!['alp_quototalpriceintax'] = 99999999;
  draft.items[0].crmFields!['alp_salesguidanceprice'] = 99999999;
  assert.equal(store.saveCrmQuote(draft), true);
  const saved = store.quoteVersion(id)!;
  assert.equal(saved.crmSchemaVersion, 1);
  assert.notEqual(saved.crmFields!['alp_quototalpriceintax'], 99999999);
  assert.notEqual(saved.items[0].crmFields!['alp_salesguidanceprice'], 99999999);
});

test('拒绝小数数量、超90天、重复行、旧修订及已有明细后的币种变化', () => {
  const { store, id } = editableQuote();
  const draft = completeCrmDraft(store, id);
  draft.items[0].crmFields!['quantity'] = 1.5;
  assert.throws(() => store.saveCrmQuote(draft), /整数/);
  draft.items[0].crmFields!['quantity'] = 2;
  draft.crmFields!['closedon'] = '2027-12-31';
  assert.throws(() => store.saveCrmQuote(draft), /90天/);
  draft.crmFields!['closedon'] = '2026-11-09';
  draft.items.push(structuredClone(draft.items[0]));
  assert.throws(() => store.saveCrmQuote(draft), /ID重复/);
  draft.items.pop();
  assert.equal(store.saveCrmQuote(draft), true);
  assert.throws(() => store.saveCrmQuote(draft), /已更新/);
  const next = store.crmQuoteDraft(store.quoteVersion(id)!);
  next.crmFields!['transactioncurrencyid'] = 'other-currency';
  assert.throws(() => store.saveCrmQuote(next), /不可更改/);
});

test('提交不再要求已删除的方案摘要、成本、附件及财务样例', async () => {
  const { store, id } = savedQuote();
  await prepareQuoteSolutionBasis(store, id);
  const quote = store.quoteVersion(id)!;
  Object.assign(quote, {
    solutionSummary: '',
    boundaries: '',
    sourceAttachmentIds: [],
    taxReview: '待确认',
  });
  assert.deepEqual(crmQuoteErrors(quote, store.crmQuoteCatalog(), true), []);
  assert.equal(store.submitQuote(id), true);
  assert.throws(() => store.reviewQuote(id, '附条件通过', '条件', '条件'), /通过或退回/);
  assert.equal(store.reviewQuote(id, '模拟审核通过', '复核通过'), true);
});

test('接受后一次主管锁定；不接受结果不能覆盖，也不能锁定', async () => {
  for (const result of ['接受', '不接受'] as const) {
    const { store, id } = savedQuote();
    await prepareQuoteSolutionBasis(store, id);
    store.submitQuote(id);
    store.reviewQuote(id, '模拟审核通过', '通过');
    const person = store.customer(store.quoteVersion(id)!.customerId)!.contacts[0].name;
    store.recordQuoteSent(id, '2026-10-10', '邮件', person, '本地合成凭据');
    store.recordCrmCustomerDecision(id, result, person, '客户回函', '2026-10-10');
    assert.equal(store.quoteVersion(id)!.lockRequestedBy, '');
    assert.throws(
      () => store.recordCrmCustomerDecision(id, '接受', person, '覆盖', '2026-10-10'),
      /最终结果/,
    );
    if (result === '接受') {
      assert.equal(store.lockQuote(id), true);
      assert.equal(store.quoteSeries('DEMO-O008')!.activeFinalVersionId, id);
    } else assert.throws(() => store.lockQuote(id), /客户确认接受/);
  }
});

test('已移除的来源变化不使新审核失效；存储失败不发布部分状态', async () => {
  const { store, id } = savedQuote();
  await prepareQuoteSolutionBasis(store, id);
  store.submitQuote(id);
  store.saveServiceTerms({ ...store.terms('DEMO-O008'), years: 3, scope: '新范围', sla: '24小时' });
  assert.equal(store.quoteVersion(id)!.status, '待模拟审核');
  const context = editableQuote();
  const before = structuredClone(context.store.state());
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    },
  });
  assert.throws(
    () => context.store.saveCrmQuote(completeCrmDraft(context.store, context.id)),
    /保存失败|quota|存储/,
  );
  assert.deepEqual(context.store.state(), before);
});

test('页面删除旧按钮，保留三个页签', () => {
  const source = readFileSync(
    new URL('../src/app/features/quote-workspace.ts', import.meta.url),
    'utf8',
  );
  for (const removed of [
    '本地税费案例',
    '跨境税费案例',
    '维护方案摘要',
    '确认税费样例',
    '保存草稿并同步资料',
    '维护扩展字段',
    '申请最终锁定',
    '关闭条件',
  ])
    assert.ok(!source.includes(removed), removed);
  assert.ok(source.includes("['摘要', '报价明细', '审核与记录']"));
});

test('新低价报价先普通审核、再独立特批，特批成功锁内容并允许发出', async () => {
  const { store, id } = editableQuote();
  const draft = completeCrmDraft(store, id);
  const guide = Number(draft.items[0].crmFields!['alp_salesguidanceprice']);
  draft.items[0].crmFields!['alp_priceperunit'] = Math.max(0.01, Math.floor(guide * 50) / 100);
  draft.items[0].crmPriceInput = 'alp_priceperunit';
  store.saveCrmQuote(draft);
  assert.equal(store.needsLowPriceApproval(store.quoteVersion(id)!), true);
  assert.throws(() => store.requestLowPriceApproval(id, '申请', '2026-11-09'), /先完成普通/);
  await prepareQuoteSolutionBasis(store, id);
  store.submitQuote(id);
  store.reviewQuote(id, '模拟审核通过', '普通审核通过');
  const person = store.customer(store.quoteVersion(id)!.customerId)!.contacts[0].name;
  assert.throws(() => store.recordQuoteSent(id, '2026-10-10', '邮件', person, '凭据'), /独立特批/);
  store.requestLowPriceApproval(id, '客户要求优惠', '2026-11-09');
  store.decideLowPriceApproval(id, '通过', '已核对');
  assert.throws(
    () => store.saveCrmQuote(store.crmQuoteDraft(store.quoteVersion(id)!)),
    /不可编辑|已成功/,
  );
  assert.equal(store.recordQuoteSent(id, '2026-10-10', '邮件', person, '凭据'), true);
});

test('自定义字段使用valueChange，避免原生change事件写入草稿', () => {
  const source = readFileSync(
    new URL('../src/app/shared/crm-quote-field.ts', import.meta.url),
    'utf8',
  );
  assert.ok(source.includes('readonly valueChange = output<CrmValue>()'));
  assert.ok(!source.includes('readonly change = output'));
  assert.ok(source.includes('[attr.name]="controlId()"'));
});

test('金额汇总以分累加，避免浮点尾数进入税额与合同', () => {
  const items = [0.1, 0.2].map((amount) => ({
    crmFields: {
      alp_afterdistotal: amount,
      alp_afterdistotalintax: amount === 0.1 ? 0.11 : 0.22,
      quantity: 1,
      alp_refercostup: 0.01,
    },
  }));
  const totals = crmAggregate(items as Parameters<typeof crmAggregate>[0]);
  assert.equal(totals['alp_quototalpriceofftax'], 0.3);
  assert.equal(totals['alp_quototalpriceintax'], 0.33);
  assert.equal(totals['alp_taxfee'], 0.03);
  assert.notEqual(totals['alp_totalgrossprofit'], null);
});

test('固定演示数据独立于CRM证据，字段保存与汇总可复算且不改变输入', async () => {
  const { CRM_QUOTE_DEMO_CASES, CRM_QUOTE_DEMO_POLICY, roundCrmDemoValue } =
    await import('../src/app/core/crm-quote-demo-policy');
  assert.equal(CRM_QUOTE_DEMO_POLICY.id, 'demo-fixed-v1');
  assert.equal(roundCrmDemoValue(1.125, 2), 1.13);
  // This is the local JavaScript policy, not a claim about Dataverse midpoint behavior.
  assert.equal(roundCrmDemoValue(-1.125, 2), -1.12);
  for (const sample of CRM_QUOTE_DEMO_CASES) {
    const before = structuredClone(sample.input);
    const calculated = persistCrmFields(calculateCrmLine(sample.input), CRM_DETAIL_FIELDS);
    for (const [field, expected] of Object.entries(sample.expected))
      assert.equal(calculated[field], expected, sample.id + ':' + field);
    const totals = persistCrmFields(
      crmAggregate([{ ...editableQuote().original.items[0], crmFields: calculated }]),
      CRM_SUMMARY_FIELDS,
    );
    assert.equal(totals['alp_quototalpriceofftax'], sample.expected['alp_afterdistotal']);
    assert.equal(totals['alp_quototalpriceintax'], sample.expected['alp_afterdistotalintax']);
    assert.equal(totals['alp_taxfee'], sample.id === 'DEMO-CALC-01' ? 86.45 : 0.03);
    assert.deepEqual(sample.input, before);
  }
});

test('演示口径由Store采用，保存失败不迁移旧历史或发布演示标记', () => {
  const context = editableQuote();
  const historical = structuredClone(context.store.quoteSeries('DEMO-O014'));
  const input = completeCrmDraft(context.store, context.id);
  assert.equal(input.crmCalculationPolicy, undefined);
  assert.equal(context.store.saveCrmQuote(input), true);
  assert.equal(context.store.quoteVersion(context.id)?.crmCalculationPolicy, 'demo-fixed-v1');
  assert.deepEqual(context.store.quoteSeries('DEMO-O014'), historical);
  const failed = editableQuote();
  const bad = completeCrmDraft(failed.store, failed.id);
  bad.crmFields!['alp_price_list'] = null;
  const before = structuredClone(failed.store.state());
  assert.throws(() => failed.store.saveCrmQuote(bad));
  assert.deepEqual(failed.store.state(), before);
});
