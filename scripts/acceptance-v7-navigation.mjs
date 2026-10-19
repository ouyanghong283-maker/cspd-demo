import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v7-navigation', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 57, checks: [], result: '失败' };
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
  const desktop = await evaluate(`
    const app=${appExpr}, nav=document.querySelector('.sidebar nav');
    const labels=[...document.querySelectorAll('.navigation-group')].map(g=>g.getAttribute('aria-label'));
    const items=[...document.querySelectorAll('.sidebar nav a')].map(a=>a.innerText.trim());
    const brand=document.querySelector('.brand').getBoundingClientRect();
    const max=nav.scrollHeight-nav.clientHeight;
    nav.scrollTop=max;
    return {labels,items,scroll:{max,top:nav.scrollTop,documentTop:document.documentElement.scrollTop},brandTop:brand.top,brandAfterTop:document.querySelector('.brand').getBoundingClientRect().top,badges:app.navBadgeCounts(),sources:{all:app.store.state().projects.length}};
  `);
  assert.deepEqual(desktop.labels, [
    '我的工作',
    '客户',
    '销售与售前',
    '签约与交付',
    '看板工具',
    '演示辅助',
  ]);
  assert(desktop.items.includes('方案设计') && desktop.items.includes('报价议价'));
  assert(
    desktop.scroll.max > 0 && desktop.scroll.top === desktop.scroll.max,
    '菜单应有独立滚动区域',
  );
  assert.equal(desktop.scroll.documentTop, 0, '滚动菜单不应滚动整页');
  assert.equal(desktop.brandAfterTop, desktop.brandTop, '滚动菜单时品牌区域应固定');
  await check('六组入口、完整名称、品牌固定和菜单独立滚动', desktop);

  const counts = await evaluate(`
    const app=${appExpr}, state=app.store.state();
    const expectedProject=state.projects.reduce((count,project)=>count+
      project.plans.filter(plan=>plan.status!=='已完成').length+
      (project.briefing.startupHandover?.status==='待移交'?1:0),0);
    const person=app.store.person();
    const ownedProject=state.projects.reduce((count,project)=>count+
      project.plans.filter(plan=>plan.status!=='已完成'&&plan.owner===person).length+
      (project.briefing.startupHandover?.status==='待移交'&&project.briefing.startupHandover.receiver===person?1:0),0);
    const ownedDepartment=state.sales.reduce((count,sale)=>count+(sale.departmentTasks||[]).filter(task=>
      task.status!=='已完成'&&sale.team.some(member=>member.department===task.department&&member.person===person)).length,0);
    const expectedAll=ownedProject+ownedDepartment;
    const badgeFor=label=>Number([...document.querySelectorAll('.sidebar nav a')].find(a=>a.innerText.includes(label))?.querySelector('.nav-badge')?.textContent.trim());
    return {badges:app.navBadgeCounts(),expectedAll,expectedProject,
      displayed:{all:badgeFor('我的待办'),project:badgeFor('共享项目看板')},
      unread:app.unread(),notices:app.store.pendingNotices().filter(n=>!n.read).length};
  `);
  assert.equal(Number(counts.badges['my-tasks']), counts.expectedAll);
  assert.equal(Number(counts.badges['shared-project-board']), counts.expectedProject);
  assert.deepEqual(counts.displayed, { all: counts.expectedAll, project: counts.expectedProject });
  await check('待办 badge 使用任务聚合计数，未读通知仍独立', counts);

  const toggle = await evaluate(`
    const button=document.querySelector('.nav-group');
    button.focus();
    const before=button.getAttribute('aria-expanded');
    return {before,outline:getComputedStyle(button).outlineStyle,focused:document.activeElement===button};
  `);
  assert(toggle.focused && toggle.outline !== 'none', '键盘焦点必须清晰可见');
  await call('press_key', { key: 'Space' });
  const keyboard = await evaluate(
    `return {expanded:document.querySelector('.nav-group').getAttribute('aria-expanded')}`,
  );
  assert.notEqual(keyboard.expanded, toggle.before, 'Space 应可折叠/展开分组');
  await call('press_key', { key: 'Enter' });
  const keyboardRestored = await evaluate(
    `return document.querySelector('.nav-group').getAttribute('aria-expanded')`,
  );
  assert.equal(keyboardRestored, toggle.before, 'Enter 应可切换分组');
  await check('分组支持键盘操作且焦点样式清楚', { toggle, keyboard, keyboardRestored });

  await call('press_key', { key: 'Tab' });
  const firstNavLink = await evaluate(`
    const link=document.activeElement;
    return {label:link.getAttribute('aria-label'),href:link.getAttribute('href'),outline:getComputedStyle(link).outlineStyle};
  `);
  assert(firstNavLink.label.startsWith('我的待办') && firstNavLink.href === '/');
  assert.notEqual(firstNavLink.outline, 'none', 'Tab 聚焦链接时焦点样式应可见');
  await call('press_key', { key: 'Tab' });
  const targetNavLink = await evaluate(`
    const link=document.activeElement;
    return {label:link.getAttribute('aria-label'),href:link.getAttribute('href')};
  `);
  assert(targetNavLink.label.startsWith('共享项目看板'));
  assert.equal(targetNavLink.href, '/projects/board');
  await call('press_key', { key: 'Enter' });
  await call('wait_for', { text: ['共享项目看板'], timeout: 15000 });
  const keyboardNavigation = await evaluate(`
    return {url:location.pathname,title:document.querySelector('h1')?.innerText||''};
  `);
  assert.equal(keyboardNavigation.url, '/projects/board');
  assert.equal(keyboardNavigation.title, '共享项目看板');
  await check('Tab 聚焦到目标链接后按 Enter 进入对应路由', {
    firstNavLink,
    targetNavLink,
    keyboardNavigation,
  });

  await call('navigate_page', { url: report.baseUrl + '/sales' });
  const selected = await evaluate(`
    const section=document.querySelector('.navigation-group[aria-label="看板工具"]');
    const link=[...section.querySelectorAll('a')].find(a=>a.getAttribute('aria-current')==='page');
    const style=link&&getComputedStyle(link);
    return {expanded:section.querySelector('button').getAttribute('aria-expanded'),label:link?.innerText.trim(),boxShadow:style?.boxShadow,weight:style?.fontWeight};
  `);
  assert.equal(selected.expanded, 'true');
  assert.equal(selected.label, '商机看板');
  assert.notEqual(selected.boxShadow, 'none', '选中态需有颜色以外的标识');
  await evaluate(
    `document.querySelector('.navigation-group[aria-label="看板工具"] button').click(); return true`,
  );
  await call('navigate_page', { url: report.baseUrl + '/sales/leads' });
  const reopened = await evaluate(
    `return document.querySelector('.navigation-group[aria-label="销售与售前"] button').getAttribute('aria-expanded')`,
  );
  assert.equal(reopened, 'true', '进入当前入口时应自动展开所属分组');
  await check('当前入口有非颜色选中标识且导航后所属分组保持展开', { selected, reopened });

  await call('navigate_page', { url: report.baseUrl + '/' });
  await call('resize_page', { width: 390, height: 844 });
  await click('展开导航');
  const mobileOpen = await evaluate(`
    const sidebar=document.querySelector('.sidebar'), last=document.querySelectorAll('.navigation-group')[5];
    return {width:innerWidth,visible:getComputedStyle(sidebar).visibility,transform:getComputedStyle(sidebar).transform,
      lastGroup:last.getAttribute('aria-label'),lastButton:last.querySelector('button').getBoundingClientRect().width,
      bodyWidth:document.documentElement.scrollWidth};
  `);
  assert.equal(mobileOpen.visible, 'visible');
  assert.equal(mobileOpen.lastGroup, '演示辅助');
  assert(
    mobileOpen.lastButton > 0 && mobileOpen.bodyWidth <= mobileOpen.width + 1,
    JSON.stringify(mobileOpen),
  );
  await call('press_key', { key: 'Escape' });
  const mobileClosed = await evaluate(
    `return getComputedStyle(document.querySelector('.sidebar')).visibility`,
  );
  assert.equal(mobileClosed, 'hidden', 'Escape 应关闭移动导航抽屉');
  await check('窄屏抽屉可访问全部分组并支持 Escape 关闭', { mobileOpen, mobileClosed });

  await call('navigate_page', {
    url: report.baseUrl + '/sales/detail/DEMO-O001?tab=%E6%96%B9%E6%A1%88&guide=mainline',
  });
  await call('wait_for', { text: ['方案设计'], timeout: 15000 });
  const legacy = await evaluate(
    `return {url:location.pathname+location.search,heading:document.querySelector('h1')?.innerText||''}`,
  );
  assert(legacy.url.startsWith('/sales/solutions/DEMO-O001?guide=mainline'));
  await check('旧方案入口定位到同一商机的方案工作区并保留无关上下文', legacy);

  await call('navigate_page', {
    url:
      report.baseUrl +
      '/projects/DEMO-P001?tab=%E5%90%AF%E5%8A%A8%E4%BA%A4%E5%BA%95&returnTo=%2Fprojects',
  });
  await call('wait_for', { text: ['启动交底'], timeout: 15000 });
  const legacyStartup = await evaluate(`return {url:location.pathname+location.search}`);
  const startupTarget = new URL(legacyStartup.url, report.baseUrl);
  assert.equal(startupTarget.pathname, '/projects/DEMO-P001');
  assert.equal(startupTarget.searchParams.get('tab'), 'startup');
  assert.equal(startupTarget.searchParams.get('returnTo'), '/projects');
  await check('旧启动交底入口进入同一项目并保留返回定位', legacyStartup);

  await call('navigate_page', { url: report.baseUrl + '/projects/board' });
  await call('wait_for', { text: ['共享项目看板'], timeout: 15000 });
  const board = await evaluate(
    `return {url:location.pathname,title:document.querySelector('h1')?.innerText||'',itemCount:document.querySelectorAll('[data-work-item-id]').length}`,
  );
  assert.equal(board.url, '/projects/board');
  assert.equal(board.title, '共享项目看板');
  assert(board.itemCount > 0, '看板应显示共享项目任务来源');
  await check('共享项目看板导航进入已实现页面并呈现真实任务来源', board);

  await call('navigate_page', { url: report.baseUrl + '/unknown/navigation-target' });
  await call('wait_for', { text: ['没有找到这个入口'], timeout: 10000 });
  const unknown = await evaluate(
    `return {url:location.pathname,title:document.querySelector('h1')?.innerText||''}`,
  );
  assert.equal(unknown.url, '/unknown/navigation-target');
  assert.equal(unknown.title, '没有找到这个入口');
  await check('未知路径保留原地址并明确提示，不伪装跳转成功', unknown);

  await call('resize_page', { width: 1440, height: 1000 });
  for (const tab of ['logistics', 'service']) {
    await call('navigate_page', {
      url: report.baseUrl + `/plans/${tab}?project=DEMO-P001&dept=PM&source=notice#target`,
    });
    await call('wait_for', {
      text: [tab === 'service' ? '成交服务承诺与采用版本' : '计划日期用于承诺'],
      timeout: 15000,
    });
    const bridge = await evaluate(
      `return {url: location.pathname+location.search+location.hash, text:document.querySelector('main').innerText, active:document.querySelector('nav a[aria-current="page"]')?.innerText}`,
    );
    assert.equal(
      bridge.url,
      `/delivery-service?dept=PM&project=DEMO-P001&source=notice&tab=${tab}#target`,
    );
    assert.equal(bridge.active, '交付与售后');
    assert(bridge.text.includes('DEMO-P001'));
    await check(`旧${tab}入口保留项目和参数并显示真实业务页`, bridge);
  }
  await call('navigate_page', { type: 'back' });
  await call('wait_for', { text: ['计划日期用于承诺'], timeout: 15000 });
  const switched = await evaluate(
    `return {url:location.pathname+location.search+location.hash,text:document.querySelector('main').innerText}`,
  );
  assert(
    switched.url.includes('tab=logistics') &&
      switched.url.includes('project=DEMO-P001') &&
      switched.url.endsWith('#target'),
  );
  await check('交付旧入口与浏览器回退保留上下文', switched);

  await call('navigate_page', {
    url: report.baseUrl + '/sales/departments?dept=PM&filter=open#workitems',
  });
  await call('wait_for', { text: ['部门记录'], timeout: 15000 });
  const department = await evaluate(
    `return {url:location.pathname+location.search+location.hash,active:document.querySelector('nav a[aria-current="page"]')?.innerText, text:document.querySelector('main').innerText}`,
  );
  const departmentUrl = new URL(department.url, report.baseUrl);
  assert.equal(departmentUrl.pathname, '/sales/opportunities');
  assert.equal(departmentUrl.searchParams.get('tab'), 'departments');
  assert.equal(departmentUrl.searchParams.get('dept'), 'PM');
  assert.equal(departmentUrl.searchParams.get('filter'), 'open');
  // The established contract carries department and filter query state. The legacy
  // component canonicalizes this route and does not preserve a fragment.
  assert.equal(department.active, '商机管理');
  assert(department.text.includes('部门'));
  await check('旧部门入口继续提供真实部门记录并保留筛选', department);

  const customerId = await evaluate(`return ${appExpr}.store.state().customers[0].id`);
  await call('navigate_page', {
    url: report.baseUrl + '/sales/customers/' + encodeURIComponent(customerId),
  });
  await call('wait_for', { text: ['客户管理 / 返回列表'], timeout: 15000 });
  const customer = await evaluate(
    `return {active:document.querySelector('nav a[aria-current="page"]')?.innerText, contacts:[...document.querySelectorAll('main a')].filter(a=>a.href.includes('/sales/contacts')).map(a=>a.getAttribute('href'))}`,
  );
  assert.equal(customer.active, '客户管理');
  assert(customer.contacts.some((href) => href.includes(encodeURIComponent(customerId))));
  await call('navigate_page', {
    url: report.baseUrl + '/sales/contacts?customer=' + encodeURIComponent(customerId),
  });
  await call('wait_for', { text: ['联系人管理'], timeout: 15000 });
  const contacts = await evaluate(
    `return {selected:document.querySelector('select[aria-label="按客户筛选联系人"]').value, active:document.querySelector('nav a[aria-current="page"]')?.innerText}`,
  );
  assert.equal(contacts.selected, customerId);
  assert.equal(contacts.active, '联系人管理');
  await check('客户详情与联系人仍引用原客户 ID 和关系', { customerId, customer, contacts });

  for (const [url, message, back] of [
    ['/sales/customers/INVALID-ID', '找不到这条客户档案', '/sales/customers'],
    ['/projects/INVALID-ID', '没有找到项目', '/projects'],
    ['/projects/INVALID-ID/startup', '没有找到项目', '/projects'],
    ['/delivery-service?project=INVALID-ID', '找不到项目', '/projects'],
  ]) {
    const eventsBefore = await evaluate(`return JSON.stringify(${appExpr}.store.state().operationEvents);`);
    await call('navigate_page', { url: report.baseUrl + url });
    await call('wait_for', { text: [message], timeout: 15000 });
    const missing = await evaluate(
      `return {text:document.querySelector('main').innerText, links:[...document.querySelectorAll('main a')].map(a=>a.getAttribute('href'))}`,
    );
    if (back) assert(missing.links.includes(back));
    await check(
      back ? `无效 ID 明确报错并提供返回入口 ${url}` : `无效 ID 明确报错 ${url}`,
      missing,
    );
    if (url.startsWith('/delivery-service')) {
      await evaluate(`document.querySelector('main a[href="/projects"]').click();return true;`);
      await call('wait_for', { text: ['全部交付项目'], timeout: 15000 });
      const returned = await evaluate(`return {path:location.pathname,events:JSON.stringify(${appExpr}.store.state().operationEvents)};`);
      assert.equal(returned.path, '/projects');
      assert.equal(returned.events, eventsBefore);
      await check('无效交付项目返回列表且查看未产生业务操作', returned);
    }
  }
  for (const [action, message] of [
    ['continue', '返回我的待办继续本轮'],
    ['restart', '请使用下方“重置演示数据”按钮选择新轮起点'],
  ]) {
    await call('navigate_page', { url: report.baseUrl + '/control?action=' + action });
    await call('wait_for', { text: [message], timeout: 15000 });
    const entry = await evaluate(
      `return {active:document.querySelector('nav a[aria-current="page"]')?.innerText, reset:[...document.querySelectorAll('button')].some(b=>b.innerText.includes('重置演示数据'))}`,
    );
    assert.equal(entry.active, action === 'continue' ? '继续本轮' : '重新开始演示');
    assert(entry.reset);
    await check(`演示 ${action} 入口定位既有操作`, entry);
  }

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
