import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText } from './mcp-client.mjs';
import { base, root } from './browser-config.mjs';
const output = path.join(root, 'artifacts', 'contract-redesign');
await fs.mkdir(output, { recursive: true });
const c = await connect({ isolated: true });
let pageId;
const report = [];
const call = (name, args = {}) => c.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const result = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  return JSON.parse(result.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
const check = async (name, body) => {
  const result = await evaluate(body);
  assert.equal(result.ok, true, JSON.stringify(result));
  report.push({ name, ...result });
  console.log('PASS', name);
};
try {
  const page = toolText(
    await c.call('new_page', { url: base + '/contracts/DEMO-CON001', timeout: 30000 }),
  );
  pageId = Number(page.match(/(\d+):.*\[selected\]/)[1]);
  await call('wait_for', { text: ['青山储能一期设备采购合同'], timeout: 30000 });
  await check(
    '合同信息与真实状态一致，查看不改写存储',
    `const s=ng.getComponent(document.querySelector('app-root')).store;window.contractBefore=JSON.stringify(s.state());const text=document.querySelector('.contract-workspace').innerText;s.ui.toast.set(null);return {ok:document.querySelector('.party-grid a').getAttribute('href')==='/sales/customers/DEMO-C005'&&document.querySelector('.contract-summary-list a').getAttribute('href')==='/sales/detail/DEMO-O005'&&text.includes('¥2,480,000')&&text.includes('沃太能源股份有限公司')&&text.includes('历史登记')&&text.includes('尚未登记签约凭据')&&!text.includes('alp_contractcode'),text:text.slice(0,1000)};`,
  );
  if (!process.env.CSPD_SKIP_SCREENSHOTS)
    await call('take_screenshot', { filePath: path.join(output, 'desktop.png'), fullPage: true });
  await check(
    '客户信息分组显示模拟邮箱地址',
    `[...document.querySelectorAll('.group-nav button')].find(e=>e.textContent.trim()==='客户信息').click();await new Promise(r=>setTimeout(r,100));return {ok:document.querySelector('.field-group:not([hidden])').innerText.includes('procurement@yuanjing.example.com')};`,
  );
  await check(
    '付款分期金额合计匹配合同金额',
    `[...document.querySelectorAll('.contract-tabs button')].find(e=>e.textContent.trim()==='商务与支付').click();await new Promise(r=>setTimeout(r,100));const text=document.querySelector('.payment-schedule').innerText;return {ok:text.includes('744,000')&&text.includes('1,488,000')&&text.includes('248,000'),text};`,
  );
  if (!process.env.CSPD_SKIP_SCREENSHOTS)
    await call('take_screenshot', { filePath: path.join(output, 'payment.png'), fullPage: true });
  await check(
    '协作关联保留项目和订单发票入口',
    `[...document.querySelectorAll('.contract-tabs button')].find(e=>e.textContent.trim()==='协作与关联').click();await new Promise(r=>setTimeout(r,100));const links=[...document.querySelectorAll('.contract-main-column a')].map(e=>e.getAttribute('href'));const s=ng.getComponent(document.querySelector('app-root')).store;return {ok:links.includes('/projects/DEMO-P001')&&links.includes('/contracts/DEMO-CON001/orders')&&JSON.stringify(s.state())===window.contractBefore,links};`,
  );
  await evaluate(
    `[...document.querySelectorAll('.contract-tabs button')].find(e=>e.textContent.trim()==='合同信息').click();return {ok:true};`,
  );
  await call('resize_page', { width: 390, height: 844 });
  await check(
    '390px响应式布局',
    `await new Promise(r=>setTimeout(r,200));return {ok:document.documentElement.scrollWidth<=innerWidth && document.querySelector('.contract-main-column').getBoundingClientRect().width > 300,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};`,
  );
  if (!process.env.CSPD_SKIP_SCREENSHOTS)
    await call('take_screenshot', { filePath: path.join(output, 'mobile.png'), fullPage: true });
  await call('resize_page', { width: 1440, height: 1000 });
  await check(
    '草稿编辑跨页签保留并可正常保存',
    `const s=ng.getComponent(document.querySelector('app-root')).store;const id=s.createContractDraft('DEMO-O003');if(!id)return {ok:false,reason:'cannot create draft'};const rootCmp=ng.getComponent(document.querySelector('app-root'));await rootCmp.router.navigateByUrl('/contracts/'+id);await new Promise(r=>setTimeout(r,200));const host=document.querySelector('app-contract-main-fields');const cmp=ng.getComponent(host);cmp.begin();cmp.title='商务排版验收草稿';cmp.draft.alp_contractcode='DEMO-UI-001';const tabs=[...document.querySelectorAll('.contract-tabs button')];tabs[1].click();await new Promise(r=>setTimeout(r,50));tabs[0].click();await new Promise(r=>setTimeout(r,50));const retained=ng.getComponent(host)===cmp&&cmp.editing()&&cmp.title==='商务排版验收草稿';cmp.save();await new Promise(r=>setTimeout(r,80));return {ok:retained&&!cmp.editing()&&s.state().contracts.find(x=>x.id===id).title==='商务排版验收草稿'};`,
  );
  console.log(toolText(await call('list_console_messages', { types: ['error'] })));
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await c.transport.close();
  console.log(output);
}
