import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const out = path.join(root, 'artifacts/v9-b04');
await fs.mkdir(out, { recursive: true });
const c = await connect({ isolated: true });
let pageId;
const checks = [];
const call = (n, a = {}) => c.call(n, { pageId, ...a });
const run = async (body) => {
  const r = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  return JSON.parse(r.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
const panel = "ng.getComponent(document.querySelector('app-solution-input-panel'))";
const upload = async (n) => {
  const file = path.join(out, `isolation-${n}.pptx`);
  await fs.writeFile(file, 'isolation file ' + n);
  const snap = toolText(await call('take_snapshot'));
  const line = snap.split('\n').find((l) => l.includes('button "选择技术方案文件"'));
  await call('upload_file', { uid: line.match(/uid=(\S+)/)[1], filePaths: [file] });
  return run(
    `const p=${panel};await p.upload('proposal');await p.check();return {number:p.current('proposal').number,feedback:p.feedback()};`,
  );
};
try {
  const raw = toolText(
    await c.call('new_page', { url: 'http://127.0.0.1:4324/sales/solutions/DEMO-O008' }),
  );
  pageId = Number(raw.match(/(\d+):.*\[selected\]/)[1]);
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  assert.equal((await upload(1)).number, 1);
  const fixtures = await run(
    `const p=${panel};window.isolationOld=p.current('proposal');const t=p.store.v9CommandTarget();const archive=p.store.workspaceStorage.createAndActivateRound(structuredClone(p.store.state()));p.store.workspaceStorage.activateWorkspace(t.workspaceId);await p.store.contractOriginals.stage({blob:new Blob(['contract original']),blobId:'isolation-contract',contractId:'DEMO-C001',workspaceId:t.workspaceId,roundId:t.roundId,operationId:'isolation-contract',state:'referenced',stagedAt:new Date().toISOString()});for(const [id,w] of [['isolation-foreign','OTHER'],['isolation-unknown','']])await p.files.put(id,{workspaceId:w,roundId:'FOREIGN-R',opportunityId:'OTHER-O',kind:'proposal',operationId:id,versionId:id,digest:'fixture',blob:new Blob([id])});return {archive:archive.workspaceId,target:t};`,
  );
  assert.equal((await upload(2)).number, 2);
  const shared = await run(
    `const p=${panel};return {shared:!!await p.files.get(window.isolationOld.file.blobId),contract:await(await p.store.contractOriginals.read('isolation-contract')).blob.text(),foreign:!!await p.files.get('isolation-foreign'),unknown:!!await p.files.get('isolation-unknown')};`,
  );
  assert.deepEqual(shared, {
    shared: true,
    contract: 'contract original',
    foreign: true,
    unknown: true,
  });
  checks.push({
    name: '真实IndexedDB共享当前引用、合同、跨工作区和未知归属保留',
    ...shared,
    ...fixtures,
  });
  await run(
    `const p=${panel};window.isolationV2=p.current('proposal');window.realRemove=p.files.removeOwned;p.files.removeOwned=async()=>{throw Error('temporary cleanup failure')};return true;`,
  );
  const failed = await upload(3);
  assert.equal(failed.number, 3);
  assert.match(failed.feedback, /已保存.*释放失败/);
  checks.push({ name: '真实替换已提交，回收边界失败不改成功结果', ...failed });
  await run(`const p=${panel};p.files.removeOwned=window.realRemove;return true;`);
  const recovery = await run(
    `const p=${panel};const before=JSON.stringify(p.store.state());const t=p.store.v9CommandTarget();const r=await p.recoverReplacedFiles({...t,operationId:'RECOVER'});return {removed:r.removed.length,recoveryNeeded:r.recoveryNeeded,unchanged:JSON.stringify(p.store.state())===before,number:p.current('proposal').number,oldShared:!!await p.files.get(window.isolationOld.file.blobId),v2:!!await p.files.get(window.isolationV2.file.blobId),contract:await(await p.store.contractOriginals.read('isolation-contract')).blob.text(),foreign:!!await p.files.get('isolation-foreign'),unknown:!!await p.files.get('isolation-unknown')};`,
  );
  assert.deepEqual(recovery, {
    removed: 1,
    recoveryNeeded: false,
    unchanged: true,
    number: 3,
    oldShared: true,
    v2: false,
    contract: 'contract original',
    foreign: true,
    unknown: true,
  });
  checks.push({ name: '实际定向恢复释放不新增版本与历史，仍保护所有隔离范围', ...recovery });
  const retry = await run(
    `const p=${panel};return p.recoverReplacedFiles({...p.store.v9CommandTarget(),operationId:'RECOVER-2'});`,
  );
  assert.equal(retry.removed.length, 0);
  checks.push({ name: '重复恢复幂等', removed: retry.removed.length });
  const unavailable = await run(
    `const p=${panel};const get=p.files.get;p.files.get=async()=>{throw Error('read unavailable')};try{await p.check();return p.availability()[p.current('proposal').id];}finally{p.files.get=get;}`,
  );
  assert.equal(unavailable, 'unavailable');
  checks.push({ name: '当前读取异常保持暂不可读', availability: unavailable });
  const missing = await run(
    `const p=${panel};const v=p.current('proposal');window.oldUploadedAt=v.uploadedAt;const {blob,...row}=await p.files.get(v.file.blobId);await p.files.removeOwned(v.file.blobId,row);await p.check();return {availability:p.availability()[v.id],timestamp:p.current('proposal').uploadedAt,number:p.current('proposal').number};`,
  );
  assert.equal(missing.availability, 'missing');
  assert.equal(missing.number, 3);
  checks.push({ name: '受控删除当前Blob后核验缺件，原上传时间及版本保留', ...missing });
  assert.equal((await upload(4)).number, 4);
  const restored = await run(
    `const p=${panel};return {availability:p.availability()[p.current('proposal').id],priorTimestamp:p.history('proposal').find(v=>v.number===3).uploadedAt,original:window.oldUploadedAt};`,
  );
  assert.equal(restored.availability, 'present');
  assert.equal(restored.priorTimestamp, restored.original);
  checks.push({ name: '缺件重传是新版，旧时间不回填', ...restored });
  await fs.writeFile(
    path.join(root, '../docs/verification/v9-b04/file-isolation-report.json'),
    JSON.stringify({ passed: checks.length, checks }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length }));
} catch (e) {
  console.error(e);
  await fs.writeFile(
    path.join(out, 'isolation-failure.json'),
    JSON.stringify({ error: e.message, checks }, null, 2),
  );
  process.exitCode = 1;
} finally {
  await c.client.close();
  await c.transport.close();
}
