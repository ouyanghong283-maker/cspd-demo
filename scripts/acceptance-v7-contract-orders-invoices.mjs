import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v7-contract-orders-invoices', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 65, checks: [], result: '失败' };
const SNAPSHOT =
  "JSON.parse(localStorage.getItem('cspd-demo:v7:workspace:'+localStorage.getItem('cspd-demo:v7:active-workspace'))).snapshot";
const appExpr = "ng.getComponent(document.querySelector('app-root'))";
let server;
let connection;
let pageId;
let serverFailure;
let serverLog = '';
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const text = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + text);
  return JSON.parse(match[1]);
};
const step = async (name, fn) => {
  const evidence = await fn();
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
  return evidence;
};
const ready = async () => {
  await call('wait_for', { text: ['CSPD 项目全链条协同平台'], timeout: 20000 });
  await call('wait_for', { text: ['CSPD'], timeout: 20000 });
};
const flat = (text) => String(text).replace(/\s+/g, ' ').trim();
const contains = (text, token, label) =>
  assert(flat(text).includes(token), `${label || '页面'}缺少「${token}」：\n${text}`);
const click = async (label, index = 0) => {
  const snapshot = toolText(await call('take_snapshot'));
  const rows = snapshot
    .split('\n')
    .filter((line) => line.includes('button ' + JSON.stringify(label)) && !line.includes('disabled'));
  assert(rows[index], `找不到可用按钮“${label}”：\n${snapshot.slice(-1800)}`);
  await call('click', { uid: rows[index].match(/uid=(\S+)/)[1] });
  await delay(150);
};
const nav = async (url) => {
  await evaluate(`await ${appExpr}.router.navigateByUrl(${JSON.stringify(url)}); return true;`);
  await delay(250);
  return evaluate(
    `return {url:${appExpr}.router.url, body:document.querySelector('main')?.innerText || ''}`,
  );
};
const navExact = async (url) => {
  const page = await nav(url);
  assert.equal(page.url, url, 'SPA 路由没有到达目标：' + JSON.stringify(page).slice(0, 600));
  return page;
};
const state = async () =>
  evaluate(`const value=${SNAPSHOT};if(!value)throw Error('找不到活动V7工作区');return value`);
const retry = async (predicate, message) => {
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`return (${predicate})`)) return;
    await delay(100);
  }
  throw new Error(message);
};
const projectUrl = (tab, plan) =>
  `/projects/DEMO-P001?tab=${encodeURIComponent(tab)}${plan ? '&plan=' + encodeURIComponent(plan) : ''}`;

