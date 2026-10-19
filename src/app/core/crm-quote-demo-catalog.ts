import type { CrmCatalog, CrmReference } from './crm-quote';

/** Synthetic local catalog only. IDs and relations never identify externally synced CRM records. */
export const CRM_QUOTE_DEMO_SCENARIOS = [
  {
    id: 'V9-QTE-01',
    opportunityId: 'DEMO-O008',
    currency: 'EUR',
    tradeTerm: 749010000,
    label: '常规储能',
    products: 1,
  },
  {
    id: 'V9-QTE-02',
    opportunityId: 'DEMO-O003',
    currency: 'USD',
    tradeTerm: 749010001,
    label: '美元贸易',
    products: 1,
  },
  {
    id: 'V9-QTE-03',
    opportunityId: 'DEMO-O014',
    currency: 'EUR',
    tradeTerm: 749010000,
    label: '多产品',
    products: 2,
  },
].map((s) => ({
  ...s,
  currencyId: `V9-QTE-CURRENCY-${s.currency}`,
  priceListId: `${s.id}-PRICE`,
  skuPriceListId: `${s.id}-SKU-PRICE`,
  paymentTermId: 'V9-QTE-PAYMENT',
  organizationId: 'V9-QTE-ORG',
  productIds: Array.from({ length: s.products }, (_, i) => `${s.id}-PRODUCT-${i + 1}`),
}));

/** Existing rows win, including user edits. No mutation, storage write, or historical backfill. */
export function withCrmQuoteDemoCatalog(base: CrmCatalog): CrmCatalog {
  const references: CrmReference[] = [];
  const prices: CrmCatalog['prices'] = [];
  const skuLinks: CrmCatalog['skuLinks'] = [];
  const add = (id: string, entity: string, label: string, data: CrmReference['data'] = {}) =>
    references.push({
      id,
      entity,
      label: `${label}（本地模拟）`,
      workspace: true,
      data: { origin: 'v9-local-demo', source: 'V9 报价目录合成资料；非外部同步', ...data },
    });
  add('V9-QTE-PAYMENT', 'alp_paymentterms', '演示付款条款', {
    statecode: 0,
    alp_payment_state: 20,
  });
  add('V9-QTE-ORG', 'alp_sales_organization', '演示销售组织', {
    alp_salesorganizationcode: '8210',
  });
  for (const s of CRM_QUOTE_DEMO_SCENARIOS) {
    add(s.currencyId, 'transactioncurrency', s.currency, {
      isocurrencycode: s.currency,
      statecode: 0,
    });
    const scope = { opportunityid: s.opportunityId, transactioncurrencyid: s.currencyId };
    add(s.priceListId, 'alp_pricelevel', s.label + '价目表', scope);
    add(s.skuPriceListId, 'alp_sku_pricelevel', s.label + 'SKU定价', scope);
    for (const [i, productId] of s.productIds.entries()) {
      add(productId, 'product', s.label + (i ? '配套设备' : '储能设备'), {
        alp_product_code: `DEMO-${s.id}-${i + 1}`,
        alp_material_unit: 'EA',
        alp_material_description_long_en: 'Synthetic demo storage equipment',
      });
      const skuId = productId + '-SKU';
      add(skuId, 'alp_product_model', s.label + 'SKU ' + (i + 1), scope);
      prices.push({
        id: productId + '-PRICE',
        priceListId: s.priceListId,
        productId,
        guide: 1000 + i * 200,
        cost: 600,
        minimum: 700,
        costWithoutAmortization: 600,
        currencyId: s.currencyId,
      });
      prices.push({
        id: skuId + '-PRICE',
        priceListId: s.skuPriceListId,
        productId: skuId,
        sku: true,
        guide: 1000 + i * 200,
        foreignGuide: 1000 + i * 200,
        cost: 600,
        minimum: 700,
        costWithoutAmortization: 600,
        currencyId: s.currencyId,
      });
      skuLinks.push({ skuId, productId, default: true, regions: '' });
    }
  }
  const merge = <T extends { id: string }>(existing: T[], added: T[]) => [
    ...existing,
    ...added.filter(
      (r, i) => !existing.some((e) => e.id === r.id) && added.findIndex((e) => e.id === r.id) === i,
    ),
  ];
  return {
    ...base,
    references: merge(base.references, references),
    prices: merge(base.prices, prices),
    skuLinks: [
      ...base.skuLinks,
      ...skuLinks.filter(
        (r) => !base.skuLinks.some((e) => e.skuId === r.skuId && e.productId === r.productId),
      ),
    ],
    rates: [
      ...base.rates,
      ...CRM_QUOTE_DEMO_SCENARIOS.filter(
        (s, i, a) =>
          a.findIndex((e) => e.currencyId === s.currencyId) === i &&
          !base.rates.some((r) => r.currencyId === s.currencyId),
      ).map((s) => ({ currencyId: s.currencyId, rate: 1, endDate: '2026-10-17' })),
    ],
    paymentStages: base.paymentStages.some((r) => r.termId === 'V9-QTE-PAYMENT')
      ? base.paymentStages
      : [...base.paymentStages, { termId: 'V9-QTE-PAYMENT', label: '演示全额付款' }],
  };
}

export function checkCrmQuoteDemoCatalog(catalog: CrmCatalog): string[] {
  const errors: string[] = [];
  for (const [name, rows] of [
    ['reference', catalog.references],
    ['price', catalog.prices],
  ] as const) {
    const ids = new Set<string>();
    for (const r of rows) {
      if (ids.has(r.id)) errors.push(`重复${name} ID：${r.id}`);
      ids.add(r.id);
    }
  }
  const has = (id: string) => catalog.references.some((r) => r.id === id);
  for (const p of catalog.prices.filter((p) => p.id.startsWith('V9-QTE-')))
    if (!has(p.productId) || !has(p.priceListId) || !has(p.currencyId || ''))
      errors.push(`价格断引用：${p.id}`);
  for (const l of catalog.skuLinks.filter((l) => l.skuId.startsWith('V9-QTE-')))
    if (!has(l.skuId) || !has(l.productId)) errors.push(`SKU断引用：${l.skuId}`);
  for (const s of CRM_QUOTE_DEMO_SCENARIOS)
    if (
      ![
        s.currencyId,
        s.priceListId,
        s.skuPriceListId,
        s.paymentTermId,
        s.organizationId,
        ...s.productIds,
      ].every(has) ||
      !s.productIds.every((id) =>
        catalog.prices.some((p) => p.productId === id && p.priceListId === s.priceListId),
      )
    )
      errors.push(`场景缺项：${s.id}`);
  return errors;
}
