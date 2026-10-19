import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4324';
const out = path.join(root, 'artifacts/v9-b04-k12');
await fs.mkdir(out, { recursive: true });
const c = await connect({ isolated: true });
let pageId;
const checks = [];
const call = (name, args = {}) => c.call(name, { pageId, ...args });
const run = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  const m = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (!m) throw Error(raw);
  return JSON.parse(m[1]);
};
const pause = () => new Promise((r) => setTimeout(r, 250));
const panel = "ng.getComponent(document.querySelector('app-solution-input-panel'))";
try {
  const raw = toolText(await c.call('new_page', { url: base + '/sales/solutions/DEMO-O008' }));
  pageId = Number(raw.match(/(\d+):.*\[selected\]/)?.[1]);
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  const mounted = await run(
    `return {count:document.querySelectorAll('app-solution-output-upload').length,form:!!document.querySelector('app-solution-input-panel')};`,
  );
  assert.equal(mounted.count, 1, '页面必须挂载一个K12恢复控件');
  checks.push({ name: '真实方案页K12控件挂载', ...mounted });

  const child = "ng.getComponent(document.querySelector('app-solution-output-upload'))";
  const button = async () => {
    await run(`document.querySelector('app-solution-output-upload button').focus();return true;`);
    await call('press_key', { key: 'Enter' });
    await pause();
  };
  const upload = async (n) => {
    const file = path.join(out, `proposal-${n}.pptx`);
    await fs.writeFile(file, 'K12 real file ' + n);
    const snap = toolText(await call('take_snapshot'));
    const line = snap.split('\n').find((l) => l.includes('button "选择技术方案文件"'));
    await call('upload_file', { uid: line.match(/uid=(\S+)/)[1], filePaths: [file] });
    await run(
      `const p=${panel};[...document.querySelectorAll('app-solution-input-panel button')].find(b=>b.textContent.trim()==='保存技术方案').focus();return true;`,
    );
    await call('press_key', { key: 'Enter' });
    await pause();
    await run(`await ${panel}.check();return true;`);
    return run(
      `const p=${panel};return {number:p.current('proposal').number,feedback:p.feedback(),version:p.current('proposal')};`,
    );
  };
  const first = await upload(1);
  assert.equal(first.number, 1);
  await run(
    `const p=${panel};window.k12Remove=p.files.removeOwned;p.files.removeOwned=async()=>{throw Error('temporary delete failure')};return true;`,
  );
  const second = await upload(2);
  assert.equal(second.number, 2);
  assert.match(second.feedback, /已保存.*释放失败/);
  checks.push({
    name: '真实上传提交成功而释放失败',
    number: second.number,
    message: second.feedback,
  });
  const before = await run(`return JSON.stringify(${panel}.store.state());`);
  await button();
  const failed = await run(
    `const c=${child};return {result:c.last(),text:document.querySelector('app-solution-output-upload').innerText,state:JSON.stringify(c.panel.store.state())};`,
  );
  assert.equal(failed.result.recoveryNeeded, true);
  assert.match(failed.text, /仍有待恢复/);
  assert.equal(failed.state, before);
  checks.push({ name: '页面按钮重试失败保持业务与版本', result: failed.result });
  await run(`const p=${panel};p.files.removeOwned=window.k12Remove;return true;`);
  await button();
  const success = await run(
    `const c=${child};return {result:c.last(),state:JSON.stringify(c.panel.store.state()),old:!!await c.panel.files.get(${JSON.stringify(first.version.file.blobId)}),current:!!await c.panel.files.get(c.panel.current('proposal').file.blobId)};`,
  );
  assert.equal(success.result.removed.length, 1);
  assert.equal(success.old, false);
  assert.equal(success.current, true);
  assert.equal(success.state, before);
  checks.push({ name: '键盘重试释放成功不新增版本历史', result: success.result });
  await button();
  const repeat = await run(
    `const c=${child};return {result:c.last(),state:JSON.stringify(c.panel.store.state())};`,
  );
  assert.equal(repeat.result.removed.length, 0);
  assert.equal(repeat.state, before);
  checks.push({ name: '重复恢复幂等', result: repeat.result });
  // 修改资格是系统边界；即使误触回调也不能显示恢复完成。
  const readonly = await run(
    `const c=${child},s=c.panel.store;const lease=s.editingLease;s.editingLease={owns:()=>false};try{await c.retryRecovery();return {last:c.last(),feedback:c.feedback(),state:JSON.stringify(s.state())};}finally{s.editingLease=lease;}`,
  );
  assert.equal(readonly.last, null);
  assert.match(readonly.feedback, /修改资格|只读/);
  assert.equal(readonly.state, before);
  checks.push({ name: '失去修改资格拒绝并清除旧成功反馈', feedback: readonly.feedback });

  const empty = await run(`return document.querySelector('app-solution-output-upload').innerText;`);
  assert.match(empty, /尚未上传当前文件/);
  checks.push({ name: '从未上传与已证实缺件文案分开', passed: true });
  // 文件读取是系统边界，挂起以验证恢复中的重复触发与权限变化。
  await run(
    `const c=${child},p=c.panel;window.k12Get=p.files.get;p.files.get=async function(id){await new Promise(resolve=>window.k12Release=resolve);return window.k12Get.call(this,id)};window.k12Pending=c.retryRecovery();return true;`,
  );
  const busy = await run(
    `const c=${child};return {busy:c.busy(),disabled:document.querySelector('app-solution-output-upload button').disabled};`,
  );
  assert.equal(busy.busy, true);
  assert.equal(busy.disabled, true);
  checks.push({ name: '恢复期间按钮禁用防重复', ...busy });
  await run(
    `const c=${child},s=c.panel.store;window.k12Lease=s.editingLease;s.editingLease={owns:()=>false};window.k12Release();await window.k12Pending;s.editingLease=window.k12Lease;c.panel.files.get=window.k12Get;return true;`,
  );
  const lost = await run(
    `const c=${child};return {last:c.last(),feedback:c.feedback(),state:JSON.stringify(c.panel.store.state())};`,
  );
  assert.equal(lost.last, null);
  assert.match(lost.feedback, /修改资格已变化/);
  assert.equal(lost.state, before);
  checks.push({ name: '恢复中失权不显示虚假成功', feedback: lost.feedback });
  await run(
    `const c=${child},p=c.panel;window.k12Get=p.files.get;p.files.get=async function(id){await new Promise(resolve=>window.k12Release=resolve);return window.k12Get.call(this,id)};window.k12Pending=c.retryRecovery();return true;`,
  );
  await run(
    `await ng.getOwningComponent(document.querySelector('app-solution-input-panel')).router.navigateByUrl('/sales/solutions/DEMO-O003');return true;`,
  );
  await pause();
  await run(
    `window.k12Release();await window.k12Pending;${panel}.files.get=window.k12Get;return true;`,
  );
  await pause();
  const switched = await run(
    `const c=${child};return {id:c.panel.opportunityId(),last:c.last(),text:document.querySelector('app-solution-output-upload').innerText,state:JSON.stringify(c.panel.store.state())};`,
  );
  assert.equal(switched.id, 'DEMO-O003');
  assert.equal(switched.last, null);
  assert.doesNotMatch(switched.text, /本次释放/);
  assert.equal(switched.state, before);
  checks.push({ name: '切商机不显示上个来源恢复结果', id: switched.id });
  await run(
    `await ng.getOwningComponent(document.querySelector('app-solution-input-panel')).router.navigateByUrl('/sales/solutions/DEMO-O008');return true;`,
  );
  await pause();
  const unavailable = await run(
    `const p=${panel};const get=p.files.get;p.files.get=async()=>{throw Error('temporarily unreadable')};try{await p.check();return {availability:p.availability()[p.current('proposal').id],text:document.querySelector('app-solution-output-upload').innerText};}finally{p.files.get=get;}`,
  );
  await pause();
  assert.equal(unavailable.availability, 'unavailable');
  assert.match(
    await run(`return document.querySelector('app-solution-output-upload').innerText;`),
    /暂不可读取/,
  );
  checks.push({
    name: '文件读取异常显示暂不可读与重新核验提示',
    availability: unavailable.availability,
  });
  const missing = await run(
    `const p=${panel},v=p.current('proposal');const {blob,...identity}=await p.files.get(v.file.blobId);await p.files.removeOwned(v.file.blobId,identity);await p.check();return {availability:p.availability()[v.id],timestamp:v.uploadedAt};`,
  );
  await pause();
  assert.equal(missing.availability, 'missing');
  assert.match(
    await run(`return document.querySelector('app-solution-output-upload').innerText;`),
    /技术方案：文件已证实缺失/,
  );
  checks.push({ name: '真实文件缺失显示专属重传提示', ...missing });
  const third = await upload(3);
  assert.equal(third.number, 3);
  assert.equal(
    await run(`return ${panel}.history('proposal').find(v=>v.number===2).uploadedAt;`),
    missing.timestamp,
  );
  checks.push({ name: '缺件重传新版不回填历史时间', number: third.number });
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    const v = await run(
      `const el=document.querySelector('app-solution-output-upload');el.scrollIntoView();return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,button:el.querySelector('button').getBoundingClientRect().width};`,
    );
    assert.equal(v.overflow, false);
    checks.push({ name: 'K12控件五宽阅读', ...v });
  }
  await call('take_screenshot', { filePath: path.join(out, 'k12-390.png'), fullPage: true });
  const originalPage = pageId;
  const secondTab = toolText(
    await c.call('new_page', { url: base + '/sales/solutions/DEMO-O008' }),
  );
  pageId = Number(secondTab.match(/(\d+):.*\[selected\]/)[1]);
  await call('wait_for', { text: ['缺件恢复与重传'], timeout: 30000 });
  const readTab = await run(
    `const c=${child};return {writable:c.panel.writable(),disabled:document.querySelector('app-solution-output-upload button').disabled};`,
  );
  assert.equal(readTab.writable, false);
  assert.equal(readTab.disabled, true);
  checks.push({ name: '真实第二标签页恢复按钮只读禁用', ...readTab });
  await call('close_page');
  pageId = originalPage;
  const consoleErrors = toolText(await call('list_console_messages', { types: ['error'] }));
  assert.doesNotMatch(consoleErrors, /NG0950|ReferenceError|ERROR RuntimeError/);
  checks.push({ name: '无Angular挂载运行时错误', passed: true });
  await fs.writeFile(
    path.join(root, '../docs/verification/v9-b04-k12-integration/browser-report.json'),
    JSON.stringify({ passed: checks.length, checks }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length }));
} catch (e) {
  console.error(e);
  await fs.writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify({ error: e.message, checks }, null, 2),
  );
  process.exitCode = 1;
} finally {
  await c.client.close();
  await c.transport.close();
}
