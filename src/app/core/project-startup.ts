/**
 * 启动交底与原门禁的唯一规则来源：部门分组、内容归属、显式动作前置与来源版本比较。
 * 视图与 Store 共用这些纯函数，避免页面禁用状态和保存校验各写一套。
 */
import { Role } from './models';

/** 启动交底二级分组，沿用 07 合同管理与项目启动 PRD 的启动页签职责。 */
export const STARTUP_DEPARTMENTS = [
  { key: 'sales', label: '销售', owner: '销售' },
  { key: 'solution', label: '解决方案', owner: '解决方案' },
  { key: 'pm', label: 'PM / PMO', owner: 'PM' },
  { key: 'delivery', label: '订单 / 交付协同', owner: '订单交付' },
] as const;
export type StartupDepartmentKey = (typeof STARTUP_DEPARTMENTS)[number]['key'];

/** 显式门禁动作；仅有这些动作能推进交底、G4 与启动移交的状态。 */
export const STARTUP_ACTIONS = [
  {
    key: 'submit',
    label: '销售发起交底',
    department: 'sales',
    responsible: '销售',
    button: '销售提交交底',
  },
  {
    key: 'confirm',
    label: 'PM确认交底',
    department: 'pm',
    responsible: 'PM',
    button: 'PM确认当前版本',
  },
  {
    key: 'g4',
    label: '启动/G4模拟审核',
    department: 'pm',
    responsible: 'PMO',
    button: '记录 G4 结果',
  },
  {
    key: 'handover',
    label: '启动移交接收',
    department: 'pm',
    responsible: 'PM',
    button: '确认项目启动移交',
  },
] as const;
export type StartupActionKey = (typeof STARTUP_ACTIONS)[number]['key'];

export function startupDepartmentLabel(key: StartupDepartmentKey): string {
  return STARTUP_DEPARTMENTS.find((item) => item.key === key)!.label;
}

/** 操作事件里记录的部门名（PM/PMO 共用分组按 PM 记录，G4 仍记 PMO）。 */
export function startupDepartmentOwner(key: StartupDepartmentKey): string {
  return STARTUP_DEPARTMENTS.find((item) => item.key === key)!.owner;
}

export function startupAction(key: StartupActionKey) {
  return STARTUP_ACTIONS.find((item) => item.key === key)!;
}

/**
 * 模块入口的定位动作：按显式动作顺序取第一个尚未完成的动作；
 * 来源变化后回到"销售重新提交"，全部完成后落在移交动作上展示已完成状态。
 */
export function startupEntryAction(state: StartupEntryState): StartupActionKey {
  return (
    STARTUP_ACTIONS.find((action) => !startupEntryActionDone(action.key, state))?.key ??
    STARTUP_ACTIONS[STARTUP_ACTIONS.length - 1].key
  );
}

/** 模块入口与部门待办共用的启动交底容器目标：页签、部门参数与目标动作。 */
export function startupEntryQuery(state: StartupEntryState): Record<string, string> {
  const action = startupEntryAction(state);
  return {
    tab: 'startup',
    dept: startupDepartmentParam(startupAction(action).department),
    action,
  };
}

function startupEntryActionDone(key: StartupActionKey, state: StartupEntryState): boolean {
  if (key === 'submit') return state.submissionVersion !== null && state.submissionMatchesSource;
  if (key === 'confirm') return state.confirmationVersion === state.submissionVersion;
  if (key === 'g4') return state.g4Result === '通过';
  return state.handoverStatus === '已移交';
}

export type StartupContentKey =
  'start' | 'site' | 'siteConditions' | 'acceptance' | 'production' | 'shipping' | 'commissioning';

export interface StartupContentField {
  key: StartupContentKey;
  label: string;
  /** 唯一维护部门；其他部门只能只读引用 */
  department: StartupDepartmentKey;
  type: 'text' | 'textarea' | 'date';
}

