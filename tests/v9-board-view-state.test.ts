import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveBoardView, readBoardView } from '../src/app/core/management-board/view-state';
test('视图按工作区、轮次和路由隔离，存储失败可读反馈', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const scope = { workspaceId: 'W', roundId: 'R', route: '/projects/board' };
  const view = {
    filters: {
      projectIds: [],
      businessIds: [],
      grades: ['S'],
      departments: [],
      firstResults: [],
      query: '项目',
    },
    section: 'execution',
    scrollY: 630,
  };
  assert.equal(saveBoardView(storage, scope, view), null);
  assert.deepEqual(readBoardView(storage, scope).view, view);
  assert.equal(readBoardView(storage, { ...scope, roundId: 'R2' }).view, null);
  assert.equal(readBoardView(storage, { ...scope, workspaceId: 'W2' }).view, null);
  assert.equal(readBoardView(storage, { ...scope, route: '/other' }).view, null);
  assert.match(
    saveBoardView(
      {
        setItem() {
          throw Error('full');
        },
      },
      scope,
      view,
    )!,
    /无法保存/,
  );
  data.set([...data.keys()][0], '{');
  assert.match(readBoardView(storage, scope).error!, /无法恢复/);
});

test('看板展开状态与原筛选同域恢复，非法展开值明确拒绝', () => {
  let raw = '';
  const storage = {
    getItem: () => raw || null,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
  const scope = { workspaceId: 'W', roundId: 'R', route: '/projects/board' };
  const view = {
    filters: {
      projectIds: [],
      businessIds: [],
      grades: [],
      departments: [],
      firstResults: [],
      query: '',
    },
    section: 'all',
    scrollY: 400,
    advancedOpen: true,
    collaborationOpen: true,
  };
  saveBoardView(storage, scope, view);
  assert.deepEqual(readBoardView(storage, scope).view, view);
  raw = JSON.stringify({ ...view, advancedOpen: 'false' });
  assert.equal(readBoardView(storage, scope).view, null);
  raw = JSON.stringify({ ...view, collaborationOpen: 1 });
  assert.equal(readBoardView(storage, scope).view, null);
});

test('减弱动效与来源焦点同域恢复，损坏偏好拒绝且不执行来源内容', () => {
  let raw = '';
  const storage = {
    getItem: () => raw || null,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
  const scope = { workspaceId: 'W', roundId: 'R', route: '/projects/board' };
  const view = {
    filters: {
      projectIds: [],
      businessIds: [],
      grades: [],
      departments: [],
      firstResults: [],
      query: '',
    },
    section: 'all',
    scrollY: 900,
    reducedMotion: true,
    focusHref: '/sales/solutions/DEMO-O008?returnTo=%2Fprojects%2Fboard',
    focusKey: 'solution:DEMO-O008',
  };
  assert.equal(saveBoardView(storage, scope, view), null);
  assert.deepEqual(readBoardView(storage, scope).view, view);
  for (const invalid of [
    { reducedMotion: 'false' },
    { focusHref: 42 },
    { focusKey: false },
    { focusHref: 'x'.repeat(4097) },
  ]) {
    raw = JSON.stringify({ ...view, ...invalid });
    const result = readBoardView(storage, scope);
    assert.equal(result.view, null);
    assert.match(result.error!, /无法恢复/);
  }
});
