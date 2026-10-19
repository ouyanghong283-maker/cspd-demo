import assert from 'node:assert/strict';
import { connect, toolText } from './mcp-client.mjs';

const connection = await connect({ isolated: true });
try {
  const created = toolText(
    await connection.call('new_page', {
      url: `${process.env.CSPD_DEMO_URL || 'http://127.0.0.1:4200'}/projects/DEMO-P001?tab=plans&view=gantt`,
    }),
  );
  const pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  const call = (name, args) => connection.call(name, { pageId, ...args });
  const evaluate = async (body) => {
    const raw = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
    return JSON.parse(raw.match(/```json\s*([\s\S]*?)\s*```/)[1]);
  };
  const snapshot = () =>
    evaluate(`
    const store = ng.getComponent(document.querySelector('app-root')).store;
    return { date: store.observationDate(), rows: [...document.querySelectorAll('.gantt-row')].slice(1).map(row => ({
      text: row.innerText,
      color: row.querySelector('.gantt-range span') ? getComputedStyle(row.querySelector('.gantt-range span')).backgroundColor : null
    })) };
  `);
  const click = (text) =>
    evaluate(`
    const button = [...document.querySelectorAll('button')].find(button => button.textContent.includes(${JSON.stringify(text)}));
    if (!button || button.disabled) throw new Error('演示按钮不可用');
    button.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  `);
  await call('wait_for', { text: ['三色演示 10-22'], timeout: 45000 });
  const normal = await snapshot();
  assert.equal(normal.date, '2026-10-15');
  assert.ok(normal.rows.length >= 10);
  assert.ok(
    normal.rows.every((row) => ['rgb(117, 151, 231)', 'rgb(136, 188, 164)'].includes(row.color)),
  );
  await click('三色演示 10-22');
  const comparison = await snapshot();
  assert.equal(comparison.date, '2026-10-22');
  for (const color of ['rgb(117, 151, 231)', 'rgb(217, 164, 65)', 'rgb(208, 106, 106)']) {
    assert.ok(
      comparison.rows.some((row) => row.color === color),
      '甘特缺少颜色 ' + color,
    );
  }
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['三色演示 10-22'], timeout: 45000 });
  assert.deepEqual(await snapshot(), comparison, '刷新后应保留演示日期与三色');
  await click('基准日期 10-15');
  assert.deepEqual(await snapshot(), normal, '返回正常档后恢复原颜色');
  const original = await evaluate(
    `return structuredClone(ng.getComponent(document.querySelector('app-root')).store.project('DEMO-P001').plans);`,
  );
  await evaluate(`
    await ng.getComponent(document.querySelector('app-root')).router.navigateByUrl('/projects/DEMO-P001?tab=plans&view=gantt&plan=客户主节点');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  `);
  await click('三色演示 10-22');
  const customer = await snapshot();
  for (const color of ['rgb(117, 151, 231)', 'rgb(217, 164, 65)', 'rgb(208, 106, 106)']) {
    assert.ok(
      customer.rows.some((row) => row.color === color),
      '客户主节点缺少颜色 ' + color,
    );
  }
  const saved = await evaluate(
    `return structuredClone(ng.getComponent(document.querySelector('app-root')).store.project('DEMO-P001').plans);`,
  );
  assert.deepEqual(saved.slice(0, original.length), original, '三色演示应保留原计划');
  assert.equal(saved.length, original.length + 3, '客户主节点应补充3条模拟节点');
  await click('三色演示 10-22');
  assert.deepEqual(await snapshot(), customer, '重复点击不应增加样例');
  console.log('PASS 正常档蓝/绿 → 点击三色演示蓝/黄/红 → 刷新保留 → 返回正常档');
  console.log('PASS 客户主节点补充3个独立模拟节点，原计划保留，重复点击不增行');
  console.log(JSON.stringify({ normal: normal.date, comparison }, null, 2));
} finally {
  await connection.client.close();
  await connection.transport.close();
}
