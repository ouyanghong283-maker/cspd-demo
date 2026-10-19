import { roundCrmDemoValue } from './crm-quote-demo-policy';
import { QuoteItem, QuoteVersion } from './models';
import { CRM_DETAIL_FIELDS, CRM_SUMMARY_FIELDS, CrmField, CrmValues } from './crm-quote-schema';

export interface CrmReference {
  id: string;
  entity: string;
  label: string;
  data: CrmValues;
  workspace?: boolean;
}
export interface CrmPrice {
  id: string;
  priceListId: string;
  productId: string;
  sku?: boolean;
  guide: number | null;
  foreignGuide?: number | null;
  currencyId?: string;
  cost: number | null;
  costWithoutAmortization: number | null;
  minimum: number | null;
}
export interface CrmCatalog {
  capturedAt: string;
  references: CrmReference[];
  prices: CrmPrice[];
  rates: { currencyId: string; rate: number; endDate: string }[];
  paymentStages: { termId: string; label: string; values?: Record<string, string> }[];
  complete: boolean;
  skuLinks: { skuId: string; productId: string; default: boolean; regions: string }[];
}

export const crmNumber = (fields: CrmValues, name: string) => Number(fields[name] ?? 0);
const round2 = (value: number) => Math.round(value * 100) / 100;
/** Local demo persistence policy; apply field precision after the complete source calculation. */
export function persistCrmFields(fields: CrmValues, definitions: readonly CrmField[]): CrmValues {
  const result = { ...fields };
  for (const field of definitions) {
    const value = result[field.name];
    if (typeof value === 'number' && field.precision !== null) {
      result[field.name] = roundCrmDemoValue(value, field.precision);
    }
  }
  return result;
}
const discountFields = [
  'alp_one_way_discount',
  'alp_customer_discount',
  'alp_customer_or_material_discount',
  'alp_discount_materials',
  'alp_special_discounts',
  'alp_rebate',
];

/** Exact operation order of alp_QuoteDetailForm.calculatePriceAndAmount, before field persistence. */
export function calculateCrmLine(input: CrmValues, changed = ''): CrmValues {
  const f = { ...input };
  if (f['alp_isintax'] === 20) f['alp_taxpercentage'] = 0;
  const r = crmNumber(f, 'alp_taxpercentage') / 100;
  let p = crmNumber(f, 'alp_priceperunit');
  let pt = crmNumber(f, 'alp_beforedispriceintax');
  if (changed === 'alp_priceperunit' || (changed === 'alp_taxpercentage' && p > 0)) {
    pt = round2(p * (1 + r));
    f['alp_beforedispriceintax'] = pt;
  } else if (changed === 'alp_beforedispriceintax' || (changed === 'alp_taxpercentage' && pt > 0)) {
    p = round2(pt / (1 + r));
    f['alp_priceperunit'] = p;
  }
  const q = crmNumber(f, 'quantity');
  const freight = crmNumber(f, 'alp_freightfee');
  const before = q * p;
  f['alp_beforedistotal'] = before + freight;
  if (discountFields.every((name) => crmNumber(f, name) === 0)) {
    f['alp_afterdiscountamount'] = p;
    f['alp_afterdispriceintax'] = pt;
    f['alp_afterdistotal'] = before + freight;
    f['alp_beforedistotalintax'] = q * pt + round2(freight * (1 + r));
    f['alp_afterdistotalintax'] = f['alp_beforedistotalintax'];
    f['alp_totaldiscountprice'] = 0;
    f['alp_totaldiscountpriceintax'] = 0;
  } else {
    const base =
      before -
      (crmNumber(f, 'alp_one_way_discount') / 100) * before -
      crmNumber(f, 'alp_customer_or_material_discount') * q -
      crmNumber(f, 'alp_discount_materials') * q -
      crmNumber(f, 'alp_special_discounts') -
      crmNumber(f, 'alp_rebate') +
      freight;
    const after = Math.max(0, base - (base * crmNumber(f, 'alp_customer_discount')) / 100);
    const unit = q === 0 ? 0 : after / q;
    const grossUnit = unit * (1 + r);
    f['alp_afterdiscountamount'] = unit;
    f['alp_afterdispriceintax'] = grossUnit;
    f['alp_afterdistotal'] = after;
    // Source intentionally treats freight differently in this branch.
    f['alp_beforedistotalintax'] = q * pt + freight;
    f['alp_afterdistotalintax'] = q * grossUnit;
    f['alp_totaldiscountprice'] = q * (p - unit) + freight;
    f['alp_totaldiscountpriceintax'] = q * (pt - grossUnit) + freight;
  }
  for (const [unit, total] of [
    ['alp_salesguidanceprice', 'alp_guidancetotalprice'],
    ['alp_minimumgpup', 'alp_minimumgptp'],
    ['alp_refercostup', 'alp_refertotalcost'],
    ['alp_refercost_noamortize', 'alp_refertotalcost_noamortize'],
  ])
    f[total] = f[unit] == null ? null : crmNumber(f, unit) * q;
  return f;
}

