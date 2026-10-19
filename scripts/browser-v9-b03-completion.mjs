import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { connect, toolText, root } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4315';
const out = path.resolve(root, process.env.CSPD_ARTIFACT_DIR || 'artifacts/v9-b03-completion');
await fs.mkdir(out, { recursive: true });
const originalSource = '/home/konye/Project-Oct/doc/详细材料/方案设计资料包';
const source = path.join(out, 'input-fixtures');
await fs.mkdir(source, { recursive: true });
for (const file of [
  'Technical Proposal_MetaWealth_S-npaul-1-BESS_50MW_100.32MWh.pptx',
  'BOM_List_MetaWealth_S-npaul-1-BESS.xlsx',
  'SLD_MetaWealth_S-npaul-1-BESS.pdf',
  'Degradation_Schedule.xlsx',
])
  await fs.copyFile(path.join(originalSource, file), path.join(source, file));
const ppt = path.join(source, 'Technical Proposal_MetaWealth_S-npaul-1-BESS_50MW_100.32MWh.pptx');
const bytes = await fs.readFile(ppt);
assert.equal(bytes.length, 49459494);
const checks = [];
const c = await connect({ isolated: true });
let pageId;
const call = (name, args = {}) => c.call(name, { pageId, ...args });
const run = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw Error(raw);
  return JSON.parse(match[1]);
};
const pause = () => new Promise((r) => setTimeout(r, 250));
const open = async (route, text) => {
  await call('navigate_page', { type: 'url', url: base + route });
  await call('wait_for', { text: [text], timeout: 30000 });
};
const inputFile = async (label, file) => {
  const snapshot = toolText(await call('take_snapshot', {}));
  const line = snapshot.split('\n').find((l) => l.includes(`button "${label}"`));
  assert.ok(line, label);
  const uid = line.match(/uid=(\S+)/)[1];
  await call('upload_file', { uid, filePaths: [file] });
};
const panel = "ng.getComponent(document.querySelector('app-solution-input-panel'))";
try {
  const raw = toolText(await c.call('new_page', { url: base + '/sales/solutions/DEMO-O008' }));
  pageId = Number(raw.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  await run(
    `const p=${panel};p.store.setRole('solution');p.note='资料来源示例：MetaWealth / Sânpaul 1 BESS；用于DEMO-O008能力验证，不代表该商机原资料';return true;`,
  );
  await pause();
  await inputFile('选择技术方案文件', ppt);
  const large = await run(
    `const p=${panel};await p.upload('proposal');const v=p.current('proposal');const r=await p.files.get(v.file.blobId);return {feedback:p.feedback(),size:r.blob.size,metaSize:v.size,number:v.number,name:v.fileName,availability:p.availability()[v.id],versionId:v.id,blobId:v.file.blobId,operator:v.operator,owner:v.owner};`,
  );
  assert.equal(large.size, 49459494);
  assert.equal(large.metaSize, 49459494);
  assert.equal(large.availability, 'present');
  assert.equal(large.number, 1);
  checks.push({
    name: '原始PPT真实文件选择及IndexedDB保存',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...large,
  });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  const reloaded = await run(
    `const p=${panel};await p.check();const v=p.current('proposal');return {number:v.number,availability:p.availability()[v.id],size:(await p.files.get(v.file.blobId)).blob.size};`,
  );
  assert.equal(reloaded.size, 49459494);
  assert.equal(reloaded.availability, 'present');
  checks.push({ name: '原始PPT刷新可用', ...reloaded });
  for (const [label, kind, file] of [
    ['设计BOM', 'bom', 'BOM_List_MetaWealth_S-npaul-1-BESS.xlsx'],
    ['SLD', 'sld', 'SLD_MetaWealth_S-npaul-1-BESS.pdf'],
    ['衰减资料', 'degradation', 'Degradation_Schedule.xlsx'],
  ]) {
    await inputFile('选择' + label + '文件', path.join(source, file));
    const r = await run(
      `const p=${panel};await p.upload('${kind}');const v=p.current('${kind}');return {kind:'${kind}',number:v?.number,availability:p.availability()[v?.id]};`,
    );
    assert.equal(r.number, 1);
    assert.equal(r.availability, 'present');
    checks.push({ name: '四类独立真实上传', ...r });
  }
  for (const n of [2, 3]) {
    const file = path.join(out, `replacement-${n}.pptx`);
    await fs.writeFile(file, '真实替换版本' + n);
    await inputFile('选择技术方案文件', file);
    const r = await run(
      `const p=${panel};await p.upload('proposal');const w=p.view().workspace;return {number:p.current('proposal').number,history:w.versions.filter(v=>v.kind==='proposal'&&v.contentState==='metadataOnly').map(v=>({id:v.id,file:v.file,name:v.fileName,uploadedAt:v.uploadedAt,owner:v.owner}))};`,
    );
    assert.equal(r.number, n);
    assert.equal(r.history.length, n - 1);
    assert.ok(r.history.every((v) => v.file === null));
    checks.push({ name: '真实V' + n + '替换及历史保留', ...r });
  }
  // 文件库与快照边界失败通过真实公开上传控件触发，恢复后原请求重试。
  for (const mode of ['blob', 'snapshot']) {
    await inputFile('选择技术方案文件', path.join(out, 'replacement-3.pptx'));
    const failed = await run(
      `const p=${panel};const before=JSON.stringify(p.store.state());const put=p.files.put;const set=Storage.prototype.setItem;if('${mode}'==='blob')p.files.put=async()=>{throw new DOMException('quota','QuotaExceededError')};else Storage.prototype.setItem=function(k,v){let x;try{x=JSON.parse(v)}catch{}if(Array.isArray((x?.snapshot??x)?.sales))throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v)};try{await p.upload('proposal');return {unchanged:before===JSON.stringify(p.store.state()),number:p.current('proposal').number,feedback:p.feedback(),retryAvailable:!!p.selected.proposal};}finally{p.files.put=put;Storage.prototype.setItem=set;}`,
    );
    assert.equal(failed.unchanged, true);
    assert.equal(failed.number, 3);
    assert.equal(failed.retryAvailable, true);
    checks.push({ name: mode + '失败保留原版本与输入', ...failed });
  }
  const retry = await run(
    `const p=${panel};await p.upload('proposal');return {number:p.current('proposal').number,feedback:p.feedback()};`,
  );
  assert.equal(retry.number, 4);
  checks.push({ name: '快照失败后原请求重试', ...retry });
  // 真实表单设置与留因改期；不通过直接状态赋值。
  await run(`const p=${panel};p.store.setRole('pm');return true;`);
  await pause();
  await run(
    `document.querySelector('app-solution-input-panel button').focus();const b=[...document.querySelectorAll('app-solution-input-panel button')].find(b=>b.textContent.trim()==='设置期限与负责人');b.click();return true;`,
  );
  await pause();
  await run(
    `const root=document.querySelector('app-solution-input-panel');for(const [name,value] of [['pm','demo-person:王项目'],['owner','demo-person:周方案'],['deadline','2028-02-29'],['reason','首次承诺']]){const el=root.querySelector('[name="'+name+'"]');el.value=value;el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}root.querySelector('form').requestSubmit();return true;`,
  );
  await pause();
  const schedule = await run(
    `const p=${panel};return {feedback:p.feedback(),schedule:p.schedule().schedule,history:p.schedule().history};`,
  );
  assert.equal(schedule.schedule?.deadlineDate, '2028-02-29');
  assert.equal(schedule.history.length, 1);
  checks.push({ name: '真实表单首次期限与责任保存', ...schedule });
  await run(
    `const p=${panel};p.beginEdit();p.deadline='2028-03-01';p.reason='客户改期';p.saveSchedule();return true;`,
  );
  const change = await run(
    `const p=${panel};return {date:p.schedule().schedule.deadlineDate,revision:p.schedule().schedule.revision,history:p.schedule().history.length};`,
  );
  assert.equal(change.revision, 2);
  assert.equal(change.history, 2);
  checks.push({ name: '留因改期', ...change });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  assert.equal(await run(`return ${panel}.schedule().schedule.revision;`), 2);
  checks.push({ name: '期限保存刷新恢复', passed: true });
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    const r = await run(
      `const p=document.querySelector('app-solution-input-panel');p.scrollIntoView();return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,files:p.querySelectorAll('input[type=file]').length};`,
    );
    assert.equal(r.overflow, false);
    assert.equal(r.files, 4);
    await call('take_screenshot', {
      filePath: path.join(out, `upload-${width}.png`),
      fullPage: false,
    });
    checks.push({ name: '文件与期限五宽', ...r });
  }
  // 进入现有业务进度页验证独立面板，不替代第四批计划页装配。
  await open('/projects/DEMO-P001?tab=' + encodeURIComponent('业务进度'), '固定执行任务组');
  const mapping = await run(
    `const p=ng.getComponent(document.querySelector('app-progress-mapping-panel'));p.store.setRole('pm');p.begin();p.selected=new Set(p.view().options.filter(x=>x.type==='内部WBS').slice(0,3).map(x=>x.id));p.reason='明确固定设计任务';p.save();return {feedback:p.feedback(),group:p.view().groups[0]};`,
  );
  assert.equal(mapping.group.revision, 1);
  checks.push({ name: '真实任务组面板保存', ...mapping });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['固定执行任务组'], timeout: 30000 });
  assert.equal(
    await run(
      "return ng.getComponent(document.querySelector('app-progress-mapping-panel')).view().groups[0].revision;",
    ),
    1,
  );
  checks.push({ name: '任务组刷新恢复', passed: true });
  await open('/projects/DEMO-P001?tab=' + encodeURIComponent('预算费用'), '预算与模拟费用');
  const budget = await run(
    `const p=ng.getComponent(document.querySelector('app-budget-expense-panel'));p.store.setRole('pm');p.initialize();return {feedback:p.feedback(),ids:p.store.state().budgetDemoExpenses.map(e=>e.expenseId),views:p.views().map(v=>({currency:v.currency,budget:v.budgetMinor,expense:v.expenseMinor,comparable:v.comparable,reason:v.reason})),links:document.querySelectorAll('app-budget-expense-panel a').length};`,
  );
  assert.equal(new Set(budget.ids).size, 6);
  checks.push({ name: '固定费用统一快照接入与分币种', ...budget });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['预算与模拟费用'], timeout: 30000 });
  const budgetReload = await run(
    `const p=ng.getComponent(document.querySelector('app-budget-expense-panel'));return {ids:p.store.state().budgetDemoExpenses.map(e=>e.expenseId),views:p.views().map(v=>({currency:v.currency,budget:v.budgetMinor,expense:v.expenseMinor,comparable:v.comparable,reason:v.reason}))};`,
  );
  assert.deepEqual(budgetReload.ids, budget.ids);
  assert.deepEqual(budgetReload.views, budget.views);
  checks.push({ name: '固定费用刷新不重复且金额一致', ...budgetReload });
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    const r = await run(
      `const p=document.querySelector('app-budget-expense-panel');p.scrollIntoView();return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,localScroll:!!p.querySelector('[role=region][tabindex="0"]')};`,
    );
    assert.equal(r.overflow, false);
    assert.equal(r.localScroll, true);
    await call('take_screenshot', {
      filePath: path.join(out, `budget-${width}.png`),
      fullPage: false,
    });
    checks.push({ name: '预算五宽局部滚动', ...r });
  }
  const focus = await run(
    `const a=document.querySelector('app-budget-expense-panel a');a.focus();return {href:a.getAttribute('href'),focused:document.activeElement===a};`,
  );
  assert.ok(focus.href.includes('focus='));
  assert.equal(focus.focused, true);
  await call('press_key', { key: 'Enter' });
  await call('wait_for', { text: ['内部WBS'], timeout: 10000 });
  checks.push({ name: '费用明细键盘定位WBS', ...focus, url: await run('return location.href;') });
  await open('/projects/DEMO-P002?tab=' + encodeURIComponent('预算费用'), '预算与模拟费用');
  const switched = await run(
    `const p=ng.getComponent(document.querySelector('app-budget-expense-panel'));return {projects:[...new Set(p.views().flatMap(v=>v.expenses.map(e=>e.projectId)))],count:p.store.state().budgetDemoExpenses.length};`,
  );
  assert.deepEqual(switched.projects, ['DEMO-P002']);
  assert.equal(switched.count, 6);
  checks.push({ name: '切项目费用归属及集合不重复', ...switched });
  await open('/projects/DEMO-P001?tab=' + encodeURIComponent('业务进度'), '固定执行任务组');
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    const r = await run(
      `const p=document.querySelector('app-progress-mapping-panel');p.scrollIntoView();return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1};`,
    );
    assert.equal(r.overflow, false);
    await call('take_screenshot', {
      filePath: path.join(out, `mapping-${width}.png`),
      fullPage: false,
    });
    checks.push({ name: '关联面板五宽', ...r });
  }
  await open('/sales/solutions/DEMO-O008', '真实方案文件与首次期限');
  for (const mode of ['missing', 'unavailable']) {
    const r = await run(
      `const p=${panel};const before=JSON.stringify(p.store.state());const get=p.files.get;p.files.get=async()=>{if('${mode}'==='unavailable')throw Error('暂不可读');return null};try{await p.check();return {states:Object.values(p.availability()),unchanged:before===JSON.stringify(p.store.state()),text:document.querySelector('app-solution-input-panel').innerText};}finally{p.files.get=get;}`,
    );
    assert.ok(r.states.every((x) => x === mode));
    assert.equal(r.unchanged, true);
    checks.push({ name: mode + '只读核验保留上传历史', states: r.states, unchanged: r.unchanged });
  }
  await run(
    `const p=${panel};await p.check();const el=document.querySelector('app-solution-input-panel input[type=file]');const dt=new DataTransfer();dt.items.add(new File(['长文件名验证'],'长文件名'.repeat(45)+'.pptx'));el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));await p.upload('proposal');return true;`,
  );
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    const r = await run(
      `return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1};`,
    );
    assert.equal(r.overflow, false);
    checks.push({ name: '长文件名五宽', ...r });
  }
  const clock = await run(
    `const p=${panel};const before=JSON.stringify(p.store.state());p.clock.now.set('2028-02-29T15:59:59Z');const day=p.schedule().status;p.clock.now.set('2028-03-01T16:00:00Z');const next=p.schedule().overdueDays;window.dispatchEvent(new Event('focus'));return {day,next,realDate:p.clock.dates().solutionBusinessDate,unchanged:before===JSON.stringify(p.store.state())};`,
  );
  assert.equal(clock.day, '未定稿');
  assert.equal(clock.next, 1);
  assert.equal(clock.unchanged, true);
  assert.equal(
    clock.realDate,
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
  );
  checks.push({ name: '受控午夜投影与真实恢复前台刷新不写历史', ...clock });
  await run(
    `const p=${panel};const el=document.querySelector('app-solution-input-panel input[type=file]');const dt=new DataTransfer();dt.items.add(new File(['A草稿'],'A草稿.pptx'));el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));p.beginEdit();p.deadline='2028-04-01';p.reason='A商机待保存';window.__v9DraftPanel=p;await ng.getComponent(document.querySelector('app-solution-workspace')).router.navigateByUrl('/sales/solutions/DEMO-O014');return true;`,
  );
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  const targetGuard = await run(
    `const p=${panel};const before=JSON.stringify(p.store.state());const discarded=!p.selected.proposal&&!p.editingSchedule();const uploadDisabled=[...document.querySelectorAll('app-solution-input-panel button')].find(b=>b.textContent.trim()==='保存技术方案').disabled;await p.upload('proposal');const upload=p.feedback();p.saveSchedule();const schedule=p.feedback();const reused=p===window.__v9DraftPanel;delete window.__v9DraftPanel;return {reused,opportunityId:p.opportunityId(),upload,schedule,discarded,uploadDisabled,unchanged:before===JSON.stringify(p.store.state())};`,
  );
  assert.equal(targetGuard.reused, true);
  assert.equal(targetGuard.opportunityId, 'DEMO-O014');
  assert.equal(targetGuard.discarded, true);
  assert.equal(targetGuard.uploadDisabled, true);
  assert.equal(targetGuard.upload, '');
  assert.match(targetGuard.schedule, /来源商机已切换/);
  assert.equal(targetGuard.unchanged, true);
  checks.push({ name: '真实路由复用时旧上传和期限草稿拒绝写入另一商机', ...targetGuard });
  const delegation = await run(
    `const p=${panel};p.store.setRole('sales');const el=document.querySelector('app-solution-input-panel input[type=file]');const dt=new DataTransfer();dt.items.add(new File(['销售演示代办'],'销售代办.pptx'));el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));await p.upload('proposal');const v=p.current('proposal');return {feedback:p.feedback(),operator:v?.operator,owner:v?.owner,notice:document.querySelector('app-solution-input-panel').innerText.includes('演示代办'),disabled:el.disabled};`,
  );
  assert.equal(delegation.feedback, '已保存');
  assert.equal(delegation.operator.name, '张销售');
  assert.equal(delegation.notice, true);
  await pause();
  delegation.enabledAfterRender = !(await run(
    `return document.querySelector('app-solution-input-panel input[type=file]').disabled;`,
  ));
  assert.equal(delegation.enabledAfterRender, true);
  checks.push({ name: '销售跨部门演示代办保留实际操作者', ...delegation });
  await open('/sales/solutions/DEMO-O008', '真实方案文件与首次期限');
  const readonlyRaw = toolText(
    await c.call('new_page', { url: base + '/sales/solutions/DEMO-O008' }),
  );
  const second = Number(readonlyRaw.match(/(\d+):.*\[selected\]/)?.[1]);
  await c.call('wait_for', { pageId: second, text: ['真实方案文件与首次期限'], timeout: 30000 });
  const readonlyText = toolText(
    await c.call('evaluate_script', {
      pageId: second,
      function:
        "()=>{const p=ng.getComponent(document.querySelector('app-solution-input-panel'));return {writable:p.store.editingWritable(),allDisabled:[...document.querySelectorAll('app-solution-input-panel input[type=file]')].every(e=>e.disabled)}}",
    }),
  );
  const readonly = JSON.parse(readonlyText.match(/```json\s*([\s\S]*?)\s*```/)[1]);
  assert.equal(readonly.writable, false);
  assert.equal(readonly.allDisabled, true);
  checks.push({ name: '第二标签页修改资格保护', ...readonly });
  await c.call('take_screenshot', {
    pageId: second,
    filePath: path.join(out, 'readonly-source.png'),
    fullPage: false,
  });
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify({ status: 'passed', checks }, null, 2),
  );
  console.log(JSON.stringify({ status: 'passed', count: checks.length, checks }, null, 2));
} catch (e) {
  await fs.writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify({ error: String(e), checks }, null, 2),
  );
  console.error(e);
  process.exitCode = 1;
} finally {
  await c.client.close();
  await c.transport.close();
}
