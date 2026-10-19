import {
  selectSolutionBusinessRecords,
  selectBusinessConfirmation,
} from '../solution-workflow/business-records';
import { selectQuoteSolutionBasis } from '../solution-workflow/quote-basis';
import { selectProjectCompletionFacts } from './project-completion';
import type { DemoState } from '../models';
import type { LifecycleProgressView, SolutionOutputIds } from '../v9-contracts';
import { knownProjectPersonId } from '../plan-person';
import { completedPlan } from './mapping';
type Nodes = LifecycleProgressView['nodes'];
/** 既有保存模型的只读适配，绝不以阶段文字或页面访问产生证据。 */
export function applyBusinessProgressFacts(
  state: Readonly<DemoState>,
  businessId: string,
  projectId: string | null,
  nodes: Nodes,
): void {
  const node = (id: string) => nodes.find((n) => n.nodeId === id)!;
  const fact = (
    id: string,
    valid: boolean,
    known: boolean,
    sourceIds: string[],
    reason: string,
    href: string,
  ) => {
    const n = node(id);
    n.status = valid
      ? 'verified'
      : known
        ? 'invalidated'
        : sourceIds.length
          ? 'incomplete'
          : 'missing';
    n.sourceIds = sourceIds;
    n.reason = valid ? null : reason;
    n.sourceHref = href;
  };
  const sale = state.sales.find((s) => s.id === businessId && s.type === 'opportunity');
  if (!sale) return;
  const href = `/sales/solutions/${encodeURIComponent(businessId)}`;
  const w = state.solutionWorkspaces?.find((w) => w.opportunityId === businessId);
  const matchesOutputs = (ids: Partial<SolutionOutputIds> | undefined) =>
    !w?.versions.some((v) => v.origin === 'operation') ||
    (!!ids &&
      ['proposal', 'bom', 'sld', 'degradation'].every(
        (k) => ids[k as keyof typeof ids] === w.currentOutputs[k as keyof typeof w.currentOutputs],
      ));
  const docs = selectSolutionBusinessRecords(state, businessId);
  const confirmation = selectBusinessConfirmation(state, businessId);
  const currentConfirmation = !!confirmation;
  const review = docs?.fiveCanReviews.at(-1);
  const fiveKeys = ['可承诺', '可交付', '可运维', '可验收', '可续约'] as const;
  const fiveValid =
    !!review &&
    currentConfirmation &&
    matchesOutputs(review.solutionOutputIds) &&
    review.confirmationId === confirmation?.id &&
    fiveKeys.every((k) => review.items[k] && ['满足', '附条件'].includes(review.items[k].result)) &&
    review.conditions.every((c) => c.closed && !!c.closedBy);
  fact(
    'quote.fiveCan',
    fiveValid,
    !!review,
    review ? [review.id] : [],
    '五可缺失、条件未关闭或当前需求/资料依据已失效',
    href + '?section=五可',
  );
  const costing = docs?.costings.at(-1);
  const costValid =
    !!costing &&
    currentConfirmation &&
    matchesOutputs(costing.solutionOutputIds) &&
    costing.confirmationId === confirmation?.id &&
    !!sale.productNeeds?.length &&
    sale.productNeeds.every((need) => {
      const rows = costing.rows.filter((r) => r.productNeedId === need.id);
      const r = rows[0];
      return (
        rows.length === 1 &&
        r.quantity === need.quantity &&
        r.unit === need.unit &&
        r.cost !== null &&
        Number.isFinite(r.cost) &&
        r.guidePrice !== null &&
        Number.isFinite(r.guidePrice) &&
        !!r.currency &&
        !!r.taxBasis
      );
    });
  fact(
    'quote.costing',
    costValid,
    !!costing,
    costing ? [costing.id, costing.confirmationId] : [],
    '核价缺失、口径不完整或当前配置/确认已失效',
    href + '?section=核价',
  );
  const locked =
    state.quoteSeries
      ?.filter((s) => s.opportunityId === businessId)
      .flatMap((s) =>
        s.versions.filter((v) => v.status === '最终锁定' && s.activeFinalVersionId === v.id),
      ) ?? [];
  const validQuote = locked.find(
    (q) =>
      q.customerId === sale.customerId &&
      (q.solutionBasis
        ? !selectQuoteSolutionBasis(state, q.id, null).submitIssues.length
        : costValid &&
          q.costingId === costing?.id &&
          q.sourceSolutionConfirmationId === confirmation?.id &&
          q.sourceProductNeedRevision === (sale.productNeedRevision ?? 0)),
  );
  fact(
    'quote.locked',
    !!validQuote,
    locked.length > 0,
    validQuote ? [validQuote.id] : locked.map((q) => q.id),
    '最终锁定报价缺失或其需求、方案及核价依据已过期',
    `/sales/quotes/${encodeURIComponent(businessId)}`,
  );
  if (!projectId) return;
  const p = state.projects.find((p) => p.id === projectId && p.opportunityId === businessId);
  if (!p) return;
  const pHref = `/projects/${encodeURIComponent(projectId)}`;
  const {
    startup,
    sat,
    acceptance: accepted,
    serviceHandover: handover,
  } = selectProjectCompletionFacts(state, p);
  const sub = p.briefing.submission;
  const contract = state.contracts.find(
    (c) => c.id === p.contractId && c.opportunityId === businessId && c.customerId === p.customerId,
  );
  fact(
    'startup.contract',
    !!contract && contract.status !== '草稿',
    !!contract,
    contract ? [contract.id] : [],
    '签约登记或合同归属待核',
    pHref + '?tab=启动交底',
  );
  const pm = knownProjectPersonId(p, p.pm, p.pmPersonId);
  fact('startup.pm', !!pm, !!p.pm, pm ? [pm] : [], 'PM稳定人员身份待核', pHref + '?tab=启动交底');
  fact(
    'startup.handover',
    startup,
    !!p.briefing.startupHandover,
    sub ? [`briefing:${p.id}:${sub.version}`] : [],
    '交底、G4、当前来源或启动移交待完成/复核',
    pHref + '?tab=启动交底',
  );
  const fat = p.plans.filter((plan) => plan.type === 'FAT测试' && plan.status !== '已取消');
  fact(
    'execution.fat',
    fat.length > 0 && fat.every((plan) => completedPlan(state, p.id, plan)),
    fat.some((plan) => plan.status === '已完成'),
    fat.map((plan) => plan.id),
    'FAT未完成或实际日期、合格结果及报告已失效',
    pHref + '?tab=plans&plan=' + encodeURIComponent('FAT测试'),
  );
  fact(
    'execution.sat',
    sat,
    !!p.sat.complete,
    ['sat:' + p.id],
    'SAT未完成或合格结果、日期、报告需复核',
    pHref + '?tab=acceptance&section=' + encodeURIComponent('验收'),
  );
  fact(
    'execution.acceptance',
    accepted,
    p.acceptanceComplete,
    p.acceptance.map((a) => a.id),
    '客户验收未完成或签认/报告需复核',
    pHref + '?tab=acceptance&section=' + encodeURIComponent('验收'),
  );
  fact(
    'execution.serviceHandover',
    handover,
    p.handover.status === '已接收',
    ['handover:' + p.id],
    '内部运维移交尚未有效接收或资料需复核',
    pHref + '?tab=acceptance&section=' + encodeURIComponent('移交'),
  );
}
