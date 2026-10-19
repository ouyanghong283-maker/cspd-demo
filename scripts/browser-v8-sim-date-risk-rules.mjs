import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-sim-date-risk-rules-browser', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 71, checks: [], result: '失败' };
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
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
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
  const created = toolText(await connection.call('new_page', { url: report.baseUrl + '/control' }));
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await waitFor('模拟观察日期', 15000);

  const beforeMode = await evaluate(
    `return {mode:ng.getComponent(document.querySelector('app-root')).store.dateMode(),date:ng.getComponent(document.querySelector('app-root')).store.observationDate()};`,
  );
  assert.equal(beforeMode.mode, 'normal');
  assert.equal(beforeMode.date, '2026-10-15');
  await check('控制页显示当前模式与模拟日期', beforeMode);

  await evaluate(`
    const buttons=[...document.querySelectorAll('button')];
    const comparison=buttons.find(b=>b.textContent.trim()==='对比档');
    comparison.click();
    return true;
  `);
  await delay(200);
  const afterMode = await evaluate(
    `return {mode:ng.getComponent(document.querySelector('app-root')).store.dateMode(),date:ng.getComponent(document.querySelector('app-root')).store.observationDate()};`,
  );
  assert.equal(afterMode.mode, 'comparison');
  assert.equal(afterMode.date, '2026-10-22');
  await check('点击对比档切换模式并更新观察日期', afterMode);

  const projectId = await evaluate(
    `return ng.getComponent(document.querySelector('app-root')).store.state().projects[0].id;`,
  );
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${projectId}?tab=plans&plan=客户主节点');return true;`,
  );
  await waitFor('风险判断', 15000);
  const planRow = await evaluate(`
    const rows=[...document.querySelectorAll('tbody tr')];
    const row=rows.find(r=>r.textContent.includes('客户要求首批到货'));
    return row?{text:row.innerText,badges:[...row.querySelectorAll('app-badge')].map(b=>b.textContent.trim())}:null;
  `);
  assert.ok(planRow);
  assert.ok(planRow.badges.some((b) => b === '已逾期'));
  await check('对比档下客户主节点显示红色风险（已逾期）', planRow);

  await call('navigate_page', { type: 'reload' });
  await waitFor('风险判断', 15000);
  const refreshedMode = await evaluate(
    `return {mode:ng.getComponent(document.querySelector('app-root')).store.dateMode(),date:ng.getComponent(document.querySelector('app-root')).store.observationDate()};`,
  );
  assert.equal(refreshedMode.mode, 'comparison');
  await check('刷新后模式保留', refreshedMode);

  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/plans/tracking');return true;`,
  );
  await waitFor('模拟观察日', 15000);
  const tracking = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const component=ng.getComponent([...document.querySelectorAll('router-outlet')].at(-1).nextElementSibling);
    const rows=()=>component.trackingRows();
    const read=()=>({date:app.store.observationDate(),delay:rows().filter(r=>r.kind==='延期').length,rows:rows().length,banner:document.body.innerText.includes('2026-10-22')});
    app.store.setDateMode('comparison');
    await new Promise(r=>setTimeout(r,80));
    const comparison=read();
    app.store.setDateMode('normal');
    await new Promise(r=>setTimeout(r,80));
    const normal=read();
    app.store.setDateMode('comparison');
    await new Promise(r=>setTimeout(r,80));
    return {comparison,normal};
  `);
  assert.equal(tracking.comparison.date, '2026-10-22');
  assert.ok(tracking.comparison.banner, '追踪视图应显示当前模拟观察日');
  assert.ok(
    tracking.comparison.delay > tracking.normal.delay,
    '追踪视图应跟随模拟观察日改变延期判断',
  );
  await check('追踪视图消费同一模拟观察日', tracking);

  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${projectId}?tab=plans&plan=内部WBS');return true;`,
  );
  await waitFor('风险判断', 15000);
  await evaluate(`
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('甘特视图')).click();
    return true;
  `);
  await delay(300);
  const gantt = await evaluate(`
    const rows=[...document.querySelectorAll('.gantt-row')].slice(1);
    const labels=rows.flatMap(r=>[...r.querySelectorAll('.fine-print')].map(x=>x.textContent.trim())).filter(Boolean);
    return {rowCount:rows.length,labels:[...new Set(labels)]};
  `);
  assert.ok(gantt.rowCount > 0, '甘特视图应有 WBS 行');
  assert.ok(
    gantt.labels.some((l) => l === '预警' || l === '已逾期'),
    '甘特视图应显示与表格同一风险判断：' + JSON.stringify(gantt),
  );
  await check('甘特视图风险色与表格同规则', gantt);

  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${projectId}?tab=plans&plan=客户主节点');return true;`,
  );
  await waitFor('客户主节点计划', 15000);
  await evaluate(`const table=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='表格视图');if(table)table.click();return true;`);
  await waitFor('风险判断', 15000);
  const planForm = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const store=app.store;
    const project=store.project('${projectId}');
    const plan=project.plans.find(p=>p.type==='客户主节点');
    const saved=()=>store.project('${projectId}').plans.find(p=>p.id===plan.id).warningLeadDays;
    const field=()=>document.querySelector('[data-field="warningLeadDays"]');
    const save=()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='保存').click();
    const row=[...document.querySelectorAll('[data-plan-id]')].find(r=>r.textContent.includes(plan.name));
    row.querySelector('button')?.click();
    await new Promise(r=>setTimeout(r,150));
    const hasField=!!field();
    const before=saved();
    const fill=(value)=>{const e=field();e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));};
    fill('3.5');
    save();
    await new Promise(r=>setTimeout(r,250));
    const decimal={open:!!document.querySelector('[role=dialog]'),error:document.querySelector('[role=dialog] [role=alert]')?.textContent.trim()||'',saved:saved()};
    fill('0');
    save();
    await new Promise(r=>setTimeout(r,300));
    const zero={open:!!document.querySelector('[role=dialog]'),saved:saved()};
    const rowAgain=[...document.querySelectorAll('[data-plan-id]')].find(r=>r.textContent.includes(plan.name));
    rowAgain.querySelector('button')?.click();
    await new Promise(r=>setTimeout(r,150));
    fill('5');
    save();
    await new Promise(r=>setTimeout(r,300));
    const five={open:!!document.querySelector('[role=dialog]'),saved:saved()};
    return {hasField,before,decimal,zero,five};
  `);
  assert.ok(planForm.hasField, '真实计划表单应包含预警天数字段');
  assert.equal(planForm.decimal.open, true, '非法预警天数不应关闭表单');
  assert.ok(
    planForm.decimal.error.includes('预警天数必须为非负整数'),
    '表单应提示预警天数非法：' + JSON.stringify(planForm),
  );
  assert.equal(planForm.decimal.saved, planForm.before, '非法保存不应改旧计划');
  assert.equal(planForm.zero.open, false, '0 预警天数应合法保存');
  assert.equal(planForm.zero.saved, 0);
  assert.equal(planForm.five.open, false, '正数预警天数应合法保存');
  assert.equal(planForm.five.saved, 5);
  await check('真实表单校验预警天数：小数拒绝、0 与正数合法', planForm);

  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/control');return true;`,
  );
  await waitFor('模拟观察日期', 15000);
  const second = toolText(await connection.call('new_page', { url: report.baseUrl + '/control' }));
  const secondPageId = Number(second.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(secondPageId), second);
  await connection.call('wait_for', { pageId: secondPageId, text: ['接管修改权'], timeout: 15000 });
  await connection.call('evaluate_script', {
    pageId: secondPageId,
    function: `() => { [...document.querySelectorAll('button')].find(b=>b.textContent.includes('接管修改权')).click(); return true; }`,
  });
  await call('wait_for', { text: ['只读查看'], timeout: 15000 });
  const readonly = await evaluate(`
    const buttons=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='正常档'||b.textContent.trim()==='对比档');
    return {count:buttons.length,disabled:buttons.every(b=>b.disabled)};
  `);
  assert.equal(readonly.count, 2);
  assert.equal(readonly.disabled, true);
  await check('只读标签页下模式切换按钮禁用', readonly);
  await connection.call('close_page', { pageId: secondPageId });

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
  console.log('浏览器验收证据：', output);
}
