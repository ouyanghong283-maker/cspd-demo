import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'contract-route-guard', runId);
await fs.mkdir(output, { recursive: true });
// 本脚本同时覆盖两张票：#57 合同路由离页守卫，以及 #65 合同财务旧写入退役（四层封禁）。
// 每条检查都带 ticket 字段，避免验收人把 #65 的检查误读为 #57 的结论。
const report = {
  runAt: new Date().toISOString(),
  issue: 57,
  issues: [57, 65],
  scope: '57 合同路由离页守卫；65 合同财务旧写入退役（菜单／按钮／旧直达路由／Store 入口）',
  checks: [],
  result: '失败',
};
let server;
let connection;
let pageId;
let serverFailure;
let serverLog = '';
const check = async (name, evidence, ticket = 57) => {
  report.checks.push({ name, ticket, result: '通过', evidence });
  console.log('PASS', name);
};
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body, dialogAction) => {
  const text = toolText(
    await call('evaluate_script', {
      function: `async () => {${body}}`,
      ...(dialogAction ? { dialogAction } : {}),
    }),
  );
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + text);
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
  const created = toolText(await connection.call('new_page', { url: report.baseUrl + '/' }));
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await call('wait_for', { text: ['演示辅助'], timeout: 15000 });

  const appExpr = "ng.getComponent(document.querySelector('app-root'))";
  await evaluate(`
    window.__nativeConfirm=window.confirm; window.__exitPrompts=[]; window.__allowExit=false;
    window.confirm = message => { window.__exitPrompts.push(message); return window.__allowExit; };
    return true;
  `);
  const navigate = async (url) => {
    await evaluate(`void ${appExpr}.router.navigateByUrl(${JSON.stringify(url)}); return true;`);
    await delay(120);
    return evaluate(`return {url: ${appExpr}.router.url, prompts:window.__exitPrompts.length}`);
  };
  await navigate('/contracts');
  await evaluate(`${appExpr}.store.setPendingInlineEdit(true); return true;`);
  const denied = await navigate('/projects');
  assert.equal(denied.url, '/contracts');
  assert.equal(denied.prompts, 1);
  await check('SPA 离页拒绝确认保留当前合同路由', denied);
  await evaluate('window.__allowExit=true; return true;');
  const allowed = await navigate('/projects');
  assert.equal(allowed.url, '/projects');
  await check('SPA 离页同意确认进入目标路由', allowed);

  await evaluate(`${appExpr}.store.setPendingInlineEdit(false); return true;`);
  await navigate('/contracts/CONTRACT-A');
  await evaluate(
    `${appExpr}.store.setPendingInlineEdit(true); window.__allowExit=false; return true;`,
  );
  const sameRouteDenied = await navigate('/contracts/CONTRACT-B');
  assert.equal(sameRouteDenied.url, '/contracts/CONTRACT-A');
  await check('同组件合同 ID 切换拒绝确认不会丢失当前路由', sameRouteDenied);
  await evaluate('window.__allowExit=true; return true;');
  const sameRouteAllowed = await navigate('/contracts/CONTRACT-B');
  assert.equal(sameRouteAllowed.url, '/contracts/CONTRACT-B');
  await check('同组件合同 ID 切换同意确认进入新 ID', sameRouteAllowed);

  await evaluate(`${appExpr}.store.setPendingInlineEdit(false); return true;`);
  await navigate('/projects');
  await navigate('/contracts/CONTRACT-A');
  await evaluate(
    `${appExpr}.store.setPendingInlineEdit(true); window.__allowExit=false; history.back(); return true;`,
  );
  await delay(200);
  const backDenied = await evaluate(
    `return {url:${appExpr}.router.url,pathname:location.pathname,prompts:window.__exitPrompts.length}`,
  );
  assert.equal(backDenied.url, '/contracts/CONTRACT-A');
  assert.equal(backDenied.pathname, '/contracts/CONTRACT-A');
  await check('浏览器回退拒绝确认恢复当前合同 URL', backDenied);
  // Real contract form + native confirmation verifies the two tickets together.
  await evaluate(`${appExpr}.store.setPendingInlineEdit(false); return true;`);
  const identity = await evaluate(
    `const app=${appExpr}; const id=app.store.createContractDraft('DEMO-O003'); return {id,other:app.store.state().contracts.find(c=>c.id!==id)?.id};`,
  );
  assert(identity.id && identity.other);
  await navigate('/contracts/' + identity.id);
  await click('维护合同主字段');
  await evaluate(`
    const element=document.querySelector('[aria-label="主字段合同名称"]');
    element.value='原生离页确认中的未保存合同'; element.dispatchEvent(new Event('input',{bubbles:true}));
    window.__savedContractState=JSON.stringify(${appExpr}.store.state());
    window.__nativeDialogResults=[];
    window.confirm=message=>{const result=window.__nativeConfirm(message);window.__nativeDialogResults.push({message,result});return result;}; return true;
  `);
  const customerMenu = async () => {
    const snapshot = toolText(await call('take_snapshot'));
    const row = snapshot.split('\n').find((line) => line.includes('link "客户管理"'));
    assert(row, '找不到客户管理导航');
    await call('click', { uid: row.match(/uid=(\S+)/)[1] });
  };
  await customerMenu();
  await call('handle_dialog', { action: 'dismiss' });
  await delay(150);
  const deniedForm = await evaluate(
    `const cmp=ng.getComponent(document.querySelector('app-contract-main-fields')); return {url:${appExpr}.router.url,editing:cmp.editing(),pending:cmp.store.pendingInlineEdit(),title:cmp.title,unchanged:JSON.stringify(cmp.store.state())===window.__savedContractState};`,
  );
  assert.equal(deniedForm.url, '/contracts/' + identity.id);
  assert(deniedForm.editing && deniedForm.unchanged);
  assert.equal(deniedForm.title, '原生离页确认中的未保存合同');
  await check('真实合同表单原生取消离页保留输入与已提交状态', deniedForm);
  // evaluate_script defaults to accepting dialogs; explicitly dismiss the native dialog.
  const deniedIdentity = await evaluate(
    `
    await ${appExpr}.router.navigateByUrl(${JSON.stringify('/contracts/' + identity.other)});
    return {url:${appExpr}.router.url,title:ng.getComponent(document.querySelector('app-contract-main-fields')).title,dialogResult:window.__nativeDialogResults.at(-1)?.result};
  `,
    'dismiss',
  );
  assert.equal(deniedIdentity.url, '/contracts/' + identity.id);
  assert.equal(deniedIdentity.title, '原生离页确认中的未保存合同');
  assert.equal(deniedIdentity.dialogResult, false);
  await check('真实合同表单切换合同原生取消不串记录', deniedIdentity);
  await customerMenu();
  await call('handle_dialog', { action: 'accept' });
  await delay(150);
  const acceptedForm = await evaluate(
    `return {url:${appExpr}.router.url,pending:${appExpr}.store.pendingInlineEdit(),dialogResult:window.__nativeDialogResults.at(-1)?.result,unchanged:JSON.stringify(${appExpr}.store.state())===window.__savedContractState};`,
  );
  assert.equal(acceptedForm.url, '/sales/customers');
  assert(!acceptedForm.pending && acceptedForm.unchanged);
  assert.equal(acceptedForm.dialogResult, true);
  await check('真实合同表单原生同意放弃不保存且清理编辑标记', acceptedForm);
  // #65：合同财务退役后，主菜单、旧直达路由与 Store 入口都不得继续写入。
  await evaluate(`${appExpr}.store.setPendingInlineEdit(false); return true;`);
  const menu = await evaluate(`
    const links = [...document.querySelectorAll('nav[aria-label="主导航"] a')].map((link) => ({
      text: link.innerText.trim(),
      href: link.getAttribute('href') || '',
    }));
    return {total: links.length, retired: links.filter((link) => /\\/contracts\\/[^/]+\\/(orders|invoices|receipts)$/.test(link.href))};
  `);
  assert(menu.total > 0, '主导航没有渲染：' + JSON.stringify(menu));
  assert.equal(menu.retired.length, 0, '主菜单不得保留退役财务入口：' + JSON.stringify(menu.retired));
  await check('主菜单不保留订单/发票/水单写入口', menu, 65);

  for (const [segment, title] of [
    ['orders', '销售订单与明细'],
    ['invoices', '合同发票与余额'],
    ['receipts', '水单认领'],
  ]) {
    await navigate('/contracts/DEMO-CON001/' + segment);
    const page = await evaluate(`
      const main = document.querySelector('main.page-container');
      const text = main?.innerText || '';
      const returnLink = [...main.querySelectorAll('a')].find((link) => link.innerText.trim() === '返回合同');
      return {
        url: ${appExpr}.router.url,
        title: main.querySelector('h1')?.innerText.trim() || '',
        inputs: main.querySelectorAll('input, select, textarea').length,
        writeButtons: [...main.querySelectorAll('button')].filter((button) => /新增|编辑|保存|提交/.test(button.innerText)).length,
        notice: text.includes('已停用'),
        returnHref: returnLink?.getAttribute('href') || '',
      };
    `);
    assert.equal(page.url, '/contracts/DEMO-CON001/' + segment);
    assert(page.title.includes(title), JSON.stringify(page));
    assert(page.title.includes('只读历史'), JSON.stringify(page));
    assert.equal(page.inputs, 0, '旧直达路由不得保留可写字段：' + JSON.stringify(page));
    assert.equal(page.writeButtons, 0, '旧直达路由不得保留写按钮：' + JSON.stringify(page));
    assert(page.notice, '旧直达路由必须明确提示已停用：' + JSON.stringify(page));
    assert.equal(page.returnHref, '/contracts/DEMO-CON001');
    await evaluate(
      `[...document.querySelectorAll('main.page-container a')].find((link) => link.innerText.trim() === '返回合同').click(); return true;`,
    );
    await delay(150);
    const back = await evaluate(
      `return {url:${appExpr}.router.url,contract:document.querySelector('main.page-container')?.innerText.includes('DEMO-CON001') || false};`,
    );
    assert.equal(back.url, '/contracts/DEMO-CON001');
    assert(back.contract);
    await check(
      `旧直达路由 /contracts/:id/${segment} 只读并可返回合同`,
      { ...page, backUrl: back.url },
      65,
    );
  }

  const entries = await evaluate(`
    const links = [...document.querySelectorAll('main.page-container a')]
      .filter((link) => /\\/contracts\\/DEMO-CON001\\/(orders|invoices|receipts)$/.test(link.getAttribute('href') || ''))
      .map((link) => ({href: link.getAttribute('href'), text: link.innerText.trim()}));
    // 合同页同时给出页签内入口与右侧摘要入口；同一路由只算一条，但出现的每一处都必须标注只读。
    return {links, routes: [...new Set(links.map((link) => link.href))]};
  `);
  assert.equal(entries.routes.length, 3, '合同页财务历史入口缺失：' + JSON.stringify(entries));
  for (const entry of entries.links)
    assert(entry.text.includes('只读'), '财务历史入口必须标注只读：' + JSON.stringify(entries.links));
  await check('合同页仅保留标注只读的财务历史入口', entries, 65);

  const retiredAffordances = await evaluate(`
    const label = /新增订单|新增发票|维护水单认领|保存订单|保存发票|保存水单|模拟部分回款|模拟收齐/;
    return [...document.querySelectorAll('button, a, [role="menuitem"]')]
      .filter((node) => label.test(node.innerText || ''))
      .map((node) => ({tag: node.tagName, text: (node.innerText || '').trim()}));
  `);
  assert.deepEqual(
    retiredAffordances,
    [],
    '菜单与页面不得保留任何退役财务写入控件：' + JSON.stringify(retiredAffordances),
  );
  await check('菜单与合同页不保留任何退役财务写入控件', retiredAffordances, 65);

  const retiredWrites = await evaluate(`
    const store = ${appExpr}.store;
    const invoice = store.state().contractInvoices[0];
    const projectId = invoice.projectIds[0];
    const before = JSON.stringify(store.state());
    const results = [];
    const attempt = (name, run) => {
      let returned;
      let thrown = '';
      try {
        returned = run();
      } catch (error) {
        thrown = error.message || String(error);
      }
      results.push({name, returned, thrown, message: Array.from(document.querySelectorAll('.toast')).map((node) => node.innerText.trim()).join(' ') || store.ui.toast()?.text || ''});
    };
    attempt('saveSalesOrder', () => store.saveSalesOrder(
      {id: 'GUARD-SO', contractId: invoice.contractId, orderNumber: 'GUARD-SO', currency: invoice.currency, amount: 1, status: '有效', revision: 0, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', owner: '验收守卫'},
      [{id: 'GUARD-SOL', orderId: 'GUARD-SO', productDescription: '守卫样例', sapMaterialNumber: '', quantity: 1, unit: '台'}],
    ));
    attempt('saveContractInvoice', () => store.saveContractInvoice({...invoice, amount: invoice.amount + 1}));
    attempt('saveBankReceiptClaim', () => store.saveBankReceiptClaim(
      {id: 'GUARD-RECEIPT', number: 'GUARD-RECEIPT', contractId: invoice.contractId, amount: 1, currency: invoice.currency, status: '有效'},
      [{id: 'GUARD-LINE', receiptId: 'GUARD-RECEIPT', orderId: 'GUARD-SO', amount: 1, currency: invoice.currency, status: '有效'}],
    ));
    attempt('simulateReceipt', () => store.simulateReceipt(projectId, invoice.id, false));
    return {
      results,
      unchanged: JSON.stringify(store.state()) === before,
      orders: (store.state().orders || []).length,
      claims: (store.state().bankReceiptClaims || []).length,
      history: store.operationEvents(invoice.id).length,
      invoiceAmount: store.state().contractInvoices[0].amount,
    };
  `);
  for (const result of retiredWrites.results) {
    assert.equal(result.returned, false, '退役入口必须返回失败：' + JSON.stringify(result));
    assert.match(result.message, /已停用/, '退役入口必须给出停用提示：' + JSON.stringify(result));
  }
  assert(retiredWrites.unchanged, '退役入口调用后快照必须完全不变：' + JSON.stringify(retiredWrites));
  assert.equal(retiredWrites.orders, 0);
  assert.equal(retiredWrites.claims, 0);
  assert.equal(retiredWrites.history, 0);
  assert.equal(retiredWrites.invoiceAmount, 100000);
  await check('直接调用退役 Store 入口被拒绝且无状态/历史变化', retiredWrites, 65);
  const consoleText = toolText(await call('list_console_messages', { types: ['error'] }));
  assert(!/msgid=/.test(consoleText), consoleText);
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
