import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';
import { ROUGH_PLAN_TEMPLATES } from '../src/app/core/rough-plan-templates';

test('项目执行记录要求来源，保留登记历史且不推断缺失记录为无风险', () => {
  const { store } = harness();
  const projectId = 'DEMO-P001';

  assert.throws(
    () =>
      store.addProjectRisk(projectId, {
        category: '待核类别',
        level: '待核等级',
        likelihood: '待核可能性',
        status: '待核状态',
        description: '待核说明',
        sourceReference: '',
      }),
    /来源引用/,
  );
  assert.equal(store.project(projectId)!.riskRecords?.length, 0);

  store.addProjectRisk(projectId, {
    category: '待核类别',
    level: '待核等级',
    likelihood: '待核可能性',
    status: '待核状态',
    description: '仅记录已提供来源的风险说明',
    sourceReference: '来源待核：字段映射',
  });
  store.addProjectCommunication(projectId, {
    type: '需求变更',
    date: '2026-10-10',
    summary: '客户变更记录摘要',
    sourceReference: '会议纪要待核',
  });
  store.addEquipmentSerial(projectId, {
    serialNumber: 'SN-待核-1',
    model: '型号待核',
    quantity: 2,
    status: '待核',
    siteLocation: '现场位置待核',
    actualDate: '',
    sourceReference: '离线台账待核',
  });

  assert.equal(store.project(projectId)!.riskRecords?.length, 1);
  assert.equal(store.project(projectId)!.communicationRecords?.[0].date, '2026-10-10');
  assert.equal(store.project(projectId)!.equipmentSerialRecords?.[0].actualDate, '');
  assert.equal(store.project(projectId)!.equipmentSerialRecords?.[0].projectId, projectId);
  assert.equal(store.project(projectId)!.equipmentSerialRecords?.[0].sourceStatus, '待核');
  assert.ok(store.history(projectId).some((item) => item.action.includes('SN记录')));
});

test('商机粗计划复制到项目保留源节点ID且编辑项目不改写商机', () => {
  const { store, role } = harness();
  store.installRoughPlanTemplates(ROUGH_PLAN_TEMPLATES);
  const opportunity = store.state().sales.find((sale) => sale.type === 'opportunity')!;
  opportunity.stage = '赢单';
  const sourceId = 'OPP-PLAN-SOURCE';
  const roughPlan = {
    id: sourceId,
    wbsCode: '1.1',
    name: '资料准备',
    owner: '王项目',
    start: '2026-10-12',
    end: '2026-10-20',
    durationDays: 8,
    predecessor: '',
    relationNote: '无前置',
    note: '初步窗口',
    weekWindow: '第42周',
    sourceReference: '计划模板：项目交期计算模板（CIF） · 1.1 OA订单启动',
    sourceType: '参考模板',
    sourceTemplateId: 'DEMO-RPT-STANDARD',
    sourceTemplateTaskId: 'DEMO-RPT-STANDARD-1-1',
  };
  assert.throws(
    () => store.saveOpportunityRoughPlan(opportunity.id, { ...roughPlan, sourceTemplateTaskId: 'missing-task' }),
    /请选择模板及其中一个有效任务/,
  );
  assert.equal(store.saveOpportunityRoughPlan(opportunity.id, roughPlan), true);
  const projectId = store.bridge(opportunity.id)!;
  const plan = store
    .project(projectId)!
    .plans.find((item) => item.sourceOpportunityPlanId === sourceId)!;
  assert.ok(plan);
  assert.notEqual(plan.id, sourceId);
  assert.equal(plan.wbsCode, '1.1');
  assert.equal(plan.sourceTemplateId, 'DEMO-RPT-STANDARD');
  assert.equal(plan.sourceTemplateTaskId, 'DEMO-RPT-STANDARD-1-1');
  assert.equal(plan.sourceType, '参考模板');
  role('pm');
  // 商机粗计划迁移过来的内部WBS默认无预算；编辑保存时按BUD01补齐模拟预算。
  store.savePlan(projectId, {
    ...plan,
    name: '项目内调整后的任务',
    budgetAmount: 12000,
    budgetCurrency: 'CNY',
    budgetSource: '模拟',
  });
  assert.equal(
    store.project(projectId)!.plans.find((item) => item.id === plan.id)!.name,
    '项目内调整后的任务',
  );
  assert.equal(store.sale(opportunity.id)!.opportunityRoughPlans?.[0].name, '资料准备');
});
