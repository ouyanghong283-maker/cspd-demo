import { connect, toolText, root } from './mcp-client.mjs';
import fs from 'node:fs/promises';
import { base } from './browser-config.mjs';
const { client, call } = await connect();
let pageId;
const result = { date: new Date().toISOString(), result: '失败' };
const tool = (name, args = {}) => call(name, { pageId, ...args });
async function ev(body) {
  const text = toolText(await tool('evaluate_script', { function: `()=>{${body}}` }));
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw Error(text);
  return JSON.parse(match[1]);
}
async function click(text) {
  const snapshot = toolText(await tool('take_snapshot'));
  const row = snapshot
    .split('\n')
    .find((line) => line.includes('button ' + JSON.stringify(text)) && !line.includes('disabled'));
  if (!row) throw Error('缺少可点击按钮：' + text);
  await tool('click', { uid: row.match(/uid=(\S+)/)[1] });
}
function assert(value, message) {
  if (!value) throw Error(message);
}
try {
  const page = toolText(await call('new_page', { url: base + '/control' }));
  pageId = Number(page.match(/(\d+):.*\[selected\]/)[1]);
  await tool('wait_for', { text: ['CSPD 项目全链条协同平台'] });
  const id = await ev(
    `const s=ng.getComponent(document.querySelector('app-root')).store;s.setRole('sales');if(!s.has('DEMO-L001','需求导入表'))s.simulateDocument('DEMO-L001','需求导入表','需求.xlsx');const id=s.convert('DEMO-L001');s.saveSales({...s.sale(id),description:'客户储能需求已确认',capacity:10,amount:120000,expectedDate:'2026-11-15',grade:'A',tender:'否'});return id;`,
  );
  result.opportunityId = id;
  await tool('navigate_page', {
    url: base + '/sales/detail/' + id + '?guide=mainline&tab=' + encodeURIComponent('沟通'),
    type: 'url',
  });
  await tool('wait_for', { text: ['新增沟通记录'] });
  await click('新增沟通记录');
  await click('填入演示内容');
  await click('保存');
  await tool('wait_for', { text: ['意向沟通已就绪，下一步准备方案报价'] });
  await click('进入方案报价');
  await tool('wait_for', { text: ['下一步：由解决方案补充核心技术方案'] });
  assert(
    await ev(
      `return ng.getComponent(document.querySelector('app-root')).store.sale('${id}').stage==='方案报价';`,
    ),
    '点击指引未进入下一阶段',
  );
  await click('切换解决方案并补方案');
  await tool('wait_for', { text: ['模拟上传首版'] });
  await click('模拟上传首版');
  await click('保存');
  assert(
    await ev(
      `return !!ng.getComponent(document.querySelector('app-root')).store.solution('${id}')?.latestVersionId;`,
    ),
    '核心技术方案演示版本未生成',
  );
  await fs.mkdir(root + '/artifacts', { recursive: true });
  await tool('take_screenshot', {
    filePath: root + '/artifacts/intent-guide-fixed.png',
    fullPage: true,
  });
  result.result = '通过';
  result.checks = ['客户沟通表单保存', '指引进入方案报价', '方案角色交接', '核心技术方案模拟首版'];
  console.log('PASS', result.checks.join(' → '));
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
  console.log('FAIL', error.message);
} finally {
  await fs.mkdir(root + '/artifacts', { recursive: true });
  await fs.writeFile(
    root + '/artifacts/intent-guide-results.json',
    JSON.stringify(result, null, 2),
  );
  await client.close();
}
