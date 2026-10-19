// K32 迁移报告格式化：读取 CODEX 第五批已判定结果 → 重组 → 写出 JSON/Markdown。
// 只格式化已判定结果，不推断迁移正确性；不改业务代码、不重跑浏览器、不修改输入文件。
// 用法：node scripts/report-v9-migration-comparison.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from './browser-config.mjs';

const inputDir = path.join(root, '../docs/verification/v9-b05-codex');
const outputDir = path.join(root, '../docs/verification/v9-b05-kimi');
const specPath = 'doc/PRD/DEMO PRD/V9PRD/specs/15_保存迁移整合_SPEC.md';

// ---- 追踪项与要点（按父规格 15_保存迁移整合_SPEC.md 验收追踪项组织）----
const TRACKING_ITEMS = [
  {
    id: 'MIG05',
    title: '恢复与清理隔离',
    spec: '当前 Blob 丢失、不可读取、跨工作区及仅元数据恢复均正确反馈，不凭元数据判真实上传；合同与其他业务对象不被清理；缺件阻止新定稿，重传生成新版不改旧上传时间与首次事实。',
    points: [
      '当前 Blob 丢失正确反馈（缺件核验）',
      '当前 Blob 不可读取正确反馈（与确实缺失区分）',
      '跨工作区正确反馈（隔离）',
      '仅元数据恢复正确反馈（不承诺恢复文件内容）',
      '合同与其他业务对象不被清理',
      '缺件阻止新定稿',
      '重传生成新版、不改旧上传时间与首次事实',
      '失败重试/回收边界不改已成功结果（幂等）',
    ],
  },
  {
    id: 'MIG06',
    title: '重入',
    spec: '分别运行加载、刷新、接管、续接和重开；统一引用仍可追溯，旧集合不复活，既有编辑不被 seed 覆盖，新轮不复制旧操作事实。',
    points: ['加载', '刷新', '接管', '续接', '重开', '统一引用可追溯', '旧集合不复活', '编辑不被 seed 覆盖', '新轮不复制旧操作事实'],
  },
  {
    id: 'INT02',
    title: '完整性',
    spec: '配额不足、失去修改资格、重复动作、快照失败——无部分成功或重复历史。',
    points: ['配额不足', '失去修改资格', '重复动作', '快照失败', '无部分成功或重复历史'],
  },
];

