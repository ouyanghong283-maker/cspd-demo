import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { base, root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const output = path.join(root, 'artifacts', 'sales-dashboard');
await fs.mkdir(output, { recursive: true });
const connection = await connect({ isolated: true });
const report = { result: '失败', checks: [] };
let pageId;
const call = (name, args = {}) => connection.call(name, { pageId, ...args });
const evaluate = async (body) => {
  const response = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const json = response.match(/```json\s*([\s\S]*?)\s*```/);
  assert(json, response);
  return JSON.parse(json[1]);
};
const view = "ng.getComponent(document.querySelector('.dashboard').parentElement)";
const settle = () =>
  evaluate('await document.fonts.ready; await new Promise(r=>setTimeout(r,120)); return true;');
const check = (name, evidence = {}) => {
  report.checks.push({ name, evidence });
  console.log('PASS', name);
};
const select = async (label, value) => {
  await evaluate(
    `const e=document.querySelector('select[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true;`,
  );
  await settle();
};
try {
  const created = toolText(
    await connection.call('new_page', { url: base + '/sales', timeout: 60000 }),
  );
  pageId = Number(created.match(/(\d+):.*\[selected\]/)[1]);
  await evaluate(
    "for(let n=0;n<100;n++){if(document.querySelector('.dashboard'))return true;await new Promise(r=>setTimeout(r,100));}throw Error('看板未加载');",
  );
  await settle();
  await evaluate("document.querySelector('.toast .icon-btn')?.click();return true;");
  const summary = await evaluate(
    `const v=${view};return {total:v.rows().length,live:v.live().length,amount:v.rawTotal(),forecast:v.forecastTotal(),bins:v.forecastPeriods(),weeks:v.activityWeeks(),counts:v.counts()};`,
  );
  assert.equal(
    summary.bins.reduce((sum, p) => sum + p.total, 0),
    summary.forecast,
  );
  assert.equal(
    summary.counts.reduce((sum, p) => sum + p.count, 0),
    summary.total,
  );
  assert.equal(summary.weeks.length, 6);
  assert.equal(
    await evaluate("return document.querySelectorAll('.metric-grid .metric').length;"),
    4,
  );
  check('四张指标卡、阶段合计与预测分期汇总一致', summary);

  await evaluate("document.querySelector('.forecast-column').focus();return true;");
  await call('press_key', { key: 'Enter' });
  await settle();
  assert.equal(
    await evaluate(`return ${view}.showForecast() && ${view}.forecastPeriod()===0;`),
    true,
  );
  assert.equal(
    await evaluate("return document.querySelectorAll('#forecast-details tbody tr').length;"),
    summary.bins[0].count || 1,
  );
  await evaluate("document.querySelector('#forecast-details .btn').click();return true;");
  check('键盘激活预测柱形，展开对应时段明细并可收起');

  await select('重点商机排序', 'followup');
  assert.equal(
    await evaluate(
      `const v=${view};return v.priorityRows().every((s,i,a)=>!i||v.store.days(a[i-1])>=v.store.days(s));`,
    ),
    true,
  );
  const drilldown = await evaluate(
    "return document.querySelector('.pipeline-row').getAttribute('href');",
  );
  assert(drilldown.includes('stage=') && drilldown.includes('currency=CNY'));
  check('最久未跟进排序生效，阶段链接保留当前筛选');

  await select('看板币种', 'EUR');
  assert.equal(
    await evaluate(
      `return ${view}.rows().every(s=>s.currency==='EUR') && ${view}.cold().every(s=>s.currency==='EUR');`,
    ),
    true,
  );
  await select('看板国家筛选', '德国');
  assert.equal(
    await evaluate(`const v=${view};return v.cold().every(s=>v.rows().some(r=>r.id===s.id));`),
    true,
  );
  check('币种与国家筛选同时作用于指标、图表和跟进提醒');
  await select('看板币种', 'CNY');
  await evaluate(
    `const v=${view};v.resetFilters();v.query.set('不存在的商机验收查询');return true;`,
  );
  await settle();
  assert.equal(await evaluate(`return ${view}.rows().length;`), 0);
  assert.equal(
    await evaluate(
      "return document.querySelector('.opportunity-table .empty').innerText.includes('没有找到');",
    ),
    true,
  );
  for (const width of [390, 360]) {
    await call('resize_page', { width, height: 900 });
    await settle();
    assert.equal(
      await evaluate('return document.documentElement.scrollWidth<=innerWidth;'),
      true,
      `空数据在${width}溢出`,
    );
  }
  check('空数据有重置入口，零值与暂无赢单率在手机端正常显示');

  await evaluate(`const v=${view};v.resetFilters();v.sort.set('amount');return true;`);
  await settle();
  for (const width of [1440, 1280, 1024, 768, 390, 360]) {
    await call('resize_page', { width, height: 1000 });
    await settle();
    const geometry = await evaluate(
      "return {width:innerWidth,scroll:document.documentElement.scrollWidth,chart:document.querySelector('.forecast-plot').getBoundingClientRect().width,tableScroll:document.querySelector('.opportunities-panel .table-wrap').scrollWidth};",
    );
    assert(geometry.scroll <= width, JSON.stringify(geometry));
    assert(geometry.chart > 180, JSON.stringify(geometry));
    if (width === 1440 || width === 390) {
      await call('take_screenshot', {
        filePath: path.join(output, `dashboard-${width}.png`),
        fullPage: true,
      });
    }
  }
  check('1440 / 1280 / 1024 / 768 / 390 / 360 六档宽度无页面横向溢出，表格独立滚动');

  await call('resize_page', { width: 1440, height: 1000 });
  const snapshot = toolText(await call('take_snapshot'));
  const communication = snapshot.split('\n').find((line) => line.includes('button "8 次"'));
  assert(communication, '未找到销售团队沟通明细入口');
  if (communication) {
    await call('click', { uid: communication.match(/uid=(\S+)/)[1] });
    await settle();
    assert.equal(
      await evaluate("return document.body.innerText.includes('张销售的有效沟通明细');"),
      true,
    );
  }
  check('团队沟通明细仍可打开');

  const boundaries =
    await evaluate(`const v=${view}; const original=v.store.state();const seed=original.sales.find(s=>s.type==='opportunity');
    const fixtures=[
      ['start','2026-10-10',100,'意向沟通',''],['next','2026-11-10',200,'意向沟通',''],
      ['third','2026-12-10',300,'意向沟通',''],['last','2027-01-09',400,'意向沟通',''],
      ['end','2027-01-10',800,'意向沟通',''],['lost','2026-10-15',1600,'丢单',''],
      ['income','2026-10-12',500,'赢单','2026-11-11'],['no-date','',3200,'意向沟通','']
    ].map(([id,expectedDate,amount,stage,incomeDate])=>({...seed,id,expectedDate,amount,stage,incomeDate,currency:'CNY'}));
    v.store.state.set({...original,sales:fixtures});
    const result={total:v.forecastTotal(),periods:v.forecastPeriods().map(p=>({expected:p.expected,income:p.income,total:p.total})),ids:v.forecastRows().map(s=>s.id)};
    v.store.state.set(original);return result;`);
  assert.deepEqual(boundaries.periods, [
    { expected: 100, income: 0, total: 100 },
    { expected: 200, income: 500, total: 700 },
    { expected: 700, income: 0, total: 700 },
  ]);
  assert.equal(boundaries.total, 1500);
  assert(
    !boundaries.ids.includes('end') &&
      !boundaries.ids.includes('lost') &&
      !boundaries.ids.includes('no-date'),
  );
  check('预测日期边界、跨年、丢单排除及赢单确收日期口径正确', boundaries);

  const communicationBounds =
    await evaluate(`const v=${view}; const original=v.store.state(); const sale=v.rows()[0];
    const seed=original.activities[0];
    const dates=['2026-08-29','2026-08-30','2026-09-05','2026-09-06','2026-10-10','2026-10-11'];
    const activities=dates.map((date,i)=>({...seed,id:'trend-'+i,entityId:sale.id,type:'电话',date}));
    activities.push({...seed,id:'internal',entityId:sale.id,type:'内部备注',date:'2026-10-10'});
    activities.push({...seed,id:'unrelated',entityId:'unrelated',type:'电话',date:'2026-10-10'});
    v.store.state.set({...original,activities});const result=v.activityWeeks().map(w=>w.count);v.store.state.set(original);return result;`);
  assert.deepEqual(communicationBounds, [2, 1, 0, 0, 0, 1]);
  check('六周趋势按七天分组，排除未来、窗外、内部备注及无关记录', communicationBounds);

  const consoleErrors = toolText(await call('list_console_messages', { types: ['error'] }));
  assert(consoleErrors.includes('no console messages found'), consoleErrors);
  report.result = '通过';
  check('浏览器控制台无错误');
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2));
  await connection.client.close();
  await connection.transport.close();
}
