import type { Plan } from './models';
import { invoiceAmount, invoiceCents } from './invoices';

/**
 * V8 内部WBS预计预算的纯规则模块（BUD01–BUD04）。
 *
 * 三条不可让步的口径：
 * 1. 预算与开票回款语义隔离：Plan.amount / Plan.currency 是回款字段，永不迁移为预算。
 * 2. 缺值就是缺值：未填写不等于 0，也不显示为 0；显示“预算待补”并给出待补任务数。
 * 3. 分币种精确汇总：复用既有最小货币单位（分）工具，不做跨币种换算、不做父子重复加总。
 *
 * 本模块不读取全局状态，调用方传入计划数组即可，便于单测与多视图同源复用。
 */

export const BUDGET_CURRENCIES = ['CNY', 'EUR', 'USD'] as const;
export type BudgetCurrency = (typeof BUDGET_CURRENCIES)[number];

export const BUDGET_CURRENCY_OPTIONS: ReadonlyArray<{ value: BudgetCurrency; label: string }> = [
  { value: 'CNY', label: 'CNY 人民币' },
  { value: 'EUR', label: 'EUR 欧元' },
  { value: 'USD', label: 'USD 美元' },
];

export const BUDGET_PENDING_TEXT = '预算待补';
export const BUDGET_REVIEW_TEXT = '币种待核';

/** 预算来源：样例模拟值绝不冒充业务原值。 */
export type BudgetSource = '模拟' | '业务填报' | '待核';

export type BudgetIssue =
  | 'amount-missing'
  | 'amount-invalid'
  | 'amount-negative'
  | 'amount-precision'
  | 'currency-missing'
  | 'currency-invalid';

const BUDGET_ISSUE_TEXT: Record<BudgetIssue, string> = {
  'amount-missing': '请填写预计预算金额；内部WBS保存时预算金额与币种必须齐全',
  'amount-invalid': '预计预算金额必须是有效数字，不能为 NaN 或无穷',
  'amount-negative': '预计预算金额不能为负数',
  'amount-precision': '预计预算金额最多两位小数，请修正后再保存（不会自动截断）',
  'currency-missing': '请选择预计预算币种，可选 CNY / EUR / USD',
  'currency-invalid': '预计预算币种只能是 CNY / EUR / USD；其他币种请先核对来源，不做自动换算',
};

export function isValidBudgetCurrency(value: unknown): value is BudgetCurrency {
  return typeof value === 'string' && (BUDGET_CURRENCIES as readonly string[]).includes(value);
}

/** 两位小数口径：超过两位即要求修正，绝不静默截断成看似相等的金额。 */
function budgetPrecisionIssue(amount: number): boolean {
  return Math.abs(Number(amount.toFixed(2)) - amount) > 1e-9;
}

export interface BudgetAmountValidation {
  cents: number | null;
  issues: BudgetIssue[];
}

export function validateBudgetAmount(amount: unknown): BudgetAmountValidation {
  if (amount === undefined || amount === null || amount === '')
    return { cents: null, issues: ['amount-missing'] };
  if (typeof amount !== 'number' || !Number.isFinite(amount))
    return { cents: null, issues: ['amount-invalid'] };
  if (amount < 0) return { cents: null, issues: ['amount-negative'] };
  if (budgetPrecisionIssue(amount)) return { cents: null, issues: ['amount-precision'] };
  return { cents: invoiceCents(amount), issues: [] };
}

export interface BudgetValidationResult {
  valid: boolean;
  issues: BudgetIssue[];
  /** 需要修正时的中文提示；全部合法时为空串。 */
  message: string;
  /** 规范化后的最小货币单位（分）；仅合法时给出。 */
  cents?: number;
  /** 规范化后的两位小数金额；仅合法时给出。 */
  amount?: number;
  currency?: BudgetCurrency;
}

export function validateBudget(amount: unknown, currency: unknown): BudgetValidationResult {
  const amountValidation = validateBudgetAmount(amount);
  const currencyText = typeof currency === 'string' ? currency.trim() : '';
  const currencyIssues: BudgetIssue[] = !currencyText
    ? ['currency-missing']
    : isValidBudgetCurrency(currencyText)
      ? []
      : ['currency-invalid'];
  const issues = [...amountValidation.issues, ...currencyIssues];
  const valid = issues.length === 0;
  return {
    valid,
    issues,
    message: issues.map((issue) => BUDGET_ISSUE_TEXT[issue]).join('；'),
    ...(valid
      ? {
          cents: amountValidation.cents!,
          amount: invoiceAmount(amountValidation.cents!),
          currency: currencyText as BudgetCurrency,
        }
      : {}),
  };
}

export interface PlanBudgetRead {
  /** 仅“内部WBS”承载预算；其他计划类型读写均不参与预算汇总。 */
  applies: boolean;
  /** 金额已合法填写时的分；null 表示未填或非法。 */
  amountCents: number | null;
  /** 记录中的币种原文，异常币种原样保留（不暗转 CNY）。 */
  currency: string;
  currencyValid: boolean;
  /** 金额与币种都合法时才可计入正式分币种合计。 */
  usable: boolean;
  source: BudgetSource;
}

/**
 * 旧数据兼容读取：只有记录自身带预算金额且币种可信时才算已填。
 * 通用 amount / currency（开票回款）不参与，也绝不把缺失当成 0。
 */
export function readPlanBudget(plan: Plan): PlanBudgetRead {
  if (plan.type !== '内部WBS')
    return {
      applies: false,
      amountCents: null,
      currency: '',
      currencyValid: false,
      usable: false,
      source: '待核',
    };
  const currency = typeof plan.budgetCurrency === 'string' ? plan.budgetCurrency.trim() : '';
  const amountValidation = validateBudgetAmount(plan.budgetAmount);
  const currencyValid = isValidBudgetCurrency(currency);
  return {
    applies: true,
    amountCents: amountValidation.cents,
    currency,
    currencyValid,
    usable: amountValidation.cents !== null && currencyValid,
    source: plan.budgetSource || '待核',
  };
}

