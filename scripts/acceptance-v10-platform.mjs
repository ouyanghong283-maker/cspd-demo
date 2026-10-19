import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
import { base } from './browser-config.mjs';
const output = path.join(
  root,
  'artifacts/v10-02-01',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await fs.mkdir(output, { recursive: true });
const browser = await connect({ isolated: true });
let pageId;
const call = (name, args = {}) => browser.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async () => { ${body} }` }));
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
  assert.ok(match, raw);
  return JSON.parse(match[1]);
};
const panel = `ng.getComponent(document.querySelector('app-v10-baseline-panel'))`;
const readStorage = `JSON.stringify(Object.fromEntries(Object.entries({...localStorage}).filter(([k]) => k !== 'cspd-demo-v2:editing-lease').sort(([a],[b])=>a.localeCompare(b))))`;
const results = [];
try {
  const page = toolText(
    await browser.call('new_page', { url: base + '/projects/board/finance?tab=budget' }),
  );
  pageId = Number(page.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['当前页签：budget'], timeout: 30000 });
  const before = await evaluate(`return ${readStorage};`);
  for (const [route, tab] of [
    ['/projects/board/finance?tab=margin', 'margin'],
    ['/projects/board/finance?tab=budget', 'budget'],
    ['/projects/board/finance?tab=finance', 'finance'],
    ['/projects/board/exceptions?tab=delivery', 'delivery'],
    ['/projects/board/exceptions?tab=management', 'management'],
    ['/projects/board', 'board'],
  ]) {
    await call('navigate_page', { url: base + route });
    await call('wait_for', { text: ['当前页签：' + tab], timeout: 30000 });
    await call('navigate_page', { type: 'reload' });
    await call('wait_for', { text: ['当前页签：' + tab], timeout: 30000 });
    const result = await evaluate(
      `const p=${panel}; const s=p.read.snapshot(); return {route:location.pathname,tab:p.target().tab,context:s.context,body:document.body.innerText.slice(0,2400)};`,
    );
    assert.equal(result.tab, tab);
    assert.ok(result.context.workspaceId !== 'unavailable');
    results.push(result);
  }
  await call('navigate_page', {
    url: base + '/projects/board/exceptions?tab=INVALID&scope=INVALID&status=INVALID',
  });
  await call('wait_for', { text: ['页签条件无效，已恢复默认页签'], timeout: 30000 });
  const injected = await evaluate(
    `const p=${panel}; p.read.setSources({finance:'unavailable'}); await new Promise(r=>setTimeout(r,100)); return {context:p.read.context(),status:p.exceptions().status,count:p.exceptions().delivery.projectCount};`,
  );
  assert.equal(injected.context.sources.finance, 'unavailable');
  assert.notEqual(injected.status, 'unavailable');
  assert.ok(injected.count > 0);
  const sameVersion = await evaluate(
    `const p=${panel};const s=ng.getComponent(document.querySelector('app-root')).store;const old=p.read.context();const c=s.state();s.state.set({...c,dateMode:'comparison'});await new Promise(r=>setTimeout(r,100));const next=p.read.context();s.state.set(c);return {old,next};`,
  );
  assert.equal(sameVersion.old.dataVersion, sameVersion.next.dataVersion);
  assert.equal(sameVersion.next.dates.planObservationDate, '2026-10-22');
  assert.notEqual(sameVersion.old.contextRevision, sameVersion.next.contextRevision);
  const fileFault = await evaluate(`
    const p=${panel}; const store=ng.getComponent(document.querySelector('app-root')).store;
    const original=store.state();
    store.state.set({...original,attachments:[...original.attachments,
      {...original.attachments[0],id:'V10-FAULT',entityId:original.projects[0].id,kind:'客户签字清单',fileId:'V10-ABSENT'}]});
    await new Promise(r=>setTimeout(r,100));
    await p.read.refreshFiles();
    const missing=p.read.context().fileAvailability['V10-ABSENT'];
    const originalOpen=indexedDB.open;
    try {
      indexedDB.open=function(name,...args) { if(name==='cspd-demo-files-v2') throw Error('故障注入：文件库不可读'); return originalOpen.call(this,name,...args); };
      await p.read.refreshFiles();
      return {missing,blocked:p.read.context().fileAvailability['V10-ABSENT'],dataVersion:p.read.context().dataVersion,originalVersion:original.dataVersion};
    } finally { indexedDB.open=originalOpen; store.state.set(original); }
  `);
  assert.equal(fileFault.missing, 'missing');
  assert.equal(fileFault.blocked, 'unavailable');
  assert.equal(fileFault.dataVersion, fileFault.originalVersion);
  const nextHref = await evaluate(`return ${panel}.projectLinks()[0].href;`);
  await call('navigate_page', { url: base + nextHref });
  await call('wait_for', { text: ['财务信息'], timeout: 30000 });
  const project = await evaluate(
    `const c=ng.getComponent(document.querySelector('router-outlet').nextElementSibling);return {href:location.pathname+location.search,tab:c.tab?.()};`,
  );
  assert.equal(project.tab, '财务信息');
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['财务信息'], timeout: 30000 });
  const after = await evaluate(`return ${readStorage};`);
  assert.equal(after, before, '入口消费不应写入业务存储');
  await call('navigate_page', { url: base + '/projects/board/finance?tab=margin' });
  await call('wait_for', { text: ['当前页签：margin'], timeout: 30000 });
  const financeFailure = await evaluate(
    `const p=${panel};p.read.setSources({finance:'unavailable'});await new Promise(r=>setTimeout(r,100));return {status:p.finance().status,summary:p.finance().summary};`,
  );
  assert.deepEqual(financeFailure, { status: 'unavailable', summary: null });
  await call('take_screenshot', {
    filePath: path.join(output, 'finance-placeholder.png'),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        results,
        injected,
        sameVersion,
        fileFault,
        project,
        financeFailure,
        storageUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      output,
      entries: results.length,
      refreshes: results.length,
      storageUnchanged: true,
    }),
  );
} finally {
  await browser.client.close();
  await browser.transport.close();
}
