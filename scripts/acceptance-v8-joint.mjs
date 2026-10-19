import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';
import { assertOpportunityRoughPlansUnchanged } from './v8-joint-assertions.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-joint', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 76, checks: [], result: '失败' };
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
  const until = Date.now() + 90000;
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
  await call('wait_for', { text: ['演示辅助'], timeout: 15000 });

  const app = "ng.getComponent(document.querySelector('app-root'))";
  const store = `${app}.store`;
  const joint = {};
  const ready = () =>
    evaluate(
      `for(let n=0;n<200;n++){if(!${store}.originalRecoveryRequest&&!${store}.originalRecoveryRunning)return true;await new Promise(r=>setTimeout(r,25));}throw Error('恢复未结束');`,
    );
  await ready();
  const scenario = async (ids, name, input, operation, expected, run) => {
    const row = { ids, name, input, operation, expected, result: '失败' };
    report.checks.push(row);
    try {
      row.actual = await run();
      row.result = '通过';
    } catch (error) {
      row.error = error.message;
    }
    console.log(row.result, name);
    return row.actual;
  };

  await scenario(
    ['NAV03', 'DEP02'],
    '联合：旧部门入口去处理后返回原筛选',
    '旧销售部门链接与商机 DEMO-O014',
    '打开旧链接，按商机筛选，点查看详情及返回部门记录',
    '落到部门记录；同一商机ID；返回恢复部门与筛选，业务责任人/状态不变',
    async () => {
      const before = await evaluate(`return JSON.stringify(${store}.state());`);
      await evaluate(
        `await ${app}.router.navigateByUrl('/sales/departments?department=销售');return true;`,
      );
      await call('wait_for', { text: ['本部门工作项'], timeout: 20000 });
      await evaluate(
        `const input=document.querySelector('[aria-label="搜索客户名称、商机编号或项目名称"]');input.value='DEMO-O014';input.dispatchEvent(new Event('input',{bubbles:true}));return true;`,
      );
      await click('查看详情');
      await call('wait_for', { text: ['返回部门记录'], timeout: 20000 });
      const detail = await evaluate(
        `return {url:location.pathname+location.search,text:document.body.innerText.slice(0,1500)};`,
      );
      assert(detail.url.includes('DEMO-O014'));
      await click('返回部门记录');
      await call('wait_for', { text: ['本部门工作项'], timeout: 20000 });
      const actual = await evaluate(
        `return {url:location.pathname+location.search,input:document.querySelector('[aria-label="搜索客户名称、商机编号或项目名称"]').value,visible:document.querySelector('app-department-records').innerText,unchanged:${JSON.stringify(before)}===JSON.stringify(${store}.state())};`,
      );
      assert.equal(actual.input, 'DEMO-O014');
      assert(actual.visible.includes('DEMO-O014'));
      assert(actual.url.includes('tab=departments'));
      assert.equal(actual.unchanged, true);
      return { detail, ...actual };
    },
  );
  const contractFlow = await scenario(
    ['QUO02', 'QUO03', 'ATT01', 'ATT02', 'PRO02'],
    '联合：合同采用、附件替换和项目来源同一主线',
    '隔离样例 DEMO-O005，人工合同额123456与付款约定；两份不同PDF字节',
    '准备谈判夹具；公开Store保存草稿、上传替换、显式登记并创建首项目；分别进入合同/项目/旧startup入口',
    '普通附件不签约；成功登记冻结采用摘要且保留人工值；两版字节可读；项目引用同合同；浏览不推进G4',
    async () => {
      const ids = await evaluate(
        `const s=${store};s.state.update(state=>{const next=structuredClone(state);const sale=next.sales.find(x=>x.id==='DEMO-O005');sale.stage='合同谈判';sale.status='进行中';sale.pmoAssignment={...sale.pmoAssignment,pmName:'王项目'};next.contracts=next.contracts.filter(c=>c.opportunityId!==sale.id);next.activities.push({id:'JOINT76-TALK',entityId:sale.id,customerId:sale.customerId,date:'2026-10-10',type:'会议',summary:'联合验收谈判样例',people:'采购',next:'签约',operator:'张销售',stage:'合同谈判'});return next;});if(!s.saveOpportunityRoughPlan('DEMO-O005',{id:'JOINT76-ROUGH',name:'商机承诺隔离夹具',owner:'王项目',start:'2026-11-01',end:'2026-12-01',predecessor:'',relationNote:'',note:'仅联合验收样例',weekWindow:'2026-W45~W49',sourceReference:'联合验收显式样例',sourceType:'自行制定',sourceDetail:'验证项目计划不反写商机粗计划'}))throw Error('无法准备商机粗计划');const contractId=s.createContractDraft('DEMO-O005');s.updateContractDraft(contractId,{sellerEntity:'联合验收主体',amount:123456,payment:'联合人工付款约定',service:'联合人工服务'});return {contractId};`,
      );
      assert(ids.contractId);
      joint.contractId = ids.contractId;
      await evaluate(
        `await ${app}.router.navigateByUrl('/contracts/'+${JSON.stringify(ids.contractId)});return true;`,
      );
      await call('wait_for', { text: ['合同真实原件'], timeout: 20000 });
      await ready();
      const attached = await evaluate(
        `const s=${store};const id=${JSON.stringify(ids.contractId)};const first=await s.replaceContractFile(id,new File(['%PDF-1.7 JOINT76-A'],'joint-A.pdf',{type:'application/pdf'}),{operationId:'JOINT76-A'});const second=await s.replaceContractFile(id,new File(['%PDF-1.7 JOINT76-B'],'joint-B.pdf',{type:'application/pdf'}),{operationId:'JOINT76-B'});return {first,second,status:s.contract(id).status,versions:s.contractFileHistory(id),events:s.state().operationEvents.filter(e=>e.objectId===id).map(e=>e.action),text:document.querySelector('app-contract-original-file').innerText};`,
      );
      assert(attached.first && attached.second);
      assert.equal(attached.status, '草稿');
      assert.equal(attached.versions.length, 2);
      assert(attached.text.includes('joint-A.pdf') && attached.text.includes('joint-B.pdf'));
      const signed = await evaluate(
        `const s=${store};s.setRole('manager');const result=s.registerContractAndStartProject(${JSON.stringify(ids.contractId)},'2026-10-10','联合验收凭据');if(!result)throw Error(s.ui.toast()?.text);const contract=s.contract(result.contractId);return {result,contract,project:s.project(result.projectId),read:await Promise.all(s.contractFileHistory(contract.id).map(async version=>{const read=await s.readContractOriginal(version.id);return {id:version.id,ok:read.ok,bytes:read.ok?await read.blob.text():read.error};}))};`,
      );
      joint.projectId = signed.result.projectId;
      assert.equal(signed.contract.amount, 123456);
      assert.equal(signed.contract.payment, '联合人工付款约定');
      assert(signed.contract.adoptedQuoteSnapshot?.products.length);
      assert.equal(signed.project.contractId, ids.contractId);
      assert(signed.read.every((x) => x.ok));
      assert.deepEqual(signed.read.map((x) => x.bytes).sort(), [
        '%PDF-1.7 JOINT76-A',
        '%PDF-1.7 JOINT76-B',
      ]);
      await call('navigate_page', { type: 'reload' });
      await call('wait_for', { text: ['签约采用依据', 'joint-B.pdf'], timeout: 20000 });
      await ready();
      const basis = await evaluate(
        `return document.querySelector('[aria-label="签约采用报价摘要"]').innerText;`,
      );
      assert(basis.includes('123,456') || basis.includes('123456'));
      assert(basis.includes('联合人工付款约定'));
      const before = await evaluate(
        `return JSON.stringify(${store}.project(${JSON.stringify(joint.projectId)}).briefing);`,
      );
      await evaluate(
        `await ${app}.router.navigateByUrl('/projects/'+${JSON.stringify(joint.projectId)}+'/startup?dept=销售#joint76');return true;`,
      );
      await call('wait_for', { text: ['部门启动内容'], timeout: 20000 });
      const startup = await evaluate(
        `return {url:location.pathname+location.search+location.hash,briefing:JSON.stringify(${store}.project(${JSON.stringify(joint.projectId)}).briefing),text:document.body.innerText};`,
      );
      assert(startup.url.includes(joint.projectId) && startup.url.includes('tab=startup'));
      assert.equal(startup.briefing, before);
      assert(startup.text.includes(ids.contractId));
      return {
        ids,
        attached,
        signed,
        basis,
        startup: { url: startup.url, briefingUnchanged: startup.briefing === before },
      };
    },
  );
  await scenario(
    ['PRO03', 'BUD02', 'DAT02', 'WAR02', 'WAR06'],
    '联合：项目计划、预算、日期与定向提醒真实页面同源',
    '刚签约项目；两个WBS：CNY100.01/EUR200.02；客户节点结束10-20，WBS结束10-23，N=3，负责人及PM王项目',
    '公开Store保存同一主线计划，查看计划表格/预算/概况；切对比档到追踪和我的待办；点去处理定位Plan ID',
    '金额分币种；项目表格/追踪/提醒同PlanID、日期、风险；节点红、WBS黄；查看及已读不推进G4',
    async () => {
      assert(joint.projectId, '前序签约未成功');
      const prepared = await evaluate(
        `const s=${store};const id=${JSON.stringify(joint.projectId)};const template=s.state().projects.flatMap(p=>p.plans).find(p=>p.type==='内部WBS');const customer=s.state().projects.flatMap(p=>p.plans).find(p=>p.type==='客户主节点');s.setRole('pm');const common={start:'2026-10-16',expected:'',actual:'',status:'未开始',owner:'王项目',warningLeadDays:3,customerMilestoneId:undefined,completionKind:'普通'};const plans=[{...template,...common,id:'JOINT76-CNY',name:'JOINT76-CNY任务',end:'2026-10-23',budgetAmount:100.01,budgetCurrency:'CNY',budgetSource:'业务填报'},{...template,...common,id:'JOINT76-EUR',name:'JOINT76-EUR任务',end:'2026-10-23',budgetAmount:200.02,budgetCurrency:'EUR',budgetSource:'业务填报'},{...customer,...common,id:'JOINT76-NODE',name:'JOINT76-客户节点',end:'2026-10-20',budgetAmount:undefined,budgetCurrency:undefined,budgetSource:undefined}];const roughBefore=structuredClone(s.sale(s.project(id).opportunityId).opportunityRoughPlans);if(!Array.isArray(roughBefore)||!roughBefore.length)throw Error('真实粗计划样例为空');const saved=plans.map(p=>s.savePlan(id,p,p.id+'-SAVE'));return {saved,roughBefore,roughAfterSave:structuredClone(s.sale(s.project(id).opportunityId).opportunityRoughPlans),plans:s.project(id).plans.filter(p=>p.id.startsWith('JOINT76-')),summary:s.planBudgetSummary(id),briefing:JSON.stringify(s.project(id).briefing)};`,
      );
      assert(prepared.saved.every(Boolean));
      assertOpportunityRoughPlansUnchanged(
        prepared.roughBefore,
        prepared.roughAfterSave,
        '项目计划保存',
      );
      joint.roughBefore = prepared.roughBefore;
      joint.planId = 'JOINT76-CNY';
      joint.plans = prepared.plans;
      await evaluate(
        `await ${app}.router.navigateByUrl('/projects/'+${JSON.stringify(joint.projectId)}+'?tab=plans&plan=内部WBS');return true;`,
      );
      await call('wait_for', { text: ['JOINT76-CNY任务', 'JOINT76-EUR任务'], timeout: 20000 });
      const table = await evaluate(
        `return {rows:[...document.querySelectorAll('tr[data-plan-id]')].filter(e=>e.dataset.planId.startsWith('JOINT76-')).map(e=>({id:e.dataset.planId,text:e.innerText})),budget:document.querySelector('[aria-label="内部WBS分币种预算摘要"]').innerText};`,
      );
      assert.equal(table.rows.length, 2);
      assert(table.rows.find((r) => r.id === 'JOINT76-CNY').text.includes('100.01'));
      assert(table.rows.find((r) => r.id === 'JOINT76-EUR').text.includes('200.02'));
      assert(table.budget.includes('CNY') && table.budget.includes('EUR'));
      await evaluate(
        `await ${app}.router.navigateByUrl('/projects/'+${JSON.stringify(joint.projectId)}+'?tab=overview');return true;`,
      );
      const overview = await evaluate(
        `return document.querySelector('[aria-label="项目概况计划与预算摘要"]').innerText;`,
      );
      assert(overview.includes('100.01') && overview.includes('200.02'));
      await evaluate(
        `${store}.setDateMode('comparison');await ${app}.router.navigateByUrl('/plans/tracking?projectId='+${JSON.stringify(joint.projectId)});return true;`,
      );
      await call('wait_for', { text: ['JOINT76-CNY任务', 'JOINT76-客户节点'], timeout: 20000 });
      const tracking = await evaluate(
        `return [...document.querySelectorAll('tr[data-plan-id]')].filter(e=>e.dataset.planId.startsWith('JOINT76-')).map(e=>({id:e.dataset.planId,text:e.innerText,level:e.querySelector('.badge.risk-yellow')?'yellow':e.querySelector('.badge.risk-red')?'red':null}));`,
      );
      assert(tracking.some((r) => r.id === 'JOINT76-CNY' && r.level === 'yellow' && /预警/.test(r.text)));
      assert(tracking.some((r) => r.id === 'JOINT76-NODE' && r.level === 'red' && /逾期/.test(r.text)));
      await evaluate(`await ${app}.router.navigateByUrl('/');return true;`);
      await call('wait_for', { text: ['预警事项', 'JOINT76-CNY任务'], timeout: 20000 });
      const warnings = await evaluate(
        `const section=document.querySelector('#warning-title').closest('section');return [...section.querySelectorAll('.task-row')].filter(e=>e.innerText.includes('JOINT76-')).map(e=>({text:e.innerText,href:e.querySelector('a.process-link')?.getAttribute('href'),level:e.querySelector('[data-level]')?.getAttribute('data-level')}));`,
      );
      assert.equal(warnings.length, 3);
      const selected = warnings.find((r) => r.text.includes('JOINT76-CNY任务'));
      assert(selected.href.includes('planId=JOINT76-CNY'));
      assert.equal(selected.level, 'yellow');
      assert(warnings.some((w) => w.text.includes('JOINT76-客户节点') && w.level === 'red'));
      await evaluate(
        `const section=document.querySelector('#warning-title').closest('section');const row=[...section.querySelectorAll('.task-row')].find(e=>e.innerText.includes('JOINT76-CNY任务'));row.querySelector('a.process-link').click();return true;`,
      );
      await call('wait_for', { text: ['已定位到 Plan ID： JOINT76-CNY'], timeout: 20000 }).catch(
        async () => {
          assert(
            await evaluate(
              `return document.body.innerText.includes('JOINT76-CNY')&&location.search.includes('planId=JOINT76-CNY');`,
            ),
          );
        },
      );
      const located = await evaluate(
        `return {url:location.href,row:document.querySelector('tr[data-plan-id="JOINT76-CNY"]')?.innerText,focused:!!document.querySelector('[data-plan-id="JOINT76-CNY"].plan-focused'),unchangedBriefing:JSON.stringify(${store}.project(${JSON.stringify(joint.projectId)}).briefing)===${JSON.stringify(prepared.briefing)},rough:structuredClone(${store}.sale(${store}.project(${JSON.stringify(joint.projectId)}).opportunityId).opportunityRoughPlans)};`,
      );
      assert(located.focused && located.row.includes('JOINT76-CNY任务'));
      assert(located.unchangedBriefing);
      assertOpportunityRoughPlansUnchanged(prepared.roughBefore, located.rough, '跨入口定位');
      await call('navigate_page', { type: 'reload' });
      await ready();
      await call('wait_for', { text: ['JOINT76-CNY任务'], timeout: 20000 });
      const refreshed = await evaluate(
        `return {row:document.querySelector('tr[data-plan-id="JOINT76-CNY"]').innerText,rough:structuredClone(${store}.sale(${store}.project(${JSON.stringify(joint.projectId)}).opportunityId).opportunityRoughPlans)};`,
      );
      assert(refreshed.row.includes('100.01'));
      assertOpportunityRoughPlansUnchanged(prepared.roughBefore, refreshed.rough, '页面刷新');
      return { prepared, table, overview, tracking, warnings, located, refreshed };
    },
  );
  await scenario(
    ['NAV03', 'DEL03'],
    '联合：交付总览与项目页显示同一物流事项，不把预计日期当实际',
    '刚签约项目的要货发货任务JOINT76-LOG，预计10-28、实际留空',
    '正常保存计划；从旧物流URL、交付页、项目交付页分别读取真实表格行',
    '三入口同ID/字段/状态，实际仍待提供，查看未新增验收移交事实',
    async () => {
      const id = joint.projectId;
      assert(id);
      const before = await evaluate(
        `const s=${store};const template=s.state().projects.flatMap(p=>p.plans).find(p=>p.type==='要货发货');if(!template)throw Error('缺要货模板');const saved=s.savePlan(${JSON.stringify(id)},{...template,id:'JOINT76-LOG',name:'JOINT76-物流',status:'未开始',start:'2026-10-16',end:'2026-10-25',expected:'2026-10-28',actual:'',owner:'王项目',customerMilestoneId:undefined},'JOINT76-LOG-SAVE');return {saved,project:JSON.stringify(s.project(${JSON.stringify(id)})),events:JSON.stringify(s.state().operationEvents),rough:structuredClone(s.sale(s.project(${JSON.stringify(id)}).opportunityId).opportunityRoughPlans)};`,
      );
      assert(before.saved);
      assertOpportunityRoughPlansUnchanged(joint.roughBefore, before.rough, '物流计划保存');
      const views = [];
      for (const url of [
        `/plans/logistics?project=${id}&source=joint76#target`,
        `/delivery-service?projectId=${id}&tab=logistics`,
        `/projects/${id}?tab=delivery&deliveryTab=logistics`,
      ]) {
        await evaluate(`await ${app}.router.navigateByUrl(${JSON.stringify(url)});return true;`);
        await call('wait_for', { text: ['JOINT76-物流'], timeout: 20000 });
        const row = await evaluate(
          `return {url:location.pathname+location.search+location.hash,text:[...document.querySelectorAll('app-project-delivery-panel tbody tr')].find(e=>e.innerText.includes('JOINT76-LOG'))?.innerText};`,
        );
        assert(row.text && row.text.includes('2026-10-28'));
        assert(row.text.includes('待提供'));
        views.push(row);
      }
      assert.equal(views[0].text, views[1].text);
      assert.equal(views[1].text, views[2].text);
      const unchanged = await evaluate(
        `return {project:JSON.stringify(${store}.project(${JSON.stringify(id)}))===${JSON.stringify(before.project)},events:JSON.stringify(${store}.state().operationEvents)===${JSON.stringify(before.events)}};`,
      );
      assert(unchanged.project && unchanged.events);
      return { views, unchanged };
    },
  );
  await scenario(
    ['DAT02', 'DAT03'],
    '联合：日期切换不改跨模块业务与历史',
    '现有全部项目、合同、商机和操作事件',
    '切对比档、访问计划/追踪/项目、切回正常并刷新',
    '日期同源；业务对象和事件逐字不变',
    async () => {
      const result = await evaluate(
        `const s=${store};const snapshot=()=>JSON.stringify({projects:s.state().projects,contracts:s.state().contracts,sales:s.state().sales,events:s.state().operationEvents});const before=snapshot();const first=s.setDateMode('comparison');const views=[];for(const path of ['/plans','/plans/tracking','/projects']){await ${app}.router.navigateByUrl(path);views.push({path,date:s.observationDate(),mode:s.dateMode()});}const second=s.setDateMode('normal');return {first,second,views,unchanged:before===snapshot(),date:s.observationDate()};`,
      );
      assert.equal(result.first, true);
      assert.equal(result.second, true);
      assert.equal(result.unchanged, true);
      assert(result.views.every((x) => x.mode === 'comparison' && x.date === '2026-10-22'));
      assert.equal(result.date, '2026-10-15');
      return result;
    },
  );
  await scenario(
    ['MIG03'],
    '联合：容量失败保留业务、历史、待办、引导',
    '内部WBS候选更名；localStorage快照写入抛QuotaExceededError',
    '拦截Storage.prototype.setItem，调用正常savePlan，finally还原',
    '返回false；完整state和持久快照原样保留',
    async () => {
      const actual = await evaluate(
        `const s=${store};const p=s.project(${JSON.stringify(joint.projectId)});const plan=p.plans.find(x=>x.type==='内部WBS'&&x.status!=='已完成');const before=JSON.stringify(s.state());const raw=localStorage.getItem(s.activeSnapshotKey);const original=Storage.prototype.setItem;let result;try {Storage.prototype.setItem=function(){throw new DOMException('JOINT76 quota','QuotaExceededError')};result=s.savePlan(p.id,{...plan,name:'JOINT76 must not persist'},'JOINT-76-FAIL');}finally{Storage.prototype.setItem=original;}return {result,stateUnchanged:before===JSON.stringify(s.state()),snapshotUnchanged:raw===localStorage.getItem(s.activeSnapshotKey),toast:s.ui.toast()};`,
      );
      assert.equal(actual.result, false);
      assert.equal(actual.stateUnchanged, true);
      assert.equal(actual.snapshotUnchanged, true);
      return actual;
    },
  );

  await scenario(
    ['MIG03', 'ATT04'],
    '联合：旧修订、失权、Blob与附件快照故障不发布单边结果',
    '同主线计划和已有两版附件；逐次注入旧持久修订/失去租约/Blob暂存错误/附件快照容量错误',
    '调用正常公开Store保存入口，finally还原故障；比较整份state和原件键集合',
    '每次拒绝；合同/项目/历史/引导/待办数据不变，旧原件不删，不登记新版本',
    async () => {
      assert(joint.contractId && joint.projectId);
      const actual = await evaluate(
        `const s=${store};const results=[];for(const fault of ['stored-version','lease','blob-stage','blob-snapshot']){const before=JSON.stringify(s.state());const originals=s.contractOriginals;const keysBefore=(await originals.keys()).sort();const get=Storage.prototype.getItem,set=Storage.prototype.setItem,owns=s.editingLease.owns;let result;try{if(fault==='stored-version')Storage.prototype.getItem=function(key){const raw=get.call(this,key);if(key===s.activeSnapshotKey&&raw){const data=JSON.parse(raw);const state=data.snapshot||data;state.dataVersion=(state.dataVersion||1)+1;return JSON.stringify(data);}return raw;};if(fault==='lease')s.editingLease.owns=()=>false;if(fault==='blob-stage')s.contractOriginals={stage:async()=>{throw Error('JOINT76 IDB stage failure')},read:id=>originals.read(id),keys:()=>originals.keys(),promote:id=>originals.promote(id),discard:(id,g)=>originals.discard(id,g)};if(fault==='blob-snapshot')Storage.prototype.setItem=function(key,value){if(key===s.activeSnapshotKey)throw new DOMException('JOINT76 attachment quota','QuotaExceededError');return set.call(this,key,value);};if(fault.startsWith('blob'))result=await s.replaceContractFile(${JSON.stringify(joint.contractId)},new File(['%PDF-1.7 rejected '+fault],fault+'.pdf',{type:'application/pdf'}),{operationId:'JOINT76-'+fault});else{const p=s.project(${JSON.stringify(joint.projectId)});const plan=p.plans.find(p=>p.id==='JOINT76-CNY');result=s.savePlan(p.id,{...plan,name:'must reject '+fault},'JOINT76-'+fault);}}finally{Storage.prototype.getItem=get;Storage.prototype.setItem=set;s.editingLease.owns=owns;s.contractOriginals=originals;s.editingWritable.set(true);}results.push({fault,result,unchanged:before===JSON.stringify(s.state()),keysBefore,keysAfter:(await originals.keys()).sort(),message:s.ui.toast()?.text});}return results;`,
      );
      for (const row of actual) {
        assert.equal(row.result, false, row.fault);
        assert.equal(row.unchanged, true, row.fault);
        assert.deepEqual(row.keysAfter, row.keysBefore, row.fault);
      }
      return actual;
    },
  );
  await scenario(
    ['MIG04'],
    '联合：重置失败不提前换档/新轮或清理，成功归正常新轮',
    '对比档和当前工作区；Storage.prototype.setItem注入容量失败',
    '失败重置后比对state/工作区引用，再还原存储执行重置',
    '失败完整保留；成功新roundId、normal，旧工作区仍可引用',
    async () => {
      const actual = await evaluate(
        `const s=${store};s.setDateMode('comparison');const before=JSON.stringify(s.state());const oldRound=s.state().roundId;const oldKey=s.activeSnapshotKey;const oldRaw=localStorage.getItem(oldKey);const original=Storage.prototype.setItem;let failed;try {Storage.prototype.setItem=function(){throw new DOMException('JOINT76 reset quota','QuotaExceededError')};failed=await s.reset();}finally{Storage.prototype.setItem=original;}const failure={result:failed,unchanged:before===JSON.stringify(s.state()),sameKey:oldKey===s.activeSnapshotKey,oldSnapshot:oldRaw===localStorage.getItem(oldKey),date:s.dateMode()};const success=await s.reset();return {failure,success,newRound:s.state().roundId,oldRound,mode:s.dateMode(),oldSnapshotPreserved:oldRaw===localStorage.getItem(oldKey)};`,
      );
      assert.equal(actual.failure.result, false);
      assert.equal(actual.failure.unchanged, true);
      assert.equal(actual.failure.sameKey, true);
      assert.equal(actual.failure.oldSnapshot, true);
      assert.equal(actual.failure.date, 'comparison');
      assert.equal(actual.success, true);
      assert.notEqual(actual.newRound, actual.oldRound);
      assert.equal(actual.mode, 'normal');
      assert.equal(actual.oldSnapshotPreserved, true);
      return actual;
    },
  );
  report.scopeNote =
    '联合脚本只验证上述具体步骤；不把单个子场景通过解释成整个验收ID通过。全部ID覆盖与未执行项见专项报告。';
  report.result = report.checks.every((x) => x.result === '通过') ? '通过' : '失败';
  if (report.result === '失败') process.exitCode = 1;
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
