import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v7-quote-extensions', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 23, checks: [], result: '失败' };
let server;
let connection;
let pageId;
let serverFailure;
let serverLog = '';
const check = async (name, evidence) => {
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
const click = async (label) => {
  const snapshot = toolText(await call('take_snapshot'));
  const row = snapshot.split('\n').find((line) =>
    (line.includes('button ' + JSON.stringify(label)) || line.includes(`button "${label}`)) &&
    !line.includes('disabled'),
  );
  assert(row, '找不到可用按钮：' + label);
  await call('click', { uid: row.match(/uid=(\S+)/)[1] });
};

try {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  report.baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [
    path.join(root, 'node_modules/@angular/cli/bin/ng.js'), 'serve', '--host', '127.0.0.1',
    '--port', String(port), '--watch=false', '--live-reload=false', '--hmr=false',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false', NO_COLOR: '1' } });
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
  const created = toolText(await connection.call('new_page', { url: report.baseUrl + '/sales/quotes/DEMO-O008' }));
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await call('wait_for', { text: ['报价工作区', '创建报价草稿'], timeout: 15000 }).catch(async () => {
    await call('wait_for', { text: ['报价工作区', '维护扩展字段'], timeout: 15000 });
  });
  const app = "ng.getComponent(document.querySelector('app-root'))";
  const start = await evaluate(`
    const store=${app}.store, version=store.quoteSeries('DEMO-O008')?.versions[0];
    return {versionId:version?.id, status:version?.status, canEdit:!!document.querySelector('button') && document.body.innerText.includes('维护扩展字段')};
  `);
  assert(start.versionId && ['草稿', '退回补充'].includes(start.status), JSON.stringify(start));
  await click('维护扩展字段');
  await call('wait_for', { text: ['保存扩展字段', '审批意见'], timeout: 10000 });
  const unloadWarning = await evaluate(`const event=new Event('beforeunload',{cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented;`);
  assert.equal(unloadWarning, true, '内联扩展字段编辑应触发未保存提示');
  await check('内联扩展字段草稿触发离页未保存提示', { prevented: unloadWarning });
  await evaluate(`
    const setInput=(name,value)=>{const input=document.querySelector('[data-logical-name="'+name+'"] input'); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('blur',{bubbles:true}));};
    const setSelect=(name,value)=>{const select=document.querySelector('[data-logical-name="'+name+'"] select'); select.value=value; select.dispatchEvent(new Event('change',{bubbles:true}));};
    setInput('alp_approvedad','销售经理意见待补');
    setInput('alp_purchasedamount','12.5');
    setInput('alp_deliverydate','2026-11-20');
    setSelect('alp_producttype','20');
    setSelect('alp_paymenttermsid','DEMO-PAYTERM-NET30');
    return true;
  `);
  const editEvidence = await evaluate(`
    return {approval:document.querySelector('[data-logical-name="alp_approvedad"] input')?.value,
      quantity:document.querySelector('[data-logical-name="alp_purchasedamount"] input')?.value,
      date:document.querySelector('[data-logical-name="alp_deliverydate"] input')?.value,
      enum:document.querySelector('[data-logical-name="alp_producttype"] select')?.value,
      lookup:document.querySelector('[data-logical-name="alp_paymenttermsid"] select')?.value,
      requiredNote:document.querySelector('[data-logical-name="alp_paymenttermsid"] .source-note')?.innerText,
      readOnly:document.querySelector('[data-logical-name="versionnumber"] .readonly-value')?.innerText};
  `);
  assert.equal(editEvidence.enum, '20');
  assert(editEvidence.requiredNote.includes('待核；当前不强制') && editEvidence.requiredNote.includes('ApplicationRequired'));
  assert(editEvidence.readOnly.includes('远端版本号'));
  await check('类型化控件保留字段类型、CSPD必填状态与只读来源说明', editEvidence);

  await click('保存扩展字段');
  await call('wait_for', { text: ['来源扩展字段', '销售经理意见待补'], timeout: 10000 });
  const saved = await evaluate(`
    const state=${app}.store.state(), version=state.quoteSeries.flatMap(series=>series.versions).find(item=>item.id===${JSON.stringify(start.versionId)});
    const workspaceId=localStorage.getItem('cspd-demo:v7:active-workspace');
    const envelope=JSON.parse(localStorage.getItem('cspd-demo:v7:workspace:'+workspaceId));
    return {fields:version?.crmFields, types:{quantity:typeof version?.crmFields?.alp_purchasedamount, enum:typeof version?.crmFields?.alp_producttype}, localStorage:envelope.snapshot.quoteSeries.flatMap(series=>series.versions).find(item=>item.id===${JSON.stringify(start.versionId)})?.crmFields};
  `);
  assert.deepEqual(saved.fields, {
    alp_approvedad: '销售经理意见待补', alp_purchasedamount: 12.5, alp_deliverydate: '2026-11-20',
    alp_producttype: 20, alp_paymenttermsid: 'DEMO-PAYTERM-NET30',
  });
  assert.equal(saved.types.quantity, 'number');
  assert.equal(saved.types.enum, 'number');
  assert.deepEqual(saved.localStorage, saved.fields);
  await check('保存将文本、数值、日期、枚举原值和稳定Lookup ID写入报价版本快照', saved);

  await call('navigate_page', { url: report.baseUrl + '/sales/quotes/DEMO-O008' });
  await call('wait_for', { text: ['销售经理意见待补', '电池 · 原值 20', 'DEMO-PAYTERM-NET30'], timeout: 15000 });
  const restored = await evaluate(`
    const store=${app}.store, version=store.quoteSeries('DEMO-O008')?.versions.find(item=>item.id===${JSON.stringify(start.versionId)});
    return {fields:version?.crmFields, summary:document.querySelector('.extension-summary-grid')?.innerText, dataVersion:store.state().dataVersion};
  `);
  assert.deepEqual(restored.fields, saved.fields);
  assert(restored.summary.includes('标准CRM版本号') && restored.summary.includes('远端版本号'));
  await check('重新载入后恢复类型化扩展字段与只读来源摘要', restored);

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
