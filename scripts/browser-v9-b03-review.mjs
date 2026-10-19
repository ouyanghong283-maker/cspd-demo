import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4313';
const out = path.join(root, 'artifacts/v9-b03');
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
  const drill = await run(
    `const chart=document.querySelector('app-management-board-charts');const row=[...chart.querySelectorAll('tbody tr')].find(r=>Number(r.children[1]?.textContent)>0);row.querySelector('button').click();await new Promise(r=>setTimeout(r,100));window.scrollTo(0,900);const target=chart.querySelector('[aria-label="部门事项明细"] a,[data-board-source]');target.click();await new Promise(r=>setTimeout(r,300));return {url:location.href,returnText:document.body.innerText.includes('返回高层项目总览')};`,
  );
  assert.ok(drill.url.includes('returnTo=%2Fprojects%2Fboard'), '图表下钻必须附返回上下文');
  assert.equal(drill.returnText, true);
  checks.push({ name: '审查修复：部门事项实际下钻', ...drill });
  await run(
    `const back=[...document.querySelectorAll('a,button')].find(b=>b.textContent.trim()==='返回高层项目总览');back.click();await new Promise(r=>setTimeout(r,350));return true;`,
  );
  const timeline = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));const s=b.store;const next=structuredClone(s.state());const sale=next.sales.find(s=>s.type==='opportunity');const project=next.projects[0];next.sales=[{...sale,id:'TIMELINE-A',grade:'S',capacity:2,unit:'MW'},{...sale,id:'TIMELINE-B',grade:'S',capacity:1,unit:'MW'}];next.projects=[{...project,id:'PA',opportunityId:'TIMELINE-A',plans:[{...project.plans[0],id:'DA',type:'客户主节点',name:'客户节点A',start:'2026-10-01',end:'2026-10-11',status:'未开始'}]},{...project,id:'PB',opportunityId:'TIMELINE-B',plans:[{...project.plans[0],id:'DB',type:'客户主节点',name:'客户节点B',start:'2026-10-06',end:'2026-10-21',status:'未开始'}]}];s.state.set(next);await new Promise(r=>setTimeout(r,200));return {bars:[...document.querySelectorAll('.time-bar span')].map(e=>({width:e.style.width,left:e.style.marginLeft})),text:document.querySelector('[aria-label="重点TOP5"]').innerText};`,
  );
  assert.deepEqual(timeline.bars, [
    { width: '50%', left: '0%' },
    { width: '75%', left: '25%' },
  ]);
  assert.ok(timeline.text.includes('2026-10-01') && timeline.text.includes('2026-10-21'));
  checks.push({ name: '审查修复：共同时间轴区分10天与15天（隔离输入）', ...timeline });
  if (process.env.CSPD_REDUCED_MOTION === '1') {
    const motion = await run(
      `return {reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:getComputedStyle(document.querySelector('.time-bar span')).animationName,transition:getComputedStyle(document.querySelector('.time-bar span')).transitionDuration};`,
    );
    assert.equal(motion.reduced, true);
    assert.equal(motion.animation, 'none');
    assert.equal(motion.transition, '0s');
    checks.push({ name: '真实浏览器减弱动效偏好', ...motion });
  }
  await fs.writeFile(
    path.join(out, 'review-regressions.json'),
    JSON.stringify({ result: '通过', checks }, null, 2),
  );
  console.log(JSON.stringify(checks, null, 2));
} catch (e) {
  console.error(String(e));
  throw e;
} finally {
  await c.client.close();
}
