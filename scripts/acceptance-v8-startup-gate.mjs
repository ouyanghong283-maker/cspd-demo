import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-startup-gate', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 60, checks: [], result: '失败' };
let server;
let connection;
let pageId;
let serverFailure;
let serverLog = '';
const check = async (name, evidence) => {
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
};
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const text = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + text);
  return JSON.parse(match[1]);
};
const click = async (label) => {
  const snapshot = toolText(await call('take_snapshot'));
  const row = snapshot
    .split('\n')
    .find(
      (line) =>
        (line.includes('button ' + JSON.stringify(label)) || line.includes(`button "${label}`)) &&
        !line.includes('disabled'),
    );
  assert(row, '找不到可用按钮：' + label);
  await call('click', { uid: row.match(/uid=(\S+)/)[1] });
};
const clickLink = async (label) => {
  const snapshot = toolText(await call('take_snapshot'));
  const row = snapshot
    .split('\n')
    .find(
      (line) => line.includes('link ' + JSON.stringify(label)) || line.includes(`link "${label}`),
    );
  assert(row, '找不到可用链接：' + label);
  await call('click', { uid: row.match(/uid=(\S+)/)[1] });
};
const returnLinkOf = () =>
  evaluate(`
    const link=[...document.querySelectorAll('a.text-link')].find(a=>a.innerText.trim().startsWith('返回'));
    return link?{text:link.innerText.trim(),href:link.getAttribute('href')}:null;
  `);
const waitForPath = async (pathname, attempts = 60) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await evaluate(`return location.pathname===${JSON.stringify(pathname)};`)) return true;
    await delay(200);
  }
  return false;
};

