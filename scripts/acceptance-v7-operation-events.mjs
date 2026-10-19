import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v7-operation-events', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 20, checks: [], result: '失败' };
const opportunityId = 'DEMO-O014';
let server;
let connection;
let pageId;
let serverFailure;
let serverLog = '';

const step = async (name, run) => {
  try {
    const evidence = await run();
    report.checks.push({ name, result: '通过', evidence });
    console.log('PASS', name);
    return evidence;
  } catch (error) {
    report.checks.push({ name, result: '失败', error: error.message });
    throw error;
  }
};
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const text = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + text);
  return JSON.parse(match[1]);
};
const click = async (label) => {
  const snapshot = toolText(await call('take_snapshot'));
  const row = snapshot
    .split('\n')
    .find((line) => line.includes('button ' + JSON.stringify(label)) && !line.includes('disabled'));
  assert(row, '找不到可用按钮：' + label);
  await call('click', { uid: row.match(/uid=(\S+)/)[1] });
};
const fillField = async (key, value) => {
  const result = await evaluate(`
    const field=document.querySelector('[role="dialog"] [data-field=${JSON.stringify(key)}]');
    if(!field) return {found:false};
    field.value=${JSON.stringify(value)};
    field.dispatchEvent(new Event('input',{bubbles:true}));
    return {found:true,value:field.value};
  `);
  assert(result.found, `找不到表单字段：${key}`);
};
const stateSummary = async () =>
  evaluate(`
    const state=ng.getComponent(document.querySelector('app-root')).store.state();
    const sale=state.sales.find(x=>x.id===${JSON.stringify(opportunityId)});
    const workspaceId=localStorage.getItem('cspd-demo:v7:active-workspace');
    return {
      sale: structuredClone(sale),
      events: structuredClone((state.operationEvents||[]).filter(x=>x.objectId===${JSON.stringify(opportunityId)})),
      history: structuredClone(state.history.filter(x=>x.entityId===${JSON.stringify(opportunityId)})),
      dataVersion: state.dataVersion,
      persisted: workspaceId ? localStorage.getItem('cspd-demo:v7:workspace:'+workspaceId) : localStorage.getItem('cspd-demo-v2')
    };
  `);

