import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoState } from '../src/app/core/models';
import { createSeed } from '../src/app/core/seed';
import { harness } from './v4-harness';

test('旧历史迁移保留原ID和来源，缺失契约标旧版未记录且不推进本轮', () => {
  const { store } = harness();
  const legacy = createSeed();
  delete legacy.operationEvents;
  legacy.dataVersion = 7;
  legacy.roundId = undefined;
  legacy.history = [{
    id: 'LEGACY-HISTORY-1', entityId: 'DEMO-O001', operator: '旧版操作人',
    action: '修改商机信息', date: '2026-10-09 10:30',
  }];
  const prepare = Reflect.get(store, 'prepareWorkspaceState').bind(store) as (
    state: DemoState, convertHistory: boolean, fallbackRoundId?: string,
  ) => DemoState;

  const migrated = prepare(legacy, true, 'LEGACY-UNMIGRATED');
  assert.equal(migrated.storageSchemaVersion, 1);
  assert.equal(migrated.dataVersion, 7);
  assert.equal(migrated.history[0].id, 'LEGACY-HISTORY-1');
  assert.equal(migrated.operationEvents?.length, 1);
  assert.equal(migrated.operationEvents?.[0].id, 'LEGACY-HISTORY-1');
  assert.equal(migrated.operationEvents?.[0].roundId, 'LEGACY-LEGACY-HISTORY-1');
  assert.equal(migrated.operationEvents?.[0].mainlineId, '旧版未记录');
  assert.deepEqual(migrated.operationEvents?.[0].changes, []);

  const refreshed = prepare(migrated, true);
  assert.equal(refreshed.operationEvents?.length, 1);
});

test('已有空 operationEvents 的旧快照仍会迁移 History', () => {
  const { store } = harness();
  const legacy = createSeed();
  legacy.operationEvents = [];
  legacy.storageSchemaVersion = undefined;
  legacy.dataVersion = 9;
  legacy.history = [{
    id: 'LEGACY-HISTORY-EMPTY-EVENTS', entityId: 'DEMO-O001', operator: '旧版操作人',
    action: '修改商机信息', date: '2026-10-09 10:30',
  }];
  const prepare = Reflect.get(store, 'prepareWorkspaceState').bind(store) as (
    state: DemoState, convertHistory: boolean, fallbackRoundId?: string,
  ) => DemoState;

  const migrated = prepare(legacy, true, 'LEGACY-UNMIGRATED');
  assert.equal(migrated.operationEvents?.length, 1);
  assert.equal(migrated.operationEvents?.[0].legacyHistoryId, 'LEGACY-HISTORY-EMPTY-EVENTS');
  assert.equal(migrated.operationEvents?.[0].legacy, true);
  assert.equal(migrated.dataVersion, 9);
});

