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
const output = path.join(root, 'artifacts', 'v8-contract-original-file', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 68, checks: [], result: '失败' };
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

  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['销售合同-盖章版.pdf', '已登记原件'], timeout: 20000 });
  await injectHelpers();
  const afterReload = await evaluate(`
    const store=${store};
    const version=store.contractFileVersion(${JSON.stringify(prepared.contractId)});
    const result=await store.readContractOriginal(version.id);
    const direct=await window.__dbRead(version.blobId);
    return {
      versionId:version.id,
      currentId:store.contract(${JSON.stringify(prepared.contractId)}).currentContractFileVersionId,
      viaStore:result.ok ? await window.__b64(await result.blob.arrayBuffer()) : result.error,
      viaIndexedDb:direct?.blob ? await window.__b64(await direct.blob.arrayBuffer()) : null,
      storedSize:direct?.blob?.size ?? null,
      storedRecord:direct ? {contractId:direct.contractId,blobId:direct.blobId,state:direct.state,
        operationId:direct.operationId,workspaceId:direct.workspaceId,roundId:direct.roundId,
        type:direct.blob.type} : null,
      dbKeys:await window.__dbKeys(),
      text:document.querySelector('app-contract-original-file').innerText,
    };
  `);
  assert.equal(afterReload.versionId, versionId);
  assert.equal(afterReload.currentId, versionId);
  assert.equal(afterReload.viaStore, pdfB64);
  assert.equal(afterReload.viaIndexedDb, pdfB64);
  assert.equal(afterReload.storedSize, pdfBytes.length);
  assert.equal(afterReload.storedRecord.contractId, prepared.contractId);
  assert.equal(afterReload.storedRecord.blobId, blobId);
  assert.equal(afterReload.storedRecord.state, 'referenced');
  assert.equal(afterReload.storedRecord.type, 'application/pdf');
  assert.equal(afterReload.storedRecord.workspaceId, versionWorkspaceId);
  assert.ok(afterReload.storedRecord.operationId);
  sameKeys(afterReload.dbKeys, [blobId]);
  assert.match(afterReload.text, /上传时间/);
  await check('刷新重入后仍是同一 V1，专用原件库字节与上传字节逐字节一致', {
    versionId,
    blobId,
    bytes: afterReload.storedSize,
    dbKeys: afterReload.dbKeys,
  });

  const downloaded = await evaluate(`
    const store=${store};
    const version=store.contractFileVersion(${JSON.stringify(prepared.contractId)});
    window.__downloads=[];
    const originalClick=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){window.__downloads.push({download:this.download,href:this.href});};
    await ${component}.download(version.id);
    window.__tick();
    const record=window.__downloads[0];
    const bytes=record ? await window.__b64(await (await fetch(record.href)).arrayBuffer()) : null;
    HTMLAnchorElement.prototype.click=originalClick;
    return {record,bytes,toast:window.__toast()};
  `);
  assert.equal(downloaded.record?.download, '销售合同-盖章版.pdf');
  assert.equal(downloaded.bytes, pdfB64);
  assert.match(downloaded.toast.text, /已下载原件/);
  await check('下载原件走页内 blob URL，下载字节与原件一致', {
    download: downloaded.record.download,
    bytes: pdfBytes.length,
  });

  const previewed = await evaluate(`
    const store=${store};
    const version=store.contractFileVersion(${JSON.stringify(prepared.contractId)});
    const target=${component};
    window.__revoked=0;
    const originalRevoke=URL.revokeObjectURL;
    URL.revokeObjectURL=(url)=>{window.__revoked+=1;return originalRevoke.call(URL,url);};
    await target.preview(version.id);
    window.__tick();
    const frame=document.querySelector('app-contract-original-file .preview-box iframe');
    const head=frame?.src?.startsWith('blob:')
      ? await window.__b64((await (await fetch(frame.src)).arrayBuffer()).slice(0,8)) : null;
    const contentType=frame?.src?.startsWith('blob:')
      ? (await fetch(frame.src)).headers.get('content-type') : null;
    const opened={
      frames:document.querySelectorAll('app-contract-original-file .preview-box iframe').length,
      images:document.querySelectorAll('app-contract-original-file .preview-box img').length,
      revoked:window.__revoked,
      scripts:document.querySelectorAll('app-contract-original-file .preview-box script').length,
    };
    target.closePreview();
    window.__tick();
    await new Promise((resolve)=>setTimeout(resolve,50));
    const closed={boxes:document.querySelectorAll('app-contract-original-file .preview-box').length,revoked:window.__revoked};
    URL.revokeObjectURL=originalRevoke;
    return {head,contentType,opened,closed,title:frame?.getAttribute('title') ?? ''};
  `);
  assert.equal(Buffer.from(previewed.head, 'base64').toString('utf8'), '%PDF-1.7');
  assert.equal(previewed.contentType, 'application/pdf');
  assert.deepEqual(previewed.opened, { frames: 1, images: 0, revoked: 0, scripts: 0 });
  assert.deepEqual(previewed.closed, { boxes: 0, revoked: 1 });
  await check('PDF 只在页内 iframe 受限预览，关闭预览即释放临时 URL', previewed);

  const boundaryContract = await evaluate(`
    const store=${store};
    for(const opportunityId of ['DEMO-O005','DEMO-O006','DEMO-O008','DEMO-O001']) {
      const id=store.createContractDraft(opportunityId);
      if(id && id!==${JSON.stringify(prepared.contractId)} && !store.contract(id).currentContractFileVersionId)
        return {contractId:id,opportunityId};
    }
    throw Error('没有可用于边界验收的第二张合同');
  `);
  await call('navigate_page', {
    url: `${report.baseUrl}/contracts/${boundaryContract.contractId}`,
  });
  await call('wait_for', { text: ['合同真实原件', '无真实原件'], timeout: 20000 });
  await injectHelpers();
  const boundaries = await evaluate(`
    await window.__upload('说明.html','text/html',btoa('<html><body>alert(1)</body></html>'));
    const html=window.__toast();
    await window.__upload('图.svg','image/svg+xml',btoa('<svg onload="alert(1)"></svg>'));
    const svg=window.__toast();
    await window.__upload('空文件.pdf','application/pdf','');
    const empty=window.__toast();
    await window.__uploadSized('超大合同.pdf','application/pdf',20*1024*1024+1);
    const oversized=window.__toast();
    const store=${store};
    return {html,svg,empty,oversized,state:JSON.stringify(store.state()),
      count:store.state().contractFileVersions.length,dbKeys:await window.__dbKeys(),
      boundaryOriginal:store.contract(${JSON.stringify(boundaryContract.contractId)}).currentContractFileVersionId ?? null,
      badge:document.querySelector('app-contract-original-file .section-heading app-badge')?.innerText?.trim()};
  `);
  assert.equal(boundaries.html.error, true);
  assert.match(boundaries.html.text, /仅接受已配置的/);
  assert.match(boundaries.svg.text, /仅接受已配置的/);
  assert.match(boundaries.empty.text, /文件为空/);
  assert.match(boundaries.oversized.text, /20MiB/);
  assert.equal(boundaries.count, 1);
  assert.equal(boundaries.boundaryOriginal, null);
  assert.equal(boundaries.badge, '无真实原件');
  sameKeys(boundaries.dbKeys, [blobId]);
  const stateBefore = boundaries.state;
  await check('拒绝 HTML/SVG、空文件与超限文件，且不产生任何记录', boundaries);

  const cancelled = await evaluate(`
    const store=${store};
    const target=${component};
    store.ui.toast.set(null);
    const input=document.querySelector('app-contract-original-file input[type=file]');
    const before=JSON.stringify(store.state());
    await window.__submit(input,null);
    return {unchanged:before===JSON.stringify(store.state()),toast:window.__toast(),
      count:store.state().contractFileVersions.length,
      events:store.state().operationEvents.filter((e)=>e.action==='上传合同真实原件V1').length,
      uploading:target.uploading(),dbKeys:await window.__dbKeys()};
  `);
  assert.equal(cancelled.unchanged, true);
  assert.equal(cancelled.toast, null);
  assert.equal(cancelled.count, 1);
  assert.equal(cancelled.events, 1);
  assert.equal(cancelled.uploading, false);
  sameKeys(cancelled.dbKeys, [blobId]);
  assert.equal(JSON.stringify(await evaluate(`return ${store}.state();`)), stateBefore);
  await check('取消选择不产生记录、不提示、不写原件库', cancelled);

  const stageFailure = await evaluate(`
    const store=${store};
    ${patchStore("stage:async()=>{throw new Error('原件暂存失败，未登记为有效版本');},")}
    const before=JSON.stringify(store.state());
    const keysBefore=await window.__dbKeys();
    await window.__upload('暂存失败.pdf','application/pdf',${JSON.stringify(pdfB64)});
    const toast=window.__toast();
    const result={toast,unchanged:before===JSON.stringify(store.state()),
      count:store.state().contractFileVersions.length,
      events:store.state().operationEvents.filter((e)=>e.action==='上传合同真实原件V1').length,
      keysBefore,keysAfter:await window.__dbKeys()};
    ${unpatchStore}
    return result;
  `);
  assert.equal(stageFailure.toast.error, true);
  assert.match(stageFailure.toast.text, /暂存失败/);
  assert.equal(stageFailure.unchanged, true);
  assert.equal(stageFailure.count, 1);
  assert.equal(stageFailure.events, 1);
  sameKeys(stageFailure.keysAfter, stageFailure.keysBefore);
  await check('Blob 暂存失败不登记版本、不更新历史，原件库零残留', stageFailure);

  const snapshotFailure = await evaluate(`
    const store=${store};
    const before=JSON.stringify(store.state());
    const keysBefore=await window.__dbKeys();
    const originalSetItem=localStorage.setItem.bind(localStorage);
    localStorage.setItem=()=>{throw new DOMException('验收容量失败','QuotaExceededError');};
    try { await window.__upload('快照失败.pdf','application/pdf',${JSON.stringify(pdfB64)}); }
    finally { localStorage.setItem=originalSetItem; }
    await new Promise((resolve)=>setTimeout(resolve,100));
    return {toast:window.__toast(),unchanged:before===JSON.stringify(store.state()),
      count:store.state().contractFileVersions.length,
      events:store.state().operationEvents.filter((e)=>e.action==='上传合同真实原件V1').length,
      keysBefore,keysAfter:await window.__dbKeys(),pending:store.pendingOriginalCleanups().length};
  `);
  assert.equal(snapshotFailure.toast.error, true);
  assert.match(snapshotFailure.toast.text, /容量失败/);
  assert.equal(snapshotFailure.unchanged, true);
  assert.equal(snapshotFailure.count, 1);
  assert.equal(snapshotFailure.events, 1);
  sameKeys(snapshotFailure.keysAfter, snapshotFailure.keysBefore);
  assert.equal(snapshotFailure.pending, 0);
  await check('快照提交失败不登记有效版本，本次无引用暂存被清理', snapshotFailure);

  const cleanupFailure = await evaluate(`
    const store=${store};
    ${patchStore("discard:async()=>{throw new Error('暂存原件清理失败');},")}
    const before=JSON.stringify(store.state());
    const originalSetItem=localStorage.setItem.bind(localStorage);
    localStorage.setItem=()=>{throw new DOMException('验收容量失败','QuotaExceededError');};
    try { await window.__upload('清理失败.pdf','application/pdf',${JSON.stringify(pdfB64)}); }
    finally { localStorage.setItem=originalSetItem; }
    await new Promise((resolve)=>setTimeout(resolve,150));
    const result={unchanged:before===JSON.stringify(${store}.state()),count:${store}.state().contractFileVersions.length,
      pending:${store}.pendingOriginalCleanups(),keys:await window.__dbKeys(),
      text:document.querySelector('app-contract-original-file').innerText};
    ${unpatchStore}
    return result;
  `);
  assert.equal(cleanupFailure.unchanged, true);
  assert.equal(cleanupFailure.count, 1);
  assert.equal(cleanupFailure.pending.length, 1);
  assert.equal(cleanupFailure.pending[0].contractId, boundaryContract.contractId);
  assert.match(cleanupFailure.text, /待处理/);
  sameKeys(cleanupFailure.keys, [blobId, cleanupFailure.pending[0].blobId]);
  await check('清理失败只标记待处理并保留无引用暂存，已登记原件不受影响', cleanupFailure);

  const second = toolText(await connection.call('new_page', { url: contractUrl }));
  const secondPage = Number(second.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(secondPage), second);
  await connection.call('wait_for', { pageId: secondPage, text: ['合同真实原件'], timeout: 20000 });
  await click('接管修改权', secondPage);
  await connection.call('wait_for', { pageId: secondPage, text: ['当前页可修改'], timeout: 20000 });
  await call('wait_for', { text: ['只读查看'], timeout: 20000 });
  const lostRights = await evaluate(`
    const store=${store};
    const target=${component};
    const before=JSON.stringify(store.state());
    const disabled=document.querySelector('app-contract-original-file button.btn')?.disabled ?? null;
    const text=document.querySelector('app-contract-original-file').innerText;
    const file=new File([window.__bytes(${JSON.stringify(pdfB64)})],'无权上传.pdf',{type:'application/pdf'});
    const notices=[];
    const originalNotify=store.ui.notify.bind(store.ui);
    store.ui.notify=(message,error=false)=>{notices.push({text:message,error:!!error});return originalNotify(message,error);};
    try {
      await target.onFileSelected({files:[file],value:''});
      var viaStore=await store.replaceContractFile(${JSON.stringify(boundaryContract.contractId)},file,{});
    } finally { store.ui.notify=originalNotify; }
    window.__tick();
    return {disabled,text,viaStore,notices,
      unchanged:before===JSON.stringify(store.state()),count:store.state().contractFileVersions.length,
      currentId:store.contract(${JSON.stringify(prepared.contractId)}).currentContractFileVersionId,
      boundaryOriginal:store.contract(${JSON.stringify(boundaryContract.contractId)}).currentContractFileVersionId ?? null,
      keys:await window.__dbKeys()};
  `);
  assert.equal(lostRights.disabled, true);
  assert.match(lostRights.text, /只读查看/);
  assert.equal(lostRights.viaStore, false);
  assert.equal(lostRights.notices.length, 2);
  assert.match(lostRights.notices[0].text, /没有修改权/);
  assert.equal(lostRights.notices[0].error, true);
  assert.match(lostRights.notices[1].text, /没有修改权/);
  assert.equal(lostRights.unchanged, true);
  assert.equal(lostRights.count, 1);
  assert.equal(lostRights.currentId, versionId);
  assert.equal(lostRights.boundaryOriginal, null);
  // Opening the second tab retries this workspace's explicit pending cleanup;
  // only the previously committed original should remain afterward.
  sameKeys(lostRights.keys, [blobId]);
  await click('接管修改权');
  await call('wait_for', { text: ['当前页可修改'], timeout: 20000 });
  await connection.call('close_page', { pageId: secondPage }).catch(() => {});
  await check('失去修改资格后上传被拒且零写入，接管恢复后已有原件不变', {
    toast: lostRights.notices[0].text,
    disabled: lostRights.disabled,
    storeResult: lostRights.viaStore,
    keys: lostRights.keys.length,
  });

  const spoofed = await evaluate(`
    await window.__upload('冒名合同.pdf','text/html',btoa('<html><body>alert(1)</body></html>'));
    const store=${store};
    const target=${component};
    const version=store.contractFileVersion(${JSON.stringify(boundaryContract.contractId)});
    const record=version ? await window.__dbRead(version.blobId) : null;
    const result=version ? await store.readContractOriginal(version.id) : null;
    let contentType=null;
    if(version){
      await target.preview(version.id);
      window.__tick();
      const frame=document.querySelector('app-contract-original-file .preview-box iframe');
      if(frame?.src?.startsWith('blob:')) contentType=(await fetch(frame.src)).headers.get('content-type');
      target.closePreview();
      window.__tick();
    }
    return {mimeType:version?.mimeType ?? null,recordType:record?.blob?.type ?? null,state:record?.state ?? null,
      readType:result?.ok ? result.blob.type : null,
      bytes:result?.ok ? await window.__b64(await result.blob.arrayBuffer()) : null,
      contentType,kind:version ? target.previewable(version.mimeType) ? 'pdf' : 'download' : null};
  `);
  assert.equal(spoofed.mimeType, 'application/pdf');
  assert.equal(spoofed.recordType, 'application/pdf');
  assert.equal(spoofed.state, 'referenced');
  assert.equal(spoofed.readType, 'application/pdf');
  assert.equal(spoofed.contentType, 'application/pdf');
  assert.equal(spoofed.kind, 'pdf');
  const spoofBlobId = await evaluate(
    `return ${store}.contractFileVersion(${JSON.stringify(boundaryContract.contractId)}).blobId;`,
  );
  await check('声明为 HTML 的 .pdf 按已配置规则归一，落库与预览都不带 HTML 类型', {
    mimeType: spoofed.mimeType,
    recordType: spoofed.recordType,
    contentType: spoofed.contentType,
    bytes: spoofed.bytes.length,
  });

  const legacy = await evaluate(`
    const store=${store};
    store.simulateDocument(${JSON.stringify(prepared.opportunityId)},'合同扫描件','演示_合同扫描件.pdf');
    window.__tick();
    return store.contractLegacyAttachments(${JSON.stringify(prepared.contractId)})
      .map((x)=>({id:x.id,kind:x.kind,name:x.name,mode:x.mode ?? null}));
  `);
  assert.equal(legacy.length, 2);
  assert.deepEqual(legacy.map((x) => x.kind).sort(), ['合同扫描件', '需求导入表']);
  assert.equal(legacy.find((x) => x.kind === '合同扫描件').mode, 'simulated');
  await call('navigate_page', { url: contractUrl });
  await call('wait_for', { text: ['旧模拟附件记录', '演示_合同扫描件.pdf'], timeout: 20000 });
  await injectHelpers();
  const legacyView = await evaluate(`
    const store=${store};
    const text=document.querySelector('app-contract-original-file').innerText;
    const row=store.contractLegacyAttachments(${JSON.stringify(prepared.contractId)}).find((x)=>x.kind==='合同扫描件');
    await store.openFile(row);
    window.__tick();
    await new Promise((resolve)=>setTimeout(resolve,150));
    const dialogText=document.querySelector('[role=dialog]')?.innerText ?? '';
    store.ui.dialog.set(null);
    return {text,dialogText,
      dialogMentions:['仅模拟文件记录','不提供原件预览或下载'].filter((phrase)=>dialogText.includes(phrase)),
      finePrint:document.querySelector('app-contract-original-file .fine-print').innerText,
      realOriginal:store.contract(${JSON.stringify(prepared.contractId)}).currentContractFileVersionId===${JSON.stringify(versionId)},
      legacyBlocks:(text.match(/无原件/g) ?? []).length,
    };
  `);
  assert.deepEqual(legacyView.dialogMentions, ['仅模拟文件记录', '不提供原件预览或下载']);
  assert.match(legacyView.finePrint, /不包含原件字节/);
  assert.match(legacyView.finePrint, /20MiB/);
  assert.match(legacyView.finePrint, /绝不渲染 HTML\/SVG/);
  assert.equal(legacyView.realOriginal, true);
  assert.equal(legacyView.legacyBlocks, 2);
  await check('旧模拟记录保持无原件标识，详情明确不提供原件预览或下载', {
    dialogMentions: legacyView.dialogMentions,
    legacyRecords: legacy.map((x) => `${x.kind}/${x.mode}`),
  });

  const exported = await evaluate(`
    const store=${store};
    const json=JSON.stringify(store.state());
    const version=store.contractFileVersion(${JSON.stringify(prepared.contractId)});
    return {containsBytes:json.includes(${JSON.stringify(PDF_MARKER)}),
      contentKeys:['content','data','bytes','base64','blobData'].filter((key)=>key in version),
      keys:Object.keys(version).sort(),backupNote:document.querySelector('app-contract-original-file').innerText.includes('备份均不包含原件内容')};
  `);
  assert.equal(exported.containsBytes, false);
  assert.deepEqual(exported.contentKeys, []);
  assert.ok(exported.keys.includes('blobId'));
  assert.equal(exported.backupNote, true);
  await check('业务 JSON 快照只含原件引用与元数据，附件区说明备份不含原件', exported);

  const office = await evaluate(`
    const store=${store};
    for(const opportunityId of ['DEMO-O005','DEMO-O006','DEMO-O008','DEMO-O001']) {
      const id=store.createContractDraft(opportunityId);
      if(id && !store.contract(id).currentContractFileVersionId) return {contractId:id,opportunityId};
    }
    throw Error('没有可用的第二张合同用于 Office 场景');
  `);
  await call('navigate_page', { url: `${report.baseUrl}/contracts/${office.contractId}` });
  await call('wait_for', { text: ['合同真实原件', '无真实原件'], timeout: 20000 });
  await injectHelpers();
  const officeView = await evaluate(`
    await window.__upload('合同正文.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',${JSON.stringify(docxB64)});
    const store=${store};
    const version=store.contractFileVersion(${JSON.stringify(office.contractId)});
    const labels=[...document.querySelectorAll('app-contract-original-file button')].map((b)=>b.innerText.trim());
    const result=await store.readContractOriginal(version.id);
    return {version,labels,hasPreview:labels.includes('受限预览'),
      hasDownload:labels.includes('下载原件'),
      bytes:result.ok ? await window.__b64(await result.blob.arrayBuffer()) : result.error,
      dbKeys:await window.__dbKeys()};
  `);
  assert.equal(officeView.hasPreview, false);
  assert.equal(officeView.hasDownload, true);
  assert.equal(officeView.bytes, docxB64);
  assert.equal(
    officeView.version.mimeType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['合同正文.docx', '已登记原件'], timeout: 20000 });
  await injectHelpers();
  const officeBlobId = await evaluate(
    `return ${store}.contractFileVersion(${JSON.stringify(office.contractId)}).blobId;`,
  );
  const officeAfterReload = await evaluate(`
    const store=${store};
    const version=store.contractFileVersion(${JSON.stringify(office.contractId)});
    const result=await store.readContractOriginal(version.id);
    return {bytes:result.ok ? await window.__b64(await result.blob.arrayBuffer()) : result.error,
      keys:await window.__dbKeys(),
      text:document.querySelector('app-contract-original-file').innerText};
  `);
  assert.equal(officeAfterReload.bytes, docxB64);
  assert.match(officeAfterReload.text, /合同正文\.docx/);
  // Reload retries the explicit cleanup marker; the existing original and later uploads remain.
  sameKeys(officeAfterReload.keys, [blobId, spoofBlobId, officeBlobId]);
  await check('Office 原件只给下载、不给预览，刷新后字节仍可原样取回', {
    office: officeView.version.fileName,
    mimeType: officeView.version.mimeType,
    keys: officeAfterReload.keys,
  });

  const afterReset = await evaluate(`
    const store=${store};
    const before=await window.__dbKeys();
    const reset=await store.reset();
    const storage=[];
    for(let i=0;i<localStorage.length;i+=1){
      const value=localStorage.getItem(localStorage.key(i));
      if(value && value.includes(${JSON.stringify(blobId)})) storage.push(localStorage.key(i));
    }
    return {reset,dbBefore:before,dbAfter:await window.__dbKeys(),
      storageKeysReferencingOriginal:storage,dataVersion:store.state().dataVersion};
  `);
  assert.equal(afterReset.reset, true);
  sameKeys(afterReset.dbAfter, afterReset.dbBefore);
  assert.ok(afterReset.storageKeysReferencingOriginal.length >= 1);
  await check('演示重置只开新工作区，不删除被旧快照引用的原件字节', afterReset);

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
