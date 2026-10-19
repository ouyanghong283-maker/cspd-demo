import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v7-review-fixes', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issues: [30, 33], checks: [], result: '失败' };
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
  const created = toolText(await connection.call('new_page', { url: report.baseUrl }));
  pageId = Number(created.match(/(\d+):.*\[selected\]/)[1]);
  const readyUntil = Date.now() + 15000;
  while (
    !(await evaluate(
      "return !!(window.ng?.getComponent(document.querySelector('app-root'))?.store)",
    ))
  ) {
    assert(Date.now() < readyUntil, 'Angular根组件未就绪');
    await delay(200);
  }
  const fixture = await evaluate(`
    const store=ng.getComponent(document.querySelector('app-root')).store;
    store.setRole('sales');
    const state=structuredClone(store.state());
    const contract=state.contracts.find(x=>x.id!==state.projects.find(p=>p.id==='DEMO-P003').contractId)||state.contracts[0];
    contract.status='草稿'; delete contract.paymentSnapshot;
    const project=state.projects.find(x=>x.id==='DEMO-P003');
    project.accepted=true;project.start='2026-10-10';project.briefing.acceptance='浏览器验收标准';
    delete project.briefing.submission;delete project.briefing.confirmation;delete project.briefing.g4;delete project.briefing.startupHandover;
    state.contracts.find(x=>x.id===project.contractId).status='已登记';
    state.attachments.push(...['启动纪要','启动文件'].map((kind,i)=>({id:'REVIEW-DOC-'+i,entityId:project.id,kind,name:kind+'.pdf',size:0,date:'2026-10-10',operator:'张销售',sample:true,url:'',mode:'simulated'})));
    store.state.set(state);
    if(!store.savePaymentTerm({code:'BROWSER-REVIEW',descriptionZh:'浏览器专项验收',descriptionEn:'',descriptionDe:'',status:'active',crmFields:{}}))throw Error('创建条款失败');
    const term=store.paymentTerms().find(x=>x.code==='BROWSER-REVIEW');
    if(!store.savePaymentMethod({name:'浏览器首付款',paymentTermId:term.id,contractId:contract.id,orderId:'ORDER-REF',condition:'签约后',method:'按比例',proportion:30,days:null,fixedAmount:null,followFixedAmount:false,deliveryInFullPayment:'',remarks:'',active:true,crmFields:{}}))throw Error('创建方式失败');
    const method=store.paymentMethods(term.id)[0];
    if(!store.setContractPaymentSelection(contract.id,term.id,[method.id]))throw Error('选择条款失败');
    return {contractId:contract.id,methodId:method.id,projectId:project.id,projectPm:project.pm};
  `);
  await call('navigate_page', { url: report.baseUrl + '/contracts/' + fixture.contractId });
  await call('wait_for', { text: ['财务新增支付条款'], timeout: 15000 });
  await step('销售视角可维护支付主数据，实际表单只改名称保留合同订单关联', async () => {
    const snapshot = toolText(await call('take_snapshot'));
    for (const label of ['财务新增支付条款', '财务新增付款方式'])
      assert(
        snapshot
          .split('\n')
          .some(
            (line) =>
              line.includes('button ' + JSON.stringify(label)) && !line.includes('disabled'),
          ),
        label + '不可用',
      );
    await click('维护');
    await fillField('name', '浏览器修改付款名称');
    await click('保存');
    await call('wait_for', { text: ['浏览器修改付款名称'], timeout: 10000 });
    const method = await evaluate(
      `return structuredClone(ng.getComponent(document.querySelector('app-root')).store.paymentMethods().find(x=>x.id===${JSON.stringify(fixture.methodId)}))`,
    );
    assert.equal(method.name, '浏览器修改付款名称');
    assert.equal(method.contractId, fixture.contractId);
    assert.equal(method.orderId, 'ORDER-REF');
    return method;
  });
  await call('navigate_page', { type: 'reload', ignoreCache: true });
  await call('wait_for', { text: ['浏览器修改付款名称'], timeout: 10000 });
  await step('实际保存后刷新恢复名称和关联', async () => {
    const method = await evaluate(
      `return structuredClone(ng.getComponent(document.querySelector('app-root')).store.paymentMethods().find(x=>x.id===${JSON.stringify(fixture.methodId)}))`,
    );
    assert.equal(method.name, '浏览器修改付款名称');
    assert.equal(method.contractId, fixture.contractId);
    assert.equal(method.orderId, 'ORDER-REF');
    return method;
  });
  await call('take_screenshot', {
    filePath: path.join(output, 'payment-maintenance.png'),
    fullPage: true,
  });
  await call('navigate_page', {
    url: report.baseUrl + '/projects/' + fixture.projectId + '/startup',
  });
  await call('wait_for', { text: ['销售提交交底'], timeout: 15000 });
  await step('销售视角可见跨部门启动按钮并实际完成交底确认G4及移交', async () => {
    const snapshot = toolText(await call('take_snapshot'));
    for (const label of ['销售提交交底', 'PM确认当前版本', '记录 G4 结果'])
      assert(snapshot.includes('button ' + JSON.stringify(label)), label + '不可见');
    await click('销售提交交底');
    await fillField('opinion', '浏览器交底提交');
    await click('保存');
    await click('PM确认当前版本');
    await fillField('opinion', '浏览器跨部门确认');
    await click('保存');
    await click('记录 G4 结果');
    const selected = await evaluate(
      `const field=document.querySelector('[role="dialog"] [data-field="result"]');field.value='通过';field.dispatchEvent(new Event('change',{bubbles:true}));return field.value;`,
    );
    assert.equal(selected, '通过');
    await fillField('opinion', '浏览器G4通过');
    await click('保存');
    await click('确认项目启动移交');
    await fillField('receiver', fixture.projectPm);
    await fillField('opinion', '浏览器实际表单移交');
    await click('保存');
    await call('wait_for', { text: ['本次移交依据已锁定'], timeout: 10000 });
    return {
      role: await evaluate(
        `return ng.getComponent(document.querySelector('app-root')).store.role()`,
      ),
    };
  });
  await step('移交完成后按钮禁用，Store拒绝重录退回且业务事件完全不变', async () => {
    const snapshot = toolText(await call('take_snapshot'));
    for (const label of ['销售提交交底', 'PM确认当前版本', '记录 G4 结果', '确认项目启动移交'])
      assert(
        snapshot
          .split('\n')
          .some(
            (line) => line.includes('button ' + JSON.stringify(label)) && line.includes('disabled'),
          ),
        label + '未禁用',
      );
    const result = await evaluate(`
      const store=ng.getComponent(document.querySelector('app-root')).store;
      const before=JSON.stringify(store.state());
      const accepted=store.recordProjectG4(${JSON.stringify(fixture.projectId)},'退回','不应改变');
      return {accepted,unchanged:JSON.stringify(store.state())===before,project:structuredClone(store.project(${JSON.stringify(fixture.projectId)}))};
    `);
    assert.equal(result.accepted, false);
    assert.equal(result.unchanged, true);
    assert.equal(result.project.briefing.g4.result, '通过');
    assert.equal(result.project.briefing.startupHandover.status, '已移交');
    await fs.writeFile(path.join(output, 'startup-locked-snapshot.txt'), snapshot);
    return result;
  });
  await call('take_screenshot', {
    filePath: path.join(output, 'startup-locked.png'),
    fullPage: true,
  });
  await call('navigate_page', { type: 'reload', ignoreCache: true });
  await call('wait_for', { text: ['本次移交依据已锁定'], timeout: 10000 });
  await step('刷新后正式移交锁定持续存在', async () => {
    const state = await evaluate(
      `const store=ng.getComponent(document.querySelector('app-root')).store;return {role:store.role(),project:structuredClone(store.project(${JSON.stringify(fixture.projectId)}))}`,
    );
    assert.equal(state.role, 'sales');
    assert.equal(state.project.briefing.startupHandover.status, '已移交');
    assert.equal(state.project.briefing.g4.result, '通过');
    return state;
  });
  const consoleText = toolText(await call('list_console_messages', { types: ['error'] }));
  await fs.writeFile(path.join(output, 'browser-console-errors.txt'), consoleText);
  report.consoleErrors = consoleText;
  report.result = '通过';
} catch (error) {
  if (connection && pageId !== undefined)
    await fs
      .writeFile(path.join(output, 'failure-snapshot.txt'), toolText(await call('take_snapshot')))
      .catch(() => {});
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
