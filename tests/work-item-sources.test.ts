import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/app/core/seed';
import { Plan, TeamMember } from '../src/app/core/models';
import {
  collectDemoFinanceSummaries,
  collectDemoProjectWorkItems,
  collectDemoWorkItems,
} from '../src/app/core/work-item-sources';
import { workItemId } from '../src/app/core/work-item-registry';

const plan = (id: string, status = '进行中'): Plan => ({
  id,
  type: '内部WBS',
  name: '设计评审',
  owner: '项目经理甲',
  start: '2026-10-10',
  end: '2026-10-11',
  expected: '2026-10-11',
  actual: '',
  status,
  product: '',
  quantity: 0,
  batch: '',
  linked: '',
  amount: 0,
  currency: 'CNY',
  result: '',
  receiver: '',
  note: '',
});

test('公开来源汇总从真实计划和部门任务生成同一ID，通知已读不进入待办', () => {
  const state = createSeed();
  const project = state.projects[0];
  state.projects = [project];
  project.briefing.startupHandover = undefined;
  project.plans = [plan('plan-1'), plan('plan-done', '已完成')];
  const sale = state.sales.find((item) => item.type === 'opportunity')!;
  state.sales = [sale];
  sale.departmentTasks = [
    { id: 'dept-1', department: '解决方案', name: '方案初判', status: '进行中' },
    {
      id: 'dept-done',
      department: '销售',
      name: '客户沟通',
      status: '已完成',
      completedBy: '销售乙',
    },
  ];
  state.notices = [
    {
      id: 'notice-1',
      key: 'reminder',
      entityId: sale.id,
      role: 'sales',
      title: '提醒',
      text: '已读提醒',
      read: true,
      resolved: false,
      date: '2026-10-10',
    },
  ];

  const all = collectDemoWorkItems(state);
  const projectView = collectDemoProjectWorkItems(state);
  const planId = workItemId('project-plan', `${project.id}:plan-1`);
  const departmentTaskId = workItemId('department-task', `${sale.id}:dept-1`);

  assert.deepEqual(
    all.items.map((item) => item.id),
    [planId, departmentTaskId, workItemId('department-task', `${sale.id}:dept-done`)],
  );
  assert.equal(all.counts.total, 3);
  assert.equal(all.counts.open, 2);
  assert.equal(projectView.items[0].id, planId);
  assert.deepEqual(projectView.counts, {
    total: 1,
    open: 1,
    completed: 0,
    byDepartment: { 'PMO / PM': 1 },
  });
  assert.equal(all.items.find((item) => item.id === departmentTaskId)?.status, 'open');
  assert.equal(
    all.items.find((item) => item.id === workItemId('department-task', `${sale.id}:dept-done`))
      ?.owner,
    '负责人待核',
  );
  assert.equal(
    all.items.some((item) => item.title === '提醒'),
    false,
  );
  assert.deepEqual(
    collectDemoWorkItems(state, '项目经理甲').items.map((item) => item.id),
    [planId],
  );
});

test('财务摘要只汇总已保存发票快照并保留币种；来源缺失时明确待提供', () => {
  const state = createSeed();
  state.financeSnapshots = [];
  state.contractInvoices = [];
  assert.deepEqual(collectDemoFinanceSummaries(state), [
    {
      status: 'missing',
      sourceId: 'project-finance-snapshots',
      reason: '当前没有可汇总的项目发票记录；财务摘要待提供。',
    },
  ]);
  state.financeSnapshots = [
    {
      projectId: 'P-1',
      sc: '模拟',
      scope: '演示',
      refreshedAt: '2026-10-15',
      expenses: [],
      events: [],
      invoices: [
        {
          id: 'I-1',
          number: 'INV-1',
          amount: 120,
          currency: 'USD',
          issued: '2026-10-01',
          due: '2026-11-01',
          received: 20,
        },
        {
          id: 'I-2',
          number: 'INV-2',
          amount: 80,
          currency: 'EUR',
          issued: '2026-10-01',
          due: '2026-11-01',
          received: 30,
        },
      ],
    },
    {
      projectId: 'P-1',
      sc: '模拟',
      scope: '演示刷新快照',
      refreshedAt: '2026-10-16',
      expenses: [],
      events: [],
      invoices: [
        {
          id: 'I-1',
          number: 'INV-1',
          amount: 120,
          currency: 'USD',
          issued: '2026-10-01',
          due: '2026-11-01',
          received: 20,
        },
      ],
    },
  ];
  assert.deepEqual(collectDemoFinanceSummaries(state), [
    {
      status: 'available',
      sourceId: 'project-finance-snapshots',
      balances: [
        { currency: 'USD', amount: 100 },
        { currency: 'EUR', amount: 50 },
      ],
      asOf: '2026-10-16',
    },
  ]);
});

