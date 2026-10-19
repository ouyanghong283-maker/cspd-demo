import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'browser-environment', runId);
await fs.mkdir(output, { recursive: true });
const report = {
  runAt: new Date().toISOString(),
  scope: '浏览器验收环境；不代表全部业务需求通过',
  checks: [],
  result: '失败',
};
let server, connection, pageId, serverFailure;
let serverLog = '';
const controller = new AbortController();
// 本机可能同时有其他构建/浏览器任务，等待上限按共享机器的实际耗时放宽，不放松任何断言。
const deadline = setTimeout(() => controller.abort(new Error('验收超过300秒')), 300000);
const signalHandlers = new Map(
  ['SIGINT', 'SIGTERM'].map((signal) => {
    const handler = () => controller.abort(new Error('验收被中断：' + signal));
    process.once(signal, handler);
    return [signal, handler];
  }),
);
const stopIfAborted = () => controller.signal.throwIfAborted();
const step = async (name, fn) => {
  stopIfAborted();
  try {
    const evidence = await fn();
    report.checks.push({ name, result: '通过', evidence });
    console.log('PASS', name);
    return evidence;
  } catch (error) {
    report.checks.push({ name, result: '失败', error: error.message });
    throw error;
  }
};
const call = (name, args = {}) => {
  stopIfAborted();
  return connection.call(name, { pageId, ...args });
};
// 业务数据保存在 V7 工作区信封 `cspd-demo:v7:workspace:<id>` 的 snapshot 中；
// 裸键 `cspd-demo-v2` 只在尚未迁移的旧数据上作为回退。
const stateReader = `const cspdState = () => {
  const pointer = localStorage.getItem('cspd-demo:v7:active-workspace');
  const raw = pointer ? localStorage.getItem('cspd-demo:v7:workspace:' + pointer) : null;
  const parsed = JSON.parse(raw ?? localStorage.getItem('cspd-demo-v2'));
  return parsed && parsed.snapshot ? parsed.snapshot : parsed;
};
`;
const evaluate = async (body) => {
  const text = toolText(
    await call('evaluate_script', { function: `async () => {${stateReader}${body}}` }),
  );
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  assert(match, '浏览器没有返回 JSON：' + text);
  return JSON.parse(match[1]);
};
const ready = async () => {
  await call('wait_for', { text: ['CSPD 项目全链条协同平台'], timeout: 30000 });
  assert(
    await evaluate("return !!document.querySelector('main h1, main h2')?.textContent.trim()"),
    '页面主体未渲染',
  );
};
const click = async (label) => {
  const snapshot = toolText(await call('take_snapshot'));
  const row = snapshot
    .split('\n')
    .find((line) => line.includes('button ' + JSON.stringify(label)) && !line.includes('disabled'));
  assert(row, '找不到可用按钮：' + label);
  await call('click', { uid: row.match(/uid=(\S+)/)[1] });
};
async function checkPageErrors(label) {
  const consoleText = toolText(await call('list_console_messages', { types: ['error'] }));
  const networkText = toolText(await call('list_network_requests'));
  await fs.appendFile(
    path.join(output, 'browser-errors.log'),
    `${label}\n${consoleText}\n${networkText}\n`,
  );
  assert(!/msgid=/.test(consoleText), '浏览器控制台报错，见 browser-errors.log');
  assert(!/\[(?:failed|[45]\d\d)\b/i.test(networkText), '浏览器请求失败，见 browser-errors.log');
}

try {
  let base = process.env.CSPD_BASE_URL?.replace(/\/+$/, '');
  if (!base) {
    const port = await step('本机允许监听端口', async () => {
      const probe = net.createServer();
      await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
      });
      const port = probe.address().port;
      await new Promise((resolve, reject) =>
        probe.close((error) => (error ? reject(error) : resolve())),
      );
      return port;
    });
    base = `http://127.0.0.1:${port}`;
    console.log('启动独立验收服务：', base);
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
        serverLog += chunk.toString();
      });
  }
  report.baseUrl = base;
  console.log('验收地址：', base);
  await step('HTTP 服务就绪且属于 CSPD DEMO', async () => {
    const until = Date.now() + (server ? 90000 : 10000);
    while (true) {
      stopIfAborted();
      if (serverFailure) throw serverFailure;
      try {
        const response = await fetch(base, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
        });
        const html = await response.text();
        assert.equal(response.status, 200);
        assert(
          html.includes('CSPD · 项目全链条协同平台') && html.includes('<app-root>'),
          '此地址不是 CSPD DEMO',
        );
        return { status: response.status };
      } catch (error) {
        if (Date.now() >= until || !server || error.code === 'ERR_ASSERTION') throw error;
        await delay(300, undefined, { signal: controller.signal });
      }
    }
  });
  connection = await connect({ isolated: true });
  await step('Chrome 启动、MCP 连接及 Angular 页面渲染', async () => {
    const text = toolText(await connection.call('new_page', { url: base + '/', timeout: 20000 }));
    const match = text.match(/(\d+):.*\[selected\]/);
    assert(match, text);
    pageId = Number(match[1]);
    await ready();
    report.browser = await evaluate('return navigator.userAgent');
    return report.browser;
  });
  await step('真实点击、填写、保存及刷新后保留数据', async () => {
    await call('navigate_page', { type: 'url', url: base + '/sales/customers' });
    await ready();
    await click('新建客户');
    await click('填入演示内容');
    const countryOptions = await evaluate(
      "const select=document.querySelector('[data-field=country]'); return select ? [...select.options].map(x=>x.value) : []",
    );
    assert(
      countryOptions.includes('中国') && countryOptions.includes('新加坡'),
      '客户国家下拉缺少中国或新加坡',
    );
    await evaluate(
      "const select=document.querySelector('[data-field=country]'); select.value='中国'; select.dispatchEvent(new Event('change',{bubbles:true})); return select.value",
    );
    const name = '浏览器环境验收-' + runId;
    const snapshot = toolText(await call('take_snapshot'));
    await fs.writeFile(path.join(output, 'form-snapshot.txt'), snapshot);
    // Get the accessible input UID from the DOM snapshot, then type through MCP.
    const input = snapshot.split('\n').find((line) => /textbox "客户名称/.test(line));
    assert(input, '客户名称输入框不存在');
    await call('fill', { uid: input.match(/uid=(\S+)/)[1], value: name });
    await click('保存');
    await call('wait_for', { text: [name], timeout: 10000 });
    const customer = await evaluate(
      `return cspdState().customers.find(x => x.name === ${JSON.stringify(name)})`,
    );
    assert(customer?.id, '保存后缺少客户记录');
    assert.equal(customer.country, '中国', '保存后客户国家没有保留所选中国');
    await call('navigate_page', { type: 'reload', ignoreCache: true });
    await ready();
    await call('wait_for', { text: [name], timeout: 10000 });
    assert.equal(
      await evaluate(
        `return cspdState().customers.find(x => x.id === ${JSON.stringify(customer.id)})?.name`,
      ),
      name,
    );
    await evaluate('await document.fonts.ready; return true');
    await call('take_screenshot', { filePath: path.join(output, 'desktop.png'), fullPage: true });
    await checkPageErrors('保存与刷新');
    return {
      customerId: customer.id,
      name,
      country: customer.country,
      countryOptions: {
        china: countryOptions.includes('中国'),
        singapore: countryOptions.includes('新加坡'),
      },
    };
  });
  await step('方案负责人下拉、名单外拦截及刷新保留', async () => {
    const opportunityId = 'DEMO-O014';
    await call('navigate_page', { type: 'url', url: base + '/sales/solutions/' + opportunityId });
    await ready();
    await click('新增TIC模拟版本');
    const owner = await evaluate(
      "const select=document.querySelector('[data-field=owner]'); return {tag:select?.tagName,options:select ? [...select.options].map(x=>x.value) : []}",
    );
    assert.equal(owner.tag, 'SELECT');
    assert(owner.options.includes('周方案') && owner.options.includes('王项目'));
    assert(!owner.options.includes('访客'));
    const snapshot = toolText(await call('take_snapshot'));
    const nameField = snapshot.split('\n').find((line) => /textbox "模拟文件名/.test(line));
    assert(nameField, '模拟文件名缺失');
    await call('fill', {
      uid: nameField.match(/uid=(\S+)/)[1],
      value: '人员选择验收-' + runId + '.pdf',
    });
    await evaluate(
      "const select=document.querySelector('[data-field=owner]'); const option=document.createElement('option'); option.value='名单外人员'; option.text='名单外人员'; select.append(option); select.value=option.value; select.dispatchEvent(new Event('change',{bubbles:true})); return true",
    );
    await click('保存');
    assert(
      await evaluate("return !!document.querySelector('[role=dialog] .field-error')"),
      '名单外姓名未被拦截',
    );
    const updatedSnapshot = toolText(await call('take_snapshot'));
    const personField = updatedSnapshot
      .split('\n')
      .find((line) => /combobox "当前方案负责人/.test(line));
    assert(personField, '方案负责人不是下拉选项');
    await call('fill', { uid: personField.match(/uid=(\S+)/)[1], value: '周方案' });
    await call('take_screenshot', {
      filePath: path.join(output, 'personnel-select.png'),
      fullPage: true,
    });
    await click('保存');
    await call('wait_for', { text: ['TIC模拟资料已留档'], timeout: 10000 });
    await call('navigate_page', { type: 'reload', ignoreCache: true });
    await ready();
    const savedOwner = await evaluate(
      `return cspdState().solutionDocuments.find(x=>x.opportunityId===${JSON.stringify(opportunityId)})?.owner`,
    );
    assert.equal(savedOwner, '周方案');
    await checkPageErrors('方案负责人下拉');
    return { owner: savedOwner, unknownNameBlocked: true, options: owner.options.filter(Boolean) };
  });
  await step('方案确认、五可会签、粗计划和项目经理使用人员下拉', async () => {
    await click('负责人确认当前四类资料和商机配置');
    assert.equal(
      await evaluate("return document.querySelector('[data-field=owner]')?.tagName"),
      'SELECT',
    );
    await click('取消');
    await click('记录五项结果、依据和条件');
    const reviewFields = await evaluate(
      'return [...document.querySelectorAll(\'[data-field$="-owner"],[data-field$="-conditionOwner"]\')].map(x=>({key:x.dataset.field,tag:x.tagName,options:[...x.options].map(o=>o.value)}))',
    );
    assert.equal(reviewFields.length, 10);
    assert(
      reviewFields.every((field) => field.tag === 'SELECT' && field.options.includes('周方案')),
    );
    await click('取消');
    // 方案工作区改版后，粗计划与沟通记录分别回到商机详情的「概览」「沟通」页签。
    await call('navigate_page', { type: 'url', url: base + '/sales/detail/DEMO-O014' });
    await ready();
    await click('概览');
    await click('新增计划节点');
    assert.equal(
      await evaluate("return document.querySelector('[data-field=owner]')?.tagName"),
      'SELECT',
    );
    await click('取消');
    await click('沟通');
    await click('新增沟通记录');
    await click('填入演示内容');
    await evaluate(
      "document.querySelector('[role=dialog] .optional-fields summary').click(); return true",
    );
    const activitySnapshot = toolText(await call('take_snapshot'));
    const participants = activitySnapshot.split('\n').find((line) => /combobox "参与人/.test(line));
    assert(participants, '参与人未使用多人下拉');
    await call('fill', { uid: participants.match(/uid=(\S+)/)[1], value: '王项目' });
    await call('take_screenshot', {
      filePath: path.join(output, 'participants-select.png'),
      fullPage: true,
    });
    await click('保存');
    const savedPeople = await evaluate(
      "return cspdState().activities.at(-1).people",
    );
    assert.equal(savedPeople, '张销售、王项目');
    await call('navigate_page', { type: 'url', url: base + '/projects' });
    await ready();
    await click('新建项目草稿');
    const managers = await evaluate(
      "const select=document.querySelector('[data-field=pm]'); return select?.tagName==='SELECT' ? [...select.options].map(x=>x.value) : []",
    );
    assert(managers.includes('王项目') && managers.includes('刘项目'));
    await click('取消');
    await checkPageErrors('会签、计划与PM人员下拉');
    return {
      reviewPersonFields: reviewFields.length,
      participants: savedPeople,
      projectManagers: managers.filter(Boolean),
    };
  });
  await step('商机粗计划按来源类别关联数据库计划模板', async () => {
    const opportunityId = 'DEMO-O001';
    await call('navigate_page', { type: 'url', url: base + '/sales/detail/' + opportunityId });
    await ready();
    await click('新增计划节点');
    const sourceOptions = await evaluate(
      "const select=document.querySelector('[data-field=sourceType]'); return select ? [...select.options].map(option=>option.value) : []",
    );
    assert(sourceOptions.includes('自行制定') && sourceOptions.includes('参考模板') && sourceOptions.includes('客户要求'));
    await evaluate("const select=document.querySelector('[data-field=sourceType]');select.value='参考模板';select.dispatchEvent(new Event('change',{bubbles:true}));return select.value");
    const templates = await evaluate("const select=document.querySelector('[data-field=sourceTemplateId]');return [...select.options].map(x=>({value:x.value,label:x.textContent.trim()}))");
    assert(templates.some(option => option.value === 'DEMO-RPT-STANDARD' && option.label.includes('CIF')));
    await evaluate("const select=document.querySelector('[data-field=sourceTemplateId]');select.value='DEMO-RPT-STANDARD';select.dispatchEvent(new Event('change',{bubbles:true}));return select.value");
    const applied = await evaluate("const task=document.querySelector('[data-field=sourceTemplateTaskId]'); const choices=[...task.options].map(x=>({value:x.value,label:x.textContent.trim()})); task.value='DEMO-RPT-STANDARD-1-1';task.dispatchEvent(new Event('change',{bubbles:true})); const read=key=>document.querySelector(`[data-field=${key}]`)?.value; return {choices,wbs:read('wbsCode'),name:read('name'),days:read('durationDays')}");
    assert(applied.choices.some(option => option.value === 'DEMO-RPT-STANDARD-1-1' && option.label.includes('OA订单启动')), JSON.stringify(applied));
    assert.equal(applied.wbs, '1.1');
    assert.match(applied.name, /OA订单启动/);
    assert.equal(applied.days, '3');
    await evaluate("for(const [key,value] of Object.entries({owner:'王项目',start:'2026-10-12',end:'2026-10-20'})){const x=document.querySelector(`[data-field=${key}]`);x.value=value;x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}));} return true");
    await click('保存');
    const saved = await evaluate(
      `const s=cspdState(); return s.sales.find(x=>x.id===${JSON.stringify(opportunityId)}).opportunityRoughPlans.at(-1)`,
    );
    assert.equal(saved.sourceType, '参考模板');
    assert.equal(saved.sourceTemplateId, 'DEMO-RPT-STANDARD');
    assert.equal(saved.sourceTemplateTaskId, 'DEMO-RPT-STANDARD-1-1');
    assert.match(saved.sourceReference, /项目交期计算模板（CIF） · 1\.1 OA订单启动/);
    return { sourceOptions, wbs: saved.wbsCode, task: saved.name, template: saved.sourceReference, templateId: saved.sourceTemplateId };
  });
  const routes = [
    '/',
    '/sales',
    '/sales/leads',
    '/sales/opportunities',
    '/sales/customers',
    '/sales/contacts',
    '/sales/solutions',
    '/sales/quotes',
    '/contracts',
    '/contracts/new',
    '/plans',
    '/plans/tracking',
    '/plans/logistics',
    '/plans/service',
    '/projects',
    '/control',
  ];
  const ids = await evaluate(
    "const s = cspdState(); return {sale:s.sales.find(x=>x.type==='opportunity')?.id,quote:s.quoteSeries?.[0]?.opportunityId,contract:s.contracts?.[0]?.id,project:s.projects[0]?.id}",
  );
  assert(ids.sale && ids.project && ids.contract && ids.quote, '缺少详情页验收样例');
  routes.push(
    '/sales/detail/' + ids.sale,
    '/sales/solutions/' + ids.sale,
    '/sales/quotes/' + ids.quote,
    '/contracts/' + ids.contract,
    '/projects/' + ids.project,
  );
  // 旧「项目总览」入口改版后保留为跳转，其余路径必须原地直达。
  const redirects = new Map([['/plans', { path: '/delivery-service', search: '?tab=overview' }]]);
  for (const route of routes)
    await step('页面直达 ' + route, async () => {
      await call('navigate_page', { type: 'url', url: base + route, timeout: 20000 });
      await ready();
      const target = redirects.get(route);
      assert.equal(
        await evaluate('return location.pathname'),
        target?.path || route,
        '路由被意外重定向',
      );
      if (target)
        assert.equal(
          await evaluate('return location.search'),
          target.search,
          '旧入口跳转后没有落到项目总览页签',
        );
      await checkPageErrors(route);
    });
  await step('窄屏页面可渲染并留存截图', async () => {
    await call('resize_page', { width: 390, height: 844 });
    await ready();
    await call('take_screenshot', { filePath: path.join(output, 'mobile.png'), fullPage: true });
    return await evaluate(
      'return {width:innerWidth,documentWidth:document.documentElement.scrollWidth}',
    );
  });
  report.result = '通过';
} catch (error) {
  report.error = error.message;
  console.error('FAIL', error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  try {
    await connection?.client.close();
  } catch (error) {
    report.cleanupError = error.message;
    report.result = '失败';
    process.exitCode = 1;
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      const force = setTimeout(() => server.kill('SIGKILL'), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(force);
      }
    }
  }
  await fs.writeFile(
    path.join(output, 'server.log'),
    serverLog || '使用 CSPD_BASE_URL 指定的现有服务\n',
  );
  await fs.writeFile(path.join(output, 'mcp.log'), connection?.diagnostics() || '');
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('结果：', report.result, '；证据：', output);
}
