import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(root, 'node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'),
      '--headless',
      `--executablePath=${process.env.CHROME_PATH || path.join(root, '.browser/chrome-linux64/chrome')}`,
      `--userDataDir=${process.env.CSPD_MCP_PROFILE || path.join(root, '.mcp-profile')}`,
      '--chromeArg=--no-sandbox',
      '--chromeArg=--disable-dev-shm-usage',
      '--no-usage-statistics',
      '--viewport=1440x1000',
    ],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: path.join(root, '.browser/libs/usr/lib/x86_64-linux-gnu'),
    },
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'cspd-demo-browser-verification', version: '1.0.0' },
    { capabilities: { roots: { listChanged: true } } },
  );
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: [{ uri: pathToFileURL(root).href, name: 'CSPD demo' }],
  }));
  await client.connect(transport);
  return {
    client,
    transport,
    call: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: 60000,
      });
      if (result.isError) throw new Error(JSON.stringify(result));
      return result;
    },
  };
}
export function toolText(result) {
  return result.content
    .filter((x) => x.type === 'text')
    .map((x) => x.text)
    .join('\n');
}
