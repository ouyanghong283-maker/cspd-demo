import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-quote-reference', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 66, checks: [], result: '失败' };
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
    const contractId=store.createContractDraft('DEMO-O014');
    store.updateContractDraft(contractId,{product:'人工产品'});
    return {contractId};
  `);
  assert(ids.contractId, JSON.stringify(ids));
  report.contractId = ids.contractId;

  // 报价侧的准备数据属于报价工作区自身流程（本票不改动其锁定规则），此处只构造
  // “已存在最终锁定报价 / 同商机第二系列 / 错客户版本”三种来源事实。
  await evaluate(`
    const store=${app}.store;
    const key=store.activeSnapshotKey;
    const raw=JSON.parse(localStorage.getItem(key));
    const state=raw.snapshot||raw;
    const series=state.quoteSeries.find(s=>s.number==='DEMO-Q-002');
    const base=series.versions[0];
    base.status='最终锁定';
    base.lockedBy='赵主管';
    base.lockedDate='2026-10-16';
    base.service='';
    series.activeFinalVersionId=base.id;
    const versionB=JSON.parse(JSON.stringify(base));
    versionB.id='DEMO-QV-002-B-1';
    versionB.seriesId='DEMO-Q-002-B';
    versionB.number=1;
    versionB.payment='100%预付（样例）';
    versionB.service='现场服务与备件范围（样例）';
    versionB.items=[{...base.items[0],id:'DEMO-QV-002-B-1-I1',unitPrice:5600000}];
    const versionB2=JSON.parse(JSON.stringify(versionB));
    versionB2.id='DEMO-QV-002-B-2';
    versionB2.number=2;
    versionB2.status='草稿';
    versionB2.lockedBy='';
    versionB2.lockedDate='';
    versionB2.items=[{...base.items[0],id:'DEMO-QV-002-B-2-I1',unitPrice:5700000}];
    state.quoteSeries.push({id:'DEMO-Q-002-B',number:'DEMO-Q-002-B',opportunityId:'DEMO-O014',versions:[versionB,versionB2],activeFinalVersionId:versionB.id,createdBy:'DEMO样例',createdDate:'2026-10-16'});
    const versionC=JSON.parse(JSON.stringify(base));
    versionC.id='DEMO-QV-002-C-1';
    versionC.seriesId='DEMO-Q-002-C';
    versionC.customerId='DEMO-C001';
    versionC.contactId='';
    state.quoteSeries.push({id:'DEMO-Q-002-C',number:'DEMO-Q-002-C',opportunityId:'DEMO-O014',versions:[versionC],activeFinalVersionId:versionC.id,createdBy:'DEMO样例',createdDate:'2026-10-16'});
    localStorage.setItem(key, raw.snapshot?JSON.stringify({...raw,snapshot:state}):JSON.stringify(state));
    return true;
  `);
  await call('navigate_page', {
    type: 'url',
    url: report.baseUrl + '/contracts/' + ids.contractId,
  });
  await waitForText(['报价版本来源']);

  await check(
    '未关联草稿允许暂缺关联并说明原因',
    `const store=${app}.store;const panel=document.querySelector('[aria-label="合同报价来源"]');
    const contract=store.state().contracts.find(x=>x.id===${JSON.stringify(ids.contractId)});
    const text=panel.innerText;
    return {ok:text.includes('当前引用：未关联')&&text.includes('草稿暂未关联报价版本')&&!contract.quoteVersionId&&!contract.quoteSeriesId,text:text.slice(0,120)};`,
  );

  const beforeLookup = await evaluate(
    `return ${app}.store.state().operationEvents.filter(x=>x.objectId===${JSON.stringify(ids.contractId)}).length;`,
  );
  await evaluate(`
    const input=document.querySelector('[aria-label="报价号"]');
    input.value='DEMO-Q-006';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  `);
  await clickText('查询报价候选');
  await check(
    '错商机报价号说明原因且不可选择、不改动合同归属',
    `const store=${app}.store;const panel=document.querySelector('[aria-label="合同报价来源"]');
    const rows=[...panel.querySelectorAll('[aria-label="报价候选"] tbody tr')].map(r=>r.innerText);
    const button=panel.querySelector('[aria-label^="选择报价版本 DEMO-Q-006"]');
    const contract=store.state().contracts.find(x=>x.id===${JSON.stringify(ids.contractId)});
    const events=store.state().operationEvents.filter(x=>x.objectId===contract.id).length;
    return {ok:rows.length===1&&rows[0].includes('属于商机 DEMO-O005')&&rows[0].includes('不自动更改合同归属')&&!!button&&button.disabled&&
      contract.opportunityId==='DEMO-O014'&&contract.customerId==='DEMO-C002'&&!contract.quoteVersionId&&events===${beforeLookup},
      rows,disabled:button?.disabled,events,expectedEvents:${beforeLookup}};`,
  );
  await evaluate(`
    const input=document.querySelector('[aria-label="报价号"]');
    input.value='DEMO-Q-002-C';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  `);
  await clickText('查询报价候选');
  await check(
    '错客户报价号说明原因且不可选择',
    `const panel=document.querySelector('[aria-label="合同报价来源"]');
    const rows=[...panel.querySelectorAll('[aria-label="报价候选"] tbody tr')].map(r=>r.innerText);
    const button=panel.querySelector('[aria-label^="选择报价版本 DEMO-Q-002-C"]');
    return {ok:rows.length===1&&rows[0].includes('与合同客户 DEMO-C002')&&rows[0].includes('不自动更改合同归属')&&!!button&&button.disabled,rows};`,
  );

  await evaluate(`
    const input=document.querySelector('[aria-label="报价号"]');
    input.value='DEMO-Q-002';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  `);
  await clickText('查询报价候选');
  await check(
    '正确最终锁定报价候选展示客户、商机、版本、金额币种与锁定状态',
    `const panel=document.querySelector('[aria-label="合同报价来源"]');
    const row=panel.querySelector('[aria-label="报价候选"] tbody tr');
    const text=row.innerText;
    const button=panel.querySelector('[aria-label="选择报价版本 DEMO-Q-002 V1"]');
    return {ok:text.includes('DEMO-Q-002 V1')&&text.includes('最终锁定')&&text.includes('海岳储能有限公司')&&
      text.includes('DEMO-O014')&&/5,360,000/.test(text)&&text.includes('CNY')&&!!button&&!button.disabled,text};`,
  );
  await clickText('选择报价版本 DEMO-Q-002 V1');
  await check(
    '显式选择后保存稳定ID与显示号，只补空白并保留人工值',
    `const store=${app}.store;const contract=store.state().contracts.find(x=>x.id===${JSON.stringify(ids.contractId)});
    const snapshot=contract.quoteReferenceSnapshot||{};
    const panel=document.querySelector('[aria-label="合同报价来源"]');
    const diff=[...panel.querySelectorAll('[aria-label="报价来源差异"] tbody tr')].map(r=>[...r.children].map(c=>c.innerText.trim()));
    const events=store.state().operationEvents.filter(x=>x.objectId===contract.id);
    return {ok:contract.quoteVersionId==='DEMO-QV-002-1'&&contract.quoteSeriesId==='DEMO-Q-002'&&
      snapshot.seriesNumber==='DEMO-Q-002'&&snapshot.versionLabel==='V1'&&snapshot.versionNumber===1&&snapshot.savedBy==='张销售'&&
      contract.product==='人工产品'&&contract.payment==='签约30% / 发货60% / 验收10%（样例）'&&contract.service===''&&
      diff.some(r=>r[0]==='产品'&&r[1]==='人工产品'&&r[3]==='人工值保留')&&diff.some(r=>r[0]==='服务约定'&&r[1]==='未填写'&&r[2]==='来源未提供'&&r[3]==='双方均未提供')&&
      events.some(e=>e.taskSource.kind==='contract-quote-reference'),
      snapshot,diff,events:events.length};`,
  );
  await call('take_screenshot', {
    filePath: path.join(output, 'quote-reference-linked.png'),
    fullPage: true,
  });

  await evaluate(`
    const input=document.querySelector('[aria-label="报价号"]');
    input.value='DEMO-Q-002-B';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  `);
  await clickText('查询报价候选');
  await clickText('选择报价版本 DEMO-Q-002-B V1');
  await check(
    '显式换选只补空白，已有付款条件与金额保留并可查看来源差异',
    `const store=${app}.store;const contract=store.state().contracts.find(x=>x.id===${JSON.stringify(ids.contractId)});
    const panel=document.querySelector('[aria-label="合同报价来源"]');
    const diff=[...panel.querySelectorAll('[aria-label="报价来源差异"] tbody tr')].map(r=>[...r.children].map(c=>c.innerText.trim()));
    const payment=diff.find(r=>r[0]==='付款条件');
    return {ok:contract.quoteSeriesId==='DEMO-Q-002-B'&&contract.quoteVersionId==='DEMO-QV-002-B-1'&&
      contract.payment==='签约30% / 发货60% / 验收10%（样例）'&&contract.amount===5360000&&
      contract.service==='现场服务与备件范围（样例）'&&contract.product==='人工产品'&&
      payment&&payment[1]==='签约30% / 发货60% / 验收10%（样例）'&&payment[2]==='100%预付（样例）'&&payment[3]==='人工值保留',
      payment,diff,amount:contract.amount,service:contract.service};`,
  );

  await call('navigate_page', { type: 'reload' });
  await waitForText(['报价版本来源', 'DEMO-Q-002-B V1']);
  await check(
    '刷新恢复同一引用、显示号与差异',
    `const store=${app}.store;const contract=store.state().contracts.find(x=>x.id===${JSON.stringify(ids.contractId)});
    const panel=document.querySelector('[aria-label="合同报价来源"]');
    const text=panel.innerText;
    return {ok:contract.quoteSeriesId==='DEMO-Q-002-B'&&contract.quoteVersionId==='DEMO-QV-002-B-1'&&
      contract.quoteReferenceSnapshot.seriesNumber==='DEMO-Q-002-B'&&contract.quoteReferenceSnapshot.savedBy==='张销售'&&
      contract.payment==='签约30% / 发货60% / 验收10%（样例）'&&contract.amount===5360000&&
      text.includes('DEMO-Q-002-B V1')&&text.includes('人工值保留')&&text.includes('打开报价来源工作区')};`,
  );

  // AC1「可打开来源」：链接必须落到所关联的系列与版本，而不是同商机的第一个系列。
  await clickLink('打开报价来源');
  await waitForText(['报价工作区', 'DEMO-Q-002-B']);
  // 报价工作区在 main 已改版：系列号在 label[for=quote-version]，版本是 #quote-version 下拉，
  // 不再有 .panel-head h3 / .quote-version-tabs，因此按现结构读取系列、选中版本与选项文本。
  await check(
    '打开来源落在所关联的系列与版本，不落到同商机其它系列',
    `const seriesLabel=document.querySelector('label[for="quote-version"]').innerText;
    const select=document.querySelector('#quote-version');
    const active=select.options[select.selectedIndex]?.text.trim()||'';
    const options=[...select.options].map(o=>o.text.trim());
    return {ok:location.pathname.endsWith('/sales/quotes/DEMO-O014')&&
      location.search.includes('series=DEMO-Q-002-B')&&location.search.includes('version=DEMO-QV-002-B-1')&&
      seriesLabel.startsWith('DEMO-Q-002-B')&&select.value==='DEMO-QV-002-B-1'&&
      active.includes('V1')&&!active.includes('V2'),
      seriesLabel,active,selected:select.value,options,href:location.href};`,
  );
  await call('navigate_page', {
    type: 'url',
    url: report.baseUrl + '/contracts/' + ids.contractId,
  });
  await waitForText(['报价版本来源', 'DEMO-Q-002-B V1']);

  await evaluate(`
    const input=document.querySelector('[aria-label="报价号"]');
    input.value='Q-002-B';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  `);
  await clickText('查询报价候选');
  await check(
    '自由文本、相似报价号与手工填写的版本ID都不产生有效引用',
    `const store=${app}.store;const contractId=${JSON.stringify(ids.contractId)};
    const before=JSON.stringify(store.state());
    const panel=document.querySelector('[aria-label="合同报价来源"]');
    const notFound=panel.innerText.includes('未找到报价号');
    const textResult=store.saveContractQuoteReference(contractId,{seriesId:'DEMO-Q-002-B',versionId:'DEMO-Q-002-B'});
    const toast=store.ui.toast()?.text||'';
    return {ok:notFound&&textResult===false&&/候选中显式选择版本/.test(toast)&&JSON.stringify(store.state())===before,
      notFound,textResult,toast};`,
  );
  await check(
    '过期表单拒绝保存并保持同一引用',
    `const store=${app}.store;const contractId=${JSON.stringify(ids.contractId)};
    const before=JSON.stringify(store.state().contracts.find(x=>x.id===contractId));
    const stale=store.saveContractQuoteReference(contractId,{seriesId:'DEMO-Q-002-B',versionId:'DEMO-QV-002-B-1'},(store.state().dataVersion||1)+3);
    const staleToast=store.ui.toast()?.text||'';
    const raw=JSON.parse(localStorage.getItem(store.activeSnapshotKey));
    const state=raw.snapshot||raw;
    const sourceSeries=state.quoteSeries.find(s=>s.id==='DEMO-Q-002-B');
    sourceSeries.versions[0].status='草稿';
    sourceSeries.activeFinalVersionId='';
    localStorage.setItem(store.activeSnapshotKey, raw.snapshot?JSON.stringify({...raw,snapshot:state}):JSON.stringify(state));
    return {ok:stale===false&&/版本已变化/.test(staleToast)&&
      JSON.stringify(store.state().contracts.find(x=>x.id===contractId))===before,
      stale,staleToast,unchanged:true};`,
  );
  await call('navigate_page', { type: 'reload' });
  await waitForText(['报价版本来源']);
  await check(
    '来源版本不再最终锁定后旧引用保留并如实显示状态',
    `const store=${app}.store;const contract=store.state().contracts.find(x=>x.id===${JSON.stringify(ids.contractId)});
    const panel=document.querySelector('[aria-label="合同报价来源"]');
    const text=panel.innerText;
    return {ok:contract.quoteSeriesId==='DEMO-Q-002-B'&&contract.quoteVersionId==='DEMO-QV-002-B-1'&&
      text.includes('DEMO-Q-002-B V1')&&text.includes('草稿')&&!text.includes('未关联'),text:text.slice(0,160)};`,
  );
  await call('take_screenshot', {
    filePath: path.join(output, 'quote-reference-refreshed.png'),
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
