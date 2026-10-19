import assert from 'node:assert/strict';
import { boardAfterQuote, captureFinalization } from './browser-v9-b08-checks.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4325';
const out = path.resolve(root, process.env.CSPD_ARTIFACT_DIR || 'artifacts/v9-b05-codex');
const evidence = path.resolve(
  root,
  process.env.CSPD_EVIDENCE_DIR || '../docs/verification/v9-b05-codex',
);
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
  await fs.writeFile(filename, `B05 actual bytes ${kind} ${n}`);
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
    `${p}.store.setRole('solution');${p}.store.saveProductNeed('DEMO-O008',{id:'B05-NEED',model:'PCS',quantity:2,unit:'台'});return true;`,
  );
  await press('设置期限与负责人');
  await run(
    `const f=document.querySelector('app-solution-input-panel form');for(const [name,value] of Object.entries({pm:'demo-person:王项目',owner:'demo-person:周方案',deadline:'2026-10-20',reason:'第五批首次期限'})){const e=f.querySelector('[name='+name+']');e.value=value;e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}return true;`,
  );
  await press('保存期限');
  assert.equal(await run(`return ${p}.schedule().schedule.deadlineDate;`), '2026-10-20');
  record('键盘与真实表单设置期限责任');
  await press('调整期限');
  await run(
    `const f=document.querySelector('app-solution-input-panel form');for(const [name,value]of Object.entries({deadline:'2026-10-21',reason:'第五批明确调整原因'})){const e=f.querySelector('[name='+name+']');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}return true;`,
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
  if (process.env.CSPD_B08_COMPLETION === '1')
    await captureFinalization({ run, call, p, out, record }, 'first', 'current');
  const order = await run(
    `const e=document.querySelector('app-solution-input-panel');return {schedule:!!(e.querySelector('[aria-label="首次期限"]').compareDocumentPosition(e.querySelector('app-solution-finalization-summary'))&Node.DOCUMENT_POSITION_FOLLOWING),summary:!!(e.querySelector('app-solution-finalization-summary').compareDocumentPosition(e.querySelector('.outputs'))&Node.DOCUMENT_POSITION_FOLLOWING)};`,
  );
  assert.deepEqual(order, { schedule: true, summary: true });
  record('责任期限→首次及当前状态→文件主操作顺序', order);
  await upload('proposal', '技术方案', 'pptx', 2);
  assert.equal(await run(`return ${p}.finalization().status;`), 'stale');
  assert.deepEqual(await run(`return ${p}.finalization().first;`), first);
  record('真实改版保留首次成绩并明确当前待重新定稿');
  if (process.env.CSPD_B08_COMPLETION === '1')
    await captureFinalization({ run, call, p, out, record }, 'stale', 'stale');
  await finalize();
  assert.equal(await run(`return ${p}.finalization().events.length;`), 2);
  record('真实重新定稿保留两次组合历史');
  if (process.env.CSPD_B08_COMPLETION === '1')
    await captureFinalization({ run, call, p, out, record }, 'refinal', 'current');
  for (const route of [
    '/sales/solutions/DEMO-O008',
    '/sales/detail/DEMO-O008?tab=' + encodeURIComponent('方案'),
  ]) {
    await open(route, '真实方案文件与首次期限');
    for (const width of [1920, 1440, 1024, 768, 390]) {
      await call('resize_page', { width, height: 1000 });
      const layout = await run(
        `for(const d of document.querySelectorAll('app-solution-input-panel details'))d.open=true;return {overflow:document.documentElement.scrollWidth>innerWidth+1,panels:document.querySelectorAll('app-solution-input-panel').length,files:document.querySelectorAll('app-solution-input-panel input[type=file]').length};`,
      );
      assert.deepEqual(layout, { overflow: false, panels: 1, files: 4 });
      record('两入口五宽当前及历史 ' + route + ' ' + width, layout);
      if (route.startsWith('/sales/solutions'))
        await call('take_screenshot', {
          filePath: path.join(out, `solution-${width}.png`),
          fullPage: true,
        });
    }
  }
  await open('/sales/solutions/DEMO-O008', '真实方案文件与首次期限');
  const before = await run(`await ${p}.check();return JSON.stringify(${p}.store.state());`);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  await run(`await ${p}.check();return true;`);
  assert.equal(await run(`return JSON.stringify(${p}.store.state());`), before);
  record('刷新同一统一结构，浏览不保存业务或重新补种');
  // 原始文件库边界故障注入，历史业务快照保持。
  const missing = await run(
    `const p=${p};window.b05Old=p.current('proposal');const f=p.current('proposal').file;const row=await p.files.get(f.blobId);const {blob,...identity}=row;await p.files.removeOwned(f.blobId,identity);await p.check();return {availability:p.availability()[window.b05Old.id],first:p.finalization().first,events:p.finalization().events.length};`,
  );
  assert.equal(missing.availability, 'missing');
  assert.deepEqual(missing.first, first);
  record('仅元数据恢复式缺件不抹去首次及上传历史', missing);
  const failed = await run(
    `const p=${p},s=p.finalization();return p.confirmFinalization({opportunityId:p.opportunityId(),fourVersionIds:s.fourVersionIds,productNeedRevision:s.productNeedRevision,ownerPersonId:s.schedule.owner.personId,scheduleRevision:s.schedule.revision,actingOnBehalf:true},{...p.store.v9CommandTarget(),operationId:'B05-MISSING'});`,
  );
  assert.equal(failed.status, 'rejected');
  assert.match(failed.message, /缺失/);
  record('缺Blob公开定稿拒绝');
  await upload('proposal', '技术方案', 'pptx', 3);
  assert.equal(await run(`return ${p}.current('proposal').number;`), 3);
  await finalize();
  record('缺件真实重传成为新版后重新定稿');
  const unreadable = await run(
    `const p=${p},get=p.files.get;p.files.get=async()=>{throw Error('db unavailable')};try{await p.check();return p.availability()[p.current('proposal').id]}finally{p.files.get=get;await p.check()}`,
  );
  assert.equal(unreadable, 'unavailable');
  record('文件不可读与确实缺失分别反馈');
  // 当前工作区保存副本→重开新轮→续接副本，复用公开入口，保留引用防止错误回收。
  const archive = await run(
    `const p=${p},t=p.store.v9CommandTarget();const saved=p.store.workspaceStorage.createAndActivateRound(structuredClone(p.store.state()));p.store.workspaceStorage.activateWorkspace(t.workspaceId);window.b05Archive=saved.workspaceId;return {id:saved.workspaceId,before:JSON.stringify(p.store.state()),round:t.roundId};`,
  );
  assert.equal(await run(`return ${p}.store.takeOverEditing();`), true);
  await pause();
  assert.equal(await run(`return JSON.stringify(${p}.store.state());`), archive.before);
  record('实际接管保持统一业务历史');
  const reset = await run(
    `const p=${p};await p.store.reset();return {schema:p.store.state().storageSchemaVersion,events:p.store.state().operationEvents.length,round:p.store.state().roundId,real:p.store.state().solutionWorkspaces.flatMap(w=>w.versions).filter(v=>v.origin==='operation').length};`,
  );
  assert.equal(reset.schema, 3);
  assert.equal(reset.events, 0);
  assert.equal(reset.real, 0);
  assert.notEqual(reset.round, archive.round);
  record('真实重开发布V9新轮，不复制旧上传和定稿', reset);
  assert.equal(
    await run(`return ${p}.store.resumeWorkspace(${JSON.stringify(archive.id)});`),
    true,
  );
  await pause();
  assert.equal(await run(`return JSON.stringify(${p}.store.state());`), archive.before);
  record('实际续接旧工作区保留稳定版本首次和核价历史');
  // 副本含原目标元数据，续接仍保留原工作区引用；报价采用需原工作区，恢复原目标。
  await run(
    `const p=${p};const ids=p.store.workspaceStorage.workspaceIds();const original=ids.find(id=>id!==${JSON.stringify(archive.id)}&&p.store.workspaceStorage.readWorkspace(id)?.roundId===${JSON.stringify(archive.round)});p.store.resumeWorkspace(original);return true;`,
  );
  await pause();
  await open('/sales/quotes/DEMO-O008', '报价工作区');
  const quoteId = await run(
    `const c=${q};const s=c.store;let original=s.quoteSeries('DEMO-O008').versions[0];const d=s.crmQuoteDraft(original);const catalog=s.crmQuoteCatalog();const scenario=catalog.references.find(r=>r.entity==='pricelevel'&&r.id.includes('v9'));Object.assign(d.crmFields,{transactioncurrencyid:catalog.references.find(r=>r.entity==='transactioncurrency'&&r.label.includes('EUR')).id,alp_price_list:scenario?.id??catalog.prices.find(x=>!x.sku&&x.guide>0).priceListId,alp_quotation_type:10,alp_trade_terms:749010000,alp_paymenttermsid:catalog.references.find(r=>r.entity==='alp_paymentterms'&&r.data.statecode===0&&r.data.alp_payment_state===20).id,alp_salesbranch:catalog.references.find(r=>r.entity==='alp_sales_organization'&&r.data.alp_salesorganizationcode==='8210').id,alp_isintax:20,alp_tax_rate:0,closedon:'2026-11-09'});window.b05Draft=d;return d.id;`,
  );
  // 页面公开字段命令运行同一产品/计价规则。
  await run(
    `const c=${q};c.draft.set(window.b05Draft);const cat=c.store.crmQuoteCatalog();const point=cat.prices.find(r=>r.priceListId===window.b05Draft.crmFields.alp_price_list&&!r.sku&&r.guide>0);c.addItem();const item=c.draft().items.at(-1);c.setLine(item.id,'alp_productcode',point.productId);c.setLine(item.id,'quantity',2);c.setLine(item.id,'alp_priceperunit',Number(point.guide)*100+10000);return true;`,
  );
  await press('保存草稿', 'app-quote-workspace');
  const saved = await run(
    `return {schema:${q}.store.quoteVersion(${JSON.stringify(quoteId)}).crmSchemaVersion,errors:${q}.errors(),items:${q}.store.quoteVersion(${JSON.stringify(quoteId)}).items.length};`,
  );
  assert.deepEqual(saved.errors, []);
  assert.equal(saved.schema, 1);
  assert.ok(saved.items);
  record('真实报价页面保存完整目录草稿，无定稿采用也可准备', saved);
  await press('提交审核', 'app-quote-workspace');
  assert.equal(
    await run(`return ${q}.store.quoteVersion(${JSON.stringify(quoteId)}).status;`),
    '草稿',
  );
  record('真实页面未采用时提交拦截');
  await press('核对当前有效定稿', 'app-quote-solution-basis-panel');
  assert.ok(await run(`return !!${b}.prepared();`));
  await press('确认采用此方案', 'app-quote-solution-basis-panel');
  record('真实页面显式采用当前有效定稿');
  const originalPrices = await run(
    `return JSON.stringify(${q}.store.quoteVersion(${JSON.stringify(quoteId)}).items);`,
  );
  await press('提交审核', 'app-quote-workspace');
  assert.equal(
    await run(`return ${q}.store.quoteVersion(${JSON.stringify(quoteId)}).status;`),
    '待模拟审核',
  );
  record('采用后真实页面提交审核成功');
  const stale = await run(
    `const s=${q}.store;window.b05Prices=JSON.stringify(s.quoteVersion(${JSON.stringify(quoteId)}).items);const sale=s.sale('DEMO-O008');const n=sale.productNeeds[0];s.saveProductNeed(sale.id,{...n,quantity:n.quantity+1});const before=JSON.stringify(s.state());const approved=s.reviewQuote(${JSON.stringify(quoteId)},'模拟审核通过','尝试旧依据');return {approved,unchanged:JSON.stringify(s.state())===before,returned:s.reviewQuote(${JSON.stringify(quoteId)},'退回补充','重新确认当前方案')};`,
  );
  assert.deepEqual(stale, { approved: false, unchanged: true, returned: true });
  record('真实来源变化阻止批准但允许原退回路径', stale);
  await open('/sales/solutions/DEMO-O008', '真实方案文件与首次期限');
  await run(`await ${p}.check();return true;`);
  await finalize();
  assert.deepEqual(await run(`return ${p}.finalization().first;`), first);
  record('需求变更重定稿仍保持首次成绩');
  await open('/sales/quotes/DEMO-O008', '报价工作区');
  await press('提交审核', 'app-quote-workspace');
  assert.equal(
    await run(`return ${q}.store.quoteVersion(${JSON.stringify(quoteId)}).status;`),
    '退回补充',
  );
  record('重新定稿不自动采用，报价仍拒绝提交');
  await press('核对当前有效定稿', 'app-quote-solution-basis-panel');
  await press('确认采用此方案', 'app-quote-solution-basis-panel');
  await press('提交审核', 'app-quote-workspace');
  assert.equal(
    await run(`return ${q}.store.quoteVersion(${JSON.stringify(quoteId)}).status;`),
    '待模拟审核',
  );
  assert.equal(
    await run(`return JSON.stringify(${q}.store.quoteVersion(${JSON.stringify(quoteId)}).items);`),
    originalPrices,
  );
  record('显式重新采用恢复审核，原产品价格配置保留');
  const fileFeedback = await run(
    `const p=${b};for(const v of p.view().adoptedBasis.versionMetadataSnapshot){const row=await p.files.get(v.file.blobId);if(row){const {blob,...identity}=row;await p.files.removeOwned(v.file.blobId,identity)}}await p.check();return {business:p.view().submitIssues.length,files:p.view().fileIssues.length,notice:document.querySelector('app-quote-solution-basis-panel').innerText.includes('文件缺失或不可读时')};`,
  );
  assert.deepEqual(fileFeedback, { business: 0, files: 4, notice: true });
  record('已采用报价的文件异常独立提示，与公开命令的业务身份核验一致', fileFeedback);
  const lock = await run(
    `const s=${q}.store,id=${JSON.stringify(quoteId)};const approved=s.reviewQuote(id,'模拟审核通过','真实浏览器复核');const person=s.customer(s.quoteVersion(id).customerId).contacts[0].name;const sent=s.recordQuoteSent(id,'2026-10-10','邮件',person,'第五批真实浏览器演示凭据');const accepted=s.recordCrmCustomerDecision(id,'接受',person,'客户回函','2026-10-10');const old=JSON.stringify(s.quoteVersion(id));const sale=s.sale('DEMO-O008'),need=sale.productNeeds[0];s.saveProductNeed(sale.id,{...need,quantity:need.quantity+1});const before=JSON.stringify(s.state());const locked=s.lockQuote(id);return {approved,sent,accepted,locked,unchanged:JSON.stringify(s.state())===before,historical:JSON.stringify(s.quoteVersion(id))===old};`,
  );
  assert.deepEqual(lock, {
    approved: true,
    sent: true,
    accepted: true,
    locked: false,
    unchanged: true,
    historical: true,
  });
  record('浏览器真实审核发出接受后来源过期，主管锁定拒绝且历史不回写', lock);
  if (process.env.CSPD_B08_COMPLETION === '1')
    await boardAfterQuote({ run, record, p, q, open, press, call, out });
  const snapshot = await run(`return JSON.stringify(${q}.store.state());`);
  await run(
    `const s=${q}.store;s.editingLease.release();s.editingWritable.set(false);return true;`,
  );
  const readonly = await run(
    `const s=${q}.store;return {editable:s.v9CanEdit(),submitted:s.submitQuote(${JSON.stringify(quoteId)}),unchanged:JSON.stringify(s.state())===${JSON.stringify(snapshot)}};`,
  );
  assert.deepEqual(readonly, { editable: false, submitted: false, unchanged: true });
  record('失去修改权后公开命令不发布部分成功', readonly);
  await call('take_screenshot', { filePath: path.join(out, 'quote-390.png'), fullPage: true });
  const console = toolText(await call('list_console_messages', { types: ['error'] }));
  assert.doesNotMatch(console, /NG0\d+|ReferenceError|TypeError|ERROR RuntimeError/);
  record('浏览器无Angular表单与运行时错误');
  await fs.writeFile(
    path.join(evidence, 'browser-report.json'),
    JSON.stringify({ passed: checks.length, checks }, null, 2) + '\n',
  );
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
