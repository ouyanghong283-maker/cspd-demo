import { connect, toolText, root } from './mcp-client.mjs';
import fs from 'node:fs/promises';
process.env.CSPD_MCP_PROFILE ||= root + '/.mcp-review-2026-10-12';
const output = root + '/artifacts/review-2026-10-12';
await fs.mkdir(output, { recursive: true });
const { client, call: raw } = await connect();
let pageId;
const steps = [],
  findings = [];
let leadId, oppId, projectId;
const call = (name, args = {}) => raw(name, { pageId, ...args });
async function ev(code) {
  const s = toolText(await call('evaluate_script', { function: `()=>{${code}}` }));
  const m = s.match(/```json\s*([\s\S]*?)\s*```/);
  return m ? JSON.parse(m[1]) : s;
}
const state = () => ev("return JSON.parse(localStorage.getItem('cspd-demo-v2'))");
const assert = (value, message) => {
  if (!value) throw Error(message);
};
async function click(name, index = 0) {
  const s = toolText(await call('take_snapshot'));
  const l = s
    .split('\n')
    .filter((x) => x.includes('button ' + JSON.stringify(name)) && !x.includes('disabled'))[index];
  assert(l, '按钮不可用:' + name);
  await call('click', { uid: l.match(/uid=(\S+)/)[1] });
}
async function fields(values) {
  await ev(
    `for(const [k,v] of Object.entries(${JSON.stringify(values)})){const e=document.querySelector('[data-field="'+k+'"]');if(!e)throw Error('字段缺失:'+k);e.value=v;e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}return true`,
  );
}
async function role(id) {
  await ev(
    `const e=document.querySelector('.role-select');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change',{bubbles:true}));return true`,
  );
}
async function nav(url) {
  await call('navigate_page', { type: 'url', url: 'http://localhost:4200' + url });
}
async function sample(save = '保存') {
  await click('填入演示内容');
  await click(save);
  assert(!(await ev("return !!document.querySelector('[role=dialog]')")), '表单未保存');
}
async function attach(kind) {
  await ev(
    `const e=document.getElementById(${JSON.stringify('doc-' + kind)});if(!e)throw Error('附件入口缺失');e.querySelector('button').click();return true`,
  );
}
async function shot(name) {
  await call('take_screenshot', { filePath: output + '/' + name + '.png', fullPage: true });
}
async function step(name, fn) {
  try {
    const details = await fn();
    steps.push({ name, result: '通过', details });
    console.log('PASS', name);
  } catch (e) {
    steps.push({ name, result: '失败', error: e.message });
    console.log('FAIL', name, e.message);
    await fs.writeFile(output + '/failure-snapshot.txt', toolText(await call('take_snapshot')));
  }
}
function issue(id, name, evidence) {
  findings.push({ id, name, evidence });
  console.log('GAP', id, name);
}
try {
  const p = toolText(await raw('new_page', { url: 'http://localhost:4200/control' }));
  pageId = Number(p.match(/(\d+):.*\[selected\]/)[1]);
  await click('重置演示数据');
  await call('handle_dialog', { action: 'accept' });
  await step('同一主线：新建客户名草稿并补联系人', async () => {
    await role('sales');
    await nav('/sales/leads');
    await click('新建线索');
    await fields({ customer: '20261012全过程复核能源', project: '全过程复核储能项目' });
    await click('保存线索草稿');
    leadId = await ev("return location.pathname.split('/').at(-1)");
    await click('编辑客户 / 联系人');
    await fields({ shortName: '复核能源', contact: '陈复核', email: 'audit@example.com' });
    await click('保存');
    await click('编辑信息');
    await fields({
      contact: '陈复核',
      capacity: '10',
      amount: '1000000',
      expectedDate: '2026-11-15',
      grade: 'A',
      tender: '否',
      description: '全过程复核需求背景',
    });
    await click('保存');
    return { leadId };
  });
  await step('同一主线：沟通、缺需求表阻断和唯一转商机', async () => {
    await click('沟通');
    await click('新增沟通记录');
    await sample();
    await click('转商机');
    assert(!(await state()).sales.find((x) => x.id === leadId).convertedTo, '缺需求表却转换');
    const missing = await ev(
      "return {text:document.querySelector('.toast')?.innerText,links:document.querySelectorAll('.toast a,.toast button:not(.icon-btn)').length}",
    );
    if (!missing.links) issue('A01', '缺项提示不能直接定位', missing);
    await click('资料');
    await attach('需求导入表');
    await click('转商机');
    oppId = await ev("return location.pathname.split('/').at(-1)");
    assert(oppId !== leadId, '未转换');
    const d = await state();
    assert(d.sales.find((x) => x.id === oppId).leadId === leadId, '丢失来源');
    return { leadId, oppId };
  });
  await step('同一主线：普通推进至赢单并桥接新项目', async () => {
    await click('完成本步，进入下一步');
    for (let i = 0; i < 2; i++) {
      await click('概览');
      await click('记录本轮沟通');
      await sample();
      await click('完成本步，进入下一步');
    }
    const d = await state();
    const summaries = d.activities.filter((x) => x.entityId === oppId && x.stage === '合同谈判');
    await click('记录赢单');
    await sample('确认赢单');
    if (!summaries.length)
      issue('A02', '合同谈判未保存该阶段摘要也能赢单', {
        oppId,
        contractActivities: summaries.length,
        stage: (await state()).sales.find((x) => x.id === oppId).stage,
      });
    await click('进入交付演示');
    projectId = await ev("return location.pathname.split('/').at(-1)");
    assert(
      (await state()).projects.find((x) => x.id === projectId)?.opportunityId === oppId,
      '项目未关联同一商机',
    );
    return { projectId };
  });
  await step('同一主线：PM接收和团队指定确认', async () => {
    await role('pm');
    await click('接收项目');
    await click('团队');
    const p = (await state()).projects.find((x) => x.id === projectId);
    if (!p.team.some((x) => x.role === 'sales'))
      issue('A03', '交付团队未带出来源销售，生成固定方案/PM/运维团队', {
        sourceOwner: (await state()).sales.find((x) => x.id === oppId).owner,
        team: p.team,
      });
    await role('pmo');
    await click('指定团队');
    await click('保存');
    await role('pm');
    for (let i = 0; i < 3; i++) await click('PM确认成员');
    assert(
      (await state()).projects.find((x) => x.id === projectId).team.every((x) => x.confirmed),
      '成员未确认',
    );
    return { projectId };
  });
  await step('同一主线：启动缺资料、提交、附条件及关闭', async () => {
    await click('启动交底');
    await click('提交交底');
    assert(
      (await state()).projects.find((x) => x.id === projectId).briefing.review === '待提交',
      '缺交底却提交',
    );
    await click('补充交底信息');
    await sample();
    await attach('启动纪要');
    await attach('启动文件');
    await click('提交交底');
    await role('pmo');
    await click('查看OA模拟结果');
    await sample();
    await role('solution');
    await click('补充关闭凭据');
    await sample();
    await role('pmo');
    await click('PMO确认关闭');
    assert(
      (await state()).projects.find((x) => x.id === projectId).conditions.every((x) => x.closed),
      '条件未关闭',
    );
    return { review: (await state()).projects.find((x) => x.id === projectId).briefing.review };
  });
  await step('同一主线：模板及普通WBS任务完整执行', async () => {
    await role('pm');
    await click('计划执行');
    await click('标准模板');
    await click('应用模板');
    let p = (await state()).projects.find((x) => x.id === projectId);
    assert(p.plans.length === 10, '模板不完整');
    for (let i = 0; i < p.plans.length; i++) {
      if (/验收|移交/.test(p.plans[i].name)) continue;
      await click('编辑', i);
      await fields({ status: '已完成', actual: '2026-10-10' });
      await click('保存');
    }
    p = (await state()).projects.find((x) => x.id === projectId);
    return {
      completed: p.plans.filter((x) => x.status === '已完成').length,
      total: p.plans.length,
    };
  });
  await step('同一主线：客户节点、物控要货、备件、FAT与开票计划', async () => {
    await click('客户主节点');
    await click('新增计划');
    await sample();
    await role('opm');
    await click('要货发货');
    await click('新增计划');
    await sample();
    await role('pm');
    await click('调试备件');
    await click('新增计划');
    await click('填入演示内容');
    await fields({ receiver: '郑备件' });
    await click('保存');
    await attach('备件清单');
    await click('提交需求');
    await role('quality');
    await click('FAT测试');
    await attach('FAT报告');
    await click('新增计划');
    await click('填入演示内容');
    await fields({ status: '已完成', actual: '2026-10-10', result: '合格' });
    await click('保存');
    await role('pm');
    await click('开票回款');
    await click('新增计划');
    await click('填入演示内容');
    await fields({ amount: '300000' });
    await click('保存');
    return {
      types: (await state()).projects.find((x) => x.id === projectId).plans.map((x) => x.type),
    };
  });
  await step('同一主线：SAT与客户逐项签认分别完成', async () => {
    await click('验收');
    await click('记录测试结果');
    await sample();
    await attach('SAT报告');
    await click('PM确认SAT完成');
    let p = (await state()).projects.find((x) => x.id === projectId);
    assert(p.sat.complete && !p.acceptanceComplete, '验收自动完成');
    for (let i = 0; i < p.acceptance.length; i++) {
      await click('逐项签认', i);
      await sample();
    }
    await attach('客户签字清单');
    await click('记录验收完成');
    p = (await state()).projects.find((x) => x.id === projectId);
    assert(p.sat.complete && p.acceptanceComplete, '验收没有完成');
    const wbs = p.plans.filter((x) => /验收/.test(x.name) && x.type === '内部WBS');
    if (wbs.some((x) => x.status !== '已完成'))
      issue('A04', '客户验收完成但对应WBS仍未开始且普通编辑无法完成', wbs);
    return { sat: p.sat, acceptance: p.acceptanceComplete };
  });
  await step('同一主线：八类移交、退回、重提、接收', async () => {
    await click('移交');
    await click('引用现有项目数据');
    await click('新增遗留事项');
    await sample();
    await click('发起内部移交');
    await role('receiver');
    await click('退回PM补充');
    await sample('退回补充');
    await role('pm');
    await click('发起内部移交');
    await role('receiver');
    await click('确认收到资料');
    await sample('确认收到');
    const p = (await state()).projects.find((x) => x.id === projectId);
    assert(p.handover.status === '已接收', '移交未完成');
    const wbs = p.plans.filter((x) => /移交/.test(x.name) && x.type === '内部WBS');
    if (wbs.some((x) => x.status !== '已完成'))
      issue('A05', '移交已接收但WBS内部移交未完成、进度无法收口', {
        wbs,
        completed: p.plans.filter((x) => x.type === '内部WBS' && x.status === '已完成').length,
        total: p.plans.filter((x) => x.type === '内部WBS').length,
      });
    if (p.needsReview)
      issue('A06', 'SAT确认和接收完成后仍显示需要复核', {
        sat: p.sat,
        acceptance: p.acceptanceComplete,
        handover: p.handover.status,
        needsReview: p.needsReview,
      });
    await shot('same-project-handover');
    await click('计划执行');
    await click('内部WBS');
    await shot('same-project-final-plans');
    return { projectId, handover: p.handover.status, projectStatus: p.status };
  });
  await step('部门独立练习入口核查', async () => {
    const values = [];
    for (const r of ['receiver', 'solution', 'pm', 'member']) {
      await nav('/');
      await role(r);
      await click('练习我的工作');
      values.push(
        await ev(
          "return {role:JSON.parse(localStorage.getItem('cspd-demo-v2')).role,path:location.pathname,tab:document.querySelector('.tabs .active')?.innerText,title:document.querySelector('main h1')?.innerText}",
        ),
      );
    }
    issue('A07', '运维接收方练习进入投标商机，未进入移交；方案练习也未定位确认团队', values);
    return values;
  });
  await step('助理代填责任人与操作人核查', async () => {
    await role('assistant');
    await nav('/sales/detail/DEMO-L002');
    const before = (await state()).sales.find((x) => x.id === 'DEMO-L002');
    await click('编辑信息');
    await fields({ project: '助理代填复核' });
    await click('保存');
    const after = (await state()).sales.find((x) => x.id === 'DEMO-L002');
    if (after.operator === before.operator)
      issue('A08', '助理编辑后录入/代填人仍显示原人，只有历史记录体现操作人', {
        beforeOperator: before.operator,
        afterOperator: after.operator,
        owner: after.owner,
        history: (await state()).history.filter((x) => x.entityId === 'DEMO-L002').at(-1),
      });
    return { owner: after.owner, operator: after.operator };
  });
  await step('看板筛选下钻与沟通次数明细核查', async () => {
    await role('manager');
    await nav('/sales');
    await ev(
      "const s=document.querySelector('[aria-label=看板币种]');s.value='EUR';s.dispatchEvent(new Event('change',{bubbles:true}));return true",
    );
    const before = await ev(
      "return {currency:document.querySelector('[aria-label=看板币种]').value,card:document.querySelector('.stat-number')?.innerText,links:[...document.querySelectorAll('.stat')].map(x=>({tag:x.tagName,href:x.getAttribute('href')}))}",
    );
    const href = await ev("return document.querySelector('a.stat').getAttribute('href')");
    await ev("document.querySelector('a.stat').click();return true");
    const currencies = await ev(
      "return [...document.querySelectorAll('tbody tr')].map(x=>x.innerText)",
    );
    issue('A09', '看板卡片与下钻明细筛选不一致、金额卡未提供下钻', {
      before,
      href,
      listing: currencies.slice(0, 4),
    });
    await nav('/sales');
    const data = await ev(
      "return [...document.querySelectorAll('.split-bottom table tbody tr')].map(tr=>({text:tr.innerText,link:tr.querySelectorAll('a')[1]?.getAttribute('href')}))",
    );
    const target = data[0].link;
    await nav(target);
    const displayed = await ev(
      "return [...document.querySelectorAll('.timeline-item')].map(x=>x.innerText)",
    );
    issue('A10', '销售总沟通次数链接只打开第一条商机，未展示该销售全部沟通', {
      row: data[0],
      displayed,
    });
    return { before, target };
  });
  await step('SAT报告删除复核和移交接收保护', async () => {
    await role('pm');
    await nav('/projects/' + projectId + '?tab=' + encodeURIComponent('验收'));
    await click('删除SAT报告');
    await call('handle_dialog', { action: 'accept' });
    const p = (await state()).projects.find((x) => x.id === projectId);
    assert(!p.sat.complete && p.needsReview, '删除SAT未标记复核');
    return { sat: p.sat.complete, handover: p.handover.status, needsReview: p.needsReview };
  });
  const consoleLog = toolText(await call('list_console_messages', { types: ['error'] }));
  await fs.writeFile(
    output + '/full-flow-results.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        tool: 'Chrome DevTools MCP 1.10.1',
        singleObject: { leadId, oppId, projectId },
        steps,
        findings,
        consoleLog,
      },
      null,
      2,
    ),
  );
  await fs.writeFile(output + '/last-snapshot.txt', toolText(await call('take_snapshot')));
} finally {
  await client.close();
}
console.log(
  JSON.stringify({
    stepsPassed: steps.filter((x) => x.result === '通过').length,
    stepsFailed: steps.filter((x) => x.result === '失败').length,
    findings: findings.length,
  }),
);
if (steps.some((x) => x.result === '失败')) process.exitCode = 1;
