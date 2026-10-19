import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-plan-warnings-browser', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), issue: 73, checks: [], result: '失败' };
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
const waitFor = async (text, timeout = 15000) => {
  await call('wait_for', { text: Array.isArray(text) ? text : [text], timeout });
};
const go = async (url, text, timeout = 20000) => {
  await evaluate(
    `await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl(${JSON.stringify(url)});return true;`,
  );
  await waitFor(text, timeout);
  await delay(300);
};
// 预警区 DOM 读取：只用真实页面元素，不读组件内部信号。
const warningSectionScript = `
  const section=[...document.querySelectorAll('section')].find(s=>s.querySelector('#warning-title'));
  if(!section) return {found:false};
  const rows=[...section.querySelectorAll('.task-row')];
  return {
    found:true,
    count:rows.length,
    footer:section.querySelector('.panel-foot')?.innerText.trim()||'',
    caption:section.querySelector('.board-caption')?.innerText.trim()||'',
    rows:rows.map(r=>({
      text:r.innerText,
      id:r.querySelector('.task-id')?.textContent.trim()||'',
      level:r.querySelector('[data-level]')?.getAttribute('data-level')||'',
      badge:r.querySelector('[data-level]')?.textContent.trim()||'',
      href:r.querySelector('a.process-link')?.getAttribute('href')||'',
    })),
  };
`;

