#!/usr/bin/env node
/**
 * K11 目录完整性检查原始结果记录（02-03 / #148 的 KIMI 分工）：
 * 按 CODEX 固定规则（checkCrmQuoteDemoCatalog）执行重复ID/断引用/三场景覆盖检查，
 * 只记录原始输出，不做通过判定（判定归 CODEX）。
 * 用法：node --import tsx scripts/k11-catalog-integrity-record.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { CRM_QUOTE_CATALOG } from '../src/app/core/crm-quote-reference.ts';
import {
  withCrmQuoteDemoCatalog,
  CRM_QUOTE_DEMO_SCENARIOS,
  checkCrmQuoteDemoCatalog,
} from '../src/app/core/crm-quote-demo-catalog.ts';

const base = withCrmQuoteDemoCatalog(CRM_QUOTE_CATALOG);

const cases = [
  { name: 'A-默认目录原样', mutate: (c) => c },
  {
    name: 'B-注入重复reference（V9-QTE-PAYMENT 登记两次）',
    mutate: (c) => {
      c.references.push(c.references.find((r) => r.id === 'V9-QTE-PAYMENT'));
      return c;
    },
  },
  {
    name: 'C-移除V9-QTE-02-PRODUCT-1（制造断引用与场景缺项）',
    mutate: (c) => {
      c.references = c.references.filter((r) => r.id !== 'V9-QTE-02-PRODUCT-1');
      return c;
    },
  },
  {
    name: 'D-同时注入重复与断引用（组合情形）',
    mutate: (c) => {
      c.references.push(c.references.find((r) => r.id === 'V9-QTE-ORG'));
      c.references = c.references.filter((r) => r.id !== 'V9-QTE-03-PRODUCT-2');
      return c;
    },
  },
];

const results = cases.map(({ name, mutate }) => {
  const catalog = mutate(structuredClone(base));
  return { case: name, errors: checkCrmQuoteDemoCatalog(catalog) };
});

let commit = 'unknown';
try {
  commit = execSync('git rev-parse HEAD', { cwd: process.cwd() }).toString().trim();
} catch {
  // 非 git 环境仍记录原始结果
}

const record = {
  recorder: 'K11（KIMI）',
  ticket: '02-03 / #148',
  sourceCommit: commit,
  scenarioCount: CRM_QUOTE_DEMO_SCENARIOS.length,
  scenarios: CRM_QUOTE_DEMO_SCENARIOS.map((s) => s.id),
  ruleOwner: 'CODEX（checkCrmQuoteDemoCatalog 固定规则）',
  judgement: '无通过判定，须 CODEX 核验',
  reproduce: 'node --import tsx scripts/k11-catalog-integrity-record.mjs',
  results,
};

const out = new URL('../docs/v9/b02-catalog-integrity-raw.json', import.meta.url);
writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
for (const r of results) {
  console.log(`[${r.case}] errors=${r.errors.length}`);
  for (const e of r.errors) console.log(`  - ${e}`);
}
console.log(`原始结果已写入 ${out.pathname}（判定归 CODEX）`);
