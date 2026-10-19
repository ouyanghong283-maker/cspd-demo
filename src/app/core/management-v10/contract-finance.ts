import type { DemoState } from '../models';
import type { V10ContractFinance } from '../v10-contracts';
import { minor, total } from './finance-amounts';
import { stableId } from './identity';

/** 合同持有事实，项目仅引用；不叠加旧快照或回款事件。 */
export function selectContractFinance(
  state: Readonly<DemoState>,
  projectIds: string[],
): V10ContractFinance {
  const result: V10ContractFinance = { status: 'ready', issues: [], invoices: [], totals: [] };
  if (!Array.isArray(state.contractInvoices))
    return { ...result, status: 'unavailable', issues: ['合同发票来源尚未提供'] };
  const groups = new Map<string, typeof state.contractInvoices>();
  for (const invoice of state.contractInvoices) {
    const rows = groups.get(invoice.id) ?? [];
    rows.push(invoice);
    groups.set(invoice.id, rows);
  }
  for (const [id, rows] of groups) {
    if (!rows.some((r) => r.projectIds?.some((p) => projectIds.includes(p)))) continue;
    const first = rows[0];
    const issues: string[] = [];
    const signature = (r: typeof first) =>
      JSON.stringify([
        r.contractId,
        r.currency,
        r.amount,
        r.received,
        r.cumulativeSource,
        r.legacyReceived,
        r.issued,
        r.due,
      ]);
    if (!stableId(id) || rows.some((r) => signature(r) !== signature(first)))
      issues.push('发票ID缺失或同ID事实冲突');
    if (state.contracts.filter((c) => c.id === first.contractId).length !== 1)
      issues.push('合同来源缺失或身份冲突');
    if (!['CNY', 'EUR', 'USD'].includes(first.currency)) issues.push('发票币种待核');
    if (first.projectIds.some((p) => state.projects.filter((r) => r.id === p).length !== 1))
      issues.push('发票项目关联待核');
    let invoiceMinor = minor(first.amount),
      receivedMinor = minor(first.received);
    if (first.cumulativeSource === 'claims') {
      const claims = state.invoiceReceiptClaims;
      const opening = first.legacyReceived === undefined ? 0 : minor(first.legacyReceived);
      if (opening === null || opening < 0) issues.push('历史回款基数非法，待核');
      const amounts: (number | null)[] = [opening];
      if (!Array.isArray(claims)) issues.push('回款认领来源缺失');
      const groups = new Map<string, NonNullable<typeof claims>>();
      for (const claim of claims ?? []) {
        const rows = groups.get(claim.id) ?? [];
        rows.push(claim);
        groups.set(claim.id, rows);
      }
      for (const rows of groups.values()) {
        if (!rows.some((c) => c.invoiceId === id)) continue;
        const claim = rows[0];
        const signature = (c: typeof claim) =>
          JSON.stringify([c.invoiceId, c.amount, c.currency, c.status]);
        if (rows.some((c) => signature(c) !== signature(claim))) {
          issues.push('同ID回款认领状态、金额或归属冲突');
          continue;
        }
        if (claim.status === '撤销') continue;
        const amount = minor(claim.amount);
        if (
          !stableId(claim.id) ||
          claim.status !== '有效' ||
          claim.currency !== first.currency ||
          amount === null ||
          amount < 0
        )
          issues.push('回款认领金额、币种或状态待核');
        else amounts.push(amount);
      }
      receivedMinor = total(amounts);
    } else if (first.cumulativeSource !== 'legacy-simulation') issues.push('回款累计来源待核');
    if (invoiceMinor === null || receivedMinor === null || invoiceMinor < 0 || receivedMinor < 0)
      issues.push('发票或回款金额缺失、非法或溢出');
    if (issues.length) {
      invoiceMinor = null;
      receivedMinor = null;
    }
    const balanceMinor =
      invoiceMinor !== null && receivedMinor !== null
        ? total([invoiceMinor, -receivedMinor])
        : null;
    result.invoices.push({
      invoiceId: id,
      contractId: first.contractId,
      projectIds: [...new Set(rows.flatMap((r) => r.projectIds))],
      currency: first.currency,
      invoiceMinor,
      receivedMinor,
      balanceMinor,
      collectionRatio:
        invoiceMinor !== null && invoiceMinor > 0 && receivedMinor !== null
          ? receivedMinor / invoiceMinor
          : null,
      allocation: '合同口径，未提供项目分摊依据',
      issued: first.issued,
      due: first.due,
      sourceHref: `/contracts/${encodeURIComponent(first.contractId)}`,
      issues,
    });
  }
  for (const currency of new Set(result.invoices.map((i) => i.currency))) {
    const rows = result.invoices.filter((i) => i.currency === currency);
    const invoiceMinor = total(rows.map((i) => i.invoiceMinor)),
      receivedMinor = total(rows.map((i) => i.receivedMinor)),
      balanceMinor = total(rows.map((i) => i.balanceMinor));
    result.totals.push({
      currency,
      invoiceMinor,
      receivedMinor,
      balanceMinor,
      collectionRatio:
        invoiceMinor !== null && invoiceMinor > 0 && receivedMinor !== null
          ? receivedMinor / invoiceMinor
          : null,
      complete:
        rows.every((i) => !i.issues.length) &&
        invoiceMinor !== null &&
        receivedMinor !== null &&
        balanceMinor !== null,
    });
  }
  result.issues.push(...result.invoices.flatMap((i) => i.issues));
  result.status = result.invoices.length ? 'ready' : 'empty';
  return result;
}
