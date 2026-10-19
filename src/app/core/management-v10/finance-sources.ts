import type { DemoState } from '../models';
import type { V10FinanceBatch } from '../v10-contracts';

/** 独立生产演示来源，非SAP、旧累计快照或验收夹具。金额均为CNY分。 */
const PROJECT_TOTALS = [
  [3000000, 450000],
  [2000000, 240000],
  [null, null],
  [1500000, 180000],
  [1000000, -50000],
  [1200000, 144000],
  [800000, 96000],
  [1000000, 200000],
] as const;

/** 仅用于原子保存候选／新轮；已有来源（含空数组）完全保留，不修补用户财务。 */
export function initializeFinanceSources(state: DemoState): boolean {
  if (state.financeBatches !== undefined) return false;
  const batch: V10FinanceBatch = {
    batchId: 'V10-FIN-2608-09',
    source: '整月模拟',
    primaryCurrency: 'CNY',
    periodStart: '2026-08-01',
    periodEnd: '2026-09-30',
    latestClosedMonth: '2026-09',
    projects: [],
    facts: [],
  };
  for (const [index, [revenue, profit]] of PROJECT_TOTALS.entries()) {
    const projectId = `DEMO-P00${index + 1}`;
    if (state.projects.filter((p) => p.id === projectId).length !== 1) continue;
    batch.projects.push({
      projectId,
      currency: 'CNY',
      months: ['2026-08', '2026-09'],
      completeness: revenue === null ? 'missing' : 'complete',
    });
    if (revenue === null || profit === null) continue;
    // 独立声明两个完整月的演示分配；不是旧快照或逐日金额的倒推。
    for (const [month, share] of [
      ['2026-08', 0.4],
      ['2026-09', 0.6],
    ] as const) {
      batch.facts.push({
        factId: `${batch.batchId}:${projectId}:${month}`,
        projectId,
        month,
        currency: 'CNY',
        revenueMinor: revenue * share,
        grossProfitMinor: profit * share,
      });
    }
  }
  state.financeBatches = [batch];
  return true;
}
