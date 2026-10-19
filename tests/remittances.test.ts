import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ContractInvoice } from '../src/app/core/invoices';
import {
  BankReceiptClaim,
  BankReceiptClaimLine,
  exceedsReceiptAmount,
  remittancePrimaryLineId,
  remittanceReceiptId,
  summarizeRemittance,
  toInvoiceReceiptClaims,
  validateClaimLine,
} from '../src/app/core/remittances';
import type { SalesOrder } from '../src/app/core/orders';
import {
  classifyRemittanceField,
  remittanceFieldReviewFlags,
  RemittanceFieldMapping,
  RemittanceFieldSourceValues,
} from '../src/app/core/remittance-field-map';

const fieldSourceUrl = new URL(
  '../../doc/PRD/DEMO%20PRD/V7PRD/%E9%99%84%E4%BB%B6/01_%E6%A0%87%E5%87%86CRM%E5%85%A8%E9%87%8F%E5%AD%97%E6%AE%B5%E5%8E%BB%E5%90%91.csv',
  import.meta.url,
);
const formSourceUrl = new URL(
  '../../doc/PRD/DEMO%20PRD/V7PRD/%E9%99%84%E4%BB%B6/02_%E5%BD%93%E5%89%8D%E4%B8%BB%E8%A1%A8%E5%8D%95%E5%AD%97%E6%AE%B5%E5%AE%9A%E4%BD%8D.csv',
  import.meta.url,
);
const mapUrl = new URL('../src/app/core/remittance-field-map.json', import.meta.url);
const FIELD_SOURCE = 'doc/PRD/DEMO PRD/V7PRD/附件/01_标准CRM全量字段去向.csv';
const FORM_SOURCE = 'doc/PRD/DEMO PRD/V7PRD/附件/02_当前主表单字段定位.csv';

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;
  for (let index = source.charCodeAt(0) === 0xfeff ? 1 : 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') inQuotes = false;
      else value += character;
    } else if (character === '"') inQuotes = true;
    else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else value += character;
  }
  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function readCsv(url: URL): Record<string, string>[] {
  const [header, ...records] = parseCsv(readFileSync(fileURLToPath(url), 'utf8'));
  assert.ok(header?.length, `CSV source is empty: ${url.pathname}`);
  return records
    .filter((record) => record.some((value) => value !== ''))
    .map((record) => Object.fromEntries(header.map((column, index) => [column, record[index] || ''])));
}

const sourceRecords = readCsv(fieldSourceUrl)
  .map((row, index) => ({ row, sourceLine: index + 2 }))
  .filter(({ row }) => ['alp_claim_water_bill', 'alp_water_bill_claim_details'].includes(row['CRM实体逻辑名']));
const formLines = new Map<string, number[]>();
for (const [index, row] of readCsv(formSourceUrl).entries()) {
  if (!['alp_claim_water_bill', 'alp_water_bill_claim_details'].includes(row['实体'])) continue;
  const key = `${row['实体']}.${row['字段逻辑名']}`;
  formLines.set(key, [...(formLines.get(key) || []), index + 2]);
}
const mappings = JSON.parse(readFileSync(fileURLToPath(mapUrl), 'utf8')) as RemittanceFieldMapping[];

function order(id: string, contractId: string, currency = 'USD'): SalesOrder {
  return { id, contractId, orderNumber: '', currency, amount: 100, status: '有效', revision: 1, createdAt: '', updatedAt: '', owner: '' };
}

function invoice(id: string, contractId: string, currency = 'USD'): ContractInvoice {
  return {
    id, contractId, projectIds: [], revision: 1, updatedAt: '', cumulativeSource: 'claims',
    number: '', amount: 100, currency, issued: '', due: '', received: 0,
  };
}

