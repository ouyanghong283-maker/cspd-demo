import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4313';
const output = path.join(root, 'artifacts/v9-visual-contract');
await fs.mkdir(output, { recursive: true });
const c = await connect({ isolated: true });
let pageId;
const checks = [];
const call = (name, args = {}) => c.call(name, { pageId, ...args });
const run = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  return JSON.parse(raw.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
const open = async (route, text) => {
  await call('navigate_page', { type: 'url', url: base + route });
  await call('wait_for', { text: [text], timeout: 30000 });
};
try {
  const p = toolText(await c.call('new_page', { url: base + '/projects/board' }));
  pageId = Number(p.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['高层项目总览'], timeout: 30000 });
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    const data = await run(
      `const root=document.querySelector('.management-overview');const chart=document.querySelector('app-management-board-charts');const b=chart.querySelector('button');return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,bodyFont:getComputedStyle(root).fontSize,titleFont:getComputedStyle(root.querySelector('h1')).fontSize,buttonFont:getComputedStyle(b).fontSize,buttonHeight:b.getBoundingClientRect().height,theme:getComputedStyle(root).colorScheme,tableFont:getComputedStyle(chart.querySelector('td')).fontSize,scrollRegion:!!chart.querySelector('.v9-table-wrap[tabindex="0"]'),legacyScoped:!document.querySelector('main.board-page').classList.contains('v9-reading')};`,
    );
    assert.equal(data.overflow, false, `文档越界${width}`);
    assert.equal(data.buttonFont, '14px');
    assert.equal(data.tableFont, '14px');
    assert.ok(data.buttonHeight >= 40);
    assert.equal(data.theme, 'dark');
    assert.equal(data.legacyScoped, true);
    checks.push(data);
    await call('take_screenshot', {
      filePath: path.join(output, `board-${width}.png`),
      fullPage: false,
    });
  }
  await call('resize_page', { width: 1440, height: 1000 });
  for (const theme of ['dark', 'light']) {
    const contrast = await run(
      `const r=document.querySelector('.management-overview');r.dataset.v9Theme='${theme}';const css=getComputedStyle(r);const bg=css.getPropertyValue('--v9-surface').trim();const ground=css.getPropertyValue('--v9-ground').trim();const selected=css.getPropertyValue('--v9-selected').trim();const luminance=hex=>{const rgb=hex.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const ratio=(a,b)=>{a=luminance(a);b=luminance(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};return {theme:'${theme}',ratios:['ink','muted','accent','success','warning','danger','unknown'].flatMap(token=>[bg,ground,selected].map(background=>({token,background,ratio:ratio(css.getPropertyValue('--v9-'+token).trim(),background)})))};`,
    );
    for (const pair of contrast.ratios)
      assert.ok(pair.ratio >= 4.5, `${theme} ${pair.token} 对比${pair.ratio}`);
    checks.push(contrast);
    await call('take_screenshot', {
      filePath: path.join(output, `theme-${theme}.png`),
      fullPage: false,
    });
  }
  await run(`document.querySelector('.management-overview').dataset.v9Theme='dark';return true;`);
  const focus = await run(
    `const b=document.querySelector('app-management-board-charts button');b.focus();return {focused:document.activeElement===b,outline:getComputedStyle(b).outlineWidth,style:getComputedStyle(b).outlineStyle};`,
  );
  assert.equal(focus.focused, true);
  assert.equal(focus.style, 'solid');
  assert.equal(focus.outline, '3px');
  checks.push({ name: '键盘焦点', ...focus });
  const selected = await run(
    `const b=[...document.querySelectorAll('app-management-board-charts button')].find(b=>b.textContent.includes('提前'));b.click();await new Promise(r=>setTimeout(r,50));return {pressed:b.getAttribute('aria-pressed'),feedback:document.querySelector('app-management-board-charts').innerText.includes('当前筛选：首次提前')};`,
  );
  assert.equal(selected.pressed, 'true');
  assert.equal(selected.feedback, true);
  checks.push({ name: '选中反馈', ...selected });
  await call('emulate', { colorScheme: 'dark' });
  await open(
    '/projects/DEMO-P001?tab=overview&section=' + encodeURIComponent('预算费用'),
    '预算与模拟费用',
  );
  for (const width of [1440, 390]) {
    await call('resize_page', { width, height: 1000 });
    const budget = await run(
      `const r=document.querySelector('app-budget-expense-panel section');const wrap=r.querySelector('.v9-table-wrap');const cell=r.querySelector('.v9-number');return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,theme:getComputedStyle(r).colorScheme,padding:getComputedStyle(r).padding,numberAlign:getComputedStyle(cell).textAlign,localScroll:wrap.scrollWidth>wrap.clientWidth,readonly:r.querySelectorAll('input,select,textarea').length===0};`,
    );
    assert.equal(budget.overflow, false);
    assert.equal(budget.theme, 'light');
    assert.equal(budget.numberAlign, 'right');
    assert.equal(budget.readonly, true);
    if (width === 390) assert.equal(budget.localScroll, true);
    checks.push({ name: '预算面板', ...budget });
    await call('take_screenshot', {
      filePath: path.join(output, `budget-${width}.png`),
      fullPage: false,
    });
  }
  await open(
    '/projects/DEMO-P001?tab=overview&section=' + encodeURIComponent('业务进度'),
    '固定 21 节点',
  );
  const progress = await run(
    `const r=document.querySelector('app-lifecycle-progress-panel section');return {rows:r.querySelectorAll('tbody tr').length,statuses:[...r.querySelectorAll('[data-v9-status]')].every(e=>!!e.textContent.trim()),overflow:document.documentElement.scrollWidth>innerWidth+1,localScroll:r.querySelector('.v9-table-wrap').scrollWidth>r.querySelector('.v9-table-wrap').clientWidth};`,
  );
  assert.equal(progress.rows, 21);
  assert.equal(progress.statuses, true);
  assert.equal(progress.overflow, false);
  assert.equal(progress.localScroll, true);
  checks.push({ name: '进度状态与窄屏', ...progress });
  await call('take_screenshot', {
    filePath: path.join(output, 'progress-390.png'),
    fullPage: false,
  });
  checks.push({ name: '系统深色偏好下业务面板保持明确浅色', result: '通过' });
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify({ result: '通过', checks }, null, 2),
  );
  console.log(JSON.stringify(checks, null, 2));
} finally {
  await c.client.close();
}
