import { connect, toolText, root } from './mcp-client.mjs';
import fs from 'node:fs/promises';
const { client, call: raw } = await connect();
let pageId;
const results = [];
const errors = [];
const call = (name, args = {}) => raw(name, { pageId, ...args });
const ev = async (code) => {
  const s = toolText(await call('evaluate_script', { function: `() => {${code}}` }));
  const m = s.match(/```json\s*([\s\S]*?)\s*```/);
  return m ? JSON.parse(m[1]) : s;
};
const assert = (v, message) => {
  if (!v) throw new Error(message);
};
const state = () => ev("return JSON.parse(localStorage.getItem('cspd-demo-v2'))");
const snap = async () => toolText(await call('take_snapshot'));
async function click(name, index = 0) {
  const s = await snap();
  const lines = s
    .split('\n')
    .filter((x) => x.includes('button ' + JSON.stringify(name)) && !x.includes('disabled'));
  assert(lines[index], `按钮不可用：${name}\n${s.slice(-1600)}`);
  await call('click', { uid: lines[index].match(/uid=(\S+)/)[1] });
}
async function fields(values) {
  await ev(
    `for(const [key,value] of Object.entries(${JSON.stringify(values)})){const e=document.querySelector('[data-field="'+key+'"]');if(!e)throw Error('字段不存在:'+key);e.value=value;e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));e.dispatchEvent(new Event('blur'));}return true`,
  );
}
const sample = async (save = '保存') => {
  await click('填入演示内容');
  await click(save);
  assert(!(await ev("return !!document.querySelector('[role=dialog]')")), '表单未成功保存');
};
async function role(value) {
  const s = await snap();
  const uid = s
    .split('\n')
    .find((x) => x.includes('combobox "当前业务角色"'))
    ?.match(/uid=(\S+)/)[1];
  await call('fill', { uid, value });
}
async function nav(url) {
  await call('navigate_page', { url: 'http://localhost:4200' + url, type: 'url' });
  await call('wait_for', { text: ['CSPD 项目全链条协同平台'], timeout: 10000 });
}
async function check(name, fn) {
  try {
    await fn();
    await audit();
    results.push({ name, result: '通过' });
    console.log('PASS', name);
  } catch (e) {
    results.push({ name, result: '失败', error: e.message });
    console.log('FAIL', name, e.message.slice(0, 500));
  }
}
async function audit() {
  const log = toolText(
    await call('list_console_messages', { types: ['error'], includeStackTraces: true }),
  );
  if (!log.includes('no console messages found'))
    errors.push({ url: await ev('return location.href'), log });
}
async function shot(name) {
  await call('take_screenshot', { filePath: root + '/artifacts/' + name + '.png', fullPage: true });
}
try {
  const s = toolText(
    await raw('new_page', { url: 'http://localhost:4200/control', timeout: 30000 }),
  );
  pageId = Number(s.match(/(\d+):.*\[selected\]/)[1]);
  // Reset through the visible control and accept its confirmation explicitly.
  await click('重置演示数据');
  await call('handle_dialog', { action: 'accept' });
  await check('全部主要页面显示与控制台', async () => {
    for (const url of [
      '/',
      '/sales',
      '/sales/leads',
      '/sales/opportunities',
      '/sales/customers',
      '/projects',
      '/control',
      '/sales/detail/DEMO-O001',
      '/projects/DEMO-P001',
    ]) {
      await nav(url);
      assert(
        await ev(
          "return !!document.querySelector('main h1')&&document.querySelector('main').innerText.length>200",
        ),
        '页面缺少内容:' + url,
      );
      await audit();
      if (url === '/sales') await shot('sales-dashboard');
    }
    assert(errors.length === 0, JSON.stringify(errors));
  });
  await check('销售详情全部标签', async () => {
    await nav('/sales/detail/DEMO-O002');
    for (const name of ['概览', '沟通', '资料', '团队', '客户角色', '商务补充', '历史']) {
      await click(name);
      assert(await ev("return document.querySelector('main').innerText.length>200"), name);
      await audit();
    }
  });
  await check('项目详情全部标签及七类计划', async () => {
    await role('项目经理');
    await nav('/projects/DEMO-P001');
    for (const name of ['概览', '团队', '启动交底', '计划执行', '验收', '移交', '资料历史']) {
      await click(name);
      await audit();
      if (name === '计划执行') {
        for (const p of [
          '内部WBS',
          '客户主节点',
          '产研来源',
          '要货发货',
          '调试备件',
          'FAT测试',
          '开票回款',
        ]) {
          await click(p);
          assert(await ev("return document.querySelector('main').innerText.includes('计划')"), p);
        }
        await click('内部WBS');
        await shot('project-plans');
      }
      if (name === '验收') await shot('project-acceptance');
    }
  });
  await check('13种角色和非成员资料限制', async () => {
    for (const value of [
      '销售',
      '销售助理',
      '销售主管',
      '部门负责人 / PMO',
      '解决方案',
      '项目经理',
      'OPM / 物控',
      'FAT / 质量',
      '财务 / SaO',
      '运维 / 移交接收方',
      '备件订单专员',
      '计划责任人',
      '非项目成员',
    ])
      await role(value);
    await nav('/projects/DEMO-P001');
    assert(
      await ev(
        "return document.querySelector('main').innerText.includes('当前为非项目成员')&&!document.querySelector('main').innerText.includes('付款条件')",
      ),
      '内部资料未隐藏',
    );
    await role('销售');
  });
  await check('新建线索必填与草稿保存', async () => {
    await nav('/sales/leads');
    await click('新建线索');
    await click('保存线索草稿');
    assert(await ev("return !!document.querySelector('.field-error')"), '必填未校验');
    await sample('保存线索草稿');
    const d = await state();
    assert(d.sales.filter((x) => x.type === 'lead').length === 13, '未新增草稿');
  });
  await check('线索转商机、附件继承和重复转换保护', async () => {
    await nav('/sales/detail/DEMO-L001');
    await click('转商机');
    assert(
      (await state()).sales.find((x) => x.id === 'DEMO-L001').convertedTo === '',
      '缺需求附件却转成功',
    );
    await click('资料');
    await click('使用演示附件', 0);
    await click('转商机');
    const d = await state();
    const lead = d.sales.find((x) => x.id === 'DEMO-L001');
    assert(lead.convertedTo, '未转换');
    const opp = d.sales.find((x) => x.id === lead.convertedTo);
    assert(
      opp.customerId === lead.customerId && opp.contactId === lead.contactId,
      '客户资料未继承',
    );
    assert(
      d.attachments.some((x) => x.entityId === opp.id && x.kind === '需求导入表'),
      '附件未继承',
    );
    await nav('/sales/detail/DEMO-L001');
    await click('查看已转换商机');
    assert((await state()).sales.length === d.sales.length, '重复转换');
  });
  await check('普通A级非投标直接推进、沟通与赢单交付桥接', async () => {
    await nav('/sales/detail/DEMO-O001');
    await click('完成本步，进入下一步');
    assert(
      (await state()).sales.find((x) => x.id === 'DEMO-O001').stage === '方案报价',
      '普通商机错误强制团队',
    );
    for (let i = 0; i < 2; i++) {
      await click('记录本轮沟通');
      await sample();
      await click('完成本步，进入下一步');
    }
    await click('记录赢单');
    await sample('确认赢单');
    assert((await state()).sales.find((x) => x.id === 'DEMO-O001').stage === '赢单', '未赢单');
    await click('进入交付演示');
    assert(await ev("return location.pathname.startsWith('/projects/')"), '未进入项目');
  });
  await check('重点投标团队指定、角色确认与G1', async () => {
    await nav('/sales/detail/DEMO-O002');
    await click('团队');
    await role('部门负责人 / PMO');
    await click('指定团队');
    await click('保存');
    for (const person of ['解决方案', '项目经理', '运维 / 移交接收方']) {
      await role(person);
      await click('确认参与');
    }
    await role('项目经理');
    await click('记录交付初判');
    await sample();
    await role('部门负责人 / PMO');
    await click('查看G1模拟结果');
    await click('保存');
    assert(
      (await state()).sales.find((x) => x.id === 'DEMO-O002').team.every((x) => x.confirmed),
      '团队未全部确认',
    );
  });
  await check('交底缺件阻断、补全后提交、模拟附条件与关闭', async () => {
    await role('项目经理');
    await nav('/projects/DEMO-P002?tab=' + encodeURIComponent('启动交底'));
    await click('提交交底');
    assert(
      (await state()).projects.find((x) => x.id === 'DEMO-P002').briefing.review === '待提交',
      '缺资料仍提交',
    );
    await click('接收项目');
    await click('补充交底信息');
    await sample();
    await ev("document.getElementById('doc-启动纪要').querySelector('button').click();return true");
    await ev("document.getElementById('doc-启动文件').querySelector('button').click();return true");
    await click('提交交底');
    assert(
      (await state()).projects.find((x) => x.id === 'DEMO-P002').briefing.review === '模拟审核中',
      '未提交',
    );
    await role('部门负责人 / PMO');
    await click('查看OA模拟结果');
    await sample();
    await click('补充关闭凭据');
    await sample();
    await click('PMO确认关闭');
    assert(
      (await state()).projects.find((x) => x.id === 'DEMO-P002').conditions.every((x) => x.closed),
      '条件未关闭',
    );
  });
  await check('计划新增、日期校验、甘特、只读来源', async () => {
    await role('项目经理');
    await nav('/projects/DEMO-P001?tab=' + encodeURIComponent('计划执行'));
    await click('新增计划');
    await fields({
      name: '浏览器验证任务',
      start: '2026-10-20',
      end: '2026-10-10',
      expected: '2026-10-20',
    });
    await click('保存');
    assert(await ev("return !!document.querySelector('[role=dialog]')"), '倒置日期未拒绝');
    await fields({ end: '2026-10-25' });
    await click('保存');
    assert(
      (await state()).projects
        .find((x) => x.id === 'DEMO-P001')
        .plans.some((x) => x.name === '浏览器验证任务'),
      '计划未保存',
    );
    await click('甘特视图');
    await shot('project-gantt');
    await click('表格视图');
    await click('产研来源');
    assert(
      !(await ev(
        "return [...document.querySelectorAll('main button')].some(x=>x.textContent.trim()==='编辑')",
      )),
      '来源计划可编辑',
    );
    await click('开票回款');
    assert(
      await ev("return document.querySelector('main').innerText.includes('实际开票 / 回款')"),
      '缺少只读账务',
    );
  });
  await check('SAT独立完成、客户逐项验收与内部移交接力', async () => {
    await role('项目经理');
    await nav('/projects/DEMO-P006?tab=' + encodeURIComponent('移交'));
    await click('发起内部移交');
    assert(
      (await state()).projects.find((x) => x.id === 'DEMO-P006').handover.status !== '待接收',
      '未完成SAT却移交',
    );
    await click('验收');
    await click('记录测试结果');
    await sample();
    await click('使用演示附件', 0);
    await click('PM确认SAT完成');
    let p = (await state()).projects.find((x) => x.id === 'DEMO-P006');
    assert(p.sat.complete && !p.acceptanceComplete, 'SAT错误同步验收');
    for (let i = 0; i < p.acceptance.length; i++) {
      await click('逐项签认', i);
      await sample();
    }
    await click('使用演示附件', 1);
    await click('记录验收完成');
    assert(
      (await state()).projects.find((x) => x.id === 'DEMO-P006').acceptanceComplete,
      '客户验收未完成',
    );
    await click('移交');
    await click('引用现有项目数据');
    await click('新增遗留事项');
    await sample();
    await click('发起内部移交');
    assert(
      (await state()).projects.find((x) => x.id === 'DEMO-P006').handover.status === '待接收',
      '未提交接收',
    );
    await role('运维 / 移交接收方');
    await click('退回PM补充');
    await sample('退回补充');
    await role('项目经理');
    await click('发起内部移交');
    await role('运维 / 移交接收方');
    await click('确认收到资料');
    await sample('确认收到');
    assert(
      (await state()).projects.find((x) => x.id === 'DEMO-P006').handover.status === '已接收',
      '移交未接收',
    );
    await shot('handover-complete');
  });
  await check('刷新保留业务修改', async () => {
    const d = await state();
    await call('navigate_page', { type: 'reload' });
    const after = await state();
    assert(
      after.history.length === d.history.length &&
        after.projects.find((x) => x.id === 'DEMO-P006').handover.status === '已接收',
      '刷新丢失状态',
    );
  });

  await check('线索归档恢复、客户角色及商务案例', async () => {
    await role('销售');
    await nav('/sales/detail/DEMO-L003');
    await click('归档线索');
    await fields({ reason: '无预算' });
    await click('保存');
    assert((await state()).sales.find((x) => x.id === 'DEMO-L003').status === '已归档', '未归档');
    await click('恢复跟进');
    await click('保存');
    await nav('/sales/detail/DEMO-O003');
    await click('客户角色');
    await click('补充客户角色');
    await sample();
    await click('商务补充');
    await click('查看 / 补充演示案例');
    await sample();
    const sale = (await state()).sales.find((x) => x.id === 'DEMO-O003');
    assert(sale.customerRoles.length > 0 && sale.taxCase === '跨境交易案例', '客户角色/商务未保存');
  });
  await check('实际文件上传、刷新保留及空文件拒绝', async () => {
    await nav('/sales/detail/DEMO-L002');
    await click('资料');
    await fs.writeFile(root + '/artifacts/empty.pdf', '');
    const upload = async (path) => {
      const s = await snap();
      const line = s.split('\n').find((x) => x.includes('button "上传需求导入表"'));
      await call('upload_file', { uid: line.match(/uid=(\S+)/)[1], filePaths: [path] });
    };
    await upload(root + '/artifacts/empty.pdf');
    assert(
      !(await state()).attachments.some(
        (x) => x.entityId === 'DEMO-L002' && x.name === 'empty.pdf',
      ),
      '空文件被接受',
    );
    await upload(root + '/public/samples/需求导入表.pdf');
    await call('wait_for', { text: ['需求导入表.pdf'], timeout: 10000 });
    let a = (await state()).attachments.find((x) => x.entityId === 'DEMO-L002' && !x.sample);
    assert(a && a.size > 0, '未保存真实文件');
    await call('navigate_page', { type: 'reload' });
    assert(
      (await state()).attachments.some((x) => x.id === a.id),
      '刷新丢失附件',
    );
    const data = await ev(
      `return new Promise((resolve,reject)=>{const r=indexedDB.open('cspd-demo-files-v2');r.onsuccess=()=>{const db=r.result;const names=[...db.objectStoreNames];if(!names.length)return resolve(false);const q=db.transaction(names[0]).objectStore(names[0]).get(${JSON.stringify(a.id)});q.onsuccess=()=>resolve(!!q.result);q.onerror=reject};r.onerror=reject})`,
    );
    assert(data, 'IndexedDB缺少上传内容');
  });
  await check('同合同子项目独立、模板应用与客户节点通知', async () => {
    await role('项目经理');
    await nav('/projects/DEMO-P001');
    await click('新增子项目');
    await sample();
    const id = await ev("return location.pathname.split('/').at(-1)");
    assert(
      (await state()).projects.find((x) => x.id === id).contractId === 'DEMO-CON001',
      '合同来源不一致',
    );
    await click('计划执行');
    await click('区域模板');
    await click('应用模板');
    assert(
      (await state()).projects.find((x) => x.id === id).plans.filter((x) => x.type === '内部WBS')
        .length === 10,
      '模板任务不完整',
    );
    await click('客户主节点');
    await click('新增计划');
    await sample();
    assert(
      (await state()).notices.some((x) => x.entityId === id && x.role === 'sales'),
      '缺客户节点通知',
    );
  });
  await check('物控要货、备件清单提交和FAT报告完成', async () => {
    await role('OPM / 物控');
    await nav(
      '/projects/DEMO-P003?tab=' +
        encodeURIComponent('计划执行') +
        '&plan=' +
        encodeURIComponent('要货发货'),
    );
    await click('编辑');
    await sample();
    await role('项目经理');
    await click('调试备件');
    await click('使用演示附件');
    await click('编辑');
    await fields({ receiver: '郑备件' });
    await click('保存');
    await click('提交需求');
    assert(
      (await state()).notices.some((x) => x.role === 'spare' && x.entityId === 'DEMO-P003'),
      '备件通知未生成',
    );
    await role('FAT / 质量');
    await click('FAT测试');
    await click('使用演示附件');
    await click('编辑');
    await fields({ status: '已完成', actual: '2026-10-10', result: '合格' });
    await click('保存');
    assert(
      (await state()).projects
        .find((x) => x.id === 'DEMO-P003')
        .plans.find((x) => x.type === 'FAT测试').status === '已完成',
      'FAT未完成',
    );
  });
  await check('交底二次退回产生模拟升级记录', async () => {
    for (let i = 0; i < 2; i++) {
      await role('项目经理');
      await nav('/projects/DEMO-P002?tab=' + encodeURIComponent('启动交底'));
      await click('提交交底');
      await role('部门负责人 / PMO');
      await click('查看OA模拟结果');
      await fields({ result: '退回', opinion: '请补充客户现场资料归档位置' });
      await click('保存');
    }
    const d = await state();
    assert(
      d.projects.find((x) => x.id === 'DEMO-P002').briefing.returns === 2 &&
        d.notices.some((x) => x.key === 'escalation-DEMO-P002'),
      '缺少二次退回升级',
    );
  });
  await check('主管催办与销售有效沟通解除提醒', async () => {
    await role('销售主管');
    await nav('/sales');
    await click('提醒跟进', 0);
    const d = await state();
    const n = d.notices.find((x) => x.key.startsWith('cooling-') && !x.resolved);
    assert(n, '未生成催办');
    await role('销售');
    await nav('/sales/detail/' + n.entityId);
    await click('沟通');
    await click('新增沟通记录');
    await sample();
    assert((await state()).notices.find((x) => x.id === n.id).resolved, '有效跟进未解除催办');
  });
  await check('移动端主要页面无整页横向溢出', async () => {
    await call('resize_page', { width: 390, height: 844 });
    for (const url of [
      '/',
      '/sales',
      '/sales/leads',
      '/sales/opportunities',
      '/sales/customers',
      '/projects',
      '/projects/DEMO-P001',
      '/control',
    ]) {
      await nav(url);
      const m = await ev('return {width:innerWidth,body:document.documentElement.scrollWidth}');
      assert(m.body <= m.width + 1, `横向溢出:${url} ${JSON.stringify(m)}`);
      if (url === '/') await shot('workspace-mobile');
    }
    await call('resize_page', { width: 1440, height: 1000 });
  });
  await nav('/control');
  await shot('control-guide');
  await audit();
} finally {
  await fs.writeFile(
    root + '/artifacts/browser-results.json',
    JSON.stringify(
      {
        tool: 'Chrome DevTools MCP 1.10.1',
        date: new Date().toISOString(),
        results,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  await client.close();
}
console.log(
  JSON.stringify({
    passed: results.filter((x) => x.result === '通过').length,
    failed: results.filter((x) => x.result === '失败').length,
    consoleErrors: errors.length,
  }),
);
if (results.some((x) => x.result === '失败') || errors.length) process.exitCode = 1;
