/** 独立只读消费：node --import tsx scripts/consume-v10-identity.ts workspace.json context.json */
import { readFileSync } from 'node:fs';
import type { DemoState } from '../src/app/core/models';
import {
  selectV10Exceptions,
  type V10ExceptionsFilters,
  selectV10Board,
  type V10BoardFilters,
  selectV10Finance,
  selectV10ProjectFinance,
  type V10FinanceFilters,
  selectV10ProjectIdentity,
  selectV10Portfolio,
  selectV10ProjectDelivery,
  V10_DELIVERY_CONTRACT_VERSION,
  type V10QueryContext,
} from '../src/app/core/v10-contracts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 只校验本消费入口所需来源形状；不迁移、不初始化或重写旧快照。 */
function identitySnapshot(value: unknown): value is DemoState {
  if (!record(value) || value['version'] !== 2) return false;
  return ['projects', 'customers', 'sales'].every((key) => {
    const rows = value[key];
    return (
      Array.isArray(rows) &&
      rows.every(
        (row) =>
          record(row) &&
          [
            'id',
            ...(key === 'projects'
              ? ['customerId', 'opportunityId']
              : key === 'sales'
                ? ['customerId']
                : []),
          ].every((field) => row[field] === undefined || typeof row[field] === 'string') &&
          typeof row[key === 'sales' ? 'type' : 'name'] === 'string',
      )
    );
  });
}
function queryContext(value: unknown): value is V10QueryContext {
  if (
    !record(value) ||
    !record(value['sources']) ||
    !record(value['dates']) ||
    !record(value['fileAvailability'])
  )
    return false;
  const sources = value['sources'];
  const dates = value['dates'];
  return (
    ['workspaceId', 'roundId', 'contextRevision'].every((key) => typeof value[key] === 'string') &&
    (value['dataVersion'] === null || Number.isSafeInteger(value['dataVersion'])) &&
    ['projects', 'customers', 'opportunities'].every((key) =>
      ['ready', 'empty', 'loading', 'unavailable'].includes(String(sources[key])),
    ) &&
    ['planObservationDate', 'solutionBusinessDate', 'realNowUtc'].every(
      (key) => typeof dates[key] === 'string',
    ) &&
    ['finance', 'solutions', 'workItems'].every(
      (key) =>
        sources[key] === undefined ||
        ['ready', 'empty', 'loading', 'unavailable'].includes(String(sources[key])),
    ) &&
    dates['timezone'] === 'Asia/Shanghai' &&
    (dates['lastSuccessfulReadAt'] === null || typeof dates['lastSuccessfulReadAt'] === 'string') &&
    Object.values(value['fileAvailability']).every((status) =>
      ['checking', 'present', 'missing', 'unavailable'].includes(String(status)),
    )
  );
}

