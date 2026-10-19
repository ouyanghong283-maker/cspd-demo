import type { DemoState, FinanceInvoice } from './models';

/**
 * Contract-owned invoice facts and calculation contract shared by contract,
 * project and receipt-claim screens. This module has no store dependencies so
 * callers can calculate a preview before committing a full workspace update.
 */
export type InvoiceBalanceSource = '有效认领汇总' | '历史模拟累计额' | '尚无回款来源';

export interface InvoiceReceiptClaim {
  id: string;
  invoiceId: string;
  amount: number;
  currency: string;
  status: '有效' | '撤销' | '待核';
  receivedAt?: string;
  sourceReference?: string;
}

/** Contract is the owner; projectIds are references only and never own copies. */
export interface ContractInvoice extends FinanceInvoice {
  contractId: string;
  projectIds: string[];
  revision: number;
  updatedAt: string;
  cumulativeSource: 'legacy-simulation' | 'claims';
  /** Frozen opening amount retained when real local claim details become the active source. */
  legacyReceived?: number;
  /** Link to the contract/project milestone used with the payment term. */
  dueMilestoneId?: string;
  dueProjectId?: string;
  dueMilestoneName?: string;
  dueMilestoneActualDate?: string;
  dueMilestoneExpectedDate?: string;
  dueMilestoneStatus?: string;
  dueMilestoneSourceReference?: string;
  paymentTermDays?: number;
  crmFields?: Record<string, unknown>;
  crmReadOnly?: Record<string, unknown>;
  systemFields?: Record<string, unknown>;
  currencyRef?: string;
  sourceFields?: Record<string, unknown>;
  source?: string;
  sourceOriginalAmount?: number;
  sourcePrecision?: number;
}

export interface InvoiceDueFacts {
  effectiveDate: string;
  forecastDate: string;
  source: string;
  actual: boolean;
  milestoneId?: string;
  milestoneDate?: string;
  paymentTermDays?: number;
  overdueDays: number;
}

export interface InvoiceBalanceFacts {
  invoiceId: string;
  currency: string;
  amount: number;
  received: number;
  balance: number;
  balanceCents: number;
  balanceSource: InvoiceBalanceSource;
  due: InvoiceDueFacts;
  status: '未开票' | '待回款' | '已收齐' | '数据异常：负余额';
}

export interface InvoiceCurrencyTotal {
  currency: string;
  amount: number;
  received: number;
  balance: number;
  invoiceCount: number;
}

const CENTS_PER_UNIT = 100;

/** Round at the source fact boundary so binary floating point tails cannot create debt. */
export function invoiceCents(amount: number | null | undefined): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 0;
  return Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * CENTS_PER_UNIT);
}

export function invoiceAmount(cents: number): number {
  return cents / CENTS_PER_UNIT;
}

function validDate(value?: string): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function dayDifference(later: string, earlier: string): number {
  return Math.floor((Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / 86400000);
}

/**
 * A date is actual only when it comes from an explicit agreed date or a valid
 * actual milestone date plus a nonnegative integer term. Forecast-only dates
 * are returned separately and can never produce overdue days.
 */
export function invoiceDueFacts(invoice: ContractInvoice, asOfDate: string): InvoiceDueFacts {
  const term = invoice.paymentTermDays;
  const hasTerm = Number.isInteger(term) && (term as number) >= 0;
  const actualMilestoneDate = invoice.dueMilestoneActualDate;
  const expectedMilestoneDate = invoice.dueMilestoneExpectedDate;
  let effectiveDate = '';
  let forecastDate = '';
  let source = '无法判断：缺少有效约定日期或实际节点账期';
  let actual = false;
  let milestoneDate: string | undefined;

  if (invoice.due) {
    if (validDate(invoice.due)) {
      effectiveDate = invoice.due;
      source = '发票约定到期日';
      actual = true;
    } else {
      source = '无法判断：发票约定到期日格式无效';
    }
  } else if (
    invoice.dueMilestoneStatus === '已完成' &&
    validDate(actualMilestoneDate) &&
    hasTerm
  ) {
    milestoneDate = actualMilestoneDate!;
    effectiveDate = addDays(milestoneDate, term as number);
    source = '实际节点完成日＋账期';
    actual = true;
  } else if (validDate(expectedMilestoneDate) && hasTerm) {
    milestoneDate = expectedMilestoneDate!;
    forecastDate = addDays(milestoneDate, term as number);
    source = '预计节点日期＋账期（仅预测，不判实际逾期）';
  }

  const overdueDays = actual && effectiveDate && validDate(asOfDate)
    ? Math.max(0, dayDifference(asOfDate, effectiveDate))
    : 0;
  return {
    effectiveDate,
    forecastDate,
    source,
    actual,
    milestoneId: invoice.dueMilestoneId,
    milestoneDate,
    paymentTermDays: hasTerm ? term : undefined,
    overdueDays,
  };
}

function validClaims(invoice: ContractInvoice, claims: readonly InvoiceReceiptClaim[]): InvoiceReceiptClaim[] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    if (
      !claim.id.trim() ||
      claim.invoiceId !== invoice.id ||
      claim.status !== '有效' ||
      claim.currency !== invoice.currency ||
      seen.has(claim.id)
    )
      return false;
    seen.add(claim.id);
    return true;
  });
}

