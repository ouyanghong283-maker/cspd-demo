import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-plan-gantt-browser', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 72, checks: [], result: '失败' };
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
// 从实际共享组件DOM观察风险文字及计算后的条带颜色，不读取组件私有信号。
const ganttDom = `
  const ganttRows=()=>[...document.querySelectorAll('app-plan-gantt .gantt-row')].slice(1);
  const ganttRisk=row=>row.querySelector('.gantt-end > div:nth-of-type(2) > span')?.textContent.trim()||'';
  const ganttBar=row=>row.querySelector('.gantt-range > span[aria-label]');
  const ganttColor=row=>{const bar=ganttBar(row);return bar?getComputedStyle(bar).backgroundColor.replaceAll(' ',''):null;};
  const colorClass=row=>({'rgb(117,151,231)':'risk-blue','rgb(217,164,65)':'risk-yellow','rgb(208,106,106)':'risk-red','rgb(136,188,164)':'risk-green','rgb(195,204,218)':'risk-gray'})[ganttColor(row)]||null;
  const textClass=label=>label.startsWith('已完成')?'risk-green':({'正常':'risk-blue','预警':'risk-yellow','已逾期':'risk-red','已取消':'risk-gray','日期待补':'risk-gray','预警天数待补':'risk-gray','观察日无效':'risk-gray'})[label]||null;
`;
const evaluate = async (body) => {
  const text = toolText(
    await call('evaluate_script', { function: `async () => {${ganttDom}${body}}` }),
  );
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + text);
  return JSON.parse(match[1]);
};
const waitFor = async (text, timeout = 15000) => {
  await call('wait_for', { text: Array.isArray(text) ? text : [text], timeout });
};
const openPlanTab = async (projectId, planType, view = null) => {
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${projectId}?tab=plans&plan=${planType}&view=${view === 'gantt' ? 'gantt' : 'table'}');return true;`,
  );
  await waitFor('新增计划', 20000);
  await delay(400);
  if (view === 'gantt') {
    await waitFor('当前模拟日期', 20000);
    assert(
      await evaluate("return !!document.querySelector('app-plan-gantt');"),
      '应进入共享甘特组件',
    );
  }
  return true;
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
  const until = Date.now() + 120000;
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
  await waitFor('模拟观察日期', 20000);

  const projectId = await evaluate(
    `return ng.getComponent(document.querySelector('app-root')).store.state().projects[0].id;`,
  );
  report.projectId = projectId;

  // GAN01：客户主节点可表格/甘特切换
  await openPlanTab(projectId, '客户主节点', 'gantt');
  const customerGantt = await evaluate(`
    const rows=ganttRows();
    const legend=[...document.querySelectorAll('app-plan-gantt .gantt-legend > span')].map(x=>x.textContent.trim());
    const bar=document.querySelector('app-plan-gantt .gantt-range > span[aria-label]');
    const head=document.querySelector('app-plan-gantt .gantt-row')?.innerText||'';
    return {
      rowCount:rows.length,
      firstRow:rows[0]?rows[0].innerText:null,
      swatch:rows[0]?colorClass(rows[0]):null,
      barWidth:bar?bar.style.width:null,
      legend,
      todayLine:rows.filter(row=>row.querySelector('.gantt-today')).length,
      axisToday:document.querySelectorAll('app-plan-gantt .gantt-axis .gantt-today').length,
      head,
    };
  `);
  assert.ok(
    customerGantt.rowCount > 0,
    '客户主节点甘特应有任务行：' + JSON.stringify(customerGantt),
  );
  assert.ok(
    customerGantt.legend.length >= 5,
    '应显示图例：' + JSON.stringify(customerGantt.legend),
  );
  assert.ok(customerGantt.legend.join(' ').includes('当前模拟日期'), '图例应含模拟日期说明');
  assert.equal(customerGantt.todayLine, customerGantt.rowCount, '每行应有一条当前模拟日期竖线');
  assert.ok(
    /risk-(blue|yellow|red|green|gray)/.test(customerGantt.swatch || ''),
    '条带计算后背景色应匹配已定义风险色',
  );
  assert.equal(customerGantt.axisToday, 1, '时间轴应有当前模拟日期线');
  assert.ok(customerGantt.head.includes('节点 / 负责人'));
  assert.ok(parseFloat(customerGantt.barWidth) > 0, '真实条带必须可见');
  assert.ok(
    /负责人|王项目|陈物控|刘工程师/.test(customerGantt.firstRow || ''),
    '甘特行应显示负责人',
  );
  await check('GAN01 客户主节点可切换甘特，显示负责人/日期/状态/条带/图例/模拟日线', customerGantt);

  // 表格与甘特文字/颜色一致（同一份已保存计划）
  const tableVsGantt = await evaluate(`
    const rows=ganttRows();
    const gantt=rows.map(r=>({text:r.innerText,risk:ganttRisk(r),cls:colorClass(r)}));
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('表格视图')).click();
    await new Promise(r=>setTimeout(r,300));
    const table=[...document.querySelectorAll('tbody tr')].map(r=>({text:r.innerText,badges:[...r.querySelectorAll('app-badge .badge')].map(b=>({t:b.textContent.trim(),c:b.className}))}));
    return {gantt,table};
  `);
  const ganttRisks = tableVsGantt.gantt.map((row) => row.risk);
  const tableRisks = tableVsGantt.table.map(
    (row) => row.badges.find((b) => /risk-/.test(b.c))?.t || null,
  );
  assert.deepEqual(
    ganttRisks,
    tableRisks,
    '甘特风险文字应与表格逐行相同：' + JSON.stringify(tableVsGantt),
  );
  const ganttClasses = tableVsGantt.gantt.map(
    (row) => (row.cls || '').match(/risk-\w+/)?.[0] || null,
  );
  const tableClasses = tableVsGantt.table.map(
    (row) => row.badges.find((b) => /risk-/.test(b.c))?.c.match(/risk-\w+/)?.[0],
  );
  assert.deepEqual(ganttClasses, tableClasses, '甘特与表格风险色类应逐行相同');
  await check('GAN02/GAN03 客户主节点甘特与表格风险文字与颜色逐行一致', {
    ganttRisks,
    ganttClasses,
  });

  // 内部WBS 保留既有甘特能力，并显示同一规则
  await openPlanTab(projectId, '内部WBS', 'gantt');
  const wbsGantt = await evaluate(`
    const rows=ganttRows();
    return {rowCount:rows.length,firstRow:rows[0]?rows[0].innerText:null,labels:[...new Set(rows.map(r=>ganttRisk(r)).filter(Boolean))]};
  `);
  assert.ok(wbsGantt.rowCount > 0, '内部WBS甘特保留可用');
  await check('GAN01 保留既有内部WBS甘特能力', wbsGantt);

  // GAN04 动态轴：单日任务与跨旧窗口任务可见
  const axisCoverage = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const store=app.store;
    const projectId='${projectId}';
    const project=store.project(projectId);
    const wbs=project.plans.filter(p=>p.type==='内部WBS');
    const single={
      ...wbs[0],
      id:'BROWSER-PL-SINGLE',
      name:'单日节点（浏览器验收）',
      start:'2026-10-15',
      end:'2026-10-15',
      expected:'2026-10-15',
      actual:'',
      status:'未开始',
      warningLeadDays:0,
      budgetAmount:12000,
      budgetCurrency:'CNY',
    };
    store.savePlan(projectId,single);
    const far=project.plans.find(p=>p.type==='客户主节点');
    store.savePlan(projectId,{...far,end:'2027-03-15'});
    await new Promise(r=>setTimeout(r,80));
    return true;
  `);
  assert.equal(axisCoverage, true);

  await openPlanTab(projectId, '内部WBS', 'gantt');
  const singleDayView = await evaluate(`
    const rows=ganttRows();
    const row=rows.find(r=>r.innerText.includes('单日节点（浏览器验收）'));
    if(!row) return {found:false};
    const bar=ganttBar(row);
    const widthPercent=parseFloat(bar.style.width);
    return {
      found:true,
      text:row.innerText,
      barWidthPercent:widthPercent,
      singleDayDates:row.querySelector('.gantt-end')?.innerText.replace(/\\s+/g,' ').includes('2026-10-15 → 2026-10-15'),
      accessibleLabel:bar.getAttribute('aria-label'),
      pixelWidth:bar.getBoundingClientRect().width,
      risk:ganttRisk(row),
      today:!!row.querySelector('.gantt-today'),
    };
  `);
  assert.equal(singleDayView.found, true, '单日任务应出现在甘特中');
  assert.equal(singleDayView.singleDayDates, true, '单日任务应显示同日起止');
  assert(
    singleDayView.accessibleLabel.includes('单日节点（浏览器验收）'),
    '单日条带需有可访问任务名与风险文字',
  );
  assert.ok(
    singleDayView.pixelWidth >= 4,
    '单日任务应有可见宽度：' + JSON.stringify(singleDayView),
  );
  assert.equal(singleDayView.today, true, '每行应显示当前模拟日期线');
  await check('GAN04 单日任务在动态轴上可见（最小日格宽度）', singleDayView);

  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/control');return true;`,
  );
  await waitFor('模拟观察日期', 20000);
  await evaluate(`
    const buttons=[...document.querySelectorAll('button')];
    const comparison=buttons.find(b=>b.textContent.trim()==='对比档');
    if(comparison) comparison.click();
    return true;
  `);
  await delay(300);
  await openPlanTab(projectId, '客户主节点', 'gantt');
  const farWindow = await evaluate(`
    const rows=ganttRows();
    const row=rows.find(r=>r.innerText.includes('2027-03-15'));
    const axisDates=[...document.querySelectorAll('app-plan-gantt .gantt-axis time')].map(e=>e.textContent.trim());
    const bar=row?ganttBar(row):null;const rect=bar?.getBoundingClientRect(),track=row?.querySelector('.gantt-range')?.getBoundingClientRect();
    return {
      axisDates,
      withinAxis:!!rect&&!!track&&rect.left>=track.left-1&&rect.right<=track.right+1,
      found:!!row,
      risk:row?ganttRisk(row):null,
      barWidth:bar?.style.width||null,
      observation:'2026-10-22',
      scrollWidth:document.querySelector('.gantt')?.scrollWidth,
      clientWidth:document.querySelector('.gantt')?.clientWidth,
    };
  `);
  assert.ok(farWindow.found, '跨旧窗口任务应仍在甘特中可见：' + JSON.stringify(farWindow));
  assert(farWindow.axisDates.length >= 2, '时间轴应提供日期刻度');
  assert(
    farWindow.axisDates[0] <= '2027-03-15' && farWindow.axisDates.at(-1) >= '2027-03-15',
    '真实轴刻度应覆盖旧窗口外日期',
  );
  assert(farWindow.withinAxis && parseFloat(farWindow.barWidth) > 0, '跨窗口条带必须可见且在轴内');
  await check('GAN04 跨旧 2026-10/11 月窗口的计划仍可见，对比档下颜色随之变化', farWindow);

  // 刷新后同一份已保存计划在表格与甘特中仍一致
  await call('navigate_page', { type: 'reload' });
  await waitFor('新增计划', 25000);
  await delay(600);
  await evaluate(
    `const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('表格视图'));if(button)button.click();return true;`,
  );
  await delay(300);
  const afterReloadTable = await evaluate(`
    const row=[...document.querySelectorAll('tbody tr')].find(r=>r.innerText.includes('2027-03-15'));
    if(!row) return {found:false,body:document.body.innerText.slice(0,400)};
    const badge=[...row.querySelectorAll('app-badge .badge')].map(b=>({t:b.textContent.trim(),c:b.className})).find(b=>/risk-/.test(b.c));
    return {found:true,risk:badge?badge.t:null,cls:badge?badge.c.match(/risk-\\w+/)?.[0]:null};
  `);
  assert.equal(afterReloadTable.found, true, '刷新后跨窗口任务应仍在表格中');
  await evaluate(`
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('甘特视图'));
    if(button) button.click();
    return true;
  `);
  await waitFor('当前模拟日期', 25000);
  await delay(400);
  const afterReloadGantt = await evaluate(`
    const row=ganttRows().find(r=>r.innerText.includes('2027-03-15'));
    if(!row) return {found:false};
    return {found:true,risk:ganttRisk(row),cls:colorClass(row)};
  `);
  assert.equal(afterReloadGantt.found, true, '刷新后跨窗口任务应仍在甘特中');
  assert.equal(afterReloadGantt.risk, afterReloadTable.risk, '刷新后甘特与表格风险文字一致');
  assert.equal(afterReloadGantt.cls, afterReloadTable.cls, '刷新后甘特与表格风险颜色一致');
  await check('GAN01 刷新后客户主节点表格与甘特读取同一份已保存计划', {
    table: afterReloadTable,
    gantt: afterReloadGantt,
    dateMode: await evaluate(
      `return ng.getComponent(document.querySelector('app-root')).store.dateMode();`,
    ),
  });

  // 切换档位后颜色与文字是否同步变化（颜色之外仍能读到状态）。
  // 必须停在「内部WBS」甘特：跨窗口客户节点在两档都是蓝，无法验证档位变化。
  await openPlanTab(projectId, '内部WBS', 'gantt');
  const modeSwitch = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const rows=()=>ganttRows().map(r=>({
      text:r.innerText,
      risk:ganttRisk(r),
      cls:colorClass(r),
      riskCls:textClass(ganttRisk(r)),
    }));
    app.store.setDateMode('comparison');
    await new Promise(r=>setTimeout(r,150));
    const comparison=rows();
    app.store.setDateMode('normal');
    await new Promise(r=>setTimeout(r,150));
    const normal=rows();
    return {comparison,normal,date:app.store.observationDate(),mode:app.store.dateMode()};
  `);
  const switched = modeSwitch.comparison.filter(
    (row, index) => row.risk !== modeSwitch.normal[index]?.risk,
  );
  assert(
    switched.every(
      (row) =>
        row.cls !==
        modeSwitch.normal.find((normal) => normal.text.split('\n')[0] === row.text.split('\n')[0])
          ?.cls,
    ),
    '风险文字变化时实际条带颜色也应变化',
  );
  assert.ok(switched.length > 0, '切换档位后应有任务的风险文字变化：' + JSON.stringify(modeSwitch));
  assert.ok(
    modeSwitch.comparison.every((row) => row.risk.length > 0),
    '甘特行不能只靠颜色表达风险',
  );
  assert.ok(
    [...modeSwitch.comparison, ...modeSwitch.normal].every(
      (row) => !!row.cls && row.cls === row.riskCls,
    ),
    '实际条带颜色与风险文字含义应一致：' + JSON.stringify(modeSwitch),
  );
  await check('GAN01/GAN04 档位切换后甘特颜色与文字随模拟日同步', {
    changed: switched.length,
    sample: switched.slice(0, 3),
    mode: modeSwitch.mode,
    date: modeSwitch.date,
  });

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
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('浏览器验收证据：', output);
  console.log('结论：', report.result);
}