/** .NET Convert.ToInt32(decimal): nearest integer, ties to even. */
export function crmInteger(value: number): number {
  const lower = Math.floor(value);
  return value - lower === 0.5 ? (lower % 2 === 0 ? lower : lower + 1) : Math.round(value);
}

export function crmAggregate(items: QuoteItem[]): CrmValues {
  // Aggregate persisted decimal fields in cents; leave source line calculations unchanged.
  const rows = items.map((item) => persistCrmFields(item.crmFields || {}, CRM_DETAIL_FIELDS));
  const cents = (value: number) => Math.round(value * 100);
  const sum = (name: string) =>
    rows.reduce((value, fields) => value + cents(crmNumber(fields, name)), 0) / 100;
  let revenue = 0;
  let cost = 0;
  let missingCost = false;
  for (const f of rows) {
    if (String(f['productCode'] || '').startsWith('S.')) continue;
    revenue += cents(crmNumber(f, 'alp_afterdistotal'));
    const noAmortization = crmNumber(f, 'alp_refertotalcost_noamortize');
    const regular = crmNumber(f, 'alp_refertotalcost');
    if (
      f['alp_refertotalcost'] == null &&
      f['alp_refertotalcost_noamortize'] == null &&
      f['alp_refercostup'] == null &&
      f['alp_refercost_noamortize'] == null
    )
      missingCost = true;
    if (
      (!regular || !noAmortization) &&
      f['quantity'] != null &&
      (f['alp_refercostup'] != null || f['alp_refercost_noamortize'] != null)
    ) {
      cost += cents(
        crmInteger(crmNumber(f, 'quantity')) *
          (crmNumber(f, 'alp_refercost_noamortize') > 0
            ? crmNumber(f, 'alp_refercost_noamortize')
            : crmNumber(f, 'alp_refercostup')),
      );
    } else cost += cents(noAmortization > 0 ? noAmortization : regular);
  }
  const net = sum('alp_afterdistotal');
  const gross = sum('alp_afterdistotalintax');
  return {
    alp_quototalpriceofftax: net,
    alp_quototalpriceintax: gross,
    alp_quotetotalamount: gross,
    alp_taxfee: (cents(gross) - cents(net)) / 100,
    alp_total_shipping_cost: sum('alp_freightfee'),
    alp_totaldiscountpricesum: sum('alp_totaldiscountprice'),
    alp_beforedistotalsum: sum('alp_beforedistotal'),
    // Preserve source incompleteness; do not present absent cost as an established 100% margin.
    alp_totalgrossprofit:
      revenue > 0 ? (missingCost ? null : ((revenue - cost) * 100) / revenue) : 0,
  };
}

