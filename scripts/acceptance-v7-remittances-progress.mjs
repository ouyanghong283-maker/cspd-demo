import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v7-remittances-progress', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 65, checks: [], result: '失败' };
const snapshotExpr = "JSON.parse(localStorage.getItem('cspd-demo:v7:workspace:'+localStorage.getItem('cspd-demo:v7:active-workspace'))).snapshot";
const appExpr = "ng.getComponent(document.querySelector('app-root'))";
const pageExpr = "document.querySelector('main.page-container') || document.querySelector('main')";
const moduleListExpr =
  "return [...document.querySelectorAll('.module-list li')].map(li=>({label:li.querySelector('strong')?.innerText||'',done:li.classList.contains('done'),text:li.innerText.replace(/\\s+/g,' ').trim()}))";
// 旧财务历史夹具：#65 之后任何退役入口都不得再改动这批记录，只读页面必须完整展示它们。
const FIXTURE = {
  order: {
    id: 'B1-SO-001',
    contractId: 'DEMO-CON001',
    orderNumber: 'B1-SO-' + runId,
    projectId: 'DEMO-P001',
    amount: 111.11,
    currency: 'EUR',
    status: '历史有效',
    owner: '历史订单专员',
    deliveryDate: '2026-11-20',
    revision: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  },
  line: {
    id: 'B1-SOL-001',
    orderId: 'B1-SO-001',
    productDescription: '退役守卫历史物料',
    sapMaterialNumber: 'SAP-B1-01',
    quantity: 2,
    unit: '套',
    batchNumber: 'B1-BATCH',
    requestedDeliveryDate: '2026-11-18',
  },
  invoice: {
    id: 'B1-INV-EUR',
    number: 'B1-INV-EUR-' + runId,
    contractId: 'DEMO-CON001',
    projectIds: ['DEMO-P001'],
    amount: 100,
    received: 25,
    currency: 'EUR',
    issued: '2026-09-01',
    due: '2026-10-01',
    cumulativeSource: 'legacy-simulation',
    revision: 2,
    updatedAt: '2026-09-03T00:00:00.000Z',
  },
  receipt: {
    id: 'B1-RECEIPT-001',
    number: 'B1-RECEIPT-' + runId,
    contractId: 'DEMO-CON001',
    amount: 40,
    currency: 'EUR',
    status: '有效',
    receivedAt: '2026-10-05',
    // 旧财务 ID 与源系统技术字段：退役后必须继续只读展示，保证历史可追溯。
    sourceIds: { alp_claim_water_bill: 'B1-WB-77001' },
    crmFields: { alp_water_bill_no: 'B1-WB-NO-01' },
  },
  claimLine: {
    id: 'B1-CLAIM-LINE-001',
    receiptId: 'B1-RECEIPT-001',
    orderId: 'B1-SO-001',
    invoiceId: 'B1-INV-EUR',
    amount: 25,
    currency: 'EUR',
    status: '有效',
    sourceIds: { alp_water_bill_claim_details: 'B1-WBC-88001' },
    crmFields: { alp_claim_details_code: 'B1-WBC-CODE-01' },
  },
};
let server;
let serverFailure;
let serverLog = '';
let connection;
let pageId;
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + raw);
  return JSON.parse(match[1]);
};
const check = async (name, fn) => {
  const evidence = await fn();
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
  return evidence;
};
const state = () => evaluate(`const value=${snapshotExpr};if(!value)throw Error('缺少活动工作区');return value`);
const ready = async () => call('wait_for', { text: ['CSPD 项目全链条协同平台'], timeout: 20000 });
const waitFor = async (predicate, message) => {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(`return (${predicate})`)) return;
    await delay(100);
  }
  throw new Error(message);
};
const navigate = async (url) => {
  await call('navigate_page', { type: 'url', url: report.baseUrl + url });
  await ready();
};
const setField = async (name, value) => {
  await evaluate(`const e=document.querySelector('[name="${name}"]');if(!e)throw Error('缺少${name}');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));return true`);
};
const flat = (text) => String(text).replace(/\s+/g, ' ').trim();
const contains = (text, token, label) => assert(flat(text).includes(token), `${label || '页面'}缺少「${token}」：\n${text}`);
const moduleList = () =>
  evaluate(`
    const panel=document.querySelector('details.demo-tools');
    if(panel && !panel.open) panel.open=true;
    await new Promise(r=>setTimeout(r,150));
    ${moduleListExpr}
  `);
