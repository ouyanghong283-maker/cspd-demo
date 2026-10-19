import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText } from './mcp-client.mjs';
import { root, base } from './browser-config.mjs';
const output = path.join(
  root,
  'artifacts',
  'v8-contract-milestones',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await fs.mkdir(output, { recursive: true });
const report = { issue: 64, result: '失败', checks: [] };
let connection, pageId;
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const t = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  const m = t.match(/```json\s*([\s\S]*?)\s*```/);
  assert(m, t);
  return JSON.parse(m[1]);
};
const check = async (name, body) => {
  const evidence = await evaluate(body);
  assert.equal(evidence.ok, true, JSON.stringify(evidence));
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
};
const comp = `const cmp=ng.getComponent(document.querySelector('app-contract-milestones'));const store=cmp.store;`;
try {
  connection = await connect({ isolated: true });
  const text = toolText(
    await connection.call('new_page', { url: base + '/contracts', timeout: 30000 }),
  );
  pageId = Number(text.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['合同管理'], timeout: 30000 });
  const fixture = await evaluate(
    `const store=ng.getComponent(document.querySelector('app-root')).store;const c=store.state().contracts.find(c=>store.state().projects.some(p=>p.contractId===c.id));const p=store.state().projects.find(p=>p.contractId===c.id);const q=structuredClone(p);q.id='V8-64-PROJECT-2';q.name='合同里程碑双项目验收';return {ok:store.write(s=>s.projects.push(q),'准备双项目验收样例'),contractId:c.id,projects:[p.id,q.id]};`,
  );
  assert(fixture.ok);
  await call('navigate_page', { type: 'url', url: base + '/contracts/' + fixture.contractId });
  await call('wait_for', { text: ['协作与关联'], timeout: 30000 });
  await evaluate(
    `const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='协作与关联');b.click();return true;`,
  );
  await check(
    'UI 新增：合法日期、0天、稳定人员及真实创建时间',
    `${comp}
 const side=JSON.stringify({p:store.state().projects,w:store.state().milestoneWarnings,n:store.state().notices});
 const host=document.querySelector('app-contract-milestones');[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='新增合同里程碑').click();await new Promise(r=>setTimeout(r,50));
 const fill=(label,value)=>{const e=host.querySelector('[aria-label="'+label+'"]');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));};fill('里程碑名称','第三批交付约定');fill('里程碑日期','2026-11-30');fill('里程碑提前天数','0');const select=host.querySelector('select');select.value='demo-person-sales-zhang';select.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,50));[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存合同里程碑').click();await new Promise(r=>setTimeout(r,50));const row=cmp.rows().find(r=>r.name==='第三批交付约定');window.m64={id:row?.id,createdAt:row?.createdAt,side};return {ok:!cmp.editing()&&row?.warningLeadDays===0&&row.ownerPersonId==='demo-person-sales-zhang'&&Math.abs(Date.now()-Date.parse(row.createdAt))<30000,row};`,
  );
  const row = await evaluate('return window.m64;');
  const id = JSON.stringify(row.id);
  await check(
    '拒绝非法日期、空负小数天数及错误合同和人员关联',
    `${comp}const good={...cmp.rows().find(r=>r.id===${id}),expectedDataVersion:store.state().dataVersion};const before=JSON.stringify(store.state());const patches=[{dueDate:'2026-02-30'},{dueDate:'2026-11-30T00:00:00Z'},{warningLeadDays:null},{warningLeadDays:''},{warningLeadDays:-1},{warningLeadDays:1.5},{ownerPersonId:'张销售'},{contractId:'missing'},{contractId:store.state().contracts.find(c=>c.id!==good.contractId).id},{id:'CM-missing'}];return {ok:patches.every(p=>store.saveContractMilestone({...good,...p})===false)&&before===JSON.stringify(store.state())};`,
  );
  await check(
    '编辑保留同ID和创建时间，不创建计划预算提醒',
    `${comp}cmp.begin(cmp.rows().find(r=>r.id===${id}));cmp.draft.name='第三批交付约定已改期';cmp.draft.dueDate='2026-12-01';cmp.draft.warningLeadDays=7;cmp.save();const row=cmp.rows().find(r=>r.id===${id});return {ok:!cmp.editing()&&row.name==='第三批交付约定已改期'&&row.createdAt===${JSON.stringify(row.createdAt)}&&${JSON.stringify(row.side)}===JSON.stringify({p:store.state().projects,w:store.state().milestoneWarnings,n:store.state().notices}),row};`,
  );
  await check(
    '旧修订拒绝并保留输入',
    `${comp}cmp.begin(cmp.rows().find(r=>r.id===${id}));cmp.draft.name='旧输入';store.write(s=>s.contracts.find(c=>c.id===cmp.contractId()).note+='验收修订','推进修订');const before=JSON.stringify(store.state());cmp.save();const ok=cmp.editing()&&cmp.draft.name==='旧输入'&&before===JSON.stringify(store.state());cmp.cancel();return {ok};`,
  );
  await check(
    '无修改资格拒绝并保留输入',
    `${comp}cmp.begin(cmp.rows().find(r=>r.id===${id}));cmp.draft.name='无资格输入';const before=JSON.stringify(store.state());const original=store.canEdit;store.canEdit=()=>false;try{cmp.save()}finally{store.canEdit=original}const ok=cmp.editing()&&cmp.draft.name==='无资格输入'&&before===JSON.stringify(store.state());cmp.cancel();return {ok};`,
  );
  await check(
    '容量失败不改变业务历史操作进展，保留表单',
    `${comp}cmp.begin(cmp.rows().find(r=>r.id===${id}));cmp.draft.name='失败输入';const before=JSON.stringify(store.state());const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('验收失败','QuotaExceededError')};try{cmp.save()}finally{Storage.prototype.setItem=original}const ok=cmp.editing()&&cmp.draft.name==='失败输入'&&before===JSON.stringify(store.state());cmp.cancel();return {ok};`,
  );
  await check(
    '切换页签保留草稿且取消不清除其他编辑器标记',
    `${comp}cmp.begin(cmp.rows().find(r=>r.id===${id}));cmp.draft.name='页签保留草稿';const click=t=>[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===t).click();click('合同信息');click('协作与关联');store.setPendingInlineEdit(true,'acceptance-other');const kept=cmp.editing()&&cmp.draft.name==='页签保留草稿';cmp.cancel();const pending=store.pendingInlineEdit();store.setPendingInlineEdit(false,'acceptance-other');return {ok:kept&&pending};`,
  );
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['协作与关联'], timeout: 30000 });
  await check(
    '合同刷新恢复同ID',
    `${comp}return {ok:cmp.rows().some(r=>r.id===${id}&&r.dueDate==='2026-12-01')};`,
  );
  for (const projectId of fixture.projects) {
    await call('navigate_page', {
      type: 'url',
      url: base + '/projects/' + projectId + '?tab=overview',
    });
    await call('wait_for', { text: ['第三批交付约定已改期'], timeout: 30000 });
    await call('navigate_page', { type: 'reload' });
    await call('wait_for', { text: ['第三批交付约定已改期'], timeout: 30000 });
    await check(
      '项目只读同ID且刷新一致 ' + projectId,
      `${comp}return {ok:cmp.readonly()&&cmp.rows().some(r=>r.id===${id}&&r.dueDate==='2026-12-01')&&!document.querySelector('app-contract-milestones button'),ids:cmp.rows().map(r=>r.id)};`,
    );
  }
  await call('take_screenshot', {
    filePath: path.join(output, 'project-milestone.png'),
    fullPage: true,
  });
  report.result = '通过';
} catch (error) {
  report.error = String(error.stack || error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(output);
  await connection?.transport.close();
}