export function crmFieldVisible(
  field: CrmField,
  fields: CrmValues,
  summary: CrmValues,
  organizationCode = '',
): boolean {
  if (field.name === 'alp_price_list') return !fields['alp_sku_pricelevelid'];
  if (discountFields.includes(field.name))
    return ['8210', '8220', '8250', '8270'].includes(organizationCode);
  return field.visible;
}
export function crmFieldReadonly(field: CrmField, fields: CrmValues, hasItems: boolean): boolean {
  return (
    field.readonly ||
    (['alp_tax_rate', 'alp_taxpercentage'].includes(field.name) && fields['alp_isintax'] === 20) ||
    (hasItems &&
      ['transactioncurrencyid', 'alp_price_list', 'alp_salesbranch'].includes(field.name))
  );
}
export function crmFieldRequired(field: CrmField, fields: CrmValues): boolean {
  return field.name === 'alp_price_list' ? !fields['alp_sku_pricelevelid'] : field.required;
}

export function crmFieldErrors(
  fields: CrmValues,
  definitions: readonly CrmField[],
  submit: boolean,
): string[] {
  return definitions.flatMap((field) => {
    const value = fields[field.name];
    if (value === null || value === undefined || value === '')
      return submit && crmFieldRequired(field, fields) ? [`请填写${field.label}`] : [];
    if (!['string', 'number', 'boolean'].includes(typeof value)) return [`${field.label}格式无效`];
    if (typeof value === 'number' && !Number.isFinite(value))
      return [`${field.label}必须为有限数字`];
    if (['string', 'memo', 'lookup', 'datetime'].includes(field.type) && typeof value !== 'string')
      return [`${field.label}格式无效`];
    if (field.type === 'boolean' && typeof value !== 'boolean') return [`${field.label}格式无效`];
    if (
      typeof value === 'number' &&
      field.name !== 'revisionnumber' &&
      ((field.min !== null && value < field.min) || (field.max !== null && value > field.max))
    )
      return [`${field.label}超出允许范围`];
    if (field.readonly) return [];
    if (field.options.length && !field.options.some((option) => option.value === value))
      return [`${field.label}选项无效`];
    if (['decimal', 'double', 'integer', 'money'].includes(field.type)) {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return [`${field.label}必须为有效数字`];
      if ((field.min !== null && value < field.min) || (field.max !== null && value > field.max))
        return [`${field.label}超出允许范围`];
      if (field.precision === 0 && !Number.isInteger(value)) return [`${field.label}必须为整数`];
    }
    if (
      field.type === 'datetime' &&
      (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)))
    )
      return [`${field.label}日期无效`];
    if (typeof value === 'string' && field.maxLength && value.length > field.maxLength)
      return [`${field.label}最多${field.maxLength}字`];
    return [];
  });
}

export function crmReferences(
  catalog: CrmCatalog,
  field: CrmField,
  summary: CrmValues,
  line: CrmValues = {},
): CrmReference[] {
  let rows = catalog.references.filter((row) => field.targets.includes(row.entity));
  // Scoped synthetic catalogs cannot leak into another opportunity or currency.
  rows = rows.filter(
    (row) =>
      row.data['origin'] !== 'v9-local-demo' ||
      ((!row.data['opportunityid'] || row.data['opportunityid'] === summary['opportunityid']) &&
        (!row.data['transactioncurrencyid'] ||
          row.data['transactioncurrencyid'] === summary['transactioncurrencyid'])),
  );
  if (field.name === 'alp_paymenttermsid') {
    rows = rows.filter(
      (row) => row.data['statecode'] === 0 && row.data['alp_payment_state'] === 20,
    );
    // User explicitly excluded customer-specific payment-term relationships on 2026-10-16.
  }
  if (field.name === 'alp_productcode') {
    const sku = line['alp_skuid'];
    if (sku) {
      const opportunity = catalog.references.find((row) => row.id === summary['opportunityid']);
      const region = opportunity?.data['alp_region'];
      const links = catalog.skuLinks.filter(
        (link) =>
          link.skuId === sku &&
          (!region ||
            !link.regions ||
            link.regions
              .split(',')
              .map((value) => value.trim())
              .includes(String(region))),
      );
      rows = rows.filter((row) => links.some((link) => link.productId === row.id));
    } else
      rows = rows.filter((row) =>
        catalog.prices.some(
          (price) =>
            !price.sku &&
            price.priceListId === summary['alp_price_list'] &&
            price.productId === row.id,
        ),
      );
  }
  if (field.name === 'alp_skuid')
    rows = rows.filter((row) =>
      catalog.prices.some(
        (price) =>
          price.sku &&
          price.priceListId === summary['alp_sku_pricelevelid'] &&
          price.productId === row.id,
      ),
    );
  return rows;
}

