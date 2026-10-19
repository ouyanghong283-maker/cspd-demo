import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const base = process.env.CSPD_BASE_URL || 'http://127.0.0.1:4317';
const out = path.resolve(root, process.env.CSPD_ARTIFACT_DIR || 'artifacts/v9-b07-codex');
const evidence = path.resolve(root, process.env.CSPD_EVIDENCE_DIR || '../docs/verification/v9-b07-codex');
await fs.mkdir(out, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
const c = await connect({
  isolated: true,
  prefersReducedMotion: process.env.CSPD_EXPECT_REDUCED === '1',
});
let pageId;
const checks = [];
const call = (name, args = {}) => c.call(name, { pageId, ...args });
const run = async (body) => {
  const raw = toolText(await call('evaluate_script', { function: `async()=>{${body}}` }));
  return JSON.parse(raw.match(/```json\s*([\s\S]*?)\s*```/)[1]);
};
const record = (name, data) => {
  checks.push({ name, ...data });
  console.log('PASS ' + name);
};
try {
  const opened = toolText(await c.call('new_page', { url: base + '/projects/board' }));
  pageId = Number(opened.match(/(\d+):.*\[selected\]/)[1]);
  await call('wait_for', { text: ['重点 TOP5'], timeout: 30000 });
  assert.equal(
    await run(`return !!document.querySelector('[aria-label="减弱看板动效"]');`),
    true,
    '缺少页面动效开关',
  );

  const board = "ng.getComponent(document.querySelector('app-project-board'))";
  const fingerprint = () =>
    run(
      `const b=${board};return {state:JSON.stringify(b.store.state()),ids:b.businessIds(),budget:b.chartBudgets(),items:b.statistics().items};`,
    );
  const baseline = await fingerprint();
  const active = () =>
    run(
      `const e=document.activeElement;return {tag:e?.tagName,text:e?.textContent?.trim().slice(0,100),label:e?.getAttribute('aria-label'),href:e?.getAttribute('href'),focusKey:e?.getAttribute('data-board-focus'),outline:getComputedStyle(e).outlineStyle};`,
    );
  const key = async (value) => {
    const before = await active();
    await call('press_key', { key: value });
    record('真实按键 ' + value, { before, after: await active() });
  };
  // 每个独立操作段只定位一次起点，后续全部使用浏览器真实按键并记录焦点。
  const focus = (selector) =>
    run(
      `const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');e.focus();return document.activeElement===e;`,
    );
  await focus('.board-filters select');
  await key('ArrowDown');
  assert.equal(await run(`return ${board}.filters().partition;`), 'presales');
  await key('Tab'); // 等级
  await key('ArrowDown');
  assert.deepEqual(await run(`return ${board}.filters().grades;`), ['S']);
  await key('Tab'); // 关键字
  await key('Tab'); // 仅异常
  await key('Tab'); // 原生高级筛选
  assert.equal((await active()).tag, 'SUMMARY');
  await key('Space');
  assert.equal(await run(`return document.querySelector('.advanced-filters').open;`), true);
  await key('Tab');
  assert.equal((await active()).tag, 'SELECT');
  await key('Shift+Tab');
  await key('Enter');
  assert.equal(await run(`return document.querySelector('.advanced-filters').open;`), false);
  await key('Tab');
  assert.match((await active()).text, /清除全部筛选/);
  await key('Tab'); // 分区条件
  await key('Enter');
  assert.equal(
    await run(
      `return document.activeElement.closest('.board-filters')!==null || document.activeElement.classList.contains('filter-chip');`,
    ),
    true,
  );
  // 最后一个条件移除后回到筛选入口。
  await focus('.filter-chip');
  await key('Enter');
  assert.equal(
    await run(`return document.activeElement===document.querySelector('.board-filters select');`),
    true,
  );
  assert.deepEqual(await run(`return ${board}.businessIds();`), baseline.ids);
  await focus('app-management-board-charts tbody tr:nth-child(3) button:last-child');
  await key('Enter');
  assert.deepEqual(await run(`return ${board}.filters().departments;`), ['pm-pmo']);
  await focus('.filter-chip');
  await key('Space');
  assert.deepEqual(await run(`return ${board}.businessIds();`), baseline.ids);
  await focus('.collaboration-details > summary');
  await key('Space');
  assert.equal(await run(`return document.querySelector('.collaboration-details').open;`), true);
  await key('Enter');
  await key('Tab');
  assert.equal(
    await run(`return !!document.activeElement.closest('.collaboration-details > summary');`),
    false,
  );
  assert.equal(await run(`return !!document.activeElement.closest('.group-items');`), false);
  record('协作原生展开收起，隐藏内容不在键盘序列', {});
  // 页面减弱动效开关不改变业务数据与筛选，刷新后保留。
  await focus('[aria-label="减弱看板动效"]');
  await key('Space');
  assert.equal(
    await run(
      `return document.querySelector('[aria-label="减弱看板动效"]').getAttribute('aria-pressed');`,
    ),
    'true',
  );
  const motion = await run(
    `const r=document.querySelector('.management-overview');const s=getComputedStyle(r, '::before');return {animation:s.animationName,background:s.backgroundImage,system:matchMedia('(prefers-reduced-motion: reduce)').matches};`,
  );
  assert.equal(motion.animation, 'none');
  assert.match(motion.background, /linear-gradient/);
  assert.deepEqual(await fingerprint(), baseline);
  await call('navigate_page', { type: 'reload' });
  await call('wait_for', { text: ['重点 TOP5'], timeout: 30000 });
  assert.equal(
    await run(
      `return document.querySelector('[aria-label="减弱看板动效"]').getAttribute('aria-pressed');`,
    ),
    'true',
  );
  await focus('[aria-label="减弱看板动效"]');
  await key('Enter');
  const system = await run(
    `return {reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:getComputedStyle(document.querySelector('.management-overview'), '::before').animationName};`,
  );
  assert.equal(system.reduced, process.env.CSPD_EXPECT_REDUCED === '1');
  if (system.reduced) assert.equal(system.animation, 'none');
  else {
    assert.match(system.animation, /board-background$/);
    assert.equal(
      await run(
        `return document.querySelector('.management-overview').getAnimations({subtree:true}).some(a=>a.animationName?.endsWith('board-background')&&a.playState==='running');`,
      ),
      true,
    );
  }
  record('页面开关持久化，系统偏好优先，业务结果不变', { motion, system });
  // 真实键盘来源往返：同一业务链接、焦点、筛选均恢复。
  await focus('[data-business-id="DEMO-O008"] a:nth-child(3)');
  const source = await active();
  assert.match(source.href, /solutions/);
  await key('Enter');
  await call('wait_for', { text: ['真实方案文件与首次期限'], timeout: 30000 });
  const returned = await run(
    `const a=[...document.querySelectorAll('a')].find(a=>a.textContent.includes('返回高层项目总览'));if(!a)throw Error('Missing return');a.focus();return a.getAttribute('href');`,
  );
  assert.match(returned, /projects\/board/);
  await key('Enter');
  await call('wait_for', { text: ['重点 TOP5'], timeout: 30000 });
  assert.equal((await active()).href, source.href);
  assert.equal((await active()).focusKey, source.focusKey);
  assert.deepEqual(await fingerprint(), baseline);
  record('键盘来源返回恢复焦点、身份、筛选和业务状态', { source, returned });
  const duplicate = await run(
    `const links=[...document.querySelectorAll('.board-page a[href]')];const a=links.find(a=>a.dataset.boardFocus?.startsWith('source:')&&links.filter(x=>x.getAttribute('href')===a.getAttribute('href')).length>1);if(!a)throw Error('Expected duplicate source');a.focus();return {key:a.dataset.boardFocus,href:a.getAttribute('href')};`,
  );
  await key('Enter');
  await call('wait_for', { text: ['返回高层项目总览'], timeout: 30000 });
  await run(
    `[...document.querySelectorAll('a,button')].find(a=>a.textContent.trim()==='返回高层项目总览').focus();return true;`,
  );
  await key('Enter');
  await call('wait_for', { text: ['重点 TOP5'], timeout: 30000 });
  assert.equal((await active()).focusKey, duplicate.key);
  record('相同网址的多个入口返回原业务清单控件', duplicate);
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await call('resize_page', { width, height: 1000 });
    await focus('[aria-label="减弱看板动效"]');
    await key('Space');
    const reading = await run(
      `const b=${board};return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,ids:b.businessIds(),animation:getComputedStyle(document.querySelector('.management-overview'), '::before').animationName,focus:getComputedStyle(document.activeElement).outlineStyle};`,
    );
    assert.equal(reading.overflow, false);
    assert.equal(reading.animation, 'none');
    assert.equal(reading.focus, 'solid');
    assert.deepEqual(reading.ids, baseline.ids);
    await call('take_screenshot', {
      filePath: path.join(
        out,
        `keyboard-${process.env.CSPD_EXPECT_REDUCED === '1' ? 'system' : 'page'}-${width}.png`,
      ),
      fullPage: false,
    });
    record('五宽静态阅读与焦点', reading);
    await key('Space');
  }
  await fs.writeFile(
    path.join(
      evidence,
      process.env.CSPD_EXPECT_REDUCED === '1' ? 'system-results.json' : 'keyboard-results.json',
    ),
    JSON.stringify({ result: 'passed', checks }, null, 2),
  );
} catch (error) {
  await fs.writeFile(
    path.join(evidence, 'keyboard-failure.json'),
    JSON.stringify({ error: String(error), checks }, null, 2),
  );
  throw error;
} finally {
  await c.client.close();
}