/** Calculate a single invoice, preferring valid claim detail when that is the declared source. */
export function calculateInvoiceBalance(
  invoice: ContractInvoice,
  claims: readonly InvoiceReceiptClaim[],
  asOfDate: string,
): InvoiceBalanceFacts {
  const amountCents = invoiceCents(invoice.amount);
  const activeClaims = validClaims(invoice, claims);
  const useClaims = invoice.cumulativeSource === 'claims';
  const balanceSource: InvoiceBalanceSource = useClaims
    ? '有效认领汇总'
    : '历史模拟累计额';
  const receivedCents = useClaims
    ? invoiceCents(invoice.legacyReceived) + activeClaims.reduce((total, claim) => total + invoiceCents(claim.amount), 0)
    : invoiceCents(invoice.received);
  const balanceCents = amountCents - receivedCents;
  const status: InvoiceBalanceFacts['status'] = amountCents <= 0
    ? '未开票'
    : balanceCents < 0
      ? '数据异常：负余额'
      : balanceCents === 0
        ? '已收齐'
        : '待回款';
  const due = invoiceDueFacts(invoice, asOfDate);
  return {
    invoiceId: invoice.id,
    currency: invoice.currency,
    amount: invoiceAmount(amountCents),
    received: invoiceAmount(receivedCents),
    balance: invoiceAmount(balanceCents),
    balanceCents,
    balanceSource,
    due: { ...due, overdueDays: balanceCents > 0 ? due.overdueDays : 0 },
    status,
  };
}

/**
 * Consolidate shared project references by stable invoice ID before summing.
 * First occurrence is retained as the contract-owned fact; callers should
 * treat duplicate IDs with conflicting values as a data-integrity warning.
 */
export function uniqueInvoicesById(invoices: readonly ContractInvoice[]): ContractInvoice[] {
  const seen = new Set<string>();
  return invoices.filter((invoice) => {
    if (seen.has(invoice.id)) return false;
    seen.add(invoice.id);
    return true;
  });
}

/** Aggregate per currency, after invoice-ID de-duplication. */
export function summarizeInvoicesByCurrency(
  invoices: readonly ContractInvoice[],
  claims: readonly InvoiceReceiptClaim[],
  asOfDate: string,
): InvoiceCurrencyTotal[] {
  const totals = new Map<string, { amount: number; received: number; balance: number; invoiceCount: number }>();
  for (const invoice of uniqueInvoicesById(invoices)) {
    const facts = calculateInvoiceBalance(invoice, claims, asOfDate);
    const total = totals.get(facts.currency) || { amount: 0, received: 0, balance: 0, invoiceCount: 0 };
    total.amount += invoiceCents(facts.amount);
    total.received += invoiceCents(facts.received);
    total.balance += facts.balanceCents;
    total.invoiceCount += 1;
    totals.set(facts.currency, total);
  }
  return [...totals.entries()].map(([currency, total]) => ({
    currency,
    amount: invoiceAmount(total.amount),
    received: invoiceAmount(total.received),
    balance: invoiceAmount(total.balance),
    invoiceCount: total.invoiceCount,
  }));
}

/**
 * Move legacy project snapshots into the contract-owned collection. Raw legacy
 * rows remain untouched; unresolved or contradictory relations are recorded
 * for review instead of being guessed.
 */
