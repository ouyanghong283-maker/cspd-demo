import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const base = 'http://127.0.0.1:4324',
  out = path.join(root, 'artifacts/v9-b04');
await fs.mkdir(out, { recursive: true });
const c = await connect({ isolated: true });
let pageId;
const checks = [];
const call = (n, a = {}) => c.call(n, { pageId, ...a });
const run = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw Error(raw);
  return JSON.parse(match[1]);
};
const pause = () => new Promise((r) => setTimeout(r, 300));
const open = async (route, text) => {
  await call('navigate_page', { type: 'url', url: base + route });
  await call('wait_for', { text: [text], timeout: 30000 });
  await pause();
};
const record = (name, value) => checks.push({ name, ...value });
const panel = "ng.getComponent(document.querySelector('app-solution-input-panel'))";
try {
  const raw = toolText(await c.call('new_page', { url: base + '/sales/solutions/DEMO-O008' }));
  pageId = Number(raw.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  const baseline = await run(
    `const p=${panel};p.store.setRole('solution');return {schema:p.store.state().storageSchemaVersion,id:p.store.v9CommandTarget().workspaceId,backup:[...Array(localStorage.length)].map((_,i)=>localStorage.key(i)).filter(k=>k.includes('legacy-backup')).length};`,
  );
  assert.equal(baseline.schema, 3);
  assert.ok(baseline.backup);
  record('公共加载完成备份与V9升级', baseline);
  for (const [kind, label, ext] of [
    ['proposal', '技术方案', 'pptx'],
    ['bom', '设计BOM', 'xlsx'],
    ['sld', 'SLD', 'pdf'],
    ['degradation', '衰减资料', 'csv'],
  ]) {
    const file = path.join(out, '真实验证-' + label + '.' + ext);
    await fs.writeFile(file, 'B04真实文件边界验证 ' + kind);
    const snap = toolText(await call('take_snapshot'));
    const line = snap.split('\n').find((l) => l.includes(`button "选择${label}文件"`));
    assert.ok(line, label);
    await call('upload_file', { uid: line.match(/uid=(\S+)/)[1], filePaths: [file] });
    await run(
      `const root=document.querySelector('app-solution-input-panel');[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存${label}').focus();return document.activeElement.textContent.trim();`,
    );
    await call('press_key', { key: 'Enter' });
    await pause();
    await run(`await ${panel}.check();return true;`);
    const v = await run(
      `const p=${panel};return {number:p.current('${kind}').number,availability:p.availability()[p.current('${kind}').id]};`,
    );
    assert.equal(v.availability, 'present');
    record('真实文件选择与键盘Enter保存 ' + kind, v);
  }
  // CODEX公开入口验证；K15确认表单留待KIMI，不把本调用记作真实表单定稿。
  const finalized = await run(
    `const p=${panel};p.store.saveProductNeed(p.opportunityId(),{id:'B04-NEED',model:'PCS-100',quantity:2,unit:'台'});p.beginEdit();p.pm='demo-person:王项目';p.owner='demo-person:周方案';p.deadline='2026-10-20';p.reason='第四批验证';p.saveSchedule();await p.check();const s=p.finalization();const t=p.store.v9CommandTarget();const input={opportunityId:p.opportunityId(),fourVersionIds:s.fourVersionIds,productNeedRevision:s.productNeedRevision,ownerPersonId:s.schedule.owner.personId,scheduleRevision:s.schedule.revision,actingOnBehalf:false};const r=await p.confirmFinalization(input,{...t,operationId:'B04-F1'});window.b04First=p.finalization().first;window.b04Input=input;return {status:r.status,message:r.message,source:p.finalization()};`,
  );
  assert.equal(finalized.status, 'committed');
  assert.equal(finalized.source.events.length, 1);
  record('公开命令真实文件首次定稿（非K15表单）', {
    id: finalized.source.first.eventId,
    pm: finalized.source.events[0].pm,
  });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  const reload = await run(
    `const p=${panel};await p.check();return {first:p.finalization().first,events:p.finalization().events.length,files:p.view().files.map(f=>f.availability),frozen:p.schedule().frozen};`,
  );
  assert.equal(reload.events, 1);
  assert.equal(reload.frozen, true);
  assert.ok(reload.files.every((f) => f === 'present'));
  record('定稿刷新冻结与当前Blob', reload);
  // 真实替换会回收旧Blob但保留定稿快照。
  const replacement = path.join(out, '长文件名_真实替换方案_' + '文件'.repeat(20) + '.pptx');
  await fs.writeFile(replacement, 'replacement bytes');
  const old = await run(`return ${panel}.current('proposal');`);
  const snap = toolText(await call('take_snapshot'));
  const line = snap.split('\n').find((l) => l.includes('button "选择技术方案文件"'));
  await call('upload_file', { uid: line.match(/uid=(\S+)/)[1], filePaths: [replacement] });
  await run(`await ${panel}.upload('proposal');return true;`);
  await pause();
  const replaced = await run(
    `const p=${panel};await p.check();const w=p.view().workspace;const old=await p.files.get(${JSON.stringify(old.file.blobId)});return {oldExists:!!old,status:p.finalization().status,events:p.finalization().events.length,first:p.finalization().first,number:p.current('proposal').number,historical:w.versions.some(v=>v.id===${JSON.stringify(old.id)}&&v.file===null)};`,
  );
  assert.equal(replaced.oldExists, false);
  assert.equal(replaced.status, 'stale');
  assert.equal(replaced.historical, true);
  assert.deepEqual(replaced.first, reload.first);
  record('真实替换后定向回收与首次历史保真', replaced);
  const re = await run(
    `const p=${panel};const s=p.finalization(),t=p.store.v9CommandTarget();const r=await p.confirmFinalization({opportunityId:p.opportunityId(),fourVersionIds:s.fourVersionIds,productNeedRevision:s.productNeedRevision,ownerPersonId:s.schedule.owner.personId,scheduleRevision:s.schedule.revision,actingOnBehalf:false},{...t,operationId:'B04-F2'});return {status:r.status,count:p.finalization().events.length};`,
  );
  assert.equal(re.count, 2);
  record('公开命令重新定稿保留首次', re);
  // 五宽，两旧入口均只有一个四输出区，历史无下载控件。
  for (const route of [
    '/sales/solutions/DEMO-O008',
    '/sales/detail/DEMO-O008?tab=' + encodeURIComponent('方案'),
  ]) {
    await open(route, '真实方案文件与首次期限');
    for (const width of [1920, 1440, 1024, 768, 390]) {
      await call('resize_page', { width, height: 1000 });
      const v = await run(
        `const p=document.querySelector('app-solution-input-panel');for(const d of p.querySelectorAll('details'))d.open=true;return {width:innerWidth,panels:document.querySelectorAll('app-solution-input-panel').length,files:p.querySelectorAll('input[type=file]').length,overflow:document.documentElement.scrollWidth>innerWidth+1,download:p.querySelectorAll('[download]').length};`,
      );
      assert.equal(v.overflow, false);
      assert.equal(v.panels, 1);
      assert.equal(v.files, 4);
      assert.equal(v.download, 0);
      record('两入口五宽资料及展开历史 ' + route, v);
    }
  }
  await call('take_screenshot', { filePath: path.join(out, 'solution-390.png'), fullPage: true });
  await open('/sales/quotes/DEMO-O008', '报价工作区');
  const q = await run(
    `const p=ng.getComponent(document.querySelector('app-quote-solution-basis-panel'));return {status:p.view().status,before:JSON.stringify(p.store.quoteVersion(p.quoteVersionId()))};`,
  );
  await run(
    `const p=ng.getComponent(document.querySelector('app-quote-solution-basis-panel'));return p.prepare().then(()=>({ready:!!p.prepared(),feedback:p.feedback()}));`,
  ).then((v) => {
    assert.equal(v.ready, true);
    record('真实报价核对当前定稿摘要', v);
  });
  await run(
    `const b=[...document.querySelectorAll('app-quote-solution-basis-panel button')].find(b=>b.textContent.trim()==='确认采用此方案');b.focus();return true;`,
  );
  await call('press_key', { key: 'Enter' });
  await pause();
  const adopted = await run(
    `const p=ng.getComponent(document.querySelector('app-quote-solution-basis-panel'));return {view:p.view(),quote:p.store.quoteVersion(p.quoteVersionId())};`,
  );
  assert.equal(adopted.view.status, 'current');
  const { solutionBasis, contentRevision, ...fields } = adopted.quote;
  const { contentRevision: rev, ...oldFields } = JSON.parse(q.before);
  assert.deepEqual(fields, oldFields);
  record('键盘显式采用只更新依据与内容修订', {
    status: adopted.view.status,
    id: solutionBasis.finalizationId,
  });
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['报价采用的方案'], timeout: 30000 });
  assert.equal(
    await run(
      `return ng.getComponent(document.querySelector('app-quote-solution-basis-panel')).view().status;`,
    ),
    'current',
  );
  record('采用刷新依据保留', { passed: true });
  const projectId = await run(
    `const p=ng.getComponent(document.querySelector('app-quote-solution-basis-panel'));return p.store.state().projects[0].id;`,
  );
  let savedPlanId;
  for (const type of ['要货发货', '调试备件', '开票回款']) {
    await open(
      '/projects/' + projectId + '?tab=plans&plan=' + encodeURIComponent(type),
      type + '计划',
    );
    const initial = await run(
      `const p=ng.getComponent(document.querySelector('app-budget-expense-panel, app-progress-mapping-panel'));return {version:p.store.state().dataVersion,events:p.store.state().operationEvents.length};`,
    );
    for (const width of [1920, 1440, 1024, 768, 390]) {
      await call('resize_page', { width, height: 1000 });
      const v = await run(
        `const s=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes('${type === '开票回款' ? '查看只读预算费用依据' : '办理任务关联与执行要求'}'));s.open=true;return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,panel:!!document.querySelector('${type === '开票回款' ? 'app-budget-expense-panel' : 'app-progress-mapping-panel'}')};`,
      );
      assert.equal(v.overflow, false);
      assert.equal(v.panel, true);
      record(type + '五宽来源面板', v);
    }
    if (type === '调试备件') {
      const before = await run(
        `const p=ng.getComponent(document.querySelector('app-node-applicability-panel'));return JSON.stringify(p.store.project(p.projectId()).plans);`,
      );
      await run(
        `const p=ng.getComponent(document.querySelector('app-node-applicability-panel'));p.begin();return true;`,
      );
      await pause();
      await run(
        `const root=document.querySelector('app-node-applicability-panel');const el=root.querySelector('[name=applicabilityReason]');el.value='本合同无需现场调试';el.dispatchEvent(new Event('input',{bubbles:true}));root.querySelector('form').requestSubmit();return true;`,
      );
      await pause();
      const waived = await run(
        `const p=ng.getComponent(document.querySelector('app-node-applicability-panel'));return {feedback:p.feedback(),record:p.view().find(n=>n.id==='execution.sat').record,plans:JSON.stringify(p.store.project(p.projectId()).plans)};`,
      );
      assert.equal(waived.record.applicability, 'not-required');
      assert.equal(waived.plans, before);
      record('调试来源真实表单免做保留原门禁事实', {
        feedback: waived.feedback,
        record: waived.record,
      });
      await run(
        `const p=ng.getComponent(document.querySelector('app-node-applicability-panel'));p.begin();p.applicability='applicable';p.reason='恢复现场执行';p.save();return true;`,
      );
      assert.equal(
        await run(
          `const p=ng.getComponent(document.querySelector('app-node-applicability-panel'));return p.view().find(n=>n.id==='execution.sat').record.history.length;`,
        ),
        2,
      );
      record('撤销免做历史与来源任务保真', { passed: true });
    } else {
      const after = await run(
        `const p=ng.getComponent(document.querySelector('app-budget-expense-panel, app-progress-mapping-panel'));return {version:p.store.state().dataVersion,events:p.store.state().operationEvents.length};`,
      );
      assert.deepEqual(after, initial);
      record(type + '只读展开不写业务', after);
      if (type === '要货发货') {
        await run(
          `const p=ng.getComponent(document.querySelector('app-progress-mapping-panel'));p.group='shipping';p.begin();return true;`,
        );
        await pause();
        savedPlanId = await run(
          `const p=ng.getComponent(document.querySelector('app-progress-mapping-panel'));const id=(p.view().options.find(x=>x.type==='要货发货')??p.view().options[0]).id;const root=document.querySelector('app-progress-mapping-panel');const boxes=[...root.querySelectorAll('input[type=checkbox]')];const i=p.view().options.findIndex(x=>x.id===id);boxes[i].click();const reason=root.querySelector('[name=mappingReason]');reason.value='物流范围按合同确认';reason.dispatchEvent(new Event('input',{bubbles:true}));[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='确认任务组').focus();return id;`,
        );
        await call('press_key', { key: 'Enter' });
        await pause();
        const mapping = await run(
          `const p=ng.getComponent(document.querySelector('app-progress-mapping-panel'));return p.view().groups.find(g=>g.id==='shipping');`,
        );
        assert.deepEqual(mapping.planIds, [savedPlanId]);
        assert.equal(mapping.revision, 1);
        record('要货来源键盘保存真实任务映射', mapping);
        await call('navigate_page', { type: 'reload' });
        await call('wait_for', { text: ['要货发货计划'], timeout: 30000 });
        const stable = await run(
          `const p=ng.getComponent(document.querySelector('app-progress-mapping-panel'));return p.view().groups.find(g=>g.id==='shipping');`,
        );
        assert.deepEqual(stable.planIds, [savedPlanId]);
        assert.equal(stable.history.length, 1);
        record('任务映射刷新保留成员历史', { planIds: stable.planIds, revision: stable.revision });
      }
    }
  }
  await call('take_screenshot', { filePath: path.join(out, 'delivery-390.png'), fullPage: true });
  await open(
    '/projects/' + projectId + '?tab=overview&section=' + encodeURIComponent('业务进度'),
    '全流程业务进度',
  );
  const progress = await run(
    `const p=ng.getComponent(document.querySelector('app-lifecycle-progress-panel'));return p.view();`,
  );
  assert.deepEqual(progress.nodes.find((n) => n.nodeId === 'execution.shipment').sourceIds, [
    savedPlanId,
  ]);
  assert.notEqual(progress.nodes.find((n) => n.nodeId === 'execution.sat').status, 'not-required');
  record('真实项目进度消费映射与撤销免做', {
    shipment: progress.nodes.find((n) => n.nodeId === 'execution.shipment'),
    sat: progress.nodes.find((n) => n.nodeId === 'execution.sat'),
    percent: progress.displayPercent,
  });
  const firstPageId = pageId;
  const second = toolText(
    await c.call('new_page', {
      url:
        base + '/projects/' + projectId + '?tab=overview&section=' + encodeURIComponent('业务进度'),
    }),
  );
  pageId = Number(second.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['全流程业务进度'], timeout: 30000 });
  const readonly = await run(
    `const p=ng.getComponent(document.querySelector('app-node-applicability-panel'));const before=JSON.stringify(p.store.state());p.begin();p.reason='只读不得保存';p.save();return {writable:p.store.editingWritable(),unchanged:JSON.stringify(p.store.state())===before,feedback:p.feedback()};`,
  );
  assert.equal(readonly.writable, false);
  assert.equal(readonly.unchanged, true);
  record('第二标签页只读命令拒绝不发布历史', readonly);
  await call('close_page');
  pageId = firstPageId;

  await fs.writeFile(
    path.join(root, '../docs/verification/v9-b04/browser-report.json'),
    JSON.stringify({ passed: checks.length, checks }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length }));
} catch (e) {
  await fs.writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify({ message: e.message, checks }, null, 2),
  );
  console.error(e);
  process.exitCode = 1;
} finally {
  await c.client.close();
  await c.transport.close();
}
