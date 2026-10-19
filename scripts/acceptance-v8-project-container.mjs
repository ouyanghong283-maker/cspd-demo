import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-project-container', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 59, checks: [], result: '失败' };
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

  const projects = await evaluate(
    `return ng.getComponent(document.querySelector('app-root')).store.state().projects.map(p=>({id:p.id,name:p.name,plans:p.plans}));`,
  );
  assert(projects.length >= 2);
  await call('navigate_page', {
    url:
      report.baseUrl + '/projects/' + projects[0].id + '?tab=plans&dept=销售&action=review#target',
  });
  await call('wait_for', { text: ['本页直接维护项目已提交计划'], timeout: 15000 });
  const tabs = await evaluate(
    `return [...document.querySelectorAll('[aria-label="项目内容"] button')].map(b=>b.innerText.trim());`,
  );
  assert.deepEqual(tabs, ['概况', '启动', '计划', '交付', '验收']);
  await check('统一项目五页签可从 URL 进入', { tabs });
  const before = await evaluate(
    `return ng.getComponent(document.querySelector('app-root')).store.state().projects.map(p=>({id:p.id,plans:p.plans}));`,
  );
  const first = projects[0],
    second = projects[1];
  for (const project of [first, second]) {
    await evaluate(
      `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${project.id}?tab=overview&dept=销售&action=review#target'); return true;`,
    );
    const overview = await evaluate(
      `return {text:document.querySelector('.page-heading').innerText,active:document.querySelector('[aria-label="项目内容"] .active')?.innerText,url:location.href};`,
    );
    assert(overview.text.includes(project.id) && overview.text.includes(project.name));
    assert.equal(overview.active, '概况');
    await check('项目概况身份 ' + project.id, overview);
  }
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${first.id}?tab=plans&dept=销售&action=review#target'); return true;`,
  );
  await click('启动');
  // 03-02 已把原启动交底内容内嵌到“启动交底”页签，桥接入口改为容器内页签跳转，
  // 仍须保留 projectId、部门、目标动作和 fragment。
  await call('wait_for', { text: ['部门启动内容'], timeout: 15000 });
  const startupLink = await evaluate(
    `return [...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='项目启动工作区').getAttribute('href');`,
  );
  assert(
    startupLink.includes('/projects/' + first.id) &&
      startupLink.includes('tab=startup') &&
      startupLink.includes('dept=') &&
      startupLink.includes('action=review') &&
      startupLink.endsWith('#target'),
  );
  await call('navigate_page', { url: report.baseUrl + startupLink });
  await call('wait_for', { text: ['部门启动内容', '合同交底与显式门禁'], timeout: 15000 });
  const located = await evaluate(
    `return {tab:new URL(location.href).searchParams.get('tab'),hash:location.hash,hint:document.querySelector('#startup-located-hint')?.innerText||''};`,
  );
  assert.equal(located.tab, 'startup');
  assert.equal(located.hash, '#target');
  await call('navigate_page', {
    url: report.baseUrl + `/projects/${first.id}/startup?dept=销售#target`,
  });
  await call('wait_for', { text: ['部门启动内容'], timeout: 15000 });
  const legacyStartup = await evaluate(
    `const url=new URL(location.href);return {pathname:url.pathname,tab:url.searchParams.get('tab'),dept:url.searchParams.get('dept'),hash:url.hash};`,
  );
  assert.deepEqual(legacyStartup, {
    pathname: `/projects/${first.id}`,
    tab: 'startup',
    dept: '销售',
    hash: '#target',
  });
  await check('启动桥接保留 ID、部门、目标动作、fragment，旧启动链接映射到启动交底页签', {
    startupLink,
    located,
    legacyStartup,
  });
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${first.id}?tab=plans&dept=销售#target'); return true;`,
  );
  for (const path of ['/plans', '/plans/tracking', '/delivery-service?tab=logistics']) {
    const separator = path.includes('?') ? '&' : '?';
    await evaluate(
      `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('${path}${separator}projectId=${first.id}&dept=销售#target'); return true;`,
    );
    const view = await evaluate(
      `const component=ng.getComponent([...document.querySelectorAll('router-outlet')].at(-1).nextElementSibling);const project=typeof component.project==='function'?component.project():null;return {projectId:component.projectId(),projects:typeof component.plans==='function'?component.plans().map(p=>({id:p.id,plans:p.plans})):project?[{id:project.id,plans:project.plans}]:[],tracking:typeof component.trackingRows==='function'?component.trackingRows().map(r=>r.project.id):[],deliveryText:document.querySelector('app-project-delivery-panel')?.innerText||'',url:location.href};`,
    );
    assert.equal(view.projectId, first.id);
    assert.deepEqual(
      view.projects.map((p) => p.id),
      [first.id],
    );
    assert.deepEqual(view.projects[0].plans, first.plans);
    assert(view.tracking.every((id) => id === first.id));
    if (path.startsWith('/delivery-service')) {
      assert(view.deliveryText.includes(first.id), '交付详情必须展示同一个项目ID');
      assert(view.deliveryText.includes(first.name), '交付详情必须展示同一个项目名称');
    }
    await call('navigate_page', { type: 'reload' });
    const refreshed = await evaluate(`return {url:location.href,text:document.body.innerText};`);
    assert(refreshed.url.includes('projectId=' + first.id));
    assert(refreshed.text.includes(first.name));
    await check('同源计划/项目上下文及刷新 ' + path, view);
  }
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${first.id}?tab=overview&dept=销售#target'); return true;`,
  );
  const unsaved = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('补充项目信息')); button.click();
    await new Promise(r=>setTimeout(r,50));
    const input=document.querySelector('[role="dialog"] input'); input.value='未保存项目名称'; input.dispatchEvent(new Event('input',{bubbles:true}));
    let prompts=0; const confirm=window.confirm;window.confirm=()=>{prompts++;return false};
    const tab=await app.router.navigateByUrl('/projects/${first.id}?tab=plans');
    const id=await app.router.navigateByUrl('/projects/${second.id}?tab=overview');
    const leave=await app.router.navigateByUrl('/plans');
    const preserved=document.querySelector('[role="dialog"] input').value;
    window.confirm=()=>{prompts++;return true}; await app.router.navigateByUrl('/projects/${first.id}?tab=acceptance');window.confirm=confirm;
    await new Promise(r=>setTimeout(r,50)); return {prompts,tab,id,leave,preserved,dialog:!!document.querySelector('[role="dialog"]'),url:location.href};`);
  assert.equal(unsaved.prompts, 4);
  assert.equal(unsaved.tab, false);
  assert.equal(unsaved.id, false);
  assert.equal(unsaved.leave, false);
  assert.equal(unsaved.preserved, '未保存项目名称');
  assert.equal(unsaved.dialog, false);
  await check('未保存输入在页签、项目和离开时可拒绝，确认后关闭草稿', unsaved);
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${first.id}?tab=overview');await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${first.id}?tab=plans');return true;`,
  );
  const back = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('补充项目信息')).click();
    await new Promise(r=>setTimeout(r,20));
    let prompts=0;const confirm=window.confirm;window.confirm=()=>{prompts++;return false};history.back();await new Promise(r=>setTimeout(r,150));
    const blocked={url:location.href,dialog:!!document.querySelector('[role="dialog"]')};
    window.confirm=()=>{prompts++;return true};history.back();await new Promise(r=>setTimeout(r,150));window.confirm=confirm;
    return {prompts,blocked,url:location.href};`);
  console.log('BACK', JSON.stringify(back));
  assert(back.prompts >= 2);
  assert(back.blocked.url.includes('tab=plans'));
  assert(back.blocked.dialog);
  assert(back.url.includes('tab=overview'));
  await check('浏览器回退遵守未保存离开确认', back);
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${first.id}?tab=plans&plan=客户主节点');return true;`,
  );
  await call('navigate_page', { type: 'reload' });
  const planFilter = await evaluate(
    `return [...document.querySelectorAll('.type-tabs .active')].map(b=>b.innerText.trim());`,
  );
  assert(planFilter.includes('客户主节点'));
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${second.id}?tab=plans');return true;`,
  );
  const resetFilter = await evaluate(
    `return [...document.querySelectorAll('.type-tabs .active')].map(b=>b.innerText.trim());`,
  );
  assert(resetFilter.includes('内部WBS'));
  await check('计划类型刷新保留，切项目无过滤参数时重置', { planFilter, resetFilter });
  const returnTo = '/sales/opportunities?tab=departments&dept=方案&filter=待处理&scroll=320';
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${first.id}?tab=overview&returnTo='+encodeURIComponent(${JSON.stringify(returnTo)}));return true;`,
  );
  const returnLink = await evaluate(
    `return [...document.querySelectorAll('a')].find(a=>a.textContent.includes('返回部门记录')).getAttribute('href');`,
  );
  assert.equal(new URL(returnLink, report.baseUrl).pathname, '/sales/opportunities');
  assert.deepEqual([...new URL(returnLink, report.baseUrl).searchParams], [...new URL(returnTo, report.baseUrl).searchParams]);
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${first.id}?returnTo='+encodeURIComponent('https://evil.invalid/sales/opportunities?tab=departments'));return true;`,
  );
  const unsafe = await evaluate(
    `return [...document.querySelectorAll('a')].some(a=>a.textContent.includes('返回部门记录'));`,
  );
  assert.equal(unsafe, false);
  await check('部门记录返回原样保留上下文并拒绝外部地址', { returnLink, unsafe });
  const sourceReturnEvidence = await (async () => {
    const app = "ng.getComponent(document.querySelector('app-root'))";
    const page = "ng.getComponent(document.querySelector('app-department-records'))";
    await evaluate(`await ${app}.router.navigateByUrl('/sales/opportunities?tab=departments&department=销售');return true;`);
    await call('wait_for',{text:['本部门工作项'],timeout:15000});
    const context = await evaluate(
      `window.scrollTo(0,400);const app=${app};const view=${page};view.position.remember();return {scroll:window.scrollY,source:app.router.url,projectId:app.store.state().projects[0].id};`,
    );
    await evaluate(
      `await ${app}.router.navigate(['/projects',${JSON.stringify(context.projectId)}],{queryParams:{returnTo:${JSON.stringify(context.source)}}});return true;`,
    );
    await call('wait_for', { text: ['返回部门记录'], timeout: 15000 });
    const guarded = await evaluate(`
      const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('补充项目信息'));button.click();await new Promise(r=>setTimeout(r,50));
      const input=document.querySelector('[role="dialog"] input');input.value='尚未保存项目名称';input.dispatchEvent(new Event('input',{bubbles:true}));
      const original=window.confirm;let prompts=0;window.confirm=()=>{prompts++;return false};
      [...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='返回部门记录').click();await new Promise(r=>setTimeout(r,150));
      const stayed=location.pathname.startsWith('/projects/') && !!document.querySelector('[role="dialog"]');
      window.confirm=()=>{prompts++;return true};[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='返回部门记录').click();await new Promise(r=>setTimeout(r,150));window.confirm=original;
      return {stayed,prompts,path:location.pathname,scroll:window.scrollY,dialog:!!document.querySelector('[role="dialog"]')};`);
    assert.equal(guarded.stayed, true);
    assert.equal(guarded.prompts, 2);
    assert.equal(guarded.path, '/sales/opportunities');
    assert.equal(guarded.dialog, false);
    assert(Math.abs(guarded.scroll - context.scroll) < 10);
    return { context, guarded };
  })();
  await check('项目来源返回遵守未保存确认且保留列表位置',sourceReturnEvidence);
  await evaluate(`await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/${first.id}');return true;`);
  const readonly = await evaluate(
    `const app=ng.getComponent(document.querySelector('app-root'));app.store.editingWritable.set(false);await new Promise(r=>setTimeout(r,20));return {text:document.body.innerText,editDisabled:[...document.querySelectorAll('button')].find(b=>b.textContent.includes('补充项目信息')).matches(':disabled')};`,
  );
  assert(readonly.editDisabled && readonly.text.includes('项目内容只读'));
  await evaluate(
    `ng.getComponent(document.querySelector('app-root')).store.editingWritable.set(true);return true;`,
  );
  await check('缺修改资格时只读', readonly);
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/invalid-project?tab=plans');return true;`,
  );
  const invalid = await evaluate(`return document.body.innerText;`);
  assert(invalid.includes('没有找到项目'));
  assert(!invalid.includes(first.name));
  await check('无效 ID 不回退到其他项目', {});
  const after = await evaluate(
    `return ng.getComponent(document.querySelector('app-root')).store.state().projects.map(p=>({id:p.id,plans:p.plans}));`,
  );
  assert.deepEqual(after, before);
  await check('浏览与桥接不复制或修改项目计划', {});
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
