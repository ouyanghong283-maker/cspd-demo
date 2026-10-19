import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect, toolText, root } from './mcp-client.mjs';
import { base } from './browser-config.mjs';
import { createV9Dates } from '../src/app/core/v9-queries.ts';

const output = path.join(
  root,
  'artifacts/v10-01-04',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await fs.mkdir(output, { recursive: true });
const browser = await connect({ isolated: true });
let pageId;
const call = (name, args = {}) => browser.call(name, { pageId, ...args });
const businessStorage = `JSON.stringify(Object.fromEntries(Object.entries({...localStorage}).filter(([key]) => key !== 'cspd-demo-v2:editing-lease').sort(([a], [b]) => a.localeCompare(b))))`;
const evaluate = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async () => { ${body} }` }));
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
  assert.ok(match, raw);
  return JSON.parse(match[1]);
};
const read = () =>
  evaluate(`
  const store = ng.getComponent(document.querySelector('app-root')).store;
  await store.recoverContractFiles();
  const target = store.v9CommandTarget();
  return { target, revision: store.state().dataVersion,
    raw: localStorage.getItem('cspd-demo:v7:workspace:' + target.workspaceId),
    observationDate: store.observationDate(), allStorage: ${businessStorage} };
`);
const consume = async (name, saved) => {
  const now = new Date().toISOString();
  const context = {
    ...saved.target,
    dataVersion: saved.revision,
    contextRevision: name + ':' + now,
    dates: { ...createV9Dates(now, saved.observationDate), lastSuccessfulReadAt: now },
    fileAvailability: {},
    sources: { projects: 'ready', customers: 'ready', opportunities: 'ready' },
  };
  const sourcePath = path.join(output, name + '-workspace.json');
  const contextPath = path.join(output, name + '-context.json');
  await fs.writeFile(sourcePath, saved.raw);
  await fs.writeFile(contextPath, JSON.stringify(context, null, 2));
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/consume-v10-identity.ts', sourcePath, contextPath, '--delivery'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
  await fs.writeFile(path.join(output, name + '-delivery.json'), run.stdout);
  assert.equal(await fs.readFile(sourcePath, 'utf8'), saved.raw);
  assert.equal(await evaluate(`return ${businessStorage};`), saved.allStorage);
  return JSON.parse(run.stdout);
};
const checkRetained = (view) => {
  assert.deepEqual(view.counts, { delayed: 3, warning: 0, pending: 1, normal: 4 });
  const selected = [
    ['DEMO-P001', 'shipment'],
    ['DEMO-P002', 'shipment'],
    ['DEMO-P004', 'customerAcceptance'],
  ];
  return selected.map(([id, category]) => {
    const p = view.projects.find((p) => p.projectId === id);
    const n = p.delivery.nodes.find((n) => n.category === category);
    assert.equal(p.delivery.status, 'delayed');
    assert.equal(n.promisedDate, '2026-10-10');
    assert.equal(n.delayedDays, 5);
    assert.ok(n.incomplete);
    return {
      projectId: id,
      category,
      mappingId: n.mappingId,
      sourceState: n.sourceState,
      promiseOrigin: n.promiseOrigin,
      delayedDays: n.delayedDays,
      sourceHref: n.sourceHref,
      milestoneHref: n.milestoneHref,
    };
  });
};
try {
  const page = toolText(await browser.call('new_page', { url: base + '/projects/DEMO-P001' }));
  pageId = Number(page.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['青山储能一期'], timeout: 30000 });
  await evaluate(`
    const store = ng.getComponent(document.querySelector('app-root')).store;
    await store.recoverContractFiles(); store.setRole('pm');
    for (const [id, kind] of [['DEMO-P001','shipment'], ['DEMO-P002','shipment'], ['DEMO-P004','customerAcceptance']]) {
      const p = structuredClone(store.project(id).plans.find(p => p.id === id + '-V10-' + kind));
      p.end = '2026-10-10';
      if (!store.savePlan(id, p)) throw Error('承诺日期保存失败');
    }
    return true;
  `);
  const initial = await read();
  const initialView = await consume('initial', initial);
  assert.deepEqual(initialView.counts, { delayed: 3, warning: 0, pending: 1, normal: 4 });
  const failed = await evaluate(`
    const store = ng.getComponent(document.querySelector('app-root')).store;
    const before = JSON.stringify(store.state());
    const target = store.v9CommandTarget();
    const key = 'cspd-demo:v7:workspace:' + target.workspaceId;
    const raw = localStorage.getItem(key);
    const original = Storage.prototype.setItem;
    let ok;
    try {
      Storage.prototype.setItem = function(k,v) { if (k === key) throw new DOMException('验收注入保存失败', 'QuotaExceededError'); return original.call(this,k,v); };
      ok = store.deletePlan('DEMO-P002', 'DEMO-P002-要货发货');
    } finally { Storage.prototype.setItem = original; }
    return { ok, stateUnchanged: JSON.stringify(store.state()) === before, rawUnchanged: localStorage.getItem(key) === raw };
  `);
  assert.deepEqual(failed, { ok: false, stateUnchanged: true, rawUnchanged: true });
  await evaluate(`
    const store = ng.getComponent(document.querySelector('app-root')).store;
    const source = structuredClone(store.project('DEMO-P001').plans.find(p => p.id === 'DEMO-P001-要货发货'));
    source.status = '已取消';
    if (!store.savePlan('DEMO-P001', source)) throw Error('取消保存失败');
    if (!store.deletePlan('DEMO-P002', 'DEMO-P002-要货发货')) throw Error('删除来源失败');
    if (!store.deletePlan('DEMO-P002', 'DEMO-P002-V10-shipment')) throw Error('删除主节点失败');
    if (!store.applyTemplate('DEMO-P004', true)) throw Error('模板替换失败');
    return true;
  `);
  const changed = await read();
  const changedView = await consume('changed', changed);
  const expectedSources = checkRetained(changedView);
  assert.equal(expectedSources[0].sourceState, 'cancelled');
  assert.equal(expectedSources[1].sourceHref, null);
  assert.equal(expectedSources[1].milestoneHref, null);
  assert.equal(expectedSources[2].sourceHref, null);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['青山储能一期'], timeout: 30000 });
  const reloaded = await read();
  assert.equal(reloaded.raw, changed.raw, '同轮重载不得丢失或重写客户承诺');
  assert.deepEqual(reloaded.target, changed.target);
  const reloadedView = await consume('reloaded', reloaded);
  assert.deepEqual(checkRetained(reloadedView), expectedSources);
  await call('navigate_page', {
    url:
      base + '/projects/DEMO-P001?tab=plans&planId=DEMO-P001-%E8%A6%81%E8%B4%A7%E5%8F%91%E8%B4%A7',
  });
  await call('wait_for', { text: ['已取消'], timeout: 30000 });
  await call('take_screenshot', {
    filePath: path.join(output, 'cancelled-source.png'),
    fullPage: true,
  });
  await evaluate(`
    const store = ng.getComponent(document.querySelector('app-root')).store;
    await store.recoverContractFiles();
    if (!await store.reset()) throw Error('新轮创建失败');
    return true;
  `);
  const restarted = await read();
  assert.notEqual(restarted.target.roundId, reloaded.target.roundId);
  assert.notEqual(restarted.target.workspaceId, reloaded.target.workspaceId);
  const restartedView = await consume('restarted', restarted);
  assert.deepEqual(restartedView.counts, { delayed: 0, warning: 0, pending: 1, normal: 7 });
  const oldRaw = await evaluate(
    `return localStorage.getItem('cspd-demo:v7:workspace:' + ${JSON.stringify(reloaded.target.workspaceId)});`,
  );
  assert.equal(oldRaw, reloaded.raw);
  await evaluate(`
    const store = ng.getComponent(document.querySelector('app-root')).store;
    if (!store.resumeWorkspace(${JSON.stringify(reloaded.target.workspaceId)})) throw Error('原轮续接失败');
    await store.recoverContractFiles(); return true;
  `);
  const resumed = await read();
  const resumedView = await consume('resumed', resumed);
  assert.deepEqual(checkRetained(resumedView), expectedSources);
  assert.equal(resumed.raw, reloaded.raw);
  const report = {
    issue: 193,
    result: '通过',
    contractVersion: reloadedView.contractVersion,
    source:
      '原savePlan取消、deletePlan删除来源及主节点、applyTemplate替换→真实浏览器重载→公开只读独立消费',
    workspaceId: reloaded.target.workspaceId,
    roundId: reloaded.target.roundId,
    initialRevision: initial.revision,
    changedRevision: changed.revision,
    reloadedRevision: reloaded.revision,
    newWorkspaceId: restarted.target.workspaceId,
    newRoundId: restarted.target.roundId,
    expected: { delayed: 3, warning: 0, pending: 1, normal: 4 },
    actual: reloadedView.counts,
    restartedActual: restartedView.counts,
    expectedSources,
    failureProtection: failed,
    oldWorkspacePreserved: true,
    sameRoundReloadIdentical: true,
    queryInputAndBusinessStorageUnchanged: true,
    excludedTechnicalStorageKeys: ['cspd-demo-v2:editing-lease'],
  };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  await browser.client.close();
}