// 订单／发票／水单的旧直达路由必须只剩只读历史：没有可写字段，也没有任何写按钮。
const readRetiredPage = async (segment, title) => {
  await navigate(`/contracts/DEMO-CON001/${segment}`);
  const page = await evaluate(`
    const main = ${pageExpr};
    return {
      url: ${appExpr}.router.url,
      title: main.querySelector('h1')?.innerText.trim() || '',
      body: main.innerText,
      text: main.textContent,
      details: main.querySelectorAll('details').length,
      inputs: main.querySelectorAll('input, select, textarea').length,
      buttons: [...main.querySelectorAll('button')].map((node) => node.innerText.trim()),
      writeButtons: [...main.querySelectorAll('button')]
        .filter((node) => /新增|编辑|保存|提交|认领|回款/.test(node.innerText))
        .map((node) => node.innerText.trim()),
      anchors: [...main.querySelectorAll('a')].map((node) => ({ text: node.innerText.trim(), href: node.getAttribute('href') || '' })),
    };
  `);
  assert.equal(page.url, `/contracts/DEMO-CON001/${segment}`, JSON.stringify(page).slice(0, 600));
  assert(page.title.includes(title) && page.title.includes('只读历史'), JSON.stringify(page.title));
  assert.equal(page.inputs, 0, `旧直达路由 ${segment} 不得保留可写字段：` + JSON.stringify(page));
  assert.deepEqual(page.writeButtons, [], `旧直达路由 ${segment} 不得保留写按钮：` + JSON.stringify(page));
  contains(page.body, '已停用', `旧直达路由 ${segment}`);
  const backLink = page.anchors.find((item) => item.text === '返回合同');
  assert(backLink, `只读历史页 ${segment} 缺少返回合同入口：` + JSON.stringify(page.anchors));
  assert.equal(backLink.href, '/contracts/DEMO-CON001');
  await evaluate(
    `[...document.querySelectorAll('main a')].find((link) => link.innerText.trim() === '返回合同').click(); return true;`,
  );
  await delay(200);
  const back = await evaluate(
    `return { url: ${appExpr}.router.url, contract: (${pageExpr}).innerText.includes('DEMO-CON001') };`,
  );
  assert.equal(back.url, '/contracts/DEMO-CON001', `返回合同入口必须回到合同页：` + JSON.stringify(back));
  assert(back.contract, '合同页必须展示当前合同：' + JSON.stringify(back));
  return { ...page, backUrl: back.url };
};

