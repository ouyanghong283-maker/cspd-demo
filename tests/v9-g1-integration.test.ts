import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DemoStore } from '../src/app/core/store';
import { harness } from './v4-harness';
function completeOpportunityGate(store: DemoStore, id: string): void {
  store.saveProductNeed(id, { id: 'mainline-need', model: 'PCS-100', quantity: 1, unit: '台' });
  const template = store.state().attachments.find((item) => item.kind === '需求导入表')!;
  const kinds = ['核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'];
  for (const kind of kinds)
    store.state().attachments.push({
      ...template,
      id: `mainline-${kind}`,
      entityId: id,
      kind,
      name: `${kind}.pdf`,
    });
  store.saveTechnicalAssessment(id, {
    result: '满足',
    owner: '周方案',
    opinion: '模拟资料已齐备',
    evidenceAttachmentIds: store
      .quoteSourceCandidates(id)
      .filter((item) => kinds.includes(item.kind))
      .map((item) => item.id),
  });
  store.submitOpportunity(id);
  store.assignOpportunityPM(id, 'pm', '王项目', '2026-10-20 至 2026-11-15（模拟）');
  store.assignTeam(id, [
    {
      id: 'mainline-member',
      role: 'pm',
      person: '王项目',
      department: '交付部',
      window: '2026-10-20 至 2026-11-15（模拟）',
      confirmed: true,
      confirmedBy: '王项目',
    },
  ]);
  for (const task of store.sale(id)!.departmentTasks || [])
    store.completeDepartmentTask(id, task.id);
}

function setup() {
  const { store } = harness();
  store.simulateDocument('DEMO-L001', '需求导入表', '需求.xlsx');
  const id = store.convert('DEMO-L001')!;
  store.saveSales({
    ...store.sale(id)!,
    description: '储能需求',
    capacity: 10,
    amount: 120000,
    expectedDate: '2026-11-15',
    grade: 'A',
    tender: '否',
  });
  completeOpportunityGate(store, id);
  return { store, id };
}
test('进入方案检查成功与G1事件同次保存，重试不重复推进', () => {
  const { store, id } = setup();
  assert.equal(store.advance(id, 'G1-TEST'), true);
  assert.equal(store.state().opportunityG1Checks?.length, 1);
  assert.equal(store.state().opportunityG1Checks?.[0].opportunityId, id);
  assert.equal(store.advance(id, 'G1-TEST'), true);
  assert.equal(store.state().opportunityG1Checks?.length, 1);
  assert.equal(store.sale(id)?.stage, '方案报价');
});
test('G1保存失败不留下事件或阶段变化', () => {
  const { store, id } = setup();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem() {
        throw Error('QuotaExceededError');
      },
    },
  });
  try {
    store.advance(id, 'G1-FAILED');
  } catch {}
  assert.equal(store.state().opportunityG1Checks?.length ?? 0, 0);
  assert.equal(store.sale(id)?.stage, '意向沟通');
});