try {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  report.baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/@angular/cli/bin/ng.js'),
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--watch=false',
      '--live-reload=false',
      '--hmr=false',
    ],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false', NO_COLOR: '1' },
    },
  );
  server.on('error', (error) => (serverFailure = error));
  server.on('exit', (code, signal) => (serverFailure = new Error(`服务退出：${code ?? signal}`)));
  for (const stream of [server.stdout, server.stderr])
    stream.on('data', (chunk) => (serverLog += chunk.toString()));
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    if (serverFailure) throw serverFailure;
    try {
      if ((await fetch(report.baseUrl)).status === 200) break;
    } catch {}
    await delay(300);
  }
  assert(Date.now() < until, 'Angular 服务启动超时');

  connection = await connect({ isolated: true });
  const created = toolText(await connection.call('new_page', { url: report.baseUrl + '/' }));
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await call('wait_for', { text: ['演示辅助'], timeout: 45000 });

  const app = "ng.getComponent(document.querySelector('app-root'))";
  const openStartup = async (projectId, suffix = '') => {
    await call('navigate_page', {
      url: report.baseUrl + `/projects/${projectId}?tab=startup${suffix}`,
    });
    await call('wait_for', { text: ['部门启动内容', '合同交底与显式门禁'], timeout: 45000 });
  };
  const dialogClosed = async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const open = await evaluate(`return !!document.querySelector('[role="dialog"]');`);
      if (!open) return true;
      await delay(100);
    }
    return false;
  };
  const runDialog = async (label) => {
    await click(label);
    await call('wait_for', { text: ['填入演示内容'], timeout: 45000 });
    await evaluate(`
      const fill=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('填入演示内容'));
      if(fill) fill.click();
      await new Promise(r=>setTimeout(r,80));
      return true;
    `);
    await click('保存');
    assert(await dialogClosed(), '弹窗未关闭：' + label);
  };
  const gateOf = (id) =>
    evaluate(`
      const store=${app}.store;
      const project=store.project(${JSON.stringify(id)});
      return {gate:store.startupGate(${JSON.stringify(id)}),status:project.status,
        shipping:project.briefing.shipping,acceptance:project.briefing.acceptance,
        events:(store.state().operationEvents||[]).filter(e=>e.objectId===project.id)
          .map(e=>({action:e.action,module:e.module,department:e.department,section:e.location.section,source:e.taskSource?.kind}))};
    `);

  // 两个项目共用同一套显式门禁：A 走完整流程，B 演示来源变化与链接定位。
  // store.state.update 只改内存，整页加载会回到已保存快照；未接收的项目必须走真实
  // “PM接收项目”动作落盘，否则门禁准备结果在下一次导航后丢失。
  const prepared = await evaluate(`
    const store=${app}.store;
    const projects=store.state().projects.slice(0,2);
    const notAccepted=projects.filter(p=>!store.project(p.id).accepted).map(p=>p.id);
    for (const project of projects) {
      store.state.update((state)=>{
        const p=state.projects.find(x=>x.id===project.id);
        p.accepted=true;
        if(!p.start) p.start='2026-10-10';
        if(!p.briefing.acceptance) p.briefing.acceptance='按配置清单逐项核对后签认';
        delete p.briefing.submission;
        delete p.briefing.confirmation;
        delete p.briefing.g4;
        delete p.briefing.startupHandover;
        const contract=state.contracts.find(x=>x.id===p.contractId);
        if(contract) contract.status='已登记';
        return state;
      });
    }
    for (const id of notAccepted) if(!store.acceptProject(id)) throw new Error('演示准备：项目接收失败 '+id);
    return projects.map((p)=>({id:p.id,name:p.name,submit:store.startupGate(p.id).actions.submit}));
  `);
  assert.equal(prepared.length, 2, '至少需要两个项目');
  prepared.forEach((item) =>
    assert.equal(item.submit.allowed, true, '销售发起交底前置应满足：' + item.id),
  );
  const [first, second] = prepared;

  // 1. 部门启动内容可查看、按部门保存；普通保存不推进门禁
  await openStartup(first.id);
  const deptTabs = await evaluate(
    `return [...document.querySelectorAll('.dept-tabs button')].map(b=>b.innerText.trim());`,
  );
  assert.deepEqual(deptTabs, ['销售', '解决方案', 'PM / PMO', '订单 / 交付协同']);
  await click('订单 / 交付协同');
  const typed = await evaluate(`
    const input=document.querySelector('[data-field="shipping"] input');
    if(!input) throw new Error('未找到发货周期字段');
    input.value='15个工作日（订单交付维护）';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    const url=new URL(location.href);
    return {url:location.href,tab:url.searchParams.get('tab'),dept:url.searchParams.get('dept'),
      active:[...document.querySelectorAll('.dept-tabs .active')].map(b=>b.innerText.trim()),
      unsaved:document.body.innerText.includes('有未保存的启动内容')};
  `);
  assert.equal(typed.active[0], '订单 / 交付协同');
  assert.equal(typed.unsaved, true, '未保存输入应给出提示');
  assert.equal(typed.dept, '订单交付', '切换部门应写回 URL 部门参数');
  await click('保存订单 / 交付协同启动内容');
  await call('wait_for', { text: ['订单 / 交付协同启动内容已保存'], timeout: 45000 });
  const saved = await gateOf(first.id);
  assert.equal(saved.shipping, '15个工作日（订单交付维护）');
  const saveEvent = saved.events.at(-1);
  assert.deepEqual(saveEvent, {
    action: '保存启动资料',
    module: '项目启动',
    department: '订单交付',
    section: '启动资料',
    source: 'project-startup',
  });
  assert.equal(saved.gate.submissionVersion, null);
  assert.equal(saved.gate.g4Result, '');
  assert.equal(saved.gate.handoverStatus, '');
  assert.notEqual(saved.status, '项目执行中');
  await check('部门启动内容按归属保存，普通保存不推进门禁', {
    url: typed.url,
    event: saveEvent,
    gate: {
      submissionVersion: saved.gate.submissionVersion,
      g4Result: saved.gate.g4Result,
      handoverStatus: saved.gate.handoverStatus,
    },
  });

  // 2. 打开页签与上传会议资料同样不推进门禁
  const uploadKinds = await evaluate(`
    return [...document.querySelectorAll('.doc-kind')].map(kind=>({
      kind:kind.innerText.split('\\n')[0].trim(),
      enabled:![...kind.querySelectorAll('button')].find(b=>b.innerText.includes('模拟上传')).disabled,
    })).filter(item=>item.enabled).map(item=>item.kind);
  `);
  for (const kind of uploadKinds) {
    await evaluate(`
      const kind=[...document.querySelectorAll('.doc-kind')].find(k=>k.innerText.includes(${JSON.stringify(kind)}));
      [...kind.querySelectorAll('button')].find(b=>b.innerText.includes('模拟上传')).click();
      return true;
    `);
    await call('wait_for', { text: ['仅模拟文件记录，不保存原文件'], timeout: 45000 });
    await click('保存');
    assert(await dialogClosed(), '资料弹窗未关闭：' + kind);
  }
  const afterUpload = await gateOf(first.id);
  const filedKinds = await evaluate(
    `return [...document.querySelectorAll('.file-row p')].map(p=>p.innerText.split('·')[0].trim());`,
  );
  // 交底来源版本快照会收纳“合同交底”，页签内的资料区必须能补交同一类目
  assert(uploadKinds.includes('合同交底'), '启动交底页签缺少合同交底资料类目：' + uploadKinds);
  assert(filedKinds.includes('合同交底'), '合同交底未进入资料留档：' + filedKinds);
  assert(afterUpload.events.some((event) => event.action.startsWith('保存启动资料')));
  assert.equal(afterUpload.gate.submissionVersion, null);
  assert.equal(afterUpload.gate.handoverStatus, '');
  assert.notEqual(afterUpload.status, '项目执行中');
  assert.equal(
    afterUpload.events.some((event) => /G4|移交|提交合同交底/.test(event.action)),
    false,
  );
  await check('打开页签与上传会议资料不推进门禁', {
    uploadKinds,
    filedKinds,
    gate: {
      submissionVersion: afterUpload.gate.submissionVersion,
      handoverStatus: afterUpload.gate.handoverStatus,
    },
  });

  // 3. 显式动作前置不满足时被拒：按钮不可用并给出原因，强制调用也不写历史
  const blockedRows = await evaluate(`
    return [...document.querySelectorAll('.action-row')].map(row=>({
      id:row.id,
      disabled:row.querySelector('button').disabled,
      reason:row.querySelector('p').innerText.replace(/\\s+/g,' ').trim(),
    }));
  `);
  const rowOf = (key) => blockedRows.find((row) => row.id === 'startup-action-' + key);
  assert.equal(rowOf('submit').disabled, false, '销售发起交底前置已满足');
  assert.equal(rowOf('confirm').disabled, true);
  assert(rowOf('confirm').reason.includes('销售尚未提交合同交底'));
  assert.equal(rowOf('g4').disabled, true);
  assert(rowOf('g4').reason.includes('请先由PM确认最新合同交底版本'));
  assert.equal(rowOf('handover').disabled, true);
  assert(rowOf('handover').reason.includes('请先确认当前合同交底版本'));
  const rejected = await evaluate(`
    const store=${app}.store;
    const id=${JSON.stringify(first.id)};
    const before={events:(store.state().operationEvents||[]).length,history:store.history(id).length,
      project:JSON.stringify(store.project(id))};
    const g4=store.recordProjectG4(id,'通过','前置未满足的强制调用');
    const handover=store.completeStartupHandover(id,'王项目','前置未满足的强制调用');
    await new Promise(r=>setTimeout(r,120));
    return {g4,handover,beforeEvents:before.events,beforeHistory:before.history,
      events:(store.state().operationEvents||[]).length,history:store.history(id).length,
      unchanged:before.project===JSON.stringify(store.project(id)),toast:document.body.innerText};
  `);
  assert.equal(rejected.g4, false);
  assert.equal(rejected.handover, false);
  assert.equal(rejected.events, rejected.beforeEvents, '前置不满足不应写操作事件');
  assert.equal(rejected.history, rejected.beforeHistory, '前置不满足不应写历史');
  assert.equal(rejected.unchanged, true);
  assert(rejected.toast.includes('请先由PM确认最新合同交底版本'));
  await check('显式动作前置不满足被拒且不写成功历史', {
    rows: blockedRows.map((row) => ({ id: row.id, disabled: row.disabled })),
    g4: rejected.g4,
    handover: rejected.handover,
    history: rejected.history,
  });

  // 4. 前置满足后按显式动作依次推进
  await runDialog('销售提交交底');
  await call('wait_for', { text: ['合同交底V1已提交'], timeout: 45000 });
  const submitted = await gateOf(first.id);
  assert.equal(submitted.gate.submissionVersion, 1);
  assert.equal(submitted.gate.submissionMatchesSource, true);
  await runDialog('PM确认当前版本');
  await call('wait_for', { text: ['PM已确认合同交底V1'], timeout: 45000 });
  const confirmed = await gateOf(first.id);
  assert.equal(confirmed.gate.confirmationVersion, 1);
  assert.equal(confirmed.gate.confirmationNeedsReview, false);
  await runDialog('记录 G4 结果');
  await call('wait_for', { text: ['G4模拟结果已记录：通过'], timeout: 45000 });
  const reviewed = await gateOf(first.id);
  assert.equal(reviewed.gate.g4Result, '通过');
  assert.notEqual(reviewed.status, '项目执行中', 'G4通过本身不等于移交完成');
  await runDialog('确认项目启动移交');
  await call('wait_for', { text: ['G4通过，项目启动移交已完成'], timeout: 45000 });
  const handedOver = await gateOf(first.id);
  assert.equal(handedOver.gate.handoverStatus, '已移交');
  assert.equal(handedOver.status, '项目执行中');
  assert.deepEqual(
    handedOver.events.map((event) => event.action),
    ['保存启动资料', '提交合同交底', '确认合同交底', '记录G4通过', '完成项目启动移交'],
  );
  const locked = await evaluate(
    `return [...document.querySelectorAll('.action-row')].map(row=>({id:row.id,disabled:row.querySelector('button').disabled,reason:row.querySelector('p').innerText.replace(/\\s+/g,' ').trim()}));`,
  );
  for (const key of ['submit', 'confirm', 'g4']) {
    const row = locked.find((item) => item.id === 'startup-action-' + key);
    assert.equal(row.disabled, true, key + ' 在移交后应锁定');
    assert(row.reason.includes('已锁定'), key + ' 应说明锁定原因');
  }
  await check('前置满足后显式动作依次成功并在移交后锁定', {
    events: handedOver.events,
    status: handedOver.status,
  });

  // 5. 关键来源变化：保留原确认依据、显示待复核、不静默改指新版本
  await openStartup(second.id);
  await runDialog('销售提交交底');
  await call('wait_for', { text: ['合同交底V1已提交'], timeout: 45000 });
  await runDialog('PM确认当前版本');
  await call('wait_for', { text: ['PM已确认合同交底V1'], timeout: 45000 });
  const confirmedSecond = await evaluate(`
    const store=${app}.store;
    const project=store.project(${JSON.stringify(second.id)});
    return {confirmation:structuredClone(project.briefing.confirmation),
      snapshot:structuredClone(project.briefing.submission.snapshot)};
  `);
  await click('解决方案');
  await evaluate(`
    const input=document.querySelector('[data-field="acceptance"] textarea');
    if(!input) throw new Error('未找到验收标准字段');
    input.value='来源修订后的验收标准';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    return true;
  `);
  await click('保存解决方案启动内容');
  await call('wait_for', { text: ['解决方案启动内容已保存'], timeout: 45000 });
  // 交付部门改交期同样按同一份来源版本判定：状态待复核与门禁被拒必须同源
  await click('订单 / 交付协同');
  await evaluate(`
    const input=document.querySelector('[data-field="shipping"] input');
    if(!input) throw new Error('未找到发货周期字段');
    input.value='25个工作日（交付交期修订）';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    return true;
  `);
  await click('保存订单 / 交付协同启动内容');
  await call('wait_for', { text: ['订单 / 交付协同启动内容已保存'], timeout: 45000 });
  const changed = await evaluate(`
    const store=${app}.store;
    const project=store.project(${JSON.stringify(second.id)});
    const alert=document.querySelector('#startup-source-review');
    return {gate:store.startupGate(${JSON.stringify(second.id)}),
      confirmation:structuredClone(project.briefing.confirmation),
      snapshot:structuredClone(project.briefing.submission.snapshot),
      status:project.status,review:project.briefing.review,
      alert:alert?alert.innerText.replace(/\\s+/g,' ').trim():null,
      g4Disabled:document.querySelector('#startup-action-g4 button').disabled,
      g4Reason:document.querySelector('#startup-action-g4 p').innerText.replace(/\\s+/g,' ').trim(),
      handoverDisabled:document.querySelector('#startup-action-handover button').disabled,
      submitDisabled:document.querySelector('#startup-action-submit button').disabled};
  `);
  assert.deepEqual(changed.confirmation, confirmedSecond.confirmation, '原确认依据必须保留');
  assert.deepEqual(changed.snapshot, confirmedSecond.snapshot, '交底快照不得改指新版本');
  assert.equal(changed.gate.confirmationNeedsReview, true);
  assert.deepEqual(changed.gate.changedSources, ['验收标准', '发货周期']);
  assert(changed.alert && changed.alert.includes('验收标准'));
  assert(changed.alert.includes('发货周期') && changed.alert.includes('待复核'));
  assert.equal(changed.g4Disabled, true);
  assert.equal(changed.handoverDisabled, true, '交期变化后移交按钮必须同时被拒');
  assert.equal(changed.submitDisabled, false, '来源变化后销售可重新提交');
  assert(changed.g4Reason.includes('来源已变化'));
  // 项目状态属旧版交底流程的记账：旧版交底已处于"待提交"时不再重复翻转，
  // 但只要它显示了待复核，门禁必须同时被拒（两者不能相互矛盾）。
  if (changed.status === '交底待复核')
    assert.equal(changed.g4Disabled, true, '状态提示待复核时门禁不能放行');
  await runDialog('销售提交交底');
  await call('wait_for', { text: ['合同交底V2已提交'], timeout: 45000 });
  const renewed = await evaluate(`
    const store=${app}.store;
    const project=store.project(${JSON.stringify(second.id)});
    return {version:project.briefing.submission.version,confirmed:project.briefing.confirmation,
      acceptance:project.briefing.submission.snapshot.acceptance,
      shipping:project.briefing.submission.snapshot.shipping,
      changedSources:store.startupGate(${JSON.stringify(second.id)}).changedSources,
      alert:!!document.querySelector('#startup-source-review')};
  `);
  assert.equal(renewed.version, 2);
  assert.equal(renewed.confirmed, undefined);
  assert.equal(renewed.acceptance, '来源修订后的验收标准');
  assert.equal(renewed.shipping, '25个工作日（交付交期修订）', '新版本快照必须记录修订后的交期');
  assert.deepEqual(renewed.changedSources, []);
  assert.equal(renewed.alert, false);
  await check('来源变化保留原确认依据并待复核，重新提交新版本后恢复', {
    alert: changed.alert,
    changedSources: changed.gate.changedSources,
    status: changed.status,
    renewed,
  });

  // 6. 旧启动链接与部门待办定位到正确项目、部门和动作
  const legacyUrl =
    report.baseUrl +
    `/projects/${second.id}/startup?dept=${encodeURIComponent('PMO / PM')}&action=handover` +
    `&returnTo=${encodeURIComponent('/sales/opportunities?tab=departments')}#target`;
  await call('navigate_page', { url: legacyUrl });
  await call('wait_for', { text: ['部门启动内容'], timeout: 45000 });
  const located = await evaluate(`
    const url=new URL(location.href);
    const row=document.querySelector('#startup-action-handover');
    const rect=row.getBoundingClientRect();
    const hint=document.querySelector('#startup-located-hint');
    return {pathname:url.pathname,tab:url.searchParams.get('tab'),dept:url.searchParams.get('dept'),
      action:url.searchParams.get('action'),returnTo:url.searchParams.get('returnTo'),hash:url.hash,
      activeTab:document.querySelector('[aria-label="项目内容"] .active')?.innerText.trim(),
      activeDept:document.querySelector('.dept-tabs .active')?.innerText.trim(),
      current:row.getAttribute('aria-current'),
      reason:row.querySelector('p').innerText.replace(/\\s+/g,' ').trim(),
      visible:rect.top>=0&&rect.bottom<=window.innerHeight,scrollY:Math.round(window.scrollY),
      hint:hint?hint.innerText.trim():null};
  `);
  assert.equal(located.pathname, `/projects/${second.id}`);
  assert.equal(located.tab, 'startup');
  assert.equal(located.dept, 'PMO / PM');
  assert.equal(located.action, 'handover');
  assert.equal(located.returnTo, '/sales/opportunities?tab=departments');
  assert.equal(located.hash, '#target');
  assert.equal(located.activeTab, '启动');
  assert.equal(located.activeDept, 'PM / PMO');
  assert.equal(located.current, 'true');
  assert.equal(located.visible, true, '目标动作未滚动到可视区');
  assert(located.hint && located.hint.includes('已定位到'));
  const departmentReturn = await returnLinkOf();
  assert.deepEqual(departmentReturn, {
    text: '返回部门记录',
    href: '/sales/opportunities?tab=departments',
  });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['部门启动内容'], timeout: 45000 });
  const reloaded = await evaluate(`
    const url=new URL(location.href);
    const row=document.querySelector('#startup-action-handover');
    return {tab:url.searchParams.get('tab'),dept:url.searchParams.get('dept'),action:url.searchParams.get('action'),
      activeDept:document.querySelector('.dept-tabs .active')?.innerText.trim(),
      current:row.getAttribute('aria-current'),visible:row.getBoundingClientRect().top>=0};
  `);
  assert.equal(reloaded.tab, 'startup');
  assert.equal(reloaded.dept, 'PMO / PM');
  assert.equal(reloaded.action, 'handover');
  assert.equal(reloaded.activeDept, 'PM / PMO');
  assert.equal(reloaded.current, 'true');
  assert.equal(reloaded.visible, true);
  const board = await (async () => {
    await call('navigate_page', { url: report.baseUrl + '/projects/board' });
    await call('wait_for', { text: [second.name + '：启动移交待接收'], timeout: 45000 });
    const item = await evaluate(`
      const link=[...document.querySelectorAll('a.work-item')].find(a=>a.innerText.includes('启动移交待接收')&&a.innerText.includes(${JSON.stringify(second.name)}));
      if(!link) throw new Error('看板缺少启动移交待接收待办');
      return {href:link.getAttribute('href'),text:link.innerText.replace(/\\s+/g,' ').trim()};
    `);
    const href = new URL(item.href, report.baseUrl);
    assert.equal(href.pathname, `/projects/${second.id}`);
    assert.equal(href.searchParams.get('tab'), 'startup');
    assert.equal(href.searchParams.get('dept'), 'PMO / PM');
    assert.equal(href.searchParams.get('action'), 'handover');
    assert.equal(href.searchParams.get('returnTo'), '/projects/board');
    await call('navigate_page', { url: report.baseUrl + item.href });
    await call('wait_for', { text: ['部门启动内容'], timeout: 45000 });
    const landed = await evaluate(`
      const row=document.querySelector('#startup-action-handover');
      const rect=row.getBoundingClientRect();
      return {url:location.href,current:row.getAttribute('aria-current'),
        visible:rect.top>=0&&rect.bottom<=window.innerHeight};
    `);
    assert.equal(landed.current, 'true');
    assert.equal(landed.visible, true, '部门待办未定位到接收动作');
    const returnLink = await returnLinkOf();
    assert.deepEqual(returnLink, { text: '返回共享项目看板', href: '/projects/board' });
    return { href: item.href, text: item.text, landed, returnLink };
  })();
  // 返回入口必须真的可用：从共享项目看板进入的待办要能点回看板
  await clickLink('返回共享项目看板');
  assert(await waitForPath('/projects/board'), '返回共享项目看板未真实跳转');
  const returnedToBoard = await evaluate(`
    return {pathname:location.pathname,search:location.search,
      active:document.querySelector('[aria-label="主导航"] .active')?.innerText.replace(/\\s+/g,' ').trim()||null};
  `);
  assert.equal(returnedToBoard.pathname, '/projects/board');
  assert.equal(returnedToBoard.search, '');
  assert(returnedToBoard.active.includes('共享项目看板'), returnedToBoard.active);
  // 部门来源的返回入口同样要能点回部门记录
  await call('navigate_page', { url: legacyUrl });
  await call('wait_for', { text: ['部门启动内容'], timeout: 45000 });
  await clickLink('返回部门记录');
  assert(await waitForPath('/sales/opportunities'), '返回部门记录未真实跳转');
  const returnedToDepartment = await evaluate(
    `return {pathname:location.pathname,tab:new URL(location.href).searchParams.get('tab')};`,
  );
  assert.equal(returnedToDepartment.pathname, '/sales/opportunities');
  assert.equal(returnedToDepartment.tab, 'departments');
  // 轮次进度的“项目启动·打开板块”同样落到容器，并带上部门与目标动作
  const roundEntry = await (async () => {
    await call('navigate_page', { url: report.baseUrl + '/' });
    await call('wait_for', { text: ['本轮真实操作'], timeout: 45000 });
    // 演示工作台收在默认折叠的 <details> 里；折叠态下 innerText 为空，先展开再读取板块。
    await evaluate(`
      const panel=document.querySelector('details.demo-tools');
      if(panel && !panel.open) panel.open=true;
      await new Promise(r=>setTimeout(r,120));
      return true;
    `);
    const link = await evaluate(`
      const store=${app}.store;
      const project=store.project(${JSON.stringify(second.id)});
      store.setRoundContext(project.opportunityId, project.id);
      await new Promise(r=>setTimeout(r,200));
      const row=[...document.querySelectorAll('.module-list li')].find(li=>li.innerText.includes('项目启动'));
      if(!row) throw new Error('轮次进度缺少项目启动板块');
      const anchor=row.querySelector('a.open-link');
      if(!anchor) throw new Error('项目启动板块没有打开入口');
      return {href:anchor.getAttribute('href'),text:anchor.innerText.trim()};
    `);
    const target = new URL(link.href, report.baseUrl);
    assert.equal(target.pathname, `/projects/${second.id}`);
    assert.equal(target.searchParams.get('tab'), 'startup');
    assert(target.searchParams.get('dept'), '轮次进度入口必须带部门参数');
    assert(target.searchParams.get('action'), '轮次进度入口必须带目标动作');
    await evaluate(`
      const row=[...document.querySelectorAll('.module-list li')].find(li=>li.innerText.includes('项目启动'));
      row.querySelector('a.open-link').click();
      return true;
    `);
    await call('wait_for', { text: ['部门启动内容'], timeout: 45000 });
    const landed = await evaluate(`
      const url=new URL(location.href);
      const current=[...document.querySelectorAll('.action-row[aria-current="true"]')].map(row=>row.id);
      return {pathname:url.pathname,tab:url.searchParams.get('tab'),dept:url.searchParams.get('dept'),
        action:url.searchParams.get('action'),anchorId:current[0]||null,
        activeDept:document.querySelector('.dept-tabs .active')?.innerText.trim()||null,
        hint:document.querySelector('#startup-located-hint')?.innerText.trim()||null};
    `);
    assert.equal(landed.pathname, `/projects/${second.id}`);
    assert.equal(landed.tab, 'startup');
    assert.equal(landed.dept, target.searchParams.get('dept'));
    assert.equal(landed.action, target.searchParams.get('action'));
    assert.equal(landed.anchorId, 'startup-action-' + landed.action, '打开板块必须定位到目标动作');
    assert(landed.hint.includes('已定位到'), landed.hint);
    return { link, landed };
  })();
  await check('旧启动链接与部门待办定位同一项目、部门与接收动作', {
    located,
    reloaded,
    board,
    departmentReturn,
    returnedToBoard,
    returnedToDepartment,
    roundEntry,
  });

  // 7. 未保存输入沿用统一离开提示
  await openStartup(second.id, `&dept=${encodeURIComponent('PMO / PM')}`);
  const unsaved = await evaluate(`
    const input=document.querySelector('[data-field="siteConditions"] textarea');
    if(!input) throw new Error('未找到现场条件字段');
    input.value='现场条件未保存草稿';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    const original=window.confirm;
    let prompts=0; window.confirm=()=>{prompts++;return false;};
    document.querySelectorAll('[aria-label="项目内容"] button')[2].click();
    await new Promise(r=>setTimeout(r,200));
    const blocked={url:location.href,prompts,kept:document.querySelector('[data-field="siteConditions"] textarea')?.value};
    window.confirm=()=>{prompts++;return true;};
    document.querySelectorAll('[aria-label="项目内容"] button')[2].click();
    await new Promise(r=>setTimeout(r,250));
    window.confirm=original;
    return {blocked,prompts,url:location.href,panel:!!document.querySelector('app-project-startup-panel')};
  `);
  assert(unsaved.blocked.prompts >= 1, '切换页签应先确认未保存输入');
  assert(unsaved.blocked.url.includes('tab=startup'), '取消后应留在启动交底页签');
  assert.equal(unsaved.blocked.kept, '现场条件未保存草稿');
  assert.equal(unsaved.url.includes('tab=plans'), true, '确认后应允许离开');
  assert.equal(unsaved.panel, false);
  await check('未保存启动内容沿用统一离开提示，取消后不丢输入', unsaved);

  const consoleText = toolText(await call('list_console_messages', { types: ['error'] }));
  report.consoleErrors = consoleText;
  assert(!/msgid=/.test(consoleText), '浏览器控制台出现 Angular 错误');
  report.result = '通过';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.serverLog = serverLog.slice(-12000);
  throw error;
} finally {
  if (connection) {
    await connection.client.close().catch(() => {});
    await connection.transport.close().catch(() => {});
  }
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(3000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('验收证据：', output);
}
