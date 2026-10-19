import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wbsHierarchy } from '../src/app/core/wbs-hierarchy';

test('按已有WBS编码归入父任务，支持多级结构且保留同级顺序', () => {
  const plans = [
    { id: 'child', wbsCode: '1.1' },
    { id: 'other', wbsCode: '2' },
    { id: 'parent', wbsCode: '1' },
    { id: 'grandchild', wbsCode: '1.1.1' },
    { id: 'sibling', wbsCode: '1.2' },
  ];
  const original = JSON.stringify(plans);
  assert.deepEqual(
    wbsHierarchy(plans).map((r) => [r.plan.id, r.depth, r.childCount]),
    [
      ['other', 0, 0],
      ['parent', 0, 2],
      ['child', 1, 1],
      ['grandchild', 2, 0],
      ['sibling', 1, 0],
    ],
  );
  assert.equal(JSON.stringify(plans), original);
});

test('平级编号、缺失父级、重复父级编码不推断为父子关系', () => {
  const plans = [
    { id: 'a', wbsCode: 'WBS-01' },
    { id: 'b', wbsCode: 'WBS-02' },
    { id: 'orphan', wbsCode: '3.1' },
    { id: 'empty' },
    { id: 'dup1', wbsCode: '1' },
    { id: 'dup2', wbsCode: '1' },
    { id: 'ambiguous', wbsCode: '1.1' },
  ];
  assert(wbsHierarchy(plans).every((r) => r.depth === 0 && r.childCount === 0));
  assert.deepEqual(
    wbsHierarchy(plans).map((r) => r.plan.id),
    plans.map((p) => p.id),
  );
  assert.deepEqual(wbsHierarchy([]), []);
});
