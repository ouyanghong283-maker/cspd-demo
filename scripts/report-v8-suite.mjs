import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from './browser-config.mjs';
import { manifest } from './v8-acceptance-manifest.mjs';
import { execFileSync } from 'node:child_process';
const file = process.argv[2];
if (!file) throw Error('用法：node scripts/report-v8-suite.mjs <本次v8-suite/results.json>');
const suite =
  file === '--draft'
    ? {
        issue: 76,
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
        runAt: new Date().toISOString(),
        result: '未执行',
        checks: manifest.map(([name, script, bucket, ids]) => ({
          name,
          ids,
          result: '未执行',
          command: `node scripts/${script}`,
          reason: '等待#75迁移集成后的最终源码验证',
        })),
        preflight: [
          '规则/公开Store专项试跑197/197通过（dd14ca2，未含#75）；不是全仓全量。',
          '旧联合草稿6个场景通过、交付路径定位失败；已适配正式?projectId路径，待最终复跑。',
          '导航重跑在7项通过后，旧启动路径断言与已接受?tab=startup容器不符；仅更新验收断言，待最终复跑。',
          '首轮编排构建阶段超时，已改为自带服务与共用服务不并发构建，并限制构建worker；该轮未进入业务的场景不计通过。',
        ],
      }
    : JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
const matrixSource = path.join(root, '../doc/PRD/DEMO PRD/V8PRD/10_验收矩阵与演示脚本.md');
const matrix = (await fs.readFile(matrixSource, 'utf8'))
  .split('\n')
  .map((line) =>
    line.match(
      /^\| ((?:NAV|DEP|PRO|DEL|CON|QUO|ATT|GAN|WAR|DAT|BUD|MIG)\d+) \| (.*?) \| (.*?) \|$/,
    ),
  )
  .filter(Boolean);
const cap = (value) => {
  if (typeof value === 'string')
    return value.length > 1600 ? value.slice(0, 1600) + '…（详见原始本机产物与脚本）' : value;
  if (Array.isArray(value))
    return value.length > 12
      ? { count: value.length, sample: value.slice(0, 12).map(cap) }
      : value.map(cap);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cap(item)]));
  return value;
};
const evidence = {
  issue: 76,
  sourceCommit: suite.sourceCommit,
  runAt: suite.runAt,
  result: suite.result,
  preflight: suite.preflight,
  provenance: suite.provenance,
  attempts: suite.attempts,
  limitations: suite.limitations,
  checks: suite.checks.map((row) => ({
    ...row,
    actual: row.actual
      ? {
          result: row.actual.result,
          error: row.actual.error,
          checks: row.actual.checks?.map((check) => cap(check)),
        }
      : null,
  })),
};
const output = path.join(root, '../docs/施工交接/验收');
await fs.mkdir(output, { recursive: true });
await fs.writeFile(
  path.join(output, 'V8-76-联合验收证据.json'),
  JSON.stringify(evidence, null, 2) + '\n',
);
const md = [
  '# #76 V8联合验收记录',
  '',
  `源码基线：\`${suite.sourceCommit}\`；运行：${suite.runAt}；编排结果：**${suite.result}**。`,
  ...(suite.provenance ? ['', suite.provenance] : []),
  '',
  '只操作随机端口及独立Chrome临时配置。没有访问或写入标准CRM。联合场景在同一主线关联合同、项目、计划、附件与交付；单票脚本实际重跑使用各自独立工作区，不能把其结果称为同一主线联合实测。',
  '',
  '每场景输入、操作、期望、实际及证据见受控的 [联合验收证据](V8-76-联合验收证据.json)。原始截图/日志/完整JSON留在本机artifacts路径；受控证据保留检查结果与样例，长字符串和数组作明确截断。验收ID映射说明脚本覆盖的具体场景，不扩大为对未断言分支的保证。',
  '',
  '复跑：在 `my demo` 执行 `node scripts/acceptance-v8-suite.mjs`；仅定位某场景可用 `--only=joint,recovery`。生成本记录：`node scripts/report-v8-suite.mjs <本次汇总results.json>`。编排严格顺序运行Chrome；自带服务与共用服务不同时构建；测试失败继续留证，不修改业务代码。',
  '',
  '| ID | 输入场景 | 操作/证据来源 | 期望 | 本次结果与实际 |',
  '| --- | --- | --- | --- | --- |',
];
for (const [, id, input, expected] of matrix) {
  const rows = suite.checks.filter((row) => row.ids?.includes(id));
  const result = rows.some((row) => row.result === '失败')
    ? '失败'
    : rows.length > 0 && rows.every((row) => row.result === '通过')
      ? '通过'
      : '未执行';
  const sources =
    rows.map((row) => `${row.name}（${row.kind || '未执行'}）`).join('、') || '无本次执行证据';
  const actual =
    rows
      .filter((row) => row.actual)
      .map(
        (row) =>
          `${row.name} ${row.actual.checks?.filter((c) => c.result === '通过').length || 0}/${row.actual.checks?.length || 0}检查${row.error ? '；' + String(row.error).slice(0, 100) : ''}`,
      )
      .join('；') || '等待对应脚本/迁移集成后实测';
  md.push(
    `| ${id} | ${input} | ${sources} | ${expected.replaceAll('CRM所有required', '标准CRM所有required')} | **${result}**：${actual.replaceAll('|', '／')} |`,
  );
}
if (suite.preflight)
  md.push('', '## 非最终试跑记录', '', ...suite.preflight.map((item) => '- ' + item));
if (suite.attempts)
  md.push('', '## 执行批次', '', ...suite.attempts.map((item) => `- ${item.path}：记录基线 ${item.sourceCommit}；${item.result}；${item.summary}`));
if (suite.limitations)
  md.push('', '## 覆盖边界', '', ...suite.limitations.map((item) => '- ' + item));
md.push('', '## 场景与复现证据', '');
for (const row of suite.checks) {
  md.push(
    `- **${row.name}：${row.result}**（${row.kind || '未执行'}）。${row.command || row.reason || ''}；${row.evidence || '本次无产物'}。`,
  );
  if (row.actual?.checks)
    for (const check of row.actual.checks)
      md.push(`  - ${check.result}：${check.name}${check.error ? '；' + check.error : ''}`);
  if (row.error) md.push(`  - 阻断/失败：${String(row.error).replaceAll('\n', ' ').slice(0, 500)}`);
}
md.push(
  '',
  '全量测试、生产构建和独立双轴审查由集成负责人统一记录；本脚本不把构建或文档完备当作业务验收。未执行不算通过，失败或未执行项不得凭前序票已关闭自行改为通过。',
  '',
);
await fs.writeFile(path.join(output, 'V8-76-联合验收.md'), md.join('\n'));
console.log('受控记录：', output);
