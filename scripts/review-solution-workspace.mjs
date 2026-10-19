import fs from 'node:fs/promises';
import path from 'node:path';
import { base, root } from './browser-config.mjs';
import { connect, toolText } from './mcp-client.mjs';

const name = process.argv[2] || 'before';
const output = path.join(root, 'artifacts', 'solution-workspace-design');
await fs.mkdir(output, { recursive: true });
const connection = await connect({ isolated: true });
const created = toolText(
  await connection.call('new_page', { url: base + '/sales/solutions/DEMO-O001' }),
);
const pageId = Number(created.match(/(\d+):.*\[selected\]/)?.[1]);
if (!Number.isFinite(pageId)) throw new Error(created);
const call = (n, args = {}) => connection.call(n, { pageId, ...args });
const evaluate = async (body) => {
  const result = toolText(await call('evaluate_script', { function: `async () => {${body}}` }));
  const json = result.match(/```json\s*([\s\S]*?)\s*```/);
  if (!json) throw new Error(result);
  return JSON.parse(json[1]);
};
await evaluate(
  `for(let n=0;n<150;n++){if(document.querySelector('.solution-workspace'))return true;await new Promise(r=>setTimeout(r,100));}return false;`,
);
await evaluate('await new Promise(r=>setTimeout(r,400));return true;');
await call('take_screenshot', { filePath: path.join(output, name + '.png'), fullPage: true });
await call('resize_page', { width: 640, height: 900 });
await evaluate('await new Promise(r=>setTimeout(r,300));return true;');
await call('take_screenshot', {
  filePath: path.join(output, name + '-mobile.png'),
  fullPage: true,
});
console.log('screenshots at', output);
await connection.client.close().catch(() => {});
await connection.transport.close().catch(() => {});
