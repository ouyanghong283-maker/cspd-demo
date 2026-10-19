import { knownProjectPersonId } from './plan-person';
/**
 * V8 定向预警投影（08-03）。
 *
 * 本模块只做纯计算：读取已提交快照与一个观察日期，输出稳定的预警事项列表。
 * 风险级别一律来自 08-01 冻结的 `planRisk`，这里不重新判断临期/逾期。
 * 事项身份由 `projectId` + `planId` 决定，名称、部门、日期修改都不会产生新事项。
 */
import { identityForLegacyPlatformName } from './identity';
import { DemoState, Plan, PlanWarningRead, Project } from './models';
import { INTERNAL_PEOPLE } from './personnel';
import { PlanRiskLevel, PlanRiskResult, planRisk } from './rules';

/** 只有客户主节点与内部 WBS 进入定向提醒；其他计划类型仅在公共看板展示。 */
export const WARNING_PLAN_TYPES: readonly string[] = ['客户主节点', '内部WBS'];

export type PlanWarningLevel = 'yellow' | 'red';

export interface PlanWarningRecipient {
  /** 稳定人员身份键；同一人兼任负责人与PM时只出现一次。 */
  personKey: string;
  /** 仅用于显示的人员姓名。 */
  person: string;
  /** 该人因哪些身份接收本条预警。 */
  reasons: ('owner' | 'pm')[];
}

export interface PlanWarning {
  /** 由 projectId + planId 派生的稳定事项ID。 */
  id: string;
  projectId: string;
  planId: string;
  projectName: string;
  planName: string;
  planType: string;
  /** 风险判断依据的计划结束日。 */
  basisDate: string;
  level: PlanWarningLevel;
  label: string;
  /** 负责人原文；未知时为空。 */
  owner: string;
  /** 项目PM原文；未知时为空。 */
  pm: string;
  ownerLabel: string;
  pmLabel: string;
  recipients: PlanWarningRecipient[];
  /** 需要补录的字段，含未知负责人/PM。 */
  missing: string[];
  href: string;
}

export interface PlanRiskRow {
  /** 由 projectId + planId 派生的稳定事项ID。 */
  id: string;
  projectId: string;
  planId: string;
  projectName: string;
  planName: string;
  planType: string;
  /** 风险判断依据的计划结束日。 */
  basisDate: string;
  /** 计划预计完成日，仅供预测展示。 */
  expected: string;
  planStatus: string;
  owner: string;
  pm: string;
  ownerLabel: string;
  pmLabel: string;
  recipients: PlanWarningRecipient[];
  missing: string[];
  href: string;
  riskLevel: PlanRiskLevel;
  label: string;
  /** 看板类别：延期、临近到期、日期待补、预警待设置、已完成（逾期）、正常。 */
  kind: string;
  /** 是否属于需要向负责人/PM 定向提醒的类型。 */
  warningScope: boolean;
  /** 仅在当前处于临期/逾期时存在；临期升逾期沿用同一事项ID。 */
  warning?: PlanWarning;
}

export interface PlanWarningView extends PlanWarning {
  /** 仅当前查看人本人的已读状态。 */
  read: boolean;
}

export interface PlanWarningStats {
  total: number;
  yellow: number;
  red: number;
  unread: number;
  projects: number;
}

const UNKNOWN_PLACEHOLDERS = [
  '待补',
  '待核',
  '待分配',
  '未分配',
  '负责人待核',
  '接收人待核',
  '无',
  '—',
  '-',
  '未知',
];

/** 稳定人员身份键：演示身份绑定优先，其余沿用既有演示人员名单键。 */
export function planWarningPersonKey(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  return identityForLegacyPlatformName(trimmed)?.personId || `demo-person:${trimmed}`;
}

/** 已知人员名单：内部人员目录 + 项目团队现有成员。 */
export function knownPlanPeople(state: DemoState): ReadonlySet<string> {
  const names = new Set<string>(INTERNAL_PEOPLE);
  for (const project of state.projects || []) {
    for (const member of project.team || [])
      if (member.person?.trim()) names.add(member.person.trim());
  }
  return names;
}

