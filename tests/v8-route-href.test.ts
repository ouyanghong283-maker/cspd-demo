import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRouteHref } from '../src/app/core/route-href';
import { planWarningHref } from '../src/app/core/plan-warnings';

test('WAR06 href 文本拆成 routerLink 需要的 path 与 queryParams', () => {
  const href = planWarningHref('DEMO-P001', { id: 'DEMO-P001-W3', type: '内部WBS' });
  const parsed = parseRouteHref(href);
  assert.equal(parsed.path, '/projects/DEMO-P001');
  assert.equal(parsed.query['tab'], '计划执行');
  assert.equal(parsed.query['plan'], '内部WBS');
  assert.equal(parsed.query['planId'], 'DEMO-P001-W3');
  assert.ok(!parsed.path.includes('?'), 'path 不能包含查询串，否则会被整体编码进 URL');
});

test('WAR06 无查询串的链接保持原路径且 query 为空', () => {
  assert.deepEqual(parseRouteHref('/projects/DEMO-P001'), {
    path: '/projects/DEMO-P001',
    query: {},
  });
  assert.deepEqual(parseRouteHref(''), { path: '/', query: {} });
});

test('WAR06 带中文与重复编码的查询值原样还原', () => {
  const parsed = parseRouteHref('/projects/DEMO-P002?tab=%E5%90%88%E5%90%8C&plan=%E5%AE%A2%E6%88%B7%E4%B8%BB%E8%8A%82%E7%82%B9');
  assert.equal(parsed.path, '/projects/DEMO-P002');
  assert.equal(parsed.query['tab'], '合同');
  assert.equal(parsed.query['plan'], '客户主节点');
});