// ---- 检查项映射：检查名称逐字取自输入 JSON；仅归入一个追踪项作主证据 ----
// [追踪项, 要点（可多个）, 检查名称, 来源文件, 对应 ticket]
const CHECK_MAPPING = [
  // MIG05 恢复与清理隔离（文件隔离回归 7 组 + B05 恢复反馈 4 组 + B04 文件边界 2 组）
  ['MIG05', ['跨工作区正确反馈（隔离）', '合同与其他业务对象不被清理'], '真实IndexedDB共享当前引用、合同、跨工作区和未知归属保留', 'browser-file-isolation.json', '15-03 / #171'],
  ['MIG05', ['失败重试/回收边界不改已成功结果（幂等）'], '真实替换已提交，回收边界失败不改成功结果', 'browser-file-isolation.json', '15-03 / #171'],
  ['MIG05', ['失败重试/回收边界不改已成功结果（幂等）', '合同与其他业务对象不被清理'], '实际定向恢复释放不新增版本与历史，仍保护所有隔离范围', 'browser-file-isolation.json', '15-03 / #171'],
  ['MIG05', ['失败重试/回收边界不改已成功结果（幂等）'], '重复恢复幂等', 'browser-file-isolation.json', '15-03 / #171'],
  ['MIG05', ['当前 Blob 不可读取正确反馈（与确实缺失区分）'], '当前读取异常保持暂不可读', 'browser-file-isolation.json', '15-03 / #171'],
  ['MIG05', ['当前 Blob 丢失正确反馈（缺件核验）', '重传生成新版、不改旧上传时间与首次事实'], '受控删除当前Blob后核验缺件，原上传时间及版本保留', 'browser-file-isolation.json', '15-03 / #171'],
  ['MIG05', ['重传生成新版、不改旧上传时间与首次事实'], '缺件重传是新版，旧时间不回填', 'browser-file-isolation.json', '15-03 / #171'],
  ['MIG05', ['仅元数据恢复正确反馈（不承诺恢复文件内容）'], '仅元数据恢复式缺件不抹去首次及上传历史', 'browser-report.json', '15-03 / #171'],
  ['MIG05', ['当前 Blob 丢失正确反馈（缺件核验）', '缺件阻止新定稿'], '缺Blob公开定稿拒绝', 'browser-report.json', '15-03 / #171'],
  ['MIG05', ['重传生成新版、不改旧上传时间与首次事实'], '缺件真实重传成为新版后重新定稿', 'browser-report.json', '15-03 / #171'],
  ['MIG05', ['当前 Blob 不可读取正确反馈（与确实缺失区分）'], '文件不可读与确实缺失分别反馈', 'browser-report.json', '15-03 / #171'],
  ['MIG05', ['当前 Blob 丢失正确反馈（缺件核验）'], '表单提交文件missing边界失败不发布', 'browser-b04-regression.json', '15-03 / #171'],
  ['MIG05', ['当前 Blob 不可读取正确反馈（与确实缺失区分）'], '表单提交文件unavailable边界失败不发布', 'browser-b04-regression.json', '15-03 / #171'],
  // MIG06 重入（B05 五入口 + 历史可追溯 2 组 + B04 刷新 2 组）
  ['MIG06', ['加载'], 'V9加载旧模拟明确未评分且不能定稿', 'browser-report.json', '15-02 / #174'],
  ['MIG06', ['刷新', '编辑不被 seed 覆盖'], '刷新同一统一结构，浏览不保存业务或重新补种', 'browser-report.json', '15-02 / #174'],
  ['MIG06', ['接管', '统一引用可追溯'], '实际接管保持统一业务历史', 'browser-report.json', '15-02 / #174'],
  ['MIG06', ['续接', '统一引用可追溯'], '实际续接旧工作区保留稳定版本首次和核价历史', 'browser-report.json', '15-02 / #174'],
  ['MIG06', ['重开', '新轮不复制旧操作事实'], '真实重开发布V9新轮，不复制旧上传和定稿', 'browser-report.json', '15-02 / #174'],
  ['MIG06', ['统一引用可追溯'], '真实重新定稿保留两次组合历史', 'browser-report.json', '13-03 / #170'],
  ['MIG06', ['刷新'], '真实表单定稿刷新后首次成绩与冻结保留', 'browser-b04-regression.json', '13-03 / #170'],
  ['MIG06', ['刷新'], 'K17刷新后关联/免做历史与当前状态保留', 'browser-b04-regression.json', 'B04 回归（执行任务组/免做，非第五批六票）'],
  // INT02 完整性（配额 2、失去修改资格 3、重复动作 1、快照失败 1）
  ['INT02', ['快照失败', '配额不足'], '快照保存失败保留确认请求且不冻结', 'browser-b04-regression.json', '13-03 / #170'],
  ['INT02', ['配额不足'], 'K17任务组保存失败保留原因和重试', 'browser-b04-regression.json', 'B04 回归（执行任务组/免做，非第五批六票）'],
  ['INT02', ['重复动作', '无部分成功或重复历史'], '键盘真实代办定稿/忙时防重复/责任与实际操作者分记', 'browser-b04-regression.json', '13-03 / #170'],
  ['INT02', ['失去修改资格'], '打开确认后失去修改权拒绝且不改状态', 'browser-b04-regression.json', '13-03 / #170'],
  ['INT02', ['失去修改资格'], '真实第二标签页只读不能打开定稿确认', 'browser-b04-regression.json', '15-02 / #174'],
  ['INT02', ['失去修改资格', '无部分成功或重复历史'], '失去修改权后公开命令不发布部分成功', 'browser-report.json', '17-02 / #172'],
];

