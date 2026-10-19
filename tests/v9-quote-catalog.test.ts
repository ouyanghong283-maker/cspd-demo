import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRM_QUOTE_CATALOG } from '../src/app/core/crm-quote-reference';
import {
  withCrmQuoteDemoCatalog,
  CRM_QUOTE_DEMO_SCENARIOS,
  checkCrmQuoteDemoCatalog,
} from '../src/app/core/crm-quote-demo-catalog';
import { crmReferences } from '../src/app/core/crm-quote';
import { CRM_SUMMARY_FIELDS } from '../src/app/core/crm-quote-schema';
test('三套目录幂等接入，保留编辑且不扩宽指定商机关联', () => {
  const catalog = withCrmQuoteDemoCatalog(CRM_QUOTE_CATALOG);
  assert.equal(CRM_QUOTE_DEMO_SCENARIOS.length, 3);
  assert.deepEqual(checkCrmQuoteDemoCatalog(catalog), []);
  const s = CRM_QUOTE_DEMO_SCENARIOS[0];
  catalog.references.find((r) => r.id === s.priceListId)!.label = '用户已修改';
  const again = withCrmQuoteDemoCatalog(catalog);
  assert.equal(again.references.length, catalog.references.length);
  assert.equal(again.references.find((r) => r.id === s.priceListId)!.label, '用户已修改');
  const field = CRM_SUMMARY_FIELDS.find((f) => f.name === 'alp_price_list')!;
  const rows = crmReferences(catalog, field, {
    opportunityid: 'DEMO-O008',
    transactioncurrencyid: s.currencyId,
  });
  assert.ok(rows.some((r) => r.id === s.priceListId));
  assert.ok(!rows.some((r) => r.id === CRM_QUOTE_DEMO_SCENARIOS[1].priceListId));
});

import { harness } from './v4-harness';
import { applyCrmProduct, calculateCrmLine } from '../src/app/core/crm-quote';
function scenarioDraft(store: ReturnType<typeof harness>['store'], index: number) {
  const s = CRM_QUOTE_DEMO_SCENARIOS[index];
  const original = store.quoteSeries(s.opportunityId)!.versions[0];
  original.status = '草稿';
  const draft = store.crmQuoteDraft(original);
  Object.assign(draft.crmFields!, {
    transactioncurrencyid: s.currencyId,
    alp_price_list: s.priceListId,
    alp_salesbranch: s.organizationId,
    alp_paymenttermsid: s.paymentTermId,
    alp_quotation_type: 10,
    alp_trade_terms: s.tradeTerm,
    alp_isintax: 20,
    alp_tax_rate: 0,
    closedon: '2026-11-09',
  });
  draft.items = s.productIds.map((id, i) => ({
    id: `${draft.id}-CAT-${i}`,
    category: '货物',
    name: '',
    spec: '',
    unit: '',
    quantity: 2,
    unitPrice: 1200,
    source: '本地模拟目录',
    crmPriceInput: 'alp_priceperunit',
    crmFields: calculateCrmLine(
      applyCrmProduct(
        {
          alp_productcode: id,
          quoteid: draft.id,
          transactioncurrencyid: s.currencyId,
          quantity: 2,
          alp_priceperunit: 1200,
          alp_beforedispriceintax: 1200,
          alp_isintax: 20,
          alp_taxpercentage: 0,
          propertyconfigurationstatus: 2,
        },
        draft.crmFields!,
        store.crmQuoteCatalog(),
      ),
      'alp_priceperunit',
    ),
  }));
  return draft;
}
test('三套目录经公开报价保存，持久化刷新保留原选择与历史报价', () => {
  const { store } = harness();
  let persisted = '';
  globalThis.localStorage.setItem = (_key, value) => {
    persisted = value;
  };
  const history = structuredClone(store.quoteSeries('DEMO-O005'));
  for (let i = 0; i < 3; i++) {
    const draft = scenarioDraft(store, i);
    assert.equal(store.saveCrmQuote(draft), true);
    const fresh = JSON.parse(persisted);
    assert.equal(
      fresh.quoteSeries.find((s: any) => s.id === draft.seriesId).versions[0].crmFields
        .alp_price_list,
      CRM_QUOTE_DEMO_SCENARIOS[i].priceListId,
    );
  }
  assert.deepEqual(store.quoteSeries('DEMO-O005'), history);
});
test('改变币种或跨商机目录要求重选，保存失败保留输入和已提交历史', () => {
  const { store } = harness();
  const draft = scenarioDraft(store, 0);
  const before = structuredClone(store.state());
  draft.crmFields!.transactioncurrencyid = CRM_QUOTE_DEMO_SCENARIOS[1].currencyId;
  assert.throws(() => store.saveCrmQuote(draft), /价目表/);
  assert.deepEqual(store.state(), before);
  draft.crmFields!.transactioncurrencyid = CRM_QUOTE_DEMO_SCENARIOS[0].currencyId;
  const input = structuredClone(draft);
  globalThis.localStorage.setItem = () => {
    throw new Error('quota');
  };
  assert.throws(() => store.saveCrmQuote(draft), /保存失败|quota|存储/);
  assert.deepEqual(draft, input);
  assert.deepEqual(store.state(), before);
});
test('完整性检查报告重复ID、断引用和缺场景', () => {
  const catalog = withCrmQuoteDemoCatalog(CRM_QUOTE_CATALOG);
  catalog.references.push(catalog.references.find((r) => r.id === 'V9-QTE-PAYMENT')!);
  catalog.references = catalog.references.filter((r) => r.id !== 'V9-QTE-02-PRODUCT-1');
  const errors = checkCrmQuoteDemoCatalog(catalog);
  assert.ok(errors.some((e) => e.includes('重复')));
  assert.ok(errors.some((e) => e.includes('断引用')));
  assert.ok(errors.some((e) => e.includes('场景缺项：V9-QTE-02')));
});
test('上游价目表失配不会替换产品，原选择须重选后才能保存', () => {
  const { store } = harness();
  const draft = scenarioDraft(store, 0);
  const product = draft.items[0].crmFields!.alp_productcode;
  draft.crmFields!.alp_price_list = CRM_QUOTE_DEMO_SCENARIOS[1].priceListId;
  assert.throws(() => store.saveCrmQuote(draft), /价目表|指导价/);
  assert.equal(draft.items[0].crmFields!.alp_productcode, product);
});
test('只读SKU价目表的失效原引用仍须解释并阻断错币种组合', () => {
  const catalog = withCrmQuoteDemoCatalog(CRM_QUOTE_CATALOG);
  const field = CRM_SUMMARY_FIELDS.find((f) => f.name === 'alp_sku_pricelevelid')!;
  const rows = crmReferences(catalog, field, {
    opportunityid: 'DEMO-O008',
    transactioncurrencyid: CRM_QUOTE_DEMO_SCENARIOS[1].currencyId,
  });
  assert.ok(!rows.some((r) => r.id === CRM_QUOTE_DEMO_SCENARIOS[0].skuPriceListId));
});
