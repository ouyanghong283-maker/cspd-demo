import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect, toolText, root } from './mcp-client.mjs';
import { base } from './browser-config.mjs';
import { createV9Dates } from '../src/app/core/v9-queries.ts';

const output = path.join(
  root,
  'artifacts/v10-01-05',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await fs.mkdir(output, { recursive: true });
const browser = await connect({ isolated: true });
let pageId;
const call = (name, args = {}) => browser.call(name, { pageId, ...args });
const storage = `JSON.stringify(Object.fromEntries(Object.entries({...localStorage}).filter(([k]) => k !== 'cspd-demo-v2:editing-lease').sort(([a],[b]) => a.localeCompare(b))))`;
async function evaluate(body) {
  const text = toolText(await call('evaluate_script', { function: `async () => { ${body} }` }));
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert.ok(match, text);
  return JSON.parse(match[1]);
}
async function read() {
  return evaluate(
    `const s=ng.getComponent(document.querySelector('app-root')).store; await s.recoverContractFiles(); const target=s.v9CommandTarget(); return {target, revision:s.state().dataVersion, observationDate:s.observationDate(), raw:localStorage.getItem('cspd-demo:v7:workspace:'+target.workspaceId), storage:${storage}};`,
  );
}
async function consume(name, saved) {
  const now = new Date().toISOString();
  const context = {
    ...saved.target,
    dataVersion: saved.revision,
    contextRevision: name + ':' + now,
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
  const view = JSON.parse(run.stdout);
  assert.equal(view.summary.revenueMinor, 10500000);
  assert.equal(view.summary.grossProfitMinor, 1260000);
  assert.equal(view.summary.grossMargin, 0.12);
  assert.deepEqual(view.summary.coverage, { complete: 7, total: 8 });
  assert.deepEqual(
    view.months.map((m) => m.grossProfitMinor),
    [504000, 756000],
  );
  assert.equal(view.projectDrilldowns[0].project.grossProfitMinor, 450000);
  assert.equal(view.projectDrilldowns[2].project.revenueMinor, null);
  assert.equal(await fs.readFile(source, 'utf8'), saved.raw);
  assert.equal(await evaluate(`return ${storage};`), saved.storage);
  return view;
}
try {
  const page = toolText(await browser.call('new_page', { url: base + '/projects/DEMO-P001' }));
  pageId = Number(page.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['青山储能一期'], timeout: 30000 });
  await evaluate(
    `const s=ng.getComponent(document.querySelector('app-root')).store; await s.recoverContractFiles(); s.setRole('pm'); if(!s.saveProject({...structuredClone(s.project('DEMO-P001')),site:'V10-01-05 财务来源核验'})) throw Error('原保存失败'); return true;`,
  );
  const saved = await read();
  await consume('saved', saved);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['青山储能一期'], timeout: 30000 });
  const reloaded = await read();
  assert.equal(reloaded.raw, saved.raw);
  await consume('reloaded', reloaded);
  // 构造一份没有新增财务来源的旧工作区；保留其中旧快照及预算，走公开维护入口。
  const migration =
    await evaluate(`const s=ng.getComponent(document.querySelector('app-root')).store;
    const key='cspd-demo:v7:workspace:'+s.v9CommandTarget().workspaceId;
    const envelope=JSON.parse(localStorage.getItem(key)); delete envelope.snapshot.financeBatches;
    localStorage.setItem(key,JSON.stringify(envelope)); s.state.set(structuredClone(envelope.snapshot));
    const oldRaw=localStorage.getItem(key), before=JSON.stringify(s.state()), legacy=JSON.stringify(s.state().financeSnapshots), budgets=JSON.stringify(s.state().projects.map(p=>p.plans));
    const original=Storage.prototype.setItem; let failed;
    try { Storage.prototype.setItem=function(k,v){if(k.includes(':migration-candidate:'))throw new DOMException('验收容量错误','QuotaExceededError');return original.call(this,k,v)}; failed=s.migrateWorkspaceFinanceSources(s.state().dataVersion); } finally {Storage.prototype.setItem=original;}
    const protectedState=before===JSON.stringify(s.state()) && oldRaw===localStorage.getItem(key);
    const ok=s.migrateWorkspaceFinanceSources(s.state().dataVersion);
    return {failed,protectedState,ok,legacyPreserved:legacy===JSON.stringify(s.state().financeSnapshots),budgetsPreserved:budgets===JSON.stringify(s.state().projects.map(p=>p.plans)),backupExists:Object.entries({...localStorage}).some(([k,v])=>k.includes('backup')&&v===oldRaw)};`);
  assert.deepEqual(migration, {
    failed: false,
    protectedState: true,
    ok: true,
    legacyPreserved: true,
    budgetsPreserved: true,
    backupExists: true,
  });
  const migrated = await read();
  await consume('migrated', migrated);
  await call('take_screenshot', {
    filePath: path.join(output, 'source-project.png'),
    fullPage: true,
  });
  await evaluate(
    `const s=ng.getComponent(document.querySelector('app-root')).store; if(!await s.reset())throw Error('reset失败'); return true;`,
  );
  const restarted = await read();
  assert.notEqual(restarted.target.roundId, saved.target.roundId);
  await consume('restarted', restarted);
  await evaluate(
    `const s=ng.getComponent(document.querySelector('app-root')).store;if(!s.resumeWorkspace(${JSON.stringify(saved.target.workspaceId)}))throw Error('续接失败');return true;`,
  );
  const resumed = await read();
  assert.equal(resumed.raw, migrated.raw);
  await consume('resumed', resumed);
  const report = {
    output,
    contractVersion: 'v10-finance-1',
    workspaceId: saved.target.workspaceId,
    roundId: saved.target.roundId,
    revision: saved.revision,
    migratedRevision: migrated.revision,
    expected: {
      revenueMinor: 10500000,
      grossProfitMinor: 1260000,
      grossMargin: 0.12,
      coverage: { complete: 7, total: 8 },
      monthlyProfit: [504000, 756000],
    },
    migration,
    sameRoundReloadIdentical: true,
    oldWorkspacePreserved: true,
    queryInputAndBusinessStorageUnchanged: true,
    excludedTechnicalStorageKeys: ['cspd-demo-v2:editing-lease'],
  };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.client.close();
}
