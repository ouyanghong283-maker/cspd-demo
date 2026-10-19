import type { CustomerDeliveryMapping, DemoState, Plan, Project } from '../models';
import { isValidISODate } from '../rules';
import { indexById, stableId } from './identity-index';

export function deliveryCategory(
  state: Readonly<DemoState>,
  projectId: string,
  plan: Pick<Plan, 'id' | 'type' | 'completionKind'>,
): CustomerDeliveryMapping['category'] | null {
  if (plan.type === '内部WBS' && plan.completionKind === 'acceptance') return 'customerAcceptance';
  if (plan.type === '要货发货') return 'shipment';
  const groups = (state.progressGroupMappings ?? []).filter(
    (m) => m.projectId === projectId && m.groupId === 'shipping',
  );
  return plan.type === '内部WBS' &&
    !plan.completionKind &&
    groups.length === 1 &&
    groups[0].planIds.includes(plan.id)
    ? 'shipment'
    : null;
}

/** 核验当前来源，不使用旧显示名称补造关联。 */
export function liveDeliverySource(
  state: Readonly<DemoState>,
  project: Project,
  mapping: CustomerDeliveryMapping,
) {
  const plans = indexById(project.plans);
  const sources = plans.get(mapping.planId) ?? [];
  const milestones = plans.get(mapping.customerMilestoneId) ?? [];
  const plan = sources.length === 1 ? sources[0] : null;
  const milestone =
    milestones.length === 1 && milestones[0].type === '客户主节点' ? milestones[0] : null;
  const bindings = (state.projectMilestoneBindings ?? []).filter(
    (b) => b.projectId === project.id && b.sourcePlanId === mapping.planId,
  );
  const targets = new Set(bindings.map((b) => b.customerMilestoneId));
  const target = plan?.customerMilestoneId || (targets.size === 1 ? [...targets][0] : null);
  const unique =
    stableId(mapping.id) &&
    (state.customerDeliveryMappings ?? []).filter((m) => m.id === mapping.id).length === 1 &&
    (state.customerDeliveryMappings ?? []).filter(
      (m) =>
        m.projectId === project.id &&
        (m.planId === mapping.planId || m.customerMilestoneId === mapping.customerMilestoneId),
    ).length === 1;
  const reliable =
    unique &&
    plan &&
    milestone &&
    stableId(mapping.source) &&
    Number.isSafeInteger(mapping.revision) &&
    mapping.revision > 0 &&
    deliveryCategory(state, project.id, plan) === mapping.category &&
    plan.id !== milestone.id &&
    target === milestone.id &&
    [...targets].every((id) => id === milestone.id);
  return {
    plan,
    milestone,
    reliable: !!reliable,
    sourceCount: sources.length,
    milestoneCount: milestones.length,
  };
}

/** 留存仅接受本轮、同一稳定来源及合法客户约定日期；未知或损坏记录不能冒充历史。 */
export function retainedDeliverySource(
  state: Readonly<DemoState>,
  mapping: CustomerDeliveryMapping,
) {
  const snapshot = mapping.retained;
  if (
    !snapshot ||
    !snapshot.plan ||
    !snapshot.milestone ||
    snapshot.roundId !== state.roundId ||
    !stableId(snapshot.roundId) ||
    !Number.isSafeInteger(snapshot.dataVersion) ||
    snapshot.dataVersion < 1 ||
    snapshot.dataVersion > (state.dataVersion ?? 1) ||
    snapshot.mappingId !== mapping.id ||
    snapshot.projectId !== mapping.projectId ||
    snapshot.category !== mapping.category ||
    snapshot.mappingRevision !== mapping.revision ||
    !Number.isSafeInteger(mapping.revision) ||
    mapping.revision < 1 ||
    !stableId(mapping.id) ||
    !stableId(mapping.projectId) ||
    !['shipment', 'customerAcceptance'].includes(mapping.category) ||
    snapshot.plan.id !== mapping.planId ||
    snapshot.plan.customerMilestoneId !== mapping.customerMilestoneId ||
    snapshot.milestone.id !== mapping.customerMilestoneId ||
    snapshot.milestone.type !== '客户主节点' ||
    snapshot.plan.id === snapshot.milestone.id ||
    !isValidISODate(snapshot.milestone.end)
  )
    return null;
  return snapshot;
}

