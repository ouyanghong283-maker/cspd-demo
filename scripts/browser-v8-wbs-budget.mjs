import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-wbs-budget-browser', runId);
await fs.mkdir(output, { recursive: true });
const report = {
  runAt: new Date().toISOString(),
  issue: 74,
  acceptanceIds: ['BUD01', 'BUD02', 'BUD03', 'BUD04'],
  checks: [],
  result: '失败',
};
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
  const text = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + text);
  return JSON.parse(match[1]);
};
const waitFor = async (text, timeout = 15000) => {
  await call('wait_for', { text: Array.isArray(text) ? text : [text], timeout });
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
  // 共享机器上首个页面导航可能超过 MCP 默认的 10 秒上限；预热后重试一次。
  let created = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await delay(1500 * attempt);
      created = toolText(await connection.call('new_page', { url: report.baseUrl + '/control' }));
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      report.newPageRetries = attempt;
      console.log('RETRY new_page', error instanceof Error ? error.message : String(error));
    }
  }
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await waitFor('模拟观察日期', 30000);

  const projectId = await evaluate(
    `return ng.getComponent(document.querySelector('app-root')).store.state().projects[0].id;`,
  );
  const projectUrl = `${report.baseUrl}/projects/${projectId}?tab=plans&plan=内部WBS`;
  report.projectUrl = projectUrl;
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${projectId}?tab=plans&plan=内部WBS');return true;`,
  );
  await waitFor('预计预算 · 已填部分合计', 20000);

  const summaryPanel = await evaluate(`
    const panel=[...document.querySelectorAll('section')].find(s=>s.getAttribute('aria-label')==='内部WBS分币种预算摘要');
    return panel?panel.innerText:null;
  `);
  assert.ok(summaryPanel, '计划面板应显示分币种预算摘要');
  assert.ok(summaryPanel.includes('CNY 小计'), summaryPanel);
  assert.ok(summaryPanel.includes('EUR 小计'), summaryPanel);
  assert.ok(summaryPanel.includes('USD 小计'), summaryPanel);
  assert.ok(summaryPanel.includes('模拟样例预算'), summaryPanel);
  assert.ok(summaryPanel.includes('预算待补 1 项'), summaryPanel);
  await check('BUD02/BUD03 · 计划面板显示分币种小计、模拟标记与预算待补数量', summaryPanel);

  const rows = await evaluate(`
    return [...document.querySelectorAll('tbody tr')].map(r=>{
      const cell=[...r.querySelectorAll('td')].map(td=>td.textContent.trim());
      const badge=r.querySelector('[data-budget]');
      return {text:r.innerText.replace(/\\n+/g,' | '),state:badge?badge.getAttribute('data-budget'):null,budget:badge?badge.textContent.trim():null};
    }).filter(r=>r.text.includes('WBS-'));
  `);
  assert.ok(rows.length >= 10, JSON.stringify(rows));
  const pendingRow = rows.find((row) => row.state === 'pending');
  assert.ok(pendingRow, '表格应有一行显示预算待补：' + JSON.stringify(rows));
  assert.equal(pendingRow.budget, '预算待补');
  assert.equal(rows.filter((row) => row.state === 'filled').length, 9, '其余内部WBS应显示已填预算');
  assert.ok(
    rows.some((row) => /¥|€|\$/.test(row.budget) && row.budget.includes('.')),
    '已填行应显示金额与币种：' + JSON.stringify(rows.map((row) => row.budget)),
  );
  await check('BUD02/BUD03 · WBS表格新增预计预算列，待补与已填分开显示', {
    rowCount: rows.length,
    pending: pendingRow.budget,
    samples: rows.map((row) => row.budget).slice(0, 4),
  });

  const overview = await evaluate(`
    await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${projectId}?tab=overview');
    return true;
  `);
  void overview;
  await waitFor('计划与预算', 20000);
  const overviewPanel = await evaluate(`
    const panel=[...document.querySelectorAll('section')].find(s=>s.getAttribute('aria-label')==='项目概况计划与预算摘要');
    return panel?panel.innerText:null;
  `);
  assert.ok(overviewPanel, '概况页应显示计划与预算摘要');
  assert.ok(overviewPanel.includes('已填部分合计'), overviewPanel);
  assert.ok(overviewPanel.includes('不跨币种换算'), overviewPanel);
  await check('BUD02/BUD03 · 概况摘要与计划面板同源显示已填部分合计', overviewPanel);

  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${projectId}?tab=plans&plan=内部WBS');return true;`,
  );
  await waitFor('预计预算 · 已填部分合计', 20000);

  const formResult = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const store=app.store;
    const project=store.project('${projectId}');
    const target=project.plans.find(p=>p.type==='内部WBS'&&p.status==='进行中');
    const saved=()=>{const p=store.project('${projectId}').plans.find(x=>x.id===target.id);return {amount:p.budgetAmount,currency:p.budgetCurrency};};
    const cellText=()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(target.name)&&r.textContent.includes(target.id));const badge=row.querySelector('[data-budget]');return {state:badge.getAttribute('data-budget'),text:badge.textContent.trim()};};
    const amounts=()=>{const panel=[...document.querySelectorAll('section')].find(s=>s.getAttribute('aria-label')==='内部WBS分币种预算摘要');return panel.innerText;};
    const row=(name)=>[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(name)&&r.textContent.includes(target.id));
    const openEdit=(name)=>[...row(name).querySelectorAll('button')].find(b=>b.textContent.trim()==='编辑').click();
    const dialog=()=>document.querySelector('[role=dialog]');
    const save=()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='保存').click();
    const cancel=()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='取消').click();
    const errorText=()=>[...dialog().querySelectorAll('[role=alert],.field-error')].map(e=>e.textContent.trim()).join(' / ');
    const set=(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};

    // 新建：预算金额默认空、币种不预选，缺项不能保存
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('新增计划')).click();
    await new Promise(r=>setTimeout(r,200));
    const newAmount=document.querySelector('[data-field="budgetAmount"]');
    const newCurrency=document.querySelector('[data-field="budgetCurrency"]');
    const groupHeading=[...document.querySelectorAll('[role=dialog] h3')].map(h=>h.textContent.trim());
    const newDefaults={amount:newAmount?newAmount.value:null,currency:newCurrency?newCurrency.value:null};
    save();
    await new Promise(r=>setTimeout(r,250));
    const emptySave={open:!!dialog(),error:errorText()};
    cancel();
    await new Promise(r=>setTimeout(r,200));
    const newPlanIds=store.project('${projectId}').plans.filter(p=>!p.id.startsWith('${projectId}-')).length;

    // 编辑已有WBS：非法预算被拒绝并提示修正，合法预算同次更新
    const summaryBefore=amounts();
    openEdit(target.name);
    await new Promise(r=>setTimeout(r,200));
    const amountField=document.querySelector('[data-field="budgetAmount"]');
    const currencyField=document.querySelector('[data-field="budgetCurrency"]');
    const before=saved();
    const editCurrency=currencyField.value;
    set(currencyField,'CNY');
    set(amountField,'-1');
    save();
    await new Promise(r=>setTimeout(r,250));
    const negative={open:!!dialog(),error:errorText(),saved:saved()};
    set(amountField,'12.345');
    save();
    await new Promise(r=>setTimeout(r,250));
    const precision={open:!!dialog(),error:errorText(),saved:saved()};
    set(amountField,'250000.25');
    set(currencyField,'USD');
    await new Promise(r=>setTimeout(r,50));
    save();
    await new Promise(r=>setTimeout(r,400));
    return {groupId:target.id,name:target.name,hasAmount:!!newAmount,hasCurrency:!!newCurrency,groupHeading,newDefaults,emptySave,newPlanIds,editCurrency,before,negative,precision,afterSave:saved(),cell:cellText(),summaryBefore,summary:amounts()};
  `);
  assert.ok(formResult.hasAmount, '真实计划表单应包含预计预算金额字段');
  assert.ok(formResult.hasCurrency, '真实计划表单应包含预计预算币种字段');
  assert.ok(
    formResult.groupHeading.includes('预算信息'),
    '表单应包含预算信息分组：' + JSON.stringify(formResult.groupHeading),
  );
  assert.equal(formResult.newDefaults.amount, '', '新建时预算金额默认空');
  assert.equal(formResult.newDefaults.currency, '', '新建时币种不预选');
  assert.equal(formResult.emptySave.open, true, '缺预算不应保存成功');
  assert.ok(
    /预算/.test(formResult.emptySave.error),
    '缺预算应明确提示：' + formResult.emptySave.error,
  );
  assert.equal(formResult.newPlanIds, 0, '缺预算的新建计划不应落库');
  assert.equal(formResult.negative.saved.amount, formResult.before.amount, '负数不应改旧值');
  assert.equal(formResult.negative.open, true, '非法预算不应关闭表单');
  assert.ok(/预算/.test(formResult.negative.error), '负数应明确提示：' + formResult.negative.error);
  assert.equal(formResult.precision.saved.amount, formResult.before.amount, '超两位小数不应改旧值');
  assert.equal(formResult.precision.open, true, '超两位小数不应关闭表单');
  assert.ok(
    formResult.precision.error.includes('最多两位小数'),
    '超两位小数应提示要求修正：' + formResult.precision.error,
  );
  assert.equal(formResult.afterSave.amount, 250000.25);
  assert.equal(formResult.afterSave.currency, 'USD');
  assert.equal(formResult.cell.state, 'filled');
  const usdSubtotal = (text) => {
    const match = (text || '').match(/USD 小计\s*US\$([\d,]+\.\d{2})/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  };
  const usdBefore = usdSubtotal(formResult.summaryBefore);
  const usdAfter = usdSubtotal(formResult.summary);
  assert.ok(
    usdBefore !== null &&
      usdAfter !== null &&
      Math.abs(usdAfter - (usdBefore + 250000.25)) < 0.005,
    `摘要应在同一次提交内按差额精确更新：前=${usdBefore} 后=${usdAfter} 全文=` +
      formResult.summary,
  );
  await check('BUD01/BUD04 · 真实表单校验并保存预算，表格与摘要同次更新', {
    groupHeading: formResult.groupHeading,
    newDefaults: formResult.newDefaults,
    emptySave: formResult.emptySave,
    editCurrency: formResult.editCurrency,
    negative: formResult.negative,
    precision: formResult.precision,
    afterSave: formResult.afterSave,
    cell: formResult.cell,
  });

  const reload = await evaluate(`
    await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${projectId}?tab=plans&plan=内部WBS');
    return true;
  `);
  void reload;
  await call('navigate_page', { type: 'reload' });
  await waitFor('预计预算 · 已填部分合计', 25000);
  const afterReload = await evaluate(`
    const text=[...document.querySelectorAll('section')].find(s=>s.getAttribute('aria-label')==='内部WBS分币种预算摘要').innerText;
    return {text};
  `);
  assert.equal(usdSubtotal(afterReload.text), usdAfter, '刷新后预算保留：' + afterReload.text);
  await check('BUD04 · 刷新后预算与分币种摘要保留', afterReload.text);

  const zeroCase = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const store=app.store;
    const project=store.project('${projectId}');
    const zeroPlan=project.plans.find(p=>p.id==='${formResult.groupId}');
    const ok=store.savePlan('${projectId}',{...zeroPlan,budgetAmount:0,budgetCurrency:'EUR'});
    await new Promise(r=>setTimeout(r,150));
    const stored=store.project('${projectId}').plans.find(p=>p.id==='${formResult.groupId}');
    const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('${formResult.groupId}'));
    return {ok,amount:stored.budgetAmount,currency:stored.budgetCurrency,cell:row.querySelector('[data-budget]').textContent.trim()};
  `);
  assert.equal(zeroCase.ok, true, '0 预算应合法保存');
  assert.equal(zeroCase.amount, 0);
  assert.equal(zeroCase.currency, 'EUR');
  assert.match(zeroCase.cell, /€0\.00/);
  await check('BUD01 · 0 为合法预算并在表格中显示为 0 而不是待补', zeroCase);

  const cancelledCase = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const store=app.store;
    const plan=store.project('${projectId}').plans.find(p=>p.id==='${formResult.groupId}');
    const ok=store.savePlan('${projectId}',{...plan,status:'已取消'});
    await new Promise(r=>setTimeout(r,200));
    const panel=[...document.querySelectorAll('section')].find(s=>s.getAttribute('aria-label')==='内部WBS分币种预算摘要').innerText;
    const summary=store.planBudgetSummary('${projectId}');
    return {ok,panel,cancelled:summary.cancelled,filled:summary.filled};
  `);
  assert.equal(cancelledCase.ok, true);
  assert.ok(cancelledCase.panel.includes('已取消任务独立标注'), cancelledCase.panel);
  assert.equal(cancelledCase.cancelled.length, 1);
  assert.equal(cancelledCase.cancelled[0].currency, 'EUR');
  assert.equal(
    cancelledCase.filled.some((total) => total.currency === 'EUR' && total.amount === 0),
    false,
    '取消任务的0预算应从有效合计排除',
  );
  await check('BUD02/BUD04 · 取消任务后页面同次显示单独标注且退出有效合计', {
    cancelled: cancelledCase.cancelled,
    filled: cancelledCase.filled,
  });

  report.result = '通过';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.stack = error instanceof Error ? error.stack : undefined;
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
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('浏览器验收证据：', output);
}
