import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { base, root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

// The browser profile is isolated: saving a plan here never touches the user's demo data.
const output = path.join(
  root,
  'artifacts',
  'delivery-overview',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await fs.mkdir(output, { recursive: true });
const report = { base, checks: [], result: '失败' };
let connection;
let pageId;
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const result = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const json = result.match(/```json\s*([\s\S]*?)\s*```/);
  assert(json, result);
  return JSON.parse(json[1]);
};
const app = "ng.getComponent(document.querySelector('app-root'))";
const view =
  "ng.getComponent([...document.querySelectorAll('router-outlet')].at(-1).nextElementSibling)";
const check = (name, evidence = {}) => {
  report.checks.push({ name, evidence, result: '通过' });
  console.log('PASS', name);
};
const wait = async (text) => {
  const found = await evaluate(
    `for(let n=0;n<150;n++){if(document.body.innerText.includes(${JSON.stringify(text)}))return true;await new Promise(r=>setTimeout(r,100));}return false;`,
  );
  assert(found, '页面没有显示：' + text);
};
const navigate = async (url, text) => {
  await evaluate(`await ${app}.router.navigateByUrl(${JSON.stringify(url)}); return true;`);
  await wait(text);
};

try {
  connection = await connect({ isolated: true });
  const created = toolText(
    await connection.call('new_page', { url: base + '/delivery-service?tab=overview' }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await wait('未完成任务');
  const initial = await evaluate(
    `return {projects:${app}.store.state().projects, events:${app}.store.state().operationEvents};`,
  );
  const first = initial.projects[0];
  assert(first);
  const shell = await evaluate(
    `return {tabs:[...document.querySelectorAll('nav[aria-label="交付与售后入口"] button')].map(b=>b.innerText.trim()),duplicate:document.querySelectorAll('.module-tabs').length,active:[...document.querySelectorAll('.sidebar a[aria-current="page"]')].map(a=>a.innerText.trim()),oldMenu:[...document.querySelectorAll('.sidebar a')].some(a=>a.getAttribute('href')==='/plans')};`,
  );
  assert.deepEqual(shell.tabs, ['交付与售后总览', '项目计划总览']);
  assert.equal(shell.duplicate, 0);
  assert.deepEqual(shell.active, ['交付与售后']);
  assert.equal(shell.oldMenu, false);
  check('计划总览保留原业务入口，交付菜单唯一归属', shell);
  await navigate('/delivery-service?tab=overview', '未完成任务');
  await evaluate(
    `const input=document.querySelector('input[aria-label="搜索记录"]');input.value=${JSON.stringify(first.id)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
  );
  await evaluate(`await new Promise(r=>setTimeout(r,50));return true;`);
  const filtered = await evaluate(
    `return {ids:${view}.plans().map(p=>p.id),stats:[...document.querySelectorAll('.stat-number')].map(e=>e.innerText),warnings:${view}.warningTasks().every(r=>r.project.id===${JSON.stringify(first.id)})};`,
  );
  assert.deepEqual(filtered.ids, [first.id]);
  assert(filtered.warnings);
  assert.equal(filtered.stats[0], '1个');
  await evaluate(
    `const input=document.querySelector('input[aria-label="搜索记录"]');input.value='没有这个项目-acceptance';input.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
  );
  await wait('当前筛选下没有项目');
  assert.deepEqual(
    await evaluate(`return [...document.querySelectorAll('.stat-number')].map(e=>e.innerText);`),
    ['0个', '0项', '0项'],
  );
  check('计划总览搜索及统计一致，无结果显示空态', filtered);
  await evaluate(
    `const input=document.querySelector('input[aria-label="搜索记录"]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));const select=document.querySelector('select[aria-label="项目经理筛选"]');select.value=${JSON.stringify(first.pm)};select.dispatchEvent(new Event('change',{bubbles:true}));return true;`,
  );
  await evaluate('await new Promise(r=>setTimeout(r,50));return true;');
  const managers = await evaluate(`return ${view}.plans().map(p=>p.pm);`);
  assert(managers.length > 0 && managers.every((pm) => pm === first.pm));
  check('项目经理筛选作用于项目列表', { managers });

  await navigate(
    `/delivery-service?tab=overview&projectId=${first.id}&dept=PM&source=notice#target`,
    '未完成任务',
  );
  const beforeSave = await evaluate(
    `return {projects:${app}.store.state().projects,events:${app}.store.state().operationEvents};`,
  );
  assert.deepEqual(beforeSave.projects, initial.projects);
  assert.deepEqual(beforeSave.events, initial.events);
  check('计划总览筛选与查看不修改业务计划或操作事件');
  await evaluate(`document.querySelector('main table a.text-link').click();return true;`);
  await wait('本页直接维护项目已提交计划');
  const execution = await evaluate(
    `return {path:location.pathname,params:Object.fromEntries(new URLSearchParams(location.search)),hash:location.hash};`,
  );
  assert.equal(execution.path, '/projects/' + first.id);
  assert.equal(execution.params.tab, '计划执行');
  assert.equal(execution.params.dept, 'PM');
  assert.equal(execution.hash, '#target');
  await evaluate(
    `const row=[...document.querySelectorAll('main table tbody tr')].find(r=>r.innerText.includes('进行中')&&[...r.querySelectorAll('button')].some(b=>b.textContent.trim()==='编辑'));row.querySelector('button').click();return true;`,
  );
  await wait('编辑内部WBS');
  await evaluate(
    `const details=document.querySelector('[role="dialog"] details');if(details)details.open=true;return true;`,
  );
  const planId = await evaluate(`return ${app}.ui.dialog().title;`);
  const note = '交付总览验收-' + Date.now();
  await evaluate(
    `const input=document.querySelector('[data-field="note"]');input.value=${JSON.stringify(note)};input.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
  );
  const unsaved = await evaluate(
    `const confirm=window.confirm;window.confirm=()=>false;try {const navigated=await ${app}.router.navigateByUrl('/plans?projectId=${first.id}');return {navigated,dialog:!!document.querySelector('[role="dialog"]'),note:document.querySelector('[data-field="note"]')?.value};}finally{window.confirm=confirm;}`,
  );
  assert.equal(unsaved.navigated, false);
  assert.equal(unsaved.dialog, true);
  assert.equal(unsaved.note, note);
  check('未保存计划离开时继续提示，拒绝后保留原表单输入');
  await evaluate(
    `[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='保存').click();return true;`,
  );
  const saved = await evaluate(
    `for(let n=0;n<50;n++){if(!document.querySelector('[role="dialog"]'))return ${app}.store.project(${JSON.stringify(first.id)}).plans.some(p=>p.note===${JSON.stringify(note)});await new Promise(r=>setTimeout(r,50));}return false;`,
  );
  assert(saved, '计划编辑未保存：' + planId);
  await evaluate(
    `const link=[...document.querySelectorAll('main a')].find(a=>a.textContent.trim()==='项目总览');link.click();return true;`,
  );
  await wait('未完成任务');
  assert.equal(await evaluate('return location.pathname;'), '/delivery-service');
  assert.equal(
    await evaluate(`return ${view}.plans()[0].plans.some(p=>p.note===${JSON.stringify(note)});`),
    true,
  );
  await call('navigate_page', { type: 'reload' });
  await wait('未完成任务');
  assert.equal(
    await evaluate(`return ${view}.plans()[0].plans.some(p=>p.note===${JSON.stringify(note)});`),
    true,
  );
  check('总览进入计划编辑、真实保存、返回总览与刷新同源持久化', execution);
  await evaluate(
    `const link=[...document.querySelectorAll('main a')].find(a=>a.textContent.trim()==='打开追踪看板');link.click();return true;`,
  );
  await wait('日期缺失单独显示');
  assert.equal(await evaluate('return location.pathname;'), '/plans/tracking');
  assert.equal(await evaluate(`return ${view}.projectId();`), first.id);
  assert.equal(
    await evaluate(
      `return ${view}.trackingRows().every(r=>r.project.id===${JSON.stringify(first.id)});`,
    ),
    true,
  );
  check('追踪看板保留项目上下文并继续读取同源计划');

  await navigate('/delivery-service?tab=overview', '未完成任务');
  await call('take_screenshot', { filePath: path.join(output, 'desktop.png'), fullPage: true });
  await call('resize_page', { width: 390, height: 844 });
  const mobile = await evaluate(
    'return {width:innerWidth,body:document.documentElement.scrollWidth,tabs:document.querySelectorAll("nav.tabs button").length};',
  );
  assert(mobile.body <= mobile.width + 1, JSON.stringify(mobile));
  assert.equal(mobile.tabs, 2);
  await call('take_screenshot', { filePath: path.join(output, 'mobile.png'), fullPage: true });
  check('桌面与移动端总览可用，整页无横向溢出', mobile);
  const errors = toolText(await call('list_console_messages', { types: ['error'] }));
  assert(!/msgid=/.test(errors), errors);
  check('浏览器控制台无错误');
  report.result = '通过';
} catch (error) {
  report.error = error.stack || String(error);
  if (pageId)
    report.page = await evaluate('return {url:location.href,text:document.body.innerText};').catch(
      () => null,
    );
  throw error;
} finally {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log('验收报告：' + path.join(output, 'results.json'));
  await connection?.client.close().catch(() => {});
  await connection?.transport.close().catch(() => {});
}