/** 仅由保存／初始化调用；不开放客户承诺配置或解除入口。 */
export function registerDeliveryPlan(state: DemoState, project: Project, planId: string): void {
  if (
    (state.customerDeliveryMappings ?? []).some(
      (m) => m.projectId === project.id && m.planId === planId,
    )
  )
    return;
  const plans = project.plans.filter((p) => p.id === planId);
  if (plans.length !== 1 || !stableId(planId)) return;
  const plan = plans[0];
  const category = deliveryCategory(state, project.id, plan);
  if (!category) return;
  const bindings = (state.projectMilestoneBindings ?? []).filter(
    (b) => b.projectId === project.id && b.sourcePlanId === plan.id,
  );
  const targets = new Set(
    [plan.customerMilestoneId, ...bindings.map((b) => b.customerMilestoneId)].filter(stableId),
  );
  if (targets.size !== 1) return;
  const customerMilestoneId = [...targets][0];
  const milestones = project.plans.filter(
    (p) => p.id === customerMilestoneId && p.type === '客户主节点',
  );
  if (milestones.length !== 1) return;
  state.customerDeliveryMappings ??= [];
  state.customerDeliveryMappings.push({
    id: `delivery:${JSON.stringify([project.id, plan.id, customerMilestoneId, category])}`,
    projectId: project.id,
    planId: plan.id,
    customerMilestoneId,
    category,
    source: '稳定关联',
    revision: 1,
  });
}

/** 只在首次升级时从未被名称兼容修复的原快照恢复明确来源。 */
export function initializeDeliveryRetention(
  state: DemoState,
  original: Readonly<DemoState> | null = state,
): void {
  if (!stableId(state.roundId)) return;
  if (state.customerDeliveryRetentionVersion !== 1) {
    const source = original === state ? state : structuredClone(original);
    if (!source) throw Error('承诺原文不可读');
    if (source.customerDeliveryRetentionVersion !== 1)
      for (const projects of indexById(source.projects).values()) {
        if (projects.length !== 1) continue;
        for (const plan of projects[0].plans) registerDeliveryPlan(source, projects[0], plan.id);
      }
    state.customerDeliveryMappings = source.customerDeliveryMappings;
    state.customerDeliveryRetentionVersion = 1;
  }
  retainDeliveryCommitments(state);
}

/** 保存前后在候选快照内捕获；变更失败时留存及业务一并不发布。 */
export function retainDeliveryCommitments(state: DemoState): void {
  if (!stableId(state.roundId)) return;
  const projects = indexById(state.projects);
  for (const mapping of state.customerDeliveryMappings ?? []) {
    if ((projects.get(mapping.projectId) ?? []).length !== 1) continue;
    const project = projects.get(mapping.projectId)![0];
    const live = liveDeliverySource(state, project, mapping);
    const previous = retainedDeliverySource(state, mapping);
    const p = live.reliable ? live.plan : live.sourceCount === 0 ? previous?.plan : null;
    const m = live.milestone;
    if (!p || !m || !isValidISODate(m.end)) continue;
    const candidate: NonNullable<CustomerDeliveryMapping['retained']> = {
      roundId: state.roundId,
      dataVersion: state.dataVersion ?? 1,
      mappingRevision: mapping.revision,
      mappingId: mapping.id,
      projectId: mapping.projectId,
      category: mapping.category,
      // 保留不可变的原来源元数据，历史核对不依赖后续计划字段选择。
      plan: structuredClone(p),
      milestone: structuredClone(m),
    };
    if (
      JSON.stringify({ ...mapping.retained, dataVersion: candidate.dataVersion }) !==
      JSON.stringify(candidate)
    )
      mapping.retained = candidate;
  }
}
