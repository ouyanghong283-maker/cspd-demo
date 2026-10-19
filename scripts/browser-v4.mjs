import { connect, toolText, root } from './mcp-client.mjs';
import fs from 'node:fs/promises';
import { base } from './browser-config.mjs';
const { client, call } = await connect();
let pageId;
const results = [];
const objects = {};
const tool = (name, args = {}) => call(name, { pageId, ...args });
async function ev(body) {
  const text = toolText(await tool('evaluate_script', { function: `async()=>{${body}}` }));
  const m = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!m) throw Error(text);
  return JSON.parse(m[1]);
}
const assert = (v, msg) => {
  if (!v) throw Error(msg);
};
async function navigate(path) {
  await tool('navigate_page', { url: base + path, type: 'url' });
  await tool('wait_for', { text: ['CSPD 项目全链条协同平台'], timeout: 10000 });
}
async function click(label) {
  const snapshot = toolText(await tool('take_snapshot'));
  const line = snapshot
    .split('\n')
    .find((x) => x.includes('button ' + JSON.stringify(label)) && !x.includes('disabled'));
  if (!line) throw Error(`按钮不可用:${label}\n${snapshot.slice(-1200)}`);
  await tool('click', { uid: line.match(/uid=(\S+)/)[1] });
}
async function fields(values) {
  await ev(
    `for(const [k,v] of Object.entries(${JSON.stringify(values)})){const e=document.querySelector('[data-field="'+k+'"]');if(!e)throw Error('字段缺失:'+k);e.value=v;e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}return true;`,
  );
}
const storeCall = (body) =>
  ev(`const s=ng.getComponent(document.querySelector('app-root')).store;${body}`);
