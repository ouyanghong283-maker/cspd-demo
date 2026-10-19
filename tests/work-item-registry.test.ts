import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectFinanceSummaries,
  completeWorkItem,
  FinanceSummaryResult,
  markWorkNoticeRead,
  WorkItemInput,
  WorkItemRegistry,
  workItemId,
} from '../src/app/core/work-item-registry';

const planItem: WorkItemInput = {
  sourceRecordId: 'plan:12',
  title: '客户验收',
  department: '项目管理',
  owner: '张三',
  status: 'open',
  dueDate: '2026-10-12',
  href: '/projects/project-1/plan/plan%3A12',
  projectId: 'project-1',
};

test('任务ID按来源和来源记录稳定生成，且避免分隔符碰撞', () => {
  assert.equal(workItemId('project-plan', 'plan:12'), workItemId('project-plan', 'plan:12'));
  assert.notEqual(workItemId('project-plan', 'plan:12'), workItemId('contract', 'plan:12'));
  assert.notEqual(workItemId('ab', 'c'), workItemId('a', 'bc'));
  assert.throws(() => workItemId('', 'record-1'), /来源ID不能为空/);
  assert.throws(() => workItemId('source-1', ' '), /来源记录ID不能为空/);
});

test('按模块注册来源后，同一快照提供任务列表、状态计数和部门计数', () => {
  const registry = new WorkItemRegistry();
  registry.register({ sourceId: 'project-plan', listWorkItems: () => [planItem] });
  registry.register({
    sourceId: 'contract',
    listWorkItems: () => [
      { sourceRecordId: 'contract-3', title: '签约确认', department: '合同管理', owner: '李四', status: 'completed' },
    ],
  });

  const view = registry.view();
  assert.deepEqual(registry.registeredSourceIds(), ['project-plan', 'contract']);
  assert.equal(view.items.length, 2);
  assert.deepEqual(view.counts, {
    total: 2,
    open: 1,
    completed: 1,
    byDepartment: { 项目管理: 1, 合同管理: 1 },
  });
  assert.equal(view.items[0].id, workItemId('project-plan', 'plan:12'));
  assert.equal(view.items[0].owner, '张三');
  assert.throws(
    () => registry.register({ sourceId: 'project-plan', listWorkItems: () => [] }),
    /来源重复注册/,
  );
});

test('通知已读和工作完成是分离状态，完成者不覆盖原负责人', () => {
  const registry = new WorkItemRegistry();
  registry.register({ sourceId: 'project-plan', listWorkItems: () => [planItem] });
  const item = registry.collect()[0];
  const notice = { id: 'notice-1', workItemId: item.id, read: false };

  const readNotice = markWorkNoticeRead(notice);
  assert.equal(readNotice.read, true);
  assert.equal(notice.read, false);
  assert.equal(item.status, 'open');

  const completed = completeWorkItem(item, '王五', '2026-10-15T01:00:00.000Z');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.owner, '张三');
  assert.equal(completed.completedBy, '王五');
  assert.equal(completed.completedAt, '2026-10-15T01:00:00.000Z');
  assert.equal(item.status, 'open');
});

test('同一来源返回重复记录时拒绝产生歧义任务ID', () => {
  const registry = new WorkItemRegistry();
  registry.register({ sourceId: 'project-plan', listWorkItems: () => [planItem, planItem] });
  assert.throws(() => registry.collect(), /重复记录/);
});

test('财务来源保留可用、待提供和不可用状态，不把缺来源转换成零余额', () => {
  const available: FinanceSummaryResult = {
    status: 'available',
    sourceId: 'invoice-ledger',
    balances: [{ currency: 'USD', amount: 125.5 }],
    asOf: '2026-10-15',
  };
  const summaries = collectFinanceSummaries([
    { sourceId: 'invoice-ledger', getSummary: () => available },
    {
      sourceId: 'project-cost',
      getSummary: () => ({ status: 'missing', sourceId: 'project-cost', reason: '当前项目尚无成本来源' }),
    },
    {
      sourceId: 'sap-cost',
      getSummary: () => ({ status: 'unavailable', sourceId: 'sap-cost', reason: '本演示未接入 SAP' }),
    },
  ]);

  assert.deepEqual(summaries, [
    available,
    { status: 'missing', sourceId: 'project-cost', reason: '当前项目尚无成本来源' },
    { status: 'unavailable', sourceId: 'sap-cost', reason: '本演示未接入 SAP' },
  ]);
  assert.equal(summaries.some((summary) => summary.status !== 'available' && 'balances' in summary), false);
  assert.deepEqual(summaries[0].status === 'available' ? summaries[0].balances : [], [
    { currency: 'USD', amount: 125.5 },
  ]);
  assert.deepEqual(collectFinanceSummaries([]), []);
});

test('财务摘要来源标识必须一致且唯一', () => {
  assert.throws(
    () => collectFinanceSummaries([
      { sourceId: 'crm-finance', getSummary: () => ({ status: 'missing', sourceId: 'other', reason: '待接入' }) },
    ]),
    /来源ID不匹配/,
  );
  assert.throws(
    () => collectFinanceSummaries([
      { sourceId: 'crm-finance', getSummary: () => ({ status: 'missing', sourceId: 'crm-finance', reason: '待接入' }) },
      { sourceId: 'crm-finance', getSummary: () => ({ status: 'missing', sourceId: 'crm-finance', reason: '待接入' }) },
    ]),
    /来源重复注册/,
  );
});
