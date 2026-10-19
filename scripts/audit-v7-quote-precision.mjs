/** Offline audit of saved GET evidence; no network or application writes. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateCrmLine } from '../src/app/core/crm-quote.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'doc/字段资料/V7_CRM只读取证');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const source = read('quote-full-precision-source_2026-10-16.json');
const mappings = JSON.parse(
  fs.readFileSync(path.join(root, 'my demo/src/app/core/quote-field-map.json'), 'utf8'),
);
const currencies = JSON.parse(source.results[5].raw).value;
const organizationPrecision = JSON.parse(source.results[4].raw).value[0].pricingdecimalprecision;
const precision = source.results.slice(0, 4).flatMap((response) => {
  if (response.status !== 200) throw Error('Incomplete metadata');
  const entity = response.request.includes("LogicalName='quotedetail'") ? 'quotedetail' : 'quote';
  const type = response.request.includes('MoneyAttributeMetadata') ? 'Money' : 'Decimal';
  return JSON.parse(response.raw).value.map((field) => ({
    entity,
    name: field.LogicalName,
    type,
    precision: field.Precision,
    precisionSource: field.PrecisionSource ?? null,
    sourceType: field.SourceType,
    formula: field.FormulaDefinition ?? null,
    effectivePrecision:
      type === 'Decimal' || field.PrecisionSource === 0
        ? field.Precision
        : field.PrecisionSource === 1
          ? organizationPrecision
          : Object.fromEntries(currencies.map((c) => [c.isocurrencycode, c.currencyprecision])),
    mappingPresent: mappings.some(
      (m) => m.entity === entity && m.logicalName === field.LogicalName,
    ),
  }));
});
if (precision.length !== 85 || precision.some((f) => !f.mappingPresent))
  throw Error('Precision coverage mismatch');
const names = [
  'alp_afterdiscountamount',
  'alp_afterdispriceintax',
  'alp_afterdistotal',
  'alp_afterdistotalintax',
];
function audit(rows) {
  const result = {
    records: rows.length,
    compared: 0,
    matches: 0,
    completeMatches: [],
    inputWarnings: [],
    ties: [],
    differences: [],
  };
  for (const row of rows) {
    const calculated = calculateCrmLine(row);
    let complete = true,
      allMatch = true;
    if (row.alp_priceperunit == null)
      result.inputWarnings.push({ id: row.quotedetailid, reason: '未税单价为空' });
    if (row.alp_isintax === 20 && row.alp_taxpercentage)
      result.inputWarnings.push({ id: row.quotedetailid, reason: '未税模式与非零税率并存' });
    for (const field of names) {
      if (row[field] == null) {
        complete = false;
        continue;
      }
      result.compared++;
      const computed = Number(calculated[field]),
        rounded = Math.round(computed * 100) / 100,
        stored = row[field],
        matched = Math.abs(rounded - stored) < 1e-7;
      const value = { id: row.quotedetailid, field, computed, rounded, stored };
      if (matched) result.matches++;
      else {
        allMatch = false;
        result.differences.push(value);
      }
      if (Math.abs((Math.abs(computed * 100) % 1) - 0.5) < 1e-7)
        result.ties.push({ ...value, matched });
    }
    if (complete && allMatch) result.completeMatches.push(row.quotedetailid);
  }
  return result;
}
const historical = read('quote-implementation-extra-source.json').result.find(
  (r) => r.key === 'rounding',
).data.value;
const recent = JSON.parse(read('quote-recent-200-source_2026-10-16.json').raw).value;
const report = {
  method: '离线数值吻合不证明历史执行；中点候选不证明统一平台舍入策略',
  capturedAt: source.capturedAt,
  organizationPrecision,
  currencies: currencies.map((c) => ({ code: c.isocurrencycode, precision: c.currencyprecision })),
  precision,
  historical: audit(historical),
  recent: audit(recent),
};
fs.writeFileSync(
  path.join(dir, 'quote-precision-audit_2026-10-16.json'),
  JSON.stringify(report, null, 2) + '\n',
);
const table = [
  '# 报价完整数值字段精度（2026-10-16）',
  '',
  '来源：`quote-full-precision-source_2026-10-16.json`。85字段全部关联原355字段映射。',
  '',
  'Money PrecisionSource：0字段自身，1组织定价精度（当前2），2记录关联币种精度。Decimal直接采用字段Precision；基础币种字段保留元数据，不擅自覆盖。',
  '',
  '| 实体 | 字段 | 类型 | Precision | PrecisionSource | 有效精度 | SourceType/公式 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...precision.map(
    (f) =>
      `| ${f.entity} | ${f.name} | ${f.type} | ${f.precision} | ${f.precisionSource ?? '—'} | ${typeof f.effectivePrecision === 'number' ? f.effectivePrecision : '关联币种（下表）'} | ${f.sourceType}${f.formula ? '；原始公式已保存' : ''} |`,
  ),
  '',
  '| 币种 | 当前配置精度 |',
  '| --- | --- |',
  ...currencies.map((c) => `| ${c.isocurrencycode} | ${c.currencyprecision} |`),
  '',
  'PrecisionSource解释：[Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.xrm.sdk.metadata.moneyattributemetadata.precisionsource?view=dataverse-sdk-latest)。这不证明中点舍入规则。',
  '',
];
fs.writeFileSync(path.join(dir, '报价完整数值字段精度_2026-10-16.md'), table.join('\n'));
const summary = (r) => ({
  records: r.records,
  compared: r.compared,
  matches: r.matches,
  differences: r.differences.length,
  completeMatches: r.completeMatches.length,
  ties: r.ties.length,
  matchedTies: r.ties.filter((t) => t.matched),
  inputWarnings: r.inputWarnings.length,
});
console.log(
  JSON.stringify(
    {
      fields: precision.length,
      formulaFields: precision.filter((f) => f.formula).map((f) => f.entity + '.' + f.name),
      historical: summary(report.historical),
      recent: summary(report.recent),
    },
    null,
    2,
  ),
);
