import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-signing-quote-basis', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 67, checks: [], result: '失败' };
let server;
let connection;
let pageId;
let serverFailure;
let serverLog = '';
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const response = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const match = response.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + response);
  return JSON.parse(match[1]);
};
const clickText = async (label) => {
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
const clickLink = async (label) => {
  const snapshot = toolText(await call('take_snapshot'));
  const row = snapshot.split('\n').find((line) => line.includes(`link "${label}`));
  assert(row, '找不到链接：' + label);
  await call('click', { uid: row.match(/uid=(\S+)/)[1] });
};
// 共享机器上单次 MCP 调用与页面刷新都可能比预期慢，用条件轮询代替固定等待，避免易碎失败。
// 文本匹配在浏览器内完成：合同详情页正文远超过单次回传上限，截断后判断会漏掉靠后的面板。
const waitForText = async (needles, timeout = 60000) => {
  const until = Date.now() + timeout;
  let text = '';
  for (;;) {
    try {
      const probe = await evaluate(`
        const text=document.body.innerText||'';
        return {found:${JSON.stringify(needles)}.every((needle)=>text.includes(needle)),sample:text.slice(0,200)};`);
      if (probe.found) return true;
      text = probe.sample;
    } catch (error) {
      text = String(error);
    }
    if (Date.now() >= until)
      throw new Error(
        `等待文本超时（${timeout}ms）：${needles.join('、')}；当前页面 ${text.slice(0, 200)}`,
      );
    await delay(500);
  }
};
const check = async (name, body) => {
  const evidence = await evaluate(body);
  assert.equal(evidence.ok, true, JSON.stringify(evidence));
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
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
  const app = "ng.getComponent(document.querySelector('app-root'))";
  const created = toolText(
    await connection.call('new_page', { url: report.baseUrl + '/contracts' }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await waitForText(['CSPD']);
  const ids = await evaluate(`
    const store=${app}.store;
    const sale=store.sale('DEMO-O005');
    store.state.update(s=>{const next=structuredClone(s);const row=next.sales.find(x=>x.id===sale.id);row.stage='合同谈判';row.status='进行中';next.contracts=next.contracts.filter(x=>x.opportunityId!==sale.id);next.activities.push({id:'SIGN-BROWSER-ACT',entityId:sale.id,customerId:sale.customerId,date:'2026-10-10',type:'会议',summary:'签约沟通',people:'采购',next:'签约',operator:'张销售',stage:'合同谈判'});return next;});
    const contractId=store.createContractDraft(sale.id);
    store.updateContractDraft(contractId,{sellerEntity:'演示主体',amount:123456,payment:'人工签约付款',service:'人工现场服务'});
    store.setRole('manager');
    return {contractId};
  `);
  report.contractId = ids.contractId;
  await call('navigate_page', {
    type: 'url',
    url: report.baseUrl + '/contracts/' + ids.contractId,
  });
  await waitForText(['登记签约信息']);
  await clickText('登记签约信息');
  const fillSigning = () =>
    evaluate(`
    const dialog=document.querySelector('[role="dialog"]');
    for(const [key,value] of Object.entries({signedDate:'2026-10-10',evidence:'浏览器签约凭据'})) {
      const input=dialog.querySelector('[data-field="'+key+'"]');
      input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    } return true;
  `);
  await fillSigning();
  await evaluate(`const store=${app}.store;store.setDateMode('comparison');return true;`);
  await clickText('保存');
  await check(
    '旧签约弹窗版本拒绝且保持草稿、商机与项目',
    `
    const store=${app}.store;const c=store.contract(${JSON.stringify(ids.contractId)});
    return {ok:c.status==='草稿'&&!c.adoptedQuoteSnapshot&&store.sale(c.opportunityId).stage==='合同谈判'&&!!document.querySelector('[role="dialog"]')&&document.body.innerText.includes('版本已变化'),status:c.status};`,
  );
  await call('navigate_page', { type: 'reload' });
  await waitForText(['登记签约信息']);
  // Store故障注入与UI使用同一实例，隔离浏览器内还原全部测试条件。
  await check(
    '来源失效、错归属、配额失败与修改权丢失均拒绝并保持整份快照',
    `
    const store=${app}.store;const id=${JSON.stringify(ids.contractId)};const results=[];
    for(const fault of ['unlocked','wrong-customer','wrong-opportunity','quota','lease']) {
      const c=store.contract(id),q=store.quoteVersion(c.quoteVersionId),series=store.state().quoteSeries.find(x=>x.id===c.quoteSeriesId);
      const oldStatus=q.status,oldCustomer=q.customerId,oldOpportunity=series.opportunityId;
      if(fault==='unlocked')q.status='草稿';if(fault==='wrong-customer')q.customerId='OTHER';if(fault==='wrong-opportunity')series.opportunityId='OTHER';
      const before=JSON.stringify(store.state()),oldSet=Storage.prototype.setItem,oldOwns=store.editingLease.owns;
      if(fault==='quota')Storage.prototype.setItem=function(key,value){if(key===store.activeSnapshotKey)throw new Error('容量不足');return oldSet.call(this,key,value);};
      if(fault==='lease')store.editingLease.owns=()=>false;
      let result;
      try {result=store.registerContractAndStartProject(id,'2026-10-10','故障凭据',store.state().dataVersion||1);} finally {Storage.prototype.setItem=oldSet;store.editingLease.owns=oldOwns;}
      results.push({fault,rejected:result===null,unchanged:before===JSON.stringify(store.state()),message:store.ui.toast()?.text});
      q.status=oldStatus;q.customerId=oldCustomer;series.opportunityId=oldOpportunity;
    } return {ok:results.every(x=>x.rejected&&x.unchanged),results};`,
  );
  await clickText('登记签约信息');
  await fillSigning();
  await clickText('保存');
  await waitForText(['签约采用依据']);
  await check(
    'UI显式签约冻结完整摘要、保留人工值并只创建一次首项目',
    `
    const store=${app}.store,c=store.contract(${JSON.stringify(ids.contractId)}),a=c.adoptedQuoteSnapshot;
    const projects=store.state().projects.filter(x=>x.contractId===c.id),events=store.state().operationEvents.filter(x=>x.objectId===c.id&&x.taskSource?.kind==='contract-signing');
    const before=JSON.stringify(store.state());const retry=store.registerContractAndStartProject(c.id,'2026-10-10','再次请求');
    return {ok:c.status==='已登记'&&c.amount===123456&&c.payment==='人工签约付款'&&a?.products.length>0&&a.adoptedTerms.service==='人工现场服务'&&a.commercial.payment!==c.payment&&projects.length===1&&events.length===1&&!!retry&&before===JSON.stringify(store.state()),a,projectCount:projects.length,eventCount:events.length};`,
  );
  await evaluate(`
    const store=${app}.store,key=store.activeSnapshotKey,raw=JSON.parse(localStorage.getItem(key)),state=raw.snapshot||raw;
    const c=state.contracts.find(x=>x.id===${JSON.stringify(ids.contractId)}),series=state.quoteSeries.find(x=>x.id===c.quoteSeriesId),q=series.versions.find(x=>x.id===c.quoteVersionId);
    const next=structuredClone(q);next.id='AFTER-SIGN-V2';next.number=2;next.payment='新报价付款';next.items[0].name='新报价产品';series.versions.push(next);series.activeFinalVersionId=next.id;
    localStorage.setItem(key,JSON.stringify(raw.snapshot?{...raw,snapshot:state}:state));return true;
  `);
  await call('navigate_page', { type: 'reload' });
  await waitForText(['签约采用依据']);
  await check(
    '刷新和后续报价版本均不改写签约采用摘要',
    `
    const store=${app}.store,c=store.contract(${JSON.stringify(ids.contractId)}),a=c.adoptedQuoteSnapshot,panel=document.querySelector('[aria-label="签约采用报价摘要"]');
    return {ok:a.versionNumber===1&&a.quoteVersionId===c.quoteVersionId&&a.products[0].name!=='新报价产品'&&panel.innerText.includes('人工现场服务')&&!panel.innerText.includes('新报价付款')&&!document.body.innerText.includes('登记签约信息'),version:a.versionNumber,text:panel.innerText};`,
  );
  await call('take_screenshot', {
    filePath: path.join(output, 'signed-basis-refreshed.png'),
    fullPage: true,
  });
  report.result = '通过';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.serverLog = serverLog.slice(-12000);
  if (connection && Number.isFinite(pageId)) {
    report.console = toolText(await call('list_console_messages', { types: ['error'] })).slice(
      -4000,
    );
    report.network = toolText(await call('list_network_requests')).slice(-4000);
    report.pageText = await evaluate(
      `return (document.querySelector('main')?.innerText||document.body.innerText||'').slice(0,1200);`,
    ).catch((failure) => String(failure));
  }
  console.error(report.error);
  process.exitCode = 1;
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