export function isKnownPlanPerson(name: string, known?: ReadonlySet<string>): boolean {
  const trimmed = (name || '').trim();
  if (!trimmed || UNKNOWN_PLACEHOLDERS.includes(trimmed)) return false;
  return known ? known.has(trimmed) : INTERNAL_PEOPLE.includes(trimmed);
}

export function planWarningId(projectId: string, planId: string): string {
  return `plan-warning:${projectId.length}:${projectId}:${planId.length}:${planId}`;
}

/** 处理链接定位到正确项目、计划类型与 Plan ID。 */
export function planWarningHref(projectId: string, plan: Pick<Plan, 'id' | 'type'>): string {
  const query = [
    `tab=${encodeURIComponent('计划执行')}`,
    `plan=${encodeURIComponent(plan.type)}`,
    `planId=${encodeURIComponent(plan.id)}`,
  ].join('&');
  return `/projects/${encodeURIComponent(projectId)}?${query}`;
}

/** 计划风险 → 看板类别；分类只在颜色之外提供文字，不引入第二套判断。 */
export function trackingKindForRisk(risk: PlanRiskResult): string {
  switch (risk.label) {
    case '已逾期':
      return '延期';
    case '预警':
      return '临近到期';
    case '日期待补':
      return '日期待补';
    case '预警天数待补':
      return '预警待设置';
    case '已完成（逾期）':
      return '已完成（逾期）';
    default:
      return '正常';
  }
}

/**
 * 全部计划的统一风险投影。看板列表与统计、待办预警区都从这里取数，
 * 保证同一观察日下各视图指向同一份判断。
 */
export function collectPlanRiskRows(state: DemoState, observationDate: string): PlanRiskRow[] {
  const known = knownPlanPeople(state);
  const rows: PlanRiskRow[] = [];
  for (const project of state.projects || []) {
    const pm = (project.pm || '').trim();
    const pmKnown =
      !!knownProjectPersonId(project, pm, project.pmPersonId) || isKnownPlanPerson(pm, known);
    for (const plan of project.plans || []) {
      const risk = planRisk(plan, observationDate);
      rows.push(planRiskRow(project, plan, risk, pm, pmKnown, known));
    }
  }
  return rows;
}

/**
 * 当前有效的定向预警事项（临期/逾期，且属于客户主节点或内部WBS）。
 * 完成/取消、改期、换人、切档后自动解除；不变更任何业务事实。
 */
export function collectPlanWarnings(state: DemoState, observationDate: string): PlanWarning[] {
  return collectPlanRiskRows(state, observationDate)
    .filter((row) => row.warningScope && !!row.warning)
    .map((row) => row.warning!);
}

/**
 * 预警窗口内被完成或取消而解除的事项：仅保留事实，不再计入有效预警。
 * 用于演示“解除当前预警但保留历史”，不写入新的业务记录。
 */
export function collectPlanWarningHistory(
  state: DemoState,
  observationDate: string,
): PlanRiskRow[] {
  return collectPlanRiskRows(state, observationDate).filter(
    (row) => row.warningScope && (row.planStatus === '已完成' || row.planStatus === '已取消'),
  );
}

export function planWarningsForPerson(
  warnings: readonly PlanWarning[],
  personKey: string,
): PlanWarning[] {
  if (!personKey) return [];
  return warnings.filter((warning) =>
    warning.recipients.some((recipient) => recipient.personKey === personKey),
  );
}

export function isPlanWarningRead(state: DemoState, personKey: string, warningId: string): boolean {
  if (!personKey) return false;
  return (state.planWarningReads || []).some(
    (record) => record.personKey === personKey && record.warningId === warningId,
  );
}

