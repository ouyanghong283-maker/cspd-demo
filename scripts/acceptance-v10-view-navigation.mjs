import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
import { base } from './browser-config.mjs';
const output = path.join(
  root,
  'artifacts/v10-02-02',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await fs.mkdir(output, { recursive: true });
const browser = await connect({ isolated: true, prefersReducedMotion: true });
let pageId;
const call = (name, args = {}) => {
  console.log(
    name,
    name === 'wait_for' ? args.text : name === 'navigate_page' ? (args.url ?? args.type) : '',
  );
  return browser.call(name, { pageId, ...args });
};
const evaluate = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async () => { ${body} }` }));
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
  assert.ok(match, raw);
  return JSON.parse(match[1]);
};
const panel = `ng.getComponent(document.querySelector('app-v10-baseline-panel'))`;
const settle = `await new Promise(r=>setTimeout(r,300));`;
const click = async (key) =>
  evaluate(
    `document.querySelector('[data-v10-focus="${key}"]').click(); ${settle} return location.pathname+location.search;`,
  );
const navigate = async (url) => {
  await call('navigate_page', { url: base + url });
  await call('wait_for', { text: ['V10公共基线'], timeout: 30000 });
};
const businessStorage = `JSON.stringify(Object.fromEntries(Object.entries({...localStorage}).filter(([k])=>k!=='cspd-demo-v2:editing-lease').sort(([a],[b])=>a.localeCompare(b))))`;
const results = {};
try {
  const page = toolText(await browser.call('new_page', { url: base + '/projects/board' }));
  pageId = Number(page.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['V10公共基线'], timeout: 30000 });
  const before = await evaluate(
    `return {storage:${businessStorage}, version:${panel}.read.context().dataVersion, scope:${panel}.read.context()};`,
  );
  // 使用真实DOM按钮和链接进入三层；查询返回结果来自公开读取接口。
  await click('expand-projects');
  await evaluate(
    `document.querySelector('[aria-label="验证搜索"]').value='DEMO-P'; document.querySelector('[aria-label="验证搜索"]').dispatchEvent(new Event('change')); ${settle} return true;`,
  );
  const board = await evaluate(
    `return {href:location.pathname+location.search, filters:${panel}.filters()};`,
  );
  await click('finance');
  await call('wait_for', { text: ['当前页签：margin'], timeout: 30000 });
  await evaluate(
    `const s=document.querySelector('[aria-label="币种"]');s.value='CNY';s.dispatchEvent(new Event('change'));${settle} return true;`,
  );
  await click('expand-projects');
  await evaluate(
    `document.querySelector('[aria-label="期间起"]').value='2026-09-01';document.querySelector('[aria-label="期间止"]').value='2026-09-30';[...document.querySelectorAll('button')].find(b=>b.textContent.includes('应用整月期间')).click();${settle} return true;`,
  );
  const finance = await evaluate(
    `const p=${panel}; return {filters:p.filters(),period:p.finance().period,project:p.projectLinks()[0]?.id,href:location.pathname+location.search};`,
  );
  assert.equal(finance.filters.currency, 'CNY');
  assert.deepEqual(
    [finance.period.periodStart, finance.period.periodEnd],
    ['2026-09-01', '2026-09-30'],
  );
  assert.ok(finance.project);
  await evaluate(
    `const a=document.querySelector('[data-v10-focus="${finance.project}"]'); a.focus();a.scrollIntoView();${settle}return true;`,
  );
  const position = await evaluate(
    `return {scrollY:window.scrollY,focus:document.activeElement.getAttribute('data-v10-focus')};`,
  );
  await click(finance.project);
  await call('wait_for', { text: ['财务信息', '返回上一层'], timeout: 30000 });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['返回上一层'], timeout: 30000 });
  const projectHref = await evaluate(`return location.pathname+location.search;`);
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='概览').click();${settle}return true;`,
  );
  await evaluate(
    `const a=[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')==='/projects/DEMO-P002');if(!a)throw Error('未找到关联项目入口');a.click();${settle}return true;`,
  );
  results.projectReuse = await evaluate(
    `return {path:location.pathname,hasOldReturn:!!document.querySelector('app-v10-return [data-v10-focus="return"]')};`,
  );
  assert.equal(results.projectReuse.path, '/projects/DEMO-P002');
  assert.equal(results.projectReuse.hasOldReturn, false, '普通关联项目不能沿用上一项目的返回链');
  await call('navigate_page', { url: base + projectHref });
  await call('wait_for', { text: ['返回上一层'], timeout: 30000 });
  await click('return');
  await call('wait_for', { text: ['当前页签：margin'], timeout: 30000 });
  results.returnedFinance = await evaluate(
    `${settle} return {filters:${panel}.filters(),expanded:${panel}.navigation.view().expanded,focus:document.activeElement.getAttribute('data-v10-focus'),scrollY:window.scrollY,visible:(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()};`,
  );
  assert.equal(results.returnedFinance.filters.currency, 'CNY');
  assert.equal(results.returnedFinance.filters.periodStart, '2026-09-01');
  assert.equal(results.returnedFinance.focus, finance.project);
  assert.equal(results.returnedFinance.visible, true, '恢复的触发元素应在视口内');
  await click('return');
  await call('wait_for', { text: ['当前页签：board'], timeout: 30000 });
  results.returnedBoard = await evaluate(
    `return {filters:${panel}.filters(),expanded:${panel}.navigation.view().expanded};`,
  );
  assert.equal(results.returnedBoard.filters.query, 'DEMO-P');
  assert.deepEqual(results.returnedBoard.expanded, ['projects']);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['当前页签：board'], timeout: 30000 });
  assert.equal(await evaluate(`return ${panel}.filters().query;`), 'DEMO-P');
  // 同上下文显式状态覆盖与清搜索；非法范围有说明。
  await navigate('/projects/board/exceptions?tab=delivery&query=无匹配');
  await click('status-delayed');
  results.status = await evaluate(
    `return {filters:${panel}.filters(),result:${panel}.exceptions()};`,
  );
  assert.equal(results.status.filters.query, '');
  assert.equal(results.status.filters.status, 'delayed');
  assert.ok(results.status.result.delivery.projects.every((p) => p.delivery.status === 'delayed'));
  await navigate(
    '/projects/board/finance?tab=bad&currency=XXX&periodStart=2026-09-02&periodEnd=2026-09-30',
  );
  results.invalid = await evaluate(
    `return {notices:${panel}.navigation.notices(),filters:${panel}.filters()};`,
  );
  assert.equal(results.invalid.filters.tab, 'margin');
  assert.equal(results.invalid.filters.periodStart, '');
  assert.ok(results.invalid.notices.length >= 3);
  // 存储异常不阻断业务；只对sessionStorage故障注入。
  results.storageFailure = await evaluate(
    `const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===sessionStorage) throw Error('quota');return original.call(this,k,v)};try{${panel}.navigation.capture();${settle}return {error:${panel}.navigation.error(),status:${panel}.finance().status,version:${panel}.read.context().dataVersion};}finally{Storage.prototype.setItem=original;}`,
  );
  assert.match(results.storageFailure.error, /可以继续查看/);
  assert.equal(results.storageFailure.status, 'ready');
  assert.equal(results.storageFailure.version, before.version);
  // 触发元素不再存在时，仍恢复原滚动位置。
  await navigate('/projects/board/finance');
  await click('expand-projects');
  results.fallback = await evaluate(
    `const p=${panel};const a=document.querySelector('[data-v10-focus="'+p.projectLinks()[0].id+'"]');a.focus();a.scrollIntoView();const y=window.scrollY;a.setAttribute('data-v10-focus','deleted-trigger');p.navigation.capture();return {y};`,
  );
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['当前页签：margin'], timeout: 30000 });
  results.fallback.actual = await evaluate(`${settle} return window.scrollY;`);
  assert.ok(
    Math.abs(results.fallback.actual - results.fallback.y) < 3,
    JSON.stringify(results.fallback),
  );
  results.visual = await evaluate(
    `const section=document.querySelector('.v10-baseline');return {reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,background:getComputedStyle(section).backgroundColor,text:section.innerText,viewport:{width:innerWidth,height:innerHeight},browser:navigator.userAgent};`,
  );
  assert.equal(results.visual.reduced, true);
  assert.equal(results.visual.background, 'rgb(255, 255, 255)');
  assert.match(results.visual.text, /-1,234.56 EUR/);
  await call('take_screenshot', { filePath: path.join(output, 'baseline.png'), fullPage: true });
  await call('resize_page', { width: 390, height: 844 });
  results.narrow = await evaluate(
    `return {width:innerWidth,overflow:document.querySelector('.v10-baseline').scrollWidth>document.querySelector('.v10-baseline').clientWidth};`,
  );
  assert.equal(results.narrow.overflow, false);
  await call('take_screenshot', { filePath: path.join(output, 'narrow.png'), fullPage: true });
  const after = await evaluate(`return ${businessStorage};`);
  assert.ok(after === before.storage, '业务存储不变（仅排除技术修改租约）');
  const oldFacts = await evaluate(
    `return {facts:JSON.stringify({projects:${panel}.read.snapshot().state.projects,finance:${panel}.read.snapshot().state.financeSnapshots}),scope:${panel}.read.context()};`,
  );
  await call('navigate_page', { url: base + '/control' });
  await call('wait_for', { text: ['演示控制与上手指南'], timeout: 30000 });
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='对比档').click();${settle}return true;`,
  );
  await navigate('/projects/board/exceptions?tab=delivery');
  results.factChange = await evaluate(
    `return {date:${panel}.read.context().dates.planObservationDate,facts:JSON.stringify({projects:${panel}.read.snapshot().state.projects,finance:${panel}.read.snapshot().state.financeSnapshots})};`,
  );
  assert.equal(results.factChange.date, '2026-10-22');
  assert.equal(results.factChange.facts, oldFacts.facts);
  // 实际新轮会同时建立独立工作区，再从旧上下文进入，不能带回旧父链。
  await navigate('/projects/board');
  await click('finance');
  const oldContextHref = await evaluate(
    `return location.pathname+'?contextId='+new URL(location.href).searchParams.get('contextId');`,
  );
  await call('navigate_page', { url: base + '/control' });
  await call('wait_for', { text: ['演示控制与上手指南'], timeout: 30000 });
  const resetSnapshot = toolText(await call('take_snapshot'));
  const resetLine = resetSnapshot
    .split('\n')
    .find((line) => line.includes('button "重置演示数据"'));
  assert.ok(resetLine);
  await call('click', { uid: resetLine.match(/uid=(\S+)/)[1] });
  await call('handle_dialog', { action: 'accept' });
  await navigate(oldContextHref);
  results.isolation = await evaluate(
    `return {scope:${panel}.read.context(),parent:${panel}.navigation.returnHref(),view:${panel}.navigation.view()};`,
  );
  assert.notEqual(results.isolation.scope.workspaceId, oldFacts.scope.workspaceId);
  assert.notEqual(results.isolation.scope.roundId, oldFacts.scope.roundId);
  assert.equal(results.isolation.parent, null);
  assert.deepEqual(results.isolation.view.expanded, []);
  await call('navigate_page', { url: base + '/control' });
  await call('wait_for', { text: ['续接此工作区'], timeout: 30000 });
  // 隔离浏览器只有本次创建的一份归档；通过真实续接按钮恢复旧工作区。
  const resumeSnapshot = toolText(await call('take_snapshot'));
  const resumeLine = resumeSnapshot
    .split('\n')
    .find((line) => line.includes('button "续接此工作区"'));
  assert.ok(resumeLine);
  await call('click', { uid: resumeLine.match(/uid=(\S+)/)[1] });
  await call('handle_dialog', { action: 'accept' });
  await navigate(oldContextHref);
  results.resumed = await evaluate(
    `return {scope:${panel}.read.context(),parent:${panel}.navigation.returnHref()};`,
  );
  assert.equal(results.resumed.scope.workspaceId, oldFacts.scope.workspaceId);
  assert.equal(results.resumed.scope.roundId, oldFacts.scope.roundId);
  assert.ok(results.resumed.parent);
  await call('navigate_page', {
    url:
      base +
      '/projects/V10-NOT-EXISTS?returnContextId=' +
      encodeURIComponent('/projects/board|missing'),
  });
  await call('wait_for', { text: ['没有找到项目'], timeout: 30000 });
  results.missingProject = true;
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        before: { version: before.version, scope: before.scope },
        board,
        finance,
        position,
        results,
        businessStorageUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ output, checks: Object.keys(results), businessStorageUnchanged: true }),
  );
} catch (error) {
  await fs.writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ results, error: String(error) }, null, 2),
  );
  console.error(
    await evaluate('return {url:location.href,body:document.body.innerText.slice(-5000)};'),
  );
  console.error(toolText(await call('list_console_messages')));
  throw error;
} finally {
  await browser.client.close();
  await browser.transport.close();
}
