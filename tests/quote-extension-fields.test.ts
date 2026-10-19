import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUOTE_EXTENSION_FIELDS,
  quoteExtensionFieldError,
} from '../src/app/core/field-metadata';
import { DemoState } from '../src/app/core/models';
import { harness } from './v4-harness';

test('报价扩展字段配置覆盖文本、数值、日期、原值枚举、稳定ID关联和只读', () => {
  assert.deepEqual(
    [...new Set(QUOTE_EXTENSION_FIELDS.map((field) => field.kind))].sort(),
    ['date', 'enum', 'lookup', 'number', 'readonly', 'text'],
  );
  const productType = QUOTE_EXTENSION_FIELDS.find((field) => field.logicalName === 'alp_producttype')!;
  assert.deepEqual(productType.options?.map((option) => option.rawValue), [10, 20, 30, 40]);
  const paymentTerms = QUOTE_EXTENSION_FIELDS.find((field) => field.logicalName === 'alp_paymenttermsid')!;
  assert.equal(paymentTerms.lookupTarget, 'alp_paymentterms');
  assert.equal(paymentTerms.options?.[0].id, 'DEMO-PAYTERM-NET30');
  assert.equal(paymentTerms.options?.[0].source, 'simulated');
  assert.equal(paymentTerms.cspdRequired.status, 'unverified');
  assert.equal(paymentTerms.crmRequiredLevel, 'ApplicationRequired');
  assert.equal(QUOTE_EXTENSION_FIELDS.find((field) => field.logicalName === 'versionnumber')?.kind, 'readonly');
  assert.equal(
    QUOTE_EXTENSION_FIELDS.find((field) => field.logicalName === 'alp_approvedad')?.valuePath,
    'QuoteVersion.crmFields.alp_approvedad',
  );
});

test('报价扩展字段按元数据校验并保留原始枚举值和稳定关联ID', () => {
  assert.equal(
    quoteExtensionFieldError({
      alp_approvedad: '销售经理意见待补',
      alp_purchasedamount: 12.5,
      alp_deliverydate: '2026-11-20',
      alp_producttype: 20,
      alp_paymenttermsid: 'DEMO-PAYTERM-NET30',
    }),
    undefined,
  );
  assert.match(quoteExtensionFieldError({ alp_purchasedamount: '12.5' }) || '', /数值/);
  assert.match(quoteExtensionFieldError({ alp_deliverydate: '2026-02-31' }) || '', /有效日期/);
  assert.equal(quoteExtensionFieldError({ alp_deliverydate: '2026-02-28' }), undefined);
  assert.match(quoteExtensionFieldError({ alp_producttype: '20' }) || '', /枚举原值/);
  assert.match(quoteExtensionFieldError({ alp_paymenttermsid: 'Net 30' }) || '', /稳定ID/);
  assert.match(quoteExtensionFieldError({ versionnumber: 3 }) || '', /只读/);
  assert.match(quoteExtensionFieldError({ unknownField: 'value' }) || '', /扩展字段未知/);
});

test('可编辑报价将类型化扩展字段同版本保存并刷新恢复', () => {
  const { store } = harness();
  const version = structuredClone(store.quoteSeries('DEMO-O008')!.versions[0]);
  let persisted = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => persisted || null,
      setItem: (_key: string, value: string) => (persisted = value),
    },
  });

  assert.equal(
    store.saveQuote({
      ...version,
      crmFields: {
        alp_approvedad: '审批意见待补',
        alp_purchasedamount: 12.5,
        alp_deliverydate: '2026-11-20',
        alp_producttype: 20,
        alp_paymenttermsid: 'DEMO-PAYTERM-NET30',
      },
    }),
    true,
  );
  const saved = JSON.parse(persisted) as DemoState;
  assert.deepEqual(
    saved.quoteSeries?.flatMap((series) => series.versions).find((item) => item.id === version.id)?.crmFields,
    {
      alp_approvedad: '审批意见待补',
      alp_purchasedamount: 12.5,
      alp_deliverydate: '2026-11-20',
      alp_producttype: 20,
      alp_paymenttermsid: 'DEMO-PAYTERM-NET30',
    },
  );
  const load = Reflect.get(store, 'load').bind(store) as () => DemoState;
  assert.deepEqual(load().quoteSeries, saved.quoteSeries);
});

test('报价扩展字段拒绝伪造必填、错误枚举类型和来源只读值', () => {
  const { store } = harness();
  const version = structuredClone(store.quoteSeries('DEMO-O008')!.versions[0]);
  const before = structuredClone(store.state());

  assert.throws(
    () => store.saveQuote({ ...version, crmFields: { alp_producttype: '20' } }),
    /枚举原值/,
  );
  assert.throws(
    () => store.saveQuote({ ...version, crmFields: { alp_quotetotalamount: 1234 } }),
    /只读来源字段/,
  );
  assert.deepEqual(store.state(), before);
});