const receipt: BankReceiptClaim = {
  id: 'receipt-1', number: 'DEMO-RECEIPT-001', contractId: 'contract-1', amount: 100,
  currency: 'USD', status: '有效',
};
function line(overrides: Partial<BankReceiptClaimLine> = {}): BankReceiptClaimLine {
  return { id: 'line-1', receiptId: receipt.id, orderId: 'order-1', amount: 25, currency: 'USD', status: '有效', ...overrides };
}

test('水单及认领明细映射逐项覆盖113条字段定义和表单定位证据', () => {
  assert.equal(sourceRecords.length, 113);
  assert.equal(mappings.length, 113);
  assert.deepEqual(
    Object.fromEntries(['alp_claim_water_bill', 'alp_water_bill_claim_details'].map((entity) => [
      entity, mappings.filter((field) => field.entity === entity).length,
    ])),
    { alp_claim_water_bill: 60, alp_water_bill_claim_details: 53 },
  );
  assert.equal(new Set(mappings.map((field) => field.mappingId)).size, 113);
  for (const [index, { row, sourceLine }] of sourceRecords.entries()) {
    const field = mappings[index];
    const reviewSource: RemittanceFieldSourceValues = {
      mappingRule: row['映射及保存规则'], formRequired: row['当前表单必填'],
      dictionaryRaw: row['字典值及原标签'], cspdRequiredHandling: row['CSPD必填处理'],
    };
    assert.equal(field.mappingId, `${row['CRM实体逻辑名']}.${row['字段逻辑名']}`);
    assert.equal(field.entity, row['CRM实体逻辑名']);
    assert.equal(field.entityLabel, row['CRM实体名称']);
    assert.equal(field.logicalName, row['字段逻辑名']);
    assert.equal(field.label, row['CRM字段显示名']);
    assert.equal(field.crmType, row['CRM类型']);
    assert.equal(field.sourceCategory, row['字段分类']);
    assert.equal(field.classification, classifyRemittanceField(row['字段分类']));
    assert.equal(field.department, row['CSPD唯一维护模块']);
    assert.equal(field.tab, row['负责页签']);
    assert.equal(field.fieldGroup, row['字段分组']);
    assert.equal(field.targetObject, row['本地承载对象（现有或建议新增）']);
    assert.equal(field.targetPath, row['拟定字段路径']);
    assert.equal(field.editability, row['可编辑性']);
    assert.equal(field.onCurrentMainForm, row['当前主表单是否出现']);
    assert.equal(field.formName, row['主表单名称']);
    assert.equal(field.controlLabel, row['当前控件标签']);
    assert.equal(field.crmRequired, row['CRM元数据必填']);
    assert.equal(field.formRequired, row['当前表单必填']);
    assert.equal(field.cspdRequiredHandling, row['CSPD必填处理']);
    assert.equal(field.dictionaryRaw, row['字典值及原标签']);
    assert.equal(field.lookupTarget, row['关联目标实体']);
    assert.equal(field.companionSourceField, row['伴随来源字段']);
    assert.equal(field.mappingRule, row['映射及保存规则']);
    assert.equal(field.evidenceFiles, row['证据文件']);
    assert.equal(field.sourceFile, FIELD_SOURCE);
    assert.equal(field.sourceLine, sourceLine);
    assert.equal(field.formEvidenceFile, FORM_SOURCE);
    assert.deepEqual(field.formEvidenceLines, formLines.get(field.mappingId) || []);
    assert.deepEqual(field.reviewFlags, remittanceFieldReviewFlags(reviewSource));
  }
});

test('水单编号Lookup指向水单头，订单Lookup指向销售订单', () => {
  const billCode = mappings.find((field) => field.mappingId === 'alp_water_bill_claim_details.alp_invoice_code');
  const orderId = mappings.find((field) => field.mappingId === 'alp_water_bill_claim_details.alp_order_id');
  assert.equal(billCode?.lookupTarget, 'alp_claim_water_bill');
  assert.equal(orderId?.lookupTarget, 'salesorder');
});

