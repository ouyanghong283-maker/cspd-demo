import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4316';
const out = path.join(root, 'artifacts/board-optimization');
await fs.mkdir(out, { recursive: true });
const c = await connect({ isolated: true });
let pageId;
const checks = [];
const call = (name, args = {}) => c.call(name, { pageId, ...args });
const run = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  return JSON.parse(raw.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
try {
  const raw = toolText(await c.call('new_page', { url: base + '/projects/board' }));
  pageId = Number(raw.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['重点 TOP5'], timeout: 30000 });
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    const r = await run(
      `const p=document.querySelector('.priority-grid');return {width:innerWidth,priorityY:p.getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth+1,advancedOpen:document.querySelector('.advanced-filters')?.open,collaborationOpen:document.querySelector('.collaboration-details')?.open,headings:document.querySelectorAll('h1').length};`,
    );
    assert.equal(r.overflow, false);
    assert.ok(r.priorityY < 900, JSON.stringify(r));
    assert.equal(r.advancedOpen, false);
    assert.equal(r.collaborationOpen, false);
    assert.equal(r.headings, 1);
    checks.push({ name: '五宽首屏重点及层级', ...r });
    await call('take_screenshot', {
      filePath: path.join(out, 'after-' + width + '.png'),
      fullPage: false,
    });
  }
  await call('resize_page', { width: 1440, height: 1000 });
  const initial = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));return {snapshot:JSON.stringify(b.store.state()),events:b.store.state().operationEvents.length,version:b.store.state().dataVersion,summary:b.exceptionSummary(),count:b.actionableExceptions().length};`,
  );
  assert.equal(
    initial.summary.reduce((n, g) => n + g.count, 0),
    initial.count,
  );
  checks.push({ name: '异常分类数等于事项数', count: initial.count, summary: initial.summary });
  // 原生summary真实Enter，检验隐藏控件不占初始阅读面积。
  await run(`document.querySelector('.advanced-filters summary').focus();return true;`);
  await call('press_key', { key: 'Enter' });
  const advanced = await run(
    `return {open:document.querySelector('.advanced-filters').open,focused:document.activeElement.tagName};`,
  );
  assert.equal(advanced.open, true);
  checks.push({ name: '高级条件真实键盘展开', ...advanced });
  const chosen = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));const selected=b.management().businesses.find(x=>x.partition==='execution');const sale=b.store.sale(selected.businessId);const form=document.querySelector('.board-filters');const select=(label,value)=>{const e=[...form.querySelectorAll('label')].find(e=>e.textContent.trim().startsWith(label)).querySelector('select');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));};select('等级',sale.grade);select('预算币种','EUR');const input=form.querySelector('input:not([type=checkbox])');input.value=sale.id;input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));return {id:sale.id,grade:sale.grade,businesses:b.management().businesses.map(x=>x.businessId),projectIds:b.management().projects.map(x=>x.projectId),groupIds:b.groups().map(x=>x.project.id),count:b.collaborationCount(),items:b.groups().reduce((n,g)=>n+g.items.length,0),currency:b.currency()};`,
  );
  assert.deepEqual(chosen.businesses, [chosen.id]);
  assert.deepEqual(chosen.groupIds.sort(), chosen.projectIds.sort());
  assert.equal(chosen.count, chosen.items);
  assert.equal(chosen.currency, 'EUR');
  checks.push({ name: '组合筛选与协作明细同源', ...chosen });
  await run(
    `document.querySelector('.filter-chip[aria-label^="清除关键字"]').focus();return true;`,
  );
  await call('press_key', { key: 'Enter' });
  await new Promise((r) => setTimeout(r, 150));
  const cleared = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));return {query:b.filters().query,grade:b.filters().grades,currency:b.currency(),focus:document.activeElement.getAttribute('aria-label')};`,
  );
  assert.equal(cleared.query, '');
  assert.deepEqual(cleared.grade, [chosen.grade]);
  assert.equal(cleared.currency, 'EUR');
  assert.match(cleared.focus, /清除/);
  checks.push({ name: '键盘逐项清除保留其他约束并恢复焦点', ...cleared });
  await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));b.clearFilters();document.querySelector('.collaboration-details').open=true;return true;`,
  );
  await new Promise((r) => setTimeout(r, 100));
  const opened = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));return {advanced:b.advancedOpen(),collaboration:b.collaborationOpen(),currency:b.currency()};`,
  );
  assert.equal(opened.advanced, true);
  assert.equal(opened.collaboration, true);
  assert.equal(opened.currency, 'CNY');
  checks.push({ name: '全部清除不突然折叠正在使用的明细', ...opened });
  // 从真实来源链接下钻；保留高级/协作展开、滚动和分区。
  const saved = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));b.section.set('execution');window.scrollTo(0,650);document.querySelector('.priority-item a').click();await new Promise(r=>setTimeout(r,400));return {url:location.href};`,
  );
  assert.ok(!saved.url.endsWith('/projects/board'));
  await call('wait_for', { text: ['返回高层项目总览'], timeout: 10000 });
  await run(
    `const link=[...document.querySelectorAll('a,button')].find(e=>e.textContent.trim()==='返回高层项目总览');link.click();return true;`,
  );
  await call('wait_for', { text: ['重点 TOP5'], timeout: 10000 });
  await new Promise((r) => setTimeout(r, 200));
  const back = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));return {advanced:b.advancedOpen(),collaboration:b.collaborationOpen(),section:b.section(),y:scrollY,unchanged:JSON.stringify(b.store.state())===${JSON.stringify(initial.snapshot)}};`,
  );
  assert.equal(back.advanced, true);
  assert.equal(back.collaboration, true);
  assert.equal(back.section, 'execution');
  assert.ok(Math.abs(back.y - 650) < 12);
  assert.equal(back.unchanged, true);
  checks.push({ name: '真实下钻返回展开分区滚动及快照不变', ...back });
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    const r = await run(
      `return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,scroll:!!document.querySelector('.management-overview [role=region][tabindex="0"]')};`,
    );
    assert.equal(r.overflow, false);
    assert.equal(r.scroll, true);
    checks.push({ name: '高级筛选与协作明细展开五宽', ...r });
  }
  const noMatch = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));b.change('query','不存在的主线0000');await new Promise(r=>setTimeout(r,100));return {businesses:b.management().businessCount,groups:b.groups().length,count:b.collaborationCount(),text:document.querySelector('.management-overview').innerText};`,
  );
  assert.equal(noMatch.businesses, 0);
  assert.equal(noMatch.groups, 0);
  assert.equal(noMatch.count, 0);
  assert.match(noMatch.text, /当前组合筛选无匹配/);
  checks.push({ name: '无匹配不残留未筛选协作项目', passed: true });
  // 受控异常输入：仅关联待核，不得出现空白可行动异常区。
  const pendingOnly = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));const before=b.store.state();const next=structuredClone(before);next.sales=[];next.projects=[{...next.projects[0],opportunityId:'UNKNOWN'}];b.clearFilters();b.store.state.set(next);await new Promise(r=>setTimeout(r,100));const result={pending:b.management().pendingReviewCount,actionable:b.actionableExceptions().length,text:document.querySelector('[aria-label="可行动异常"]').innerText};b.store.state.set(before);return result;`,
  );
  assert.equal(pendingOnly.pending, 1);
  assert.equal(pendingOnly.actionable, 0);
  assert.match(pendingOnly.text, /当前范围无可核实业务/);
  checks.push({ name: '受控仅关联待核有明确异常空态', ...pendingOnly });
  const completed = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));const fixture=structuredClone(b.store.state());const p=fixture.projects[0];const sale=fixture.sales.find(s=>s.id===p.opportunityId);sale.departmentTasks=[{id:'BOARD-REVIEW-T',name:'审查用部门事项',department:'销售',status:'待开始'}];b.store.state.set(fixture);b.clearFilters();const before=b.collaborationCount();const ok=b.store.completeDepartmentTask(sale.id,'BOARD-REVIEW-T');await new Promise(r=>setTimeout(r,100));return {ok,before,after:b.collaborationCount(),completedInPending:b.groups().flatMap(g=>g.items).filter(i=>i.status==='completed').length,completedInStatistics:b.statistics().items.filter(i=>i.sourceRecordId===sale.id+':BOARD-REVIEW-T'&&i.status==='completed').length};`,
  );
  assert.equal(completed.ok, true);
  assert.equal(completed.completedInPending, 0);
  assert.equal(completed.after, completed.before - 1);
  assert.equal(completed.completedInStatistics, 1);
  checks.push({ name: '受控部门事项经公开完成命令后只退出待办，完整事项仍保留', ...completed });
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify({ status: 'passed', checks }, null, 2),
  );
  console.log(JSON.stringify({ status: 'passed', checks }, null, 2));
} catch (e) {
  await fs.writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify({ error: String(e), checks }, null, 2),
  );
  throw e;
} finally {
  await c.client.close();
  await c.transport.close();
}
