import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
import { CRM_SUMMARY_FIELDS, CRM_DETAIL_FIELDS } from '../src/app/core/crm-quote-schema.ts';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4317';
const out = path.join(root, 'artifacts/v9-b08-completion/pages'),
  evidence = path.join(root, '../docs/verification/v9-b08-completion/pages');
await fs.mkdir(out, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const c = await connect({ isolated: true });
let pageId;
const checks = [];
const call = (name, args = {}) => c.call(name, { pageId, ...args });
const run = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  return JSON.parse(raw.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
const pause = () => new Promise((r) => setTimeout(r, 200));
const open = async (route, text) => {
  await call('navigate_page', { type: 'url', url: base + route });
  await call('wait_for', { text: [text], timeout: 30000 });
  await pause();
};
const record = (name, actual) => {
  checks.push({ name, actual, at: new Date().toISOString() });
  console.log('PASS ' + name);
};
const q = "ng.getComponent(document.querySelector('app-quote-workspace'))";
try {
  const raw = toolText(await c.call('new_page', { url: base + '/sales/quotes/DEMO-O008' }));
  pageId = Number(raw.match(/(\d+):.*\[selected\]/)[1]);
  await call('wait_for', { text: ['报价工作区'], timeout: 30000 });
  assert.equal(CRM_SUMMARY_FIELDS.length, 39);
  assert.equal(CRM_DETAIL_FIELDS.length, 37);
  const inventory = { summary: CRM_SUMMARY_FIELDS, detail: CRM_DETAIL_FIELDS };
  await fs.writeFile(
    path.join(evidence, 'field-inventory.json'),
    JSON.stringify(inventory, null, 2),
  );
  for (const [op, id, currency, products, trade] of [
    ['DEMO-O008', 'V9-QTE-01', 'EUR', 1, 749010000],
    ['DEMO-O003', 'V9-QTE-02', 'USD', 1, 749010001],
    ['DEMO-O014', 'V9-QTE-03', 'EUR', 2, 749010000],
  ]) {
    await open('/sales/quotes/' + op, '报价工作区');
    await run(
      `const c=${q},s=c.store;s.setRole('sales');const series=s.quoteSeries('${op}');let v=series.versions.find(v=>['草稿','退回补充'].includes(v.status));if(!v){const newId=s.createQuoteVersion(series.versions.at(-1).id,'B08三套目录真实验证');v=s.quoteVersion(newId);}if(!v)throw Error('No editable draft');c.selectedId.set(v.id);return v.id;`,
    );
    await pause();
    const result = await run(
      `const c=${q},s=c.store,d=s.crmQuoteDraft(c.current());d.items=[];Object.assign(d.crmFields,{transactioncurrencyid:'V9-QTE-CURRENCY-${currency}',alp_price_list:'${id}-PRICE',alp_salesbranch:'V9-QTE-ORG',alp_paymenttermsid:'V9-QTE-PAYMENT',alp_quotation_type:10,alp_trade_terms:${trade},alp_isintax:20,alp_tax_rate:0,closedon:'2026-11-09'});c.draft.set(d);for(let i=1;i<=${products};i++){c.addItem();const item=c.draft().items.at(-1);c.setLine(item.id,'alp_productcode','${id}-PRODUCT-'+i);c.setLine(item.id,'quantity',2);c.setLine(item.id,'alp_priceperunit',1200);}const ok=s.saveCrmQuote(c.draft());window.b08QuoteId=c.draft().id;return {ok,errors:c.errors(),saved:s.quoteVersion(window.b08QuoteId)};`,
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.saved.items.length, products);
    assert.equal(result.saved.crmFields.alp_price_list, id + '-PRICE');
    await call('navigate_page', { type: 'reload' });
    await call('wait_for', { text: ['报价工作区'], timeout: 30000 });
    await pause();
    const refreshed = await run(
      `return ${q}.store.quoteVersion(${JSON.stringify(result.saved.id)});`,
    );
    assert.deepEqual(refreshed, result.saved);
    record('QTE02/QTE03 三套目录真实保存刷新 ' + op, {
      op,
      currency,
      products,
      id: result.saved.id,
      priceList: refreshed.crmFields.alp_price_list,
    });
    await run(`${q}.activeTab.set('摘要');return true;`);
    await pause();
    const header = await run(
      `const c=${q};return {fields:[...document.querySelectorAll('app-crm-quote-field')].map(e=>{const f=ng.getComponent(e);return {name:f.field().name,readonly:f.readonly(),choices:f.references().map(r=>r.id)}}),hidden:c.summaryGroups.flatMap(g=>c.summaryFields(g)).some(f=>f.name==='msdyn_ordertype')};`,
    );
    assert.equal(header.hidden, false);
    for (const name of ['transactioncurrencyid', 'alp_price_list', 'alp_salesbranch'])
      assert.equal(header.fields.find((f) => f.name === name).readonly, true);
    assert.deepEqual(header.fields.find((f) => f.name === 'customerid').choices, [
      result.saved.customerId,
    ]);
    assert.match(
      await run('return document.body.innerText;'),
      /已有报价明细[，,].*币种.*价目表.*销售组织.*锁定/,
      'QTE04应显示字段锁定原因',
    );
    await run(`${q}.activeTab.set('报价明细');return true;`);
    await pause();
    const detail = await run(
      `const c=${q};return {fields:[...document.querySelectorAll('app-crm-quote-field')].map(e=>{const f=ng.getComponent(e);return {name:f.field().name,readonly:f.readonly(),choices:f.references().map(r=>r.id)}}),hidden:c.detailGroups.flatMap(g=>c.detailFields(g)).some(f=>f.name==='msdyn_linetype')};`,
    );
    assert.equal(detail.hidden, false);
    assert.ok(
      detail.fields.find((f) => f.name === 'alp_productcode').choices.includes(id + '-PRODUCT-1'),
    );
    const dynamic = await run(
      `const c=${q},old=structuredClone(c.draft());const d=structuredClone(old);d.crmFields.alp_sku_pricelevelid='${id}-SKU-PRICE';c.draft.set(d);const hidden=!c.summaryGroups.flatMap(g=>c.summaryFields(g)).some(f=>f.name==='alp_price_list');const sku=c.references({name:'alp_skuid',type:'lookup',targets:['alp_product_model']},{}).map(r=>r.id);c.draft.set(old);return {hidden,sku};`,
    );
    assert.equal(dynamic.hidden, true);
    assert.ok(dynamic.sku.includes(id + '-PRODUCT-1-SKU'));
    // Explicit controlled input: the SKU price list is an inherited readonly source,
    // not a new editable UI field. Selection/save/reload below use the real page API.
    await run(`const c=${q},state=structuredClone(c.store.state()),v=state.quoteSeries.flatMap(s=>s.versions).find(v=>v.id===${JSON.stringify(result.saved.id)});v.crmFields.alp_sku_pricelevelid='${id}-SKU-PRICE';c.store.state.set(state);c.draft.set(c.store.crmQuoteDraft(c.store.quoteVersion(v.id)));return true;`);
    await pause();
    const skuSaved=await run(`const c=${q};for(let i=0;i<${products};i++){const item=c.draft().items[i];c.setLine(item.id,'alp_skuid','${id}-PRODUCT-'+(i+1)+'-SKU');c.setLine(item.id,'alp_productcode','${id}-PRODUCT-'+(i+1));}const ok=c.store.saveCrmQuote(c.draft());return {ok,saved:c.store.quoteVersion(${JSON.stringify(result.saved.id)}),errors:c.errors()};`);
    assert.equal(skuSaved.ok,true);assert.deepEqual(skuSaved.errors,[]);
    assert.equal(skuSaved.saved.crmFields.alp_sku_pricelevelid,id+'-SKU-PRICE');
    for(let i=0;i<products;i++){assert.equal(skuSaved.saved.items[i].crmFields.alp_skuid,id+'-PRODUCT-'+(i+1)+'-SKU');assert.equal(skuSaved.saved.items[i].crmFields.alp_productcode,id+'-PRODUCT-'+(i+1));}
    await call('navigate_page',{type:'reload'});await call('wait_for',{text:['报价工作区'],timeout:30000});await pause();
    const skuFresh=await run(`return ${q}.store.quoteVersion(${JSON.stringify(result.saved.id)});`);
    assert.deepEqual(skuFresh,skuSaved.saved);
    record('QTE02/SKU 三套只读合法来源的SKU选择、产品关联、保存刷新 '+op,{sourcePreparation:'受控合法SKU价目表源；未开放只读字段编辑',id:skuFresh.id,items:skuFresh.items.map(x=>x.crmFields),snapshot:skuFresh.crmReferenceSnapshot});
    await run(`${q}.customerResult(${q}.current());return true;`);
    await pause();
    const dialog = await run(
      `const c=${q},d=c.store.ui.dialog();return {fields:d.fields.map(f=>({key:f.key,type:f.type,options:f.options,optionsOnly:f.optionsOnly})),allowed:c.store.customer(c.current().customerId).contacts.map(p=>p.name)};`,
    );
    assert.deepEqual(dialog.fields.find((f) => f.key === 'person').options, dialog.allowed);
    assert.equal(dialog.fields.find((f) => f.key === 'person').optionsOnly, true);
    await run(`${q}.store.ui.dialog.set(null);return true;`);
    record('QTE01/QTE04 字段只读隐藏、动态SKU、归属与联系人过滤 ' + op, {
      header,
      detail,
      dynamic,
      dialog,
    });
  }
  await run(`${q}.store.setRole('pm');return true;`);
  await open('/projects/DEMO-P001?tab=plans', '内部WBS计划');
  const component = "ng.getOwningComponent(document.querySelector('h1'))";
  const types = ['产研来源', '要货发货', '调试备件', 'FAT测试', '开票回款'];
  for (const type of ['内部WBS', '客户主节点', ...types]) {
    await run(`${component}.planType.set('${type}');return true;`);
    await pause();
    const layout = await run(
      `return {type:${component}.planType(),overflow:document.documentElement.scrollWidth>innerWidth+1,heading:[...document.querySelectorAll('h2')].map(x=>x.textContent.trim()),tables:[...document.querySelectorAll('table')].map(e=>({label:e.getAttribute('aria-label'),font:getComputedStyle(e).fontSize})),text:document.body.innerText};`,
    );
    assert.equal(layout.type, type);
    assert.equal(layout.overflow, false);
    assert.ok(layout.text.includes(type));
    await call('take_screenshot', {
      filePath: path.join(out, 'plan-' + type + '.png'),
      fullPage: false,
    });
    record('VIS05 七计划含五子页签实际逐一查看 ' + type, layout);
  }
  const readOnly = await run(
    `const c=${component},s=c.store,p=s.project('DEMO-P001');s.setRole('pm');const source=p.plans.find(p=>p.type==='产研来源'),fat=p.plans.find(p=>p.type==='FAT测试');if(!source||!fat)throw Error('missing seeded plan');const before=JSON.stringify(s.state());const refused=s.savePlan(p.id,{...source,name:'非法改产研'});const original=s.project(p.id).plans.find(p=>p.id===source.id).name;const noSourceChange=JSON.stringify(s.state())===before;const fatCopy={...fat,status:'已完成',actual:'2026-10-10',result:'合格'};s.state().attachments=s.state().attachments.filter(a=>!(a.entityId===p.id&&a.kind==='FAT报告'));const fatBefore=JSON.stringify(s.state());const fatResult=s.savePlan(p.id,fatCopy);return {refused,noSourceChange,original,fatResult,noFatChange:JSON.stringify(s.state())===fatBefore,feedback:s.ui.toast()?.text};`,
  );
  assert.equal(readOnly.refused, false);
  assert.equal(readOnly.noSourceChange, true);
  assert.equal(readOnly.fatResult, false);
  assert.equal(readOnly.noFatChange, true);
  assert.match(readOnly.feedback, /FAT|报告/);
  record('VIS07 产研保存拒绝及缺FAT报告不能完成（报告移除为明确受控输入）', readOnly);
  const finance = await run(
    `const c=${component};c.planType.set('开票回款');const p=c.project().plans.find(p=>p.type==='开票回款');c.store.setRole('finance');if(!c.store.loadFinance(c.id()))throw Error('finance load failed');c.store.setRole('pm');const before=JSON.stringify(c.store.state().financeSnapshots);c.editPlan(p);const fields=c.store.ui.dialog().fields.map(f=>f.key);return {fields,hasReadonlySource:!fields.some(k=>['invoiceId','sourceSystem','actualReceived','financeReference','invoiceStatus'].includes(k)),financeUnchanged:before===JSON.stringify(c.store.state().financeSnapshots)};`,
  );
  assert.equal(finance.hasReadonlySource, true);
  assert.equal(finance.financeUnchanged, true);
  record('VIS07 开票回款编辑表单没有实际财务来源修改入口，财务引用保持只读', finance);
  await run(`${component}.store.ui.dialog.set(null);return true;`);
  await open('/sales/solutions/DEMO-O009', '真实方案文件与首次期限');
  const simulated = await run(
    `const p=ng.getComponent(document.querySelector('app-solution-input-panel'));return {text:document.querySelector('app-solution-input-panel').innerText,origins:p.view().workspace?.versions.map(v=>v.origin)??[]};`,
  );
  assert.match(simulated.text, /旧模拟记录保留原含义/);
  assert.match(simulated.text, /历史留存/);
  assert.match(simulated.text, /历史未评分/);
  assert.ok(simulated.origins.length && simulated.origins.every((o) => o === 'legacy'));
  record('DAT04 历史预置资料明确标历史留存和旧模拟，不冒充本轮定稿操作', simulated);
  await open('/projects/board', '重点 TOP5');
  const board = "ng.getComponent(document.querySelector('app-project-board'))";
  const mixed = await run(
    `const b=${board};window.b08OriginalBoard=structuredClone(b.store.state());window.b08RawBusiness=JSON.stringify(b.store.workspaceStorage.readWorkspace(b.store.v9CommandTarget().workspaceId));const state=structuredClone(window.b08OriginalBoard),p=state.projects.find(p=>p.id==='DEMO-P001'),base=p.plans.find(p=>p.type==='内部WBS');p.pm='';p.plans=[{...base,id:'B08-OPEN',name:'B08受控关键延期',status:'进行中',end:'2026-10-10',actual:'',budgetAmount:100,budgetCurrency:'CNY'},{...base,id:'B08-DONE',name:'B08受控逾期已完成',status:'已完成',end:'2026-10-10',actual:'2026-10-12',budgetAmount:0,budgetCurrency:'CNY'}];state.budgetDemoExpenses=[{expenseId:'B08-MIXED',projectId:p.id,planId:'B08-OPEN',scope:'全项目',amountMinor:12000,currency:'CNY',date:'2026-10-10',summary:'受控超支费用',sourceRecordId:'B08',batchId:'B08',cutoff:'2026-10-17',origin:'simulated'}];state.budgetComparisonSources=[{projectId:p.id,currency:'CNY',expenseIds:['B08-MIXED'],scope:'全项目',cutoff:'2026-10-17',complete:true}];b.store.state.set(state);b.clearFilters();b.change('query',p.opportunityId);return {businessId:p.opportunityId};`,
  );
  await pause();
  const mixedResult = await run(
    `const b=${board},exceptions=b.management().exceptions;return {exceptions,rendered:document.querySelector('.exception-list').innerText,completed:b.statistics().items.filter(i=>i.sourceRecordId==='DEMO-P001:B08-DONE'),unwritten:window.b08RawBusiness===JSON.stringify(b.store.workspaceStorage.readWorkspace(b.store.v9CommandTarget().workspaceId))};`,
  );
  assert.ok(mixedResult.exceptions.some((e) => e.reason.includes('B08受控关键延期')));
  assert.ok(mixedResult.exceptions.some((e) => e.category === 'over-budget'));
  assert.ok(mixedResult.exceptions.some((e) => e.reason === '项目负责人待补' && e.owner === null));
  assert.ok(!mixedResult.exceptions.some((e) => e.reason.includes('B08受控逾期已完成')));
  assert.match(mixedResult.rendered, /B08受控关键延期/);
  assert.match(mixedResult.rendered, /已超预算/);
  assert.match(mixedResult.rendered, /项目负责人待补/);
  assert.equal(mixedResult.unwritten, true);
  await run(`document.querySelector('.exception-list').scrollIntoView();return true;`);
  await call('take_screenshot', {
    filePath: path.join(out, 'mixed-exceptions.png'),
    fullPage: false,
  });
  record('BRD03 受控同屏延期/已完成/缺责任/超支，异常及完成事实分开且不写业务', mixedResult);
  await run(
    `${board}.store.state.set(window.b08OriginalBoard);${board}.clearFilters();return true;`,
  );
  await fs.writeFile(
    path.join(evidence, 'report.json'),
    JSON.stringify({ actor: 'CODEX', checks }, null, 2),
  );
} catch (error) {
  console.error(error);
  await fs.writeFile(
    path.join(evidence, 'failure.json'),
    JSON.stringify(
      {
        error: String(error),
        page: await run('return {url:location.href,text:document.body.innerText};').catch(
          () => null,
        ),
        checks,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await c.client.close();
  await c.transport.close();
}
