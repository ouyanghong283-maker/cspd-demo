import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './browser-config.mjs';

// 本票只编排与留证；不修复业务，不把脚本存在或过去的通过记录当成本次结果。
import { manifest } from './v8-acceptance-manifest.mjs';

const selected = new Set(
  process.argv
    .find((arg) => arg.startsWith('--only='))
    ?.slice(7)
    .split(',') || manifest.map((row) => row[0]),
);
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.join(root, 'artifacts', 'v8-suite', runId);
await fs.mkdir(output, { recursive: true });
const report = {
  issue: 76,
  runAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  checks: [],
  result: '未执行',
};
let server,
  serverLog = '',
  serverFailure;
const runChild = async (args, env) => {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env, CSPD_MCP_CALL_TIMEOUT_MS: '90000', NG_BUILD_MAX_WORKERS: '2' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '',
    failure;
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      log += text;
      process.stdout.write(text);
    });
  child.on('error', (error) => (failure = error.message));
  const timer = setTimeout(() => {
    failure = '执行超时（360秒），该场景没有通过';
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }, 360000);
  const code = await new Promise((resolve) => {
    child.on('exit', resolve);
    child.on('error', () => resolve(null));
  });
  clearTimeout(timer);
  return { code, log, error: failure };
};
const latestEvidence = async (bucket, since) => {
  const base = path.join(root, 'artifacts', bucket);
  let files = [];
  try {
    files = (await fs.readdir(base, { recursive: true })).filter((name) =>
      /(report|results)\.json$/.test(name),
    );
  } catch {
    return null;
  }
  const candidates = [];
  for (const file of files) {
    const full = path.join(base, file);
    const stat = await fs.stat(full);
    if (stat.mtimeMs >= since) candidates.push({ full, mtime: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.full || null;
};
let baseUrl;
const stopShared = async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(3000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  server = undefined;
  baseUrl = undefined;
};
const startShared = async () => {
  if (server) return;
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  report.baseUrl = baseUrl;
  server = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/@angular/cli/bin/ng.js'),
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--watch=false',
      '--live-reload=false',
      '--hmr=false',
    ],
    {
      cwd: root,
      env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false', NG_BUILD_MAX_WORKERS: '2' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (const stream of [server.stdout, server.stderr])
    stream.on('data', (chunk) => (serverLog += chunk.toString()));
  server.on('error', (error) => (serverFailure = error.message));
  let running = false;
  for (let n = 0; n < 400; n++) {
    if (serverFailure) throw Error(serverFailure);
    try {
      if ((await fetch(baseUrl)).ok) {
        running = true;
        break;
      }
    } catch {}
    await delay(300);
  }
  if (!running) throw Error('联合验收共用服务启动失败');
};
try {
  for (const [name, script, bucket, ids] of manifest) {
    if (!selected.has(name)) {
      report.checks.push({ name, ids, result: '未执行', reason: '本次筛选未运行' });
      continue;
    }
    // 自带服务脚本不能与共享ng serve同时构建同一工作区，避免资源竞争与缓存锁。
    if (['delivery', 'contract-fields', 'milestones'].includes(name)) await startShared();
    else await stopShared();
    console.log(`开始 ${name}：${script}`);
    const since = Date.now();
    const child = await runChild([path.join(root, 'scripts', script)], {
      ...(baseUrl ? { CSPD_BASE_URL: baseUrl } : {}),
    });
    const evidence = await latestEvidence(bucket, since);
    const actual = evidence ? JSON.parse(await fs.readFile(evidence, 'utf8')) : null;
    const row = {
      name,
      ids,
      kind: name === 'joint' ? '联合实测' : name === 'rules' ? '规则专项实际重跑' : '单票实际重跑',
      command: `node scripts/${script}`,
      input: '独立临时浏览器/工作区内脚本显式样例；详见源码和actual各检查',
      operation: script,
      expected: '脚本全部断言通过，失败不产生单边业务结果',
      result: child.code === 0 && actual?.result === '通过' ? '通过' : '失败',
      evidence: evidence ? path.relative(root, evidence) : null,
      actual,
      error: child.error || actual?.error || null,
    };
    report.checks.push(row);
    await fs.writeFile(path.join(output, name + '.log'), child.log);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log(`结束 ${name}：${row.result}`);
  }
  report.result = report.checks.some((row) => row.result === '失败')
    ? '失败'
    : report.checks.every((row) => row.result === '通过')
      ? '通过'
      : '未执行';
  if (report.result === '失败') process.exitCode = 1;
} catch (error) {
  report.error = error.message;
  report.result = '失败';
  report.serverLog = serverLog.slice(-10000);
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(3000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('联合验收汇总：', output);
}
