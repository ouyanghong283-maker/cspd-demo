import type { DemoState, Project } from '../models';
import { acceptanceReady, isValidISODate } from '../rules';
import { startupSourceMatches, STARTUP_BRIEFING_DOCUMENT_KINDS } from '../project-startup';
/** 任务组和独立节点共用原始凭据与复核规则，避免同一事实两套完成口径。 */
export function selectProjectCompletionFacts(state: Readonly<DemoState>, p: Project) {
  const attachments = state.attachments.filter((a) => a.entityId === p.id);
  const has = (kind: string) => attachments.some((a) => a.kind === kind);
  const contract = state.contracts.find(
    (c) =>
      c.id === p.contractId && c.opportunityId === p.opportunityId && c.customerId === p.customerId,
  );
  const snapshot = contract
    ? {
        contractId: contract.id,
        quoteVersionId: contract.quoteVersionId || '',
        contractFileVersionId: contract.currentContractFileVersionId || '',
        contract: {
          title: contract.title || '',
          amount: contract.amount || 0,
          currency: contract.currency || '',
          payment: contract.payment || '',
          penalty: contract.penalty || '',
          product: contract.product || '',
          scope: contract.scope || '',
        },
        projectName: p.name,
        start: p.start || '',
        acceptance: p.briefing.acceptance || '',
        production: p.briefing.production || '',
        shipping: p.briefing.shipping || '',
        commissioning: p.briefing.commissioning || '',
        attachmentIds: attachments
          .filter((a) => STARTUP_BRIEFING_DOCUMENT_KINDS.includes(a.kind))
          .map((a) => a.id)
          .sort(),
      }
    : null;
  const sub = p.briefing.submission;
  const startup =
    !!snapshot &&
    !!sub &&
    startupSourceMatches(sub.snapshot, snapshot) &&
    p.briefing.confirmation?.version === sub.version &&
    ['通过', '附条件通过'].includes(p.briefing.g4?.result ?? '') &&
    p.conditions.every((c) => c.closed) &&
    p.briefing.startupHandover?.status === '已移交' &&
    p.briefing.startupHandover.briefingVersion === sub.version &&
    !p.reviewReasons?.includes('briefing') &&
    has('启动纪要') &&
    has('启动文件') &&
    !!p.start &&
    !!p.briefing.acceptance;
  const sat =
    !!p.sat.complete &&
    p.sat.result === '合格' &&
    isValidISODate(p.sat.date) &&
    has('SAT报告') &&
    !p.reviewReasons?.includes('sat');
  const accepted =
    p.acceptanceComplete &&
    acceptanceReady(p, has('客户签字清单')) &&
    !p.reviewReasons?.includes('acceptance');
  const handover =
    p.handover.status === '已接收' &&
    sat &&
    !p.reviewReasons?.length &&
    !!p.handover.receiver &&
    p.handover.categories.length === 8 &&
    new Set(p.handover.categories.map((c) => c.name)).size === 8 &&
    p.handover.categories.every(
      (c) => c.status === '已有资料' || (c.status === '不适用' && !!c.note.trim()),
    ) &&
    p.handover.issues.every((i) => !!i.owner && isValidISODate(i.due));
  return { startup, sat, acceptance: accepted, serviceHandover: handover };
}
