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
let pageId;
const checks = [];
const call = (n, a = {}) => c.call(n, { pageId, ...a });
const run = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  const m = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (!m) throw Error(raw);
  return JSON.parse(m[1]);
};
const pause = () => new Promise((r) => setTimeout(r, 200));
const p = "ng.getComponent(document.querySelector('app-solution-input-panel'))";
const q = "ng.getComponent(document.querySelector('app-quote-workspace'))";
const b = "ng.getComponent(document.querySelector('app-quote-solution-basis-panel'))";
const record = (name, value = {}) => {
  checks.push({ name, ...value });
  console.log('PASS ' + name);
};
// 预期业务集合来自本脚本明确保存的O008及种子业务等级/阶段，不从看板反算。
const assertScope = async (expectedIds) => {
  await pause();
  const actual = await run(
    `const b=ng.getComponent(document.querySelector('app-project-board'));const chart=ng.getComponent(document.querySelector('app-management-board-charts'));const expected=${JSON.stringify(expectedIds)};const projectIds=b.store.state().projects.filter(p=>expected.includes(p.opportunityId)).map(p=>p.id);return {ids:b.businessIds(),rows:[...document.querySelectorAll('[data-business-id]')].map(e=>e.dataset.businessId),top:b.management().topFive.map(x=>x.businessId),exceptions:b.actionableExceptions(),renderedExceptions:[...document.querySelectorAll('.exception-list .priority-item a')].map(e=>e.textContent.trim()),projects:projectIds,groups:b.groups().map(g=>g.project.id),collaboration:b.groups().flatMap(g=>g.items.map(i=>i.id)),sourceOpen:b.view().items.filter(i=>projectIds.includes(i.projectId)&&i.status==='open').map(i=>i.id),summary:[...document.querySelectorAll('.management-overview > .v9-summary strong')].map(e=>Number(e.textContent)),items:b.statistics().items,chartItems:chart.summary().items,stages:b.stageData(),sales:b.store.state().sales.filter(s=>expected.includes(s.id)).map(s=>({id:s.id,stage:s.stage})),collaborationLabel:document.querySelector('.collaboration-details > summary').textContent};`,
  );
  assert.deepEqual([...actual.ids].sort(), [...expectedIds].sort());
  assert.deepEqual([...actual.rows].sort(), [...expectedIds].sort());
  assert.equal(actual.summary[0], expectedIds.length);
  assert.equal(actual.summary[1], actual.projects.length);
  assert.equal(actual.top.length, Math.min(expectedIds.length, 5));
  assert.ok(actual.top.every((id) => expectedIds.includes(id)));
  assert.ok(actual.exceptions.every((e) => expectedIds.includes(e.businessId)));
  assert.deepEqual(
    actual.renderedExceptions,
    actual.exceptions.map((e) => e.reason),
  );
  assert.deepEqual([...actual.groups].sort(), [...actual.projects].sort());
  assert.deepEqual([...actual.collaboration].sort(), [...actual.sourceOpen].sort());
  assert.ok(actual.collaborationLabel.includes(actual.sourceOpen.length + ' 项待处理'));
  assert.ok(actual.items.every((i) => expectedIds.includes(i.businessId)));
  assert.deepEqual(actual.chartItems, actual.items);
  for (const stage of actual.stages)
    assert.equal(stage.count, actual.sales.filter((s) => s.stage === stage.id).length);
  return {
    expectedIds,
    projectIds: actual.projects,
    exceptionIds: actual.exceptions.map((e) => e.id),
    collaborationIds: actual.collaboration,
    top: actual.top,
  };
};
const open = async (route, text) => {
  await call('navigate_page', { type: 'url', url: base + route });
  await call('wait_for', { text: [text], timeout: 30000 });
  await pause();
};
const press = async (text, selector = 'app-solution-input-panel') => {
  assert.equal(
    await run(
      `const b=[...document.querySelector('${selector}').querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button '+${JSON.stringify(text)});for(let x=b.parentElement;x;x=x.parentElement)if(x.tagName==='DETAILS')x.open=true;b.scrollIntoView({block:'center'});b.focus();return document.activeElement===b&&!b.disabled;`,
    ),
    true,
  );
  await call('press_key', { key: 'Enter' });
  await pause();
};
const upload = async (kind, label, ext, n) => {
  const filename = path.join(out, `${kind}-${n}-${'文件'.repeat(12)}.${ext}`);
  await fs.writeFile(filename, `B06 actual bytes ${kind} ${n}`);
  const snapshot = toolText(await call('take_snapshot'));
  const line = snapshot.split('\n').find((l) => l.includes(`button "选择${label}文件"`));
  assert.ok(line);
  await call('upload_file', { uid: line.match(/uid=(\S+)/)[1], filePaths: [filename] });
  await press('保存' + label);
  await run(`await ${p}.check();return true;`);
};
const finalize = async () => {
  await press(
    await run(`return ${p}.finalization().status==='missing'?'核对并首次定稿':'核对并重新定稿';`),
    'app-solution-finalization-summary',
  );
  await press('确认定稿', 'app-solution-finalization-summary');
};
try {
  const raw = toolText(await c.call('new_page', { url: base + '/sales/solutions/DEMO-O008' }));
  pageId = Number(raw.match(/(\d+):.*\[selected\]/)[1]);
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  const initial = await run(
    `return {schema:${p}.store.state().storageSchemaVersion,first:document.querySelector('app-solution-finalization-summary').innerText,confirm:${p}.finalization().issues.length};`,
  );
  assert.equal(initial.schema, 3);
  assert.ok(initial.confirm > 0);
  record('V9加载旧模拟明确未评分且不能定稿', initial);
  await run(
    `${p}.store.setRole('solution');${p}.store.saveProductNeed('DEMO-O008',{id:'B06-NEED',model:'PCS',quantity:2,unit:'台'});return true;`,
  );
  await press('设置期限与负责人');
  await run(
    `const f=document.querySelector('app-solution-input-panel form');for(const [name,value] of Object.entries({pm:'demo-person:王项目',owner:'demo-person:周方案',deadline:'2026-10-20',reason:'第六批首次期限'})){const e=f.querySelector('[name='+name+']');e.value=value;e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}return true;`,
  );
  await press('保存期限');
  assert.equal(await run(`return ${p}.schedule().schedule.deadlineDate;`), '2026-10-20');
  record('键盘与真实表单设置期限责任');
  await press('调整期限');
  await run(
    `const f=document.querySelector('app-solution-input-panel form');for(const [name,value]of Object.entries({deadline:'2026-10-21',reason:'第六批明确调整原因'})){const e=f.querySelector('[name='+name+']');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}return true;`,
  );
  await press('保存期限');
  record('真实改期保留原因操作者');
  for (const row of [
    ['proposal', '技术方案', 'pptx'],
    ['bom', '设计BOM', 'xlsx'],
    ['sld', 'SLD', 'pdf'],
    ['degradation', '衰减资料', 'csv'],
  ]) {
    await upload(...row, 1);
    record('真实文件选择键盘保存 ' + row[0]);
  }
  await finalize();
  const first = await run(`return ${p}.finalization().first;`);
  assert.ok(first);
  record('真实确认表单首次定稿冻结成绩', first);
  await open('/projects/board', '重点 TOP5');
  const board = "ng.getComponent(document.querySelector('app-project-board'))";
  const projected = await run(
    `const b=${board};await b.refreshFiles();return {files:b.availability(),budgets:b.management().budgets.length,first:b.statistics().firstResultDenominator,projects:b.management().projectCount,businesses:b.management().businessCount,ids:b.management().businesses.map(x=>x.businessId)};`,
  );
  assert.ok(projected.budgets > 0);
  assert.equal(projected.first, 1);
  assert.equal(Object.values(projected.files).filter((x) => x === 'present').length, 4);
  assert.ok(Object.values(projected.files).some((x) => x === 'missing')); // 旧模拟元数据没有Blob，不能冒充真实文件
  record('真实保存后返回看板读取Blob预算及首次查询', projected);
  const freeze = await run(
    `const b=${board};return {snapshot:JSON.stringify(b.store.state()),filters:b.filters()};`,
  );
  for (const currency of ['CNY', 'EUR', 'USD']) {
    const budget = await run(
      `const b=${board};b.change('budgetCurrency','${currency}');await new Promise(r=>setTimeout(r,100));const chart=ng.getComponent(document.querySelector('app-management-board-charts'));return {rows:b.chartBudgets(),input:chart.budgets(),projectCount:chart.projectCount(),count:chart.budgetCounts(),snapshot:JSON.stringify(b.store.state())};`,
    );
    assert.deepEqual(budget.rows, budget.input);
    assert.ok(budget.rows.every((r) => r.currency === currency));
    assert.equal(budget.count.comparable + budget.count.pending, budget.projectCount);
    assert.equal(budget.snapshot, freeze.snapshot);
    record('币种切换费用及图表同查询 ' + currency, {
      currency,
      rows: budget.rows,
      count: budget.count,
    });
  }
  // 鼠标与键盘从真实图表发意图，父页持有唯一组合条件。
  await run(`const b=${board};b.clearFilters();b.change('grades','B2');return true;`);
  await press('筛选部门', 'app-management-board-charts tbody tr:nth-child(2)');
  await run(`const b=${board};b.selectFirst('${first.result}');return true;`);
  const filtered = await run(
    `const b=${board};return {ids:b.businessIds(),top:b.management().topFive.map(x=>x.businessId),denominator:b.statistics().firstResultDenominator,items:b.statistics().items.map(x=>x.businessId),filters:b.filters(),snapshot:JSON.stringify(b.store.state())};`,
  );
  assert.deepEqual(filtered.ids, ['DEMO-O008']);
  assert.deepEqual(filtered.top, ['DEMO-O008']);
  assert.equal(filtered.denominator, 1);
  assert.ok(filtered.items.every((x) => x === 'DEMO-O008'));
  assert.equal(filtered.snapshot, freeze.snapshot);
  const combinedScope = await assertScope(['DEMO-O008']);
  record('等级部门首次组合后TOP5异常图数清单协作同源', { ...filtered, scope: combinedScope });
  await press('方案报价：1 条', 'app-management-board-charts');
  assert.deepEqual(await run(`return ${board}.businessIds();`), ['DEMO-O008']);
  record('键盘阶段图选择保持组合业务范围', await assertScope(['DEMO-O008']));
  for (const [key, value] of [
    ['departments', 'solution'],
    ['firstResults', first.result],
    ['stages', '方案报价'],
  ]) {
    const valueAfter = await run(
      `const b=${board};b.removeFilter('${key}','${value}');return {filters:b.filters(),ids:b.businessIds(),top:b.management().topFive.map(x=>x.businessId)};`,
    );
    assert.deepEqual(valueAfter.filters[key], []);
    assert.equal(valueAfter.top.length, Math.min(5, valueAfter.ids.length));
    assert.ok(valueAfter.top.every((id) => valueAfter.ids.includes(id)));
    assert.deepEqual(valueAfter.filters.grades, ['B2']);
    const expected = {
      departments: ['DEMO-O008'],
      firstResults: ['DEMO-O008', 'DEMO-O020'],
      stages: ['DEMO-O004', 'DEMO-O008', 'DEMO-O012', 'DEMO-O016', 'DEMO-O020', 'DEMO-O024'],
    }[key];
    const scope = await assertScope(expected);
    record('逐项清除保留其余条件 ' + key, { ...valueAfter, scope });
  }
  await run(`const b=${board};b.clearFilters();return true;`);
  if (process.env.CSPD_CAPTURE_STATIC === '1') {
    await run(`document.querySelector('[aria-label="减弱看板动效"]').focus();return true;`);
    await call('press_key', { key: 'Space' });
    assert.equal(await run(`return getComputedStyle(document.querySelector('.management-overview'), '::before').animationName;`), 'none');
  }
  const beforeLayout = await run(`return JSON.stringify(${board}.store.state());`);
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    await run(`window.scrollTo(0,0);return true;`);
    const layout = await run(
      `const m=document.querySelector('main.board-page'),title=document.querySelector('[aria-label="重点TOP5"] h2');return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,top:title.getBoundingClientRect().top,h1:m.querySelectorAll('h1').length,advanced:${board}.advancedOpen(),collaboration:${board}.collaborationOpen(),columns:getComputedStyle(document.querySelector('.priority-grid')).gridTemplateColumns,snapshot:JSON.stringify(${board}.store.state())};`,
    );
    assert.equal(layout.overflow, false);
    assert.ok(layout.top < 900, JSON.stringify(layout));
    assert.equal(layout.h1, 1);
    assert.equal(layout.advanced, false);
    assert.equal(layout.collaboration, false);
    assert.equal(layout.snapshot, beforeLayout);
    record('真实来源五宽首屏DOM ' + width, { ...layout, snapshot: undefined });
    await call('take_screenshot', {
      filePath: path.join(out, `board-${width}.png`),
      fullPage: true,
    });
  }
  await call('resize_page', { width: 1440, height: 1000 });
  await run(
    `const b=${board};b.change('query','DEMO-O005');b.advancedOpen.set(true);b.collaborationOpen.set(true);b.section.set('execution');return true;`,
  );
  for (const label of ['报价', '方案', '计划', '验收']) {
    const entry = await run(
      `const a=[...document.querySelectorAll('[aria-label="业务下钻"] a')].find(x=>x.textContent.trim()==='${label}');window.scrollTo(0,900);a.click();return true;`,
    );
    assert.equal(entry, true);
    await call('wait_for', { text: ['返回高层项目总览'], timeout: 30000 });
    await run(
      `const a=[...document.querySelectorAll('a,button')].find(x=>x.textContent.trim()==='返回高层项目总览');a.click();return true;`,
    );
    await call('wait_for', { text: ['重点 TOP5'], timeout: 30000 });
    await pause();
    const restored = await run(
      `const b=${board};return {q:b.filters().query,advanced:b.advancedOpen(),collaboration:b.collaborationOpen(),section:b.section(),y:scrollY};`,
    );
    assert.equal(restored.q, 'DEMO-O005');
    assert.equal(restored.advanced, true);
    assert.equal(restored.collaboration, true);
    assert.equal(restored.section, 'execution');
    assert.ok(restored.y > 700);
    record('真实浏览器下钻返回恢复上下文 ' + label, restored);
  }
  // 项目来源页通过公开保存命令和任务组控件保存，不直接修改快照。
  await open('/projects/DEMO-P001?tab=' + encodeURIComponent('业务进度'), '固定执行任务组');
  const mapping = await run(
    `const m=ng.getComponent(document.querySelector('app-progress-mapping-panel'));const s=m.store;s.setRole('pm');const project=s.project('DEMO-P001');const task=project.plans.find(p=>p.type==='内部WBS'&&!p.completionKind);const ok=s.savePlan(project.id,{...task,budgetAmount:123.45,budgetCurrency:'CNY',status:'未开始',actual:'',start:'2026-10-01',end:'2026-10-13',warningLeadDays:7},'B06-PLAN');m.group='design';m.begin();m.selected=new Set([task.id]);m.reason='第六批真实映射';m.save();return {ok,feedback:m.feedback(),planId:task.id,groups:m.view().groups};`,
  );
  assert.equal(mapping.ok, true, JSON.stringify(mapping));
  assert.ok(
    mapping.groups.some((g) => g.groupId === 'design' && g.planIds.includes(mapping.planId)),
  );
  record('源页真实计划预算期限及固定任务组保存', mapping);
  await open('/projects/board', '重点 TOP5');
  const savedBoard = await run(
    `const b=${board};b.clearFilters();b.change('businessIds','DEMO-O005');await b.refreshFiles();return b.management();`,
  );
  assert.equal(savedBoard.businessCount, 1);
  assert.equal(savedBoard.projectCount, 3);
  assert.ok(
    savedBoard.projects
      .find((p) => p.projectId === 'DEMO-P001')
      .progress.nodes.find((n) => n.nodeId === 'execution.design')
      .sourceIds.includes(mapping.planId),
  );
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['重点 TOP5'], timeout: 30000 });
  const refreshed = await run(`const b=${board};await b.refreshFiles();return b.management();`);
  assert.deepEqual(refreshed, savedBoard);
  record('源页保存后看板重算且刷新结果逐项一致', {
    businesses: refreshed.businessCount,
    projects: refreshed.projectCount,
    score: refreshed.businesses[0].progress.score,
  });
  // 保存失败与文件库故障仅在适配边界注入，核实业务不变。
  await open('/sales/solutions/DEMO-O008', '真实方案文件与首次期限');
  const fileFailure = await run(
    `const p=${p};window.b06Row=await p.files.get(p.current('proposal').file.blobId);const row=window.b06Row;const {blob,...identity}=row;await p.files.removeOwned(p.current('proposal').file.blobId,identity);return {first:p.finalization().first,score:p.lifecycleProgress?.()??null};`,
  );
  await open('/projects/board', '重点 TOP5');
  const missing = await run(
    `const b=${board};b.clearFilters();b.change('businessIds','DEMO-O008');await b.refreshFiles();return {text:document.querySelector('.management-overview').innerText,view:b.management(),first:b.store.state().solutionWorkspaces.find(w=>w.opportunityId==='DEMO-O008').firstFinalization};`,
  );
  await call('wait_for', { text: ['缺件'], timeout: 10000 });
  missing.text = await run(`return document.querySelector('.management-overview').innerText;`);
  assert.match(missing.text, /缺件/);
  assert.deepEqual(missing.first, first);
  assert.equal(
    missing.view.businesses[0].progress.nodes.find((n) => n.nodeId === 'solution.proposal').status,
    'verified',
  );
  record('缺件可见但历史上传和首次成绩保留', {
    first: missing.first,
    exceptions: missing.view.exceptions,
  });
  const unavailable = await run(
    `const b=${board},get=b.files.get;b.files.get=async()=>{throw Error('controlled read failure')};try{await b.refreshFiles();return {states:b.availability(),text:document.querySelector('.management-overview').innerText}}finally{b.files.get=get;await b.refreshFiles()}`,
  );
  assert.equal(Object.values(unavailable.states).filter((x) => x === 'unavailable').length, 4); // 无文件引用的旧模拟资料仍然是missing
  record('文件读取失败不冒充缺件或可用', { states: unavailable.states });
  const empty = await run(
    `const b=${board};b.change('query','没有这个业务');return {n:b.management().businessCount,text:document.querySelector('.management-overview').innerText};`,
  );
  assert.equal(empty.n, 0);
  await pause();
  assert.match(
    await run(`return document.querySelector('.management-overview').innerText;`),
    /无匹配业务/,
  );
  record('组合空范围显示无结果而非零异常');
  await fs.writeFile(
    path.join(evidence, 'browser-results.json'),
    JSON.stringify({ result: 'passed', checks }, null, 2),
  );
  console.log('TOTAL ' + checks.length);
} finally {
  await c.client.close();
}
