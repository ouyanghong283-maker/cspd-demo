import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4316';
const out = path.resolve(root, process.env.CSPD_ARTIFACT_DIR || 'artifacts/v9-b06-codex');
const evidence = path.resolve(root, process.env.CSPD_EVIDENCE_DIR || '../docs/verification/v9-b06-codex');
await fs.mkdir(out, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const c = await connect({ isolated: true });
const checks = [];
let pageId;
const run = async (body) => {
  const raw = toolText(await c.call('evaluate_script', { pageId, function: `async()=>{${body}}` }));
  return JSON.parse(raw.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
const b = "ng.getComponent(document.querySelector('app-project-board'))";
try {
  const opened = toolText(await c.call('new_page', { url: base + '/projects/board' }));
  pageId = Number(opened.match(/(\d+):.*\[selected\]/)[1]);
  await c.call('wait_for', { pageId, text: ['重点 TOP5'], timeout: 30000 });
  const contrast = await run(`
    const board=document.querySelector('.management-overview'),s=getComputedStyle(board);
    const rgb=x=>{x=x.trim();return x.startsWith('#')?x.slice(1).match(/../g).map(v=>parseInt(v,16)):x.match(/[0-9.]+/g).slice(0,3).map(Number)};
    const lum=c=>rgb(c).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
    return {body:ratio(s.color,s.backgroundColor),muted:ratio(s.getPropertyValue('--v9-muted'),s.backgroundColor),accent:ratio(s.getPropertyValue('--v9-accent'),s.backgroundColor)};
  `);
  for (const value of Object.values(contrast)) assert.ok(value >= 4.5);
  checks.push({ name: '实际深色正文辅助色和链接对比度', contrast });
  await run(
    `window.b06Snapshot=structuredClone(${b}.store.state());window.b06Raw=JSON.stringify([...Object.entries(localStorage)]);return true;`,
  );
  // 以下只在浏览器内给页面受控长内容，不保存，不冒充真实来源链。
  await run(
    `const x=structuredClone(window.b06Snapshot);x.sales.filter(s=>s.type==='opportunity').forEach(s=>s.projectName='长中文业务名称'.repeat(16));${b}.store.state.set(x);${b}.collaborationOpen.set(true);return true;`,
  );
  await c.call('resize_page', { pageId, width: 390, height: 1000 });
  await run(
    `for(const d of document.querySelectorAll('.solution-summary'))d.open=true;return true;`,
  );
  const long = await run(
    `return {overflow:document.documentElement.scrollWidth>innerWidth+1,localTables:[...document.querySelectorAll('.v9-table-wrap')].every(e=>getComputedStyle(e).overflowX==='auto'),snapshotUnwritten:window.b06Raw===JSON.stringify([...Object.entries(localStorage)])};`,
  );
  assert.deepEqual(long, { overflow: false, localTables: true, snapshotUnwritten: true });
  checks.push({ name: '受控长中文和资料详情手机局部滚动，不写业务快照', ...long });
  await c.call('take_screenshot', {
    pageId,
    filePath: path.join(out, 'reading-long-390.png'),
    fullPage: true,
  });
  await run(
    `const x=structuredClone(window.b06Snapshot);x.sales=[];x.projects=[];${b}.store.state.set(x);return true;`,
  );
  const empty = await run(
    `return {count:${b}.management().businessCount,text:document.querySelector('.management-overview').innerText,overflow:document.documentElement.scrollWidth>innerWidth+1};`,
  );
  assert.equal(empty.count, 0);
  assert.match(empty.text, /尚无业务记录/);
  assert.match(empty.text, /不判断异常数/);
  assert.equal(empty.overflow, false);
  checks.push({ name: '受控全空页面区别于筛选无结果且不判断零异常', count: empty.count });
  await c.call('take_screenshot', {
    pageId,
    filePath: path.join(out, 'reading-empty-390.png'),
    fullPage: true,
  });
  await run(`${b}.store.state.set(window.b06Snapshot);${b}.clearFilters();return true;`);
  const savedView = await run(
    `const old=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('controlled storage failure')};try{${b}.persistView();return {error:${b}.viewError(),snapshotUnwritten:window.b06Raw===JSON.stringify([...Object.entries(localStorage)])}}finally{Storage.prototype.setItem=old}`,
  );
  assert.ok(savedView.error);
  assert.equal(savedView.snapshotUnwritten, true);
  checks.push({ name: '视图存储失败明确提示且业务不变', ...savedView });
  await run(`${b}.persistView();return true;`);
  assert.equal(await run(`return ${b}.viewError();`), null);
  checks.push({ name: '存储恢复后重试保存视图成功' });
  await run(
    `${b}.clearFilters();const button=[...document.querySelectorAll('app-management-board-charts tbody tr:nth-child(3) button')].find(x=>x.textContent.trim()==='筛选部门');button.click();return true;`,
  );
  const mouseIds = await run(`return ${b}.businessIds();`);
  await run(
    `${b}.clearFilters();const button=[...document.querySelectorAll('app-management-board-charts tbody tr:nth-child(3) button')].find(x=>x.textContent.trim()==='筛选部门');button.focus();return true;`,
  );
  assert.ok(mouseIds.length > 0);
  await c.call('press_key', { pageId, key: 'Enter' });
  assert.deepEqual(await run(`return ${b}.businessIds();`), mouseIds);
  checks.push({ name: '鼠标与键盘选择同一图表条件得到相同业务集合', businessIds: mouseIds });
  await fs.writeFile(
    path.join(evidence, 'reading-results.json'),
    JSON.stringify(
      { result: 'passed', source: '受控阅读/错误样例，不替代真实业务联合验收', checks },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(checks, null, 2));
} finally {
  await c.client.close();
}
