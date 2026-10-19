import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectReturnEntry } from '../src/app/core/project-return-entry';

test('统一容器按来源渲染返回入口，共享项目看板与部门记录都可返回', () => {
  assert.deepEqual(projectReturnEntry('/projects/board'), {
    path: '/projects/board',
    label: '返回共享项目看板',
  });
  assert.deepEqual(projectReturnEntry('/sales/opportunities?tab=departments&dept=PM'), {
    path: '/sales/opportunities?tab=departments&dept=PM',
    label: '返回部门记录',
  });
  assert.deepEqual(projectReturnEntry('/sales/opportunities'), {
    path: '/sales/opportunities',
    label: '返回商机列表',
  });
  assert.deepEqual(projectReturnEntry('/sales/departments?dept=PM'), {
    path: '/sales/departments?dept=PM',
    label: '返回部门记录',
  });
  assert.deepEqual(projectReturnEntry('/projects'), { path: '/projects', label: '返回项目工作' });
  assert.deepEqual(projectReturnEntry('/'), { path: '/', label: '返回我的待办' });
  // 待办链接自带的 returnLabel 优先，其他来源文案不变。
  assert.equal(projectReturnEntry('/projects/board', '返回共享看板')?.label, '返回共享看板');
  assert.equal(projectReturnEntry('/projects/board', '  ')?.label, '返回共享项目看板');
});

test('未登记来源、外部地址与空值不渲染返回入口', () => {
  for (const value of [
    undefined,
    null,
    '',
    '   ',
    '/projects/P-42',
    '/unregistered/path',
    'https://example.invalid/projects/board',
    '//example.invalid/projects/board',
    '/projects/board/extra',
  ]) {
    assert.equal(projectReturnEntry(value), null, String(value));
  }
});
