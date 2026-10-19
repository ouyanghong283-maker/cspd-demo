import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-plan-gantt-warnings-browser', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issues: [72, 73], checks: [], result: '失败' };
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
const waitFor = async (text, timeout = 45000) => {
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
  await waitFor('模拟观察日期', 15000);

  const projectId = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const store=app.store;
    store.setRole('pm');
    store.setDateMode('normal');
    const project=store.state().projects[0];
    const sample=project.plans.find(p=>p.type==='内部WBS');
    for (const type of ['内部WBS','客户主节点']) {
      for (const [key,start,end,n] of [
        ['normal','2026-10-01','2026-11-30',7],
        ['near','2026-10-01','2026-10-20',7],
        ['late','2026-10-01','2026-10-14',7],
        ['single','2025-02-03','2025-02-03',0],
        ['long','2020-01-01','2030-12-31',0],
      ]) {
        const plan={...sample,id:'CHECK-'+type+'-'+key,type,name:'核验-'+key,
          owner:'周方案',start,end,expected:'2030-12-31',actual:'',status:'进行中',
          warningLeadDays:n,budgetAmount:type==='内部WBS'?0:undefined,budgetCurrency:type==='内部WBS'?'CNY':undefined,budgetSource:undefined,completionKind:undefined,customerMilestoneId:undefined,linked:''};
        if(!store.savePlan(project.id,plan)) throw new Error('fixture save failed');
      }
    }
    return project.id;
  `);
  for (const type of ['内部WBS', '客户主节点']) {
    await evaluate(
      `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${projectId}?tab=plans&plan=${type}');return true;`,
    );
    await waitFor('风险判断');
    const badgeColor = await evaluate(`
      const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('CHECK-${type}-near'));
      const badge=row.querySelector('.badge.risk-yellow');
      return badge ? getComputedStyle(badge).color : null;
    `);
    assert.ok(badgeColor, '表格风险徽标未正确着色');
    await evaluate(`
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='甘特视图').click();
      return true;
    `);
    await waitFor('当前模拟日期');
    await delay(150);
    const gantt = await evaluate(`
      const rows=[...document.querySelectorAll('.gantt-row')];
      const result={};
      for(const key of ['normal','near','late','single','long']) {
        const row=rows.find(r=>r.textContent.includes('CHECK-${type}-'+key));
        const bar=row.querySelector('.gantt-range span');
        result[key]={color:getComputedStyle(bar).backgroundColor,width:bar.getBoundingClientRect().width,text:row.innerText};
      }
      const container=document.querySelector('.gantt');
      return {result,ticks:[...document.querySelectorAll('.gantt-axis time')].map(t=>t.textContent),
        today:document.querySelectorAll('.gantt-today').length,
        scroll:container.scrollWidth>container.clientWidth,
        legend:document.querySelector('.gantt-legend').textContent};
    `);
    assert.equal(gantt.result.normal.color, 'rgb(117, 151, 231)');
    assert.equal(gantt.result.near.color, 'rgb(217, 164, 65)');
    assert.equal(gantt.result.late.color, 'rgb(208, 106, 106)');
    assert.ok(gantt.result.single.width >= 9.9);
    assert.ok(gantt.ticks[0] < '2020-01-01');
    assert.ok(gantt.ticks.at(-1) > '2030-12-31');
    assert.ok(gantt.today > 1 && gantt.scroll);
    assert.match(gantt.legend, /正常/);
    assert.match(gantt.legend, /临期/);
    assert.match(gantt.legend, /超期/);
    await check(type + '甘特的蓝黄红、单日、长跨度、图例和日期线', gantt);
    await evaluate(
      `document.querySelector('.gantt').scrollLeft=1700;document.querySelector('.gantt').scrollIntoView();return true;`,
    );
    await call('take_screenshot', { filePath: path.join(output, `gantt-${type}.png`) });
    await call('navigate_page', { type: 'reload' });
    await waitFor('当前模拟日期');
    const refreshed = await evaluate(
      `return {gantt:!!document.querySelector('.gantt'),url:location.href};`,
    );
    assert.equal(refreshed.gantt, true);
    await check(type + '甘特刷新后仍显示同一计划', refreshed);
  }

  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/');return true;`,
  );
  await waitFor('需要我处理');
  await evaluate(
    `const input=document.querySelector('[aria-label="搜索我的待办"]');input.value='核验-near';input.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
  );
  await delay(150);
  const taskBefore = await evaluate(`
    const row=[...document.querySelectorAll('.task-panel .task-row')].find(r=>r.textContent.includes('CHECK-内部WBS-near'));
    const link=row.querySelector('.process-link');
    const read=[...row.querySelectorAll('button')].find(b=>b.textContent.includes('标记已读'));
    const result={text:row.innerText,href:link.getAttribute('href'),count:document.querySelectorAll('.task-panel .task-row').length};
    read.click(); return result;
  `);
  assert.equal(taskBefore.count, 2);
  assert.match(taskBefore.href, /focus=CHECK-/);
  await delay(150);
  const readText = await evaluate(
    `return [...document.querySelectorAll('.task-panel .task-row')].find(r=>r.textContent.includes('CHECK-内部WBS-near')).innerText;`,
  );
  assert.match(readText, /本人已读/);
  assert.match(readText, /预警/);
  await check('我的待办去重、个人已读保持风险及精准链接', { taskBefore, readText });
  const notification = await evaluate(`
    const store=ng.getComponent(document.querySelector('app-root')).store;
    const notices=store.pendingNotices().filter(n=>n.planId==='CHECK-内部WBS-near');
    return {count:notices.length,read:notices[0]?.read,href:notices[0]?.href};
  `);
  assert.equal(notification.count, 1);
  assert.equal(notification.read, true);
  assert.match(notification.href, /focus=CHECK-/);
  await check('通知栏复用同一计划预警和个人已读，无重复提醒', notification);
  await evaluate(`
    const select=document.querySelector('[aria-label="按状态筛选预警"]');
    select.value='red';select.dispatchEvent(new Event('change',{bubbles:true}));return true;
  `);
  await delay(100);
  assert.equal(
    await evaluate(
      `return [...document.querySelectorAll('[aria-labelledby=warning-title] .task-row')].filter(row=>row.textContent.includes('核验-near')).length;`,
    ),
    0,
  );
  await check('我的待办状态筛选不混入其他级别', {});

  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/plans/tracking?projectId=${projectId}');return true;`,
  );
  await waitFor('模拟观察日');
  const tracking = await evaluate(`
    const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('核验-near') && r.textContent.includes('内部WBS'));
    return {text:row.innerText,color:!!row.querySelector('.badge.risk-yellow'),href:row.querySelector('a.text-link').getAttribute('href')};
  `);
  assert.match(tracking.text, /本人已读/);
  assert.ok(tracking.color);
  assert.match(tracking.text, /2026-10-20/);
  assert.match(tracking.href, /focus=CHECK-/);
  await check('追踪看板沿用计划结束日、同一已读和风险色', tracking);
  await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    app.store.setRole('solution');
    return true;
  `);
  await delay(100);
  const otherRead = await evaluate(
    `return [...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('核验-near') && r.textContent.includes('内部WBS')).innerText;`,
  );
  assert.match(otherRead, /本人未读/);
  await check('负责人和PM的已读互不影响', otherRead);
  await evaluate(`
    const store=ng.getComponent(document.querySelector('app-root')).store;
    const project=store.project('${projectId}');
    const team=project.team.map(member=>member.person==='周方案'?{...member,person:'方案新显示名',department:'新部门'}:member);
    if(!store.assignTeam(project.id,team))throw new Error('rename failed');
    return true;
  `);
  await delay(100);
  const renamed = await evaluate(`
    const store=ng.getComponent(document.querySelector('app-root')).store;
    return {reader:store.person(),found:[...document.querySelectorAll('tbody tr')].some(r=>r.textContent.includes('核验-near') && r.textContent.includes('内部WBS'))};
  `);
  assert.equal(renamed.reader, '周方案');
  assert.equal(renamed.found, true);
  await check('团队更名后固定登录身份仍看到原计划预警', renamed);

  await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    app.store.setDateMode('comparison');
    const project=app.store.project('${projectId}');
    const plan=project.plans.find(p=>p.id==='CHECK-内部WBS-near');
    app.store.savePlan(project.id,{...plan,owner:'吴运维'});
    return true;
  `);
  await delay(150);
  const transferred = await evaluate(
    `return [...document.querySelectorAll('tbody tr')].some(r=>r.textContent.includes('核验-near') && r.textContent.includes('内部WBS'));`,
  );
  assert.equal(transferred, false);
  await evaluate(
    `ng.getComponent(document.querySelector('app-root')).store.setRole('receiver');return true;`,
  );
  await delay(150);
  const transferText = await evaluate(
    `return [...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('核验-near') && r.textContent.includes('内部WBS')).innerText;`,
  );
  assert.match(transferText, /已逾期/);
  assert.match(transferText, /本人未读/);
  await check('临期升超期并随负责人转交，旧身份投影解除', transferText);

  await evaluate(`
    [...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('核验-near') && r.textContent.includes('内部WBS')).querySelector('a.text-link').click();return true;
  `);
  await waitFor('已定位：');
  const target = await evaluate(
    `return {text:document.querySelector('tr.focused-plan')?.innerText,url:location.href};`,
  );
  assert.match(target.text, /CHECK-内部WBS-near/);
  await check('追踪定位到正确项目、计划类型和Plan行', target);
  await evaluate(`
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='甘特视图').click();return true;
  `);
  await waitFor('当前模拟日期');
  assert.equal(await evaluate(`return new URL(location.href).searchParams.has('focus');`), false);
  await check('从定位入口仍可切换甘特，清除旧定位状态', {});

  const messages = toolText(await call('list_console_messages', { types: ['error'] }));
  assert(!/NG\d{4}|ERROR Error|TypeError/.test(messages), messages);
  await call('take_screenshot', { filePath: path.join(output, 'plan-gantt-warnings.png') });
  report.result = '通过';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (connection && pageId !== undefined) {
    try {
      report.browserFailure = await evaluate(
        `return {url:location.href,body:document.body.innerText.slice(0,7000)};`,
      );
    } catch {}
  }
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
