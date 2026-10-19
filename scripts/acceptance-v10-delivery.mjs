import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect, toolText, root } from './mcp-client.mjs';
import { base } from './browser-config.mjs';
import { createV9Dates } from '../src/app/core/v9-queries.ts';

const output = path.join(
  root,
  'artifacts/v10-01-03',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await fs.mkdir(output, { recursive: true });
const browser = await connect({ isolated: true });
let pageId;
const call = (name, args = {}) => browser.call(name, { pageId, ...args });
// 编辑租约心跳会定时写入技术锁；业务只读验收排除该唯一技术键，其余键仍逐字节比较。
const readBusinessStorage = `JSON.stringify(Object.fromEntries(Object.entries({...localStorage}).filter(([key]) => key !== 'cspd-demo-v2:editing-lease').sort(([a], [b]) => a.localeCompare(b))))`;
const evaluate = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async () => { ${body} }` }));
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
  assert.ok(match, raw);
  return JSON.parse(match[1]);
};
try {
  const page = toolText(await browser.call('new_page', { url: base + '/projects/DEMO-P001' }));
  pageId = Number(page.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['青山储能一期'], timeout: 30000 });
  const saved = await evaluate(`
    const store = ng.getComponent(document.querySelector('app-root')).store;
    store.setRole('pm');
    const project = structuredClone(store.project('DEMO-P001'));
    project.site = 'V10-01-03 浏览器实际保存验收现场';
    const oldRevision = store.state().dataVersion;
    const ok = store.saveProject(project);
    for (const [id, end] of [['DEMO-P001', '2026-10-20'], ['DEMO-P002', '2026-10-10']]) {
      const milestone = structuredClone(store.project(id).plans.find(p => p.id === id + '-V10-shipment'));
      milestone.end = end; milestone.expected = end;
      if (!store.savePlan(id, milestone)) throw Error('承诺日期保存失败');
    }
    const target = store.v9CommandTarget();
    const raw = localStorage.getItem('cspd-demo:v7:workspace:' + target.workspaceId);
    return { ok, oldRevision, revision: store.state().dataVersion, target, raw,
      observationDate: store.observationDate(), allStorage: ${readBusinessStorage} };
  `);
  assert.equal(saved.ok, true);
  assert.ok(saved.revision > saved.oldRevision);
  const envelope = JSON.parse(saved.raw);
  assert.equal(
    envelope.snapshot.projects.find((p) => p.id === 'DEMO-P001').site,
    'V10-01-03 浏览器实际保存验收现场',
  );
  const now = new Date().toISOString();
  const context = {
    ...saved.target,
    dataVersion: saved.revision,
    contextRevision: `browser-read:${now}`,
    dates: { ...createV9Dates(now, saved.observationDate), lastSuccessfulReadAt: now },
    fileAvailability: {},
    sources: { projects: 'ready', customers: 'ready', opportunities: 'ready' },
  };
  const sourcePath = path.join(output, 'workspace.json');
  const contextPath = path.join(output, 'context.json');
  await fs.writeFile(sourcePath, saved.raw);
  await fs.writeFile(contextPath, JSON.stringify(context, null, 2));
  const consume = (inputPath, readContextPath = contextPath) => {
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/consume-v10-identity.ts',
        inputPath,
        readContextPath,
        '--delivery',
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
    return JSON.parse(run.stdout);
  };
  const initial = consume(sourcePath);
  const expected = { delayed: 1, warning: 1, pending: 1, normal: 5 };
  assert.deepEqual(initial.counts, expected);
  assert.equal(initial.projectCount, 8);
  assert.equal(await fs.readFile(sourcePath, 'utf8'), saved.raw);
  assert.equal(await evaluate(`return ${readBusinessStorage};`), saved.allStorage);
  await fs.writeFile(path.join(output, 'delivery-before.json'), JSON.stringify(initial, null, 2));
  // 通过现有正式保存入口提交第二项目发货完成；无需新增审批或专用报告。
  const completed = await evaluate(`
    const store = ng.getComponent(document.querySelector('app-root')).store;
    const plan = structuredClone(store.project('DEMO-P002').plans.find(p => p.id === 'DEMO-P002-要货发货'));
    plan.status = '已完成'; plan.actual = '2026-10-12';
    if (!store.savePlan('DEMO-P002', plan)) throw Error('发货完成保存失败');
    const target = store.v9CommandTarget();
    return { revision: store.state().dataVersion, raw: localStorage.getItem('cspd-demo:v7:workspace:' + target.workspaceId), allStorage: ${readBusinessStorage} };
  `);
  context.dataVersion = completed.revision;
  context.contextRevision += ':completed';
  const completedContextPath = path.join(output, 'context-completed.json');
  await fs.writeFile(completedContextPath, JSON.stringify(context, null, 2));
  const completedPath = path.join(output, 'workspace-completed.json');
  await fs.writeFile(completedPath, completed.raw);
  const after = consume(completedPath, completedContextPath);
  assert.deepEqual(after.counts, { delayed: 0, warning: 1, pending: 1, normal: 6 });
  const project = after.projects.find((p) => p.projectId === 'DEMO-P002');
  assert.equal(project.delivery.historicalLateCompletions[0].completedLateDays, 2);
  assert.equal(project.delivery.historicalLateCompletions[0].actualDate, '2026-10-12');
  assert.equal(await fs.readFile(completedPath, 'utf8'), completed.raw);
  assert.equal(await evaluate(`return ${readBusinessStorage};`), completed.allStorage);
  await fs.writeFile(path.join(output, 'delivery-after.json'), JSON.stringify(after, null, 2));
  // 再走现有逐项签认→完成入口，校验签认日与旧BASE_DATE同步日不同仍有效。
  const accepted = await evaluate(`
    const store = ng.getComponent(document.querySelector('app-root')).store;
    const id = 'DEMO-P002';
    if (!store.simulateDocument(id, '客户签字清单', '客户签字.pdf')) throw Error('签字清单模拟保存失败');
    for (const a of store.project(id).acceptance) {
      if (!store.saveAcceptance(id, a.id, '通过', '客户代表', '2026-10-09', '')) throw Error('逐项签认失败');
    }
    if (!store.completeAcceptance(id)) throw Error('客户验收完成失败');
    const milestone = structuredClone(store.project(id).plans.find(p => p.id === id + '-V10-customerAcceptance'));
    milestone.end = '2026-10-08';
    if (!store.savePlan(id, milestone)) throw Error('验收承诺日期保存失败');
    const target = store.v9CommandTarget();
    return { revision: store.state().dataVersion, raw: localStorage.getItem('cspd-demo:v7:workspace:' + target.workspaceId), allStorage: ${readBusinessStorage} };
  `);
  context.dataVersion = accepted.revision;
  context.contextRevision += ':accepted';
  const acceptedContextPath = path.join(output, 'context-accepted.json');
  const acceptedPath = path.join(output, 'workspace-accepted.json');
  await fs.writeFile(acceptedContextPath, JSON.stringify(context, null, 2));
  await fs.writeFile(acceptedPath, accepted.raw);
  const acceptanceView = consume(acceptedPath, acceptedContextPath);
  assert.deepEqual(acceptanceView.counts, { delayed: 0, warning: 1, pending: 1, normal: 6 });
  const acceptedProject = acceptanceView.projects.find((p) => p.projectId === 'DEMO-P002');
  const acceptanceNode = acceptedProject.delivery.nodes.find(
    (n) => n.category === 'customerAcceptance',
  );
  assert.equal(acceptanceNode.completionValid, true);
  assert.equal(acceptanceNode.actualDate, '2026-10-09');
  assert.equal(acceptanceNode.completedLateDays, 1);
  assert.equal(acceptedProject.executionScope, 'active');
  assert.equal(await fs.readFile(acceptedPath, 'utf8'), accepted.raw);
  assert.equal(await evaluate(`return ${readBusinessStorage};`), accepted.allStorage);
  await fs.writeFile(
    path.join(output, 'delivery-accepted.json'),
    JSON.stringify(acceptanceView, null, 2),
  );
  await call('navigate_page', { url: base + '/projects/DEMO-P002?tab=acceptance' });
  await call('wait_for', { text: ['客户验收'], timeout: 30000 });
  await call('take_screenshot', {
    filePath: path.join(output, 'acceptance-source.png'),
    fullPage: true,
  });
  const href = project.delivery.nodes[0].sourceHref;
  await call('navigate_page', { url: base + href });
  await call('wait_for', { text: ['第一批储能柜'], timeout: 30000 });
  await call('take_screenshot', {
    filePath: path.join(output, 'shipment-source.png'),
    fullPage: true,
  });
  const report = {
    issue: 192,
    result: '通过',
    workspaceId: saved.target.workspaceId,
    roundId: saved.target.roundId,
    oldRevision: saved.oldRevision,
    savedRevision: saved.revision,
    completedRevision: completed.revision,
    acceptedRevision: accepted.revision,
    acceptanceActualDate: acceptanceNode.actualDate,
    acceptanceCompletedLateDays: acceptanceNode.completedLateDays,
    contractVersion: project.contractVersion,
    dates: context.dates,
    expected,
    initialActual: initial.counts,
    completedActual: after.counts,
    completedLateDays: 2,
    sourceHref: href,
    inputFilesUnchanged: true,
    businessStorageUnchangedDuringQueries: true,
    excludedTechnicalStorageKeys: ['cspd-demo-v2:editing-lease'],
    boundary:
      '原DemoStore.saveProject和savePlan真实提交→已保存快照→公开查询独立命令→手算预期；非外围系统接入',
  };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  await browser.client.close();
}
