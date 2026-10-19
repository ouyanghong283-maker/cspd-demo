import type { CustomerDeliveryMapping, DemoState, Project } from '../models';
import { addDaysISO, daysBetweenISO, isValidISODate, isValidWarningLeadDays } from '../rules';
import { selectProjectCompletionFacts } from '../lifecycle-progress/project-completion';
import { selectV10Portfolio } from './portfolio';
import { liveDeliverySource, retainedDeliverySource } from './delivery-sources';
import { V10_DELIVERY_CONTRACT_VERSION } from '../v10-contracts';
import type {
  V10DeliveryNode,
  V10DeliveryStatus,
  V10ProjectDeliveryResult,
  V10QueryContext,
} from '../v10-contracts';

const categories = ['shipment', 'customerAcceptance'] as const;
const planHref = (p: string, id: string) =>
  `/projects/${encodeURIComponent(p)}?tab=plans&planId=${encodeURIComponent(id)}`;

function node(
  state: Readonly<DemoState>,
  context: V10QueryContext,
  project: Project,
  mapping: CustomerDeliveryMapping,
): V10DeliveryNode {
  const live = liveDeliverySource(state, project, mapping);
  const retained = retainedDeliverySource(state, mapping);
  const issues: string[] = [];
  const sourceNotes: string[] = [];
  const source = live.reliable ? live.plan : (retained?.plan ?? live.plan);
  const liveDateValid = live.reliable && isValidISODate(live.milestone?.end);
  const milestone = liveDateValid ? live.milestone : (retained?.milestone ?? live.milestone);
  if (live.reliable && !liveDateValid && retained)
    sourceNotes.push('当前客户日期无效，保留上次已保存的客户约定');
  const reliable = live.reliable || !!retained;
  if (!live.reliable) {
    if (retained)
      sourceNotes.push('来源计划或客户主节点已删除、替换或关联变化，沿用已保存客户承诺');
    else issues.push('承诺映射、来源计划、客户主节点或固定类别关联待核');
  }
  const E = reliable && isValidISODate(milestone?.end) ? milestone.end : null;
  const N =
    reliable && isValidWarningLeadDays(milestone?.warningLeadDays)
      ? milestone.warningLeadDays
      : null;
  let W: string | null = null;
  if (E && N !== null) {
    try {
      const value = addDaysISO(E, -N);
      if (isValidISODate(value)) W = value;
    } catch {
      /* 超出可表示日期范围，返回待补。 */
    }
  }
  if (!E) issues.push('客户承诺日期待补');
  let actual = isValidISODate(source?.actual) ? source.actual : null;
  let businessComplete =
    source?.status === '已完成' &&
    (live.reliable || (live.sourceCount === 0 && live.milestoneCount <= 1 && !!retained));
  const evidence: V10DeliveryNode['evidence'] =
    live.plan && live.sourceCount === 1
      ? [
          {
            kind: '来源计划记录',
            id: live.plan.id,
            sourceHref: planHref(project.id, live.plan.id),
          },
        ]
      : retained
        ? [
            {
              kind: '留存来源计划记录',
              id: `${mapping.id}@${retained.dataVersion}`,
              sourceHref: null,
            },
          ]
        : [];
  if (mapping.category === 'customerAcceptance') {
    const signed =
      project.acceptance.length > 0 &&
      project.acceptance.every((a) => isValidISODate(a.date) && !!a.signer.trim());
    const signedDate = signed
      ? project.acceptance
          .map((a) => a.date)
          .sort()
          .at(-1)
      : null;
    businessComplete =
      (live.reliable ? source?.status === '已完成' : !!retained && live.sourceCount === 0) &&
      !!selectProjectCompletionFacts(state, project).acceptance &&
      signed;
    // 原完成入口同步的BASE_DATE不是签认成绩；采用可回溯的最后合法签认日。
    actual = signedDate ?? null;
    const files = state.attachments.filter(
      (a) => a.entityId === project.id && a.kind === '客户签字清单',
    );
    const usable = files.filter(
      (a) =>
        !a.fileId ||
        !context.fileAvailability[a.fileId] ||
        context.fileAvailability[a.fileId] === 'present',
    );
    businessComplete = businessComplete && usable.length > 0;
    evidence.push(
      ...project.acceptance.map((a) => ({
        kind: '客户逐项签认',
        id: a.id,
        sourceHref: `/projects/${encodeURIComponent(project.id)}?tab=acceptance`,
      })),
      ...usable.map((a) => ({
        kind: a.kind,
        id: a.id,
        sourceHref: `/projects/${encodeURIComponent(project.id)}?tab=acceptance`,
      })),
    );
  }
  const complete = reliable && !!E && businessComplete && actual !== null;
  if (!complete && (N === null || (E && !W))) issues.push('预警天数或预警起点待补');
  const claimsComplete =
    source?.status === '已完成' ||
    (mapping.category === 'customerAcceptance' && project.acceptanceComplete);
  if (claimsComplete && !complete) issues.push('完成依据、复核状态或合法实际日期待核');
  if (source?.status === '已取消' || milestone?.status === '已取消')
    sourceNotes.push('来源计划已取消，不能据此解除客户承诺');
  const D = context.dates.planObservationDate;
  let status: V10DeliveryNode['status'] = 'pending';
  if (complete) status = 'completed';
  else if (E && D > E) status = 'delayed';
  else if (E && W && W <= D && D <= E) status = 'warning';
  else if (E && W && !issues.length && !sourceNotes.length) status = 'normal';
  const delayedDays = status === 'delayed' ? daysBetweenISO(E!, D)! : null;
  const daysUntilDue = !complete && E && D <= E ? daysBetweenISO(D, E)! : null;
  const daysInWarning = status === 'warning' ? daysBetweenISO(W!, D)! : null;
  const completedLateDays = complete && actual! > E! ? daysBetweenISO(E!, actual!)! : null;
  const reason =
    status === 'completed'
      ? completedLateDays
        ? `已完成，逾期完成${completedLateDays}天`
        : '客户承诺已有效完成'
      : status === 'delayed'
        ? `客户承诺延期${delayedDays}天`
        : E === D
          ? '今日到期'
          : status === 'warning'
            ? `距承诺日${daysUntilDue}天，已进入预警${daysInWarning}天`
            : status === 'normal'
              ? '未进入客户承诺预警窗口'
              : [...issues, ...sourceNotes].join('；');
  return {
    mappingId: mapping.id,
    projectId: project.id,
    planId: mapping.planId,
    customerMilestoneId: mapping.customerMilestoneId,
    category: mapping.category,
    source: mapping.source,
    mappingRevision: mapping.revision,
    sourceState: !live.reliable
      ? retained
        ? live.sourceCount === 0 || live.milestoneCount === 0
          ? 'deleted'
          : 'changed'
        : 'unverified'
      : live.plan?.status === '已取消' || live.milestone?.status === '已取消'
        ? 'cancelled'
        : liveDateValid
          ? 'current'
          : 'changed',
    promiseOrigin: liveDateValid ? 'live' : retained ? 'retained' : 'unverified',
    retainedDataVersion: retained?.dataVersion ?? null,
    name: milestone?.name ?? source?.name ?? mapping.id,
    owner: milestone?.owner ?? source?.owner ?? '',
    promisedDate: E,
    warningLeadDays: N,
    warningStart: W,
    actualDate: actual,
    completionValid: complete,
    evidence,
    status,
    overdueCompleted: completedLateDays !== null,
    completedLateDays,
    delayedDays,
    daysUntilDue,
    daysInWarning,
    dueToday: !complete && E === D,
    incomplete: issues.length > 0 || (!complete && sourceNotes.length > 0),
    issues: [...issues, ...sourceNotes],
    reason,
    sourceHref: live.sourceCount === 1 && live.plan ? planHref(project.id, live.plan.id) : null,
    milestoneHref:
      live.milestoneCount === 1 && live.milestone ? planHref(project.id, live.milestone.id) : null,
  };
}

