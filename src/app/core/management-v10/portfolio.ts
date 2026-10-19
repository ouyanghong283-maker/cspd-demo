import type { DemoState } from '../models';
import { selectLifecycleProgress, PROGRESS_VERSION } from '../lifecycle-progress';
import { selectProjectCompletionFacts } from '../lifecycle-progress/project-completion';
import { selectV10ProjectIdentity, indexById, stableId, issue } from './identity';
import { V10_PORTFOLIO_CONTRACT_VERSION } from '../v10-contracts';
import type {
  V10ExecutionProject,
  V10PortfolioFilters,
  V10PortfolioResult,
  V10QueryContext,
  V10OpportunitySummary,
  V10SourceIssue,
} from '../v10-contracts';

function incomplete(progress: V10OpportunitySummary['progress']): boolean {
  return (
    !progress || progress.nodes.some((n) => n.status === 'missing' || n.status === 'invalidated')
  );
}

/** 商机仅消费共享售前事实，每个项目独立调用原v9.1生命周期公开查询。 */
export function selectV10Portfolio(
  state: Readonly<DemoState>,
  context: V10QueryContext,
  filters: V10PortfolioFilters = {},
): V10PortfolioResult {
  const identity = selectV10ProjectIdentity(state, context);
  const normalized = {
    presalesScope: filters.presalesScope ?? 'pipeline',
    executionScope: filters.executionScope ?? 'active',
  };
  const contextInvalid = identity.issues.some(
    (i) => i.objectType === 'context' && (i.field === 'revision' || i.field === 'dates'),
  );
  const opportunityConflict =
    context.sources.opportunities === 'empty' && state.sales.some((s) => s.type === 'opportunity');
  const opportunitiesReadable =
    !contextInvalid &&
    !opportunityConflict &&
    ['ready', 'empty'].includes(context.sources.opportunities);
  const customersReadable =
    ['ready', 'empty'].includes(context.sources.customers) &&
    !(context.sources.customers === 'empty' && state.customers.length > 0);
  const sourceIssues = opportunityConflict
    ? [issue('context', null, 'conflicting', 'opportunities', '商机来源声明为空，但快照含商机记录')]
    : [];
  const projectIndex = indexById(state.projects);
  const reliable = (identity.customers ?? []).flatMap((g) => g.projects);
  const projects: V10ExecutionProject[] = [
    ...reliable,
    ...(identity.pending ?? []).filter((p) => p.projectId !== null),
  ].map((p) => {
    const project = projectIndex.get(p.projectId!)!;
    if (p.issues.length || project.length !== 1)
      return {
        ...p,
        executionScope: 'active',
        progressVersion: PROGRESS_VERSION,
        progress: null,
        incomplete: true,
      };
    const row = project[0];
    const progress = selectLifecycleProgress(state, row.opportunityId, row.id, context.dates);
    const facts = selectProjectCompletionFacts(state, row);
    // 原项目记录明确的“已取消”是项目级取消事实；计划状态和近似文案不能代替。
    const cancelled = row.status === '已取消';
    const conflict = cancelled && (facts.acceptance || facts.serviceHandover);
    const executionScope = conflict
      ? 'active'
      : cancelled
        ? 'cancelled'
        : facts.acceptance && facts.serviceHandover
          ? 'completed'
          : 'active';
    const exitIssue = conflict
      ? '项目已取消与有效客户验收或内部移交事实冲突'
      : ['已完成', '已关闭', '已移交'].includes(row.status) && executionScope === 'active'
        ? '项目结束状态缺少有效客户验收或内部移交依据'
        : null;
    const issues = exitIssue
      ? [
          ...p.issues,
          issue(
            'project',
            row.id,
            conflict ? 'conflicting' : 'invalid',
            'execution-scope',
            exitIssue,
          ),
        ]
      : p.issues;
    return {
      ...p,
      issues,
      executionScope,
      progressVersion: PROGRESS_VERSION,
      progress,
      incomplete: incomplete(progress) || issues.length > 0,
    };
  });
  const stages = { 意向沟通: 0, 洽谈: 0, 方案报价: 0, 合同谈判: 0 };
  const customerIndex = indexById(state.customers);
  const saleIndex = indexById(opportunitiesReadable ? state.sales : []);
  const pendingProjectIds = new Set((identity.pending ?? []).map((p) => p.projectId));
  const uncertainSales = new Set(
    state.projects
      .filter((p) => pendingProjectIds.has(p.id) || !stableId(p.id))
      .map((p) => p.opportunityId),
  );
  const opportunities: V10OpportunitySummary[] = [];
  for (const [id, rows] of saleIndex) {
    if (!rows.some((s) => s.type === 'opportunity')) continue;
    if (rows.length !== 1) {
      opportunities.push({
        opportunityId: id,
        customerId: null,
        name: `重复商机ID（${rows.length}条记录）`,
        stage: null,
        salesResult: 'pending',
        convertedToProject: null,
        projects: [],
        progress: null,
        incomplete: true,
        sourceHref: null,
        issues: [issue('opportunity', id, 'ambiguous', 'id', '商机ID重复，未选择任何一条记录')],
      });
      continue;
    }
    const sale = rows[0];
    const issues: V10SourceIssue[] = [];
    const customers = customerIndex.get(sale.customerId) ?? [];
    if (!customersReadable)
      issues.push(
        issue('opportunity', id, 'unavailable', 'customers', '客户来源未成功读取或来源声明矛盾'),
      );
    else if (customers.length !== 1)
      issues.push(
        issue(
          'opportunity',
          id,
          customers.length ? 'ambiguous' : 'missing',
          'customerId',
          '客户关联缺失或稳定ID重复',
        ),
      );
    const salesResult =
      sale.stage === '赢单'
        ? 'won'
        : sale.stage === '丢单'
          ? 'lost'
          : Object.hasOwn(stages, sale.stage)
            ? 'open'
            : 'pending';
    if (salesResult === 'pending')
      issues.push(
        issue('opportunity', id, 'invalid', 'stage', '未知销售阶段，未计入在售或赢丢单分母'),
      );
    const linked = reliable
      .filter((p) => p.opportunityId === id)
      .map((p) => ({ projectId: p.projectId!, name: p.name, sourceHref: p.sourceHref! }));
    const progress =
      customersReadable && customers.length === 1
        ? selectLifecycleProgress(state, id, null, context.dates)
        : null;
    opportunities.push({
      opportunityId: id,
      customerId: stableId(sale.customerId) ? sale.customerId : null,
      name: sale.projectName,
      stage: sale.stage,
      salesResult,
      convertedToProject: linked.length
        ? true
        : uncertainSales.has(id) || identity.counts === null
          ? null
          : false,
      projects: linked,
      progress,
      incomplete: incomplete(progress),
      sourceHref: `/sales/detail/${encodeURIComponent(id)}`,
      issues,
    });
  }
  if (opportunitiesReadable)
    state.sales
      .filter((s) => s.type === 'opportunity' && !stableId(s.id))
      .forEach((s, index) => {
        opportunities.push({
          opportunityId: null,
          customerId: null,
          name: s.projectName,
          stage: null,
          salesResult: 'pending',
          convertedToProject: null,
          projects: [],
          progress: null,
          incomplete: true,
          sourceHref: null,
          issues: [
            issue(
              'opportunity',
              null,
              'missing',
              `id:${index}`,
              '商机缺少稳定ID，不计入稳定商机数',
            ),
          ],
        });
      });
  const identifiedOpportunities = opportunities.filter((o) => o.opportunityId !== null);
  const matchedProjects = projects.filter(
    (p) => normalized.executionScope === 'all' || p.executionScope === normalized.executionScope,
  );
  for (const o of opportunities)
    if (o.stage && Object.hasOwn(stages, o.stage)) stages[o.stage as keyof typeof stages]++;
  const matched = opportunities.filter(
    (o) =>
      normalized.presalesScope === 'all' ||
      (normalized.presalesScope === 'converted'
        ? o.convertedToProject === true
        : normalized.presalesScope === 'pipeline'
          ? o.salesResult === 'open'
          : o.salesResult === normalized.presalesScope),
  );
  return {
    contractVersion: V10_PORTFOLIO_CONTRACT_VERSION,
    workspaceId: identity.workspaceId,
    roundId: identity.roundId,
    dataVersion: identity.dataVersion,
    contextRevision: identity.contextRevision,
    dates: identity.dates,
    sources: identity.sources,
    units: identity.units,
    scope: 'business-portfolio',
    filters: normalized,
    issues: [
      ...identity.issues,
      ...sourceIssues,
      ...opportunities.flatMap((o) => o.issues),
      ...projects.flatMap((p) => p.issues),
    ],
    presales: {
      status: !opportunitiesReadable
        ? context.sources.opportunities === 'loading' && !contextInvalid
          ? 'loading'
          : 'unavailable'
        : opportunities.length
          ? 'ready'
          : 'empty',
      counts: opportunitiesReadable
        ? {
            opportunityCount: identifiedOpportunities.length,
            pipelineCount: Object.values(stages).reduce((sum, count) => sum + count, 0),
            stages,
            wonCount: opportunities.filter((o) => o.salesResult === 'won').length,
            lostCount: opportunities.filter((o) => o.salesResult === 'lost').length,
            unknownStageCount: identifiedOpportunities.filter((o) => o.salesResult === 'pending')
              .length,
            convertedCount: opportunities.some((o) => o.convertedToProject === null)
              ? null
              : opportunities.filter((o) => o.convertedToProject).length,
            matchedCount: matched.length,
          }
        : null,
      opportunities: opportunitiesReadable ? matched : null,
    },
    execution: {
      status: identity.status,
      counts: identity.counts
        ? {
            projectCount: projects.length,
            activeCount: projects.filter((p) => p.executionScope === 'active').length,
            completedCount: projects.filter((p) => p.executionScope === 'completed').length,
            cancelledCount: projects.filter((p) => p.executionScope === 'cancelled').length,
            matchedCount: matchedProjects.length,
          }
        : null,
      projects: identity.counts ? matchedProjects : null,
      unidentified: identity.counts
        ? (identity.pending ?? []).filter((p) => p.projectId === null)
        : null,
    },
  };
}
