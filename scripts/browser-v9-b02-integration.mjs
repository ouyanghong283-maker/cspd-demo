import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4313';
const out = path.resolve(root, process.env.CSPD_ARTIFACT_DIR || 'artifacts/v9-b02-integration');
await fs.mkdir(out, { recursive: true });
const c = await connect({ isolated: true });
let pageId;
const checks = [];
const call = (name, args = {}) => c.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  return JSON.parse(raw.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
const open = async (route, text) => {
  await call('navigate_page', { type: 'url', url: base + route });
  await call('wait_for', { text: [text], timeout: 30000 });
};
try {
  const raw = toolText(await c.call('new_page', { url: base + '/projects/board' }));
  pageId = Number(raw.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['高层项目总览'], timeout: 30000 });
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    const result = await evaluate(
      `const main=document.querySelector('main.board-page');return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,mainOverflow:main.scrollWidth>main.clientWidth+1,departments:main.innerText.includes('四部门完整事项'),firstResults:main.innerText.includes('首次定稿成绩')};`,
    );
    assert.equal(result.overflow, false, `文档横向溢出${width}`);
    assert.equal(result.mainOverflow, false);
    assert.equal(result.departments, true);
    assert.equal(result.firstResults, true);
    checks.push({ name: '看板五档宽度', ...result });
    await call('take_screenshot', {
      filePath: path.join(out, `board-${width}.png`),
      fullPage: false,
    });
  }
  await call('resize_page', { width: 1440, height: 1000 });
  const drill = await evaluate(
    `const buttons=[...document.querySelectorAll('app-management-board-charts button')];buttons.find(b=>b.textContent.includes('查看事项')).click();await new Promise(r=>setTimeout(r,100));return {expanded:document.querySelector('app-management-board-charts [aria-expanded="true"]')!==null,details:document.querySelector('[aria-label="部门事项明细"]')!==null};`,
  );
  assert.equal(drill.expanded, true);
  assert.equal(drill.details, true);
  checks.push({ name: '部门明细展开', ...drill });
  const filter = await evaluate(
    `const b=[...document.querySelectorAll('app-management-board-charts button')].find(b=>b.textContent.includes('提前'));b.click();await new Promise(r=>setTimeout(r,100));return {visible:document.querySelector('app-management-board-charts').innerText.includes('当前筛选：首次提前'),empty:document.querySelector('.management-overview').innerText.includes('当前范围没有售前主线')};`,
  );
  assert.equal(filter.visible, true);
  assert.equal(filter.empty, true);
  checks.push({ name: '首次成绩可见筛选', ...filter });
  const cleared = await evaluate(
    `[...document.querySelectorAll('app-management-board-charts button')].find(b=>b.textContent.includes('清除成绩筛选')).click();await new Promise(r=>setTimeout(r,100));return {clear:!document.querySelector('app-management-board-charts').innerText.includes('当前筛选：首次提前'),rows:document.querySelectorAll('[data-business-id]').length};`,
  );
  assert.equal(cleared.clear, true);
  assert.ok(cleared.rows > 0);
  checks.push({ name: '清除恢复清单', ...cleared });
  await open(
    '/projects/DEMO-P001?tab=overview&section=' + encodeURIComponent('预算费用'),
    '预算与模拟费用',
  );
  const budget = await evaluate(
    `return {simulated:document.body.innerText.includes('实际支出为模拟数据'),missing:document.body.innerText.includes('已填部分预算'),source:document.body.innerText.includes('V9'),inputs:document.querySelectorAll('app-budget-expense-panel input,app-budget-expense-panel select').length};`,
  );
  assert.equal(budget.simulated, true);
  assert.equal(budget.missing, true);
  assert.equal(budget.inputs, 0);
  checks.push({ name: '预算只读来源与缺项', ...budget });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['预算与模拟费用'], timeout: 30000 });
  checks.push({ name: '预算页面实际刷新', result: '通过' });
  await open(
    '/projects/DEMO-P001?tab=overview&section=' + encodeURIComponent('业务进度'),
    '固定 21 节点',
  );
  const progress = await evaluate(
    `return {rows:document.querySelectorAll('app-lifecycle-progress-panel tbody tr').length,missing:document.querySelector('app-lifecycle-progress-panel').innerText.includes('数据待补')};`,
  );
  assert.equal(progress.rows, 21);
  assert.equal(progress.missing, true);
  checks.push({ name: '进度明细入口', ...progress });
  await open('/sales/solutions/DEMO-O008', '来源商机');
  const solution = await evaluate(
    `const summary=[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('全流程业务进度'));summary.click();await new Promise(r=>setTimeout(r,100));return {open:summary.parentElement.open,rows:summary.parentElement.querySelectorAll('tbody tr').length};`,
  );
  assert.equal(solution.open, true);
  assert.equal(solution.rows, 21);
  checks.push({ name: '售前进度明细入口', ...solution });
  await fs.writeFile(
    path.join(out, 'browser-report.json'),
    JSON.stringify({ result: '通过', checks }, null, 2),
  );
  console.log(JSON.stringify(checks, null, 2));
} finally {
  await c.client.close();
}