/** 只读取已提交来源；不补种、迁移或写回承诺及业务状态。 */
export function selectV10ProjectDelivery(
  state: Readonly<DemoState>,
  context: V10QueryContext,
  projectId: string,
): V10ProjectDeliveryResult {
  const portfolio = selectV10Portfolio(state, context, { executionScope: 'all' });
  const row = portfolio.execution.projects?.find((p) => p.projectId === projectId);
  const records = state.projects.filter((p) => p.id === projectId);
  const metadata = {
    contractVersion: V10_DELIVERY_CONTRACT_VERSION,
    workspaceId: context.workspaceId,
    roundId: context.roundId,
    dataVersion: context.dataVersion,
    contextRevision: context.contextRevision,
    dates: { ...context.dates },
    sources: { ...context.sources },
    scope: 'project-delivery' as const,
    projectId,
    executionScope: row?.executionScope ?? null,
    issues: [...portfolio.issues],
  };
  if (!portfolio.execution.counts || !row || records.length !== 1)
    return {
      ...metadata,
      status: portfolio.execution.status === 'loading' ? 'loading' : 'unavailable',
      delivery: null,
    };
  const nodes = (state.customerDeliveryMappings ?? [])
    .filter((m) => m.projectId === projectId)
    .map((m) => node(state, context, records[0], m));
  const issues = row.issues.filter((i) => i.field !== 'execution-scope').map((i) => i.reason);
  for (const category of categories)
    if (!nodes.some((n) => n.category === category))
      issues.push(`${category === 'shipment' ? '发货' : '客户验收'}承诺来源待核`);
  const incomplete = issues.length > 0 || nodes.some((n) => n.incomplete);
  const sorted = [...nodes].sort(
    (a, b) =>
      Number(b.status === 'delayed') - Number(a.status === 'delayed') ||
      (a.promisedDate ?? '9999').localeCompare(b.promisedDate ?? '9999') ||
      a.mappingId.localeCompare(b.mappingId),
  );
  const status: V10DeliveryStatus = nodes.some((n) => n.status === 'delayed')
    ? 'delayed'
    : nodes.some((n) => n.status === 'warning')
      ? 'warning'
      : incomplete || nodes.some((n) => n.status === 'pending')
        ? 'pending'
        : 'normal';
  const nextNode = sorted.find((n) => n.status !== 'completed') ?? null;
  const riskNode = sorted.find((n) => n.status === status);
  return {
    ...metadata,
    status: 'ready',
    delivery: {
      status,
      incomplete,
      issues,
      nodes,
      nextNode,
      reason:
        status === 'pending'
          ? [...issues, ...nodes.flatMap((n) => n.issues)].join('；')
          : (riskNode?.reason ?? nextNode?.reason ?? '客户交付节点已完成'),
      historicalLateCompletions: nodes.filter((n) => n.overdueCompleted),
    },
  };
}
