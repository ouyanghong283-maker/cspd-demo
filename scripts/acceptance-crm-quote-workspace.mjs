import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'crm-quote-workspace', runId);
await fs.mkdir(output, { recursive: true });
const report = { runAt: new Date().toISOString(), checks: [], result: '失败' };
const snapshotExpr =
  "JSON.parse(localStorage.getItem('cspd-demo:v7:workspace:'+localStorage.getItem('cspd-demo:v7:active-workspace'))).snapshot";
let server;
let serverFailure;
let serverLog = '';
let connection;
let pageId;
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + raw);
  return JSON.parse(match[1]);
};
const check = async (name, fn) => {
  const evidence = await fn();
  report.checks.push({ name, result: '通过', evidence });
  console.log('PASS', name);
  return evidence;
};
const state = () =>
  evaluate(`const value=${snapshotExpr};if(!value)throw Error('缺少活动工作区');return value`);
const ready = async () => call('wait_for', { text: ['CSPD 项目全链条协同平台'], timeout: 20000 });
const waitFor = async (predicate, message) => {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(`return (${predicate})`)) return;
    await delay(100);
  }
  throw new Error(message);
};
const navigate = async (url) => {
  await call('navigate_page', { type: 'url', url: report.baseUrl + url });
  await ready();
};
const setField = async (name, value) => {
  await evaluate(
    `const e=document.querySelector('[name="${name}"], [data-field="${name}"]');if(!e)throw Error('缺少${name}');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));return true`,
  );
};
const click = async (label) => {
  const snapshot = toolText(await call('take_snapshot'));
  const row = snapshot
    .split('\n')
    .find(
      (line) =>
        (line.includes('button ' + JSON.stringify(label)) ||
          line.includes('tab ' + JSON.stringify(label).slice(0, -1))) &&
        !line.includes('disabled'),
    );
  assert(row, `找不到可用按钮“${label}”：\n${snapshot.slice(-1800)}`);
  await call('click', { uid: row.match(/uid=(\S+)/)[1] });
  await delay(150);
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
  server.on('error', (error) => {
    serverFailure = error;
  });
  server.on('exit', (code, signal) => {
    serverFailure = new Error(`服务退出：${code ?? signal}`);
  });
  for (const stream of [server.stdout, server.stderr])
    stream.on('data', (chunk) => {
      serverLog = (serverLog + chunk.toString()).slice(-10000);
    });
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    if (serverFailure) throw serverFailure;
    try {
      if ((await fetch(report.baseUrl)).status === 200) break;
    } catch {}
    await delay(300);
  }
  assert(Date.now() < until, 'Angular 服务启动超时：' + serverLog.slice(-2500));

  connection = await connect({ isolated: true });
  const created = toolText(
    await connection.call('new_page', {
      url: report.baseUrl + '/sales/quotes/DEMO-O008',
      timeout: 30000,
    }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  assert(Number.isFinite(pageId), created);
  await ready();

  const select = async (name, rawValue) => {
    await evaluate(
      `const element=document.querySelector('[name="${name}"], [data-field="${name}"]');if(!element)throw Error('缺少${name}');const option=[...element.options].find(o=>o.value===${JSON.stringify(String(rawValue))}||o.value.includes(': '+${JSON.stringify(String(rawValue))})||o.textContent.trim()===${JSON.stringify(String(rawValue))});if(!option)throw Error('缺少选项 '+${JSON.stringify(String(rawValue))});element.value=option.value;element.dispatchEvent(new Event('change',{bubbles:true}));return true`,
    );
  };
  const evidenceBase = path.join(root, '../doc/字段资料/V7_CRM只读取证');
  const catalog = JSON.parse(
    await fs.readFile(path.join(evidenceBase, 'quote-implementation-catalog-source.json'), 'utf8'),
  );
  const terms = catalog.result.find((row) => row.key === 'paymentTerms').data.value;
  const organizations = catalog.result.find((row) => row.key === 'organizations').data.value;
  const org = organizations.find((row) => row.alp_salesorganizationcode === '8210');
  const priceListId = 'e1c9fdea-7efd-ef11-bae3-000d3adb1307';
  const productId = '14ebda8d-81f9-ef11-bae2-000d3ab7c99d';
  const initial = await state();
  const legacy = initial.quoteSeries.find((series) => series.opportunityId === 'DEMO-O014')
    .versions[0];
  const quoteId = initial.quoteSeries.find((series) => series.opportunityId === 'DEMO-O008')
    .versions[0].id;
  const person = initial.customers.find(
    (customer) => customer.id === initial.sales.find((sale) => sale.id === 'DEMO-O008').customerId,
  ).contacts[0].name;
  const quote = async () =>
    (await state()).quoteSeries
      .find((series) => series.opportunityId === 'DEMO-O008')
      .versions.find((version) => version.id === quoteId);

  await check('摘要完整显示源分组，主操作只有保存与提交，移除旧额外功能', async () => {
    await waitFor("!!document.querySelector('[name=quote-alp_quotation_type]')", '摘要表单未显示');
    const structure = await evaluate(
      `return {labels:[...document.querySelectorAll('app-crm-quote-field label')].map(e=>e.textContent.trim()),groups:[...document.querySelectorAll('.form-section h3')].map(e=>e.textContent),actions:[...document.querySelectorAll('.primary-actions button')].map(e=>e.textContent.trim()),body:document.querySelector('app-quote-workspace').innerText}`,
    );
    assert.equal(structure.labels.length, 37);
    for (const group of ['基础信息', '客户信息', '送货地址', '客户需求信息', '支付条款详情'])
      assert(structure.groups.includes(group));
    assert.deepEqual(structure.actions, ['保存草稿', '提交审核']);
    for (const text of [
      '本地税费案例',
      '跨境税费案例',
      '成本参考',
      '维护方案摘要',
      '确认税费样例',
      '来源扩展字段',
    ])
      assert(!structure.body.includes(text), text);
    await select('quote-alp_price_list', priceListId);
    await select('quote-alp_quotation_type', '单次报价');
    await select('quote-alp_trade_terms', 'CFR');
    await select('quote-alp_paymenttermsid', terms[0].alp_paymenttermsid);
    if (org) await select('quote-alp_salesbranch', org.alp_sales_organizationid);
    await select('quote-alp_isintax', '未税');
    await setField('quote-closedon', '2026-11-09');
    await setField('quote-shipto_city', '浏览器验收城市');
    await setField('quote-description', '仅本地合成验收，不写入标准CRM');
    await call('take_screenshot', {
      filePath: path.join(output, 'summary-desktop.png'),
      fullPage: true,
    });
    return {
      groups: structure.groups,
      visibleFieldCount: structure.labels.length,
      actions: structure.actions,
    };
  });

  await check('直接维护产品、数量、单价和运费，保存后刷新保留且基础选择锁定', async () => {
    await click('报价明细');
    while (await evaluate("return !!document.querySelector('.table-wrap button.remove')"))
      await click('删除');
    await click('新增报价明细');
    await waitFor(
      "!!document.querySelector('app-crm-quote-field select[name$=alp_productcode]')",
      '新增明细未显示',
    );
    const lineId = await evaluate(
      "return document.querySelector('app-crm-quote-field select[name$=alp_productcode]').name.replace(/-alp_productcode$/,'')",
    );
    await select(lineId + '-alp_productcode', productId);
    await setField(lineId + '-quantity', '2');
    await setField(lineId + '-alp_priceperunit', '200');
    await setField(lineId + '-alp_freightfee', '5');
    await click('保存草稿');
    await waitFor(
      `${snapshotExpr}.quoteSeries.find(s=>s.opportunityId==='DEMO-O008').versions.find(v=>v.id===${JSON.stringify(quoteId)}).crmSchemaVersion===1`,
      '草稿未保存',
    );
    const saved = await quote();
    assert.equal(saved.crmFields.alp_quototalpriceofftax, 405);
    assert.equal(saved.crmFields.alp_quototalpriceintax, 405);
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].crmFields.quantity, 2);
    assert(saved.crmReferenceSnapshot.references.some((row) => row.id === productId));
    assert.equal(saved.crmCalculationPolicy, 'demo-fixed-v1');
    await call('take_screenshot', {
      filePath: path.join(output, 'details-desktop.png'),
      fullPage: true,
    });
    await call('navigate_page', { type: 'reload', ignoreCache: true });
    await ready();
    await waitFor(
      "!!document.querySelector('app-quote-workspace .workspace-tabs')",
      '刷新后工作区未恢复',
    );
    assert.equal((await quote()).crmFields.shipto_city, '浏览器验收城市');
    assert.equal((await quote()).crmCalculationPolicy, 'demo-fixed-v1');
    assert.equal(
      await evaluate("return !!document.querySelector('select[name=quote-transactioncurrencyid]')"),
      false,
    );
    assert.equal(
      await evaluate("return !!document.querySelector('select[name=quote-alp_price_list]')"),
      false,
    );
    return { lineId, net: 405, gross: 405, refreshRetained: true };
  });

  await check('通过页面提交、审核、发出、接受和一次主管锁定', async () => {
    await click('提交审核');
    await waitFor(
      `${snapshotExpr}.quoteSeries.find(s=>s.opportunityId==='DEMO-O008').versions.find(v=>v.id===${JSON.stringify(quoteId)}).status==='待模拟审核'`,
      '未进入审核',
    );
    await click('审核报价');
    await select('result', '模拟审核通过');
    await setField('note', '页面复核通过');
    await click('保存');
    await click('记录报价已发出');
    await select('method', '邮件（手工发送）');
    await select('recipient', person);
    await setField('evidence', '浏览器验收发出凭据');
    await click('保存');
    await click('记录客户结果');
    await select('result', '接受');
    await select('person', person);
    await setField('evidence', '浏览器验收客户回函');
    await click('保存');
    assert.equal((await quote()).lockRequestedBy, '');
    await click('主管确认锁定');
    await setField('confirm', '确认锁定');
    await click('保存');
    await waitFor(
      `${snapshotExpr}.quoteSeries.find(s=>s.opportunityId==='DEMO-O008').activeFinalVersionId===${JSON.stringify(quoteId)}`,
      '最终版本未锁定',
    );
    const locked = await quote();
    assert.equal(locked.status, '最终锁定');
    assert.equal(locked.customerDecision, '接受');
    assert(locked.audit.some((row) => row.action === '客户接受报价'));
    await call('take_screenshot', {
      filePath: path.join(output, 'review-locked.png'),
      fullPage: true,
    });
    const untouched = (await state()).quoteSeries.find(
      (series) => series.opportunityId === 'DEMO-O014',
    ).versions[0];
    assert.deepEqual(untouched, legacy, '其他旧报价被修改');
    return {
      status: locked.status,
      customerDecision: locked.customerDecision,
      requestRequired: false,
      auditCount: locked.audit.length,
      otherHistoryUntouched: true,
    };
  });

  await check('固定演示口径及两组数据明确标注，不改写历史', async () => {
    const policy = await evaluate(
      `const note=document.querySelector('[data-testid="quote-demo-policy"]');const cases=document.querySelector('[data-testid="quote-demo-cases"]');cases.open=true;return {notice:note.textContent,text:cases.textContent};`,
    );
    assert(policy.notice.includes('固定演示口径'));
    assert(policy.text.includes('不对应CRM记录'));
    assert(policy.text.includes('665.00') && policy.text.includes('751.45'));
    assert(policy.text.includes('0.30') && policy.text.includes('0.03'));
    assert.equal((await quote()).crmCalculationPolicy, 'demo-fixed-v1');
    return { notice: policy.notice, cases: 2, policyId: 'demo-fixed-v1' };
  });

  await check('窄屏摘要与操作可使用，历史金额保持只读', async () => {
    await call('resize_page', { width: 390, height: 844 });
    await click('摘要');
    const viewport = await evaluate(
      "return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,saveButtons:document.querySelectorAll('.primary-actions button').length,body:document.querySelector('app-quote-workspace').innerText}",
    );
    assert(viewport.scrollWidth <= viewport.width + 1, JSON.stringify(viewport));
    assert.equal(viewport.saveButtons, 0);
    await call('take_screenshot', {
      filePath: path.join(output, 'summary-mobile.png'),
      fullPage: true,
    });
    return { width: viewport.width, scrollWidth: viewport.scrollWidth, readOnly: true };
  });
  await check('新建报价采用摘要必填与30天默认有效期，不沿用额外门禁', async () => {
    await call('resize_page', { width: 1440, height: 1000 });
    const saved = await state();
    const candidate = saved.sales.find(
      (sale) =>
        sale.type === 'opportunity' &&
        !['意向沟通', '赢单', '丢单'].includes(sale.stage) &&
        !saved.quoteSeries.some((series) => series.opportunityId === sale.id),
    );
    assert(candidate, '缺少可创建报价的商机样例');
    await navigate('/sales/quotes/' + candidate.id);
    await click('创建报价草稿');
    await waitFor(`!!document.querySelector('[name=quote-closedon]')`, '新报价表单未出现');
    const series = (await state()).quoteSeries.find(
      (series) => series.opportunityId === candidate.id,
    );
    assert.equal(series.versions[0].crmSchemaVersion, 1);
    assert.equal(series.versions[0].crmFields.closedon, '2026-11-09');
    assert.equal(series.versions[0].items.length, 0);
    await click('保存草稿');
    const validation = await evaluate(
      "return document.querySelector('.validation')?.innerText||''",
    );
    assert(validation.includes('关联价目表'), validation);
    assert(validation.includes('支付条款'), validation);
    assert(!validation.includes('方案摘要') && !validation.includes('引用资料'), validation);
    await call('take_screenshot', {
      filePath: path.join(output, 'new-quote-required.png'),
      fullPage: true,
    });
    return { opportunityId: candidate.id, defaultExpiry: '2026-11-09', validation };
  });
  const errors = toolText(await call('list_console_messages', { types: ['error', 'warn'] }));
  assert(/no console messages found/i.test(errors), errors);
  report.consoleErrorsAndWarnings = errors;
  report.result = '通过';
} catch (error) {
  report.error = error.stack || error.message;
  report.serverLogTail = serverLog.slice(-2500);
  report.result = '失败';
  if (connection) {
    try {
      report.consoleAtFailure = toolText(
        await call('list_console_messages', { types: ['error', 'warn'] }),
      );
      console.log(report.consoleAtFailure);
    } catch {}
    try {
      await call('take_screenshot', { filePath: path.join(output, 'failure.png'), fullPage: true });
    } catch {}
  }
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('REPORT', path.join(output, 'results.json'));
  if (connection) await connection.client.close();
  if (server && !server.killed) server.kill('SIGTERM');
}
