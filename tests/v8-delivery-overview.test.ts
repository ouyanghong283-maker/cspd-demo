import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryRows, filterDeliveryRows } from '../src/app/core/delivery-overview';
import type { Project, Plan } from '../src/app/core/models';
const plan = (id: string, end: string): Plan =>
  ({ id, end, name: id, status: '进行中', warningLeadDays: 3 }) as Plan;
const project = (id: string, plans: Plan[] = []): Project =>
  ({
    id,
    name: id,
    contractId: 'SAME-CONTRACT',
    customerId: 'C',
    pm: '李经理',
    status: '交付中',
    plans,
    conditions: [],
    handover: { status: '待接收', issues: [], categories: [] },
  }) as unknown as Project;
test('同合同的项目分别展示、重复ID不增行，异常优先后按日期且等值稳定', () => {
  const rows = deliveryRows(
    [
      project('B', [plan('normal', '2026-12-01')]),
      project('A', [plan('late', '2026-10-01')]),
      project('C', [plan('same', '2026-10-01')]),
      project('A'),
    ],
    [],
    '2026-10-15',
  );
  assert.deepEqual(
    rows.map((r) => r.project.id),
    ['A', 'C', 'B'],
  );
  assert.equal(rows[0].exceptionState, '异常');
  assert.equal(rows[2].exceptionState, '无未完成异常');
});
test('缺失字段不会显示正常或零；缺结束日保留待提供', () => {
  const rows = deliveryRows([{ id: 'legacy', plans: [] } as Project], [], '2026-10-15');
  assert.equal(rows[0].customer, '待提供');
  assert.equal(rows[0].pm, '待提供');
  assert.equal(rows[0].stage, '待提供');
  assert.equal(rows[0].exceptionState, '待提供');
  assert.equal(rows[0].handover, '待提供');
  assert.equal(rows[0].nextNode, '待提供');
});
test('已完成任务不产生未完成异常；预计日期不会替代计划排序日期', () => {
  const done = { ...plan('done', '2026-10-01'), status: '已完成', actual: '2026-10-02' };
  const forecast = { ...plan('forecast', '2026-10-01'), expected: '2026-12-01' };
  const rows = deliveryRows(
    [project('done', [done]), project('forecast', [forecast])],
    [],
    '2026-10-15',
  );
  assert.equal(rows[0].project.id, 'forecast');
  assert.equal(rows[0].nextDate, '2026-10-01');
  assert.equal(rows[1].exceptions.length, 0);
});
test('项目客户搜索、PM、阶段、异常过滤同时约束同一组项目', () => {
  const rows = deliveryRows(
    [project('one', [plan('late', '2026-10-01')]), { ...project('two'), pm: '张经理' }],
    [{ id: 'C', shortName: '测试客户' }] as never,
    '2026-10-15',
  );
  const filters = { search: '测试客户', pm: '李经理', stage: '交付中', exception: '异常' };
  assert.deepEqual(
    filterDeliveryRows(rows, filters).map((r) => r.project.id),
    ['one'],
  );
  assert.equal(filterDeliveryRows(rows, { ...filters, search: '不存在' }).length, 0);
});
