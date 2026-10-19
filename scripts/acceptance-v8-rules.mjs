import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { root } from './browser-config.mjs';
const output = path.join(
  root,
  'artifacts',
  'v8-rules',
  new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid,
);
await fs.mkdir(output, { recursive: true });
// V8相关规则与公开Store边界；不冒充浏览器或全仓全量测试。
const tests = (await fs.readdir(path.join(root, 'tests')))
  .filter(
    (name) =>
      /^v8-.*\.test\.ts$/.test(name) ||
      ['contract-field-map.test.ts', 'contract-milestones.test.ts'].includes(name),
  )
  .sort()
  .map((name) => 'tests/' + name);
const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-reporter=tap', ...tests],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
);
let log = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (chunk) => (log += chunk.toString()));
const code = await new Promise((resolve) => {
  child.on('exit', resolve);
  child.on('error', () => resolve(null));
});
const checks = [...log.matchAll(/^(ok|not ok) \d+ - (.*)$/gm)].map((match) => ({
  name: match[2],
  result: match[1] === 'ok' ? '通过' : '失败',
}));
const report = {
  issue: 76,
  kind: '规则/公开Store专项重跑',
  tests,
  checks,
  result: code === 0 && checks.length > 0 ? '通过' : '失败',
  error: code === 0 ? null : log.slice(-12000),
};
await fs.writeFile(path.join(output, 'tap.txt'), log);
await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  '规则专项：',
  checks.filter((row) => row.result === '通过').length,
  '通过，',
  checks.filter((row) => row.result === '失败').length,
  '失败',
);
console.log('验收证据：', output);
if (report.result !== '通过') process.exitCode = 1;