try {
  const [sourcePath, contextPath, mode, filtersPath] = process.argv.slice(2);
  if (mode && !['--portfolio', '--delivery', '--finance', '--board', '--exceptions'].includes(mode))
    throw Error('仅支持--portfolio、--delivery、--finance、--board、--exceptions或默认身份消费');
  if (!sourcePath || !contextPath)
    throw Error('用法：consume-v10-identity.ts workspace.json context.json');
  const source: unknown = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const context: unknown = JSON.parse(readFileSync(contextPath, 'utf8'));
  if (!queryContext(context)) throw Error('读取上下文格式无效');
  const isEnvelope = record(source) && 'snapshot' in source;
  if (
    isEnvelope &&
    (source['formatVersion'] !== 1 || source['workspaceId'] !== context.workspaceId)
  )
    throw Error('工作区身份或快照格式与上下文不一致');
  const state = isEnvelope ? source['snapshot'] : source;
  if (!identitySnapshot(state)) throw Error('项目、客户或商机来源结构不可读');
  if (mode === '--exceptions') {
    const filters: unknown = filtersPath ? JSON.parse(readFileSync(filtersPath, 'utf8')) : {};
    const allowed: Record<string, readonly string[] | null> = {
      tab: ['delivery', 'management'],
      scope: ['active', 'completed', 'cancelled', 'all'],
      status: ['delayed', 'warning', 'pending', 'normal'],
      category: [
        'internal-delay',
        'solution-overdue',
        'over-budget',
        'budget-incomparable',
        'solution-data',
        'data-review',
      ],
      department: ['sales', 'solution', 'pm-pmo', 'service', 'unknown'],
      customerId: null,
      projectId: null,
      opportunityId: null,
      grade: null,
      owner: null,
      keyword: null,
    };
    if (
      !record(filters) ||
      Object.entries(filters).some(
        ([key, v]) =>
          !Object.hasOwn(allowed, key) ||
          typeof v !== 'string' ||
          (allowed[key] !== null && !allowed[key].includes(v)),
      )
    )
      throw Error('异常筛选格式无效');
    const result = selectV10Exceptions(state, context, filters as V10ExceptionsFilters);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'loading' || result.status === 'unavailable') process.exitCode = 1;
  } else if (mode === '--board') {
    const filters: unknown = filtersPath ? JSON.parse(readFileSync(filtersPath, 'utf8')) : {};
    if (
      !record(filters) ||
      Object.entries(filters).some(([key, value]) => {
        if (!['presales', 'execution', 'bottom'].includes(key) || !record(value)) return true;
        const allowed: Record<string, readonly string[] | null> =
          key === 'bottom'
            ? {
                department: ['sales', 'solution', 'pm-pmo', 'service', 'unknown'],
                firstResult: [
                  'early',
                  'on-time',
                  'late',
                  'historical-unscored',
                  'not-finalized',
                  'pending',
                ],
              }
            : key === 'presales'
              ? {
                  scope: ['pipeline', 'won', 'lost', 'converted', 'all'],
                  stage: ['意向沟通', '洽谈', '方案报价', '合同谈判'],
                  keyword: null,
                }
              : {
                  scope: ['active', 'completed', 'cancelled', 'all'],
                  status: ['delayed', 'warning', 'pending', 'normal'],
                  keyword: null,
                };
        return Object.entries(value).some(
          ([field, v]) =>
            !Object.hasOwn(allowed, field) ||
            typeof v !== 'string' ||
            (allowed[field] !== null && !allowed[field].includes(v)),
        );
      })
    )
      throw Error('看板筛选格式无效');
    const result = selectV10Board(state, context, filters as V10BoardFilters);
    console.log(JSON.stringify(result, null, 2));
    if (
      [
        result.presales.status,
        result.execution.status,
        result.overview.finance.status,
        result.bottom.departments.status,
        result.bottom.firstFinalizations.status,
      ].some((s) => s === 'unavailable' || s === 'loading')
    )
      process.exitCode = 1;
  } else if (mode === '--finance') {
    const filters: unknown = filtersPath ? JSON.parse(readFileSync(filtersPath, 'utf8')) : {};
    const allowed = [
      'batchId',
      'currency',
      'periodStart',
      'periodEnd',
      'asOf',
      'customerId',
      'projectId',
      'keyword',
    ];
    if (
      !record(filters) ||
      Object.entries(filters).some(
        ([key, value]) => !allowed.includes(key) || typeof value !== 'string',
      )
    )
      throw Error('财务筛选格式无效');
    const result = selectV10Finance(state, context, filters as V10FinanceFilters);
    console.log(
      JSON.stringify(
        {
          ...result,
          projectDrilldowns:
            result.projects?.map((p) =>
              selectV10ProjectFinance(state, context, p.projectId, result.filters),
            ) ?? null,
        },
        null,
        2,
      ),
    );
    if (result.status === 'unavailable' || result.status === 'loading') process.exitCode = 1;
  } else if (mode === '--delivery') {
    const portfolio = selectV10Portfolio(state, context, { executionScope: 'all' });
    const projects =
      portfolio.execution.projects?.map((p) =>
        selectV10ProjectDelivery(state, context, p.projectId!),
      ) ?? null;
    const counts = projects ? { delayed: 0, warning: 0, pending: 0, normal: 0 } : null;
    if (counts) for (const project of projects!) counts[project.delivery?.status ?? 'pending']++;
    console.log(
      JSON.stringify(
        {
          contractVersion: projects?.[0]?.contractVersion ?? V10_DELIVERY_CONTRACT_VERSION,
          scope: 'customer-delivery',
          workspaceId: context.workspaceId,
          roundId: context.roundId,
          dataVersion: context.dataVersion,
          contextRevision: context.contextRevision,
          dates: context.dates,
          status: portfolio.execution.status,
          projectCount: portfolio.execution.counts?.projectCount ?? null,
          counts,
          projects,
          issues: portfolio.issues,
        },
        null,
        2,
      ),
    );
    if (!projects) process.exitCode = 1;
  } else {
    const result =
      mode === '--portfolio'
        ? selectV10Portfolio(state, context)
        : selectV10ProjectIdentity(state, context);
    console.log(JSON.stringify(result, null, 2));
    const statuses =
      'presales' in result ? [result.presales.status, result.execution.status] : [result.status];
    if (statuses.some((status) => status === 'unavailable' || status === 'loading'))
      process.exitCode = 1;
  }
} catch (error) {
  console.log(
    JSON.stringify(
      {
        status: 'unavailable',
        counts: null,
        customers: null,
        pending: null,
        issues: [
          {
            category: 'unavailable',
            reason: error instanceof Error ? error.message : String(error),
          },
        ],
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