/** 启动内容字段的唯一维护部门，沿用 07 PRD §8.4 与 V6 必填表 116 的启动交底输出项。 */
export const STARTUP_CONTENT_FIELDS: readonly StartupContentField[] = [
  { key: 'start', label: '计划启动日期', department: 'pm', type: 'date' },
  { key: 'site', label: '现场地址', department: 'pm', type: 'text' },
  { key: 'siteConditions', label: '现场条件', department: 'pm', type: 'textarea' },
  { key: 'acceptance', label: '验收标准', department: 'solution', type: 'textarea' },
  { key: 'production', label: '订单生产周期', department: 'delivery', type: 'text' },
  { key: 'shipping', label: '发货周期', department: 'delivery', type: 'text' },
  { key: 'commissioning', label: '调试交期', department: 'delivery', type: 'date' },
];

/**
 * 提交交底时进入来源版本快照的资料类目。
 * 页签内的资料区必须能上传同一组类目，否则该类资料既进不了快照也无法补交。
 */
export const STARTUP_BRIEFING_DOCUMENT_KINDS = ['合同交底', '启动纪要', '启动文件'];

/**
 * 交底关键内容：这组字段既决定项目状态回到"待复核"，也进入交底来源版本快照。
 * 状态提示与门禁比较共用本清单，避免出现"提示待复核但按钮仍可用"的两套口径。
 */
export const STARTUP_SOURCE_CONTENT_KEYS = [
  'start',
  'acceptance',
  'production',
  'shipping',
  'commissioning',
] as const satisfies readonly StartupContentKey[];

export type StartupContentInput = Partial<Record<StartupContentKey, string>>;

/** 启动内容的完整已保存值；页面草稿与 Store 写入共用同一形状。 */
export type StartupContentValues = Record<StartupContentKey, string>;

/** 保存前后是否改动了交底关键内容（未提交交底时的状态判定，与快照口径同源）。 */
export function startupSourceContentChanged(
  before: StartupContentValues,
  after: StartupContentValues,
): boolean {
  return STARTUP_SOURCE_CONTENT_KEYS.some((key) => (before[key] || '') !== (after[key] || ''));
}

/** 启动内容的界面文案，错误提示与来源变化清单共用。 */
export function startupContentLabel(key: StartupContentKey): string {
  return STARTUP_CONTENT_FIELDS.find((field) => field.key === key)?.label || key;
}

export function startupContentFieldsFor(
  department: StartupDepartmentKey,
): readonly StartupContentField[] {
  return STARTUP_CONTENT_FIELDS.filter((field) => field.department === department);
}

/** 返回第一条不满足的保存规则；空字符串表示本部门内容可以保存。 */
export function startupContentError(
  department: StartupDepartmentKey,
  content: StartupContentInput,
): string {
  const owned = new Set(startupContentFieldsFor(department).map((field) => field.key));
  const provided = (Object.keys(content) as StartupContentKey[]).filter(
    (key) => content[key] !== undefined,
  );
  const foreign = provided.filter((key) => !owned.has(key));
  if (foreign.length)
    return foreign
      .map((key) => {
        const owner = startupDepartmentLabel(
          STARTUP_CONTENT_FIELDS.find((item) => item.key === key)?.department ?? department,
        );
        return `启动内容【${startupContentLabel(key)}】由${owner}维护，当前部门不能保存`;
      })
      .join('；');
  return provided.length ? '' : '请填写本部门维护的启动内容';
}

export interface StartupGateDecision {
  allowed: boolean;
  reason: string;
}

export interface StartupGateInput {
  /** PM 已显式接收项目 */
  accepted: boolean;
  /** 关联合同已登记，草稿不算 */
  contractRegistered: boolean;
  /** 已提交的交底版本号；没有提交为空 */
  submissionVersion: number | null;
  /** 当前来源仍与已提交交底快照一致 */
  submissionMatchesSource: boolean;
  /** PM 确认的交底版本号；未确认为空 */
  confirmationVersion: number | null;
  g4Result: string;
  handoverStatus: string;
  /** 演示提交最低条件仍缺的资料 */
  missing: readonly string[];
}

