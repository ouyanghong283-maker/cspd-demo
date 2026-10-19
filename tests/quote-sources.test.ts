import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, prepare } from './v4-harness';
test('保存草稿引用稳定的需求ID及当前核心方案，正式提交需服务条件', () => {
  const { store, role } = harness();
  const id = 'DEMO-O014';
  const v = store.quoteSeries(id)!.versions[0];
  v.status = '草稿';
  v.sourceAttachmentIds = [];
  store.saveQuote(structuredClone(v));
  assert.ok(store.quoteVersion(v.id)!.sourceAttachmentIds.includes('DEMO-ATT13'));
  assert.throws(() => store.submitQuote(v.id), /核心方案/);
  prepare(store, role, id);
  assert.equal(store.submitQuote(v.id), true);
  assert.throws(() => store.saveQuote(v), /已提交|已更新/);
});
test('需求表不替代核心方案，其他商机资料不能借用，来源线索ID稳定', () => {
  const { store, role } = harness();
  const id = 'DEMO-O014';
  const v = store.quoteSeries(id)!.versions[0];
  v.status = '草稿';
  v.sourceAttachmentIds = ['DEMO-ATT0'];
  store.state().attachments = store.state().attachments.filter((a) => a.entityId !== id);
  store.saveQuote(v);
  assert.deepEqual(store.quoteVersion(v.id)!.sourceAttachmentIds, []);
  assert.throws(() => store.submitQuote(v.id), /核心方案/);
  store.state().sales.find((x) => x.id === id)!.leadId = 'DEMO-L001';
  store
    .state()
    .attachments.push({
      ...store.state().attachments[0],
      id: 'source-lead',
      entityId: 'DEMO-L001',
    });
  store.saveQuote(structuredClone(store.quoteVersion(v.id)!));
  assert.deepEqual(
    store.quoteSourceFiles(v.id).map((x) => x.id),
    ['source-lead'],
  );
  prepare(store, role, id);
  assert.equal(store.submitQuote(v.id), true);
  assert.ok(store.quoteSourceFiles(v.id).some((x) => x.id === 'source-lead'));
});
