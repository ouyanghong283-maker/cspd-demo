import test from 'node:test';
import assert from 'node:assert/strict';
import { createV10ViewSession } from '../src/app/core/management-v10-platform/view-state';
const scope = { workspaceId: 'workspace-a', roundId: 'round-a' };
function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}
test('同轮返回恢复条件，合法URL逐项优先，状态点击清除旧搜索', () => {
  const store = storage();
  const first = createV10ViewSession(
    store,
    scope,
    '/projects/board/exceptions?tab=delivery&status=warning&query=客户',
  );
  first.save({ ...first.view, expanded: ['customer-a'], scrollY: 420, focusKey: 'project-a' });
  const restored = createV10ViewSession(store, scope, first.href);
  assert.equal(restored.view.filters.query, '客户');
  assert.deepEqual(restored.view.expanded, ['customer-a']);
  const explicit = createV10ViewSession(store, scope, first.href + '&status=delayed');
  assert.equal(explicit.view.filters.status, 'delayed');
  assert.equal(explicit.view.filters.query, '');
});
test('三层返回各自恢复；换工作区换轮不能带回旧父链', () => {
  const store = storage();
  const board = createV10ViewSession(store, scope, '/projects/board?query=客户');
  board.save(board.view);
  const finance = createV10ViewSession(
    store,
    scope,
    board.childHref('/projects/board/finance?tab=budget&currency=USD'),
  );
  finance.save({ ...finance.view, scrollY: 800 });
  const project = createV10ViewSession(
    store,
    scope,
    finance.childHref('/projects/DEMO-P001?tab=overview&section=财务信息'),
  );
  project.save(project.view);
  assert.equal(project.returnHref, finance.href);
  const back = createV10ViewSession(store, scope, project.returnHref!);
  assert.equal(back.view.scrollY, 800);
  assert.equal(back.view.filters.currency, 'USD');
  assert.equal(back.returnHref, board.href);
  for (const other of [
    { ...scope, roundId: 'round-b' },
    { ...scope, workspaceId: 'workspace-b' },
  ]) {
    const isolated = createV10ViewSession(store, other, finance.href);
    assert.equal(isolated.returnHref, null);
    assert.equal(isolated.view.filters.currency, '');
  }
});
test('非法条件、非整月与非法父链有说明；外部和循环目标拒绝', () => {
  const store = storage();
  const invalid = createV10ViewSession(
    store,
    scope,
    '/projects/board/exceptions?tab=bad&scope=bad&status=bad',
  );
  assert.equal(invalid.view.filters.tab, 'delivery');
  assert.equal(invalid.view.filters.scope, 'active');
  assert.equal(invalid.view.filters.status, '');
  assert.equal(invalid.notices.length, 3);
  const month = createV10ViewSession(
    store,
    scope,
    '/projects/board/finance?periodStart=2026-09-02&periodEnd=2026-09-30&currency=XXX',
  );
  assert.equal(month.view.filters.periodStart, '');
  assert.equal(month.view.filters.periodEnd, '');
  assert.equal(month.view.filters.currency, '');
  assert.ok(month.notices.some((n) => n.includes('整月')));
  assert.throws(() => month.childHref('//evil.com/projects/board'));
  assert.throws(() => month.childHref('/projects/%2Fetc'));
  assert.throws(() => month.childHref('/projects/board?returnTo=https://evil.com'));
  month.save(month.view);
  const id = new URL(month.href, 'http://local').searchParams.get('contextId');
  const cycle = createV10ViewSession(
    store,
    scope,
    month.href + '&returnContextId=' + encodeURIComponent('/projects/board/finance|' + id),
  );
  assert.equal(cycle.returnHref, null);
  assert.ok(cycle.notices.length);
});
test('会话存储不可用仍保留合法URL条件，返回保存失败说明', () => {
  const broken = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('quota');
    },
  };
  const view = createV10ViewSession(broken, scope, '/projects/board/finance?currency=EUR');
  assert.equal(view.view.filters.currency, 'EUR');
  assert.match(view.save(view.view)!, /可以继续查看/);
  assert.ok(view.notices.length);
});
test('页签专属搜索分别恢复，月份币种作为财务公共条件保留', () => {
  const store = storage();
  const margin = createV10ViewSession(
    store,
    scope,
    '/projects/board/finance?tab=margin&query=毛利&currency=EUR',
  );
  margin.save(margin.view);
  const budget = createV10ViewSession(store, scope, margin.href + '&tab=budget');
  assert.equal(budget.view.filters.query, '');
  assert.equal(budget.view.filters.currency, 'EUR');
  budget.save({ ...budget.view, filters: { ...budget.view.filters, query: '预算' } });
  const back = createV10ViewSession(store, scope, margin.href + '&tab=margin');
  assert.equal(back.view.filters.query, '毛利');
});
test('展示格式区分负数、零与未知，不混币种', async () => {
  const { formatV10Money, formatV10Percent } =
    await import('../src/app/core/management-v10-platform/format');
  assert.equal(formatV10Money(-123456, 'EUR'), '-1,234.56 EUR');
  assert.equal(formatV10Money(0, 'USD'), '0.00 USD');
  assert.equal(formatV10Money(null, 'CNY'), '未知');
  assert.equal(formatV10Percent(-0.125), '-12.50%');
  assert.equal(formatV10Percent(null), '不可计算');
});
test('带多余分隔符的自指返回上下文不能绕过循环检查', () => {
  const store = storage();
  const current = createV10ViewSession(store, scope, '/projects/board');
  current.save(current.view);
  const id = new URL(current.href, 'http://local').searchParams.get('contextId');
  const result = createV10ViewSession(
    store,
    scope,
    current.href + '&returnContextId=' + encodeURIComponent('/projects/board|' + id + '|'),
  );
  assert.equal(result.returnHref, null);
  assert.ok(result.notices.length);
});