test('合同内相同水单编号生成稳定认领ID，重复保存可覆盖而不会重复累计', () => {
  const receiptId = remittanceReceiptId('contract-1', ' BANK-100 ');
  assert.equal(receiptId, remittanceReceiptId('contract-1', 'bank-100'));
  assert.equal(remittancePrimaryLineId(receiptId), remittancePrimaryLineId(receiptId));
  assert.notEqual(receiptId, remittanceReceiptId('contract-2', 'bank-100'));
});

test('有效认领总额不能超过同币种水单金额', () => {
  assert.equal(exceedsReceiptAmount(receipt, [line({ amount: 40 }), line({ id: 'line-2', amount: 60 })]), false);
  assert.equal(exceedsReceiptAmount(receipt, [line({ amount: 60 }), line({ id: 'line-2', amount: 60 })]), true);
  assert.equal(exceedsReceiptAmount(receipt, [line({ amount: 60 }), line({ id: 'line-2', currency: 'EUR', amount: 60 })]), false);
});

test('只凭显式发票ID、同合同和同币种的有效明细生成发票回款，并按稳定ID去重', () => {
  const orders = [order('order-1', 'contract-1')];
  const invoices = [invoice('invoice-1', 'contract-1')];
  const rows = [line({ invoiceId: 'invoice-1' }), line({ amount: 99 }), line({ id: 'line-2', invoiceId: 'invoice-1', amount: 10 })];
  assert.deepEqual(toInvoiceReceiptClaims([receipt], rows, orders, invoices), [
    { id: 'line-1', invoiceId: 'invoice-1', amount: 25, currency: 'USD', status: '有效', sourceReference: 'receipt-1' },
    { id: 'line-2', invoiceId: 'invoice-1', amount: 10, currency: 'USD', status: '有效', sourceReference: 'receipt-1' },
  ]);
});

test('订单明细可以没有发票ID；错合同、错币种、缺失稳定ID均待核且不投影', () => {
  const orders = [order('order-1', 'contract-1')];
  const invoices = [invoice('invoice-foreign-contract', 'contract-2'), invoice('invoice-eur', 'contract-1', 'EUR')];
  assert.equal(validateClaimLine(receipt, line(), orders, invoices).valid, true);
  const mismatched = validateClaimLine(receipt, line({ invoiceId: 'invoice-foreign-contract' }), orders, invoices);
  assert.deepEqual(mismatched.reviewReasons, ['订单与发票合同不一致']);
  const wrongCurrency = validateClaimLine(receipt, line({ invoiceId: 'invoice-eur' }), orders, invoices);
  assert.ok(wrongCurrency.reviewReasons.includes('认领币种与发票不一致'));
  assert.deepEqual(toInvoiceReceiptClaims([receipt], [
    line({ invoiceId: 'invoice-foreign-contract' }),
    line({ id: 'line-2', invoiceId: 'invoice-eur' }),
  ], orders, invoices), []);
});

test('订单合同不属于水单合同的明细待核', () => {
  const validation = validateClaimLine(receipt, line(), [order('order-1', 'other-contract')], []);
  assert.deepEqual(validation.reviewReasons, ['水单与订单合同不一致']);
});

test('有效明细金额按币种分组并忽略重复ID、撤销行和异币种行', () => {
  const summary = summarizeRemittance(receipt, [
    line({ amount: 10 }), line({ amount: 10 }),
    line({ id: 'eur', currency: 'EUR', amount: 12 }),
    line({ id: 'void', status: '撤销', amount: 4 }),
  ]);
  assert.deepEqual(summary, [{ currency: 'USD', receiptAmount: 100, claimedAmount: 10, remainingAmount: 90, lineCount: 1 }]);
});

test('未知水单字段来源分类显式失败', () => {
  assert.throws(() => classifyRemittanceField('未知分类'), /水单字段来源分类未配置/);
});
