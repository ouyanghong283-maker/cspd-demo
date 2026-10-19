import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-contract-file-recovery', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 70, checks: [], result: '失败' };
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
  const settled = () =>
    evaluate(
      `for(let n=0;n<100;n++){if(!${store}.originalRecoveryRunning&&!${store}.originalRecoveryRequest)return true;await new Promise(r=>setTimeout(r,30));}throw Error('恢复未结束');`,
    );
  await settled();
  const contractId = await evaluate(`return ${store}.createContractDraft('DEMO-O003');`);
  assert(contractId);
  await call('navigate_page', { url: report.baseUrl + '/contracts/' + contractId });
  await call('wait_for', { text: ['合同真实原件'], timeout: 15000 });
  await settled();
  const staged = await evaluate(
    `const s=${store};const original=s.contractOriginals;const before=await original.keys();s.contractOriginals={stage:async record=>{await original.stage(record);window.__staged=record.blobId;await new Promise(()=>{});},read:id=>original.read(id),keys:()=>original.keys(),discard:(id,guard)=>original.discard(id,guard),promote:id=>original.promote(id)};void s.replaceContractFile(${JSON.stringify(contractId)},new File(['%PDF-1.7 crash-before-snapshot'],'crash-before.pdf',{type:'application/pdf'}));for(let n=0;n<100&&!window.__staged;n++)await new Promise(r=>setTimeout(r,20));return {blobId:window.__staged,before,versions:(s.state().contractFileVersions||[]).length};`,
  );
  assert(staged.blobId);
  assert.equal(staged.versions, 0);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['合同真实原件'], timeout: 15000 });
  await settled();
  const beforeCommitRecovery = await evaluate(
    `return {keys:await ${store}.contractOriginals.keys(),versions:(${store}.state().contractFileVersions||[]).length,current:${store}.contract(${JSON.stringify(contractId)}).currentContractFileVersionId||null};`,
  );
  assert(!beforeCommitRecovery.keys.includes(staged.blobId));
  assert.equal(beforeCommitRecovery.versions, 0);
  assert.equal(beforeCommitRecovery.current, null);
  await check('ATT05 Blob写入后中断：刷新不登记虚假版本，明确归属孤立暂存已回收', {
    input: staged,
    operation: '暂存事务完成后挂起上传，重新加载页面',
    expected: '零版本、孤立Blob删除',
    actual: beforeCommitRecovery,
  });
  const committed = await evaluate(
    `const s=${store};const original=s.contractOriginals;s.contractOriginals={stage:r=>original.stage(r),read:id=>original.read(id),keys:()=>original.keys(),discard:(id,g)=>original.discard(id,g),promote:async id=>{window.__committed=id;await new Promise(()=>{});}};void s.replaceContractFile(${JSON.stringify(contractId)},new File(['%PDF-1.7 committed-bytes'],'committed.pdf',{type:'application/pdf'}));for(let n=0;n<100&&!window.__committed;n++)await new Promise(r=>setTimeout(r,20));return {blobId:window.__committed,version:s.contractFileVersion(${JSON.stringify(contractId)})};`,
  );
  assert(committed.blobId);
  assert.equal(committed.version.version, 1);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['committed.pdf'], timeout: 15000 });
  await settled();
  const committedRecovery = await evaluate(
    `const s=${store};const r=await s.contractOriginals.read(${JSON.stringify(committed.blobId)});const download=await s.readContractOriginal(${JSON.stringify(committed.version.id)});return {state:r.state,bytes:await r.blob.text(),download:download.ok,versions:(s.state().contractFileVersions||[]).length};`,
  );
  assert.equal(committedRecovery.state, 'referenced');
  assert.equal(committedRecovery.bytes, '%PDF-1.7 committed-bytes');
  assert.equal(committedRecovery.download, true);
  assert.equal(committedRecovery.versions, 1);
  await check('ATT05 快照提交后中断：启动恢复已引用暂存，版本唯一且字节可下载', {
    input: committed,
    operation: '快照成功后挂起promote并刷新',
    expected: '已引用暂存转正、字节不变',
    actual: committedRecovery,
  });
  const references = await evaluate(
    `const s=${store};const template=await s.contractOriginals.read(${JSON.stringify(committed.blobId)});for(const [id,extra]of [['backup-only',{}],['other-workspace',{workspaceId:'OTHER'}],['unknown-owner',{roundId:''}],['orphan-reset',{}]])await s.contractOriginals.stage({...template,...extra,blobId:id,operationId:id,state:'staged'});localStorage.setItem('cspd-demo:v7:legacy-backup:joint70',JSON.stringify({history:[{blobId:'backup-only'}]}));s.setDateMode('comparison');return {workspace:s.activeWorkspaceId,round:s.state().roundId,keys:await s.contractOriginals.keys()};`,
  );
  const failedReset = await evaluate(
    `const s=${store};const before=JSON.stringify(s.state());const keys=await s.contractOriginals.keys();const original=Storage.prototype.setItem;let result;try{Storage.prototype.setItem=()=>{throw new DOMException('recovery reset quota','QuotaExceededError')};result=await s.reset();}finally{Storage.prototype.setItem=original;}return {result,unchanged:before===JSON.stringify(s.state()),keysBefore:keys,keysAfter:await s.contractOriginals.keys(),mode:s.dateMode()};`,
  );
  assert.equal(failedReset.result, false);
  assert.equal(failedReset.unchanged, true);
  assert.deepEqual(failedReset.keysAfter, failedReset.keysBefore);
  assert.equal(failedReset.mode, 'comparison');
  await check('ATT06/MIG04 重置快照失败保留旧轮、模式、全部原件', {
    input: references,
    operation: '快照写入注入容量失败后重置',
    expected: '失败不改状态不删文件',
    actual: failedReset,
  });
  const success = await evaluate(
    `const s=${store};const result=await s.reset();return {result,round:s.state().roundId,mode:s.dateMode(),keys:await s.contractOriginals.keys(),message:s.originalRecoveryMessage()};`,
  );
  assert.equal(success.result, true);
  assert.equal(success.mode, 'normal');
  assert.notEqual(success.round, references.round);
  assert(!success.keys.includes('orphan-reset'));
  for (const id of [committed.blobId, 'backup-only', 'other-workspace', 'unknown-owner'])
    assert(success.keys.includes(id), id);
  await check('ATT06/MIG04 成功重置只回收旧轮孤立对象，旧工作区/原文备份/未知归属保留', {
    input: references,
    operation: '恢复存储后重置',
    expected: 'normal新轮、引用文件保留、明确孤立回收',
    actual: success,
  });
  const cleanupFailure = await evaluate(
    `const s=${store};const original=s.contractOriginals;await original.stage({blob:new Blob(['orphan']),blobId:'cleanup-failed',contractId:'CLEANUP',workspaceId:s.activeWorkspaceId,roundId:s.state().roundId,operationId:'cleanup-failed',state:'staged',stagedAt:new Date().toISOString()});const previous=s.state().roundId;s.contractOriginals={stage:r=>original.stage(r),read:id=>original.read(id),keys:()=>original.keys(),promote:id=>original.promote(id),discard:async()=>{throw Error('cleanup failure')}};let result;try{result=await s.reset();}finally{s.contractOriginals=original;}return {result,previous,round:s.state().roundId,mode:s.dateMode(),pending:s.pendingOriginalCleanups(),message:s.originalRecoveryMessage(),keys:await original.keys()};`,
  );
  assert.equal(cleanupFailure.result, true);
  assert.notEqual(cleanupFailure.round, cleanupFailure.previous);
  assert.equal(cleanupFailure.mode, 'normal');
  assert(cleanupFailure.pending.some((x) => x.blobId === 'cleanup-failed'));
  assert(cleanupFailure.keys.includes('cleanup-failed'));
  assert.match(cleanupFailure.message, /未完成/);
  await check('MIG04 清理失败不回滚已提交新轮，文件及待处理信息保留', {
    input: '当前轮明确归属孤立Blob，discard失败',
    operation: '重置成功后注入清理失败',
    expected: '新轮成功、待处理可见',
    actual: cleanupFailure,
  });

  await evaluate(
    `localStorage.setItem('cspd-demo-v2-corrupt-backup-browser70','{broken');const s=${store};const id=s.createContractDraft('DEMO-O003');if(!id)throw Error('无法创建重试UI合同');await ${app}.router.navigateByUrl('/contracts/'+id);await s.recoverContractFiles();return true;`,
  );
  await settled();
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['合同真实原件'], timeout: 15000 });
  await settled();
  await call('wait_for', { text: ['重试原件恢复', '无法完整核实'], timeout: 15000 });
  const blockedUi = await evaluate(
    `return document.querySelector('app-contract-original-file').innerText;`,
  );
  assert.match(blockedUi, /文件均保留/);
  await evaluate(`localStorage.removeItem('cspd-demo-v2-corrupt-backup-browser70');return true;`);
  await click('重试原件恢复');
  await settled();
  const retryUi = await evaluate(
    `return {message:${store}.originalRecoveryMessage(),pending:${store}.pendingOriginalCleanups(),keys:await ${store}.contractOriginals.keys(),text:document.querySelector('app-contract-original-file').innerText};`,
  );
  assert.equal(retryUi.message, '');
  assert.equal(retryUi.pending.length, 0);
  assert(!retryUi.keys.includes('cleanup-failed'));
  await check('ATT06/MIG04 附件区展示恢复阻断，真实点击重试安全处理旧轮待清理文件', {
    operation: '损坏备份阻断后恢复备份并点击附件区重试按钮',
    expected: '阻断原因可见、旧轮待处理可重试且引用文件保留',
    actual: retryUi,
  });

  await evaluate(
    `const s=${store};await s.contractOriginals.stage({blob:new Blob(['foreign']),blobId:'foreign-global-pending',contractId:'FOREIGN',workspaceId:'W-FOREIGN',roundId:'R-FOREIGN',operationId:'foreign',state:'referenced',stagedAt:new Date().toISOString()});localStorage.setItem('cspd-demo-v2:contract-originals-pending-cleanup',JSON.stringify([{blobId:'foreign-global-pending',contractId:'FOREIGN',markedAt:'legacy'}]));return true;`,
  );
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['合同真实原件'], timeout: 15000 });
  await settled();
  const foreignPending = await evaluate(
    `return {keys:await ${store}.contractOriginals.keys(),pending:${store}.pendingOriginalCleanups(),message:${store}.originalRecoveryMessage()};`,
  );
  assert(foreignPending.keys.includes('foreign-global-pending'));
  assert(foreignPending.pending.some((p) => p.blobId === 'foreign-global-pending'));
  assert.match(foreignPending.message, /缺少本轮重置授权/);
  await check('ATT06/MIG04 重开后的无授权foreign pending不赋予跨工作区删除权', {
    operation: '持久全局pending包含其他工作区已转正孤立Blob，刷新自动恢复',
    expected: '文件与待核pending保留',
    actual: foreignPending,
  });
  const missing = await evaluate(
    `const s=${store};const old=s.archivedWorkspaces().find(w=>w.roundId===${JSON.stringify(references.round)});if(s.state().roundId!==${JSON.stringify(references.round)}){if(!old)throw Error('旧工作区未保留');s.resumeWorkspace(old.id);}for(let n=0;n<100&&s.originalRecoveryRunning;n++)await new Promise(r=>setTimeout(r,20));await s.contractOriginals.discard(${JSON.stringify(committed.blobId)});return s.readContractOriginal(${JSON.stringify(committed.version.id)});`,
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error, /原件字节缺失/);
  await check('ATT06 保留旧轮可续接，原件缺失明确失败不假下载', {
    operation: '续接旧工作区，模拟外部删除字节后读取',
    expected: '明确缺失错误',
    actual: missing,
  });
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
