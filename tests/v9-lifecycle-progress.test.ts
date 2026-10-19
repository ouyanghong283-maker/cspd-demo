import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import {
  selectLifecycleProgress,
  PROGRESS_NODES,
  createG1Check,
} from '../src/app/core/lifecycle-progress';
test('21节点满分100，阶段和自由G1文字不补造业务事实', () => {
  const { store } = harness();
  const state = store.state();
  const sale = state.sales.find((s) => s.type === 'opportunity')!;
  sale.g1 = '通过';
  sale.stage = '赢单';
  const view = selectLifecycleProgress(state, sale.id, null);
  assert.equal(PROGRESS_NODES.length, 21);
  assert.equal(
    PROGRESS_NODES.reduce((n, x) => n + x.weight, 0),
    100,
  );
  assert.equal(view.nodes.find((n) => n.nodeId === 'opportunity.g1')?.status, 'missing');
  assert.equal(
    view.nodes.find((n) => n.nodeId === 'lead.converted')?.status,
    sale.leadId ? 'verified' : 'missing',
  );
});
test('G1仅消费明确事件并定位证据', () => {
  const { store } = harness();
  const state = store.state();
  const id = state.sales.find((s) => s.type === 'opportunity')!.id;
  state.opportunityG1Checks = [
    createG1Check({
      id: 'G1',
      opportunityId: id,
      sourceRevision: 'r1',
      evidenceIds: ['check:r1'],
      operator: { personId: 'P', name: '检查人' },
      occurredAt: '2026-10-17T00:00:00Z',
    }),
  ];
  const node = selectLifecycleProgress(state, id, null).nodes.find(
    (n) => n.nodeId === 'opportunity.g1',
  )!;
  assert.equal(node.status, 'verified');
  assert.deepEqual(node.sourceIds, ['G1', 'check:r1']);
});
