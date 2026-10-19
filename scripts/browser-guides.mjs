import { connect, toolText, root } from './mcp-client.mjs';
import fs from 'node:fs/promises';
import { base } from './browser-config.mjs';
const { client, call: raw } = await connect();
let pageId;
const results = [];
const call = (name, args = {}) => raw(name, { pageId, ...args });
async function ev(code) {
  const s = toolText(await call('evaluate_script', { function: `()=>{${code}}` }));
  const m = s.match(/```json\s*([\s\S]*?)\s*```/);
  return m ? JSON.parse(m[1]) : s;
}
async function click(name, index = 0) {
  const s = toolText(await call('take_snapshot'));
  const line = s
    .split('\n')
    .filter((x) => x.includes('button ' + JSON.stringify(name)) && !x.includes('disabled'))[index];
  if (!line) throw Error('按钮不存在:' + name);
  await call('click', { uid: line.match(/uid=(\S+)/)[1] });
}
async function nav(url) {
  await call('navigate_page', { type: 'url', url: base + url });
}
const expect = (v, m) => {
  if (!v) throw Error(m);
};
try {
  const s = toolText(await raw('new_page', { url: base + '/control' }));
  pageId = Number(s.match(/(\d+):.*\[selected\]/)[1]);
  const text = await fs.readFile(root + '/src/app/core/guide.ts', 'utf8');
  const guides = [
    ...text.matchAll(
      /id: '(\w+)'[\s\S]*?role: '(\w+)'[\s\S]*?url: '([^']+)'[\s\S]*?tab: '([^']*)'/g,
    ),
  ];
  for (let i = 0; i < guides.length; i++) {
    await nav('/control');
    await click('去练习', i);
    const data = await ev(
      "return {path:location.pathname,role:JSON.parse(localStorage.getItem('cspd-demo-v2')).role,select:document.querySelector('.role-select').value,title:document.querySelector('main h1')?.innerText,tab:document.querySelector('.tabs .active')?.textContent.trim(),plan:document.querySelector('.type-tabs .active')?.textContent.trim()}",
    );
    expect(
      data.path === (guides[i][1] === 'U01' ? '/sales/detail/DEMO-L001' : guides[i][3]) &&
        data.role === guides[i][2] &&
        data.select === data.role &&
        data.title,
      '路径或角色不一致:' + JSON.stringify(data),
    );
    if (guides[i][4] && data.role !== 'outsider')
      expect(data.tab === guides[i][4], '详情标签未跳转');
    const plans = {
      P08: '客户主节点',
      P09: '产研来源',
      P10: '要货发货',
      P11: 'FAT测试',
      P12: '开票回款',
    };
    if (plans[guides[i][1]]) expect(data.plan === plans[guides[i][1]], '计划类型未跳转');
    results.push({ id: guides[i][1], result: '通过', ...data });
    console.log('PASS', guides[i][1], data.path);
  }
  expect(results.length === 34, '路径数量错误');
  await nav('/sales/customers');
  await ev(
    "const e=document.querySelector('.role-select');e.value='sales';e.dispatchEvent(new Event('change',{bubbles:true}));return true",
  );
  const customerName = await ev(
    "const s=JSON.parse(localStorage.getItem('cspd-demo-v2'));return s.customers.find(c=>c.id===s.projects.find(p=>p.id==='DEMO-P001').customerId).name",
  );
  await click('编辑' + customerName);
  await ev(
    "const e=document.querySelector('[data-field=shortName]');e.value='共享资料验证';e.dispatchEvent(new Event('input',{bubbles:true}));return true",
  );
  await click('保存');
  await nav('/sales/detail/DEMO-O005');
  expect(
    await ev(
      `return document.querySelector('main').innerText.includes(${JSON.stringify(customerName)})`,
    ),
    '客户未引用',
  );
  await nav('/projects/DEMO-P001');
  expect(
    await ev("return document.querySelector('main').innerText.includes('共享资料验证')"),
    '项目未同步客户简称',
  );
  console.log('PASS 客户主数据跨页面同步');
  await nav('/sales/detail/DEMO-L001?tab=' + encodeURIComponent('资料'));
  expect(
    !(await ev("return !!document.querySelector('input[type=file]')")),
    'V4不应显示真实上传入口',
  );
  results.push({ name: 'V4模拟资料边界', result: '通过' });
  await nav('/control');
  await click('重置演示数据');
  await call('handle_dialog', { action: 'accept' });
  await nav('/');
  await call('take_screenshot', {
    filePath: root + '/artifacts/workspace-desktop.png',
    fullPage: true,
  });
  const consoleLog = toolText(await call('list_console_messages', { types: ['error'] }));
  expect(consoleLog.includes('no console messages found'), '控制台错误');
  await fs.writeFile(
    root + '/artifacts/guide-results.json',
    JSON.stringify(
      {
        tool: 'Chrome DevTools MCP',
        results,
        checks: [
          '客户主数据跨页面同步',
          'V4模拟资料入口，无真实文件选择',
          '全部路径跳转及刷新角色显示',
          '恢复初始样例',
        ],
        consoleErrors: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