const state = () => ev("return JSON.parse(localStorage.getItem('cspd-demo-v2')); ");
async function role(r) {
  await storeCall(`s.setRole(${JSON.stringify(r)});return true;`);
}
async function save() {
  await click('保存');
  assert(!(await ev("return !!document.querySelector('[role=dialog]')")), '保存未成功');
}
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, result: '通过' });
    console.log('PASS', name);
  } catch (e) {
    results.push({ name, result: '失败', error: e.message });
    console.log('FAIL', name, e.message);
  }
}
async function shot(name) {
  await ev('return document.fonts.ready.then(()=>true);');
  await tool('take_screenshot', { filePath: root + '/artifacts/' + name + '.png', fullPage: true });
}
try {
  await fs.mkdir(root + '/artifacts', { recursive: true });
  const p = toolText(await call('new_page', { url: base + '/control' }));
  pageId = Number(p.match(/(\d+):.*\[selected\]/)[1]);
  await storeCall('return await s.reset();');
  await check('新建同一对象：线索、模拟资料、商机、内部报价草稿', async () => {
    await navigate('/sales/leads');
    await click('新建线索');
    await click('填入演示内容');
    await click('保存线索草稿');
    let d = await state();
    objects.lead = d.sales.at(-1).id;
    await navigate('/sales/detail/' + objects.lead);
    await click('转商机');
    assert(!(await state()).sales.find((x) => x.id === objects.lead).convertedTo, '缺需求表未阻断');
    await click('资料');
    await click('模拟上传需求导入表');
    await click('取消');
    assert(!(await state()).attachments.some((x) => x.entityId === objects.lead), '取消仍生成资料');
    await click('模拟上传需求导入表');
    await fields({ name: '新客户需求.xlsx', note: '连续主线' });
    await save();
    await click('转商机');
    d = await state();
    objects.opportunity = d.sales.find((x) => x.id === objects.lead).convertedTo;
    assert(objects.opportunity, '转换失败');
    const a = d.attachments.find((x) => x.entityId === objects.lead);
    assert(d.sales.find((x) => x.id === objects.opportunity).leadId === objects.lead, '线索未关联');
    objects.requirement = a.id;
    const ok = await storeCall(
      `const o=structuredClone(s.sale('${objects.opportunity}'));Object.assign(o,{description:'新客户储能系统',capacity:10,amount:100000,currency:'EUR',expectedDate:'2026-10-20',grade:'A',tender:'否'});if(!s.saveSales(o))throw Error('商机保存失败');if(!s.advance(o.id))throw Error('G1推进失败');return true;`,
    );
    assert(ok, '推进失败');
    await navigate('/sales/detail/' + objects.opportunity + '?tab=' + encodeURIComponent('报价'));
    await click('创建报价草稿');
    d = await state();
    objects.quote = d.quoteSeries.find(
      (x) => x.opportunityId === objects.opportunity,
    ).versions[0].id;
    assert(
      d.quoteSeries
        .find((x) => x.opportunityId === objects.opportunity)
        .versions[0].sourceAttachmentIds.includes(objects.requirement),
      '需求引用ID未保留',
    );
  });
  await check('同一商机：方案首版、常规服务、不购买确认、审核及发出', async () => {
    assert(objects.quote, '前置主线失败');
    await role('solution');
    await navigate('/sales/detail/' + objects.opportunity + '?tab=' + encodeURIComponent('方案'));
    await click('模拟上传首版');
    await fields({ name: '核心方案V1.pdf', owner: '周方案', note: '首版交付' });
    await save();
    await shot('v4-solution');
    await role('sales');
    await click('服务条件');
    await click('填写／修改服务条件');
    await click('填入演示内容');
    await save();
    await click('销售确认常规条件');
    await click('填写／修改协议');
    await fields({ applicability: '不购买', reason: '客户本次只购买设备' });
    await save();
    await click('销售确认不购买');
    await storeCall(
      `const v=structuredClone(s.quoteVersion('${objects.quote}'));Object.assign(v,{sellerEntity:'演示销售主体',country:'德国',tradeTerm:'DAP',plannedSendDate:'2026-10-10',validUntil:'2026-11-10',scope:'设备供货',delivery:'约定发货',payment:'签约30%',warranty:'2年',solutionSummary:'储能系统',boundaries:'不含土建',taxNote:'演示税费口径'});v.items=[{id:'browser-item',category:'货物',name:'储能系统',spec:'演示配置',unit:'套',quantity:1,unitPrice:100000,source:'演示方案'}];if(!s.saveQuote(v))throw Error('草稿未保存');return s.quoteGate('${objects.opportunity}','${objects.quote}');`,
    ).then((g) => assert(g.length === 0, JSON.stringify(g)));
    await role('finance');
    await storeCall(`return s.confirmQuoteTax('${objects.quote}','样例已确认','演示税费确认');`);
    await role('sales');
    await click('报价');
    await click('提交模拟审核');
    await role('manager');
    await click('应用模拟审核');
    await fields({ result: '模拟审核通过', note: '同一商机审核通过' });
    await save();
    await role('sales');
    await click('记录报价已发出');
    await fields({
      date: '2026-10-10',
      method: '会议交付',
      recipient: '陈客户',
      evidence: '模拟报价记录',
    });
    await save();
    assert(
      (await state()).quoteSeries.find((x) => x.opportunityId === objects.opportunity).versions[0]
        .status === '已记录发出',
      '未发出',
    );
    await shot('v4-quote');
  });
  await check('同一对象：客户接受、锁定、赢单、项目关联、BOM历史', async () => {
    assert(objects.quote, '前置失败');
    await storeCall(
      `if(!s.addQuoteFeedback('${objects.quote}',{date:'2026-10-10',kind:'客户确认接受',summary:'客户接受方案',person:'陈客户',evidence:'客户接受模拟记录'}))throw Error('客户接受失败');if(!s.requestQuoteLock('${objects.quote}'))throw Error('申请锁定失败');s.setRole('manager');if(!s.lockQuote('${objects.quote}'))throw Error('锁定失败');s.setRole('sales');if(!s.advance('${objects.opportunity}'))throw Error('进入洽谈失败');if(!s.addActivity('${objects.opportunity}',{date:'2026-10-10',type:'会议',summary:'洽谈确认',people:'陈客户',next:'签约'}))throw Error('沟通失败');if(!s.advance('${objects.opportunity}'))throw Error('合同谈判失败');s.addActivity('${objects.opportunity}',{date:'2026-10-10',type:'会议',summary:'合同确认',people:'陈客户',next:'交付'});if(!s.closeSale('${objects.opportunity}','赢单','演示合同确认','2026-10-10','2026-10-10'))throw Error('赢单失败');return s.bridge('${objects.opportunity}');`,
    ).then((id) => {
      assert(id, '项目桥接失败');
      objects.project = id;
    });
    await role('pm');
    await navigate('/projects/' + objects.project + '?tab=' + encodeURIComponent('资料历史'));
    await click('模拟上传BOM');
    await fields({ name: '项目BOM第一版.xlsx', note: '仅留档' });
    await save();
    await click('模拟上传BOM');
    await fields({ name: '项目BOM第二版.xlsx' });
    await save();
    assert(
      (await state()).attachments.filter((x) => x.entityId === objects.project && x.kind === 'BOM')
        .length === 2,
      'BOM历史缺失',
    );
    await shot('v4-bom');
  });
  await check('同一项目：财务独立快照、部分回款幂等、收齐、成本修订和刷新', async () => {
    assert(objects.project, '前置项目失败');
    await role('finance');
    await click('财务信息');
    await click('加载演示财务数据');
    let d = await state();
    const f = d.financeSnapshots.find((x) => x.projectId === objects.project);
    assert(f, '财务未加载');
    assert(
      f.indicators.salesAmount === 120000 &&
        f.indicators.grossProfitAmount === 25000 &&
        f.indicators.prepaymentRatio === 30 &&
        f.cumulativeActualCost.amount === 60000,
      'D01只读财务快照字段或金额错误',
    );
    const invoice = f.invoices[0];
    await storeCall(
      `s.simulateReceipt('${objects.project}','${invoice.id}',false);s.simulateReceipt('${objects.project}','${invoice.id}',false);return true;`,
    );
    d = await state();
    assert(
      d.financeSnapshots.find((x) => x.projectId === objects.project).invoices[0].received ===
        50000,
      '部分重复累计',
    );
    assert(
      d.notices.some((x) => x.key === 'v4-receivable-' + invoice.id && !x.resolved),
      '部分未保留待办',
    );
    await storeCall(
      `s.simulateReceipt('${objects.project}','${invoice.id}',true);s.refreshFinance('${objects.project}');return true;`,
    );
    d = await state();
    assert(
      d.financeSnapshots.find((x) => x.projectId === objects.project).invoices[0].received ===
        100000,
      '收齐或刷新错误',
    );
    assert(
      d.notices.filter((x) => x.key === 'v4-receivable-' + invoice.id).every((x) => x.resolved),
      '收齐未解除',
    );
    await click('模拟上传最终成本资料');
    await fields({ name: '最终成本结算.xlsx' });
    await save();
    await click('填写最终实际成本');
    await fields({ amount: '80000', scope: '该项目全范围成本' });
    await save();
    await click('修订最终实际成本');
    await fields({ amount: '81000', reason: '补充结算费用' });
    await save();
    await shot('v4-finance');
    const before = await state();
    await navigate('/projects/' + objects.project + '?tab=' + encodeURIComponent('财务信息'));
    d = await state();
    assert(JSON.stringify(before) === JSON.stringify(d), '刷新状态漂移');
    assert(
      d.finalActualCosts.filter((x) => x.projectId === objects.project).length === 2,
      '成本修订未保留',
    );
  });
  await check('D02–D04：客户节点账期、延期黄灯、实际逾期和对应解除', async () => {
    const projectId = 'DEMO-P001';
    await role('finance');
    await storeCall(`s.refreshFinance('${projectId}');return true;`);
    let d = await state();
    const p = d.projects.find((x) => x.id === projectId);
    const milestone = p.plans.find((x) => x.type === '客户主节点' && x.name === '客户要求首批到货');
    const policy = d.creditPolicies.find((x) => x.projectId === projectId);
    assert(
      milestone && policy.startCustomerMilestoneId === milestone.id,
      'CRM政策没有绑定用户指定节点ID',
    );
    const invoice = d.financeSnapshots.find((x) => x.projectId === projectId).invoices[2];
    assert(invoice.amount === 30000 && !invoice.due, '缺少无约定到期日的演示发票');
    assert(
      await storeCall(
        `const f=s.creditDateFacts('${projectId}');return f.expectedDue==='2026-11-19'&&!f.actualDue;`,
      ),
      '预计节点错误地成为实际到期日',
    );
    await navigate('/projects/' + projectId + '?tab=' + encodeURIComponent('财务信息'));
    assert(
      await ev(
        "return document.querySelector('main').innerText.includes('只读样例') && document.querySelector('main').innerText.includes('预计到期日');",
      ),
      '财务页未展示CRM信用政策和预测日期来源',
    );
    await role('pm');
    await storeCall(
      `const p=s.project('${projectId}');const m=p.plans.find(x=>x.id==='${milestone.id}');if(!s.savePlan('${projectId}',{...m,expected:'2026-10-08'},'browser-late'))throw Error('延期计划保存失败');return true;`,
    );
    d = await state();
    const nodeKey = 'v4-milestone-' + projectId + '-' + milestone.id;
    let nodeNotice = d.notices.find((x) => x.key === nodeKey && !x.resolved);
    assert(
      nodeNotice && d.milestoneWarnings.some((x) => x.sourcePlanId === milestone.id),
      '未生成延期黄灯',
    );
    await role('finance');
    await navigate('/projects/' + projectId + '?tab=' + encodeURIComponent('财务信息'));
    await shot('v4-incremental-credit-warnings');
    await role('pm');
    await storeCall(`s.markNotice('${nodeNotice.id}');return true;`);
    await storeCall(
      `const p=s.project('${projectId}');const m=p.plans.find(x=>x.id==='${milestone.id}');s.savePlan('${projectId}',{...m,expected:'2026-10-10'},'browser-on-time');return true;`,
    );
    d = await state();
    assert(d.notices.find((x) => x.id === nodeNotice.id).resolved, '日期调整后节点提醒未解除');
    await storeCall(
      `const p=s.project('${projectId}');const m=p.plans.find(x=>x.id==='${milestone.id}');s.savePlan('${projectId}',{...m,status:'已完成',actual:'2026-09-01',name:m.name+'（名称变更）'},'browser-complete');return true;`,
    );
    d = await state();
    assert(
      await storeCall(`return s.creditDateFacts('${projectId}').actualDue==='2026-10-01';`),
      '有效节点完成日未推算实际到期日',
    );
    const sourcePlan = d.projects
      .find((x) => x.id === projectId)
      .plans.find((x) => x.type === '内部WBS' && x.status !== '已完成');
    assert(sourcePlan, '没有可验证的未完成本地计划');
    await storeCall(
      `const p=s.project('${projectId}');const w=p.plans.find(x=>x.id==='${sourcePlan.id}');if(!s.savePlan('${projectId}',{...w,customerMilestoneId:'${milestone.id}',linked:'${milestone.name}',expected:'2026-10-10'},'browser-bound-sync'))throw Error('稳定节点绑定保存失败');return true;`,
    );
    d = await state();
    const sourceRecords = d.milestoneSyncRecords.filter(
      (x) => x.projectId === projectId && x.sourcePlanId === sourcePlan.id,
    );
    assert(
      sourceRecords.length === 1 && sourceRecords[0].newExpectedDate === '2026-10-10',
      'PM日期变化同步记录缺失',
    );
    await storeCall(
      `const p=s.project('${projectId}');const w=p.plans.find(x=>x.id==='${sourcePlan.id}');s.savePlan('${projectId}',w,'browser-bound-sync');return true;`,
    );
    assert(
      (await state()).milestoneSyncRecords.filter((x) => x.sourcePlanId === sourcePlan.id)
        .length === 1,
      '相同操作重复生成同步记录',
    );
    await role('finance');
    await navigate('/projects/' + projectId + '?tab=' + encodeURIComponent('财务信息'));
    assert(
      await ev(
        "return document.querySelector('main').innerText.includes('已同步模拟变更') && document.querySelector('main').innerText.includes('客户节点更新');",
      ),
      '财务页没有显示节点模拟同步历史',
    );
    await role('pm');
    assert(
      d.notices.some((x) => x.key === 'v4-receivable-' + invoice.id && !x.resolved),
      '实际应收逾期后没有销售待办',
    );
    await role('sales');
    await navigate('/');
    assert(
      await ev("return document.querySelector('main').innerText.includes('逾期待办');"),
      '工作台未显示逾期待办',
    );
    await role('finance');
    await storeCall(`s.simulateReceipt('${projectId}','${invoice.id}',true);return true;`);
    d = await state();
    assert(
      d.notices.filter((x) => x.key === 'v4-receivable-' + invoice.id).every((x) => x.resolved),
      '收齐款项后逾期提醒未解除',
    );
    assert(
      d.creditPolicies.find((x) => x.projectId === projectId).startCustomerMilestoneId ===
        milestone.id,
      '节点改名后固定ID绑定丢失',
    );
  });
  await check('D05：旧商机等级标签保留，未新增项目评分模块', async () => {
    await role('sales');
    await navigate('/sales/detail/DEMO-O002?tab=' + encodeURIComponent('概览'));
    const content = await ev("return document.querySelector('main').innerText;");
    assert(content.includes('人工判定等级'), '旧商机等级标签未更新');
    assert(!/项目评级|健康度评分|项目预算/.test(content), '出现范围外项目评分或预算字段');
  });
  await check('已发历史隔离、最终标记与新版本独立、特殊需求复核和待办定位', async () => {
    assert(objects.opportunity, '前置失败');
    const d = await state();
    const q = d.quoteSeries.find((x) => x.opportunityId === objects.opportunity).versions[0];
    const solution = d.solutionSeries.find((x) => x.opportunityId === objects.opportunity);
    await role('solution');
    await navigate('/sales/detail/' + objects.opportunity + '?tab=' + encodeURIComponent('方案'));
    await click('标记最终确认版');
    await click('模拟上传新版本');
    await fields({ name: '核心方案V2.pdf' });
    await save();
    let after = await state();
    assert(
      JSON.stringify(
        after.quoteSeries.find((x) => x.opportunityId === objects.opportunity).versions[0],
      ) === JSON.stringify(q),
      '已发报价变化',
    );
    assert(
      after.solutionSeries.find((x) => x.opportunityId === objects.opportunity).finalVersionId ===
        solution.latestVersionId,
      '最终指针被更新',
    );
    await role('sales');
    await click('服务条件');
    await click('填写／修改服务条件');
    await fields({ kind: '特殊', special: '客户要求现场驻守' });
    await save();
    await click('销售确认并提交运维');
    await role('receiver');
    await navigate('/');
    await ev(
      `const btn=[...document.querySelectorAll('.task-row')].find(b=>b.innerText.includes('特殊服务待复核'))?.querySelector('button');if(!btn)throw Error('无运维任务入口');btn.click();return true;`,
    );
    await tool('wait_for', { text: ['运维复核当前修订'] });
    await click('运维复核当前修订');
    await fields({ result: '需调整', opinion: '调整驻守时间' });
    await save();
    await role('sales');
    await click('填写／修改服务条件');
    await fields({ special: '约定两天现场支持' });
    await save();
    await click('销售确认并提交运维');
    await role('receiver');
    await click('运维复核当前修订');
    await fields({ result: '可接受', opinion: '资源可满足' });
    await save();
  });
  await check('角色限制、仅模拟文件、窄屏布局与无控制台错误', async () => {
    await role('outsider');
    await navigate('/sales/detail/' + objects.opportunity + '?tab=' + encodeURIComponent('方案'));
    assert(
      !(await ev("return document.querySelector('main').innerText.includes('核心方案V2.pdf')")),
      '外部角色看到方案',
    );
    await navigate('/projects/' + objects.project + '?tab=' + encodeURIComponent('财务信息'));
    assert(
      !(await ev("return document.querySelector('main').innerText.includes('最终实际成本')")),
      '外部角色看到成本',
    );
    await role('finance');
    await tool('resize_page', { width: 390, height: 844 });
    for (const path of [
      '/projects/' + objects.project + '?tab=' + encodeURIComponent('财务信息'),
      '/sales/detail/' + objects.opportunity + '?tab=' + encodeURIComponent('方案'),
      '/sales/detail/' + objects.opportunity + '?tab=' + encodeURIComponent('服务条件'),
    ]) {
      await navigate(path);
      assert(!(await ev("return !!document.querySelector('input[type=file]')")), '真实文件入口');
      const size = await ev(
        'return {width:innerWidth,scroll:document.documentElement.scrollWidth}',
      );
      assert(size.scroll <= size.width + 1, '窄屏溢出' + JSON.stringify(size));
    }
    await shot('v4-mobile');
    await tool('resize_page', { width: 1440, height: 1000 });
    const errors = toolText(await tool('list_console_messages', { types: ['error'] }));
    assert(errors.includes('no console messages found'), '控制台错误:' + errors);
    const network = toolText(
      await tool('list_network_requests', { resourceTypes: ['fetch', 'xhr'] }),
    );
    assert(!/sap|crm|samples|\.pdf|\.xlsx/i.test(network), '真实文件或系统请求');
  });
  await check('整套复位取消安全、确认清除、重复复位一致', async () => {
    await navigate('/control');
    const before = await state();
    await click('重置演示数据');
    await tool('handle_dialog', { action: 'dismiss' });
    assert(JSON.stringify(before) === JSON.stringify(await state()), '取消清数据');
    await click('重置演示数据');
    await tool('handle_dialog', { action: 'accept' });
    await tool('wait_for', { text: ['已恢复初始样例'], timeout: 10000 });
    let d = await state();
    assert(
      !d.sales.some((x) => x.id === objects.opportunity) && !d.finalActualCosts.length,
      '复位有残留',
    );
    const shape = {
      sales: d.sales.length,
      projects: d.projects.length,
      solutions: d.solutionSeries.length,
      finance: d.financeSnapshots.length,
      notices: d.notices.length,
    };
    await click('重置演示数据');
    await tool('handle_dialog', { action: 'accept' });
    await tool('wait_for', { text: ['已恢复初始样例'], timeout: 10000 });
    d = await state();
    assert(
      JSON.stringify(shape) ===
        JSON.stringify({
          sales: d.sales.length,
          projects: d.projects.length,
          solutions: d.solutionSeries.length,
          finance: d.financeSnapshots.length,
          notices: d.notices.length,
        }),
      '重复复位结构漂移',
    );
  });
} finally {
  await fs.writeFile(
    root + '/artifacts/browser-v4-results.json',
    JSON.stringify({ date: new Date().toISOString(), base, objects, results }, null, 2),
  );
  await client.close();
}
console.log(
  JSON.stringify({
    passed: results.filter((x) => x.result === '通过').length,
    failed: results.filter((x) => x.result === '失败').length,
  }),
);
if (results.some((x) => x.result === '失败')) process.exitCode = 1;