test('未知旧关联保留原值并生成待核项，不删除记录', () => {
  const { store } = harness();
  const legacy = createSeed();
  delete legacy.operationEvents;
  const linkedQuoteVersion = legacy.quoteSeries?.[0]?.versions[0];
  const sale = structuredClone(legacy.sales[0]);
  sale.customerId = 'UNKNOWN-CUSTOMER';
  sale.contactId = 'UNKNOWN-CONTACT';
  legacy.sales[0] = sale;
  legacy.activities.push({
    id: 'UNKNOWN-ACTIVITY', entityId: 'UNKNOWN-ENTITY', customerId: 'UNKNOWN-ACTIVITY-CUSTOMER',
    contactId: 'UNKNOWN-ACTIVITY-CONTACT', date: '', type: '', summary: '', people: '', next: '', operator: '', stage: '',
  });
  legacy.attachments.push({
    id: 'UNKNOWN-ATTACHMENT', entityId: 'UNKNOWN-ATTACHMENT-ENTITY', kind: '', name: '', size: 0,
    date: '', operator: '', sample: false, url: '', operationId: 'UNKNOWN-ATTACHMENT-OPERATION',
  });
  legacy.quoteSeries = [{
    id: 'UNKNOWN-QUOTE-SERIES', number: 'Q-UNKNOWN', opportunityId: 'UNKNOWN-QUOTE-OPPORTUNITY',
    versions: linkedQuoteVersion ? [linkedQuoteVersion] : [],
    activeFinalVersionId: 'UNKNOWN-QUOTE-VERSION', createdBy: '', createdDate: '',
  }];
  if (legacy.contracts[0]) {
    legacy.contracts[0].serviceSnapshot = {
      quoteVersionId: linkedQuoteVersion?.id || 'UNKNOWN-QUOTE-VERSION', warranty: '', sla: '', scope: '',
    };
  }
  legacy.roughPlanTemplates = [
    { id: 'TEMPLATE-A', name: '', description: '', sourceFile: '', status: '启用', tasks: [{ id: 'TASK-A', wbsCode: '', name: '', predecessor: '', relationNote: '', note: '' }] },
    { id: 'TEMPLATE-B', name: '', description: '', sourceFile: '', status: '启用', tasks: [{ id: 'CROSS-TEMPLATE-TASK', wbsCode: '', name: '', predecessor: '', relationNote: '', note: '' }] },
  ];
  legacy.projects[0].plans[0].sourceTemplateId = 'TEMPLATE-A';
  legacy.projects[0].plans[0].sourceTemplateTaskId = 'CROSS-TEMPLATE-TASK';
  legacy.projects[0].plans[1].sourceTemplateId = 'UNKNOWN-TEMPLATE';
  legacy.sales[0].opportunityRoughPlans = [{
    id: 'ROUGH-PLAN-1', name: '', owner: '', start: '', end: '', predecessor: '', relationNote: '',
    note: '', weekWindow: '', sourceReference: '', sourceTemplateId: 'TEMPLATE-A', sourceTemplateTaskId: 'CROSS-TEMPLATE-TASK',
  }];
  legacy.solutionDocuments = [{
    opportunityId: legacy.sales[0].id, current: { '技术方案': 'DOC-WRONG-KIND' },
    versions: [{ id: 'DOC-WRONG-KIND', kind: 'TIC', number: 1, documentId: '', owner: '', operator: '', createdAt: '', note: '' }],
    confirmations: [{ id: 'CONFIRMATION-1', createdAt: '', owner: '', operator: '', productNeedRevision: 0, documentVersions: { '技术方案': 'DOC-WRONG-KIND' } }],
    costings: [], fiveCanReviews: [], owner: '', ownerHistory: [],
  }];
  const internalPlan = legacy.projects[0].plans.find((plan) => plan.type !== '客户主节点');
  if (internalPlan) internalPlan.customerMilestoneId = internalPlan.id;
  legacy.projects[0].equipmentSerialRecords ||= [];
  legacy.projects[0].equipmentSerialRecords!.push({
    id: 'UNKNOWN-EQUIPMENT', projectId: 'UNKNOWN-PROJECT', contractId: 'UNKNOWN-CONTRACT',
    serialNumber: '', model: '', quantity: 1, status: '', siteLocation: '', actualDate: '',
    sourceReference: '', sourceStatus: '待核', createdAt: '', operator: '',
  });
  if (legacy.financeSnapshots?.[0]) legacy.financeSnapshots[0].projectId = 'UNKNOWN-FINANCE-PROJECT';
  const otherCustomer = legacy.customers.find((customer) => customer.id !== legacy.projects[0].customerId);
  if (otherCustomer) {
    legacy.projects[0].contactId = otherCustomer.contacts[0]?.id;
    legacy.creditPolicies = [{
      projectId: legacy.projects[0].id, customerId: otherCustomer.id, policyId: 'CROSS-CUSTOMER-POLICY',
      revision: 1, terms: '', days: 0, startCustomerMilestoneId: internalPlan?.id || '', source: 'CRM', snapshotDate: '',
    }];
  }
  const prepare = Reflect.get(store, 'prepareWorkspaceState').bind(store) as (
    state: DemoState, convertHistory: boolean,
  ) => DemoState;

  const migrated = prepare(legacy, true);
  assert.equal(migrated.sales[0].customerId, 'UNKNOWN-CUSTOMER');
  assert.equal(migrated.sales[0].contactId, 'UNKNOWN-CONTACT');
  const relations = migrated.migrationReviewItems?.map((item) => item.relation) || [];
  assert(relations.includes('customerId'));
  assert(relations.includes('contactId'));
  assert(relations.includes('activeFinalVersionId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'activity' && item.relation === 'entityId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'attachment' && item.relation === 'entityId'));
  assert(!migrated.migrationReviewItems?.some((item) => item.entityType === 'attachment' && item.relation === 'operationId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'projectPlan' && item.relation === 'sourceTemplateId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'projectPlan' && item.relation === 'sourceTemplateTaskId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'opportunityRoughPlan' && item.relation === 'sourceTemplateTaskId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'solutionConfirmation' && item.relation === 'documentVersions.技术方案'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'equipmentSerialRecord' && item.relation === 'contractId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'quoteSeries' && item.relation === 'opportunityId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'contract' && item.relation === 'serviceSnapshot.quoteVersionId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'financeSnapshot' && item.relation === 'projectId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'creditPolicy' && item.relation === 'customerId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'creditPolicy' && item.relation === 'startCustomerMilestoneId'));
  assert(migrated.migrationReviewItems?.some((item) => item.entityType === 'projectPlan' && item.relation === 'customerMilestoneId'));
  assert.equal(migrated.activities.at(-1)?.entityId, 'UNKNOWN-ENTITY');
  assert.equal(migrated.attachments.at(-1)?.entityId, 'UNKNOWN-ATTACHMENT-ENTITY');
  assert.equal(migrated.quoteSeries?.[0].opportunityId, 'UNKNOWN-QUOTE-OPPORTUNITY');
  if (migrated.financeSnapshots?.[0]) assert.equal(migrated.financeSnapshots[0].projectId, 'UNKNOWN-FINANCE-PROJECT');
});