// 旧历史夹具：注入后只读展示，任何退役入口都不得再改动这批记录。
const FIXTURE = {
  order: {
    id: 'FIX-SO-001',
    contractId: 'DEMO-CON001',
    orderNumber: 'FIX-SO-' + runId,
    projectId: 'DEMO-P001',
    amount: 123.45,
    currency: 'EUR',
    status: '历史有效',
    owner: '历史订单专员',
    deliveryDate: '2026-11-20',
    revision: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  },
  line: {
    id: 'FIX-SOL-001',
    orderId: 'FIX-SO-001',
    productDescription: '历史验收设备',
    sapMaterialNumber: 'SAP-FIX-01',
    quantity: 2,
    unit: '套',
    batchNumber: 'FIX-BATCH',
    requestedDeliveryDate: '2026-11-18',
  },
  // EUR 100.01／历史模拟累计 10，被 DEMO-P001 与 DEMO-P002 同时引用；到期按客户主节点实际完成日＋账期5天。
  milestoneInvoice: {
    id: 'FIX-INV-EUR',
    number: 'FIX-INV-EUR-' + runId,
    contractId: 'DEMO-CON001',
    projectIds: ['DEMO-P001', 'DEMO-P002'],
    amount: 100.01,
    received: 10,
    currency: 'EUR',
    issued: '2026-10-01',
    due: '',
    dueProjectId: 'DEMO-P001',
    dueMilestoneId: 'DEMO-P001-客户主节点',
    paymentTermDays: 5,
    cumulativeSource: 'legacy-simulation',
    revision: 2,
    updatedAt: '2026-09-03T00:00:00.000Z',
  },
  // EUR 100／既有有效认领 25，余额来源为认领汇总，只读展示。
  claimInvoice: {
    id: 'FIX-INV-CLAIM',
    number: 'FIX-INV-CLAIM-' + runId,
    contractId: 'DEMO-CON001',
    projectIds: ['DEMO-P001'],
    amount: 100,
    received: 0,
    legacyReceived: 0,
    currency: 'EUR',
    issued: '2026-10-02',
    due: '',
    cumulativeSource: 'claims',
    revision: 1,
    updatedAt: '2026-09-04T00:00:00.000Z',
  },
  // USD 50.10／发票约定到期日优先，实际逾期按演示基准日 2026-10-10 计算为 9 天。
  agreedInvoice: {
    id: 'FIX-INV-USD',
    number: 'FIX-INV-USD-' + runId,
    contractId: 'DEMO-CON001',
    projectIds: ['DEMO-P001'],
    amount: 50.1,
    received: 0,
    currency: 'USD',
    issued: '2026-09-01',
    due: '2026-10-01',
    cumulativeSource: 'legacy-simulation',
    revision: 1,
    updatedAt: '2026-09-05T00:00:00.000Z',
  },
  receipt: {
    id: 'FIX-RECEIPT-001',
    number: 'FIX-RECEIPT-' + runId,
    contractId: 'DEMO-CON001',
    amount: 40,
    currency: 'EUR',
    status: '有效',
    receivedAt: '2026-10-05',
    // 旧财务 ID 与源系统技术字段：退役后必须继续只读展示，保证历史可追溯。
    sourceIds: { alp_claim_water_bill: 'CRM-WB-77001' },
    crmFields: { alp_water_bill_no: 'WB-2026-0001' },
    sourceFields: { alp_legacy_received: 25 },
  },
  claimLine: {
    id: 'FIX-CLAIM-LINE-001',
    receiptId: 'FIX-RECEIPT-001',
    orderId: 'FIX-SO-001',
    invoiceId: 'FIX-INV-CLAIM',
    amount: 25,
    currency: 'EUR',
    status: '有效',
    sourceIds: { alp_water_bill_claim_details: 'CRM-WBC-88001' },
    crmFields: { alp_claim_details_code: 'WBC-2026-0001' },
  },
};
const retiredWriteAttempts = `
    const store=${appExpr}.store;
    const before = JSON.stringify(store.state());
    const eventsBefore = store.state().operationEvents?.length || 0;
    const results = [];
    const attempt = (name, run) => {
      let returned;
      let thrown = '';
      try {
        returned = run();
      } catch (error) {
        thrown = error.message || String(error);
      }
      results.push({name, returned, thrown, message: store.ui.toast()?.text || ''});
    };
    attempt('saveSalesOrder', () => store.saveSalesOrder(
      {id: '${FIXTURE.order.id}', contractId: 'DEMO-CON001', orderNumber: 'RETIRED-SO', currency: 'EUR', amount: 1, status: '试图写入', revision: 0, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', owner: '退役守卫'},
      [{id: '${FIXTURE.line.id}', orderId: '${FIXTURE.order.id}', productDescription: '退役守卫', quantity: 1, unit: '台'}],
    ));
    attempt('saveContractInvoice', () => store.saveContractInvoice({...store.state().contractInvoices.find((item) => item.id === '${FIXTURE.agreedInvoice.id}'), amount: 999, revision: 9}));
    attempt('saveBankReceiptClaim', () => store.saveBankReceiptClaim(
      {...store.state().bankReceiptClaims.find((item) => item.id === '${FIXTURE.receipt.id}'), amount: 999},
      [{...store.state().bankReceiptClaimLines.find((item) => item.id === '${FIXTURE.claimLine.id}'), amount: 999}],
    ));
    attempt('simulateReceipt', () => store.simulateReceipt('DEMO-P001', '${FIXTURE.agreedInvoice.id}', false));
    return {
      results,
      unchanged: JSON.stringify(store.state()) === before,
      eventsBefore,
      eventsAfter: store.state().operationEvents?.length || 0,
      orderNumber: store.state().orders.find((item) => item.id === '${FIXTURE.order.id}').orderNumber,
      invoiceAmount: store.state().contractInvoices.find((item) => item.id === '${FIXTURE.agreedInvoice.id}').amount,
      receiptAmount: store.state().bankReceiptClaims.find((item) => item.id === '${FIXTURE.receipt.id}').amount,
      claimLineAmount: store.state().bankReceiptClaimLines.find((item) => item.id === '${FIXTURE.claimLine.id}').amount,
    };
`;

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
  // 本脚本自行在工作区构建上起服务，避免误连其他工作区的 4200。
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
    await connection.call('new_page', { url: report.baseUrl + '/sales/detail/DEMO-O005' }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await ready();

  await step('销售详情只保留标注只读的合同订单历史入口', async () => {
    const links = await evaluate(
      "return [...document.querySelectorAll('a')].map(a=>({text:a.innerText.trim(),href:a.getAttribute('href')})).filter(a=>a.text.includes('销售订单'))",
    );
    const entry = links.find((link) => link.href === '/contracts/DEMO-CON001/orders');
    assert(entry, '销售详情缺少合同订单历史入口：' + JSON.stringify(links));
    assert(entry.text.includes('只读'), '订单历史入口必须标注只读：' + JSON.stringify(entry));
    const page = await navExact('/contracts/DEMO-CON001/orders');
    contains(page.body, '销售订单与明细 · 只读历史', '合同订单历史页');
    return { opportunityId: 'DEMO-O005', contractId: 'DEMO-CON001', entry };
  });

  await step('注入旧财务历史后刷新保留，订单明细与项目引用只读可追溯', async () => {
    await evaluate(`
      const id=localStorage.getItem('cspd-demo:v7:active-workspace');
      const key='cspd-demo:v7:workspace:'+id;
      const envelope=JSON.parse(localStorage.getItem(key));
      const snapshot=envelope.snapshot;
      // 隔离夹具：该合同的历史财务集合就是本夹具，避免种子样例干扰只读汇总断言。
      snapshot.orders=[${JSON.stringify(FIXTURE.order)}];
      snapshot.orderLines=[${JSON.stringify(FIXTURE.line)}];
      snapshot.contractInvoices=[${JSON.stringify(FIXTURE.milestoneInvoice)}, ${JSON.stringify(FIXTURE.claimInvoice)}, ${JSON.stringify(FIXTURE.agreedInvoice)}];
      snapshot.invoiceReceiptClaims=[];
      snapshot.migrationReviewItems=[];
      snapshot.financeSnapshots=[];
      snapshot.bankReceiptClaims=[${JSON.stringify(FIXTURE.receipt)}];
      snapshot.bankReceiptClaimLines=[${JSON.stringify(FIXTURE.claimLine)}];
      envelope.snapshot=snapshot;
      localStorage.setItem(key, JSON.stringify(envelope));
      return true;
    `);
    await call('navigate_page', { type: 'reload', ignoreCache: true });
    await ready();
    const page = await navExact('/contracts/DEMO-CON001/orders');
    for (const token of [
      FIXTURE.order.orderNumber,
      FIXTURE.order.id,
      `修订 ${FIXTURE.order.revision}`,
      FIXTURE.line.id,
      FIXTURE.line.sapMaterialNumber,
      FIXTURE.line.batchNumber,
      '青山储能一期 · DEMO-P001',
      '本功能已停用新增与编辑',
    ])
      contains(page.body, token, '合同订单历史页');
    const persisted = await state();
    assert(
      persisted.orders.some((item) => item.id === FIXTURE.order.id) &&
        persisted.orderLines.some((item) => item.id === FIXTURE.line.id),
      '刷新后旧订单历史丢失',
    );
    await call('take_screenshot', {
      filePath: path.join(output, 'contract-orders-readonly.png'),
      fullPage: true,
    });
    return {
      orderId: FIXTURE.order.id,
      lineId: FIXTURE.line.id,
      orderNumber: FIXTURE.order.orderNumber,
      projectReference: '青山储能一期 · DEMO-P001',
      refreshRetained: true,
    };
  });

  await step('项目要货发货继续只读引用同一订单与明细稳定ID', async () => {
    const page = await nav(projectUrl('计划执行', '要货发货'));
    assert(page.url.startsWith('/projects/DEMO-P001'), page.url);
    for (const token of [
      FIXTURE.order.orderNumber,
      FIXTURE.order.id,
      FIXTURE.line.id,
      FIXTURE.line.sapMaterialNumber,
      FIXTURE.line.batchNumber,
      '合同订单与明细已停用新增与编辑',
    ])
      contains(page.body, token, '项目要货发货页');
    return {
      projectId: 'DEMO-P001',
      orderId: FIXTURE.order.id,
      lineId: FIXTURE.line.id,
      sharedStableId: true,
    };
  });

  await step('设置一条有实际完成日期的客户节点', async () => {
    await nav(projectUrl('计划执行', '客户主节点'));
    const targetRow = await evaluate(
      "return [...document.querySelectorAll('tr')].find(row=>row.innerText.includes('客户要求首批到货'))?.innerText || ''",
    );
    assert(targetRow.includes('客户要求首批到货'), targetRow);
    const clicked = await evaluate(
      "const row=[...document.querySelectorAll('tr')].find(row=>row.innerText.includes('客户要求首批到货'));const b=[...row.querySelectorAll('button')].find(x=>x.innerText.trim()==='编辑');b?.click();return !!b",
    );
    assert(clicked, '客户节点编辑按钮不存在');
    await delay(200);
    await evaluate(
      "const s=[...document.querySelectorAll('[role=dialog] summary')].find(x=>x.innerText.includes('补充信息'));s?.click();return !!s",
    );
    const dialog = await evaluate("return document.querySelector('[role=dialog]')?.innerText || ''");
    assert(dialog.includes('实际完成日期'), dialog);
    for (const [key, value] of Object.entries({
      start: '2026-09-15',
      end: '2026-09-22',
      expected: '2026-09-22',
      actual: '2026-09-20',
      actualSourceReference: '浏览器验收：节点实际完成凭据',
      status: '已完成',
    })) {
      await evaluate(
        `const e=document.querySelector('[data-field="${key}"]');if(!e)throw Error('缺少计划字段${key}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));return true`,
      );
    }
    await click('保存');
    await retry(
      `${SNAPSHOT}.projects.find(p=>p.id==='DEMO-P001').plans.find(p=>p.id==='DEMO-P001-客户主节点').actual==='2026-09-20'`,
      '客户节点实际日期没有保存',
    );
    return { projectId: 'DEMO-P001', milestoneId: 'DEMO-P001-客户主节点', actual: '2026-09-20' };
  });

  await step('合同发票历史只读展示约定到期、节点账期与分币种去重汇总', async () => {
    const page = await navExact('/contracts/DEMO-CON001/invoices');
    const rowOf = async (number) =>
      flat(
        await evaluate(
          `return [...document.querySelectorAll('tr')].find(x=>x.innerText.includes(${JSON.stringify(number)}))?.innerText || ''`,
        ),
      );
    const milestoneRow = await rowOf(FIXTURE.milestoneInvoice.number);
    contains(milestoneRow, '2026-09-25', '共享发票行');
    contains(milestoneRow, '实际节点完成日＋账期', '共享发票行');
    contains(milestoneRow, '实际逾期15天', '共享发票行');
    contains(milestoneRow, FIXTURE.milestoneInvoice.id, '共享发票行');
    contains(milestoneRow, '青山储能一期 · DEMO-P001', '共享发票行');
    contains(milestoneRow, '青山储能二期 · DEMO-P002', '共享发票行');
    const agreedRow = await rowOf(FIXTURE.agreedInvoice.number);
    contains(agreedRow, '2026-10-01', '约定到期发票行');
    contains(agreedRow, '发票约定到期日', '约定到期发票行');
    contains(agreedRow, '实际逾期9天', '约定到期发票行');
    const claimRow = await rowOf(FIXTURE.claimInvoice.number);
    contains(claimRow, '有效认领汇总', '认领汇总发票行');
    contains(claimRow, 'EUR 25.00', '认领汇总发票行');
    for (const total of [
      'EUR 已开 EUR 200.01 · 已回 EUR 35.00 · 余额 EUR 165.01（2 张）',
      'USD 已开 USD 50.10 · 已回 USD 0.00 · 余额 USD 50.10（1 张）',
    ])
      contains(page.body, total, '分币种去重汇总');
    contains(page.body, '已停用新增与编辑', '合同发票历史页');
    const dedupe = await evaluate(`
      const store=${appExpr}.store;
      const shared='${FIXTURE.milestoneInvoice.id}';
      return {
        firstProject: store.invoicesForProject('DEMO-P001').filter((item)=>item.id===shared).length,
        secondProject: store.invoicesForProject('DEMO-P002').filter((item)=>item.id===shared).length,
        contract: store.invoicesForContract('DEMO-CON001').filter((item)=>item.id===shared).length,
        projectOneReferences: store.invoicesForProject('DEMO-P001').map((item)=>item.id),
      };
    `);
    assert.deepEqual(
      [dedupe.firstProject, dedupe.secondProject, dedupe.contract],
      [1, 1, 1],
      '同一发票ID被多项目引用时每个入口只读一次：' + JSON.stringify(dedupe),
    );
    await call('take_screenshot', {
      filePath: path.join(output, 'contract-invoices-readonly.png'),
      fullPage: true,
    });
    return {
      milestoneInvoiceRow: milestoneRow,
      agreedInvoiceRow: agreedRow,
      claimInvoiceRow: claimRow,
      deduplicatedTotals: { EUR: '200.01/35.00/165.01 @2张', USD: '50.10/0.00/50.10 @1张' },
      sharedInvoiceReferencedBy: FIXTURE.milestoneInvoice.projectIds,
      perEntryReadCount: dedupe,
    };
  });

  await step('水单认领历史只读展示认领明细与分币种余额', async () => {
    const page = await navExact('/contracts/DEMO-CON001/receipts');
    for (const token of [
      FIXTURE.receipt.number,
      FIXTURE.receipt.id,
      FIXTURE.claimLine.id,
      `订单 ${FIXTURE.order.id}`,
      `发票 ${FIXTURE.claimInvoice.id}`,
      'EUR 已认领 25.00',
      '水单余额 15.00',
      '已停用新增与编辑',
      `旧财务水单ID ${FIXTURE.receipt.sourceIds.alp_claim_water_bill}`,
      `旧财务认领明细ID ${FIXTURE.claimLine.sourceIds.alp_water_bill_claim_details}`,
    ])
      contains(page.body, token, '水单认领历史页');
    // 源系统技术字段折叠在 details 中，用 textContent 核对原文可追溯。
    const source = await evaluate(`
      const main=document.querySelector('main');
      return {details: main.querySelectorAll('details').length, text: main.textContent};
    `);
    assert(source.details > 0, '水单只读页必须保留源系统技术字段区块：' + JSON.stringify(source));
    for (const token of [
      '源系统技术字段（只读）',
      'alp_water_bill_no',
      FIXTURE.receipt.crmFields.alp_water_bill_no,
      'alp_claim_details_code',
      FIXTURE.claimLine.crmFields.alp_claim_details_code,
    ])
      contains(source.text, token, '水单只读页源系统技术字段');
    return {
      receiptId: FIXTURE.receipt.id,
      claimLineId: FIXTURE.claimLine.id,
      claimSummary: 'EUR 已认领 25.00 · 水单余额 15.00',
      legacySourceIds: {
        receipt: FIXTURE.receipt.sourceIds,
        claimLine: FIXTURE.claimLine.sourceIds,
      },
      sourceFieldBlocks: source.details,
    };
  });

  await step('旧编辑直达路径只读且直接调用退役 Store 入口被拒绝', async () => {
    const pages = [];
    for (const [segment, title] of [
      ['orders', '销售订单与明细'],
      ['invoices', '合同发票与余额'],
      ['receipts', '水单认领'],
    ]) {
      const page = await navExact(`/contracts/DEMO-CON001/${segment}`);
      const controls = await evaluate(`
        const main=document.querySelector('main');
        return {
          title: main.querySelector('h1')?.innerText.trim() || '',
          inputs: main.querySelectorAll('input, select, textarea').length,
          writeButtons: [...main.querySelectorAll('button')].filter((button)=>/新增|编辑|保存|提交|认领|回款/.test(button.innerText)).map((button)=>button.innerText.trim()),
          returnHref: [...main.querySelectorAll('a')].find((link)=>link.innerText.trim()==='返回合同')?.getAttribute('href') || '',
          notice: main.innerText.includes('已停用'),
        };
      `);
      assert(
        controls.title.includes(title) && controls.title.includes('只读历史'),
        JSON.stringify(controls),
      );
      assert.equal(controls.inputs, 0, '旧直达路径不得保留可写字段：' + JSON.stringify(controls));
      assert.deepEqual(controls.writeButtons, [], '旧直达路径不得保留写按钮：' + JSON.stringify(controls));
      assert.equal(controls.returnHref, '/contracts/DEMO-CON001');
      assert(controls.notice, '旧直达路径必须提示已停用：' + JSON.stringify(controls));
      pages.push({ segment, ...controls });
      void page;
    }
    const refused = await evaluate(retiredWriteAttempts);
    for (const result of refused.results) {
      assert.equal(result.returned, false, '退役入口必须返回失败：' + JSON.stringify(result));
      assert.match(result.message, /已停用/, '退役入口必须给出停用提示：' + JSON.stringify(result));
    }
    assert(refused.unchanged, '退役入口调用后快照必须完全不变：' + JSON.stringify(refused));
    assert.equal(refused.eventsAfter, refused.eventsBefore, '退役入口不得新增操作事件');
    assert.equal(refused.orderNumber, FIXTURE.order.orderNumber);
    assert.equal(refused.invoiceAmount, FIXTURE.agreedInvoice.amount);
    assert.equal(refused.receiptAmount, FIXTURE.receipt.amount);
    assert.equal(refused.claimLineAmount, FIXTURE.claimLine.amount);
    return { pages, refusedStoreCalls: refused.results, stateUnchanged: refused.unchanged };
  });

  await step('项目财务页只读，历史模拟回款入口退役且无状态变化', async () => {
    await evaluate(`${appExpr}.store.setRole('finance'); return true;`);
    await nav(projectUrl('财务信息'));
    const loaded = await evaluate(`return !!${appExpr}.store.finance('DEMO-P001');`);
    if (!loaded) {
      await click('加载演示财务数据');
      await retry(
        `${SNAPSHOT}.financeSnapshots?.some(x=>x.projectId==='DEMO-P001')`,
        '项目财务快照没有加载',
      );
      await delay(250);
    }
    const summary = await evaluate(
      "return document.querySelector('app-project-finance')?.innerText || ''",
    );
    assert(!/模拟部分回款|模拟收齐/.test(summary), '项目财务页不得保留模拟回款写按钮：\n' + summary);
    contains(summary, FIXTURE.milestoneInvoice.number, '项目财务页');
    contains(summary, FIXTURE.agreedInvoice.number, '项目财务页');
    contains(summary, '历史模拟回款与合同发票编辑已停用', '项目财务页');
    const refused = await evaluate(`
      const store=${appExpr}.store;
      const before=JSON.stringify(store.state());
      const eventsBefore=store.operationEvents('${FIXTURE.agreedInvoice.id}').length;
      let returned; let thrown='';
      try { returned = store.simulateReceipt('DEMO-P001','${FIXTURE.agreedInvoice.id}',true); } catch (error) { thrown = error.message || String(error); }
      return {
        returned, thrown,
        message: store.ui.toast()?.text || '',
        unchanged: JSON.stringify(store.state()) === before,
        received: store.invoicesForProject('DEMO-P001').find((item)=>item.id==='${FIXTURE.agreedInvoice.id}').received,
        eventsBefore,
        eventsAfter: store.operationEvents('${FIXTURE.agreedInvoice.id}').length,
      };
    `);
    assert.equal(refused.returned, false, JSON.stringify(refused));
    assert.match(refused.message, /已停用/, JSON.stringify(refused));
    assert(refused.unchanged, '模拟回款调用后快照必须完全不变：' + JSON.stringify(refused));
    assert.equal(refused.received, FIXTURE.agreedInvoice.received);
    assert.equal(refused.eventsAfter, refused.eventsBefore);
    await call('take_screenshot', {
      filePath: path.join(output, 'project-finance-readonly.png'),
      fullPage: true,
    });
    return { projectId: 'DEMO-P001', refused, readonlyBalance: refused.received };
  });

  const errors = toolText(await call('list_console_messages', { types: ['error'] }));
  assert(/no console messages found/i.test(errors), errors);
  report.consoleErrors = errors;
  report.result = '通过';
} catch (error) {
  report.error = error.stack || error.message;
  report.result = '失败';
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  if (serverFailure) report.serverError = String(serverFailure);
  report.serverLog = serverLog.slice(-12000);
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('REPORT', path.join(output, 'results.json'));
  if (connection) await connection.client.close().catch(() => {});
  if (server) server.kill();
}
