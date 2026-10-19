import { OPTIONAL_EXECUTION_NODES } from './applicability';
import { applyBusinessProgressFacts } from './facts';
import { selectProgressMapping } from './mapping';
import type { DemoState } from '../models';
import type { LifecycleProgressView, OpportunityG1Check, V9Dates } from '../v9-contracts';
export const PROGRESS_VERSION = 'v9.1';
export const PROGRESS_NODES = [
  ['lead.converted', '线索转商机', 5],
  ['opportunity.g1', 'G1（演示业务检查）', 5],
  ['solution.proposal', '技术方案', 3],
  ['solution.bom', '设计BOM', 3],
  ['solution.sld', 'SLD', 3],
  ['solution.degradation', '衰减资料', 3],
  ['solution.firstFinal', '首次定稿', 8],
  ['quote.fiveCan', '五可', 3],
  ['quote.costing', '核价', 3],
  ['quote.locked', '最终锁定报价', 4],
  ['startup.contract', '签约登记', 3],
  ['startup.pm', 'PM指派', 2],
  ['startup.handover', '启动移交', 5],
  ['execution.design', '执行设计', 5],
  ['execution.production', '生产', 15],
  ['execution.fat', 'FAT', 5],
  ['execution.shipment', '发货', 5],
  ['execution.arrivalInstall', '到货安装', 8],
  ['execution.sat', 'SAT', 5],
  ['execution.acceptance', '客户验收', 4],
  ['execution.serviceHandover', '内部运维移交', 3],
].map(([id, label, weight]) => ({
  id: id as string,
  label: label as string,
  weight: weight as number,
}));
/** 仅供既有进入方案检查成功分支使用；事件必须与阶段推进同次保存。 */
export function createG1Check(
  input: Omit<OpportunityG1Check, 'checkVersion' | 'origin'>,
): OpportunityG1Check {
  if (
    !input.id ||
    !input.opportunityId ||
    !input.sourceRevision ||
    !input.evidenceIds.length ||
    !input.operator.personId ||
    !Number.isFinite(Date.parse(input.occurredAt))
  )
    throw new Error('G1检查证据不完整');
  return {
    ...structuredClone(input),
    checkVersion: 'v9.1-existing-entry-check',
    origin: 'operation',
  };
}
export function selectLifecycleProgress(
  state: Readonly<DemoState>,
  businessId: string,
  projectId: string | null,
  _dates?: V9Dates,
): LifecycleProgressView {
  const sale = state.sales.find((s) => s.id === businessId && s.type === 'opportunity');
  const nodes: LifecycleProgressView['nodes'] = PROGRESS_NODES.map((n) => ({
    nodeId: n.id,
    weight: n.weight,
    status: 'missing',
    sourceIds: [],
    reason: '依据待补：尚无可核实业务事实',
    sourceHref: `/sales/detail/${encodeURIComponent(businessId)}?tab=方案`,
  }));
  const verify = (id: string, sourceIds: string[], href?: string) => {
    const node = nodes.find((n) => n.nodeId === id)!;
    node.status = 'verified';
    node.sourceIds = sourceIds;
    node.reason = null;
    if (href) node.sourceHref = href;
  };
  if (
    sale?.leadId &&
    state.sales.some((s) => s.id === sale.leadId && s.type === 'lead' && s.convertedTo === sale.id)
  )
    verify('lead.converted', [sale.leadId, sale.id]);
  const g1 = state.opportunityG1Checks
    ?.filter(
      (e) =>
        e.opportunityId === businessId &&
        e.checkVersion &&
        e.sourceRevision &&
        e.evidenceIds.length &&
        e.operator.personId &&
        Number.isFinite(Date.parse(e.occurredAt)),
    )
    .at(-1);
  if (g1) verify('opportunity.g1', [g1.id, ...g1.evidenceIds]);
  const workspace = state.solutionWorkspaces?.find((w) => w.opportunityId === businessId);
  for (const kind of ['proposal', 'bom', 'sld', 'degradation'] as const) {
    const version = workspace?.versions.find((v) => v.id === workspace.currentOutputs[kind]);
    if (
      version?.uploadedAt &&
      version.uploadEvidence &&
      version.origin === 'operation' &&
      version.contentState === 'current' &&
      version.file
    )
      verify('solution.' + kind, [version.id, version.uploadEvidence]);
  }
  if (
    workspace?.firstFinalization &&
    workspace.finalizations.some((e) => e.id === workspace.firstFinalization!.eventId)
  )
    verify('solution.firstFinal', [workspace.firstFinalization.eventId]);
  applyBusinessProgressFacts(state, businessId, projectId, nodes);
  if (projectId) {
    const project = state.projects.find(
      (p) => p.id === projectId && p.opportunityId === businessId,
    );
    if (project)
      for (const g of selectProgressMapping(state, projectId).groups) {
        const node = nodes.find((n) => n.nodeId === g.nodeId)!;
        node.sourceHref = `/projects/${encodeURIComponent(projectId)}?tab=业务进度`;
        node.sourceIds = g.planIds;
        if (g.pending) {
          node.reason = '映射待处理：未确认、空组或成员已删除/取消';
          continue;
        }
        node.status = g.done === g.total ? 'verified' : g.done ? 'partial' : 'incomplete';
        node.reason = `已完成 ${g.done}/${g.total} 个固定成员`;
        node.score = { numerator: String(g.weight * g.done), denominator: String(g.total) };
      }
  }
  if (projectId && state.projects.some((p) => p.id === projectId && p.opportunityId === businessId))
    for (const allowed of OPTIONAL_EXECUTION_NODES) {
      const a = state.progressNodeApplicability?.find(
        (a) => a.projectId === projectId && a.nodeId === allowed.id,
      );
      if (
        a?.applicability === 'not-required' &&
        a.reason.trim() &&
        a.pm.personId &&
        a.operator.personId &&
        a.history.length &&
        Number.isFinite(Date.parse(a.confirmedAt))
      ) {
        const node = nodes.find((n) => n.nodeId === allowed.id)!;
        node.status = 'not-required';
        node.reason = `无需执行：${a.reason}；业务PM ${a.pm.name}`;
        node.sourceIds = [a.history.at(-1)!.id];
        delete node.score;
      }
    }
  return summarizeLifecycleNodes(businessId, projectId, nodes);
}
/** 公开事实接缝：精确累加，只有全部适用节点及验收/移交有效才显示100。 */
export function summarizeLifecycleNodes(
  businessId: string,
  projectId: string | null,
  nodes: LifecycleProgressView['nodes'],
): LifecycleProgressView {
  let n = 0n,
    d = 1n;
  const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a);
  for (const node of nodes) {
    const score = node.score ?? {
      numerator:
        node.status === 'verified' || node.status === 'not-required' ? String(node.weight) : '0',
      denominator: '1',
    };
    const a = BigInt(score.numerator),
      b = BigInt(score.denominator);
    if (b <= 0n || a < 0n || a > BigInt(node.weight) * b) throw Error('节点分数非法');
    n = n * b + a * d;
    d *= b;
    const g = gcd(n, d);
    n /= g;
    d /= g;
  }
  const complete =
    n === 100n * d &&
    nodes.length === PROGRESS_NODES.length &&
    PROGRESS_NODES.every(
      (def) =>
        nodes.filter(
          (n) =>
            n.nodeId === def.id &&
            n.weight === def.weight &&
            (n.status === 'verified' || n.status === 'not-required'),
        ).length === 1,
    ) &&
    ['execution.acceptance', 'execution.serviceHandover'].every((id) =>
      nodes.some((n) => n.nodeId === id && n.status === 'verified'),
    );
  const tenths = (n * 10n * 2n + d) / (2n * d);
  const display = complete ? '100.0' : (Number(tenths > 999n ? 999n : tenths) / 10).toFixed(1);
  return {
    businessId,
    projectId,
    score: { numerator: String(n), denominator: String(d) },
    displayPercent: display,
    complete,
    nodes,
  };
}
