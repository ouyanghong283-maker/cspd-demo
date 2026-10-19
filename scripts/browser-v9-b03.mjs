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
const wait = () => new Promise((r) => setTimeout(r, 300));
const open = async (route, text) => {
  await call('navigate_page', { type: 'url', url: base + route });
  await call('wait_for', { text: [text], timeout: 30000 });
};
const screenshot = async (name) =>
  call('take_screenshot', { filePath: path.join(out, name + '.png'), fullPage: false });
try {
  const raw = toolText(await c.call('new_page', { url: base + '/projects/board' }));
  pageId = Number(raw.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['重点 TOP5'], timeout: 30000 });
  for (const route of ['board', 'research', 'fat']) {
    if (route !== 'board')
      await open(
        '/projects/DEMO-P001?tab=plans&plan=' +
          encodeURIComponent(route === 'research' ? '产研来源' : 'FAT测试'),
        route === 'research' ? '产研来源计划' : 'FAT测试与报告',
      );
    for (const width of [1920, 1440, 1024, 768, 390]) {
      await call('resize_page', { width, height: 1000 });
      const data = await run(
        `const r=document.querySelector('${route === 'board' ? '.management-overview' : '.v9-plan-reading'}');return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,localScroll:!!r.querySelector('[role="region"][tabindex="0"]'),text:r.innerText.includes('${route === 'board' ? '可行动异常' : route === 'research' ? '外围来源只读' : '完成条件'}')};`,
      );
      assert.equal(data.overflow, false, route + '页面溢出' + width);
      assert.equal(data.text, true);
      assert.equal(data.localScroll, true);
      checks.push({ name: route + '五宽', ...data });
      if (route !== 'board')
        await run("document.querySelector('.plan-reading-summary').scrollIntoView();return true;");
      await screenshot(route + '-' + width);
    }
    if (route !== 'board') {
      await run(
        "document.querySelector('.v9-plan-reading [role=region]').scrollIntoView();return true;",
      );
      await screenshot(route + '-table-390');
    }
  }
  await call('resize_page', { width: 1440, height: 1000 });
  await open('/projects/board', '重点 TOP5');
  const navigation = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));const input=document.querySelector('.board-filters input:not([type="checkbox"])');input.value='DEMO-O';input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,150));window.scrollTo(0,900);return {dataVersion:b.store.state().dataVersion,events:b.store.state().operationEvents.length,query:b.filters().query};`,
  );
  assert.equal(navigation.query, 'DEMO-O');
  for (const label of ['报价', '方案', '计划', '验收']) {
    const target = await run(
      `const link=[...document.querySelectorAll('.management-overview nav a')].find(a=>a.textContent.trim()==='${label}');if(!link)throw Error('缺少下钻入口');window.scrollTo(0,900);link.click();await new Promise(r=>setTimeout(r,350));return {url:location.href};`,
    );
    console.log('下钻', label, JSON.stringify(target));
    await call('wait_for', { text: ['返回高层项目总览'], timeout: 10000 });
    assert.ok(!target.url.endsWith('/projects/board'));
    const back = await run(
      `const link=[...document.querySelectorAll('a,button')].find(a=>a.textContent.trim()==='返回高层项目总览');link.click();await new Promise(r=>setTimeout(r,500));const b=ng.getComponent(document.querySelector('app-project-board'));return {query:b.filters().query,y:scrollY,events:b.store.state().operationEvents.length,dataVersion:b.store.state().dataVersion};`,
    );
    assert.equal(back.query, 'DEMO-O');
    assert.ok(Math.abs(back.y - 900) < 8, `滚动恢复失败 ${back.y}`);
    assert.equal(back.events, navigation.events);
    assert.equal(back.dataVersion, navigation.dataVersion);
    checks.push({ name: label + '实际下钻返回', target, ...back });
  }
  // 通过公开Store核验原有只读与报告门禁；失败前后快照必须相同。
  await open(
    '/projects/DEMO-P001?tab=plans&plan=' + encodeURIComponent('产研来源'),
    '产研来源计划',
  );
  const readonly = await run(
    `const app=ng.getComponent(document.querySelector('app-root'));const s=app.store;const p=s.project('DEMO-P001');const source=p.plans.find(p=>p.type==='产研来源');const before=JSON.stringify(s.state());const ok=s.savePlan(p.id,{...source,name:'不应保存'});return {ok,unchanged:before===JSON.stringify(s.state()),editButtons:[...document.querySelectorAll('.v9-plan-reading tbody button')].filter(b=>b.textContent.includes('编辑')).length};`,
  );
  assert.equal(readonly.ok, false);
  assert.equal(readonly.unchanged, true);
  assert.equal(readonly.editButtons, 0);
  checks.push({ name: '产研公开保存拒绝且快照不变', ...readonly });
  await open(
    '/projects/DEMO-P001?tab=plans&plan=' + encodeURIComponent('FAT测试'),
    'FAT测试与报告',
  );
  const fat = await run(
    `const app=ng.getComponent(document.querySelector('app-root'));const s=app.store;const p=s.project('DEMO-P001');const source=p.plans.find(p=>p.type==='FAT测试');const before=JSON.stringify(s.state());const has=s.has(p.id,'FAT报告');const ok=s.savePlan(p.id,{...source,status:'已完成',actual:'2026-10-17',result:'合格'});return {has,ok,unchanged:before===JSON.stringify(s.state()),text:document.querySelector('.v9-plan-reading').innerText.includes('报告待补')};`,
  );
  assert.equal(fat.has, false);
  assert.equal(fat.ok, false);
  assert.equal(fat.unchanged, true);
  assert.equal(fat.text, true);
  checks.push({ name: '缺报告完成FAT被拒绝', ...fat });
  const focus = await run(
    `const r=document.querySelector('.v9-plan-reading');const region=r.querySelector('[role="region"]');region.focus();return {focused:document.activeElement===region,outline:getComputedStyle(region).outlineStyle};`,
  );
  assert.equal(focus.focused, true);
  assert.equal(focus.outline, 'solid');
  checks.push({ name: '计划表键盘焦点', ...focus });
  // 在真实FAT表单保存测试结论，再实际刷新核对。
  const edit = await run(
    `const button=[...document.querySelectorAll('.v9-plan-reading tbody button')].find(b=>b.textContent.trim()==='编辑');button.click();await new Promise(r=>setTimeout(r,100));return !!document.querySelector('app-dialog');`,
  );
  assert.equal(edit, true);
  const saved = await run(
    `const values={result:'不合格',status:'进行中',expected:'2026-11-04'};for(const [key,value]of Object.entries(values)){const e=document.querySelector('[data-field="'+key+'"]');e.value=value;e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}document.querySelector('app-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,150));const p=ng.getComponent(document.querySelector('app-root')).store.project('DEMO-P001').plans.find(p=>p.type==='FAT测试');return {result:p.result,expected:p.expected,closed:!document.querySelector('app-dialog')};`,
  );
  assert.equal(saved.result, '不合格');
  assert.equal(saved.expected, '2026-11-04');
  assert.equal(saved.closed, true);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['FAT测试与报告'], timeout: 30000 });
  const refreshed = await run(
    `return document.querySelector('.v9-plan-reading').innerText.includes('不合格') && document.querySelector('.v9-plan-reading').innerText.includes('2026-11-04');`,
  );
  assert.equal(refreshed, true);
  checks.push({ name: 'FAT真实表单保存并刷新', ...saved, refreshed });
  // 第二标签页的租约只读路径。
  const originalPage = pageId;
  const readRaw = toolText(
    await c.call('new_page', {
      url: base + '/projects/DEMO-P001?tab=plans&plan=' + encodeURIComponent('FAT测试'),
    }),
  );
  pageId = Number(readRaw.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['FAT测试与报告'], timeout: 30000 });
  const lease = await run(
    `const s=ng.getComponent(document.querySelector('app-root')).store;const before=JSON.stringify(s.state());const p=s.project('DEMO-P001');const plan=p.plans.find(p=>p.type==='FAT测试');const ok=s.savePlan(p.id,{...plan,note:'只读不应保存'});return {writable:s.editingWritable(),ok,unchanged:before===JSON.stringify(s.state()),disabled:[...document.querySelectorAll('.v9-plan-reading tbody button')].filter(b=>b.textContent.trim()==='编辑').every(b=>b.disabled)};`,
  );
  assert.equal(lease.writable, false);
  assert.equal(lease.ok, false);
  assert.equal(lease.unchanged, true);
  assert.equal(lease.disabled, true);
  checks.push({ name: '实际第二标签页只读保护', ...lease });
  await c.call('close_page', { pageId });
  pageId = originalPage;
  await c.call('select_page', { pageId });
  // 产研长字段与空态仅为隔离浏览器输入，不写入业务快照。
  await open(
    '/projects/DEMO-P001?tab=plans&plan=' + encodeURIComponent('产研来源'),
    '产研来源计划',
  );
  await call('resize_page', { width: 390, height: 1000 });
  const long = await run(
    `const s=ng.getComponent(document.querySelector('app-root')).store;const next=structuredClone(s.state());const p=next.projects.find(p=>p.id==='DEMO-P001');p.plans.find(p=>p.type==='产研来源').sourceReference='非常长的产研来源引用'.repeat(30);p.plans.find(p=>p.type==='产研来源').sourceUpdatedAt='';s.state.set(next);await new Promise(r=>setTimeout(r,150));return {overflow:document.documentElement.scrollWidth>innerWidth+1,missing:document.querySelector('.v9-plan-reading').innerText.includes('更新时间待补')};`,
  );
  assert.equal(long.overflow, false);
  assert.equal(long.missing, true);
  checks.push({ name: '产研长字段及缺更新时间（隔离输入）', ...long });
  await screenshot('research-long-390');
  const empty = await run(
    `const s=ng.getComponent(document.querySelector('app-root')).store;const next=structuredClone(s.state());const p=next.projects.find(p=>p.id==='DEMO-P001');p.plans=p.plans.filter(p=>p.type!=='产研来源');p.productionApplicable=true;s.state.set(next);await new Promise(r=>setTimeout(r,100));return document.querySelector('.v9-plan-reading').innerText.includes('来源计划待补');`,
  );
  assert.equal(empty, true);
  checks.push({ name: '产研空态不当已完成（隔离输入）', pass: empty });
  await open('/projects/board', '重点 TOP5');
  await call('resize_page', { width: 390, height: 1000 });
  // 图表10-03的固定输入验证，不冒称预算真实来源整合。
  const staticChart =
    await run(`const chart=ng.getComponent(document.querySelector('app-management-board-charts'));chart.currency=()=> 'EUR';chart.budgets=()=>[
 {projectId:'STATIC-EUR',currency:'EUR',scope:'全项目',cutoff:'2026-10-17',budgetMinor:10000,expenseMinor:11000,budgetText:'EUR 100.00',expenseText:'EUR 110.00',comparable:true,executionPercent:110,reason:null},
 {projectId:'STATIC-UNKNOWN',currency:'EUR',scope:null,cutoff:null,budgetMinor:null,expenseMinor:null,budgetText:'待补',expenseText:'待补',comparable:false,executionPercent:null,reason:'范围待核'}];ng.applyChanges(chart);const text=document.querySelector('app-management-board-charts').innerText;const row=[...document.querySelectorAll('app-management-board-charts tr')].find(tr=>tr.textContent.includes('STATIC-UNKNOWN'));return {known:text.includes('110%')&&text.includes('EUR 100.00'),unknownNoMeter:!row.querySelector('meter'),overflow:document.documentElement.scrollWidth>innerWidth+1};`);
  assert.equal(staticChart.known, true);
  assert.equal(staticChart.unknownNoMeter, true);
  assert.equal(staticChart.overflow, false);
  checks.push({ name: '图表固定EUR可比与未知输入', ...staticChart });
  await run("document.querySelector('app-management-board-charts').scrollIntoView();return true;");
  await screenshot('chart-static-eur-390');
  await open('/projects/board', '重点 TOP5');
  const keyboard = await run(
    `const b=[...document.querySelectorAll('app-management-board-charts button')].find(b=>b.textContent.includes('筛选部门'));b.focus();return {outline:getComputedStyle(b).outlineStyle,focused:document.activeElement===b};`,
  );
  await call('press_key', { key: 'Enter' });
  await wait();
  const pressed = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));return {department:b.filters().departments[0],visible:document.querySelector('.management-overview').innerText.includes('部门：')};`,
  );
  assert.equal(keyboard.focused, true);
  assert.equal(keyboard.outline, 'solid');
  assert.ok(pressed.department);
  assert.equal(pressed.visible, true);
  checks.push({ name: '图表真实Enter键筛选', ...keyboard, ...pressed });
  const noMatch = await run(
    `const input=document.querySelector('.board-filters input:not([type="checkbox"])');input.value='不存在的业务999';input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));return document.querySelector('.management-overview').innerText.includes('当前组合筛选无匹配业务');`,
  );
  assert.equal(noMatch, true);
  checks.push({ name: '无匹配与来源待补区分', pass: noMatch });
  const storageError = await run(
    `const scope=ng.getComponent(document.querySelector('app-project-board')).store.v9CommandTarget();const key='cspd:v9:board-view:'+JSON.stringify([scope.workspaceId,scope.roundId,'/projects/board']);sessionStorage.setItem(key,'{');return true;`,
  );
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['无法恢复浏览位置'], timeout: 30000 });
  checks.push({ name: '真实会话视图损坏可解释恢复', pass: storageError });
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify({ result: '通过', checks }, null, 2),
  );
  console.log(JSON.stringify(checks, null, 2));
} catch (error) {
  await fs.writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify({ error: String(error), checks }, null, 2),
  );
  throw error;
} finally {
  await c.client.close();
}