export interface BudgetTotal {
  currency: string;
  cents: number;
  amount: number;
  count: number;
}

export interface ProjectBudgetSummary {
  /** 按币种分别的已填部分合计（仅 CNY / EUR / USD）。 */
  filled: BudgetTotal[];
  /** 已取消任务的预算：单独标注，不计入当前有效合计。 */
  cancelled: BudgetTotal[];
  /** 币种缺失或异常的已填任务：不换算、不计入合计，保留待核。 */
  pendingReview: BudgetTotal[];
  filledCount: number;
  cancelledCount: number;
  pendingReviewCount: number;
  /** 未取消任务中预算金额或币种缺失的数量。 */
  missingCount: number;
  missingPlanIds: string[];
  /** 参与统计的内部WBS总数（按稳定 ID 去重后）。 */
  totalCount: number;
  /** 含模拟样例预算的任务数：样例值不冒充业务原值。 */
  simulatedCount: number;
  /** 全部有效内部WBS都已填且币种可信。 */
  complete: boolean;
}

/**
 * 按稳定 projectId + planId 去重；同一稳定计划只计一次，父子/前置关系不重复加总。
 * 记录本身缺稳定 ID 时无法做稳定去重，按行独立计数而不是猜测归属（仅可能出现在
 * 未完成迁移的旧数据里，正常计划始终带 Plan ID）。
 */
function uniquePlans(projectId: string, plans: readonly Plan[]): Plan[] {
  const seen = new Set<string>();
  const result: Plan[] = [];
  plans.forEach((plan, index) => {
    if (plan.type !== '内部WBS') return;
    const key = `${projectId}::${plan.id?.trim() || `#${index}`}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(plan);
  });
  return result;
}

function addTotal(totals: Map<string, BudgetTotal>, currency: string, cents: number): void {
  const bucket = totals.get(currency) || { currency, cents: 0, amount: 0, count: 0 };
  bucket.cents += cents;
  bucket.amount = invoiceAmount(bucket.cents);
  bucket.count += 1;
  totals.set(currency, bucket);
}

function currencyOrder(currency: string): number {
  const index = BUDGET_CURRENCIES.indexOf(currency as BudgetCurrency);
  return index < 0 ? BUDGET_CURRENCIES.length : index;
}

function sortedTotals(totals: Map<string, BudgetTotal>): BudgetTotal[] {
  return [...totals.values()].sort(
    (a, b) =>
      currencyOrder(a.currency) - currencyOrder(b.currency) || a.currency.localeCompare(b.currency),
  );
}

export function summarizeProjectBudget(
  projectId: string,
  plans: readonly Plan[],
): ProjectBudgetSummary {
  const filled = new Map<string, BudgetTotal>();
  const cancelled = new Map<string, BudgetTotal>();
  const pendingReview = new Map<string, BudgetTotal>();
  const missingPlanIds: string[] = [];
  let filledCount = 0;
  let cancelledCount = 0;
  let pendingReviewCount = 0;
  let simulatedCount = 0;
  const scoped = uniquePlans(projectId, plans);

  for (const plan of scoped) {
    const read = readPlanBudget(plan);
    const cancelledTask = plan.status === '已取消';
    if (read.usable) {
      if (read.source === '模拟') simulatedCount += 1;
      if (cancelledTask) {
        addTotal(cancelled, read.currency, read.amountCents!);
        cancelledCount += 1;
      } else {
        addTotal(filled, read.currency, read.amountCents!);
        filledCount += 1;
      }
      continue;
    }
    if (read.amountCents !== null) {
      // 金额已填但币种缺失或异常：保留原文待核，不暗转 CNY、不并入合计。
      // 取消任务同样列出，避免“有金额却哪都不出现”的缺口。
      addTotal(pendingReview, read.currency || BUDGET_REVIEW_TEXT, read.amountCents);
      pendingReviewCount += 1;
      continue;
    }
    // 已取消且金额也未填：不属于当前有效合计，也不计入待补任务数。
    if (cancelledTask) continue;
    missingPlanIds.push(plan.id);
  }

  return {
    filled: sortedTotals(filled),
    cancelled: sortedTotals(cancelled),
    pendingReview: sortedTotals(pendingReview),
    filledCount,
    cancelledCount,
    pendingReviewCount,
    missingCount: missingPlanIds.length,
    missingPlanIds,
    totalCount: scoped.length,
    simulatedCount,
    complete: missingPlanIds.length === 0 && pendingReviewCount === 0,
  };
}

/** 分币种金额文案；未知币种按“金额 + 原文”显示，不改写成 CNY。 */
export function formatBudgetAmount(cents: number, currency: string): string {
  const amount = invoiceAmount(cents);
  if (isValidBudgetCurrency(currency))
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  return `${amount.toFixed(2)} ${currency || BUDGET_REVIEW_TEXT}`;
}

/** 表格单元格文案：待补、待核与正常值区分显示，缺值不显示为 0。 */
export function budgetCellText(plan: Plan): string {
  const read = readPlanBudget(plan);
  if (!read.applies) return '—';
  if (read.usable) {
    const base = formatBudgetAmount(read.amountCents!, read.currency);
    return read.source === '模拟' ? `${base} · 模拟` : base;
  }
  if (read.amountCents !== null)
    return `${formatBudgetAmount(read.amountCents, read.currency)} · ${BUDGET_REVIEW_TEXT}`;
  return BUDGET_PENDING_TEXT;
}