try {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  report.baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [
    path.join(root, 'node_modules/@angular/cli/bin/ng.js'), 'serve', '--host', '127.0.0.1',
    '--port', String(port), '--watch=false', '--live-reload=false', '--hmr=false',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false', NO_COLOR: '1' } });
  server.on('error', (error) => { serverFailure = error; });
  server.on('exit', (code, signal) => { serverFailure = new Error(`服务退出：${code ?? signal}`); });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { serverLog = (serverLog + chunk.toString()).slice(-10000); });
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    if (serverFailure) throw serverFailure;
    try { if ((await fetch(report.baseUrl)).status === 200) break; } catch {}
    await delay(300);
  }
  assert(Date.now() < until, 'Angular 服务启动超时：' + serverLog.slice(-2500));

  connection = await connect({ isolated: true });
  const created = toolText(await connection.call('new_page', { url: report.baseUrl + '/contracts/DEMO-CON001/orders', timeout: 30000 }));
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await ready();

  await check('注入旧财务历史夹具后刷新保留，合同订单页只读且无写入口', async () => {
    await evaluate(`
      const key = 'cspd-demo:v7:workspace:' + localStorage.getItem('cspd-demo:v7:active-workspace');
      const envelope = JSON.parse(localStorage.getItem(key));
      const snapshot = envelope.snapshot;
      // 隔离夹具：该合同的旧财务历史就是本夹具，避免种子样例干扰只读断言。
      snapshot.orders = [${JSON.stringify(FIXTURE.order)}];
      snapshot.orderLines = [${JSON.stringify(FIXTURE.line)}];
      snapshot.contractInvoices = [${JSON.stringify(FIXTURE.invoice)}];
      snapshot.invoiceReceiptClaims = [];
      snapshot.bankReceiptClaims = [${JSON.stringify(FIXTURE.receipt)}];
      snapshot.bankReceiptClaimLines = [${JSON.stringify(FIXTURE.claimLine)}];
      snapshot.financeSnapshots = [];
      snapshot.migrationReviewItems = [];
      envelope.snapshot = snapshot;
      localStorage.setItem(key, JSON.stringify(envelope));
      return true;
    `);
    await call('navigate_page', { type: 'reload', ignoreCache: true });
    await ready();
    const page = await readRetiredPage('orders', '销售订单与明细');
    assert(!page.buttons.includes('新增订单'), '订单页不得保留“新增订单”按钮：' + JSON.stringify(page.buttons));
    assert(!page.buttons.includes('保存订单'), '订单页不得保留“保存订单”按钮：' + JSON.stringify(page.buttons));
    for (const token of [
      FIXTURE.order.orderNumber,
      FIXTURE.order.id,
      `修订 ${FIXTURE.order.revision}`,
      FIXTURE.line.id,
      FIXTURE.line.sapMaterialNumber,
      FIXTURE.line.batchNumber,
      '青山储能一期 · DEMO-P001',
    ])
      contains(page.body, token, '合同订单只读历史页');
    const persisted = await state();
    assert(
      persisted.orders.some((item) => item.id === FIXTURE.order.id) &&
        persisted.orderLines.some((item) => item.id === FIXTURE.line.id),
      '刷新后旧订单历史丢失',
    );
    await call('take_screenshot', { filePath: path.join(output, 'contract-orders-readonly.png'), fullPage: true });
    return {
      orderId: FIXTURE.order.id,
      lineId: FIXTURE.line.id,
      orderNumber: FIXTURE.order.orderNumber,
      inputs: page.inputs,
      writeButtons: page.writeButtons,
      refreshRetained: true,
    };
  });

  await check('合同发票页只读，历史ID、余额与项目引用可追溯', async () => {
    const page = await readRetiredPage('invoices', '合同发票与余额');
    assert(!page.buttons.includes('新增发票'), '发票页不得保留“新增发票”按钮：' + JSON.stringify(page.buttons));
    for (const token of [
      FIXTURE.invoice.number,
      FIXTURE.invoice.id,
      'EUR 100.00 / EUR 25.00 / EUR 75.00',
      'EUR 已开 EUR 100.00 · 已回 EUR 25.00 · 余额 EUR 75.00（1 张）',
      '青山储能一期 · DEMO-P001',
    ])
      contains(page.body, token, '合同发票只读历史页');
    await call('take_screenshot', { filePath: path.join(output, 'contract-invoices-readonly.png'), fullPage: true });
    return { invoiceId: FIXTURE.invoice.id, invoiceNumber: FIXTURE.invoice.number, inputs: page.inputs, writeButtons: page.writeButtons };
  });

  await check('水单认领页只读，认领明细、订单／发票引用与币种余额可追溯', async () => {
    const page = await readRetiredPage('receipts', '水单认领');
    assert(
      !page.buttons.includes('保存水单和认领明细'),
      '水单页不得保留“保存水单和认领明细”按钮：' + JSON.stringify(page.buttons),
    );
    for (const token of [
      FIXTURE.receipt.number,
      FIXTURE.receipt.id,
      FIXTURE.claimLine.id,
      `订单 ${FIXTURE.order.id}`,
      `发票 ${FIXTURE.invoice.id}`,
      'EUR 已认领 25.00',
      '水单余额 15.00',
      `旧财务水单ID ${FIXTURE.receipt.sourceIds.alp_claim_water_bill}`,
      `旧财务认领明细ID ${FIXTURE.claimLine.sourceIds.alp_water_bill_claim_details}`,
    ])
      contains(page.body, token, '水单认领只读历史页');
    // 源系统技术字段折叠在 details 中，用页面全文核对旧来源字段可追溯。
    assert(page.details > 0, '水单只读页必须保留源系统技术字段区块：' + JSON.stringify({ details: page.details }));
    for (const token of [
      '源系统技术字段（只读）',
      'alp_water_bill_no',
      FIXTURE.receipt.crmFields.alp_water_bill_no,
      'alp_claim_details_code',
      FIXTURE.claimLine.crmFields.alp_claim_details_code,
    ])
      contains(page.text, token, '水单只读页源系统技术字段');
    await call('take_screenshot', { filePath: path.join(output, 'contract-receipts-readonly.png'), fullPage: true });
    return {
      receiptId: FIXTURE.receipt.id,
      claimLineId: FIXTURE.claimLine.id,
      inputs: page.inputs,
      writeButtons: page.writeButtons,
      legacySourceIds: {
        receipt: FIXTURE.receipt.sourceIds,
        claimLine: FIXTURE.claimLine.sourceIds,
      },
      sourceFieldBlocks: page.details,
    };
  });

  await check('直接调用 4 个退役 Store 入口被拒绝且状态深度不变', async () => {
    const refused = await evaluate(`
      const store = ${appExpr}.store;
      const snapshot = store.state();
      const invoice = snapshot.contractInvoices.find((item) => item.id === ${JSON.stringify(FIXTURE.invoice.id)});
      const receipt = snapshot.bankReceiptClaims.find((item) => item.id === ${JSON.stringify(FIXTURE.receipt.id)});
      const line = snapshot.bankReceiptClaimLines.find((item) => item.id === ${JSON.stringify(FIXTURE.claimLine.id)});
      const before = JSON.stringify(snapshot);
      const eventsBefore = (snapshot.operationEvents || []).length;
      const results = [];
      const attempt = (name, run) => {
        let returned;
        let thrown = '';
        try { returned = run(); } catch (error) { thrown = error.message || String(error); }
        results.push({ name, returned, thrown, message: store.ui.toast()?.text || '' });
      };
      attempt('saveSalesOrder', () => store.saveSalesOrder(
        { id: ${JSON.stringify(FIXTURE.order.id)}, contractId: 'DEMO-CON001', orderNumber: 'B1-SO-BLOCKED', projectId: 'DEMO-P001', amount: 999, currency: 'EUR', status: '试图写入', revision: ${FIXTURE.order.revision + 1}, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', owner: '退役守卫' },
        [{ id: ${JSON.stringify(FIXTURE.line.id)}, orderId: ${JSON.stringify(FIXTURE.order.id)}, productDescription: '试图写入', quantity: 9, unit: '台' }],
      ));
      attempt('saveContractInvoice', () => store.saveContractInvoice({ ...invoice, amount: 999, revision: 9 }));
      attempt('saveBankReceiptClaim', () => store.saveBankReceiptClaim({ ...receipt, amount: 999 }, [{ ...line, amount: 999 }]));
      attempt('simulateReceipt', () => store.simulateReceipt('DEMO-P001', ${JSON.stringify(FIXTURE.invoice.id)}, false));
      const after = store.state();
      const find = (rows, id) => (rows || []).find((item) => item.id === id);
      return {
        results,
        unchanged: JSON.stringify(after) === before,
        eventsBefore,
        eventsAfter: (after.operationEvents || []).length,
        currentRoundEvents: (after.operationEvents || []).filter((event) => event.roundId === after.roundId).length,
        orderNumber: find(after.orders, ${JSON.stringify(FIXTURE.order.id)})?.orderNumber,
        lineDescription: find(after.orderLines, ${JSON.stringify(FIXTURE.line.id)})?.productDescription,
        invoiceAmount: find(after.contractInvoices, ${JSON.stringify(FIXTURE.invoice.id)})?.amount,
        invoiceReceived: find(after.contractInvoices, ${JSON.stringify(FIXTURE.invoice.id)})?.received,
        invoiceSource: find(after.contractInvoices, ${JSON.stringify(FIXTURE.invoice.id)})?.cumulativeSource,
        receiptAmount: find(after.bankReceiptClaims, ${JSON.stringify(FIXTURE.receipt.id)})?.amount,
        claimAmount: find(after.bankReceiptClaimLines, ${JSON.stringify(FIXTURE.claimLine.id)})?.amount,
        counts: {
          orders: (after.orders || []).length,
          orderLines: (after.orderLines || []).length,
          invoices: (after.contractInvoices || []).length,
          receipts: (after.bankReceiptClaims || []).length,
          claimLines: (after.bankReceiptClaimLines || []).length,
        },
      };
    `);
    assert.equal(refused.results.length, 4, JSON.stringify(refused));
    for (const result of refused.results) {
      assert.equal(result.returned, false, '退役入口必须返回失败：' + JSON.stringify(result));
      assert.match(result.message, /已停用/, '退役入口必须给出停用提示：' + JSON.stringify(result));
    }
    assert(refused.unchanged, '退役入口调用后快照必须完全不变：' + JSON.stringify(refused));
    assert.equal(refused.eventsAfter, refused.eventsBefore, '退役入口不得新增操作事件：' + JSON.stringify(refused));
    assert.equal(refused.currentRoundEvents, 0, '退役入口不得写入本轮操作事件：' + JSON.stringify(refused));
    assert.equal(refused.orderNumber, FIXTURE.order.orderNumber);
    assert.equal(refused.lineDescription, FIXTURE.line.productDescription);
    assert.equal(refused.invoiceAmount, FIXTURE.invoice.amount);
    assert.equal(refused.invoiceReceived, FIXTURE.invoice.received);
    assert.equal(refused.invoiceSource, FIXTURE.invoice.cumulativeSource);
    assert.equal(refused.receiptAmount, FIXTURE.receipt.amount);
    assert.equal(refused.claimAmount, FIXTURE.claimLine.amount);
    assert.deepEqual(refused.counts, { orders: 1, orderLines: 1, invoices: 1, receipts: 1, claimLines: 1 });
    report.retiredStoreCalls = refused.results;
    return { refusedStoreCalls: refused.results, stateUnchanged: refused.unchanged, counts: refused.counts };
  });

  await check('本轮主线与项目选择持久化；退役财务写入不点亮合同板块', async () => {
    await navigate('/');
    const options = await evaluate("return [...document.querySelector('[name=selectedMainline]').options].map(o=>({value:o.value,text:o.text}))");
    assert(options.some((item) => item.value === 'DEMO-O005'), '找不到演示商机主线');
    await setField('selectedMainline', 'DEMO-O005');
    await waitFor(`${snapshotExpr}.selectedMainlineId==='DEMO-O005'`, '主线选择未保存');
    const projectOptions = await evaluate("return [...document.querySelector('[name=selectedProject]').options].map(o=>o.value)");
    assert(projectOptions.includes('DEMO-P001'), '项目选择器缺少P001');
    await setField('selectedProject', 'DEMO-P001');
    await waitFor(`${snapshotExpr}.selectedProjectId==='DEMO-P001'`, '项目选择未保存');
    await call('navigate_page', { type: 'reload', ignoreCache: true });
    await ready();
    const persisted = await state();
    assert.equal(persisted.selectedMainlineId, 'DEMO-O005');
    assert.equal(persisted.selectedProjectId, 'DEMO-P001');
    const restored = await moduleList();
    assert.equal(restored.length, 5, JSON.stringify(restored));
    const contract = restored.find((item) => item.label === '合同');
    assert(contract, JSON.stringify(restored));
    assert.equal(contract.done, false, '退役订单／发票／水单写入不得点亮合同板块：' + JSON.stringify(restored));
    const retiredEvents = await evaluate(
      `const s=${snapshotExpr};return {roundId: s.roundId, currentRound: (s.operationEvents||[]).filter((event)=>event.roundId===s.roundId).length, receiptModule: (s.operationEvents||[]).filter((event)=>event.roundId===s.roundId && event.module==='合同水单').length}`,
    );
    assert.equal(retiredEvents.currentRound, 0, '退役财务写入不得产生本轮操作事件：' + JSON.stringify(retiredEvents));
    assert.equal(retiredEvents.receiptModule, 0, JSON.stringify(retiredEvents));
    await call('take_screenshot', { filePath: path.join(output, 'round-progress.png'), fullPage: true });
    return {
      selectedMainlineId: persisted.selectedMainlineId,
      selectedProjectId: persisted.selectedProjectId,
      modules: restored,
      retiredEvents,
      refreshRetained: true,
    };
  });

  await check('现行合同操作仍按本轮事件点亮合同板块', async () => {
    const live = await evaluate(`
      const store = ${appExpr}.store;
      const roundId = store.state().roundId;
      const currentRound = () => (store.state().operationEvents || []).filter((event) => event.roundId === roundId);
      const before = currentRound().length;
      const contractId = store.createContractDraft('DEMO-O003');
      store.setRoundContext('DEMO-O003');
      return {
        contractId,
        before,
        after: currentRound().length,
        events: currentRound().map((event) => ({ module: event.module, objectId: event.objectId, action: event.action })),
      };
    `);
    assert(live.contractId, '现行合同草稿没有创建：' + JSON.stringify(live));
    assert.equal(live.after, live.before + 1, '现行合同草稿必须写入一条本轮操作事件：' + JSON.stringify(live));
    await delay(200);
    const restored = await moduleList();
    const contract = restored.find((item) => item.label === '合同');
    assert(contract?.done, '现行合同操作必须点亮合同板块：' + JSON.stringify(restored));
    const progress = await evaluate(
      `const modules = ng.getComponent(document.querySelector('app-round-progress')).progress().modules; const contract = modules.find((item) => item.id === 'contract'); return { done: contract.done, count: contract.events.length, eventModules: contract.events.map((event) => event.module) };`,
    );
    assert(progress.done && progress.count >= 1, JSON.stringify(progress));
    assert(progress.eventModules.includes('contract-workspace'), JSON.stringify(progress));
    return { contractId: live.contractId, mainlineId: 'DEMO-O003', liveEvents: live.events, contractModule: progress };
  });

  const errors = toolText(await call('list_console_messages', { types: ['error', 'warn'] }));
  assert(/no console messages found/i.test(errors), errors);
  report.consoleErrorsAndWarnings = errors;
  report.result = '通过';
} catch (error) {
  report.error = error.stack || error.message;
  report.serverLogTail = serverLog.slice(-2500);
  report.result = '失败';
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('REPORT', path.join(output, 'results.json'));
  if (connection) await connection.client.close();
  if (server && !server.killed) server.kill('SIGTERM');
}
