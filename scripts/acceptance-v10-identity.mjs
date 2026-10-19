import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { connect, toolText, root } from './mcp-client.mjs';
import { base } from './browser-config.mjs';
import { selectLifecycleProgress } from '../src/app/core/lifecycle-progress/index.ts';
import { createV9Dates } from '../src/app/core/v9-queries.ts';

const portfolioMode = process.argv.includes('--portfolio');
const output = path.join(
  root,
  portfolioMode ? 'artifacts/v10-01-02' : 'artifacts/v10-01-01',
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
    project.site = 'V10-01-01 浏览器实际保存验收现场';
    const oldRevision = store.state().dataVersion;
    const ok = store.saveProject(project);
    if (${portfolioMode}) {
      if (!store.sample('DEMO-P002', 'SAT报告')) throw Error('模拟SAT报告保存失败');
      if (!store.saveSat('DEMO-P002', '2026-10-15', '合格', true)) throw Error('SAT保存失败');
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
    'V10-01-01 浏览器实际保存验收现场',
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
  const consume = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/consume-v10-identity.ts', sourcePath, contextPath],
    { cwd: root, encoding: 'utf8' },
  );
  await fs.writeFile(path.join(output, 'consumer.stdout.json'), consume.stdout);
  assert.equal(consume.status, 0, consume.stderr);
  const result = JSON.parse(consume.stdout);
  const expected = {
    projectCount: 8,
    customerCount: 6,
    groupedProjectCount: 8,
    pendingProjectCount: 0,
    unidentifiedRecordCount: 0,
  };
  assert.deepEqual(result.counts, expected);
  const group = result.customers.find((c) => c.customerId === 'DEMO-C005');
  assert.deepEqual(
    group.projects.map((p) => p.projectId),
    ['DEMO-P001', 'DEMO-P002', 'DEMO-P007'],
  );
  assert.equal(group.projects[0].opportunityId, 'DEMO-O005');
  assert.equal(await fs.readFile(sourcePath, 'utf8'), saved.raw);
  const after = await evaluate(`return ${readBusinessStorage};`);
  assert.equal(after === saved.allStorage, true, '消费前后业务存储字节必须一致');
  let portfolioEvidence = null;
  if (portfolioMode) {
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/consume-v10-identity.ts',
        sourcePath,
        contextPath,
        '--portfolio',
      ],
      { cwd: root, encoding: 'utf8' },
    );
    await fs.writeFile(path.join(output, 'portfolio.stdout.json'), run.stdout);
    assert.equal(run.status, 0, run.stderr);
    const view = JSON.parse(run.stdout);
    const expectedPresales = {
      opportunityCount: 24,
      pipelineCount: 13,
      stages: { 意向沟通: 4, 洽谈: 3, 方案报价: 3, 合同谈判: 3 },
      wonCount: 8,
      lostCount: 3,
      unknownStageCount: 0,
      convertedCount: 6,
      matchedCount: 13,
    };
    const expectedExecution = {
      projectCount: 8,
      activeCount: 8,
      completedCount: 0,
      cancelledCount: 0,
      matchedCount: 8,
    };
    assert.deepEqual(view.presales.counts, expectedPresales);
    assert.deepEqual(view.execution.counts, expectedExecution);
    for (const p of view.execution.projects)
      assert.deepEqual(
        p.progress,
        selectLifecycleProgress(envelope.snapshot, p.opportunityId, p.projectId, context.dates),
      );
    const first = view.execution.projects.find((p) => p.projectId === 'DEMO-P001');
    const second = view.execution.projects.find((p) => p.projectId === 'DEMO-P002');
    assert.equal(first.opportunityId, second.opportunityId);
    assert.equal(first.progress.displayPercent, '5.0');
    assert.equal(second.progress.displayPercent, '10.0');
    assert.ok(view.execution.projects.every((p) => !p.progress.complete));
    assert.equal(await fs.readFile(sourcePath, 'utf8'), saved.raw);
    assert.equal(
      (await evaluate(`return ${readBusinessStorage};`)) === saved.allStorage,
      true,
      '分区消费前后业务存储字节必须一致',
    );
    portfolioEvidence = {
      contractVersion: view.contractVersion,
      expectedPresales,
      actualPresales: view.presales.counts,
      expectedExecution,
      actualExecution: view.execution.counts,
      independentProjectProgress: {
        'DEMO-P001': first.progress.displayPercent,
        'DEMO-P002': second.progress.displayPercent,
      },
      originalLifecycleQueriesEqual: true,
    };
  }
  await call('take_screenshot', {
    filePath: path.join(output, 'saved-project.png'),
    fullPage: true,
  });
  const report = {
    issue: portfolioMode ? 191 : 190,
    result: '通过',
    source: '隔离浏览器原DemoStore.saveProject成功提交后的localStorage工作区快照',
    workspaceId: saved.target.workspaceId,
    roundId: saved.target.roundId,
    oldRevision: saved.oldRevision,
    revision: saved.revision,
    contractVersion: result.contractVersion,
    portfolio: portfolioEvidence,
    expected,
    actual: result.counts,
    identity: {
      customerId: group.customerId,
      opportunityId: group.projects[0].opportunityId,
      projectId: group.projects[0].projectId,
    },
    snapshotUnchanged: true,
    excludedTechnicalStorageKeys: ['cspd-demo-v2:editing-lease'],
    command: 'node --import tsx scripts/consume-v10-identity.ts <workspace.json> <context.json>',
  };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  await browser.client.close();
}
