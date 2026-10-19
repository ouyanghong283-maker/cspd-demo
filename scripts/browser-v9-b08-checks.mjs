// B08 supplements use existing public page commands and fresh isolated browser state.
import assert from 'node:assert/strict';
import path from 'node:path';

export async function uploadChecks({ run, record, p }) {
  const result = await run(`const p=${p}, before=JSON.stringify(p.store.state());
    const previousNumber=p.current('proposal')?.number??0;const downloads=[...document.querySelectorAll('app-solution-input-panel a,app-solution-input-panel button')].filter(e=>e.hasAttribute('download')||/下载/.test(e.textContent)).length;
    p.choose('proposal',{target:{files:[],value:''}});await p.upload('proposal');
    const cancelUnchanged=JSON.stringify(p.store.state())===before;const errors=[];
    for(const [content,name] of [['','empty.pptx'],['x','wrong.exe']]){p.choose('proposal',{target:{files:[new File([content],name)],value:''}});await p.upload('proposal');errors.push({name,message:p.feedback(),unchanged:JSON.stringify(p.store.state())===before});}
    p.choose('proposal',{target:{files:[new File(['retry actual bytes'],'retry.pptx')],value:''}});await p.upload('proposal');await p.check();
    return {previousNumber,downloads,cancelUnchanged,errors,retried:p.current('proposal').number};`);
  assert.equal(result.downloads, 0);
  assert.equal(result.cancelUnchanged, true);
  assert.ok(result.errors.every((e) => e.unchanged && e.message));
  assert.equal(result.retried, result.previousNumber + 1);
  record('ATT01/ATT03 无下载、取消不写、空文件格式错误保留原版且可重试', result);
}

