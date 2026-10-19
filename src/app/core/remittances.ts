import type { ContractInvoice, InvoiceReceiptClaim } from './invoices';
import type { SalesOrder } from './orders';

/** Local representation of a water bill / receipt header. CRM source fields stay separate. */
export interface BankReceiptClaim {
  id: string;
  /** Demo-facing receipt number; never generated from a real bank statement. */
  number: string;
  /** Local owning contract selected by stable ID for contract-finance navigation. */
  contractId: string;
  amount: number;
  currency: string;
  status: '有效' | '撤销' | '待核';
  receivedAt?: string;
  crmFields?: Record<string, unknown>;
  sourceFields?: Record<string, unknown>;
  sourceIds?: { alp_claim_water_bill?: string };
}

/** A claim line must point to a known order. Invoice linkage is optional and explicit. */
export interface BankReceiptClaimLine {
  id: string;
  receiptId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: '有效' | '撤销' | '待核';
  /** Local stable invoice ID only; CRM alp_invoice_code is a water-bill header lookup. */
  invoiceId?: string;
  crmFields?: Record<string, unknown>;
  sourceFields?: Record<string, unknown>;
  sourceIds?: { alp_water_bill_claim_details?: string };
}

export type ClaimLineReviewCode =
  | '水单不存在'
  | '订单不存在'
  | '水单与订单合同不一致'
  | '发票不存在'
  | '订单与发票合同不一致'
  | '认领币种与水单不一致'
  | '认领币种与订单不一致'
  | '认领币种与发票不一致'
  | '金额无效';

export interface ClaimLineValidation {
  valid: boolean;
  reviewReasons: ClaimLineReviewCode[];
  order?: SalesOrder;
  invoice?: ContractInvoice;
}

export interface RemittanceCurrencySummary {
  currency: string;
  receiptAmount: number | null;
  claimedAmount: number;
  remainingAmount: number | null;
  lineCount: number;
}

const CENTS_PER_UNIT = 100;

export function remittanceCents(amount: number | null | undefined): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 0;
  return Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * CENTS_PER_UNIT);
}

export function remittanceAmount(cents: number): number {
  return cents / CENTS_PER_UNIT;
}

/** The user-entered demo number is the contract-scoped idempotency key. */
export function remittanceReceiptId(contractId: string, number: string): string {
  return `RECEIPT-${encodeURIComponent(contractId)}-${encodeURIComponent(number.trim().toUpperCase())}`;
}

export function remittancePrimaryLineId(receiptId: string): string {
  return `CLAIM-LINE-${encodeURIComponent(receiptId)}-PRIMARY`;
}

export function exceedsReceiptAmount(
  receipt: BankReceiptClaim,
  lines: readonly BankReceiptClaimLine[],
): boolean {
  if (receipt.status !== '有效') return false;
  const claimedCents = uniqueClaimLines(lines)
    .filter((line) => line.receiptId === receipt.id && line.status === '有效' && line.currency === receipt.currency)
    .reduce((total, line) => total + remittanceCents(line.amount), 0);
  return claimedCents > remittanceCents(receipt.amount);
}

/** Stable IDs make repeated saves idempotent: later copies of an ID are ignored. */
export function uniqueClaimLines(lines: readonly BankReceiptClaimLine[]): BankReceiptClaimLine[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (!line.id.trim() || seen.has(line.id)) return false;
    seen.add(line.id);
    return true;
  });
}

/** Resolve only exact local IDs; labels, CRM names, and lookup display text are never used. */
export function validateClaimLine(
  receipt: BankReceiptClaim | undefined,
  line: BankReceiptClaimLine,
  orders: readonly SalesOrder[],
  invoices: readonly ContractInvoice[],
): ClaimLineValidation {
  const reasons: ClaimLineReviewCode[] = [];
  const order = orders.find((candidate) => candidate.id === line.orderId);
  const invoice = line.invoiceId
    ? invoices.find((candidate) => candidate.id === line.invoiceId)
    : undefined;

  if (!receipt || receipt.id !== line.receiptId) reasons.push('水单不存在');
  if (!order) reasons.push('订单不存在');
  if (receipt && order && receipt.contractId !== order.contractId)
    reasons.push('水单与订单合同不一致');
  if (line.invoiceId && !invoice) reasons.push('发票不存在');
  if (order && invoice && order.contractId !== invoice.contractId)
    reasons.push('订单与发票合同不一致');
  if (receipt && line.currency !== receipt.currency) reasons.push('认领币种与水单不一致');
  if (order && line.currency !== order.currency) reasons.push('认领币种与订单不一致');
  if (invoice && line.currency !== invoice.currency) reasons.push('认领币种与发票不一致');
  if (!Number.isFinite(line.amount) || line.amount < 0) reasons.push('金额无效');

  return { valid: reasons.length === 0, reviewReasons: reasons, order, invoice };
}

/** Sum effective, unique details by currency; only the header currency gets a remaining balance. */
export function summarizeRemittance(
  receipt: BankReceiptClaim,
  lines: readonly BankReceiptClaimLine[],
): RemittanceCurrencySummary[] {
  if (receipt.status !== '有效') return [];
  const totals = new Map<string, { cents: number; lineCount: number }>();
  for (const line of uniqueClaimLines(lines)) {
    if (line.receiptId !== receipt.id || line.status !== '有效') continue;
    if (line.currency !== receipt.currency) continue;
    if (!Number.isFinite(line.amount) || line.amount < 0) continue;
    const bucket = totals.get(line.currency) || { cents: 0, lineCount: 0 };
    bucket.cents += remittanceCents(line.amount);
    bucket.lineCount += 1;
    totals.set(line.currency, bucket);
  }
  return [...totals.entries()].map(([currency, total]) => {
    const sameCurrency = currency === receipt.currency;
    const receiptAmount = sameCurrency ? remittanceAmount(remittanceCents(receipt.amount)) : null;
    const claimedAmount = remittanceAmount(total.cents);
    return {
      currency,
      receiptAmount,
      claimedAmount,
      remainingAmount: receiptAmount === null ? null : remittanceAmount(remittanceCents(receipt.amount) - total.cents),
      lineCount: total.lineCount,
    };
  });
}

/**
 * Bridge valid explicitly invoice-linked details into the invoice balance contract.
 * No CRM lookup is interpreted as an invoice relation; missing invoiceId means no bridge.
 */
export function toInvoiceReceiptClaims(
  receipts: readonly BankReceiptClaim[],
  lines: readonly BankReceiptClaimLine[],
  orders: readonly SalesOrder[],
  invoices: readonly ContractInvoice[],
): InvoiceReceiptClaim[] {
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const seen = new Set<string>();
  const result: InvoiceReceiptClaim[] = [];
  for (const line of uniqueClaimLines(lines)) {
    if (!line.invoiceId || line.status !== '有效' || seen.has(line.id)) continue;
    const validation = validateClaimLine(receiptById.get(line.receiptId), line, orders, invoices);
    if (!validation.valid || !validation.invoice || receiptById.get(line.receiptId)?.status !== '有效') continue;
    seen.add(line.id);
    result.push({
      id: line.id,
      invoiceId: validation.invoice.id,
      amount: remittanceAmount(remittanceCents(line.amount)),
      currency: line.currency,
      status: '有效',
      ...(receiptById.get(line.receiptId)?.receivedAt
        ? { receivedAt: receiptById.get(line.receiptId)!.receivedAt }
        : {}),
      sourceReference: line.receiptId,
    });
  }
  return result;
}