export interface StartupGateActions {
  submit: StartupGateDecision;
  confirm: StartupGateDecision;
  g4: StartupGateDecision;
  handover: StartupGateDecision;
}

export interface StartupGateState extends StartupGateInput {
  exists: boolean;
  /** 原确认依据保留但已不是当前来源，页面上按"待复核"显示 */
  confirmationNeedsReview: boolean;
  /** 已记录交底依据与当前来源不一致的来源项 */
  changedSources: string[];
  actions: StartupGateActions;
}

/** 模块入口定位所需的最小读模型；与门禁读模型取自同一份状态。 */
export type StartupEntryState = Pick<
  StartupGateInput,
  | 'submissionVersion'
  | 'submissionMatchesSource'
  | 'confirmationVersion'
  | 'g4Result'
  | 'handoverStatus'
>;

const ALLOW: StartupGateDecision = { allowed: true, reason: '' };

function blocked(reason: string): StartupGateDecision {
  return { allowed: false, reason };
}

/** 项目未接收或合同未登记时的共用前置说明；满足时返回空交给下一步判断。 */
function startupBaseBlock(input: StartupGateInput, reason: string): StartupGateDecision | null {
  return !input.accepted || !input.contractRegistered ? blocked(reason) : null;
}

function startupSourceChanged(): StartupGateDecision {
  return blocked('合同或启动资料来源已变化，请重新提交并确认交底版本');
}

function submitDecision(input: StartupGateInput): StartupGateDecision {
  if (input.handoverStatus === '已移交' && input.submissionMatchesSource)
    return blocked('启动移交已完成，当前交底版本已锁定');
  return startupBaseBlock(input, '请先关联已登记合同并由PM接收项目') ?? ALLOW;
}

function confirmDecision(input: StartupGateInput): StartupGateDecision {
  if (input.handoverStatus === '已移交') return blocked('启动移交已完成，当前交底确认已锁定');
  if (input.submissionVersion === null) return blocked('销售尚未提交合同交底');
  const base = startupBaseBlock(input, '请先确认项目已接收且合同已登记');
  if (base) return base;
  if (!input.submissionMatchesSource) return blocked('交底来源已变化，请销售重新提交当前版本');
  return ALLOW;
}

function g4Decision(input: StartupGateInput): StartupGateDecision {
  if (input.handoverStatus === '已移交') return blocked('启动移交已完成，当前G4审核已锁定');
  if (input.submissionVersion === null || input.confirmationVersion !== input.submissionVersion)
    return blocked('请先由PM确认最新合同交底版本');
  const base = startupBaseBlock(input, '项目尚未接收或合同尚未登记，不能执行G4审核');
  if (base) return base;
  if (!input.submissionMatchesSource) return startupSourceChanged();
  if (input.missing.length) return blocked(`交底资料仍缺：${input.missing.join('、')}`);
  return ALLOW;
}

function handoverDecision(input: StartupGateInput): StartupGateDecision {
  if (input.handoverStatus === '已移交')
    return { allowed: true, reason: '启动移交已完成，重复确认不新增记录' };
  if (input.submissionVersion === null || input.confirmationVersion !== input.submissionVersion)
    return blocked('请先确认当前合同交底版本');
  const base = startupBaseBlock(input, '项目尚未接收或合同尚未登记，不能完成启动移交');
  if (base) return base;
  if (!input.submissionMatchesSource) return startupSourceChanged();
  if (input.g4Result !== '通过') return blocked('只有G4明确通过后才能完成项目启动移交');
  return ALLOW;
}