try {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
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
  const created = toolText(await connection.call('new_page', { url: report.baseUrl + '/control' }));
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await waitFor('模拟观察日期', 20000);

  // 1. 正常档：种子内未完成的客户主节点与内部WBS均未进入预警
  await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    app.store.setRole('pm');
    app.store.setDateMode('normal');
    return true;
  `);
  await go('/', '预警事项');
  const normalWork = await evaluate(warningSectionScript);
  assert.equal(normalWork.found, true, '我的待办应包含预警事项区');
  assert.equal(normalWork.count, 0, '正常档下不应出现预警事项：' + JSON.stringify(normalWork));
  assert.equal(
    await evaluate(
      `return ng.getComponent(document.querySelector('app-root')).store.observationDate();`,
    ),
    '2026-10-15',
  );
  await check('WAR06 · 正常档我的待办无预警，观察日为 2026-10-15', normalWork);

  // 2. 对比档：负责人与PM都能看到同一事项，且带稳定身份、文字与定位链接
  await evaluate(`
    ng.getComponent(document.querySelector('app-root')).store.setDateMode('comparison');
    return true;
  `);
  await delay(400);
  const comparisonWork = await evaluate(warningSectionScript);
  assert.ok(comparisonWork.count > 0, '对比档应出现预警事项：' + JSON.stringify(comparisonWork));
  assert.ok(
    comparisonWork.rows.every((row) => row.level === 'yellow' || row.level === 'red'),
    '每条预警都应有明确级别：' + JSON.stringify(comparisonWork.rows),
  );
  assert.ok(
    comparisonWork.rows.every((row) => row.text.includes('负责人') && row.text.includes('项目PM')),
    '预警行应显示负责人与项目PM（含待补）：' + JSON.stringify(comparisonWork.rows[0]),
  );
  assert.ok(
    comparisonWork.rows.every(
      (row) => row.href.includes('/projects/') && row.href.includes('planId='),
    ),
    '去处理链接应定位到项目与 Plan ID：' + JSON.stringify(comparisonWork.rows[0]),
  );
  assert.ok(
    comparisonWork.caption.includes('未读'),
    '预警区应给出未读计数：' + comparisonWork.caption,
  );
  const dedupe = await evaluate(`
    const app=ng.getComponent(document.querySelector('app-root'));
    const ids=${JSON.stringify(comparisonWork.rows.map((row) => row.id))};
    const unique=new Set(ids);
    const workItemIds=app.store.state().projects.flatMap(p=>p.plans.map(x=>p.id+':'+x.id));
    return {duplicated:unique.size!==ids.length,stable:workItemIds.length>0};
  `);
  assert.equal(dedupe.duplicated, false, '同一事项不应重复出现');
  await check('WAR02/WAR03 · 对比档负责人与PM看到同一批临期／逾期事项并带定位', {
    count: comparisonWork.count,
    first: comparisonWork.rows[0],
  });

  // 3. 标记已读：保留事项、风险颜色不变、按人持久化
  const read = await evaluate(`
    const section=()=>[...document.querySelectorAll('section')].find(s=>s.querySelector('#warning-title'));
    const row=()=>section().querySelectorAll('.task-row')[0];
    const target=row();
    const id=target.querySelector('.task-id').textContent.trim();
    const beforeBadge=target.querySelector('[data-level]').textContent.trim();
    const beforeLevel=target.querySelector('[data-level]').getAttribute('data-level');
    const beforeCount=section().querySelectorAll('.task-row').length;
    [...target.querySelectorAll('button')].find(b=>b.textContent.trim()==='标记已读').click();
    await new Promise(r=>setTimeout(r,300));
    const afterRow=row();
    const app=ng.getComponent(document.querySelector('app-root'));
    const reads=app.store.state().planWarningReads||[];
    return {
      id,beforeBadge,beforeLevel,beforeCount,
      afterCount:section().querySelectorAll('.task-row').length,
      afterText:afterRow.innerText,
      afterBadge:afterRow.querySelector('[data-level]').textContent.trim(),
      afterLevel:afterRow.querySelector('[data-level]').getAttribute('data-level'),
      storedRead:reads.some(x=>x.warningId===id),
      person:app.store.person(),
    };
  `);
  assert.equal(read.afterCount, read.beforeCount, '已读不应移除当前预警事项');
  assert.equal(read.afterBadge, read.beforeBadge, '已读不应改变风险文字');
  assert.equal(read.afterLevel, read.beforeLevel, '已读不应改变风险颜色');
  assert.ok(read.afterText.includes('本人已读'), '已读后应显示本人已读：' + read.afterText);
  assert.equal(read.storedRead, true, '已读应写入本工作区快照');
  await check('WAR04 · 标记已读保留事项、级别与文字，并持久化为本人状态', read);

  // 4. 刷新后已读保留，且换人后已读状态互不影响
  await call('navigate_page', { type: 'reload' });
  await waitFor('预警事项', 25000);
  await delay(600);
  const isolation = await evaluate(`
    const section=()=>[...document.querySelectorAll('section')].find(s=>s.querySelector('#warning-title'));
    const rows=()=>[...section().querySelectorAll('.task-row')];
    const target=rows().find(r=>r.querySelector('.task-id').textContent.trim()===${JSON.stringify(read.id)});
    const reloadedRead=target?target.innerText.includes('本人已读'):null;
    const app=ng.getComponent(document.querySelector('app-root'));
    const firstPerson=app.store.person();
    app.store.setRole('solution');
    await new Promise(r=>setTimeout(r,250));
    const otherPerson=app.store.person();
    const otherRows=rows();
    const otherTarget=otherRows.find(r=>r.querySelector('.task-id').textContent.trim()===${JSON.stringify(read.id)});
    const otherSeesRead=otherTarget?otherTarget.innerText.includes('本人已读'):null;
    app.store.setRole('pm');
    await new Promise(r=>setTimeout(r,250));
    const backTarget=rows().find(r=>r.querySelector('.task-id').textContent.trim()===${JSON.stringify(read.id)});
    return {
      firstPerson, otherPerson, reloadedRead, otherSeesRead,
      otherRowCount:otherRows.length,
      backSeesRead:backTarget?backTarget.innerText.includes('本人已读'):null,
    };
  `);
  assert.equal(isolation.reloadedRead, true, '刷新后本人已读应保留');
  assert.notEqual(isolation.otherPerson, isolation.firstPerson, '应能切换查看人');
  assert.notEqual(isolation.otherSeesRead, true, '他人看到的事项不应显示为本人已读');
  assert.equal(isolation.backSeesRead, true, '切回本人后已读状态仍在');
  await check('WAR04 · 已读按人隔离并跨刷新持久化', isolation);

  // 5. 追踪看板：同一批事项、接收人、依据日期与筛选
  await go('/plans/tracking', '当前筛选下预警');
  const tracking = await evaluate(`
    const rows=[...document.querySelectorAll('tbody tr[data-plan-id]')];
    const stats=[...document.querySelectorAll('.stat')].map(s=>s.innerText.trim());
    const params=new URLSearchParams(location.search);
    return {
      banner:document.body.innerText.includes('模拟观察日'),
      stats,
      rowCount:rows.length,
      firstRow:rows[0]?rows[0].innerText:'',
      planIdCells:rows.filter(r=>r.innerText.includes('Plan ID')).length,
      filters:[...document.querySelectorAll('select')].map(s=>s.getAttribute('aria-label')),
      url:location.pathname+(params.toString()?'?'+params.toString():''),
    };
  `);
  assert.ok(tracking.banner, '追踪看板应显示当前模拟观察日');
  assert.ok(tracking.stats.some((s) => s.includes('当前筛选下预警')), '看板应有预警统计');
  assert.ok(
    tracking.stats.some((s) => s.includes('已逾期')) && tracking.stats.some((s) => s.includes('临期')),
    '看板应分别给出已逾期与临期统计：' + JSON.stringify(tracking.stats),
  );
  assert.ok(tracking.rowCount > 0, '对比档下追踪看板应有计划行');
  assert.ok(
    tracking.filters.includes('追踪项目筛选') && tracking.filters.includes('追踪负责人筛选'),
    '追踪看板应能按项目与负责人筛选：' + JSON.stringify(tracking.filters),
  );
  assert.ok(
    tracking.planIdCells > 0 && tracking.firstRow.includes('Plan ID'),
    '计划行应显示 Plan ID：' + tracking.firstRow,
  );
  await check('WAR06/DAT03 · 追踪看板显示同一批预警、接收人与依据日期并可按项目／负责人筛选', {
    rowCount: tracking.rowCount,
    stats: tracking.stats,
    firstRow: tracking.firstRow,
  });

  // 6. 切回正常档：待办与看板同步解除当前预警（普通未完成待办仍可存在）
  await evaluate(`
    ng.getComponent(document.querySelector('app-root')).store.setDateMode('normal');
    return true;
  `);
  await delay(400);
  const backToNormal = await evaluate(`
    const cards=[...document.querySelectorAll('.stat')].map(s=>s.innerText.trim());
    return {cards, text:document.body.innerText};
  `);
  await go('/', '预警事项');
  const normalAgain = await evaluate(warningSectionScript);
  assert.equal(normalAgain.count, 0, '切回正常档后预警事项应全部解除：' + JSON.stringify(normalAgain));
  assert.ok(
    backToNormal.cards.some((c) => c.includes('当前筛选下预警')),
    '追踪看板应保留预警统计区域',
  );
  await check('WAR05/DAT02 · 切回正常档后待办与看板同步解除当前预警', {
    normalCount: normalAgain.count,
    footer: normalAgain.footer,
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
  console.log('浏览器验收证据：', output);
}
