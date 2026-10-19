import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, toolText, root } from './mcp-client.mjs';
const output = path.join(root, 'artifacts/v9-b02-c2');
await fs.mkdir(output, { recursive: true });
const connection = await connect({ isolated: true });
const checks = [];
try {
  const created = toolText(
    await connection.call('new_page', { url: 'http://127.0.0.1:4312/projects/board' }),
  );
  const pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
  await connection.call('wait_for', { pageId, text: ['高层项目总览'], timeout: 30000 });
  for (const width of [1920, 1440, 1024, 768, 390]) {
    await connection.call('resize_page', { pageId, width, height: 1000 });
    const raw = toolText(
      await connection.call('evaluate_script', {
        pageId,
        function: `() => {
      const main=document.querySelector('main.board-page');
      const section=document.querySelector('.management-overview');
      return {width:innerWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth,overflow:main.getBoundingClientRect().right>innerWidth+1||main.scrollWidth>main.clientWidth,heading:section?.querySelector('h1')?.textContent,summary:section?.querySelector('.v9-summary')?.textContent,hasOriginalBoard:main?.innerText.includes('共享项目看板'),pending:section?.innerText.includes('来源待补'),foreground:getComputedStyle(section).color,background:getComputedStyle(section).backgroundColor};
    }`,
      }),
    );
    const data = JSON.parse(raw.match(/```json\s*([\s\S]*?)\s*```/)[1]);
    if (data.overflow)
      console.log(
        'OVERFLOW',
        width,
        toolText(
          await connection.call('evaluate_script', {
            pageId,
            function: `() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0,20).map(e => ({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))`,
          }),
        ),
      );
    assert.equal(data.overflow, false, `宽度${width}横向溢出`);
    assert.equal(data.hasOriginalBoard, true);
    assert.equal(data.pending, true);
    checks.push(data);
    await connection.call('take_screenshot', {
      pageId,
      filePath: path.join(output, `board-${width}.png`),
      fullPage: false,
    });
  }
  await fs.writeFile(
    path.join(output, 'browser-report.json'),
    JSON.stringify({ result: '通过', checks }, null, 2),
  );
  console.log(JSON.stringify(checks));
} finally {
  await connection.client.close();
}
