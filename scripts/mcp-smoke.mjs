import { base } from './browser-config.mjs';
import { connect, toolText, root } from './mcp-client.mjs';
import fs from 'node:fs/promises';
const { client, call } = await connect();
try {
  const tools = await client.listTools();
  console.log('MCP tools:', tools.tools.map((t) => t.name).join(', '));
  await fs.writeFile(root + '/artifacts/mcp-tools.json', JSON.stringify(tools, null, 2));
  const page = toolText(await call('new_page', { url: base + '/', timeout: 30000 }));
  const pageId = Number(page.match(/(\d+):.*\[selected\]/)[1]);
  console.log(page);
  console.log(toolText(await call('take_snapshot', { pageId })));
  console.log(
    toolText(
      await call('take_screenshot', {
        pageId,
        filePath: root + '/artifacts/workspace-desktop.png',
        fullPage: true,
      }),
    ),
  );
  console.log(toolText(await call('list_console_messages', { pageId, types: ['error', 'warn'] })));
} finally {
  await client.close();
}
