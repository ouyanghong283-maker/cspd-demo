import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect, toolText, root } from './mcp-client.mjs';
import { base } from './browser-config.mjs';
import { createV9Dates } from '../src/app/core/v9-queries.ts';
const output = path.join(
  root,
  'artifacts/v10-01-06',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await fs.mkdir(output, { recursive: true });
const browser = await connect({ isolated: true });
let pageId;
const call = (name, args = {}) => browser.call(name, { pageId, ...args });
async function evaluate(body) {
  const result = toolText(await call('evaluate_script', { function: `async () => { ${body} }` }));
  const match = result.match(/```json\s*([\s\S]*?)\s*```/);
  assert.ok(match, result);
  return JSON.parse(match[1]);
}
const storage = `JSON.stringify(Object.fromEntries(Object.entries({...localStorage}).filter(([k])=>k!=='cspd-demo-v2:editing-lease').sort(([a],[b])=>a.localeCompare(b))))`;
async function read() {
  return evaluate(
    `const s=ng.getComponent(document.querySelector('app-root')).store; await s.recoverContractFiles(); const target=s.v9CommandTarget();return {target,raw:localStorage.getItem('cspd-demo:v7:workspace:'+target.workspaceId),revision:s.state().dataVersion,observationDate:s.observationDate(),storage:${storage}};`,
  );
}
async function consume(name, saved) {
  const now = new Date().toISOString();
  const context = {
    ...saved.target,
    dataVersion: saved.revision,
    contextRevision: name,
    dates: { ...createV9Dates(now, saved.observationDate), lastSuccessfulReadAt: now },
    sources: { projects: 'ready', customers: 'ready', opportunities: 'ready', finance: 'ready' },
    fileAvailability: {},
  };
  const source = path.join(output, name + '-workspace.json'),
    ctx = path.join(output, name + '-context.json');
  await fs.writeFile(source, saved.raw);
  await fs.writeFile(ctx, JSON.stringify(context, null, 2));
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/consume-v10-identity.ts', source, ctx, '--finance'],
    { cwd: root, encoding: 'utf8' },
  );
  await fs.writeFile(path.join(output, name + '-finance.json'), run.stdout);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const r = JSON.parse(run.stdout),
    p = r.projects.find((p) => p.projectId === 'DEMO-P001');
  assert.equal(r.contractVersion, 'v10-finance-2');
  assert.deepEqual(
    p.details.snapshot.expenses.map((e) => e.amountMinor),
    [120000, 80000, 500000],
  );
  assert.equal(p.details.snapshot.cumulativeCost.amountMinor, 6000000);
  assert.equal(p.details.snapshot.sales.salesMinor, 12000000);
  assert.equal(p.details.snapshot.sales.label, '销售额（不是已确认收入）');
  assert.equal(p.details.snapshot.cumulativeCost.cutoff, '2026-10-10');
  assert.equal(r.period.asOf, '2026-09-30');
  assert.equal(
    r.projectDrilldowns.find((d) => d.projectId === 'DEMO-P001').project.details.snapshot
      .cumulativeCost.amountMinor,
    6000000,
  );
  assert.equal(await fs.readFile(source, 'utf8'), saved.raw);
  assert.equal(await evaluate(`return ${storage};`), saved.storage);
  return r;
}
try {
  const page = toolText(await browser.call('new_page', { url: base + '/projects/DEMO-P001' }));
  pageId = Number(page.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['青山储能一期'], timeout: 30000 });
  await evaluate(
    `const s=ng.getComponent(document.querySelector('app-root')).store;await s.recoverContractFiles();s.setRole('pm');if(!s.saveProject({...structuredClone(s.project('DEMO-P001')),site:'V10-01-06 验收'}))throw Error('保存失败');s.setRole('finance');if(!s.loadFinance('DEMO-P001'))throw Error('加载失败');return true;`,
  );
  const saved = await read();
  const r = await consume('saved', saved);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['青山储能一期'], timeout: 30000 });
  const reloaded = await read();
  assert.equal(reloaded.raw, saved.raw);
  await consume('reloaded', reloaded);
  await call('take_screenshot', {
    filePath: path.join(output, 'source-project.png'),
    fullPage: true,
  });
  const report = {
    output,
    contractVersion: r.contractVersion,
    workspaceId: saved.target.workspaceId,
    roundId: saved.target.roundId,
    revision: saved.revision,
    expected: {
      expenseMinor: [120000, 80000, 500000],
      cumulativeCostMinor: 6000000,
      salesMinor: 12000000,
      financeAsOf: '2026-09-30',
      costCutoff: '2026-10-10',
    },
    sameRoundReloadIdentical: true,
    inputAndBusinessStorageUnchanged: true,
    excludedTechnicalKey: 'cspd-demo-v2:editing-lease',
  };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.client.close();
}
