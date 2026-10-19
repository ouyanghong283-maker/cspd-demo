import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const report = { runAt: new Date().toISOString(), issue: 21, checks: [], result: '失败' };
const output = path.join(root, 'artifacts', 'v7-editing-lease', runId);
await fs.mkdir(output, { recursive: true });
const opportunityId = 'DEMO-O014';
let server;
let connection;
let firstPageId;
let secondPageId;
let serverFailure;
let serverLog = '';
const check = async (name, run) => {
  const evidence = await run();
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
  return evidence;
};
const call = (pageId, name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (pageId, body) => {
  const text = toolText(await call(pageId, 'evaluate_script', { function: `async () => {${body}}` }));
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + text);
  return JSON.parse(match[1]);
};
const click = async (pageId, label) => {
  const snapshot = toolText(await call(pageId, 'take_snapshot'));
  const row = snapshot
    .split('\n')
    .find((line) => line.includes('button ' + JSON.stringify(label)) && !line.includes('disabled'));
  assert(row, '找不到可用按钮：' + label);
  await call(pageId, 'click', { uid: row.match(/uid=(\S+)/)[1] });
};
const setField = async (pageId, key, value) => {
  const result = await evaluate(
    pageId,
    `const field=document.querySelector('[role="dialog"] [data-field=${JSON.stringify(key)}]'); if(!field)return false; field.value=${JSON.stringify(value)}; field.dispatchEvent(new Event('input',{bubbles:true})); return true;`,
  );
  assert(result, `找不到表单字段：${key}`);
};

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
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    if (serverFailure) throw serverFailure;
    try {
      const response = await fetch(report.baseUrl);
      if (response.status === 200) break;
    } catch {}
    await delay(300);
  }
  assert(Date.now() < until, 'Angular 服务启动超时');

  connection = await connect({ isolated: true });
  const first = toolText(
    await connection.call('new_page', {
      url: report.baseUrl + '/sales/detail/' + opportunityId,
    }),
  );
  firstPageId = Number(first.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(firstPageId), first);
  await call(firstPageId, 'wait_for', { text: ['当前页可修改'], timeout: 15000 });

  const second = toolText(
    await connection.call('new_page', {
      url: report.baseUrl + '/sales/detail/' + opportunityId,
    }),
  );
  secondPageId = Number(second.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(secondPageId), second);
  await call(secondPageId, 'wait_for', { text: ['只读查看'], timeout: 15000 });
  await check('两个同源标签页只允许一个默认修改者', async () => ({
    first: await evaluate(firstPageId, "return ng.getComponent(document.querySelector('app-root')).store.editingWritable()"),
    second: await evaluate(secondPageId, "return ng.getComponent(document.querySelector('app-root')).store.editingWritable()"),
  }));
  assert.equal(await evaluate(firstPageId, "return ng.getComponent(document.querySelector('app-root')).store.editingWritable()"), true);
  assert.equal(await evaluate(secondPageId, "return ng.getComponent(document.querySelector('app-root')).store.editingWritable()"), false);

  await click(firstPageId, '编辑信息');
  const unloadWarning = await evaluate(firstPageId, `
    const event=new Event('beforeunload',{cancelable:true});
    window.dispatchEvent(event);
    return {prevented:event.defaultPrevented,dialogOpen:!!ng.getComponent(document.querySelector('app-root')).ui.dialog()};
  `);
  assert.equal(unloadWarning.prevented, true);
  assert.equal(unloadWarning.dialogOpen, true);
  report.checks.push({ name: '未保存表单离开时触发浏览器提示', result: '通过', evidence: unloadWarning });
  console.log('PASS 未保存表单离开时触发浏览器提示');
  await click(firstPageId, '取消');

  await click(secondPageId, '接管修改权');
  await call(secondPageId, 'wait_for', { text: ['当前页可修改'], timeout: 5000 });
  await call(firstPageId, 'wait_for', { text: ['只读查看'], timeout: 5000 });
  const beforeStaleWrite = await evaluate(firstPageId, "const id=localStorage.getItem('cspd-demo:v7:active-workspace'); return id?localStorage.getItem('cspd-demo:v7:workspace:'+id):localStorage.getItem('cspd-demo-v2')");
  const staleAttempt = await evaluate(firstPageId, `
    const store=ng.getComponent(document.querySelector('app-root')).store;
    const record=structuredClone(store.sale(${JSON.stringify(opportunityId)}));
    record.projectName='旧标签页过期提交-${runId}';
    const accepted=store.saveSales(record);
    const id=localStorage.getItem('cspd-demo:v7:active-workspace');
    return {accepted,persisted:id?localStorage.getItem('cspd-demo:v7:workspace:'+id):localStorage.getItem('cspd-demo-v2')};
  `);
  assert.equal(staleAttempt.accepted, false);
  assert.equal(staleAttempt.persisted, beforeStaleWrite);
  report.checks.push({
    name: '显式接管后旧标签页不能覆盖新数据',
    result: '通过',
    evidence: { accepted: staleAttempt.accepted, storageUnchanged: staleAttempt.persisted === beforeStaleWrite },
  });
  console.log('PASS 显式接管后旧标签页不能覆盖新数据');

  const updatedName = `接管页保存-${runId}`;
  await click(secondPageId, '编辑信息');
  await setField(secondPageId, 'project', updatedName);
  await click(secondPageId, '保存');
  await call(secondPageId, 'wait_for', { text: [updatedName], timeout: 10000 });
  assert.equal(
    await evaluate(firstPageId, `return ng.getComponent(document.querySelector('app-root')).store.sale(${JSON.stringify(opportunityId)}).projectName`),
    updatedName,
    '只读页没有跟随同源已提交快照刷新',
  );
  report.checks.push({ name: '接管页保存成功且只读页同步最新快照', result: '通过', evidence: { projectName: updatedName } });
  console.log('PASS 接管页保存成功且只读页同步最新快照');

  await call(secondPageId, 'navigate_page', { type: 'url', url: 'about:blank' });
  await call(firstPageId, 'wait_for', { text: ['当前页可修改'], timeout: 10000 });
  assert.equal(await evaluate(firstPageId, "return ng.getComponent(document.querySelector('app-root')).store.editingWritable()"), true);
  assert.equal(
    await evaluate(firstPageId, `return ng.getComponent(document.querySelector('app-root')).store.sale(${JSON.stringify(opportunityId)}).projectName`),
    updatedName,
  );
  report.checks.push({ name: '当前修改页关闭后其他页恢复修改资格', result: '通过', evidence: { projectName: updatedName } });
  console.log('PASS 当前修改页关闭后其他页恢复修改资格');
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
  console.log(JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('验收证据：', output);
}