export function applyCrmProduct(
  fields: CrmValues,
  summary: CrmValues,
  catalog: CrmCatalog,
): CrmValues {
  const sku = !!fields['alp_skuid'];
  const price = catalog.prices.find(
    (row) =>
      !!row.sku === sku &&
      row.priceListId === summary[sku ? 'alp_sku_pricelevelid' : 'alp_price_list'] &&
      row.productId === fields[sku ? 'alp_skuid' : 'alp_productcode'],
  );
  const product = catalog.references.find(
    (row) => row.entity === 'product' && row.id === fields['alp_productcode'],
  );
  const rate =
    catalog.rates
      .filter((row) => row.currencyId === summary['transactioncurrencyid'])
      .sort((a, b) => b.endDate.localeCompare(a.endDate))[0]?.rate ?? 1;
  const convert = (value: number | null | undefined) => (value == null ? null : value * rate);
  return {
    ...fields,
    productname: product?.label || null,
    productCode: product?.data['alp_product_code'] || null,
    alp_product_description:
      fields['alp_product_description'] ??
      product?.data['alp_material_description_long_en'] ??
      null,
    alp_salesguidanceprice:
      sku && price && price.currencyId === summary['transactioncurrencyid']
        ? (price.foreignGuide ?? null)
        : convert(price?.guide),
    alp_refercostup: convert(price?.cost),
    alp_refercost_noamortize: convert(
      price && (price.costWithoutAmortization ?? 0) > 0
        ? price.costWithoutAmortization
        : price?.cost,
    ),
    alp_minimumgpup: convert(price?.minimum),
  };
}

/** Safe bridge for drafts predating the CRM form. Does not overwrite the stored historical record. */
export function crmDraftFields(
  version: QuoteVersion,
  opportunityId: string,
  quoteNumber: string,
): CrmValues {
  const trade = CRM_SUMMARY_FIELDS.find((field) => field.name === 'alp_trade_terms')?.options.find(
    (option) => option.label === version.tradeTerm,
  )?.value;
  return {
    quotenumber: quoteNumber,
    revisionnumber: version.number - 1,
    opportunityid: opportunityId,
    customerid: version.customerId,
    alp_bdmanager: version.owner || null,
    closedon: version.validUntil || null,
    description: version.notes || null,
    ...(trade !== undefined ? { alp_trade_terms: trade } : {}),
    ...(version.crmFields || {}),
  };
}

export function crmLineFields(item: QuoteItem, version: QuoteVersion): CrmValues {
  return {
    quoteid: version.id,
    alp_quotedetailnumber: item.id,
    quantity: item.quantity,
    alp_priceperunit: item.unitPrice,
    alp_one_way_discount: item.discountPercent ?? 0,
    alp_product_description: item.spec || null,
    ...(item.crmFields || {}),
  };
}

