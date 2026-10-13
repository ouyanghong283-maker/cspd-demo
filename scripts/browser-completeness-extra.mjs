import { connect, toolText, root } from './mcp-client.mjs';
import fs from 'node:fs/promises';
process.env.CSPD_MCP_PROFILE ||= root + '/.mcp-review-2026-10-12';
const out = root + '/artifacts/review-2026-10-12';
const { client, call: raw } = await connect();
let pageId;
const findings = [],
  checks = [];
const call = (name, args = {}) => raw(name, { pageId, ...args });
async function ev(code) {
  const s = toolText(await call('evaluate_script', { function: `()=>{${code}}` }));
  const m = s.match(/```json\s*([\s\S]*?)\s*```/);
  return m ? JSON.parse(m[1]) : s;
}
async function nav(url) {
  await call('navigate_page', { url: 'http://localhost:4200' + url, type: 'url' });
}
async function role(id) {
  await ev(
    `const e=document.querySelector('.role-select');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change',{bubbles:true}));return true`,
  );
}
async function click(name, index = 0) {
  const s = toolText(await call('take_snapshot'));
  const l = s
    .split('\n')
    .filter((x) => x.includes('button ' + JSON.stringify(name)) && !x.includes('disabled'))[index];
  if (!l) throw Error('按钮不可用:' + name);
  await call('click', { uid: l.match(/uid=(\S+)/)[1] });
}
async function fields(values) {
  await ev(
    `for(const[k,v]of Object.entries(${JSON.stringify(values)})){const e=document.querySelector('[data-field="'+k+'"]');if(!e)throw Error('字段缺失:'+k);e.value=v;e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}return true`,
  );
}
const state = () => ev("return JSON.parse(localStorage.getItem('cspd-demo-v2'))");
function issue(id, name, evidence) {
  findings.push({ id, name, evidence });
  console.log('GAP', id, name);
}
try {
  const s = toolText(await raw('new_page', { url: 'http://localhost:4200/' }));
  pageId = Number(s.match(/(\d+):.*\[selected\]/)[1]);
  await role('sales');
  await nav('/sales/leads');
  await click('新建线索');
  const before = (await state()).customers.find((x) => x.name === '演示能源科技');
  await fields({
    customer: '演示能源科技',
    contact: '补充联系人复核',
    email: 'additional-audit@example.com',
    project: '复用客户新增联系人核查',
  });
  await click('保存线索草稿');
  const after = (await state()).customers.find((x) => x.id === before.id);
  if (!after.contacts.some((x) => x.name === '补充联系人复核'))
    issue('A11', '新建线索匹配已有客户后，所填新联系人被静默忽略', {
      before: before.contacts,
      after: after.contacts,
      lead: (await state()).sales.at(-1),
    });
  checks.push('已有客户复用输入检查');
  await role('pm');
  await nav('/projects/DEMO-P007?tab=' + encodeURIComponent('移交'));
  await click('整理此类资料', 0);
  await fields({ status: '待补', note: '资料删除后需要重新补齐' });
  await click('保存');
  const beforeHandover = (await state()).projects.find((x) => x.id === 'DEMO-P007').handover;
  await role('receiver');
  await click('确认收到资料');
  await click('填入演示内容');
  await click('确认收到');
  const p = (await state()).projects.find((x) => x.id === 'DEMO-P007');
  if (p.handover.status === '已接收' && p.handover.categories.some((x) => x.status === '待补'))
    issue('A12', '移交提交后资料改为待补，接收仍可成功，缺少接收前重验', {
      beforeHandover,
      after: p.handover,
    });
  await call('take_screenshot', {
    filePath: out + '/handover-missing-material-accepted.png',
    fullPage: true,
  });
  checks.push('待接收资料变更复验');
  await role('pmo');
  await nav('/sales/detail/DEMO-O002?tab=' + encodeURIComponent('团队'));
  await click('查看G1模拟结果');
  await fields({ result: '挂起', opinion: '需求边界待澄清' });
  await click('保存');
  await click('查看G1模拟结果');
  await fields({ result: '通过', opinion: '已补齐需求边界' });
  await click('保存');
  const st = await state();
  const pending = st.notices.filter(
    (x) => x.entityId === 'DEMO-O002' && x.key.startsWith('g1-') && !x.resolved,
  );
  if (pending.some((x) => x.key.endsWith('挂起')))
    issue('A13', 'G1通过后旧挂起待办仍未解除', {
      g1: st.sales.find((x) => x.id === 'DEMO-O002').g1,
      pending,
    });
  checks.push('G1挂起后通过的待办一致性');
  await fs.writeFile(
    out + '/extra-results.json',
    JSON.stringify({ date: new Date().toISOString(), findings, checks }, null, 2),
  );
  await fs.writeFile(out + '/extra-final-snapshot.txt', toolText(await call('take_snapshot')));
} finally {
  await client.close();
}
