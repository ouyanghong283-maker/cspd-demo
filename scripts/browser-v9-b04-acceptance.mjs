import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4324';
const out = path.join(root, 'artifacts/v9-b04-acceptance');
const evidence = path.join(root, '../docs/verification/v9-b04-acceptance');
await fs.mkdir(out, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const c = await connect({ isolated: true });
let pageId;
const checks = [];
const call = (name, args = {}) => c.call(name, { pageId, ...args });
const run = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  const m = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (!m) throw Error(raw);
  return JSON.parse(m[1]);
};
const pause = () => new Promise((r) => setTimeout(r, 250));
const panel = "ng.getComponent(document.querySelector('app-solution-input-panel'))";
const child = "ng.getComponent(document.querySelector('app-solution-finalization-summary'))";
const press = async (text, selector = 'app-solution-finalization-summary') => {
  const focused = await run(
    `const b=[...document.querySelector('${selector}').querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('button not found: '+${JSON.stringify(text)});for(let parent=b.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)parent.querySelector('summary').click();b.scrollIntoView({block:'center'});b.focus();return document.activeElement===b;`,
  );
  assert.equal(focused, true, '键盘按钮必须可见且获得焦点：' + text);
  await call('press_key', { key: 'Enter' });
  await pause();
};
const state = () => run(`return JSON.stringify(${panel}.store.state());`);
const upload = async (kind, label, ext, n) => {
  const file = path.join(out, `${kind}-${n}.${ext}`);
  await fs.writeFile(file, `B04 actual file ${kind} ${n}`);
  const snap = toolText(await call('take_snapshot'));
  const line = snap.split('\n').find((l) => l.includes(`button "选择${label}文件"`));
  assert.ok(line);
  await call('upload_file', { uid: line.match(/uid=(\S+)/)[1], filePaths: [file] });
  await press('保存' + label, 'app-solution-input-panel');
  await run(`await ${panel}.check();return true;`);
  await pause();
};
const record = (name, result = { passed: true }) => {
  checks.push({ name, ...result });
  console.log('PASS ' + name);
};
try {
  const raw = toolText(await c.call('new_page', { url: base + '/sales/solutions/DEMO-O008' }));
  pageId = Number(raw.match(/(\d+):.*\[selected\]/)[1]);
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  const missing = await run(
    `return {mounted:document.querySelectorAll('app-solution-finalization-summary').length,enabled:${child}.canConfirm(),issues:${child}.view().issues.length};`,
  );
  assert.equal(missing.mounted, 1);
  assert.equal(missing.enabled, false);
  assert.ok(missing.issues > 0);
  record('真实方案页缺项时禁止定稿', missing);
  await run(`${panel}.store.setRole('solution');return true;`);
  for (const [k, l, e] of [
    ['proposal', '技术方案', 'pptx'],
    ['bom', '设计BOM', 'xlsx'],
    ['sld', 'SLD', 'pdf'],
    ['degradation', '衰减资料', 'csv'],
  ]) {
    await upload(k, l, e, 1);
    record('真实文件选择键盘保存 ' + k);
  }
  await run(
    `const p=${panel};p.store.saveProductNeed(p.opportunityId(),{id:'ACCEPT-NEED',model:'PCS-100',quantity:2,unit:'台'});p.beginEdit();p.pm='demo-person:王项目';p.owner='demo-person:周方案';p.deadline='2026-10-20';p.reason='B04最终验收';p.saveSchedule();await p.check();return true;`,
  );
  await pause();
  assert.equal(await run(`return ${child}.view().events.length;`), 0);
  record('四资料及有效需求齐备仍不自动定稿');
  await press('核对并首次定稿');
  const summary = await run(
    `const el=document.querySelector('app-solution-finalization-summary form');return {text:el.innerText,hasTimeInput:!!el.querySelector('input[type=datetime-local],input[type=date]')};`,
  );
  for (const expected of [
    'proposal-1.pptx',
    'bom-1.xlsx',
    'sld-1.pdf',
    'degradation-1.csv',
    'V1',
    '2026-10-20',
    '周方案',
    '王项目',
    '系统将记录当前时间',
  ])
    assert.ok(summary.text.includes(expected), '确认快照缺少 ' + expected);
  assert.equal(summary.hasTimeInput, false);
  record('确认摘要包含可读四版本文件/期限/负责人和系统时间提示', summary);
  const untouched = await state();
  await press('取消');
  assert.equal(await state(), untouched);
  record('取消确认不产生业务事件');
  await press('核对并首次定稿');
  const oldOperation = await run(`return ${child}.context.operationId;`);
  await run(
    `const p=${panel};p.beginEdit();p.deadline='2026-10-21';p.reason='首次前调整期限';p.saveSchedule();await p.check();return true;`,
  );
  await pause();
  assert.ok(
    (
      await run(
        `return document.querySelector('app-solution-finalization-summary form').innerText;`,
      )
    ).includes('2026-10-20'),
  );
  record('打开的摘要保留原期限快照');
  const afterSchedule = await state();
  await press('确认定稿');
  const refreshed = await run(
    `const c=${child};return {feedback:c.feedback(),deadline:c.snapshot?.deadlineDate,operation:c.context?.operationId,events:c.view().events.length};`,
  );
  assert.match(refreshed.feedback, /摘要已刷新/);
  assert.equal(refreshed.deadline, '2026-10-21');
  assert.notEqual(refreshed.operation, oldOperation);
  assert.equal(await state(), afterSchedule);
  record('期限变化拒绝旧摘要并分配新请求', refreshed);
  await run(`${panel}.store.setRole('sales');return true;`);
  await pause();
  await press('确认定稿');
  const noDelegate = await run(
    `return {feedback:${child}.feedback(),count:${child}.view().events.length};`,
  );
  assert.equal(noDelegate.count, 0);
  assert.match(noDelegate.feedback, /代办|负责人/);
  record('跨岗位操作未勾选代办时拒绝', noDelegate);
  await run(
    `document.querySelector('app-solution-finalization-summary [name=actingOnBehalf]').click();return true;`,
  );
  await pause();
  const beforeFailure = await state();
  const retryId = await run(`return ${child}.context.operationId;`);
  await run(
    `window.acceptSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){let x;try{x=JSON.parse(v)}catch{}if(Array.isArray((x?.snapshot??x)?.sales))throw new DOMException('quota','QuotaExceededError');return window.acceptSet.call(this,k,v)};return true;`,
  );
  await press('确认定稿');
  const failed = await run(
    `return {feedback:${child}.feedback(),confirming:${child}.confirming(),id:${child}.context?.operationId};`,
  );
  await run(`Storage.prototype.setItem=window.acceptSet;return true;`);
  assert.equal(await state(), beforeFailure);
  assert.equal(failed.confirming, true);
  assert.equal(failed.id, retryId);
  assert.match(failed.feedback, /保存|失败/);
  record('快照保存失败保留确认请求且不冻结', failed);
  await run(
    `const p=${panel};window.acceptGet=p.files.get;let first=true;p.files.get=async function(id){if(first){first=false;await new Promise(resolve=>window.acceptRelease=resolve)}return window.acceptGet.call(this,id)};return true;`,
  );
  await press('确认定稿');
  const busy = await run(
    `return {busy:${child}.busy(),disabled:document.querySelector('app-solution-finalization-summary fieldset').disabled};`,
  );
  assert.equal(busy.busy, true);
  assert.equal(busy.disabled, true);
  await run(
    `document.querySelector('app-solution-finalization-summary form').requestSubmit();return true;`,
  );
  await run(`window.acceptRelease();return true;`);
  await pause();
  await pause();
  await run(`${panel}.files.get=window.acceptGet;return true;`);
  const first = await run(
    `const c=${child};window.acceptFirst=c.view().first;return {first:c.view().first,events:c.view().events,feedback:c.feedback(),confirming:c.confirming(),operator:c.store.person()};`,
  );
  assert.equal(first.events.length, 1);
  assert.equal(first.confirming, false);
  assert.equal(first.events[0].operator.name, first.operator);
  assert.equal(first.events[0].owner.name, '周方案');
  assert.equal(first.events[0].pm.name, '王项目');
  assert.match(first.feedback, /已保存/);
  record('键盘真实代办定稿/忙时防重复/责任与实际操作者分记', first);
  const shanghaiTime = new Date(Date.parse(first.events[0].confirmedAt) + 8 * 3600_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  const historicalTime = await run(
    `return document.querySelector('app-solution-finalization-summary details article').textContent.replace(/\\s+/g,' ');`,
  );
  assert.ok(historicalTime.includes(shanghaiTime), '历史必须显示上海业务时间 ' + shanghaiTime);
  assert.match(historicalTime, /Asia\/Shanghai/);
  record('真实定稿历史按上海业务时间显示', { expected: shanghaiTime, shown: historicalTime });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['首次成绩与当前方案'], timeout: 30000 });
  await run(`await ${panel}.check();return true;`);
  await pause();
  const reload = await run(
    `return {first:${child}.view().first,events:${child}.view().events.length,frozen:${panel}.schedule().frozen};`,
  );
  assert.deepEqual(reload.first, first.first);
  assert.equal(reload.events, 1);
  assert.equal(reload.frozen, true);
  record('真实表单定稿刷新后首次成绩与冻结保留', reload);
  await upload('proposal', '技术方案', 'pptx', 2);
  const stale = await run(
    `return {status:${child}.view().status,first:${child}.view().first,events:${child}.view().events.length};`,
  );
  assert.equal(stale.status, 'stale');
  assert.deepEqual(stale.first, first.first);
  record('实际改版进入待重新定稿且首次不变', stale);
  await press('核对并重新定稿');
  const beforeNeed = await run(`return ${child}.context.operationId;`);
  await run(
    `const p=${panel};p.store.saveProductNeed(p.opportunityId(),{id:'ACCEPT-NEED',model:'PCS-200',quantity:3,unit:'台'});await p.check();return true;`,
  );
  await pause();
  const changedNeed = await state();
  await press('确认定稿');
  assert.equal(await state(), changedNeed);
  assert.notEqual(await run(`return ${child}.context.operationId;`), beforeNeed);
  record('需求修订期间拒绝旧摘要且不追加定稿');
  // File reads, persistence and lease are injected system boundaries; the form and real stored files remain in use.
  for (const mode of ['missing', 'unavailable']) {
    const before = await state();
    await run(
      `const p=${panel};window.acceptGet=p.files.get;p.files.get=async()=>{${mode === 'missing' ? 'return null;' : "throw Error('read failure');"}};return true;`,
    );
    await press('确认定稿');
    const denied = await run(
      `return {text:${child}.feedback(),events:${child}.view().events.length};`,
    );
    await run(`${panel}.files.get=window.acceptGet;return true;`);
    assert.equal(await state(), before);
    assert.equal(denied.events, 1);
    assert.match(denied.text, mode === 'missing' ? /缺失/ : /不可读/);
    record('表单提交文件' + mode + '边界失败不发布', denied);
  }
  await run(
    `window.acceptLease=${panel}.store.editingLease;${panel}.store.editingLease={owns:()=>false};return true;`,
  );
  const beforeLease = await state();
  await press('确认定稿');
  const denied = await run(`return ${child}.feedback();`);
  await run(`${panel}.store.editingLease=window.acceptLease;return true;`);
  assert.equal(await state(), beforeLease);
  assert.match(denied, /修改资格|修改权/);
  record('打开确认后失去修改权拒绝且不改状态', { feedback: denied });
  await run(
    `const b=document.querySelector('app-solution-finalization-summary [name=actingOnBehalf]');if(!b.checked)b.click();return true;`,
  );
  await pause();
  // Use explicit checkbox input before the successful re-finalization (reload restored the solution identity).
  await press('确认定稿');
  const later = await run(
    `return {events:${child}.view().events,first:${child}.view().first,feedback:${child}.feedback()};`,
  );
  assert.equal(later.events.length, 2);
  assert.deepEqual(later.first, first.first);
  assert.equal(later.events[1].firstEventId, later.events[0].id);
  assert.equal(
    later.events[0].versionMetadataSnapshot.find((v) => v.kind === 'proposal').fileName,
    'proposal-1.pptx',
  );
  record('真实重定稿保留首次与旧文件元数据', later);
  await run(
    `await ng.getOwningComponent(document.querySelector('app-solution-input-panel')).router.navigateByUrl('/sales/solutions/DEMO-O003');return true;`,
  );
  await pause();
  const cleanRoute = await run(`return ${child}.feedback();`);
  assert.doesNotMatch(cleanRoute, /已保存|首次事实/);
  record('切商机清除上一商机成功反馈', { feedback: cleanRoute });
  await run(
    `await ng.getOwningComponent(document.querySelector('app-solution-input-panel')).router.navigateByUrl('/sales/solutions/DEMO-O008');return true;`,
  );
  await pause();
  await run(
    `const p=${panel};p.store.saveProductNeed(p.opportunityId(),{id:'ACCEPT-NEED',model:'PCS-300',quantity:3,unit:'台'});await p.check();return true;`,
  );
  await pause();
  await press('核对并重新定稿');
  const beforeRoute = await state();
  await run(
    `await ng.getOwningComponent(document.querySelector('app-solution-input-panel')).router.navigateByUrl('/sales/solutions/DEMO-O003');return true;`,
  );
  await pause();
  // An old confirmation must not remain actionable after Router reuses the component for another opportunity.
  const route = await run(
    `return {id:${panel}.opportunityId(),confirming:${child}.confirming(),text:document.querySelector('app-solution-finalization-summary').innerText};`,
  );
  assert.equal(route.id, 'DEMO-O003');
  if (route.confirming) await press('确认定稿');
  assert.equal(await state(), beforeRoute);
  assert.equal(await run(`return ${child}.confirming();`), false);
  record('Router切商机拒绝旧确认且不改原状态', route);
  await run(
    `await ng.getOwningComponent(document.querySelector('app-solution-input-panel')).router.navigateByUrl('/sales/solutions/DEMO-O008');return true;`,
  );
  await pause();
  await run(`await ${panel}.check();return true;`);
  await pause();
  await press('核对并重新定稿');
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    const size = await run(
      `return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,summary:document.querySelector('app-solution-finalization-summary form').innerText};`,
    );
    assert.equal(size.overflow, false);
    assert.match(size.summary, /proposal-2.pptx/);
    record('确认摘要五宽阅读', size);
  }
  await call('take_screenshot', { filePath: path.join(out, 'k15-390.png'), fullPage: true });
  await run(
    `const b=document.querySelector('app-solution-finalization-summary [name=actingOnBehalf]');if(!b.checked)b.click();const p=${panel};window.acceptGet=p.files.get;let first=true;p.files.get=async function(id){if(first){first=false;await new Promise(resolve=>window.acceptRelease=resolve)}return window.acceptGet.call(this,id)};return true;`,
  );
  await pause();
  await press('确认定稿');
  assert.equal(await run(`return ${child}.busy();`), true);
  await run(
    `await ng.getOwningComponent(document.querySelector('app-solution-input-panel')).router.navigateByUrl('/sales/solutions/DEMO-O003');return true;`,
  );
  await pause();
  await run(`window.acceptRelease();return true;`);
  await pause();
  await pause();
  await run(`${panel}.files.get=window.acceptGet;return true;`);
  const asyncRoute = await run(
    `return {id:${panel}.opportunityId(),feedback:${child}.feedback(),confirming:${child}.confirming(),busy:${child}.busy(),events:${child}.view().events.length};`,
  );
  assert.equal(asyncRoute.id, 'DEMO-O003');
  assert.equal(asyncRoute.events, 0);
  assert.equal(asyncRoute.confirming, false);
  assert.equal(asyncRoute.busy, false);
  assert.doesNotMatch(asyncRoute.feedback, /已保存|首次事实/);
  record('异步确认中切商机不向新来源显示旧成功', asyncRoute);
  await run(
    `await ng.getOwningComponent(document.querySelector('app-solution-input-panel')).router.navigateByUrl('/sales/solutions/DEMO-O008');return true;`,
  );
  await pause();
  const originalPage = pageId;
  const tab = toolText(await c.call('new_page', { url: base + '/sales/solutions/DEMO-O008' }));
  pageId = Number(tab.match(/(\d+):.*\[selected\]/)[1]);
  await call('wait_for', { text: ['首次成绩与当前方案'], timeout: 30000 });
  const readOnly = await run(
    `return {writable:${child}.store.editingWritable(),confirmButtons:[...document.querySelectorAll('app-solution-finalization-summary button')].filter(b=>b.textContent.includes('核对并')).length};`,
  );
  assert.equal(readOnly.writable, false);
  assert.equal(readOnly.confirmButtons, 0);
  record('真实第二标签页只读不能打开定稿确认', readOnly);
  await call('close_page');
  pageId = originalPage;

  const projectId = await run(`return ${panel}.store.state().projects[0].id;`);
  await call('navigate_page', {
    type: 'url',
    url: base + '/projects/' + projectId + '?tab=plans&plan=' + encodeURIComponent('调试备件'),
  });
  await call('wait_for', { text: ['调试备件计划'], timeout: 30000 });
  await pause();
  await run(
    `for(const d of document.querySelectorAll('details'))if(d.querySelector('summary')?.textContent.includes('办理任务关联'))d.open=true;return true;`,
  );
  await pause();
  const map = "ng.getComponent(document.querySelector('app-progress-mapping-panel'))";
  const app = "ng.getComponent(document.querySelector('app-node-applicability-panel'))";
  const beforePlans = await run(
    `return JSON.stringify(${map}.store.project(${map}.projectId()).plans);`,
  );
  await press('编辑任务组关联', 'app-progress-mapping-panel');
  const beforeEmpty = await run(`return JSON.stringify(${map}.store.state());`);
  await press('确认任务组', 'app-progress-mapping-panel');
  const invalid = await run(
    `return {feedback:${map}.feedback(),state:JSON.stringify(${map}.store.state())};`,
  );
  assert.equal(invalid.state, beforeEmpty);
  assert.match(invalid.feedback, /field-invalid/);
  assert.doesNotMatch(invalid.feedback, /undefined/);
  record('K17任务组错误文案绑定公开拒绝且状态不变', { feedback: invalid.feedback });
  await run(
    `const el=document.querySelector('app-progress-mapping-panel');const select=el.querySelector('[name=group]');select.value='shipping';select.dispatchEvent(new Event('change',{bubbles:true}));return true;`,
  );
  await pause();
  const planId = await run(
    `const p=${map};const index=p.view().options.findIndex(x=>x.type==='要货发货'&&x.status!=='已取消');const i=index>=0?index:0;document.querySelectorAll('app-progress-mapping-panel input[type=checkbox]')[i].click();const el=document.querySelector('app-progress-mapping-panel [name=mappingReason]');el.value='B04固定发货范围复核';el.dispatchEvent(new Event('input',{bubbles:true}));return p.view().options[i].id;`,
  );
  await pause();
  const beforeMapFailure = await run(`return JSON.stringify(${map}.store.state());`);
  await run(
    `window.acceptSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){let x;try{x=JSON.parse(v)}catch{}if(Array.isArray((x?.snapshot??x)?.sales))throw new DOMException('quota','QuotaExceededError');return window.acceptSet.call(this,k,v)};return true;`,
  );
  await press('确认任务组', 'app-progress-mapping-panel');
  const mapFailure = await run(
    `return {feedback:${map}.feedback(),reason:${map}.reason,state:JSON.stringify(${map}.store.state())};`,
  );
  await run(`Storage.prototype.setItem=window.acceptSet;return true;`);
  assert.equal(mapFailure.state, beforeMapFailure);
  assert.match(mapFailure.feedback, /quota-exceeded/);
  assert.equal(mapFailure.reason, 'B04固定发货范围复核');
  record('K17任务组保存失败保留原因和重试', { feedback: mapFailure.feedback });
  await press('确认任务组', 'app-progress-mapping-panel');
  const mapped = await run(`return ${map}.view().groups.find(g=>g.id==='shipping');`);
  assert.deepEqual(mapped.planIds, [planId]);
  assert.equal(mapped.history.length, 1);
  assert.equal(mapped.history[0].reason, 'B04固定发货范围复核');
  record('K17键盘关联保存原因/成员/操作者历史', mapped);
  await press('设置或撤销免做', 'app-node-applicability-panel');
  await run(
    `const el=document.querySelector('app-node-applicability-panel [name=applicabilityReason]');el.value=' ';el.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
  );
  await pause();
  const beforeWaiver = await run(`return JSON.stringify(${app}.store.state());`);
  await press('保存执行要求', 'app-node-applicability-panel');
  const waiverInvalid = await run(
    `return {feedback:${app}.feedback(),state:JSON.stringify(${app}.store.state())};`,
  );
  assert.equal(waiverInvalid.state, beforeWaiver);
  assert.match(waiverInvalid.feedback, /field-required/);
  record('K17免做空白原因显示公开拒绝', { feedback: waiverInvalid.feedback });
  const optionCount = await run(
    `return document.querySelector('app-node-applicability-panel [name=node]').options.length;`,
  );
  assert.equal(optionCount, 6);
  record('免做选项限定原六类且未扩至验收移交', { optionCount });
  await run(
    `const el=document.querySelector('app-node-applicability-panel [name=applicabilityReason]');el.value='B04本合同无需现场调试';el.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
  );
  await pause();
  await press('保存执行要求', 'app-node-applicability-panel');
  const waived = await run(`return ${app}.view().find(n=>n.id==='execution.sat').record;`);
  assert.equal(waived.applicability, 'not-required');
  assert.equal(waived.history.length, 1);
  assert.ok(waived.history[0].pm.name);
  assert.ok(waived.history[0].operator.name);
  record('K17真实免做表单保留PM与操作者审计', waived);
  await press('设置或撤销免做', 'app-node-applicability-panel');
  await run(
    `const el=document.querySelector('app-node-applicability-panel');el.querySelector('[name=applicability]').value='applicable';el.querySelector('[name=applicability]').dispatchEvent(new Event('change',{bubbles:true}));el.querySelector('[name=applicabilityReason]').value='B04恢复真实执行';el.querySelector('[name=applicabilityReason]').dispatchEvent(new Event('input',{bubbles:true}));return true;`,
  );
  await pause();
  await press('保存执行要求', 'app-node-applicability-panel');
  const restored = await run(`return ${app}.view().find(n=>n.id==='execution.sat').record;`);
  assert.equal(restored.applicability, 'applicable');
  assert.equal(restored.history.length, 2);
  assert.equal(
    await run(`return JSON.stringify(${map}.store.project(${map}.projectId()).plans);`),
    beforePlans,
  );
  record('K17撤销免做留历史且原任务状态不变', restored);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['调试备件计划'], timeout: 30000 });
  await pause();
  assert.equal(
    await run(`return ${map}.view().groups.find(g=>g.id==='shipping').history.length;`),
    1,
  );
  assert.equal(
    await run(`return ${app}.view().find(n=>n.id==='execution.sat').record.history.length;`),
    2,
  );
  record('K17刷新后关联/免做历史与当前状态保留');
  const other = await run(
    `return ${map}.store.state().projects.find(p=>p.id!==${JSON.stringify(projectId)}).id;`,
  );
  await press('编辑任务组关联', 'app-progress-mapping-panel');
  const beforeProject = await run(`return JSON.stringify(${map}.store.state());`);
  await run(
    `await ng.getOwningComponent(document.querySelector('app-progress-mapping-panel')).router.navigateByUrl('/projects/'+${JSON.stringify(other)}+'?tab=plans&plan='+encodeURIComponent('调试备件'));return true;`,
  );
  await pause();
  await press('确认任务组', 'app-progress-mapping-panel');
  const switched = await run(
    `return {feedback:${map}.feedback(),state:JSON.stringify(${map}.store.state())};`,
  );
  assert.equal(switched.state, beforeProject);
  assert.match(switched.feedback, /切换|重新编辑|原因/);
  record('K17切项目后旧输入不写入新项目', { feedback: switched.feedback });
  const errors = toolText(await call('list_console_messages', { types: ['error'] }));
  assert.doesNotMatch(errors, /NG0950|ReferenceError|ERROR RuntimeError/);
  record('无Angular挂载或表单运行时错误');

  await fs.writeFile(
    path.join(evidence, 'browser-report.json'),
    JSON.stringify({ passed: checks.length, checks }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed: checks.length }));
} catch (e) {
  console.error(e);
  await fs.writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify({ error: e.message, checks }, null, 2),
  );
  process.exitCode = 1;
} finally {
  await c.client.close();
  await c.transport.close();
}
