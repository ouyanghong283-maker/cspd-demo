import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-workspace-migration', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 75, checks: [], result: '失败' };
let server;
let connection;
let pageId;
let serverFailure;
let serverLog = '';
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const response = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const match = response.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + response);
  return JSON.parse(match[1]);
};
const clickText = async (label) => {
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
  const row = snapshot.split('\n').find((line) => line.includes(`link "${label}`));
  assert(row, '找不到链接：' + label);
  await call('click', { uid: row.match(/uid=(\S+)/)[1] });
};
// 共享机器上单次 MCP 调用与页面刷新都可能比预期慢，用条件轮询代替固定等待，避免易碎失败。
// 文本匹配在浏览器内完成：合同详情页正文远超过单次回传上限，截断后判断会漏掉靠后的面板。
const waitForText = async (needles, timeout = 60000) => {
  const until = Date.now() + timeout;
  let text = '';
  for (;;) {
    try {
      const probe = await evaluate(`
        const text=document.body.innerText||'';
        return {found:${JSON.stringify(needles)}.every((needle)=>text.includes(needle)),sample:text.slice(0,200)};`);
      if (probe.found) return true;
      text = probe.sample;
    } catch (error) {
      text = String(error);
    }
    if (Date.now() >= until)
      throw new Error(
        `等待文本超时（${timeout}ms）：${needles.join('、')}；当前页面 ${text.slice(0, 200)}`,
      );
    await delay(500);
  }
};
const check = async (name, body) => {
  const evidence = await evaluate(body);
  assert.equal(evidence.ok, true, JSON.stringify(evidence));
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
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
  const app = "ng.getComponent(document.querySelector('app-root'))";
  const created = toolText(
    await connection.call('new_page', { url: report.baseUrl + '/contracts' }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await waitForText(['CSPD']);
  const sample = JSON.parse(
    await fs.readFile(path.join(root, 'tests/fixtures/v8-legacy-workspace.json'), 'utf8'),
  );
  const real = await evaluate(`
    const store=${app}.store;for(let n=0;n<100&&(store.originalRecoveryRunning||store.originalRecoveryRequest);n++)await new Promise(r=>setTimeout(r,20));
    const contractId=${JSON.stringify(sample.contracts[0].id)};
    const result=await store.replaceContractFile(contractId,new File(['%PDF-1.7 retained-real-original'],'迁移前真实合同.pdf',{type:'application/pdf'}));
    if(!result)throw Error('迁移前真实原件未能准备');
    return {version:store.contractFileVersion(contractId),roundId:store.state().roundId};
  `);
  sample.roundId = real.roundId;
  sample.contractFileVersions = [real.version];
  sample.contracts[0].currentContractFileVersionId = real.version.id;
  report.originalFileBefore = real;
  const before = {
    projects: sample.projects.map((p) => p.id),
    contracts: sample.contracts.map((c) => c.id),
    plans: sample.projects.flatMap((p) => p.plans.map((q) => q.id)),
    fileVersions: sample.contractFileVersions?.length || 0,
  };
  report.fixtureBefore = before;
  await check(
    '新工作区直接采用V8结构，不先创建旧schema再迁移',
    `const store=${app}.store;return {ok:store.state().storageSchemaVersion===2&&Object.keys(localStorage).filter(k=>k.includes('legacy-backup')).length===0,schema:store.state().storageSchemaVersion};`,
  );
  const prepared = await evaluate(
    `const store=${app}.store,id=store.activeWorkspaceId,key=store.activeSnapshotKey;const snapshot=${JSON.stringify(sample)};const raw=JSON.stringify({formatVersion:1,workspaceId:id,snapshot},null,2);localStorage.setItem(key,raw);window.__migrationSource=raw;return {workspaceId:id,key,raw};`,
  );
  report.workspaceId = prepared.workspaceId;
  await call('navigate_page', { type: 'reload' });
  await waitForText(['CSPD']);
  await check(
    '旧样例启动升级保留工作区ID、对象数及旧ID，缺失与来源冲突不虚构',
    `
    const store=${app}.store,s=store.state(),original=${JSON.stringify(sample)};
    const ids={projects:s.projects.map(p=>p.id),contracts:s.contracts.map(c=>c.id),plans:s.projects.flatMap(p=>p.plans.map(q=>q.id)),fileVersions:s.contractFileVersions?.length||0};
    const backup=Object.keys(localStorage).filter(k=>k.includes('legacy-backup'));
    const raw=JSON.parse(localStorage.getItem(store.activeSnapshotKey));
    return {ok:store.activeWorkspaceId===${JSON.stringify(prepared.workspaceId)}&&s.storageSchemaVersion===2&&raw.snapshot.storageSchemaVersion===2&&JSON.stringify(ids)===${JSON.stringify(JSON.stringify(before))}&&JSON.stringify(s.projects)===JSON.stringify(original.projects)&&JSON.stringify(s.financeSnapshots)===JSON.stringify(original.financeSnapshots)&&JSON.stringify(s.history)===JSON.stringify(original.history)&&JSON.stringify(s.attachments)===JSON.stringify(original.attachments)&&s.paymentMethods[0].deliveryInFullPayment===null&&s.paymentMethods[0].deliveryInFullPaymentNeedsReview===true&&backup.length===1&&localStorage.getItem(backup[0])===${JSON.stringify(prepared.raw)},ids,schema:s.storageSchemaVersion,dataVersion:s.dataVersion,backupKeys:backup,reviews:s.migrationReviewItems};`,
  );
  await check(
    '旧schema已有真实原件升级后归属与版本ID不变，原始字节仍可下载',
    `
    const store=${app}.store,v=store.contractFileVersion(${JSON.stringify(sample.contracts[0].id)}),result=await store.readContractOriginal(${JSON.stringify(real.version.id)});
    const bytes=result.ok?await result.blob.text():null;
    return {ok:JSON.stringify(v)===${JSON.stringify(JSON.stringify(real.version))}&&store.state().roundId===${JSON.stringify(real.roundId)}&&bytes==='%PDF-1.7 retained-real-original',version:v,bytes};`,
  );
  await check(
    '重复迁移不创建合同项目文件版本或额外备份，普通操作保持schema2',
    `
    const store=${app}.store,before=JSON.stringify(store.state()),keys=Object.keys(localStorage).length;
    const result=store.migrateWorkspaceToV8(store.state().dataVersion||1);
    const idempotent=before===JSON.stringify(store.state())&&keys===Object.keys(localStorage).length;
    const saved=store.setDateMode('comparison');
    return {ok:result&&idempotent&&saved&&store.state().storageSchemaVersion===2&&JSON.parse(localStorage.getItem(store.activeSnapshotKey)).snapshot.storageSchemaVersion===2,idempotent,saved};`,
  );
  await call('navigate_page', { type: 'reload' });
  await waitForText(['CSPD']);
  await check(
    '刷新保留schema2及比较档，不重复迁移或补造旧签约依据',
    `
    const store=${app}.store,s=store.state();return {ok:s.storageSchemaVersion===2&&s.dateMode==='comparison'&&Object.keys(localStorage).filter(k=>k.includes('legacy-backup')).length===1&&!s.contracts[0].adoptedQuoteSnapshot,schema:s.storageSchemaVersion,mode:store.dateMode()};`,
  );
  await evaluate(`
    const store=${app}.store;for(let n=0;n<100&&(store.originalRecoveryRunning||store.originalRecoveryRequest);n++)await new Promise(r=>setTimeout(r,20));
    const key=store.activeSnapshotKey,id=store.activeWorkspaceId,snapshot=${JSON.stringify(sample)};
    const raw=JSON.stringify({formatVersion:1,workspaceId:id,snapshot});localStorage.setItem(key,raw);
    const original=Storage.prototype.setItem;
    try{Storage.prototype.setItem=function(k,v){if(k===key)throw Error('迁移提交容量不足');return original.call(this,k,v);};store.resumeWorkspace(id);}
    finally{Storage.prototype.setItem=original;}return true;
  `);
  await waitForText(['重试旧数据升级']);
  await check(
    '升级提交失败只展示待重试，发布和持久快照均保留旧schema及业务历史',
    `
    const store=${app}.store,s=store.state(),raw=JSON.parse(localStorage.getItem(store.activeSnapshotKey)).snapshot;
    return {ok:s.storageSchemaVersion===1&&raw.storageSchemaVersion===1&&s.contracts.length===1&&raw.history[0].id==='LEGACY-FINANCE-HISTORY'&&!!document.querySelector('[aria-label="旧数据升级提示"]'),publishedSchema:s.storageSchemaVersion,persistedSchema:raw.storageSchemaVersion,message:store.v8MigrationMessage()};`,
  );
  await clickText('重试旧数据升级');
  await check(
    '实际点击重试成功才发布V8，保留所有原文备份供文件引用保护',
    `
    const store=${app}.store,s=store.state();return {ok:s.storageSchemaVersion===2&&JSON.parse(localStorage.getItem(store.activeSnapshotKey)).snapshot.storageSchemaVersion===2&&!store.v8MigrationMessage()&&s.projects.length===1&&s.contractFileVersions.length===1,schemas:[s.storageSchemaVersion,JSON.parse(localStorage.getItem(store.activeSnapshotKey)).snapshot.storageSchemaVersion],backups:Object.keys(localStorage).filter(k=>k.includes('legacy-backup')).length};`,
  );
  await call('navigate_page', { type: 'reload' });
  await waitForText(['CSPD']);
  await call('take_screenshot', {
    filePath: path.join(output, 'migration-refreshed.png'),
    fullPage: true,
  });
  report.result = '通过';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.serverLog = serverLog.slice(-12000);
  if (connection && Number.isFinite(pageId)) {
    report.console = toolText(await call('list_console_messages', { types: ['error'] })).slice(
      -4000,
    );
    report.network = toolText(await call('list_network_requests')).slice(-4000);
    report.pageText = await evaluate(
      `return (document.querySelector('main')?.innerText||document.body.innerText||'').slice(0,1200);`,
    ).catch((failure) => String(failure));
  }
  console.error(report.error);
  process.exitCode = 1;
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
