import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v7-workspace-migration', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 22, checks: [], result: '失败' };
let server;
let connection;
let pageId;
let serverFailure;
let serverLog = '';
const check = (name, evidence) => {
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
};
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const response = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const match = response.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + response);
  return JSON.parse(match[1]);
};

try {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  report.baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(root, 'node_modules/@angular/cli/bin/ng.js'), 'serve', '--host', '127.0.0.1', '--port', String(port), '--watch=false', '--live-reload=false', '--hmr=false'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false', NO_COLOR: '1' },
  });
  server.on('error', (error) => serverFailure = error);
  server.on('exit', (code, signal) => serverFailure = new Error(`服务退出：${code ?? signal}`));
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => serverLog += chunk.toString());
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    if (serverFailure) throw serverFailure;
    try { if ((await fetch(report.baseUrl)).status === 200) break; } catch {}
    await delay(300);
  }
  assert(Date.now() < until, 'Angular 服务启动超时');

  connection = await connect({ isolated: true });
  const created = toolText(await connection.call('new_page', { url: report.baseUrl + '/control' }));
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await call('wait_for', { text: ['演示控制与上手指南'], timeout: 15000 });
  const app = "ng.getComponent(document.querySelector('app-root'))";
  const prepared = await evaluate(`
    const store=${app}.store, state=structuredClone(store.state());
    state.sales[0].projectName='MIGRATION-ORIGINAL-RECORD';
    state.sales[0].customerId='UNKNOWN-CUSTOMER-LEGACY';
    state.dataVersion=7; state.roundId='LEGACY-ROUND-7';
    state.history=[{id:'LEGACY-HISTORY-1',entityId:'DEMO-O001',operator:'旧版操作人',action:'修改商机信息',date:'2026-10-09 10:30'}];
    delete state.operationEvents; delete state.storageSchemaVersion;
    const raw=JSON.stringify(state);
    Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(key=>key?.startsWith('cspd-demo:v7:')).forEach(key=>localStorage.removeItem(key));
    localStorage.setItem('cspd-demo-v2',raw);
    return {raw, saleId:state.sales[0].id};
  `);
  await call('navigate_page', { url: report.baseUrl + '/control?migrationTest=' + runId });
  await call('wait_for', { text: ['演示控制与上手指南'], timeout: 20000 });
  const migrated = await evaluate(`
    const store=${app}.store, state=store.state(), pointer=localStorage.getItem('cspd-demo:v7:active-workspace');
    const backupKey=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).find(key=>key?.startsWith('cspd-demo:v7:legacy-backup:'));
    const envelopeRaw=pointer ? localStorage.getItem('cspd-demo:v7:workspace:'+pointer) : null;
    const envelope=envelopeRaw ? JSON.parse(envelopeRaw) : null;
    return {pointer,backupKey,backup:backupKey ? localStorage.getItem(backupKey) : null,raw:localStorage.getItem('cspd-demo-v2'),formatVersion:envelope?.formatVersion,
      marker:state.sales[0].projectName, saleId:state.sales[0].id, roundId:state.roundId, dataVersion:state.dataVersion,
      schema:state.storageSchemaVersion, legacy:state.operationEvents.find(event=>event.legacyHistoryId==='LEGACY-HISTORY-1'),
      review:state.migrationReviewItems?.map(item=>item.relation)};
  `);
  assert.equal(migrated.backup, prepared.raw);
  assert.equal(migrated.raw, prepared.raw);
  assert.equal(migrated.formatVersion, 1);
  assert.equal(migrated.marker, 'MIGRATION-ORIGINAL-RECORD');
  assert.equal(migrated.saleId, prepared.saleId);
  assert.equal(migrated.roundId, 'LEGACY-ROUND-7');
  assert.equal(migrated.dataVersion, 7);
  assert.equal(migrated.schema, 1);
  assert.equal(migrated.legacy.mainlineId, '旧版未记录');
  assert.equal(migrated.legacy.dataVersion, 0);
  assert(migrated.review.includes('customerId'));
  check('旧快照原文备份、独立候选验证后切换，ID和来源保留，未知关联待核', migrated);

  const seededFile = await evaluate(`
    const files=${app}.store['files']; await files.put('UNKNOWN-ROUND-FILE',new File(['retain'], 'unowned.txt'));
    return !!(await files.get('UNKNOWN-ROUND-FILE'));
  `);
  assert.equal(seededFile, true);
  const restarted = await evaluate(`
    const store=${app}.store, previous=localStorage.getItem('cspd-demo:v7:active-workspace');
    const oldEnvelope=localStorage.getItem('cspd-demo:v7:workspace:'+previous);
    const ok=await store.reset();
    return {ok, previous, oldEnvelope, active:localStorage.getItem('cspd-demo:v7:active-workspace'), roundId:store.state().roundId,
      marker:store.sale(${JSON.stringify(prepared.saleId)})?.projectName, archives:store.archivedWorkspaces().map(item=>item.id),
      fileExists:!!(await store['files'].get('UNKNOWN-ROUND-FILE'))};
  `);
  assert.equal(restarted.ok, true);
  assert.notEqual(restarted.active, restarted.previous);
  assert.notEqual(restarted.roundId, 'LEGACY-ROUND-7');
  assert(restarted.oldEnvelope.includes('MIGRATION-ORIGINAL-RECORD'));
  assert(restarted.archives.includes(restarted.previous));
  assert.equal(restarted.fileExists, true);
  check('重新开始生成新轮并保留旧工作区快照、可续接索引及归属不明附件', restarted);

  const resumed = await evaluate(`const store=${app}.store; const ok=store.resumeWorkspace(${JSON.stringify(restarted.previous)}); return {ok,roundId:store.state().roundId,marker:store.sale(${JSON.stringify(prepared.saleId)})?.projectName};`);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.roundId, 'LEGACY-ROUND-7');
  assert.equal(resumed.marker, 'MIGRATION-ORIGINAL-RECORD');
  check('用户可从控制台续接先前工作区', resumed);

  report.consoleErrors = toolText(await call('list_console_messages', { types: ['error'] }));
  assert(!/msgid=/.test(report.consoleErrors), '浏览器控制台出现 Angular 错误');
  report.result = '通过';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.serverLog = serverLog.slice(-12000);
  throw error;
} finally {
  if (connection) {
    await connection.client.close().catch(() => {});
    await connection.transport.close().catch(() => {});
  }
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(3000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('验收证据：', output);
}