/** 每个显式动作按固定顺序返回第一条未满足的前置，供按钮状态和保存校验共同使用。 */
export function startupGateActions(input: StartupGateInput): StartupGateActions {
  return {
    submit: submitDecision(input),
    confirm: confirmDecision(input),
    g4: g4Decision(input),
    handover: handoverDecision(input),
  };
}

export type StartupSourceSnapshot = Readonly<Record<string, unknown>>;

function contractValue(snapshot: StartupSourceSnapshot, key: string): unknown {
  const contract = snapshot['contract'];
  return contract && typeof contract === 'object'
    ? (contract as Record<string, unknown>)[key]
    : undefined;
}

/** 交底快照里参与版本比较的来源项，顺序即展示顺序。 */
const STARTUP_SOURCE_ITEMS: readonly {
  label: string;
  value: (snapshot: StartupSourceSnapshot) => unknown;
}[] = [
  { label: '关联合同', value: (snapshot) => snapshot['contractId'] },
  { label: '报价版本', value: (snapshot) => snapshot['quoteVersionId'] },
  { label: '合同原件版本', value: (snapshot) => snapshot['contractFileVersionId'] || '' },
  { label: '合同标题', value: (snapshot) => contractValue(snapshot, 'title') },
  { label: '合同金额', value: (snapshot) => contractValue(snapshot, 'amount') },
  { label: '合同币种', value: (snapshot) => contractValue(snapshot, 'currency') },
  { label: '合同付款条款', value: (snapshot) => contractValue(snapshot, 'payment') },
  { label: '合同罚则', value: (snapshot) => contractValue(snapshot, 'penalty') },
  { label: '合同产品', value: (snapshot) => contractValue(snapshot, 'product') },
  { label: '合同范围', value: (snapshot) => contractValue(snapshot, 'scope') },
  { label: '项目名称', value: (snapshot) => snapshot['projectName'] },
  { label: '计划启动日期', value: (snapshot) => snapshot['start'] },
  { label: '验收标准', value: (snapshot) => snapshot['acceptance'] },
  { label: '订单生产周期', value: (snapshot) => snapshot['production'] },
  { label: '发货周期', value: (snapshot) => snapshot['shipping'] },
  { label: '调试交期', value: (snapshot) => snapshot['commissioning'] },
  {
    label: '交底资料',
    value: (snapshot) => {
      const attachments = snapshot['attachmentIds'];
      return Array.isArray(attachments) ? [...attachments].sort().join('、') : attachments;
    },
  },
];

/** 列出已记录交底依据与当前来源不一致的项，用于"待复核"提示而不改指新版本。 */
export function changedStartupSources(
  recorded: StartupSourceSnapshot,
  current: StartupSourceSnapshot,
): string[] {
  return STARTUP_SOURCE_ITEMS.filter(
    (item) => JSON.stringify(item.value(recorded)) !== JSON.stringify(item.value(current)),
  ).map((item) => item.label);
}

/**
 * 当前来源是否仍与已提交交底版本一致。
 * 门禁放行、待复核提示和旧数据兼容判断共用同一比较，避免按对象键序比较造成的假变化。
 */
export function startupSourceMatches(
  recorded: StartupSourceSnapshot | undefined,
  current: StartupSourceSnapshot,
): boolean {
  return !!recorded && changedStartupSources(recorded, current).length === 0;
}

export interface StartupLocation {
  /** 需要定位到的部门分组；无法识别时为空，页面回到当前工作视角 */
  department: StartupDepartmentKey | null;
  /** 需要定位到的显式动作；"待复核"不是动作，保持为空 */
  action: StartupActionKey | null;
  review: boolean;
  /** 启动交底内的滚动锚点 id */
  anchor: string | null;
  /** 原样保留的入参，页面提示不丢上下文 */
  departmentParam: string;
  actionParam: string;
}

