import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-department-records', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 58, checks: [], result: '失败' };
const opportunityId = 'DEMO-O014';
let server;
let connection;
let pageId;
let serverFailure;
let serverLog = '';
const check = async (name, run) => {
  const evidence = await run();
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
  return evidence;
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
      const response = await fetch(report.baseUrl);
      if (response.status === 200) break;
    } catch {}
    await delay(300);
  }
  assert(Date.now() < until, 'Angular 服务启动超时');

  connection = await connect({ isolated: true });
  const created = toolText(
    await connection.call('new_page', { url: report.baseUrl + '/sales/departments' }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await call('wait_for', { text: ['部门记录'], timeout: 15000 });
  assert.equal(await evaluate('return location.pathname'), '/sales/opportunities');
  assert(
    await evaluate(
      "return !![...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='商机列表')",
    ),
  );
  const app = "ng.getComponent(document.querySelector('app-root'))";
  const page = "ng.getComponent(document.querySelector('app-department-records'))";
  const before = await evaluate(`
    const store=${app}.store, view=${page};
    return {department:view.department(), count:view.rows().length, dataVersion:store.state().dataVersion, eventCount:(store.state().operationEvents||[]).length};
  `);
  assert.equal(before.department, '销售');
  assert(before.count > 0, '销售部门应显示现有商机');
  await check('部门记录页显示销售默认视角和商机清单', async () => before);

  await evaluate(`
    const input=document.querySelector('[aria-label="搜索客户名称、商机编号或项目名称"]');
    input.value=${JSON.stringify(opportunityId)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  `);
  const filtered = await evaluate(`return ${page}.rows().map(row=>row.sale.id)`);
  assert.deepEqual(filtered, [opportunityId]);
  await check('编号搜索和结果数量准确', async () => ({
    query: opportunityId,
    resultIds: filtered,
  }));

  await click('查看详情');
  await call('wait_for', { text: ['返回部门记录'], timeout: 10000 });
  const target = await evaluate(`
    const url=new URL(location.href);
    return Object.fromEntries(['department','objectType','objectId','module','section','action','mainlineId','roundId','returnTo','returnQuery','returnObjectId'].map(key=>[key,url.searchParams.get(key)]));
  `);
  assert.equal(target.department, '销售');
  assert.equal(target.objectType, 'opportunity');
  assert.equal(target.objectId, opportunityId);
  assert.equal(target.module, '商机');
  assert.equal(target.section, '概览');
  assert.equal(target.action, '查看商机记录');
  assert.equal(target.returnQuery, opportunityId);
  assert.equal(target.returnObjectId, opportunityId);
  assert(target.returnTo.includes('/sales/opportunities'));
  assert(target.returnTo.includes('tab=departments'));
  await check('详情定位携带对象、部门、模块和返回筛选上下文', async () => target);

  await click('返回部门记录');
  await call('wait_for', { text: [opportunityId], timeout: 10000 });
  const afterBack = await evaluate(`
    const store=${app}.store, view=${page};
    return {url:location.pathname+location.search, department:view.department(), query:view.query(), resultIds:view.rows().map(row=>row.sale.id), dataVersion:store.state().dataVersion, eventCount:(store.state().operationEvents||[]).length};
  `);
  assert.equal(afterBack.department, before.department);
  assert.equal(afterBack.query, opportunityId);
  assert.deepEqual(afterBack.resultIds, [opportunityId]);
  assert.equal(afterBack.dataVersion, before.dataVersion);
  assert.equal(afterBack.eventCount, before.eventCount);
  await check('返回后恢复部门、搜索筛选和记录且未写入状态', async () => afterBack);

  await check('筛选刷新后仍保留且责任身份未变化', async () => {
    const owners = await evaluate(
      `return ${app}.store.state().sales.map(s=>({id:s.id,owner:s.owner,operator:s.operator,team:s.team}));`,
    );
    await call('navigate_page', { type: 'reload' });
    await call('wait_for', { text: ['部门记录'], timeout: 15000 });
    assert.equal(await evaluate(`return ${page}.query()`), opportunityId);
    assert.deepEqual(
      await evaluate(
        `return ${app}.store.state().sales.map(s=>({id:s.id,owner:s.owner,operator:s.operator,team:s.team}));`,
      ),
      owners,
    );
    return { query: opportunityId, ownersUnchanged: true };
  });
  await click('清除筛选');
  await evaluate(`window.scrollTo(0,700); return true;`);
  const scrollBefore = await evaluate('return window.scrollY');
  await evaluate(`document.querySelector('.open-button').click(); return true;`);
  await call('wait_for', { text: ['返回部门记录'], timeout: 10000 });
  await call('navigate_page', { type: 'back' });
  await call('wait_for', { text: ['本部门工作项'], timeout: 10000 });
  await check('浏览器回退恢复部门页签与列表位置', async () => {
    const result = await evaluate(
      `return {tab:new URL(location.href).searchParams.get('tab'),scroll:window.scrollY,department:${page}.department(),query:${page}.query()};`,
    );
    assert.equal(result.tab, 'departments');
    assert.equal(result.department, '销售');
    assert.equal(result.query, '');
    assert(Math.abs(result.scroll - scrollBefore) < 10, JSON.stringify({ result, scrollBefore }));
    return result;
  });
  await click('解决方案');
  const solutionView = await evaluate(
    `return {department:${page}.department(), rows:${page}.rows().length, emptyText:document.querySelector('.empty-state')?.innerText||''}`,
  );
  assert.equal(solutionView.department, '解决方案');
  if (!solutionView.rows)
    assert(
      solutionView.emptyText.includes('没有匹配') || solutionView.emptyText.includes('没有本部门'),
    );
  await click('PMO / PM');
  const pmoText = await evaluate(
    "return document.querySelector('.responsibility-note')?.innerText||''",
  );
  assert(pmoText.includes('PMO事项') && pmoText.includes('PM责任人'));
  await check('解决方案视图与 PMO/PM 分责说明可见', async () => ({ solutionView, pmoText }));

  await check('切换查看角色不改变业务责任人与工作项身份', async () => {
    const original = await evaluate(
      `return {owners:${app}.store.state().sales.map(s=>({id:s.id,owner:s.owner,operator:s.operator,team:s.team})),items:${page}.workItemView().items.map(item=>({id:item.id,owner:item.owner}))};`,
    );
    await evaluate(
      `const role=document.querySelector('[aria-label="当前业务角色"]'); role.value='solution';role.dispatchEvent(new Event('change',{bubbles:true}));return true;`,
    );
    const after = await evaluate(
      `return {owners:${app}.store.state().sales.map(s=>({id:s.id,owner:s.owner,operator:s.operator,team:s.team})),items:${page}.workItemView().items.map(item=>({id:item.id,owner:item.owner}))};`,
    );
    assert.deepEqual(after, original);
    return {
      role: 'solution',
      unchangedWorkItems: after.items.length,
      unchangedOwners: after.owners.length,
    };
  });
  await check('无匹配结果可清空筛选恢复原部门记录', async () => {
    const originalCount = await evaluate(`return ${page}.rows().length`);
    await evaluate(
      `const input=document.querySelector('[aria-label="搜索客户名称、商机编号或项目名称"]');input.value='绝不存在的商机';input.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
    );
    assert.equal(await evaluate(`return ${page}.rows().length`), 0);
    assert(await evaluate(`return !!document.querySelector('.empty-state')`));
    await click('清除筛选');
    assert.equal(await evaluate(`return ${page}.rows().length`), originalCount);
    return { emptyCount: 0, restoredCount: originalCount };
  });
  await check('真实工作项点击保留目标页签并恢复来源筛选和滚动', async () => {
    await evaluate(`const button=[...document.querySelectorAll('.department-tab')].find(button=>button.querySelector('span').textContent.trim()==='销售');button.click();return true;`);
    const context = await evaluate(`
      const view=${page};
      const store=${app}.store;const sale=store.state().sales.find(s=>s.id==='DEMO-O014');
      if(!store.assignTeam(sale.id,[...sale.team,{id:'NAV-TEST',role:'sales',person:sale.owner,department:'销售',window:'本周',confirmed:false,confirmedBy:''}]))throw new Error('建立部门任务样本失败');
      const target=view.workItemView().items.find(item=>item.sourceRecordId.endsWith(':DEPT-NAV-TEST'));
      if (!target) throw new Error('缺少原有部门任务样本');
      const saleId=decodeURIComponent(target.href.split('/sales/detail/')[1].split('?')[0]);
      const department=target.department.includes('方案') ? '解决方案' : /PM/.test(target.department) ? 'PMO / PM' : '销售';
      return {saleId,department,id:target.id};`);
    await evaluate(`const button=[...document.querySelectorAll('.department-tab')].find(button=>button.querySelector('span').textContent.trim()===${JSON.stringify(context.department)});button.click();return true;`);
    assert.equal(await evaluate(`return ${page}.department()`),context.department);
    await evaluate(
      `const input=document.querySelector('[aria-label="搜索客户名称、商机编号或项目名称"]');input.value=${JSON.stringify(context.saleId)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
    );
    const origin = await evaluate(
      `window.scrollTo(0,300);return {scroll:window.scrollY,query:${page}.query()};`,
    );
    await evaluate(
      `const link=[...document.querySelectorAll('[data-work-item-id]')].find(link=>link.dataset.workItemId===${JSON.stringify(context.id)});if(!link)throw new Error('筛选后工作项丢失：'+JSON.stringify({department:${page}.department(),query:${page}.query(),rows:${page}.rows().map(row=>row.sale.id),items:${page}.departmentWorkItems().map(item=>item.id),target:${JSON.stringify(context.id)}}));link.click();return true;`,
    );
    await call('wait_for', { text: ['返回部门记录'], timeout: 15000 });
    const target = await evaluate(
      `return {path:location.pathname,tab:new URL(location.href).searchParams.get('tab')};`,
    );
    assert.equal(target.path, '/sales/detail/' + context.saleId);
    assert.equal(target.tab, '团队');
    await click('返回部门记录');
    await call('wait_for', { text: ['本部门工作项'], timeout: 15000 });
    const restored = await evaluate(
      `return {query:${page}.query(),department:${page}.department(),scroll:window.scrollY};`,
    );
    assert.equal(restored.query, origin.query);
    assert.equal(restored.department, context.department);
    assert(Math.abs(restored.scroll - origin.scroll) < 10);
    return { target, origin, restored };
  });
  const consoleText = toolText(await call('list_console_messages', { types: ['error'] }));
  report.consoleErrors = consoleText;
  assert(!/msgid=/.test(consoleText), '浏览器控制台出现 Angular 错误');
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