// ---- 输入里找不到直接命名证据的要点（如实标注，不编造）----
const NO_DIRECT_EVIDENCE = {
  MIG06: [
    {
      point: '旧集合不复活',
      status: '无直接证据（见来源）',
      note: '三份输入 JSON 均无对应命名检查；仅 v9-b05-codex/README.md 15-02 行有文字结论“旧集合只读兼容，不覆盖用户编辑”，本报告不将其计为直接证据。',
    },
  ],
};

// 附录（未直接归入 MIG05/MIG06/INT02 的检查）的对应 ticket 归属规则，按 README 逐票范围判断
function appendixTicket(name, source) {
  if (/^(K17|免做选项限定)/.test(name)) return 'B04 回归（执行任务组/免做，非第五批六票）';
  if (/无Angular/.test(name)) return source === 'browser-b04-regression.json' ? '通用（B04 浏览器组）' : '通用（B05 浏览器组）';
  if (/已采用报价的文件异常独立提示/.test(name)) return '15-03 / #171';
  if (/目录草稿|未采用时提交拦截|显式采用当前有效定稿|采用后真实页面提交审核成功|重新定稿不自动采用|显式重新采用恢复审核/.test(name)) return '17-02 / #172';
  if (/来源变化阻止批准|主管锁定/.test(name)) return '17-03 / #175';
  if (/改版|需求变更重定稿仍保持首次成绩|真实重定稿保留首次与旧文件元数据/.test(name)) return '07-04 / #169';
  return '13-03 / #170';
}

const cap = (value) => {
  if (typeof value === 'string') return value.length > 240 ? value.slice(0, 240) + '…（截断，详见输入 JSON）' : value;
  if (Array.isArray(value))
    return value.length > 6 ? { count: value.length, sample: value.slice(0, 6).map(cap) } : value.map(cap);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cap(item)]));
  return value;
};

const readJson = async (file) => JSON.parse(await fs.readFile(path.join(inputDir, file), 'utf8'));

// ---- 读取输入 ----
const sources = {
  'browser-file-isolation.json': await readJson('browser-file-isolation.json'),
  'browser-report.json': await readJson('browser-report.json'),
  'browser-b04-regression.json': await readJson('browser-b04-regression.json'),
};
const exitCodes = await readJson('exit-codes.json');
const fullTestsLog = await fs.readFile(path.join(inputDir, 'full-tests.log'), 'utf8');
const readme = await fs.readFile(path.join(inputDir, 'README.md'), 'utf8');

// ---- 从 full-tests.log 解析既有失败（test at 行 + ✖ 用例行 + Error 行）----
const existingFailures = [];
{
  let current = null;
  for (const line of fullTestsLog.split('\n')) {
    const at = line.match(/^test at (tests\/\S+?):(\d+)/);
    if (at) {
      current = { file: at[1], line: Number(at[2]) };
      continue;
    }
    if (!current) continue;
    const fail = line.match(/^✖ (.+) \([\d.]+ms\)/);
    if (fail && !current.name) {
      current.name = fail[1];
      continue;
    }
    const err = line.match(/^\s+Error: (.+)/);
    if (err && current.name && !current.error) {
      current.error = err[1];
      existingFailures.push({ ...current, source: 'full-tests.log' });
      current = null;
    }
  }
}

