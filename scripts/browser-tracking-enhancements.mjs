import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, toolText } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4317';
const out = new URL('../artifacts/tracking-enhancements/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const connection = await connect({ isolated: true });
let pageId;
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const text = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  return JSON.parse(text.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
const checks = [];
try {
  const page = toolText(await connection.call('new_page', { url: base + '/plans/tracking' }));
  pageId = Number(page.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['待处理事项构成'], timeout: 30000 });
  const fixture = await evaluate(`
    const root=ng.getComponent(document.querySelector('app-root'));const s=root.store;
    const state=structuredClone(s.state());state.role='pm';state.dateMode='comparison';
    delete state.projectWarningBackfillVersion;
    for(const p of state.projects)for(const plan of p.plans)delete plan.warningLeadDays;
    state.projects[0].plans[0].warningLeadDays=0;
    state.projects[0].plans[1].warningLeadDays=3;
    const key=s.activeSnapshotKey;const envelope=JSON.parse(localStorage.getItem(key));
    envelope.snapshot=state;localStorage.setItem(key,JSON.stringify(envelope));
    return {count:state.projects.reduce((n,p)=>n+p.plans.length,0)-2,key};
  `);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['待处理事项构成'], timeout: 30000 });
  const loaded = await evaluate(`
    const s=ng.getComponent(document.querySelector('app-root')).store;const ps=s.state().projects;
    return {filled:ps.flatMap(p=>p.plans).filter(p=>p.warningLeadDays===7).length,zero:ps[0].plans[0].warningLeadDays,three:ps[0].plans[1].warningLeadDays,version:s.state().dataVersion,marker:s.state().projectWarningBackfillVersion,
    all:ps.flatMap(p=>p.plans).every(p=>Number.isInteger(p.warningLeadDays))};
  `);
  assert.equal(loaded.filled, fixture.count);
  assert.equal(loaded.zero, 0);
  assert.equal(loaded.three, 3);
  assert.equal(loaded.marker, 1);
  assert(loaded.all);
  checks.push({ name: '刷新后全部8个项目的历史计划补齐，保留0和3天', ...loaded });
  const compare = () =>
    evaluate(`
    const c=ng.getComponent([...document.querySelectorAll('router-outlet')].at(-1).nextElementSibling);
    return {rows:c.trackingRows().length,total:Number(document.querySelector('.donut strong').textContent),figures:document.querySelectorAll('app-tracking-charts figure').length,
    headers:[...document.querySelectorAll('th')].map(e=>e.textContent.trim()),text:document.querySelector('app-tracking-charts').innerText};
  `);
  let chart = await compare();
  assert.equal(chart.rows, chart.total);
  assert.equal(chart.figures, 3);
  assert(chart.headers.includes('预警天数 / 日期'));
  checks.push({ name: '三图与列表同源、预警天数和日期列可见', ...chart });
  await call('take_screenshot', {
    filePath: fileURLToPath(new URL('desktop.png', out)),
    fullPage: true,
  });
  await evaluate(`document.querySelector('.project-row').click();return true;`);
  chart = await compare();
  assert.equal(chart.rows, chart.total);
  assert(
    await evaluate(
      `const c=ng.getComponent([...document.querySelectorAll('router-outlet')].at(-1).nextElementSibling);return !!c.trackingProject()&&c.trackingRows().every(r=>r.project.id===c.trackingProject());`,
    ),
  );
  await evaluate(
    `const b=[...document.querySelectorAll('.legend button')].find(b=>!b.disabled);b.click();return true;`,
  );
  chart = await compare();
  assert.equal(chart.rows, chart.total);
  assert(
    await evaluate(
      `const c=ng.getComponent([...document.querySelectorAll('router-outlet')].at(-1).nextElementSibling);return !!c.status()&&c.trackingRows().every(r=>r.kind===c.status());`,
    ),
  );
  checks.push({ name: '真实点击项目条和风险类别后，图表与列表同步筛选' });
  await evaluate(
    `const c=ng.getComponent([...document.querySelectorAll('router-outlet')].at(-1).nextElementSibling);c.query.set('没有这个项目XYZ');return true;`,
  );
  chart = await compare();
  assert.equal(chart.total, 0);
  assert.equal(chart.rows, 0);
  assert(chart.text.includes('当前筛选下没有待处理事项'));
  checks.push({ name: '搜索空态计数为0，无虚构图柱' });
  await evaluate(
    `const c=ng.getComponent([...document.querySelectorAll('router-outlet')].at(-1).nextElementSibling);c.query.set('');c.status.set('');c.trackingProject.set('');return true;`,
  );
  await call('resize_page', { width: 390, height: 844 });
  const mobile = await evaluate(
    `const e=document.querySelector('app-tracking-charts');const r=e.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,overflow:e.scrollWidth>e.clientWidth};`,
  );
  assert(!mobile.overflow);
  assert(mobile.right <= 390);
  await call('take_screenshot', {
    filePath: fileURLToPath(new URL('mobile.png', out)),
    fullPage: true,
  });
  checks.push({ name: '390px窄屏图表无横向溢出', ...mobile });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['待处理事项构成'], timeout: 30000 });
  assert.equal(
    await evaluate(
      `return ng.getComponent(document.querySelector('app-root')).store.state().dataVersion;`,
    ),
    loaded.version,
  );
  checks.push({ name: '第二次刷新不重复补齐或递增版本' });
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/DEMO-P001?tab='+encodeURIComponent('计划执行'));return true;`,
  );
  await call('wait_for', { text: ['预警天数 / 日期'], timeout: 30000 });
  assert(
    await evaluate(
      `const s=ng.getComponent(document.querySelector('app-root')).store;const p=s.state().projects[0].plans[2];const d=new Date(p.end+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-p.warningLeadDays);const row=document.querySelector('tr[data-plan-id=\"'+p.id+'\"]');return !!row&&row.innerText.includes(d.toISOString().slice(0,10))&&row.innerText.includes('7天');`,
    ),
  );
  checks.push({ name: '项目计划表显示派生预警日期' });
  await fs.writeFile(
    new URL('report.json', out),
    JSON.stringify({ result: '通过', checks }, null, 2),
  );
  console.log(JSON.stringify({ result: '通过', checks: checks.map((c) => c.name) }, null, 2));
} finally {
  await connection.client.close();
  await connection.transport.close();
}
