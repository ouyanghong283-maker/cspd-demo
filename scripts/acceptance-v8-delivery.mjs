import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { base, root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';
const output = path.join(
  root,
  'artifacts',
  'v8-delivery',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await fs.mkdir(output, { recursive: true });
const report = { base, checks: [], result: '失败' };
let connection, pageId;
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const result = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  const match = result.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, result);
  return JSON.parse(match[1]);
};
const app = "ng.getComponent(document.querySelector('app-root'))";
const shell = "ng.getComponent(document.querySelector('app-project-delivery-panel'))";
const check = (name, evidence = {}) => {
  report.checks.push({ name, evidence, result: '通过' });
  console.log('PASS', name);
};
const wait = async (text) =>
  assert(
    await evaluate(
      `for(let n=0;n<150;n++){if(document.body.innerText.includes(${JSON.stringify(text)}))return true;await new Promise(r=>setTimeout(r,100));}return false;`,
    ),
    '未显示：' + text,
  );
const navigate = async (url, text) => {
  await evaluate(`await ${app}.router.navigateByUrl(${JSON.stringify(url)});return true;`);
  await wait(text);
};
const click = async (text) => {
  await evaluate(
    `const e=[...document.querySelectorAll('main button, main a')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('找不到按钮');e.click();return true;`,
  );
};
try {
  connection = await connect({ isolated: true });
  const created = toolText(await connection.call('new_page', { url: base + '/delivery-service' }));
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await wait('交付与售后项目总览');
  const initial = await evaluate(
    `return {projects:${app}.store.state().projects,events:${app}.store.state().operationEvents};`,
  );
  const first = initial.projects[0];
  assert(first);
  const rows = await evaluate(
    "return [...document.querySelectorAll('[data-project-id]')].map(r=>r.dataset.projectId);",
  );
  assert.equal(rows.length, new Set(initial.projects.map((p) => p.id)).size);
  assert.equal(rows.length, new Set(rows).size);
  check('DEL01 一项目一行按项目ID去重', { ids: rows });
  await evaluate(
    `const e=document.querySelector('[aria-label="交付项目或客户搜索"]');e.value=${JSON.stringify(first.id)};e.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
  );
  await evaluate('await new Promise(r=>setTimeout(r,200));return true;');
  assert.deepEqual(
    await evaluate(
      "return [...document.querySelectorAll('[data-project-id]')].map(r=>r.dataset.projectId);",
    ),
    [first.id],
  );
  check('项目搜索作用于实际列表并写入URL');
  await call('navigate_page', { type: 'reload' });
  await wait('交付与售后项目总览');
  assert.equal(
    await evaluate('return document.querySelector("[aria-label=交付项目或客户搜索]").value;'),
    first.id,
  );
  check('刷新恢复搜索条件');
  await click('物流与现场');
  await wait('计划日期用于承诺');
  assert.equal(await evaluate(`return ${shell}.projectId();`), first.id);
  check('总览进入当前项目物流详情');
  const logistics = await evaluate(
    'return document.querySelector("app-project-delivery-panel").innerText;',
  );
  for (const label of [
    '计划开始 / 结束',
    '预计日期',
    '实际日期 / 来源',
    '批次 / 产品 / 数量',
    '现场条件',
    '客户验收',
  ])
    assert(logistics.includes(label), label);
  check('物流原有效字段、来源和日期含义完整可见');
  await click('运维与售后');
  await wait('成交服务承诺与采用版本');
  const service = await evaluate(
    'return document.querySelector("app-project-delivery-panel").innerText;',
  );
  for (const label of ['质保', 'SLA', '服务范围', '报价版本', '备件接续', '移交资料与遗留事项'])
    assert(service.includes(label), label);
  check('售后服务快照版本、备件、接收和遗留事项可见');
  const viewed = await evaluate(
    `return {projects:${app}.store.state().projects,events:${app}.store.state().operationEvents};`,
  );
  assert.deepEqual(viewed, initial);
  check('查看和切页签没有产生接收、验收、移交事实');
  await click('在项目区打开同一交付记录');
  assert(
    await evaluate(
      `for(let n=0;n<100;n++){if(location.pathname==='/projects/'+${JSON.stringify(first.id)})return true;await new Promise(r=>setTimeout(r,100));}return false;`,
    ),
  );
  await wait('成交服务承诺与采用版本');
  assert.equal(await evaluate(`return location.pathname;`), '/projects/' + first.id);
  assert.equal(await evaluate(`return ${shell}.projectId();`), first.id);
  assert.deepEqual(await evaluate(`return ${shell}.project().plans;`), first.plans);
  check('项目区复用同一共享组件、项目身份和计划记录');
  await click('返回交付与售后');
  await wait('成交服务承诺与采用版本');
  await click('返回交付总览（保留筛选）');
  await wait('交付与售后项目总览');
  assert.equal(
    await evaluate('return document.querySelector("[aria-label=交付项目或客户搜索]").value;'),
    first.id,
  );
  check('返回总览保留筛选上下文');
  for (const [old, tab, text] of [
    ['/plans/logistics', 'logistics', '计划日期用于承诺'],
    ['/plans/service', 'service', '成交服务承诺与采用版本'],
  ]) {
    await call('navigate_page', {
      url: base + old + '?project=' + first.id + '&source=notice#target',
    });
    await wait(text);
    const location = await evaluate(
      'return {path:location.pathname,tab:new URLSearchParams(location.search).get("tab"),project:new URLSearchParams(location.search).get("project"),hash:location.hash};',
    );
    assert.equal(location.path, '/delivery-service');
    assert.equal(location.tab, tab);
    assert.equal(location.project, first.id);
    assert.equal(location.hash, '#target');
    check('旧链接定位同一项目与页签 ' + old, location);
  }
  await navigate('/delivery-service?tab=logistics&projectId=INVALID', '找不到项目');
  assert.equal(
    await evaluate('return document.querySelectorAll("app-project-delivery-panel").length;'),
    0,
  );
  check('无效项目显示空态且不泄漏其他项目');
  await navigate('/delivery-service?tab=overview&projectId=' + first.id, '未完成任务');
  assert(await evaluate('return !!document.querySelector("main table");'));
  check('原项目计划总览统计、任务和处理入口仍可使用');
  await navigate(
    '/delivery-service?tab=logistics&projectId=' + first.id + '&deliverySearch=' + first.id,
    '计划日期用于承诺',
  );
  await click('维护计划与发运备件');
  await wait('本页直接维护项目已提交计划');
  assert.equal(await evaluate('return location.pathname;'), '/projects/' + first.id);
  check('共享处理按钮进入原项目计划区域');
  await evaluate(
    `const row=[...document.querySelectorAll('main table tbody tr')].find(r=>r.innerText.includes('进行中')&&[...r.querySelectorAll('button')].some(b=>b.textContent.trim()==='编辑'));if(!row)throw new Error('没有可编辑计划');row.querySelector('button').click();return true;`,
  );
  await wait('编辑内部WBS');
  const note = 'DEL03-' + Date.now();
  await evaluate(
    `const d=document.querySelector('[role="dialog"] details');if(d)d.open=true;const e=document.querySelector('[data-field="note"]');e.value=${JSON.stringify(note)};e.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
  );
  await evaluate(
    `const b=[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='保存');b.click();return true;`,
  );
  assert(
    await evaluate(
      `for(let n=0;n<100;n++){if(!document.querySelector('[role="dialog"]'))return ${app}.store.project(${JSON.stringify(first.id)}).plans.some(p=>p.note===${JSON.stringify(note)});await new Promise(r=>setTimeout(r,100));}return false;`,
    ),
  );
  check('通过原计划表单保存同一项目真实记录');
  await click('返回交付与售后');
  await wait('计划日期用于承诺');
  assert.equal(await evaluate(`return ${shell}.projectId();`), first.id);
  assert(
    await evaluate(`return ${shell}.project().plans.some(p=>p.note===${JSON.stringify(note)});`),
  );
  check('保存后返回原交付项目并读取同源记录');
  await call('navigate_page', { type: 'reload' });
  await wait('计划日期用于承诺');
  assert(
    await evaluate(`return ${shell}.project().plans.some(p=>p.note===${JSON.stringify(note)});`),
  );
  check('刷新后同源保存持久化');
  await navigate('/delivery-service', '交付与售后项目总览');
  await call('resize_page', { width: 390, height: 844 });
  const mobile = await evaluate(
    'return {width:innerWidth,body:document.documentElement.scrollWidth};',
  );
  assert(mobile.body <= mobile.width + 1, JSON.stringify(mobile));
  await call('take_screenshot', { filePath: path.join(output, 'mobile.png'), fullPage: true });
  check('移动端整页无横向溢出', mobile);
  const errors = toolText(await call('list_console_messages', { types: ['error'] }));
  assert(!/msgid=/.test(errors), errors);
  check('控制台无错误');
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
  console.log('报告：' + output);
  await connection?.client.close().catch(() => {});
  await connection?.transport.close().catch(() => {});
}