/** 只附加当前查看人本人的已读状态；他人已读与风险颜色不受影响。 */
export function planWarningViews(
  state: DemoState,
  warnings: readonly PlanWarning[],
  personKey: string,
): PlanWarningView[] {
  return warnings.map((warning) => ({
    ...warning,
    read: isPlanWarningRead(state, personKey, warning.id),
  }));
}

export function collectPersonPlanWarningViews(
  state: DemoState,
  personKey: string,
  observationDate: string,
): PlanWarningView[] {
  return planWarningViews(
    state,
    planWarningsForPerson(collectPlanWarnings(state, observationDate), personKey),
    personKey,
  );
}

export function planWarningStats(warnings: readonly PlanWarningView[]): PlanWarningStats {
  const projects = new Set<string>();
  let yellow = 0;
  let red = 0;
  let unread = 0;
  for (const warning of warnings) {
    projects.add(warning.projectId);
    if (warning.level === 'yellow') yellow += 1;
    if (warning.level === 'red') red += 1;
    if (!warning.read) unread += 1;
  }
  return { total: warnings.length, yellow, red, unread, projects: projects.size };
}

/** 已读记录只增不改；同一人同一事项只保留一条。 */
export function appendPlanWarningRead(
  state: DemoState,
  personKey: string,
  warningId: string,
  readAt: string,
): PlanWarningRead[] {
  const records = state.planWarningReads || [];
  if (records.some((record) => record.personKey === personKey && record.warningId === warningId)) {
    return [...records];
  }
  return [...records, { personKey, warningId, readAt }];
}

function planRiskRow(
  project: Project,
  plan: Plan,
  risk: PlanRiskResult,
  pm: string,
  pmKnown: boolean,
  known: ReadonlySet<string>,
): PlanRiskRow {
  const owner = (plan.owner || '').trim();
  const ownerKnown =
    !!knownProjectPersonId(project, owner, plan.ownerPersonId) || isKnownPlanPerson(owner, known);
  const missing = [...risk.missing];
  if (!ownerKnown) missing.push('计划负责人待补');
  if (!pmKnown) missing.push('项目PM待补');
  const warningScope = WARNING_PLAN_TYPES.includes(plan.type);
  const active = risk.level === 'yellow' || risk.level === 'red';
  const base = {
    id: planWarningId(project.id, plan.id),
    projectId: project.id,
    planId: plan.id,
    projectName: project.name,
    planName: plan.name,
    planType: plan.type,
    basisDate: plan.end,
    expected: plan.expected,
    planStatus: plan.status,
    owner,
    pm,
    ownerLabel: ownerKnown ? owner : '待补',
    pmLabel: pmKnown ? pm : '待补',
    recipients: planWarningRecipients(
      owner,
      ownerKnown,
      pm,
      pmKnown,
      knownProjectPersonId(project, owner, plan.ownerPersonId),
      knownProjectPersonId(project, pm, project.pmPersonId),
    ),
    missing,
    href: planWarningHref(project.id, plan),
  };

  return {
    ...base,
    label: risk.label,
    riskLevel: risk.level,
    kind: trackingKindForRisk(risk),
    warningScope,
    // 定向预警只覆盖客户主节点与内部WBS；临期升逾期只是同一事项的级别更新。
    warning:
      active && warningScope
        ? { ...base, level: risk.level as PlanWarningLevel, label: risk.label }
        : undefined,
  };
}

function planWarningRecipients(
  owner: string,
  ownerKnown: boolean,
  pm: string,
  pmKnown: boolean,
  ownerKey?: string,
  pmKey?: string,
): PlanWarningRecipient[] {
  const recipients: PlanWarningRecipient[] = [];
  const add = (name: string, reason: 'owner' | 'pm', explicitKey?: string): void => {
    const personKey = explicitKey || planWarningPersonKey(name);
    const existing = recipients.find((recipient) => recipient.personKey === personKey);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return;
    }
    recipients.push({ personKey, person: name, reasons: [reason] });
  };
  if (ownerKnown) add(owner, 'owner', ownerKey);
  if (pmKnown) add(pm, 'pm', pmKey);
  return recipients;
}
