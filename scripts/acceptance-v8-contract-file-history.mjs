import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const ORIGINAL_DB = 'cspd-demo-contract-files-v1';
const ORIGINAL_STORE = 'contract-files';
const PDF_MARKER = 'CSPD-07-01-原件字节-A';
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-contract-file-history', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 69, checks: [], result: '失败' };
const pdfBytes = Buffer.from(
  `%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\n` +
    `trailer<</Root 1 0 R>>\n%验收标记 ${PDF_MARKER}\n%%EOF\n`,
  'utf8',
);
const docxBytes = Buffer.from('PK\u0003\u0004验收标记 docx 原件字节 B\n', 'utf8');
const pdfB64 = pdfBytes.toString('base64');
const docxB64 = docxBytes.toString('base64');
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
  const response = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const match = response.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + response);
  return JSON.parse(match[1]);
};
const click = async (label, page = pageId) => {
  const snapshot = toolText(await connection.call('take_snapshot', { pageId: page }));
  const row = snapshot
    .split('\n')
    .find(
      (line) =>
        (line.includes('button ' + JSON.stringify(label)) || line.includes(`button "${label}`)) &&
        !line.includes('disabled'),
    );
  assert(row, '找不到可用按钮：' + label);
  await connection.call('click', { pageId: page, uid: row.match(/uid=(\S+)/)[1] });
};
const app = "ng.getComponent(document.querySelector('app-root'))";
const component = "ng.getComponent(document.querySelector('app-contract-original-file'))";
const store = `${app}.store`;
/** 原件库键顺序由 IndexedDB 排序决定，比对时只关心集合。 */
const sameKeys = (actual, expected) => assert.deepEqual([...actual].sort(), [...expected].sort());
/** 页面内工具：真实字节编解码、原件库直读、按 UI 入口上传。 */
const pageHelpers = `
  window.__b64 = async (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  window.__bytes = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };
  window.__toast = () => {
    const element = document.querySelector('.toast');
    return element ? { text: element.innerText, error: element.classList.contains('error') } : null;
  };
  window.__tick = () => {
    ng.applyChanges(ng.getComponent(document.querySelector('app-root')));
    return true;
  };
  window.__dbKeys = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(${JSON.stringify(ORIGINAL_DB)});
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const keys = db.transaction(${JSON.stringify(ORIGINAL_STORE)}).objectStore(${JSON.stringify(ORIGINAL_STORE)}).getAllKeys();
      keys.onsuccess = () => { const result = keys.result.map(String); db.close(); resolve(result); };
      keys.onerror = () => { db.close(); reject(keys.error); };
    };
  });
  window.__dbRead = (blobId) => new Promise((resolve, reject) => {
    const request = indexedDB.open(${JSON.stringify(ORIGINAL_DB)});
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const row = db.transaction(${JSON.stringify(ORIGINAL_STORE)}).objectStore(${JSON.stringify(ORIGINAL_STORE)}).get(blobId);
      row.onsuccess = () => { const value = row.result || null; db.close(); resolve(value); };
      row.onerror = () => { db.close(); reject(row.error); };
    };
  });
  window.__submit = async (input, file) => {
    const target = ${component};
    const transfer = new DataTransfer();
    if (file) transfer.items.add(file);
    input.files = transfer.files;
    try { target.pick(input); } catch {}
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 200; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!target.uploading()) { window.__tick(); return true; }
    }
    window.__tick();
    return false;
  };
  window.__upload = async (name, type, base64) => {
    const input = document.querySelector('app-contract-original-file input[type=file]');
    if (!input) throw Error('附件区没有可用的文件输入');
    return window.__submit(input, new File([window.__bytes(base64)], name, { type }));
  };
  window.__uploadSized = async (name, type, size) => {
    const input = document.querySelector('app-contract-original-file input[type=file]');
    if (!input) throw Error('附件区没有可用的文件输入');
    return window.__submit(input, new File([new Uint8Array(size)], name, { type }));
  };
  window.__rejectUpload = async (name, type, base64) => {
    await window.__upload(name, type, base64);
    return window.__toast();
  };
  return true;
`;
const injectHelpers = () => evaluate(pageHelpers);
/** 用显式方法代理替换原件库，避免丢失未覆盖的方法；用完必须还原。 */
const patchStore = (extra) => `
  const __originals=${store}.contractOriginals;
  ${store}.contractOriginals={
    stage:(record)=>__originals.stage(record),
    read:(id)=>__originals.read(id),
    promote:(id)=>__originals.promote(id),
    keys:()=>__originals.keys(),
    discard:(id)=>__originals.discard(id),
    ${extra}
  };
`;
const unpatchStore = `${store}.contractOriginals=__originals;`;

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
  const created = toolText(
    await connection.call('new_page', { url: report.baseUrl + '/contracts/placeholder' }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await call('wait_for', { text: ['CSPD'], timeout: 20000 });

  const prepared = await evaluate(`
    const store=${store};
    store.setRole('sales');
    const contractId=store.createContractDraft('DEMO-O003');
    if(!contractId) throw Error('无法创建合同草稿');
    return {contractId,opportunityId:store.contract(contractId).opportunityId};
  `);
  report.contractId = prepared.contractId;
  const contractUrl = `${report.baseUrl}/contracts/${prepared.contractId}`;
  await call('navigate_page', { url: contractUrl });
  await call('wait_for', { text: ['合同真实原件', '无真实原件'], timeout: 20000 });
  await injectHelpers();
  const acceptHint = await evaluate(
    `return document.querySelector('app-contract-original-file input[type=file]').getAttribute('accept');`,
  );
  assert.equal(acceptHint, '.pdf,.doc,.docx,.png,.jpg,.jpeg,.xls,.xlsx');
  await check('合同附件区提供已配置格式的成件入口，当前无真实原件', { accept: acceptHint });

  const uploaded = await evaluate(`
    await window.__upload('销售合同-盖章版.pdf','application/pdf',${JSON.stringify(pdfB64)});
    const store=${store};
    const version=store.contractFileVersion(${JSON.stringify(prepared.contractId)});
    return {
      version,
      versionCount:store.state().contractFileVersions.length,
      badge:document.querySelector('app-contract-original-file .section-heading app-badge')?.innerText?.trim(),
      text:document.querySelector('app-contract-original-file').innerText,
      events:store.state().operationEvents.filter((e)=>e.action==='上传合同真实原件V1').map((e)=>({action:e.action,module:e.module,operator:e.operator,occurredAt:e.occurredAt})),
      toast:window.__toast(),
    };
  `);
  assert.ok(uploaded.version, JSON.stringify(uploaded).slice(0, 600));
  assert.equal(uploaded.version.version, 1);
  assert.equal(uploaded.version.size, pdfBytes.length);
  assert.equal(uploaded.version.isRealOriginal, true);
  assert.equal(uploaded.version.uploadedBy, '张销售');
  assert.ok(Number.isFinite(Date.parse(uploaded.version.uploadedAt)));
  assert.equal(uploaded.versionCount, 1);
  assert.equal(uploaded.badge, '已登记原件');
  assert.match(uploaded.text, /销售合同-盖章版\.pdf/);
  assert.match(uploaded.text, /V1/);
  assert.match(uploaded.text, /上传人 张销售/);
  assert.equal(uploaded.events.length, 1);
  assert.equal(uploaded.events[0].action, '上传合同真实原件V1');
  assert.equal(uploaded.events[0].module, 'contract-workspace');
  const versionId = uploaded.version.id;
  const blobId = uploaded.version.blobId;
  const versionWorkspaceId = uploaded.version.workspaceId;
  await check('首次上传经页面入口登记唯一 V1，显示元数据、上传身份与真实时间', {
    ...uploaded.version,
    events: uploaded.events,
  });

  const replacement = await evaluate(`
    const store=${store};
    const target=${component};
    const beforeContract=JSON.stringify(store.contract(${JSON.stringify(prepared.contractId)}));
    const project=store.state().projects.find(p=>p.contractId===${JSON.stringify(prepared.contractId)});
    const beforeBriefing=project ? JSON.stringify(project.briefing) : null;
    await window.__upload('销售合同-盖章版.pdf','application/pdf',${JSON.stringify(docxB64)});
    const current=store.contractFileVersion(${JSON.stringify(prepared.contractId)});
    const old=await store.readContractOriginal(${JSON.stringify(versionId)});
    const fresh=await store.readContractOriginal(current.id);
    const clean=c=>{const copy={...c};delete copy.currentContractFileVersionId;return JSON.stringify(copy);};
    return {current,history:store.contractFileHistory(${JSON.stringify(prepared.contractId)}),
      oldBytes:old.ok ? await window.__b64(await old.blob.arrayBuffer()) : old.error,
      newBytes:fresh.ok ? await window.__b64(await fresh.blob.arrayBuffer()) : fresh.error,
      businessUnchanged:clean(JSON.parse(beforeContract))===clean(store.contract(${JSON.stringify(prepared.contractId)})),
      briefingUnchanged:!project || beforeBriefing===JSON.stringify(project.briefing),
      text:document.querySelector('app-contract-original-file').innerText};
  `);
  assert.equal(replacement.current.version, 2);
  assert.equal(replacement.current.previousVersionId, versionId);
  assert.equal(replacement.current.fileName, uploaded.version.fileName);
  assert.equal(replacement.oldBytes, pdfB64);
  assert.equal(replacement.newBytes, docxB64);
  assert.deepEqual(
    replacement.history.map((v) => v.version),
    [2, 1],
  );
  assert.equal(replacement.businessUnchanged, true);
  assert.equal(replacement.briefingUnchanged, true);
  assert.match(replacement.text, /下载 V1/);
  await check('同名不同字节只追加 V2，旧版字节与合同业务状态保留，历史倒序', replacement);

  const concurrent = await evaluate(`
    const store=${store};
    const contractId=${JSON.stringify(prepared.contractId)};
    const operationId='ATT02-concurrent';
    const file=new File(['%PDF-1.7 concurrent'],'销售合同-盖章版.pdf',{type:'application/pdf'});
    ${patchStore('stage:async(record)=>{await new Promise(r=>setTimeout(r,120));return __originals.stage(record);},')}
    let results;
    try {results=await Promise.all([store.replaceContractFile(contractId,file,{operationId}),store.replaceContractFile(contractId,file,{operationId})]);}
    finally {${unpatchStore}}
    const after=store.contractFileHistory(contractId);
    const retry=await store.replaceContractFile(contractId,file,{operationId});
    return {results,retry,count:store.contractFileHistory(contractId).length,history:after,
      operationCount:after.filter(v=>v.operationId===operationId).length};
  `);
  assert.deepEqual(concurrent.results, [true, true]);
  assert.equal(concurrent.retry, true);
  assert.equal(concurrent.count, 3);
  assert.equal(concurrent.operationCount, 1);
  await check('同操作并发与提交后重试共用唯一 V3', concurrent);

  const duplicateClick = await evaluate(`
    const store=${store};const target=${component};
    const file=new File(['%PDF-1.7 ui-click'],'点击.pdf',{type:'application/pdf'});
    ${patchStore('stage:async(record)=>{await new Promise(r=>setTimeout(r,100));return __originals.stage(record);},')}
    const before=store.contractFileHistory(${JSON.stringify(prepared.contractId)}).length;
    try { await Promise.all([target.onFileSelected({files:[file],value:''}),target.onFileSelected({files:[file],value:''})]); }
    finally {${unpatchStore}}
    return {before,after:store.contractFileHistory(${JSON.stringify(prepared.contractId)}).length};
  `);
  // The UI operation ID may still name the prior successful replacement; a replay must never append twice.
  assert.ok(duplicateClick.after - duplicateClick.before <= 1);
  await check('页面重复 change 在保存期间不产生重复版本', duplicateClick);

  for (const mode of ['blob', 'snapshot', 'revision', 'rights', 'busy']) {
    const failure = await evaluate(`
      const store=${store};const contractId=${JSON.stringify(prepared.contractId)};
      const before=JSON.stringify(store.state());
      const current=store.contractFileVersion(contractId);
      const keys=await window.__dbKeys();
      const file=new File(['%PDF-1.7 rejected'],'失败替换.pdf',{type:'application/pdf'});
      const mode=${JSON.stringify(mode)};
      const originalState=store.state();
      const origCanEdit=store.canEdit.bind(store);
      const origSetItem=localStorage.setItem.bind(localStorage);
      ${patchStore("stage:async(record)=>{if(mode==='blob')throw Error('注入 Blob 失败');await __originals.stage(record);if(mode==='rights')store.canEdit=()=>false;if(mode==='revision')store.state.set({...store.state(),dataVersion:store.state().dataVersion+1});if(mode==='busy')await new Promise(r=>setTimeout(r,100));},")}
      if(mode==='snapshot')localStorage.setItem=()=>{throw new DOMException('注入快照失败','QuotaExceededError');};
      let result;let busyResult;
      try {
        const pending=store.replaceContractFile(contractId,file,{operationId:'fail-'+mode});
        if(mode==='busy')busyResult=await store.replaceContractFile(contractId,file,{operationId:'another-'+mode});
        result=await pending;
      } finally {store.canEdit=origCanEdit;localStorage.setItem=origSetItem;if(mode==='revision')store.state.set(originalState);${unpatchStore}}
      const latest=store.contractFileVersion(contractId);
      const old=await store.readContractOriginal(current.id);
      return {result,busyResult,currentUnchanged:latest.id===current.id,
        oldReadable:old.ok,keysBefore:keys,keysAfter:await window.__dbKeys(),
        count:store.contractFileHistory(contractId).length};
    `);
    if (mode === 'busy') {
      assert.equal(failure.busyResult, false);
      assert.equal(failure.result, true);
    } else {
      assert.equal(failure.result, false);
      assert.equal(failure.currentUnchanged, true);
      sameKeys(failure.keysAfter, failure.keysBefore);
    }
    assert.equal(failure.oldReadable, true);
    await check(`${mode} 场景原件保留，失败不新增有效版本`, failure);
  }

  const download = await evaluate(`
    const target=${component};
    const original=document.createElement.bind(document);let captured;
    document.createElement=(name,...args)=>{const node=original(name,...args);if(name==='a')node.click=()=>{captured={name:node.download,url:node.href};};return node;};
    try {await target.download(${JSON.stringify(versionId)});}finally{document.createElement=original;}
    return {name:captured.name,bytes:await window.__b64(await (await fetch(captured.url)).arrayBuffer())};
  `);
  assert.equal(download.bytes, pdfB64);
  await check('历史 V1 下载按钮返回原始字节', download);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['原件版本历史（最新在前）', '下载 V1'], timeout: 20000 });
  await injectHelpers();
  const refreshed = await evaluate(
    `const store=${store};const old=await store.readContractOriginal(${JSON.stringify(versionId)});return {versions:store.contractFileHistory(${JSON.stringify(prepared.contractId)}).map(v=>v.version),bytes:old.ok ? await window.__b64(await old.blob.arrayBuffer()):old.error};`,
  );
  assert.equal(refreshed.bytes, pdfB64);
  assert.equal(refreshed.versions.at(-1), 1);
  await check('刷新保留唯一当前版本及旧版下载', refreshed);
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
