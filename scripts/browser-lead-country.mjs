import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect, toolText } from './mcp-client.mjs';

const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4317';
const out = new URL('../artifacts/lead-country-review-2026-10-17/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const connection = await connect({ isolated: true });
let pageId;
const checks = [];
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const result = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  return JSON.parse(result.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
const click = async (label) => {
  const snapshot = toolText(await call('take_snapshot'));
  const row = snapshot.split('\n').find((line) => line.includes(`button "${label}"`) && !line.includes('disabled'));
  assert(row, `按钮不可用：${label}`);
  await call('click', { uid: row.match(/uid=(\S+)/)[1] });
};
const state = () => evaluate(`return ng.getComponent(document.querySelector('app-root')).store.state();`);
const open = async () => {
  await call('navigate_page', { type: 'url', url: base + '/sales/leads' });
  await call('wait_for', { text: ['新建线索'], timeout: 30000 });
  await click('新建线索');
  await call('wait_for', { text: ['新建项目线索'], timeout: 10000 });
};
const fields = (values) => evaluate(`
  for(const [key,value] of Object.entries(${JSON.stringify(values)})) {
    const e=document.querySelector('[data-field="'+key+'"]');
    if(!e)throw Error('字段不存在：'+key);
    e.value=value;e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));
  }return true;`);
const saved = async (name) => {
  await click('保存线索草稿');
  const result = await evaluate(`return {dialog:!!document.querySelector('[role="dialog"]'),error:document.querySelector('[role="alert"]')?.textContent||'',url:location.pathname};`);
  assert.equal(result.dialog, false, `${name}：${result.error}`);
  assert.match(result.url, /\/sales\/detail\//);
  checks.push({ name, result: '通过' });
  console.log('PASS', name);
};
try {
  const page = toolText(await connection.call('new_page', { url: base + '/sales/leads' }));
  pageId = Number(page.match(/(\d+):.*\[selected\]/)[1]);
  await open();
  const initial = await state();

  // 国家下拉仅在选择“新建独立客户”时开放，其余情况锁定为跟随关联。
  const lock = await evaluate(`
    const country=document.querySelector('[data-field="country"]');
    const assoc=document.querySelector('[data-field="existingCustomerId"]');
    const pick=(v)=>{assoc.value=v;assoc.dispatchEvent(new Event('change',{bubbles:true}));};
    const linked=[...assoc.options].find(o=>o.value&&o.value!=='__new__').value;
    const r={initialDisabled:country.disabled};
    pick(linked);r.linkedDisabled=country.disabled;r.linkedValue=country.value;
    pick('__new__');r.newEnabled=!country.disabled;
    country.value='中国';country.dispatchEvent(new Event('change',{bubbles:true}));
    pick(linked);r.relockDisabled=country.disabled;r.relockValue=country.value;
    return r;`);
  assert.equal(lock.initialDisabled, true, '未选择客户关联时国家应锁定');
  assert.equal(lock.linkedDisabled, true, '关联已有客户时国家应锁定');
  assert.equal(lock.linkedValue, '__follow_linked_country__');
  assert.equal(lock.newEnabled, true, '新建独立客户时国家应开放');
  assert.equal(lock.relockDisabled, true, '改回已有客户时国家应重新锁定');
  assert.equal(lock.relockValue, '__follow_linked_country__', '重新锁定后应回到跟随关联');
  checks.push({ name: '客户国家仅在新建独立客户时开放，其余情况锁定为跟随关联', result: '通过' });
  console.log('PASS 客户国家仅在新建独立客户时开放，其余情况锁定为跟随关联');
  await call('navigate_page', { type: 'reload' });

  await open();
  await click('填入演示内容');
  await saved('默认演示客户存在时，填入演示内容后直接保存');
  let current = await state();
  assert.equal(current.sales.length, initial.sales.length + 1);
  assert.equal(current.sales.at(-1).customerCountrySnapshot, '中国');

  const baselineCustomer = current.customers.find(c => c.id === 'DEMO-C001');
  for (const gap of ['owner', 'status', 'industry', 'contact']) {
    const fixture = structuredClone(baselineCustomer);
    if (gap === 'contact') {
      fixture.contacts[0].email = '';
      fixture.contacts[0].phone = '';
    } else fixture[gap] = '';
    await evaluate(`
      const s=ng.getComponent(document.querySelector('app-root')).store;
      const e=JSON.parse(localStorage.getItem(s.activeSnapshotKey));
      e.snapshot.customers[e.snapshot.customers.findIndex(c=>c.id==='DEMO-C001')]=${JSON.stringify(fixture)};
      localStorage.setItem(s.activeSnapshotKey,JSON.stringify(e));return true;`);
    await open();
    const before = await state();
    await click('填入演示内容');
    assert.equal(await evaluate(`return document.querySelector('[data-field="country"]').disabled;`), true);
    await saved(`截图同路径：历史客户缺失${gap}，填入演示内容后保存成功`);
    const after = await state();
    const customer = after.customers.find(c => c.id === fixture.id);
    assert.deepEqual({ ...customer, contacts: fixture.contacts }, fixture);
    assert.deepEqual(customer.contacts.slice(0, fixture.contacts.length), fixture.contacts);
    assert.equal(after.sales.length, before.sales.length + 1);
    assert.equal(after.sales.at(-1).customerCountrySnapshot, '中国');
    assert.equal(customer.contacts.find(c => c.id === after.sales.at(-1).contactId).email, 'demo@example.com');
    await call('take_screenshot', { filePath: fileURLToPath(new URL(`legacy-${gap}-saved.png`, out)), fullPage: true });
    await call('navigate_page', { type: 'reload' });
    await call('wait_for', { text: ['青山储能新增项目'], timeout: 10000 });
    assert.deepEqual(await state(), after, '刷新后客户和线索保存结果应一致');
  }

  await evaluate(`
    const s=ng.getComponent(document.querySelector('app-root')).store;
    const e=JSON.parse(localStorage.getItem(s.activeSnapshotKey));
    e.snapshot.customers[e.snapshot.customers.findIndex(c=>c.id==='DEMO-C001')]=${JSON.stringify(baselineCustomer)};
    localStorage.setItem(s.activeSnapshotKey,JSON.stringify(e));return true;`);

  // 只在隔离浏览器构造历史工作区：演示客户被改名，不能再按固定名称找到。
  await evaluate(`
    const s=ng.getComponent(document.querySelector('app-root')).store;
    const envelope=JSON.parse(localStorage.getItem(s.activeSnapshotKey));
    envelope.snapshot.customers.find(c=>c.name==='演示能源科技').name='已改名能源公司';
    localStorage.setItem(s.activeSnapshotKey,JSON.stringify(envelope));return true;`);
  await open();
  await click('填入演示内容');
  const sample = await evaluate(`return {association:document.querySelector('[data-field="existingCustomerId"]').value,country:document.querySelector('[data-field="country"]').value};`);
  assert.equal(sample.association, '__new__');
  await saved('默认演示客户不存在时，新建独立客户的演示内容也可直接保存');
  current = await state();
  assert.equal(current.customers.length, initial.customers.length + 1);
  assert.equal(current.customers.at(-1).country, '中国');
  assert.equal(current.sales.at(-1).customerCountrySnapshot, '中国');
  assert.equal(sample.country, '中国');

  await open();
  await click('填入演示内容');
  await fields({ existingCustomerId: '__new__', country: '__follow_linked_country__' });
  const before = await state();
  await click('保存线索草稿');
  assert.match(await evaluate(`return document.querySelector('[role="alert"]')?.textContent||'';`), /新建独立客户请选择具体国家/);
  assert.deepEqual(await state(), before);
  checks.push({ name: '手工选择新建独立客户加跟随关联仍明确拦截，且不留半条记录', result: '通过' });
  await fields({ country: '中国', customer: '人工补齐国家验收客户' });
  await saved('新建独立客户补选具体国家后可正常保存');

  const legacy = await evaluate(`
    const s=ng.getComponent(document.querySelector('app-root')).store;
    const e=JSON.parse(localStorage.getItem(s.activeSnapshotKey));
    const c=e.snapshot.customers.find(c=>c.name==='Nordlicht Energy');c.country='德国';
    const old=structuredClone(e.snapshot);localStorage.setItem(s.activeSnapshotKey,JSON.stringify(e));
    return {id:c.id,snapshot:old};`);
  await open();
  current = await state();
  assert.equal(current.customers.find(c => c.id === legacy.id).country, 'Germany');
  assert.deepEqual(current.sales, legacy.snapshot.sales);
  const repairedVersion = current.dataVersion;
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['新建线索'], timeout: 30000 });
  assert.equal((await state()).dataVersion, repairedVersion);
  await click('新建线索');
  await click('填入演示内容');
  await fields({ existingCustomerId: legacy.id });
  const legacyLock = await evaluate(
    `const c=document.querySelector('[data-field="country"]');return {disabled:c.disabled,value:c.value};`,
  );
  assert.equal(legacyLock.disabled, true, '关联历史客户时国家应锁定');
  assert.equal(legacyLock.value, '__follow_linked_country__');
  await saved('真实刷新修复历史德国值后，跟随关联保存为Germany');
  assert.equal((await state()).sales.at(-1).customerCountrySnapshot, 'Germany');
  await call('take_screenshot', { filePath: fileURLToPath(new URL('saved-desktop.png', out)), fullPage: true });
  const errors = toolText(await call('list_console_messages', { types: ['error'] }));
  assert.match(errors, /no console messages found/i);
  checks.push({ name: '浏览器控制台无error', result: '通过' });
  await fs.writeFile(new URL('report.json', out), JSON.stringify({ result: '通过', checks }, null, 2));
  console.log(JSON.stringify({ result: '通过', checks }, null, 2));
} catch (error) {
  await call('take_screenshot', { filePath: fileURLToPath(new URL('failure.png', out)), fullPage: true }).catch(() => {});
  await fs.writeFile(new URL('report.json', out), JSON.stringify({ result: '失败', checks, error: error.message }, null, 2));
  throw error;
} finally {
  await connection.client.close();
  await connection.transport.close();
}
