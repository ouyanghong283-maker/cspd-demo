import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  classifyOrderField,
  orderFieldReviewFlags,
  OrderFieldMapping,
  OrderFieldSourceValues,
} from '../src/app/core/order-field-map';

const fieldSourceUrl = new URL(
  '../../doc/PRD/DEMO%20PRD/V7PRD/%E9%99%84%E4%BB%B6/01_%E6%A0%87%E5%87%86CRM%E5%85%A8%E9%87%8F%E5%AD%97%E6%AE%B5%E5%8E%BB%E5%90%91.csv',
  import.meta.url,
);
const formSourceUrl = new URL(
  '../../doc/PRD/DEMO%20PRD/V7PRD/%E9%99%84%E4%BB%B6/02_%E5%BD%93%E5%89%8D%E4%B8%BB%E8%A1%A8%E5%8D%95%E5%AD%97%E6%AE%B5%E5%AE%9A%E4%BD%8D.csv',
  import.meta.url,
);
const mapUrl = new URL('../src/app/core/order-field-map.json', import.meta.url);
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
      } else if (character === '"') {
        inQuotes = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
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
  .filter(({ row }) => ['salesorder', 'salesorderdetail'].includes(row['CRM实体逻辑名']));
const formLines = new Map<string, number[]>();
for (const [index, row] of readCsv(formSourceUrl).entries()) {
  if (!['salesorder', 'salesorderdetail'].includes(row['实体'])) continue;
  const key = `${row['实体']}.${row['字段逻辑名']}`;
  formLines.set(key, [...(formLines.get(key) || []), index + 2]);
}
const mappings = JSON.parse(readFileSync(fileURLToPath(mapUrl), 'utf8')) as OrderFieldMapping[];

test('订单及订单明细映射清单完整覆盖来源的528条字段', () => {
  assert.equal(sourceRecords.length, 528);
  assert.equal(mappings.length, 528);
  assert.deepEqual(
    Object.fromEntries(
      ['salesorder', 'salesorderdetail'].map((entity) => [
        entity,
        sourceRecords.filter(({ row }) => row['CRM实体逻辑名'] === entity).length,
      ]),
    ),
    { salesorder: 308, salesorderdetail: 220 },
  );
  assert.equal(new Set(mappings.map((field) => field.mappingId)).size, 528);
  assert.deepEqual(
    Object.fromEntries(
      ['business', 'readOnly', 'technical'].map((classification) => [
        classification,
        mappings.filter((field) => field.classification === classification).length,
      ]),
    ),
    { business: 285, readOnly: 208, technical: 35 },
  );
});

test('每条订单及订单行字段逐项对齐去向、类别、来源和定位CSV', () => {
  for (const [index, { row, sourceLine }] of sourceRecords.entries()) {
    const field = mappings[index];
    const entity = row['CRM实体逻辑名'] as OrderFieldMapping['entity'];
    const reviewSource: OrderFieldSourceValues = {
      mappingRule: row['映射及保存规则'],
      formRequired: row['当前表单必填'],
      dictionaryRaw: row['字典值及原标签'],
      cspdRequiredHandling: row['CSPD必填处理'],
    };

    assert.equal(field.mappingId, `${entity}.${row['字段逻辑名']}`);
    assert.equal(field.entity, entity);
    assert.equal(field.entityLabel, row['CRM实体名称']);
    assert.equal(field.logicalName, row['字段逻辑名']);
    assert.equal(field.label, row['CRM字段显示名']);
    assert.equal(field.crmType, row['CRM类型']);
    assert.equal(field.sourceCategory, row['字段分类']);
    assert.equal(field.classification, classifyOrderField(row['字段分类']));
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
    assert.equal(field.sourceCspdRequiredHandling, row['CSPD必填处理']);
    assert.equal(field.cspdRequiredHandling, row['CSPD必填处理'].replaceAll('CRM红星', '标准CRM系统红星'));
    assert.equal(field.dictionaryRaw, row['字典值及原标签']);
    assert.equal(field.lookupTarget, row['关联目标实体']);
    assert.equal(field.companionSourceField, row['伴随来源字段']);
    assert.equal(field.mappingRule, row['映射及保存规则']);
    assert.equal(field.evidenceFiles, row['证据文件']);
    assert.equal(field.sourceFile, FIELD_SOURCE);
    assert.equal(field.sourceLine, sourceLine);
    assert.equal(field.formEvidenceFile, FORM_SOURCE);
    assert.deepEqual(field.formEvidenceLines, formLines.get(field.mappingId) || []);
    assert.deepEqual(field.reviewFlags, orderFieldReviewFlags(reviewSource));
    assert.ok(field.targetObject.trim(), `${field.mappingId} has no destination object`);
    assert.ok(field.targetPath.trim(), `${field.mappingId} has no destination path`);
    assert.ok(field.mappingRule.trim(), `${field.mappingId} has no mapping rule`);
    assert.ok(field.evidenceFiles.trim(), `${field.mappingId} has no source evidence`);
  }
});

test('未知订单字段来源分类会显式失败，不会凭相似名称猜类别', () => {
  assert.throws(() => classifyOrderField('未知分类'), /订单字段来源分类未配置/);
});
