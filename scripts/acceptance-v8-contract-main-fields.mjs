import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText } from './mcp-client.mjs';
import { root, base } from './browser-config.mjs';
const output = path.join(
  root,
  'artifacts',
  'v8-contract-main-fields',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
await fs.mkdir(output, { recursive: true });
const report = { issue: 62, result: '失败', checks: [] };
let connection;
let pageId;
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const result = toolText(await call('evaluate_script', { function: `async () => { ${body} }` }));
  const match = result.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, result);
  return JSON.parse(match[1]);
};
try {
  connection = await connect({ isolated: true });
  const created = toolText(
    await connection.call('new_page', { url: base + '/contracts', timeout: 30000 }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['合同管理'], timeout: 30000 });
  const id = await evaluate(
    `const store=ng.getComponent(document.querySelector('app-root')).store;return store.createContractDraft('DEMO-O003');`,
  );
  assert(id);
  await call('navigate_page', { type: 'url', url: base + '/contracts/' + id });
  await call('wait_for', { text: ['维护合同主字段'], timeout: 30000 });
  const check = async (name, body) => {
    const result = await evaluate(body);
    assert.equal(result.ok, true, JSON.stringify(result));
    report.checks.push({ name, result: '通过', evidence: result });
    console.log('PASS', name);
  };
  await check(
    '框架合同原值、隐藏来源大区与客户采用值保存',
    `
    const host=document.querySelector('app-contract-main-fields');const cmp=ng.getComponent(host);const store=cmp.store;
    const master=JSON.stringify(store.state().customers);
    const click=text=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text).click();
    const fill=(selector,value)=>{const e=host.querySelector(selector);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));};
    click('维护合同主字段');await new Promise(r=>setTimeout(r,50));
    fill('[aria-label="主字段合同名称"]','浏览器框架合同');fill('[aria-label="合同客户采用名称"]','合同采用客户抬头');
    const type=host.querySelector('#contract-main-alp_contracttype');type.selectedIndex=[...type.options].findIndex(o=>o.textContent.includes('框架合同'));type.dispatchEvent(new Event('change',{bubbles:true}));
    fill('[aria-label="所在大区记录ID"]','region-demo');fill('[aria-label="所在大区名称"]','演示大区');
    await new Promise(r=>setTimeout(r,50));click('保存合同主字段');await new Promise(r=>setTimeout(r,80));const c=store.state().contracts.find(x=>x.id===${JSON.stringify(id)});
    return {ok:!cmp.editing()&&c.crmFields.alp_contracttype===10&&c.customerAdoptedName==='合同采用客户抬头'&&JSON.stringify(store.state().customers)===master,contract:c.id,type:c.crmFields.alp_contracttype};`,
  );
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['浏览器框架合同'], timeout: 30000 });
  await check(
    '刷新恢复及一般销售合同保持数值枚举',
    `const cmp=ng.getComponent(document.querySelector('app-contract-main-fields'));const c=cmp.contract();const restored=c.crmFields.alp_contracttype===10&&c.customerAdoptedName==='合同采用客户抬头';cmp.begin();cmp.draft.alp_contracttype=30;cmp.save();await new Promise(r=>setTimeout(r,80));return {ok:restored&&!cmp.editing()&&cmp.contract().crmFields.alp_contracttype===30,type:cmp.contract().crmFields.alp_contracttype};`,
  );
  await check(
    '旧表单提交被拒绝且保留编辑输入',
    `const cmp=ng.getComponent(document.querySelector('app-contract-main-fields'));const store=cmp.store;cmp.begin();cmp.title='旧输入';store.saveContractMainFields(cmp.contract().id,{expectedDataVersion:store.state().dataVersion,title:'另一次已保存修改',crmFields:{}});cmp.save();await new Promise(r=>setTimeout(r,80));const ok=cmp.editing()&&cmp.title==='旧输入'&&cmp.contract().title==='另一次已保存修改';cmp.editing.set(false);store.setPendingInlineEdit(false);return {ok,toast:store.ui.toast()?.text};`,
  );
  await check(
    '浏览器容量失败不发布数据历史进展，表单保留',
    `const cmp=ng.getComponent(document.querySelector('app-contract-main-fields'));const store=cmp.store;cmp.begin();cmp.title='容量失败未保存';const before=JSON.stringify(store.state());const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('验收容量失败','QuotaExceededError')};try{cmp.save()}finally{Storage.prototype.setItem=original}await new Promise(r=>setTimeout(r,80));const ok=cmp.editing()&&cmp.title==='容量失败未保存'&&JSON.stringify(store.state())===before;return {ok,toast:store.ui.toast()?.text};`,
  );
  await call('take_screenshot', {
    filePath: path.join(output, 'contract-save-failure.png'),
    fullPage: true,
  });
  await evaluate(
    `const cmp=ng.getComponent(document.querySelector('app-contract-main-fields'));cmp.editing.set(false);cmp.store.setPendingInlineEdit(false);return true;`,
  );
  const beforeMissingRoute = await evaluate(
    `return ng.getComponent(document.querySelector('app-root')).store.state().operationEvents?.length || 0;`,
  );
  const missingId = 'V8-CONTRACT-NOT-FOUND-62';
  await call('navigate_page', { type: 'url', url: base + '/contracts/' + missingId });
  await call('wait_for', { text: ['找不到合同'], timeout: 30000 });
  await check(
    '无效合同ID显示请求身份和明确返回，不默认进入台账',
    `const panel=document.querySelector('[aria-label="找不到合同"]');const link=panel?.querySelector('a');return {ok:!!panel&&panel.innerText.includes(${JSON.stringify(missingId)})&&link?.getAttribute('href')==='/contracts'&&!document.querySelector('app-contract-main-fields')&&!document.querySelector('table'),requestedId:${JSON.stringify(missingId)}};`,
  );
  await call('take_screenshot', {
    filePath: path.join(output, 'contract-not-found.png'),
    fullPage: true,
  });
  await evaluate(`document.querySelector('[aria-label="找不到合同"] a').click();return true;`);
  await call('wait_for', { text: ['合同 / 客户'], timeout: 30000 });
  await check(
    '找不到合同可返回原台账且查看不生成进度',
    `const store=ng.getComponent(document.querySelector('app-root')).store;return {ok:location.pathname==='/contracts'&&!!document.querySelector('table')&&!document.querySelector('[aria-label="找不到合同"]')&&(store.state().operationEvents?.length||0)===${beforeMissingRoute},path:location.pathname};`,
  );
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