export async function boardAfterQuote({ run, record, p, q, open, press, call, out }) {
  const identity = await run(`return ${q}.store.v9CommandTarget();`);
  const history = await run(
    `const s=${q}.store;const select=()=>s.state().quoteSeries.flatMap(q=>q.versions).filter(v=>['已记录发出','最终锁定'].includes(v.status));const before=JSON.stringify(select()),count=s.crmQuoteCatalog().references.length;const customer=structuredClone(s.state().customers[0]);customer.id='B08-NEW-CUSTOMER';customer.name='B08新增目录客户（模拟）';const saved=s.saveCustomer(customer);return {saved,unchanged:before===JSON.stringify(select()),added:s.crmQuoteCatalog().references.length-count,historicalCount:select().length,snapshots:select().map(v=>({id:v.id,crmReferenceSnapshot:v.crmReferenceSnapshot??null}))};`,
  );
  assert.equal(history.saved, true);
  assert.equal(history.unchanged, true);
  assert.equal(history.added, 1);
  assert.ok(history.historicalCount > 0);
  record('QTE05 新增客户目录后所有已发和锁定报价完整记录及引用快照不变', history);
  await open('/sales/solutions/DEMO-O008', '真实方案文件与首次期限');
  // The preceding quote test deliberately removed current blobs. Use the established
  // page's actual files again before testing the continuous source-to-board path.
  const adoption = await run(
    `return ${p}.store.quoteSeries('DEMO-O008').versions.map(v=>({id:v.id,basis:v.solutionBasis??null}));`,
  );
  const source = await run(
    `return {target:${p}.store.v9CommandTarget(),first:${p}.finalization().first,versions:${p}.view().workspace.versions.map(v=>({id:v.id,number:v.number,kind:v.kind})),events:${p}.finalization().events.map(e=>({id:e.id,versions:e.fourVersionIds}))};`,
  );
  assert.deepEqual(source.target, identity);
  assert.ok(source.events.length >= 3);
  const v2 = source.versions.find((v) => v.kind === 'proposal' && v.number === 2);
  assert.ok(v2 && source.events.some((e) => e.versions.proposal === v2.id));
  assert.ok(source.versions.some((v) => v.kind === 'proposal' && v.number === 3));
  record('ATT06 V2用于定稿后上传V3，旧组合首次成绩和版本身份保留', source);
  await call('resize_page', { width: 390, height: 1000 });
  await run(
    `for(const e of document.querySelectorAll('app-solution-input-panel details'))e.open=false;document.querySelector('app-solution-input-panel').scrollIntoView();return true;`,
  );
  await call('take_screenshot', {
    filePath: path.join(out, 'solution-current-390.png'),
    fullPage: false,
  });
  await open('/projects/board', '重点 TOP5');
  const board = "ng.getComponent(document.querySelector('app-project-board'))";
  await run(`await ${board}.refreshFiles();return true;`);
  const observed = await run(
    `const b=${board};return {target:b.store.v9CommandTarget(),first:b.store.state().solutionWorkspaces.find(w=>w.opportunityId==='DEMO-O008').firstFinalization,versions:b.store.state().solutionWorkspaces.find(w=>w.opportunityId==='DEMO-O008').versions.map(v=>({id:v.id,number:v.number,kind:v.kind})),quote:b.store.quoteSeries('DEMO-O008').versions.map(v=>({id:v.id,basis:v.solutionBasis??null})),project:b.store.state().projects.find(p=>p.opportunityId==='DEMO-O008')?.id};`,
  );
  assert.deepEqual(observed.target, identity);
  assert.deepEqual(observed.first, source.first);
  assert.deepEqual(observed.versions, source.versions);
  assert.deepEqual(observed.quote, adoption);
  record('INT01 同一浏览器同身份报价采用审批→方案历史→看板，稳定版本和首次事实一致', observed);
  const projectId = observed.project || 'DEMO-P001';
  await open('/projects/' + projectId + '?tab=acceptance', '客户验收');
  const change = await run(
    `const s=ng.getOwningComponent(document.querySelector('h1')).store,p=s.project(${JSON.stringify(projectId)});s.setRole('pm');const a=p.acceptance[0];const before=JSON.stringify(p.acceptance);s.saveAcceptance(p.id,a.id,a.result==='通过'?'待确认':'通过',a.signer||'B08验收人','2026-10-17','B08源页验收变更');return {target:s.v9CommandTarget(),changed:JSON.stringify(s.project(p.id).acceptance)!==before,project:structuredClone(s.project(p.id))};`,
  );
  assert.equal(change.changed, true);
  assert.deepEqual(change.target, identity);
  await open('/projects/board', '重点 TOP5');
  assert.deepEqual(
    await run(`return ${board}.store.project(${JSON.stringify(projectId)});`),
    change.project,
  );
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['重点 TOP5'], timeout: 30000 });
  assert.deepEqual(
    await run(`return ${board}.store.project(${JSON.stringify(projectId)});`),
    change.project,
  );
  record('INT03 验收源页公开保存→看板→实际刷新消费同一已提交项目事实', {
    projectId,
    target: identity,
    acceptance: change.project.acceptance,
  });
  await open('/sales/solutions/DEMO-O008', '真实方案文件与首次期限');
  await uploadChecks({ run, record, p });
  const unchanged = await run(
    `window.b08LoadingState=JSON.stringify(${p}.store.state());const p=${p};window.b08Get=p.files.get;window.b08Resolvers=[];p.files.get=id=>new Promise(resolve=>window.b08Resolvers.push(()=>window.b08Get.call(p.files,id).then(resolve)));window.b08Checking=p.check();return true;`,
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  const loading = await run(
    `return {text:document.querySelector('app-solution-input-panel').innerText,unwritten:window.b08LoadingState===JSON.stringify(${p}.store.state())};`,
  );
  assert.ok(unchanged);
  assert.match(loading.text, /正在核验/);
  assert.equal(loading.unwritten, true);
  await run(
    `for(const release of window.b08Resolvers)release();await window.b08Checking;${p}.files.get=window.b08Get;return true;`,
  );
  record('VIS06 真实文件查询等待态显示正在核验，不写业务快照或补造业务值', loading);

  await open('/sales/quotes/DEMO-O008', '报价工作区');
}

export async function captureFinalization({ run, call, p, out, record }, phase, expected) {
  const view = await run(
    `const p=${p};for(const e of document.querySelectorAll('app-solution-input-panel details'))e.open=false;return {status:p.finalization().status,first:p.finalization().first,events:p.finalization().events.length,historyClosed:[...document.querySelectorAll('app-solution-input-panel details')].every(e=>!e.open)};`,
  );
  assert.equal(view.status, expected);
  assert.equal(view.historyClosed, true);
  await call('resize_page', { width: 390, height: 1000 });
  await run(
    `document.querySelector('app-solution-finalization-summary').scrollIntoView();return true;`,
  );
  await call('take_screenshot', {
    filePath: path.join(out, 'solution-' + phase + '-390.png'),
    fullPage: false,
  });
  await call('resize_page', { width: 1440, height: 1000 });
  record('VIS04 当前首次改版三态历史默认可折叠 ' + phase, view);
}