export function crmQuoteErrors(
  version: QuoteVersion,
  catalog: CrmCatalog,
  submit: boolean,
): string[] {
  const fields = version.crmFields || {};
  const errors = crmFieldErrors(fields, CRM_SUMMARY_FIELDS, submit);
  for (const field of CRM_SUMMARY_FIELDS.filter(
    (candidate) =>
      candidate.type === 'lookup' &&
      (!candidate.readonly || candidate.name === 'alp_sku_pricelevelid'),
  )) {
    const value = fields[field.name];
    if (value && !crmReferences(catalog, field, fields).some((row) => row.id === value))
      errors.push(`${field.label}不属于当前可用的本地资料`);
  }
  const created = version.crmCreatedOn;
  if (created && fields['closedon'] && String(fields['closedon']) > addCrmDays(created, 90))
    errors.push('失效日期不能超过创建日期加90天');
  if (submit && !version.items.length) errors.push('请添加报价明细');
  for (const [index, item] of version.items.entries()) {
    const line = item.crmFields || {};
    errors.push(
      ...crmFieldErrors(line, CRM_DETAIL_FIELDS, submit).map(
        (error) => `第${index + 1}行：${error}`,
      ),
    );
    if (
      submit &&
      !catalog.references.some(
        (row) => row.entity === 'product' && row.id === line['alp_productcode'],
      )
    )
      errors.push(`第${index + 1}行请选择本地快照中的产品`);
    if (
      submit &&
      !line['alp_skuid'] &&
      !catalog.prices.some(
        (row) =>
          !row.sku &&
          row.priceListId === fields['alp_price_list'] &&
          row.productId === line['alp_productcode'] &&
          (row.guide ?? 0) > 0,
      )
    )
      errors.push(`第${index + 1}行产品缺少所选价目表的有效指导价`);
    if (submit && fields['alp_sku_pricelevelid'] && !line['alp_skuid'])
      errors.push(`第${index + 1}行请选择SKU`);
    if (
      submit &&
      line['alp_skuid'] &&
      !catalog.prices.some(
        (row) =>
          row.sku &&
          row.priceListId === fields['alp_sku_pricelevelid'] &&
          row.productId === line['alp_skuid'],
      )
    )
      errors.push(`第${index + 1}行SKU不属于当前SKU定价`);
    if (
      submit &&
      !crmReferences(
        catalog,
        CRM_DETAIL_FIELDS.find((field) => field.name === 'alp_productcode')!,
        fields,
        line,
      ).some((row) => row.id === line['alp_productcode'])
    )
      errors.push(`第${index + 1}行产品不属于当前价目表或SKU销售地区`);
  }
  return errors;
}

export function addCrmDays(date: string, days: number): string {
  const value = new Date(date.slice(0, 10) + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function syncCrmAliases(version: QuoteVersion, catalog: CrmCatalog): void {
  const f = version.crmFields || {};
  const currency = catalog.references.find((row) => row.id === f['transactioncurrencyid']);
  version.currency = String(currency?.data['isocurrencycode'] || version.currency);
  version.validUntil = String(f['closedon'] || '');
  version.delivery = String(f['alp_deliverydate'] || '');
  const term = catalog.references.find((row) => row.id === f['alp_paymenttermsid']);
  version.payment = String(
    term?.data['alp_description_cn'] || term?.data['alp_description_en'] || term?.label || '',
  );
  version.tradeTerm =
    CRM_SUMMARY_FIELDS.find((field) => field.name === 'alp_trade_terms')?.options.find(
      (option) => option.value === f['alp_trade_terms'],
    )?.label || '';
  version.notes = String(f['description'] || '');
  version.taxMode = f['alp_isintax'] === 10 ? '含税' : '未税';
  version.vatAmount = crmNumber(f, 'alp_taxfee');
  for (const item of version.items) {
    const line = item.crmFields || {};
    item.quantity = crmNumber(line, 'quantity');
    item.unitPrice = crmNumber(line, 'alp_priceperunit');
    item.discountPercent = crmNumber(line, 'alp_one_way_discount');
    item.name =
      catalog.references.find((row) => row.id === line['alp_productcode'])?.label || item.name;
    item.spec = String(line['alp_product_description'] || '');
    item.unit = String(
      catalog.references.find((row) => row.id === line['alp_productcode'])?.data[
        'alp_material_unit'
      ] ||
        item.unit ||
        '',
    );
    item.guidePrice =
      typeof line['alp_salesguidanceprice'] === 'number' ? line['alp_salesguidanceprice'] : null;
    item.guideCurrency = version.currency;
  }
}
