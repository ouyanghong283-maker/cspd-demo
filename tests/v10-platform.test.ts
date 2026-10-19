import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/app/core/seed';
import {
  buildV10Target,
  openV10Target,
  createV10ReadSession,
  selectV10Board,
  selectV10Exceptions,
} from '../src/app/core/v10-contracts';

const input = () => ({
  state: { ...createSeed(), roundId: 'ROUND-A', dataVersion: 1 },
  workspaceId: 'WS-A',
  nowUtc: '2026-10-18T16:00:00.000Z',
  observationDate: '2026-10-15',
  lastSuccessfulReadAt: null,
});
test('同一数据版本切换观察日与跨上海自然日时，公开消费得到新的读取修订', () => {
  const session = createV10ReadSession();
  const source = input();
  const first = session.read(source);
  const next = session.read({
    ...source,
    observationDate: '2026-10-22',
    nowUtc: '2026-10-19T16:00:00.000Z',
  });
  assert.equal(next.context.dataVersion, first.context.dataVersion);
  assert.notEqual(next.context.contextRevision, first.context.contextRevision);
  assert.equal(next.context.dates.solutionBusinessDate, '2026-10-20');
  assert.equal(next.context.dates.planObservationDate, '2026-10-22');
  const board = selectV10Board(next.state, next.context);
  assert.equal(board.contextRevision, next.context.contextRevision);
  assert.equal(board.dates.planObservationDate, '2026-10-22');
  assert.equal(source.state.operationEvents?.length ?? 0, 0);
});

test('文件检查发布checking和新修订；读取失败为unavailable，旧工作区与旧修订回调不回填', async () => {
  const session = createV10ReadSession();
  const source = input();
  const original = session.read(source);
  let finish!: (v: 'present') => void;
  const late = session.checkFiles(original, {
    FILE: () =>
      new Promise<'present'>((r) => {
        finish = r;
      }),
  });
  assert.equal(session.current()!.context.fileAvailability.FILE, 'checking');
  const switched = session.read({ ...source, workspaceId: 'WS-B' });
  finish('present');
  assert.equal(await late, null);
  assert.equal(session.current(), switched);
  const checked = await session.checkFiles(switched, {
    FILE: async () => {
      throw Error('IDB blocked');
    },
  });
  assert.equal(checked!.context.fileAvailability.FILE, 'unavailable');
  assert.notEqual(checked!.context.contextRevision, switched.context.contextRevision);
  let finishOld!: (v: 'present') => void;
  const old = session.checkFiles(checked!, {
    FILE: () =>
      new Promise<'present'>((r) => {
        finishOld = r;
      }),
  });
  session.read({ ...source, workspaceId: 'WS-B', observationDate: '2026-10-22' });
  finishOld('present');
  assert.equal(await old, null);
});

test('公共目标只生成登记入口和原项目财务参数，合法页签保留，非法页签明确回退', async () => {
  assert.equal(buildV10Target({ page: 'board' }).href, '/projects/board');
  assert.equal(
    buildV10Target({ page: 'finance', tab: 'budget' }).href,
    '/projects/board/finance?tab=budget',
  );
  assert.equal(
    buildV10Target({ page: 'exceptions', tab: 'management' }).href,
    '/projects/board/exceptions?tab=management',
  );
  const project = buildV10Target({ page: 'project-finance', projectId: 'P/1' });
  assert.equal(
    project.href,
    '/projects/P%2F1?tab=overview&section=%E8%B4%A2%E5%8A%A1%E4%BF%A1%E6%81%AF',
  );
  const invalid = buildV10Target({ page: 'finance', tab: 'evil' });
  assert.equal(invalid.href, '/projects/board/finance?tab=margin');
  assert.equal(invalid.notices.length, 1);
  const visited: string[] = [];
  await openV10Target(
    {
      navigateByUrl: async (href) => {
        visited.push(href);
        return true;
      },
    },
    { page: 'project-finance', projectId: 'MISSING' },
  );
  assert.equal(
    visited[0],
    '/projects/MISSING?tab=overview&section=%E8%B4%A2%E5%8A%A1%E4%BF%A1%E6%81%AF',
  );
});

test('局部财务不可读不伪装零，也不阻断客户交付；文件缺失与不可读保持不同', async () => {
  const session = createV10ReadSession();
  const source = input();
  const snapshot = session.read({ ...source, sources: { finance: 'unavailable' } });
  const checked = await session.checkFiles(snapshot, {
    ABSENT: async () => 'missing',
    BLOCKED: async () => 'unavailable',
  });
  assert.equal(checked!.context.fileAvailability.ABSENT, 'missing');
  assert.equal(checked!.context.fileAvailability.BLOCKED, 'unavailable');
  const board = selectV10Board(checked!.state, checked!.context);
  assert.equal(board.overview.finance.status, 'unavailable');
  assert.equal(board.overview.finance.summary, null);
  const exceptions = selectV10Exceptions(checked!.state, checked!.context);
  assert.notEqual(exceptions.status, 'unavailable');
});

test('读取会话切换观察日后，消费同一客户承诺由预警变为延期2天；快照与财务期间不变', () => {
  const source = input();
  const state = source.state;
  const p = state.projects[0];
  const plan = p.plans.find((p) => p.type === '要货发货')!;
  const milestone = p.plans.find((p) => p.id === plan.customerMilestoneId)!;
  assert.ok(milestone);
  milestone.end = '2026-10-20';
  milestone.warningLeadDays = 5;
  plan.status = '待开始';
  state.customerDeliveryMappings = [
    {
      id: 'SHIP',
      projectId: p.id,
      planId: plan.id,
      customerMilestoneId: milestone.id,
      category: 'shipment',
      source: 'S12',
      revision: 1,
    },
  ];
  const before = JSON.stringify(state);
  const session = createV10ReadSession();
  const first = session.read(source);
  const a = selectV10Exceptions(first.state, first.context).delivery!.projects.find(
    (row) => row.projectId === p.id,
  )!;
  assert.equal(a.delivery!.nodes.find((n) => n.mappingId === 'SHIP')!.status, 'warning');
  const next = session.read({ ...source, observationDate: '2026-10-22' });
  const b = selectV10Exceptions(next.state, next.context).delivery!.projects.find(
    (row) => row.projectId === p.id,
  )!;
  assert.equal(b.delivery!.nodes.find((n) => n.mappingId === 'SHIP')!.delayedDays, 2);
  assert.equal(JSON.stringify(state), before);
});

test('不同页面读取会话的修订不碰撞，避免共享缓存复用其他页面的文件结论', () => {
  const source = input();
  assert.notEqual(
    createV10ReadSession().read(source).context.contextRevision,
    createV10ReadSession().read(source).context.contextRevision,
  );
});
