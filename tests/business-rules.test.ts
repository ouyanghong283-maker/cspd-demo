import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, blankSales, blankProject } from '../src/app/core/seed';
import {
  acceptanceReady,
  coolingDays,
  needsTenderTeam,
  validDateRange,
  weightedAmount,
} from '../src/app/core/rules';
import { BASE_DATE, HANDOVER_TYPES } from '../src/app/core/models';

test('投标团队只适用于投标且A或S，覆盖全部等级组合', () => {
  for (const tender of ['是', '否'])
    for (const grade of ['S', 'A', 'B1', 'B2', '']) {
      const sale = { ...blankSales('test', 'c', 'opportunity'), tender, grade };
      assert.equal(needsTenderTeam(sale), tender === '是' && ['S', 'A'].includes(grade));
    }
});
test('30天和60天冷却边界正确，无记录从转化日期计时', () => {
  const sale = { ...blankSales('test', 'c', 'opportunity'), convertedDate: '2026-09-10' };
  assert.equal(coolingDays(sale, []), 30);
  sale.convertedDate = '2026-08-11';
  assert.equal(coolingDays(sale, []), 60);
});
test('内部备注和未来记录不能解除冷却，有效客户活动能解除', () => {
  const sale = { ...blankSales('test', 'c', 'opportunity'), convertedDate: '2026-08-01' };
  const activity = {
    id: 'a',
    entityId: 'test',
    customerId: 'c',
    date: BASE_DATE,
    type: '内部备注',
    summary: '内部维护',
    people: '',
    next: '',
    operator: 'test',
    stage: '意向沟通',
  };
  assert.ok(coolingDays(sale, [activity]) >= 60);
  assert.ok(coolingDays(sale, [{ ...activity, type: '电话', date: '2026-12-01' }]) >= 60);
  assert.equal(coolingDays(sale, [{ ...activity, type: '电话' }]), 0);
});
test('转换前的有效沟通通过来源线索关联继续生效', () => {
  const sale = {
    ...blankSales('opp', 'c', 'opportunity'),
    leadId: 'lead',
    convertedDate: '2026-08-01',
  };
  const activity = {
    id: 'a',
    entityId: 'lead',
    customerId: 'c',
    date: BASE_DATE,
    type: '电话',
    summary: '客户沟通',
    people: '',
    next: '',
    operator: 'test',
    stage: '意向沟通',
  };
  assert.equal(coolingDays(sale, [activity]), 0);
});
test('已关闭商机不参与冷却或加权管道', () => {
  for (const stage of ['赢单', '丢单'] as const) {
    const sale = {
      ...blankSales('test', 'c', 'opportunity'),
      stage,
      amount: 1000000,
      grade: 'A',
      convertedDate: '2026-08-01',
    };
    assert.equal(coolingDays(sale, []), 0);
    assert.equal(weightedAmount(sale), 0);
  }
});
test('演示预测随阶段等级金额变化，金额不做币种混加', () => {
  const sale = {
    ...blankSales('test', 'c', 'opportunity'),
    stage: '方案报价' as const,
    grade: 'A',
    amount: 1000000,
    currency: 'CNY',
  };
  assert.equal(weightedAmount(sale), 360000);
  assert.equal(weightedAmount({ ...sale, amount: 1200000 }), 432000);
  assert.equal(weightedAmount({ ...sale, grade: 'S' }), 400000);
  assert.equal(weightedAmount({ ...sale, currency: 'EUR' }), 360000);
});
test('日期相反、空值和无效值无法作为有效计划范围', () => {
  assert.equal(validDateRange('2026-10-20', '2026-10-12'), false);
  assert.equal(validDateRange('', '2026-10-12'), false);
  assert.equal(validDateRange('not-a-date', '2026-10-12'), false);
  assert.equal(validDateRange('2026-10-12', '2026-10-20'), true);
});
test('客户验收需要每项通过、签认和文件，SAT不替代客户验收', () => {
  const p = blankProject('p', 'c', 'o', 'ct');
  p.sat = { date: BASE_DATE, result: '合格', complete: true };
  assert.equal(acceptanceReady(p, true), false);
  p.acceptance = p.acceptance.map((a) => ({
    ...a,
    result: '通过',
    signer: '陈客户',
    date: BASE_DATE,
  }));
  assert.equal(acceptanceReady(p, false), false);
  assert.equal(acceptanceReady(p, true), true);
  p.acceptance[0].signer = '';
  assert.equal(acceptanceReady(p, true), false);
});
test('演示数据具备完整关联，合同可多项目而计划相互独立', () => {
  const s = createSeed();
  assert.equal(s.customers.length, 12);
  assert.equal(s.sales.filter((x) => x.type === 'lead').length, 12);
  assert.equal(s.sales.filter((x) => x.type === 'opportunity').length, 24);
  assert.equal(s.projects.length, 8);
  assert.equal(s.projects[0].contractId, s.projects[1].contractId);
  assert.notEqual(s.projects[0].plans[0]?.id, s.projects[1].plans[0]?.id);
  for (const p of s.projects) {
    assert.ok(s.contracts.some((c) => c.id === p.contractId));
    assert.ok(s.sales.some((x) => x.id === p.opportunityId));
    assert.deepEqual(
      p.handover.categories.map((c) => c.name),
      HANDOVER_TYPES,
    );
  }
});
