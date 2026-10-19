import { stableId, indexById } from './identity-index';
export { stableId, indexById } from './identity-index';
import type { DemoState } from '../models';
import { isValidISODate } from '../rules';
import type {
  V10CustomerProjectGroup,
  V10ProjectIdentity,
  V10ProjectIdentityResult,
  V10QueryContext,
  V10SourceIssue,
} from '../v10-contracts';
import { V10_IDENTITY_CONTRACT_VERSION } from '../v10-contracts';

function validUtc(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z')
  );
}
function sourceHref(type: V10SourceIssue['objectType'], id: string): string | null {
  const paths = {
    customer: '/sales/customers/',
    opportunity: '/sales/detail/',
    project: '/projects/',
    context: '',
  };
  return type === 'context' ? null : paths[type] + encodeURIComponent(id);
}
export function issue(
  type: V10SourceIssue['objectType'],
  id: string | null,
  category: V10SourceIssue['category'],
  field: string,
  reason: string,
): V10SourceIssue {
  return {
    id: JSON.stringify([type, id, category, field]),
    category,
    objectType: type,
    objectId: id,
    field,
    reason,
    sourceHref: id && category !== 'ambiguous' ? sourceHref(type, id) : null,
  };
}

/** 仅消费已发布快照，不读取存储、不初始化、不产生业务事件。 */
export function selectV10ProjectIdentity(
  state: Readonly<DemoState>,
  context: V10QueryContext,
): V10ProjectIdentityResult {
  const metadata = {
    contractVersion: V10_IDENTITY_CONTRACT_VERSION,
    workspaceId: context.workspaceId,
    roundId: context.roundId,
    dataVersion: context.dataVersion,
    contextRevision: context.contextRevision,
    dates: { ...context.dates },
    sources: { ...context.sources },
    scope: 'saved-projects' as const,
    filters: {},
    units: {
      projects: 'project' as const,
      customers: 'customer' as const,
      opportunities: 'opportunity' as const,
    },
  };
  if (
    !stableId(context.workspaceId) ||
    !stableId(context.roundId) ||
    !stableId(context.contextRevision) ||
    context.roundId !== state.roundId ||
    context.dataVersion !== (state.dataVersion ?? null) ||
    (context.dataVersion !== null &&
      (!Number.isSafeInteger(context.dataVersion) || context.dataVersion < 0))
  )
    return {
      ...metadata,
      status: 'unavailable',
      counts: null,
      customers: null,
      pending: null,
      issues: [
        issue(
          'context',
          null,
          'conflicting',
          'revision',
          '工作区、轮次或读取修订缺失，或上下文与快照修订不一致',
        ),
      ],
    };
  if (
    !isValidISODate(context.dates.planObservationDate) ||
    !isValidISODate(context.dates.solutionBusinessDate) ||
    !validUtc(context.dates.realNowUtc) ||
    (context.dates.lastSuccessfulReadAt !== null && !validUtc(context.dates.lastSuccessfulReadAt))
  )
    return {
      ...metadata,
      status: 'unavailable',
      counts: null,
      customers: null,
      pending: null,
      issues: [issue('context', null, 'invalid', 'dates', '业务日期或UTC读取时间无效')],
    };
  if (context.sources.projects === 'loading' || context.sources.projects === 'unavailable')
    return {
      ...metadata,
      status: context.sources.projects,
      counts: null,
      customers: null,
      pending: null,
      issues: [
        issue('context', null, 'unavailable', 'projects', '项目来源未成功读取，不能推断数量'),
      ],
    };
  if (context.sources.projects === 'empty' && state.projects.length > 0)
    return {
      ...metadata,
      status: 'unavailable',
      counts: null,
      customers: null,
      pending: null,
      issues: [
        issue('context', null, 'conflicting', 'projects', '项目来源声明为空，但快照含有项目记录'),
      ],
    };
  const groups = new Map<string, V10CustomerProjectGroup>();
  const pending: V10ProjectIdentity[] = [];
  const issues: V10SourceIssue[] = [];
  const projects = indexById(state.projects);
  const customersConflicting = context.sources.customers === 'empty' && state.customers.length > 0;
  const opportunitiesConflicting =
    context.sources.opportunities === 'empty' && state.sales.some((s) => s.type === 'opportunity');
  const customersReadable =
    !customersConflicting && ['ready', 'empty'].includes(context.sources.customers);
  const opportunitiesReadable =
    !opportunitiesConflicting && ['ready', 'empty'].includes(context.sources.opportunities);
  const customers = indexById(customersReadable ? state.customers : []);
  const opportunities = indexById(opportunitiesReadable ? state.sales : []);
  const unidentified = state.projects.filter((p) => !stableId(p.id));
  for (const [recordIndex, project] of unidentified.entries()) {
    const problem = issue(
      'project',
      null,
      'missing',
      `id:unidentified:${recordIndex}`,
      '项目缺少稳定ID，不计入去重项目数',
    );
    pending.push({
      projectId: null,
      name: project.name,
      customerId: null,
      opportunityId: null,
      sourceHref: null,
      issues: [problem],
    });
    issues.push(problem);
  }
  for (const [id, records] of projects) {
    const rowIssues: V10SourceIssue[] = [];
    if (records.length !== 1) {
      const problem = issue(
        'project',
        id,
        'ambiguous',
        'id',
        `项目ID重复，共${records.length}条记录，未选择任何一条`,
      );
      pending.push({
        projectId: id,
        name: `重复项目ID（${records.length}条记录）`,
        customerId: null,
        opportunityId: null,
        sourceHref: null,
        issues: [problem],
      });
      issues.push(problem);
      continue;
    }
    const project = records[0];
    const customerRows = customers.get(project.customerId) ?? [];
    const opportunityRows = opportunities.get(project.opportunityId) ?? [];
    for (const [field, rows, label, readable] of [
      ['customerId', customerRows, '客户', customersReadable],
      ['opportunityId', opportunityRows, '商机', opportunitiesReadable],
    ] as const) {
      if (!readable)
        rowIssues.push(
          issue('project', id, 'unavailable', field, `${label}来源未成功读取，不能确认关联`),
        );
      else if (rows.length !== 1)
        rowIssues.push(
          issue(
            'project',
            id,
            rows.length ? 'ambiguous' : 'missing',
            field,
            rows.length ? `${label}ID重复，无法可靠关联` : `${label}关联缺失或目标不存在`,
          ),
        );
    }
    if (customersConflicting || opportunitiesConflicting)
      rowIssues.push(
        issue(
          'project',
          id,
          'conflicting',
          'source-status',
          '客户或商机来源声明为空，但快照含记录，关联须待核',
        ),
      );
    const customer = customerRows.length === 1 ? customerRows[0] : null;
    const opportunity = opportunityRows.length === 1 ? opportunityRows[0] : null;
    if (opportunity && opportunity.type !== 'opportunity')
      rowIssues.push(
        issue('project', id, 'invalid', 'opportunityId', '来源是线索，不能作为商机关联'),
      );
    if (customer && opportunity && customer.id !== opportunity.customerId)
      rowIssues.push(
        issue('project', id, 'conflicting', 'customerId', '项目与商机的客户主体不一致'),
      );
    const item: V10ProjectIdentity = {
      projectId: id,
      name: project.name,
      customerId: stableId(project.customerId) ? project.customerId : null,
      opportunityId: stableId(project.opportunityId) ? project.opportunityId : null,
      sourceHref: sourceHref('project', id),
      issues: rowIssues,
    };
    if (rowIssues.length || !customer || !opportunity) {
      pending.push(item);
      issues.push(...rowIssues);
      continue;
    }
    let group = groups.get(customer.id);
    if (!group) {
      group = {
        customerId: customer.id,
        name: customer.name,
        sourceHref: sourceHref('customer', customer.id)!,
        projects: [],
        projectCount: 0,
        opportunities: [],
      };
      groups.set(customer.id, group);
    }
    group.projects.push(item);
    group.projectCount++;
    let opportunityGroup = group.opportunities.find((o) => o.opportunityId === opportunity.id);
    if (!opportunityGroup) {
      opportunityGroup = {
        opportunityId: opportunity.id,
        projectIds: [],
        sourceHref: sourceHref('opportunity', opportunity.id)!,
      };
      group.opportunities.push(opportunityGroup);
    }
    opportunityGroup.projectIds.push(id);
  }
  const groupedProjectCount = [...groups.values()].reduce(
    (sum, group) => sum + group.projectCount,
    0,
  );
  return {
    ...metadata,
    status: projects.size || unidentified.length ? 'ready' : 'empty',
    counts: {
      projectCount: projects.size,
      customerCount: customersReadable && opportunitiesReadable ? groups.size : null,
      groupedProjectCount,
      pendingProjectCount: projects.size - groupedProjectCount,
      unidentifiedRecordCount: unidentified.length,
    },
    customers: [...groups.values()],
    pending,
    issues,
  };
}