try {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  report.baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/@angular/cli/bin/ng.js'),
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--watch=false',
      '--live-reload=false',
      '--hmr=false',
    ],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false', NO_COLOR: '1' },
    },
  );
  server.on('error', (error) => (serverFailure = error));
  server.on('exit', (code, signal) => (serverFailure = new Error(`服务退出：${code ?? signal}`)));
  for (const stream of [server.stdout, server.stderr])
    stream.on('data', (chunk) => (serverLog += chunk.toString()));

  await step('Angular 验收服务就绪', async () => {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      if (serverFailure) throw serverFailure;
      try {
        const response = await fetch(report.baseUrl);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert(html.includes('CSPD · 项目全链条协同平台'));
        return { status: response.status };
      } catch (error) {
        if (Date.now() >= until) throw error;
        await delay(300);
      }
    }
    throw new Error('Angular 服务启动超时');
  });

  connection = await connect({ isolated: true });
  const created = toolText(
    await connection.call('new_page', { url: report.baseUrl + '/sales/detail/' + opportunityId }),
  );
  const pageMatch = created.match(/(\d+):.*\[selected\]/);
  assert(pageMatch, created);
  pageId = Number(pageMatch[1]);
  await call('wait_for', { text: ['编辑信息'], timeout: 15000 });
  const initial = await stateSummary();
  assert.equal(initial.sale?.type, 'opportunity', '测试目标必须是现有商机');

  const changedValue = `V7事件验收-${runId}`;
  await click('编辑信息');
  await fillField('project', changedValue);
  await click('保存');
  await call('wait_for', { text: [changedValue], timeout: 10000 });
  const committed = await stateSummary();
  const event = committed.events.find((item) =>
    item.changes.some((change) => change.field === 'projectName' && change.after === changedValue),
  );
  assert(event, '商机修改没有同快照产生结构化操作事件');
  assert.equal(committed.sale.projectName, changedValue);
  assert(committed.history.length > initial.history.length, '既有历史没有同步追加');
  assert.equal(event.roundId, (await evaluate("return ng.getComponent(document.querySelector('app-root')).store.state().roundId")));
  assert.equal(event.mainlineId, initial.sale.leadId || opportunityId);
  assert.equal(event.module, '商机');
  assert.equal(event.department, '销售');
  assert.equal(event.objectType, 'opportunity');
  assert.equal(event.objectId, opportunityId);
  assert.equal(event.operator, '张销售');
  assert.equal(event.owner, initial.sale.owner);
  assert(Number.isFinite(Date.parse(event.occurredAt)));
  assert.equal(event.sourceVersion, initial.dataVersion || 1);
  assert.equal(event.dataVersion, event.sourceVersion + 1);
  assert.deepEqual(event.location, {
    objectType: 'opportunity',
    objectId: opportunityId,
    module: '商机',
    department: '销售',
    section: '商机基本信息',
    action: '修改业务信息',
  });
  const change = event.changes.find((item) => item.field === 'projectName');
  assert.equal(change.valueType, 'string');
  assert.equal(change.before, initial.sale.projectName);
  assert.equal(change.after, changedValue);

  await click('历史');
  const historySnapshot = toolText(await call('take_snapshot'));
  assert(historySnapshot.includes('修改业务信息'));
  assert(historySnapshot.includes(changedValue));
  assert(historySnapshot.includes(event.roundId));
  assert(historySnapshot.includes(String(event.sourceVersion)));
  await fs.writeFile(path.join(output, 'history-snapshot.txt'), historySnapshot);
  await call('take_screenshot', { filePath: path.join(output, 'history.png'), fullPage: true });
  report.checks.push({ name: '商机实际修改、事件契约、版本与历史页', result: '通过', evidence: { event } });
  console.log('PASS 商机实际修改、事件契约、版本与历史页');

  await call('navigate_page', { type: 'reload', ignoreCache: true });
  await call('wait_for', { text: [changedValue], timeout: 10000 });
  const afterReload = await stateSummary();
  assert.deepEqual(afterReload, committed, '刷新后商机、事件、历史或数据版本发生变化');
  report.checks.push({
    name: '刷新后商机与事件共同恢复',
    result: '通过',
    evidence: { dataVersion: afterReload.dataVersion, eventId: event.id },
  });
  console.log('PASS 刷新后商机与事件共同恢复');

  await click('编辑信息');
  await click('保存');
  const afterEmptySave = await stateSummary();
  assert.deepEqual(afterEmptySave, afterReload, '空保存新增事件/历史或改变数据版本');
  report.checks.push({
    name: '空保存不新增事件、历史或数据版本',
    result: '通过',
    evidence: { dataVersion: afterEmptySave.dataVersion, eventCount: afterEmptySave.events.length },
  });
  console.log('PASS 空保存不新增事件、历史或数据版本');

  const savedBeforeFailure = await stateSummary();
  await evaluate(`
    window.__v7OriginalSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key.startsWith('cspd-demo:v7:workspace:')) throw new Error('验收注入：存储写入失败');
      return window.__v7OriginalSetItem.call(this,key,value);
    };
    return true;
  `);
  await click('编辑信息');
  await fillField('project', `不应发布-${runId}`);
  await click('保存');
  await call('wait_for', { text: ['验收注入：存储写入失败'], timeout: 10000 });
  const afterFailure = await stateSummary();
  assert.deepEqual(afterFailure, savedBeforeFailure, '存储写入失败仍发布了部分商机状态');
  await fs.writeFile(path.join(output, 'storage-failure-snapshot.txt'), toolText(await call('take_snapshot')));
  await evaluate(`
    if(window.__v7OriginalSetItem) Storage.prototype.setItem=window.__v7OriginalSetItem;
    delete window.__v7OriginalSetItem;
    return true;
  `);
  report.checks.push({
    name: '存储写入失败时商机、历史和事件均不发布',
    result: '通过',
    evidence: {
      dataVersion: afterFailure.dataVersion,
      eventCount: afterFailure.events.length,
      historyCount: afterFailure.history.length,
      persistedSnapshotUnchanged: afterFailure.persisted === savedBeforeFailure.persisted,
    },
  });
  console.log('PASS 存储写入失败时商机、历史和事件均不发布');

  const consoleText = toolText(await call('list_console_messages', { types: ['error'] }));
  await fs.writeFile(path.join(output, 'browser-console-errors.txt'), consoleText);
  report.consoleErrors = consoleText;
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
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(3000),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('验收证据：', output);
}