export function migrateContractInvoices(state: DemoState, sourceProjectId?: string): void {
  type MigratableState = DemoState & { contractInvoices?: ContractInvoice[] };
  const target = state as MigratableState;
  if (target.contractInvoices !== undefined && !Array.isArray(target.contractInvoices))
    throw new Error('存储集合contractInvoices损坏');
  if (state.financeSnapshots !== undefined && !Array.isArray(state.financeSnapshots))
    throw new Error('存储集合financeSnapshots损坏');
  if (!Array.isArray(state.projects)) throw new Error('存储集合projects损坏');
  target.contractInvoices ||= [];
  const canonicalIds = new Set<string>();
  for (const invoice of target.contractInvoices) {
    if (
      !invoice ||
      typeof invoice.id !== 'string' ||
      !invoice.id.trim() ||
      typeof invoice.contractId !== 'string' ||
      !invoice.contractId.trim() ||
      !Array.isArray(invoice.projectIds) ||
      !['legacy-simulation', 'claims'].includes(invoice.cumulativeSource)
    )
      throw new Error('合同发票迁移失败：规范发票记录缺少稳定ID、合同关联、项目集合或累计来源');
    if (canonicalIds.has(invoice.id)) throw new Error(`合同发票迁移失败：规范发票ID重复${invoice.id}`);
    canonicalIds.add(invoice.id);
  }
  if (state.invoiceSchemaVersion === 1 && !sourceProjectId) return;
  const review = (invoiceId: string, relation: string, reason: string) => {
    state.migrationReviewItems ||= [];
    const id = `MIGRATION-REVIEW-invoice-${invoiceId}-${relation}`;
    if (state.migrationReviewItems.some((item) => item.id === id)) return;
    state.migrationReviewItems.push({
      id,
      entityType: 'invoice',
      entityId: invoiceId,
      relation,
      reason,
    });
  };
  const rows = new Map<string, { invoice: FinanceInvoice; projectId: string; contractId: string }[]>();
  for (const snapshot of state.financeSnapshots || []) {
    if (sourceProjectId && snapshot.projectId !== sourceProjectId) continue;
    if (!Array.isArray(snapshot.invoices)) throw new Error(`旧财务快照${snapshot.projectId}的发票集合损坏`);
    for (const [index, invoice] of snapshot.invoices.entries()) {
      const invoiceId = typeof invoice.id === 'string' ? invoice.id.trim() : '';
      if (!invoiceId) {
        state.migrationReviewItems ||= [];
        const entityId = snapshot.projectId || '未知项目';
        const relation = `invoiceId-${index}`;
        const id = `MIGRATION-REVIEW-invoice-${entityId}-${relation}`;
        if (!state.migrationReviewItems.some((item) => item.id === id))
          state.migrationReviewItems.push({
            id,
            entityType: 'invoice',
            entityId,
            relation,
            reason: `旧项目发票记录第${index + 1}项缺少稳定发票ID；原记录保留，未生成新ID，请人工核对。`,
          });
        continue;
      }
      const project = state.projects.find((candidate) => candidate.id === snapshot.projectId);
      const contractId = project?.contractId || '';
      const matches = rows.get(invoiceId) || [];
      matches.push({ invoice, projectId: snapshot.projectId, contractId });
      rows.set(invoiceId, matches);
    }
  }

  for (const [invoiceId, copies] of rows) {
    const current = target.contractInvoices.find((invoice) => invoice.id === invoiceId);
    if (current) {
      const conflicting = copies.some(({ contractId }) => !contractId || contractId !== current.contractId);
      if (conflicting) {
        review(invoiceId, 'contractId', '现有合同发票与旧项目快照的合同关联不一致；保留当前主记录及旧快照，待核。');
        continue;
      }
      current.projectIds = [...new Set([...current.projectIds, ...copies.map((copy) => copy.projectId)])];
      continue;
    }
    const linked = copies.filter((copy) => copy.contractId);
    if (!linked.length) {
      review(invoiceId, 'contractId', '旧发票保留在项目财务快照中，但项目缺少可确认的合同ID；待核后再迁移。');
      continue;
    }
    const contractIds = new Set(linked.map((copy) => copy.contractId));
    const knownContractIds = new Set((state.contracts || []).map((contract) => contract.id));
    if (
      contractIds.size !== 1 ||
      linked.length !== copies.length ||
      !knownContractIds.has(linked[0].contractId)
    ) {
      review(invoiceId, 'contractId', '相同旧发票ID关联到不同合同或存在缺失合同关联；原记录保留，未自动合并。');
      continue;
    }
    const canonical = linked[0].invoice;
    const conflicts = linked.some(({ invoice }) =>
      invoice.number !== canonical.number ||
      invoiceCents(invoice.amount) !== invoiceCents(canonical.amount) ||
      invoice.currency !== canonical.currency ||
      invoice.issued !== canonical.issued ||
      invoice.due !== canonical.due ||
      invoiceCents(invoice.received) !== invoiceCents(canonical.received),
    );
    if (conflicts) {
      review(invoiceId, 'duplicateSnapshot', '同一发票ID的旧项目快照字段不一致；保留原快照，等待确认合同主记录。');
      continue;
    }

    const projectIds = [...new Set(linked.map((copy) => copy.projectId))];
    target.contractInvoices.push({
      ...canonical,
      id: invoiceId,
      contractId: linked[0].contractId,
      projectIds,
      revision: 1,
      updatedAt: '',
      cumulativeSource: 'legacy-simulation',
      source: '旧项目 FinanceSnapshot（历史模拟累计额）',
      sourceOriginalAmount: canonical.amount,
      sourcePrecision: undefined,
      sourceFields: {
        legacySource: 'financeSnapshots',
        sourceProjectIds: projectIds,
        originalRows: linked.map(({ invoice, projectId }) => ({ projectId, ...invoice })),
      },
    });
  }
}
