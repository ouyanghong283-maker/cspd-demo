import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { root } from './browser-config.mjs';
export { root } from './browser-config.mjs';
export async function connect({ isolated = false, prefersReducedMotion = false } = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(root, 'node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'),
      '--headless',
      `--executablePath=${process.env.CHROME_PATH || path.join(root, '.browser/chrome-linux64/chrome')}`,
      ...(isolated
        ? ['--isolated']
        : [`--userDataDir=${process.env.CSPD_MCP_PROFILE || path.join(root, '.mcp-profile')}`]),
      '--chromeArg=--no-sandbox',
      '--chromeArg=--disable-dev-shm-usage',
      ...(prefersReducedMotion ? ['--chromeArg=--force-prefers-reduced-motion=reduce'] : []),
      '--no-usage-statistics',
      '--viewport=1440x1000',
    ],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: [
        path.join(root, '.browser/libs/usr/lib/x86_64-linux-gnu'),
        process.env.LD_LIBRARY_PATH,
      ]
        .filter(Boolean)
        .join(path.delimiter),
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
  // Drain stderr so a long run cannot block the MCP subprocess on a full pipe.
  let diagnostics = '';
  transport.stderr?.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-8000);
  });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close();
    throw error;
  }
  return {
    client,
    transport,
    call: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        // 共享机器上其他构建会拖慢单次调用；默认不变，可用环境变量放宽等待上限。
        timeout: Number(process.env.CSPD_MCP_CALL_TIMEOUT_MS || 60000),
      });
      if (result.isError) throw new Error(toolText(result));
      return result;
    },
    diagnostics: () => diagnostics,
  };
}
export function toolText(result) {
  return result.content
    .filter((x) => x.type === 'text')
    .map((x) => x.text)
    .join('\n');
}