// ---- 从 README 解析逐票判定结论表与实际验证计数 ----
const ticketConclusions = [];
for (const line of readme.split('\n')) {
  const row = line.match(/^\| \[([0-9]{2}-[0-9]{2}) \/ #(\d+)\]\([^)]*\) \| (.*?) \| (.*?) \|$/);
  if (row) ticketConclusions.push({ ticket: `${row[1]} / #${row[2]}`, codex: row[3], kimi: row[4] });
}
const readmeCounts = {};
for (const match of readme.matchAll(/\[(\d+)\/(\d+)\]\((targeted-tests\.log|source-regression\.log)\)/g))
  readmeCounts[match[3]] = { passed: Number(match[1]), total: Number(match[2]) };

// ---- 解析映射并核对每个检查名称都能在来源文件中找到 ----
const selfCheckIssues = [];
const mappedKeys = new Set();
const itemChecks = { MIG05: [], MIG06: [], INT02: [] };
for (const [itemId, points, name, source, ticket] of CHECK_MAPPING) {
  const checks = sources[source].checks.filter((check) => check.name === name);
  if (checks.length !== 1) {
    selfCheckIssues.push(`映射检查在 ${source} 中匹配 ${checks.length} 次（应为 1）：${name}`);
    continue;
  }
  mappedKeys.add(`${source}|${name}`);
  const original = checks[0];
  itemChecks[itemId].push({
    name,
    source,
    ticket,
    points,
    result: '通过',
    excerpt: cap({ ...original, name: undefined }),
  });
}

// ---- 附录：未被映射的检查（逐条出现计）----
const appendix = [];
const appendixBySource = {};
for (const [source, data] of Object.entries(sources)) {
  for (const check of data.checks) {
    if (mappedKeys.has(`${source}|${check.name}`)) continue;
    const entry = { name: check.name, source, ticket: appendixTicket(check.name, source), result: '通过' };
    appendix.push(entry);
    (appendixBySource[source] ??= []).push(entry);
  }
}

// ---- 自检 ----
for (const [source, data] of Object.entries(sources)) {
  if (data.passed !== data.checks.length)
    selfCheckIssues.push(`${source} 顶层 passed=${data.passed} 与 checks 长度 ${data.checks.length} 不一致`);
}
const totalInput = Object.values(sources).reduce((sum, data) => sum + data.checks.length, 0);
const totalAccounted = CHECK_MAPPING.length + appendix.length;
if (totalAccounted !== totalInput)
  selfCheckIssues.push(`检查计数不闭合：映射 ${CHECK_MAPPING.length} + 附录 ${appendix.length} = ${totalAccounted}，输入共 ${totalInput}`);
if (existingFailures.length !== exitCodes.full_suite.known_failures)
  selfCheckIssues.push(`既有失败解析 ${existingFailures.length} 项与 exit-codes.json known_failures=${exitCodes.full_suite.known_failures} 不一致`);
const failFiles = existingFailures.map((f) => f.file);
if (!(failFiles.filter((f) => f.includes('v7-project-planning')).length === 2 && failFiles.filter((f) => f.includes('v8-wbs-budget')).length === 1))
  selfCheckIssues.push('既有失败文件分布与 README 所述（v7-project-planning 两项、v8-wbs-budget 一项）不一致');
// 报告中每个“通过”都必须能在输入 JSON 中找到对应条目
for (const item of Object.values(itemChecks).flat())
  if (!sources[item.source].checks.some((check) => check.name === item.name))
    selfCheckIssues.push(`报告通过项在输入中找不到：${item.source} / ${item.name}`);
for (const item of appendix)
  if (!sources[item.source].checks.some((check) => check.name === item.name))
    selfCheckIssues.push(`附录通过项在输入中找不到：${item.source} / ${item.name}`);
// 要点覆盖统计
const coverage = {};
for (const item of TRACKING_ITEMS) {
  const checks = itemChecks[item.id];
  coverage[item.id] = {
    checks: checks.length,
    pointsCovered: item.points.filter((point) => checks.some((check) => check.points.includes(point))).length,
    pointsTotal: item.points.length,
  };
}

// ---- 组装 JSON 报告 ----
const generatedAt = new Date().toISOString();
const report = {
  meta: {
    title: 'V9 保存迁移整合（C14）迁移对比报告',
    generatedAt,
    generator: 'my demo/scripts/report-v9-migration-comparison.mjs（K32）',
    branch: 'support/v9-b04-kimi',
    spec: specPath,
    inputDir: 'docs/verification/v9-b05-codex/',
    inputs: Object.keys(sources).concat(['README.md', 'full-tests.log', 'exit-codes.json']),
    boundary: '只格式化 CODEX 第五批已判定结果，不推断迁移正确性；不新增判定、不重跑浏览器、不修改输入文件。',
  },
  runOverview: {
    exitCodes,
    ticketConclusions,
  },
  tracking: Object.fromEntries(
    TRACKING_ITEMS.map((item) => [
      item.id,
      {
        ...item,
        checks: itemChecks[item.id],
        pointsWithoutEvidence: (NO_DIRECT_EVIDENCE[item.id] ?? []).map((entry) => entry.point),
        noDirectEvidence: NO_DIRECT_EVIDENCE[item.id] ?? [],
      },
    ]),
  ),
  existingFailures: {
    title: '既有失败登记',
    note: '与本轮无关、未放宽门禁。均为旧用例新建内部 WBS 未填写必填预警天数；本轮未修改这些测试或放宽业务校验（依据 v9-b05-codex/README.md）。全量 npm test 545 项、542 通过、3 项既有失败，退出 1，未将全量标为通过。',
    total: exitCodes.full_suite.total,
    passed: exitCodes.full_suite.passed,
    items: existingFailures,
  },
  appendix: {
    title: '其他已判定检查（未直接归入 MIG05/MIG06/INT02）',
    count: appendix.length,
    bySource: appendixBySource,
  },
  selfCheck: {
    conclusion: selfCheckIssues.length === 0 ? '通过' : '失败',
    issues: selfCheckIssues,
    everyPassTraceable: '报告中每条“通过”均按（来源文件, 检查名称）在输入 JSON 中命中唯一或逐条出现条目。',
    counts: { totalInput, mapped: CHECK_MAPPING.length, appendix: appendix.length, ...coverage },
  },
};

// ---- 组装 Markdown 报告 ----
const oneLine = (value) => (typeof value === 'string' ? value.replaceAll('\n', ' ').replaceAll('|', '／') : JSON.stringify(value));
const excerptCell = (excerpt) => oneLine(JSON.stringify(excerpt)).slice(0, 220);
const md = [];
md.push(
  '# V9 保存迁移整合（C14）迁移对比报告',
  '',
  `- 生成时间：${generatedAt}；脚本：\`my demo/scripts/report-v9-migration-comparison.mjs\`（K32）`,
  '- 输入：`docs/verification/v9-b05-codex/`（CODEX 第五批已判定结果，只读）',
  `- 分支：\`support/v9-b04-kimi\`；父规格：\`${specPath}\``,
  '- 边界：**只格式化已判定结果，不推断迁移正确性**；不新增判定、不重跑浏览器、不修改输入文件。输入里找不到证据的要点如实标“无直接证据（见来源）”。',
  '',
  '## 本轮输入概览（按 exit-codes.json 与 README 实际验证表）',
  '',
  '| 批次 | 结果 |',
  '| --- | --- |',
  `| 定向专项及相关旧回归（targeted-tests.log） | ${readmeCounts['targeted-tests.log'].passed}/${readmeCounts['targeted-tests.log'].total}，退出 ${exitCodes.targeted_tests_77} |`,
  `| 回收/映射/现有业务事实回归（source-regression.log） | ${readmeCounts['source-regression.log'].passed}/${readmeCounts['source-regression.log'].total}，退出 ${exitCodes.source_regression_8} |`,
  `| 全量 npm test（full-tests.log） | ${exitCodes.full_suite.total} 项：${exitCodes.full_suite.passed} 通过、${exitCodes.full_suite.known_failures} 项既有失败，退出 ${exitCodes.full_suite.exit_code}（未将全量标为通过） |`,
  `| B05 真实浏览器（browser-report.json） | ${sources['browser-report.json'].passed}/41 通过，退出 0 |`,
  `| B04 真实表单回归（browser-b04-regression.json） | ${sources['browser-b04-regression.json'].passed}/40 通过，退出 0 |`,
  `| 真实 IndexedDB 文件隔离回归（browser-file-isolation.json） | ${sources['browser-file-isolation.json'].passed}/7 通过，退出 0 |`,
  '',
  '## CODEX 逐票判定结论（摘自 v9-b05-codex/README.md）',
  '',
  ...ticketConclusions.map((row) => `- **${row.ticket}**：${oneLine(row.codex)}（仍留给 KIMI：${oneLine(row.kimi)}）`),
  '',
);
for (const item of TRACKING_ITEMS) {
  const checks = itemChecks[item.id];
  const noEvi = NO_DIRECT_EVIDENCE[item.id] ?? [];
  md.push(
    `## ${item.id} ${item.title}`,
    '',
    `规格要点：${item.spec}`,
    '',
    `收录检查 ${checks.length} 条；要点覆盖 ${coverage[item.id].pointsCovered}/${coverage[item.id].pointsTotal}。`,
    '',
    '| # | 检查名称 | 来源文件 | 结果 | 对应 ticket | 要点 | 原始结果摘录 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...checks.map((check, i) =>
      `| ${i + 1} | ${oneLine(check.name)} | ${check.source} | ${check.result} | ${check.ticket} | ${check.points.map(oneLine).join('；')} | ${excerptCell(check.excerpt)} |`,
    ),
  );
  if (noEvi.length > 0) {
    md.push('', '**无直接证据要点：**');
    for (const entry of noEvi)
      md.push(`- ${entry.point} —— ${entry.status}。${entry.note}`);
  }
  md.push('');
}
md.push(
  '## 既有失败登记（与本轮无关，未放宽门禁）',
  '',
  report.existingFailures.note,
  '',
  '| 测试文件 | 用例 | 错误 | 来源 |',
  '| --- | --- | --- | --- |',
  ...existingFailures.map((f) => `| ${f.file}:${f.line} | ${oneLine(f.name)} | ${oneLine(f.error)} | ${f.source} |`),
  '',
  '## 附：其他已判定检查（未直接归入 MIG05/MIG06/INT02，共 ' + appendix.length + ' 条）',
  '',
  '以下检查已在输入 JSON 中判定通过，但不直接对应三个追踪项，按来源文件如实列出（对应 ticket 按 README 逐票范围归属）：',
  '',
);
for (const [source, list] of Object.entries(appendixBySource)) {
  md.push(`### ${source}（${list.length} 条）`, '', '| # | 检查名称 | 结果 | 对应 ticket |', '| --- | --- | --- | --- |');
  list.forEach((check, i) => md.push(`| ${i + 1} | ${oneLine(check.name)} | ${check.result} | ${check.ticket} |`));
  md.push('');
}
md.push(
  '## 自检',
  '',
  `- 自检结论：**${report.selfCheck.conclusion}**。`,
  `- 检查计数闭合：输入 ${totalInput} 条 = 映射 ${CHECK_MAPPING.length} 条 + 附录 ${appendix.length} 条。`,
  `- 每个追踪项的“通过”均按（来源文件, 检查名称）在输入 JSON 中找到对应条目；无编造结果。`,
  `- 既有失败 ${existingFailures.length} 项与 exit-codes.json known_failures=${exitCodes.full_suite.known_failures} 一致，文件分布与 README 一致。`,
  ...(selfCheckIssues.length > 0 ? selfCheckIssues.map((issue) => `- 问题：${issue}`) : []),
  '',
);

// ---- 写出 ----
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'migration-comparison-report.json'), JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'migration-comparison-report.md'), md.join('\n'));
console.log(`报告输出：${outputDir}`);
console.log(
  `自检：${report.selfCheck.conclusion}；计数 MIG05=${itemChecks.MIG05.length}、MIG06=${itemChecks.MIG06.length}、INT02=${itemChecks.INT02.length}、附录=${appendix.length}、既有失败=${existingFailures.length}`,
);
if (selfCheckIssues.length > 0) {
  console.error(selfCheckIssues.join('\n'));
  process.exitCode = 1;
}
