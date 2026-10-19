import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-payment-stages', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 63, checks: [], result: '失败' };
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
  const row = snapshot
    .split('\n')
    .find(
      (line) =>
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
      if ((await fetch(report.baseUrl)).status === 200) break;
    } catch {}
    await delay(300);
  }
  assert(Date.now() < until, 'Angular 服务启动超时');

  connection = await connect({ isolated: true });
  const created = toolText(
    await connection.call('new_page', { url: report.baseUrl + '/sales/quotes/DEMO-O008' }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await call('wait_for', { text: ['CSPD'], timeout: 15000 });
  const app = "ng.getComponent(document.querySelector('app-root'))";
  const ids = await evaluate(`
    const store=${app}.store;
    const contractId=store.createContractDraft('DEMO-O003');
    store.savePaymentTerm({code:'V8-PAY',descriptionZh:'付款验收条款',descriptionEn:'Payment',descriptionDe:'Zahlung',status:'active',crmFields:{}});
    const term=store.paymentTerms().find(t=>t.code==='V8-PAY');
    store.setContractPaymentSelection(contractId,term.id,[]);
    return {contractId,termId:term.id};
  `);
  await call('navigate_page', { url: report.baseUrl + '/contracts/' + ids.contractId });
  await call('wait_for', { text: ['付款验收条款'], timeout: 15000 });
  // 合同详情已改为页签容器：默认停在「合同信息」，未激活页签内容带 [hidden]，
  // 按钮不进无障碍树（文本等待仍能命中），所以先切到「商务与支付」再按 uid 点击。
  await evaluate(`
    const tab=[...document.querySelectorAll('.contract-tabs button')].find((button)=>button.textContent.trim()==='商务与支付');
    if(!tab) throw Error('缺少商务与支付页签');
    tab.click();
    await new Promise((resolve)=>setTimeout(resolve,200));
    return true;
  `);
  await click('财务新增付款方式');
  await call('wait_for', { text: ['款清发货', '按固定金额'], timeout: 10000 });
  await evaluate(`
    document.querySelector('app-dialog details')?.setAttribute('open','');
    const fields={name:'V8首付款',condition:'签约后',method:'按比例',proportion:'30',days:'7',deliveryInFullPayment:'是',ownerName:'验收财务'};
    for(const [key,value] of Object.entries(fields)) {
      const input=document.querySelector('[data-field="'+key+'"]');
      if(!input) throw Error('未找到表单字段 '+key);
      input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    return true;
  `);
  await click('保存');
  await call('wait_for', { text: ['V8首付款', '验收财务'], timeout: 10000 });
  const saved = await evaluate(
    `const store=${app}.store; const row=store.paymentMethods().find(x=>x.name==='V8首付款'); return {row,events:store.state().operationEvents.filter(x=>x.objectId===row?.id)};`,
  );
  assert(saved.row, JSON.stringify(saved));
  assert.equal(saved.row.deliveryInFullPayment, '是');
  assert.equal(saved.row.proportion, 30);
  assert(saved.row.createdAt);
  assert.equal(saved.events.length, 1);
  await check('付款阶段完整表单保存及历史同快照', saved);
  await call('navigate_page', { url: report.baseUrl + '/contracts/' + ids.contractId });
  await call('wait_for', { text: ['V8首付款', '验收财务', '款清发货 是'], timeout: 15000 });
  await check('刷新恢复付款阶段和负责人、款清发货', {});
  await evaluate(`const store=${app}.store,row=store.paymentMethods().find(x=>x.name==='V8首付款');return store.savePaymentMethod({...row,deliveryInFullPayment:null},store.state().dataVersion);`);
  await evaluate(`const host=document.querySelector('app-business-workspaces') || [...document.querySelectorAll('*')].find(e=>ng.getComponent(e)?.editPaymentMethod);const cmp=ng.getComponent(host);cmp.editPaymentMethod(cmp.store.paymentMethods().find(x=>x.name==='V8首付款'));return true;`);
  await call('wait_for', { text: ['维护付款方式'], timeout: 10000 });
  await evaluate(`const input=document.querySelector('[data-field="name"]');input.value='V8仅改名称';input.dispatchEvent(new Event('input',{bubbles:true}));return true;`);
  await click('保存');
  const preserved = await evaluate(`const row=${app}.store.paymentMethods().find(x=>x.name==='V8仅改名称');return {exists:!!row,value:row?.deliveryInFullPayment};`);
  assert.deepEqual(preserved, {exists:true,value:null});
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['V8仅改名称'], timeout: 15000 });
  assert.equal(await evaluate(`return ${app}.store.paymentMethods().find(x=>x.name==='V8仅改名称').deliveryInFullPayment;`), null);
  await check('仅修改付款阶段名称保留显式空值，刷新不回填来源', preserved);
  const stale = await evaluate(
    `const store=${app}.store,row=store.paymentMethods().find(x=>x.name==='V8仅改名称'),before=JSON.stringify(store.state()); const result=store.savePaymentMethod({...row,name:'不应发布'},store.state().dataVersion-1); return {result,unchanged:before===JSON.stringify(store.state())};`,
  );
  assert.deepEqual(stale, { result: false, unchanged: true });
  await check('旧表单拒绝保存且已提交值不变', stale);
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