test('财务摘要使用当前发票来源ID，合同发票与待核结果均不触发来源契约异常', () => {
  const state = createSeed();
  state.financeSnapshots = [];
  state.contractInvoices = [
    {
      id: 'invoice-canonical-1',
      number: 'INV-CANONICAL-1',
      amount: 100,
      currency: 'USD',
      issued: '2026-10-01',
      due: '2026-11-01',
      received: 25,
      contractId: 'CONTRACT-1',
      projectIds: [],
      revision: 1,
      updatedAt: '2026-10-15T00:00:00.000Z',
      cumulativeSource: 'legacy-simulation',
    },
  ];

  assert.deepEqual(collectDemoFinanceSummaries(state), [
    {
      status: 'available',
      sourceId: 'contract-invoices',
      balances: [{ currency: 'USD', amount: 75 }],
      asOf: '2026-10-15T00:00:00.000Z',
    },
  ]);

  state.migrationReviewItems = [
    {
      id: 'review-invoice-1',
      entityType: 'invoice',
      entityId: 'legacy-invoice-1',
      relation: 'contractId',
      reason: '合同归属待核',
      sourceRecord: 'legacy-invoice-1',
    },
  ];
  assert.deepEqual(collectDemoFinanceSummaries(state), [
    {
      status: 'unavailable',
      sourceId: 'contract-invoices',
      reason: '有1项历史发票关联待核，暂不能提供可信的统一余额汇总。',
    },
  ]);
});

test('部门任务通过稳定DEPT成员ID解析唯一责任人；旧任务归属待核且不进入个人待办', () => {
  const state = createSeed();
  const sale = state.sales.find((item) => item.type === 'opportunity')!;
  state.sales = [sale];
  const team: TeamMember[] = [
    {
      id: 'member-a',
      role: 'solution',
      person: '方案甲',
      department: '解决方案',
      window: '',
      confirmed: true,
      confirmedBy: '',
    },
    {
      id: 'member-b',
      role: 'solution',
      person: '方案乙',
      department: '解决方案',
      window: '',
      confirmed: true,
      confirmedBy: '',
    },
  ];
  sale.team = team;
  sale.departmentTasks = [
    { id: 'DEPT-member-b', department: '解决方案', name: '乙的准备', status: '进行中' },
    { id: 'legacy-task', department: '解决方案', name: '旧版任务', status: '进行中' },
  ];

  const view = collectDemoWorkItems(state);
  const assignedTask = view.items.find((item) => item.sourceRecordId.endsWith(':DEPT-member-b'))!;
  const legacyTask = view.items.find((item) => item.sourceRecordId.endsWith(':legacy-task'))!;

  assert.equal(assignedTask.owner, '方案乙');
  assert.equal(legacyTask.owner, '负责人待核');
  assert.deepEqual(collectDemoWorkItems(state, '方案甲').items, []);
  assert.deepEqual(
    collectDemoWorkItems(state, '方案乙').items.map((item) => item.id),
    [assignedTask.id],
  );
});
