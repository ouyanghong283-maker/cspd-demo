import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import {
  PROGRESS_NODES,
  selectLifecycleProgress,
  summarizeLifecycleNodes,
} from '../src/app/core/lifecycle-progress';
import type { LifecycleProgressView } from '../src/app/core/v9-contracts';
test('公开事实汇总99.96未全完成显示99.9，缺内部移交不能100，全部有效才100', () => {
  const nodes: LifecycleProgressView['nodes'] = PROGRESS_NODES.map((n) => ({
    nodeId: n.id,
    weight: n.weight,
    status: 'verified',
    sourceIds: ['evidence'],
    reason: null,
    sourceHref: null,
  }));
  const design = nodes.find((n) => n.nodeId === 'execution.design')!;
  design.status = 'partial';
  design.score = { numerator: '124', denominator: '25' };
  assert.equal(summarizeLifecycleNodes('O', 'P', nodes).displayPercent, '99.9');
  design.status = 'verified';
  assert.equal(summarizeLifecycleNodes('O', 'P', nodes).displayPercent, '99.9');
  assert.equal(summarizeLifecycleNodes('O', 'P', nodes).complete, false);
  delete design.score;
  const handover = nodes.at(-1)!;
  handover.status = 'missing';
  assert.equal(summarizeLifecycleNodes('O', 'P', nodes).complete, false);
  assert.equal(summarizeLifecycleNodes('O', 'P', nodes).displayPercent, '97.0');
  handover.status = 'verified';
  assert.equal(summarizeLifecycleNodes('O', 'P', nodes).displayPercent, '100.0');
});
test('FAT/SAT报告删除与验收复核使当前分下降，启动移交不能冒充内部移交', () => {
  const { store } = harness();
  const s = store.state(),
    p = s.projects[0];
  p.plans = p.plans.filter((p) => p.type !== 'FAT测试');
  p.reviewReasons = [];
  p.plans.push({
    ...p.plans[0],
    id: 'FAT',
    type: 'FAT测试',
    status: '已完成',
    actual: '2026-10-10',
    result: '合格',
  });
  p.sat = { complete: true, result: '合格', date: '2026-10-11' };
  for (const kind of ['FAT报告', 'SAT报告'])
    s.attachments.push({ ...s.attachments[0], id: kind, entityId: p.id, kind });
  p.briefing.startupHandover = {
    status: '已移交',
    sender: '张销售',
    receiver: '王项目',
    transferredAt: '2026-10-10',
    opinion: '确认',
    briefingVersion: 1,
  };
  p.handover.status = '待移交';
  const initial = selectLifecycleProgress(s, p.opportunityId, p.id);
  assert.equal(initial.nodes.find((n) => n.nodeId === 'execution.fat')?.status, 'verified');
  assert.equal(initial.nodes.find((n) => n.nodeId === 'execution.sat')?.status, 'verified');
  assert.notEqual(
    initial.nodes.find((n) => n.nodeId === 'execution.serviceHandover')?.status,
    'verified',
  );
  s.attachments = s.attachments.filter((a) => !['FAT报告', 'SAT报告'].includes(a.kind));
  const next = selectLifecycleProgress(s, p.opportunityId, p.id);
  assert.equal(next.nodes.find((n) => n.nodeId === 'execution.fat')?.status, 'invalidated');
  assert.equal(next.nodes.find((n) => n.nodeId === 'execution.sat')?.status, 'invalidated');
});

test('公开核价与五可操作采用当前资料，需求或真实版本更新后计分失效', async () => {
  const { store, role } = harness();
  role('solution');
  const id = 'DEMO-O014';
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const sale = store.sale(id)!;
  sale.productNeeds = [{ id: 'N', model: 'PCS', quantity: 1, unit: '台' }];
  sale.productNeedRevision = 1;
  for (const kind of ['技术方案', 'TIC', '设计BOM', 'SLD'] as const)
    store.addSolutionDocument(id, kind, kind + '.pdf', '周方案');
  store.confirmSolutionDocuments(id, '周方案');
  const { uploadSolutionOutput } = await import('../src/app/core/solution-workflow/upload');
  const files = {
    async put() {},
    async get() {
      return null;
    },
  };
  const c = { workspaceId: 'W', roundId: 'R', operationId: 'A' };
  await uploadSolutionOutput(
    store,
    { opportunityId: id, kind: 'proposal', file: new File(['v1'], 'p.pptx'), note: '' },
    c,
    files,
  );
  store.recordSolutionCosting(id, { N: 100 }, 'EUR', '不含税', '固定来源');
  const items = Object.fromEntries(
    ['可承诺', '可交付', '可运维', '可验收', '可续约'].map((key) => [
      key,
      { result: '满足', owner: '周方案', opinion: '明确依据' },
    ]),
  );
  store.recordFiveCan(id, '当前资料', items as any, []);
  let v = selectLifecycleProgress(store.state(), id, null);
  assert.equal(v.nodes.find((n) => n.nodeId === 'quote.costing')?.status, 'verified');
  assert.equal(v.nodes.find((n) => n.nodeId === 'quote.fiveCan')?.status, 'verified');
  await uploadSolutionOutput(
    store,
    { opportunityId: id, kind: 'proposal', file: new File(['v2'], 'p.pptx'), note: '' },
    { ...c, operationId: 'B' },
    files,
  );
  v = selectLifecycleProgress(store.state(), id, null);
  assert.equal(v.nodes.find((n) => n.nodeId === 'quote.costing')?.status, 'invalidated');
  assert.equal(v.nodes.find((n) => n.nodeId === 'quote.fiveCan')?.status, 'invalidated');
});