/** 部门参数别名：项目区 URL、旧启动链接与部门待办沿用各自写法，统一映射到部门键。 */
const DEPARTMENT_PARAM_ALIASES: Readonly<Record<string, StartupDepartmentKey>> = {
  sales: 'sales',
  销售: 'sales',
  销售助理: 'sales',
  销售主管: 'sales',
  solution: 'solution',
  解决方案: 'solution',
  方案: 'solution',
  pm: 'pm',
  pmo: 'pm',
  项目管理: 'pm',
  'pm/pmo': 'pm',
  'pmo/pm': 'pm',
  'pm / pmo': 'pm',
  'pmo / pm': 'pm',
  delivery: 'delivery',
  opm: 'delivery',
  订单交付: 'delivery',
  订单交付协同: 'delivery',
  '订单 / 交付协同': 'delivery',
  交付: 'delivery',
};

const ACTION_PARAM_ALIASES: Readonly<Record<string, StartupActionKey>> = {
  submit: 'submit',
  briefing: 'submit',
  交底: 'submit',
  发起交底: 'submit',
  confirm: 'confirm',
  确认: 'confirm',
  交底确认: 'confirm',
  g4: 'g4',
  audit: 'g4',
  审核: 'g4',
  g4审核: 'g4',
  handover: 'handover',
  receive: 'handover',
  transfer: 'handover',
  移交: 'handover',
  移交接收: 'handover',
};

const REVIEW_PARAMS = new Set(['review', '复核', '待复核', 'source-review']);

function normalizeParam(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function startupDepartmentFromParam(
  value: string | null | undefined,
): StartupDepartmentKey | null {
  return DEPARTMENT_PARAM_ALIASES[normalizeParam(value)] || null;
}

/** 把旧启动链接/部门待办的部门与目标动作换算成启动交底内的部门分组和滚动锚点。 */
export function startupLocation(
  department: string | null | undefined,
  action: string | null | undefined,
): StartupLocation {
  const departmentParam = (department || '').trim();
  const actionParam = (action || '').trim();
  const resolvedDepartment = startupDepartmentFromParam(departmentParam);
  const requested = normalizeParam(actionParam);
  const review = REVIEW_PARAMS.has(requested);
  const resolvedAction = review ? null : ACTION_PARAM_ALIASES[requested] || null;
  return {
    department: resolvedDepartment,
    action: resolvedAction,
    review,
    anchor: resolvedAction
      ? `startup-action-${resolvedAction}`
      : review
        ? 'startup-source-review'
        : resolvedDepartment
          ? `startup-content-${resolvedDepartment}`
          : null,
    departmentParam,
    actionParam,
  };
}

/** 项目区 URL 与部门待办共用的部门参数写法；读回由 DEPARTMENT_PARAM_ALIASES 统一解析。 */
const DEPARTMENT_PARAMS: Readonly<Record<StartupDepartmentKey, string>> = {
  sales: '销售',
  solution: '解决方案',
  pm: 'PMO / PM',
  delivery: '订单交付',
};

/** 把部门键写成 URL/待办可用的部门参数。 */
export function startupDepartmentParam(key: StartupDepartmentKey): string {
  return DEPARTMENT_PARAMS[key];
}

/** 部门分组默认跟随当前工作视角；未登记的视角按 PM/PMO 承接启动工作。 */
export function startupDepartmentForRole(role: Role): StartupDepartmentKey {
  if (role === 'solution') return 'solution';
  if (role === 'opm') return 'delivery';
  if (role === 'sales' || role === 'assistant' || role === 'manager') return 'sales';
  return 'pm';
}

/** 定位提示只写部门和动作名，不暴露内部键。无法识别时不给提示。 */
export function startupLocationHint(location: StartupLocation): string {
  if (!location.department && !location.action && !location.review) return '';
  const label = location.review
    ? '待复核提示'
    : location.action
      ? startupAction(location.action).label
      : null;
  if (!location.department) return `已定位到 ${label}`;
  const department = startupDepartmentLabel(location.department);
  return label ? `已定位到 ${department} · ${label}` : `已定位到 ${department} 部门内容`;
}
