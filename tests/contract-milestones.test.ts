import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contractMilestoneError,
  makeContractMilestone,
  ContractMilestoneInput,
} from '../src/app/core/contract-milestones';
const valid = (): ContractMilestoneInput => ({
  contractId: 'C1',
  name: '交付约定',
  dueDate: '2028-02-29',
  warningLeadDays: 0,
  ownerPersonId: 'demo-person-sales-zhang',
  expectedDataVersion: 1,
});
test('合同里程碑严格校验纯日期、非负整数及稳定人员ID', () => {
  assert.equal(contractMilestoneError(valid()), null);
  for (const dueDate of ['2026-02-29', '2026-04-31', '2026-01-01T00:00:00Z', '', '2026-1-01'])
    assert.match(contractMilestoneError({ ...valid(), dueDate })!, /日期/);
  for (const warningLeadDays of [null, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.match(contractMilestoneError({ ...valid(), warningLeadDays })!, /非负整数/);
  assert.match(contractMilestoneError({ ...valid(), ownerPersonId: '张销售' })!, /负责人/);
});
test('编辑保留稳定ID、所属合同与真实创建时间，禁止跨合同移动', () => {
  const created = makeContractMilestone(valid(), undefined, 'CM-1', '2026-10-16T12:34:56.000Z');
  assert.equal(created.warningLeadDays, 0);
  const input = { ...valid(), id: created.id, name: '改期交付', warningLeadDays: 7 };
  const edited = makeContractMilestone(input, created, 'CM-unused', '2026-10-17T12:34:56.000Z');
  assert.equal(edited.id, created.id);
  assert.equal(edited.createdAt, created.createdAt);
  assert.equal(created.name, '交付约定');
  assert.throws(
    () => makeContractMilestone({ ...input, contractId: 'C2' }, created, '', ''),
    /所属合同/,
  );
});
