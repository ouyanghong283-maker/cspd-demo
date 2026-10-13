import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { DemoStore } from '../src/app/core/store';
import { createSeed } from '../src/app/core/seed';

test('报价保存草稿后引用当前商机资料，提交审核沿用同一引用', () => {
  const state = createSeed();
  const series = state.quoteSeries!.find(s => s.opportunityId === 'DEMO-O014')!;
  const version = series.versions[0];
  version.status = '草稿'; version.sourceAttachmentIds = [];
  const store = Object.create(DemoStore.prototype) as DemoStore;
  Object.assign(store, { state: signal(state), role: () => 'sales', person: () => '张销售', ui: { notify() {}, fail(message: string) { throw new Error(message); } } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() {} } });
  assert.equal(store.saveQuote(structuredClone(version)), true);
  const saved = store.quoteVersion(version.id)!;
  assert.ok(saved.sourceAttachmentIds.includes('DEMO-ATT13'), '保存草稿未引用已存在的需求资料');
  assert.equal(store.submitQuote(version.id), true);
  assert.equal(store.quoteVersion(version.id)!.status, '待模拟审核');
  assert.deepEqual(store.quoteVersion(version.id)!.sourceAttachmentIds, saved.sourceAttachmentIds);
  assert.throws(() => store.saveQuote(version), /当前报价已提交/);
  assert.equal(store.quoteVersion(version.id)!.status, '待模拟审核');
});

test('缺少资料不得借用其他商机附件通过提交，来源线索资料可以引用', () => {
  const state = createSeed();
  const series = state.quoteSeries!.find(s => s.opportunityId === 'DEMO-O014')!;
  const version = series.versions[0];
  version.status = '草稿'; version.sourceAttachmentIds = ['DEMO-ATT0'];
  state.attachments = state.attachments.filter(a => a.entityId !== series.opportunityId);
  const store = Object.create(DemoStore.prototype) as DemoStore;
  Object.assign(store, { state: signal(state), role: () => 'sales', person: () => '张销售', ui: { notify() {}, fail(message: string) { throw new Error(message); } } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() {} } });
  store.saveQuote(version);
  assert.deepEqual(store.quoteVersion(version.id)!.sourceAttachmentIds, []);
  assert.throws(() => store.submitQuote(version.id), /引用需求表或方案报价资料/);
  const updated = structuredClone(store.state());
  updated.sales.find(s => s.id === series.opportunityId)!.leadId = 'DEMO-L001';
  updated.attachments.push({ ...state.attachments[0], id: 'source-lead', entityId: 'DEMO-L001' });
  store.state.set(updated);
  store.saveQuote(store.quoteVersion(version.id)!);
  assert.deepEqual(store.quoteSourceFiles(version.id).map(a => a.id), ['source-lead']);
  assert.equal(store.submitQuote(version.id), true);
});
