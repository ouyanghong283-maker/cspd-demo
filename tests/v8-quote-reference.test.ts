import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@angular/compiler';
import {
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler as ChangeDetectionScheduler,
  ɵEffectScheduler as EffectScheduler,
} from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { harness } from './v4-harness';
import { QuoteSeries } from '../src/app/core/models';
import { DemoStore } from '../src/app/core/store';
import { QuoteWorkspace } from '../src/app/features/quote-workspace';
import {
  contractQuoteDifferences,
  quoteReferenceCandidates,
} from '../src/app/core/quote-reference';

const totalsOf =
  (store: ReturnType<typeof harness>['store']) =>
  (version: Parameters<typeof store.quoteTotals>[0]) =>
    store.quoteTotals(version).total;
const moneyStub = (amount: number, currency: string) => `${currency} ${amount}`;

test('按报价号解析出最终锁定版本，带客户、商机、版本、金额币种与锁定状态', () => {
  const { store } = harness();
  const lookup = quoteReferenceCandidates(
    store.state(),
    { quoteNumber: 'DEMO-Q-006' },
    totalsOf(store),
  );
  assert.equal(lookup.candidates.length, 1);
  assert.deepEqual(lookup.candidates[0], {
    seriesId: 'DEMO-Q-006',
    seriesNumber: 'DEMO-Q-006',
    versionId: 'DEMO-QV-006-1',
    versionNumber: 1,
    versionLabel: 'V1',
    versionStatus: '最终锁定',
    finalLocked: true,
    lockedAt: '2026-10-09',
    lockedBy: '赵主管',
    opportunityId: 'DEMO-O005',
    opportunityName: '青山储能一期',
    customerId: 'DEMO-C005',
    customerName: '远景工业园',
    amount: 2480000,
    currency: 'CNY',
    selectable: true,
    issue: 'ok',
    message: '最终锁定版本，可显式关联到合同草稿。',
  });
  assert.match(lookup.message, /最终锁定/);
});

test('系列没有最终锁定版本时列出各版本但一律不可选，不自动取最新版本', () => {
  const { store } = harness();
  const lookup = quoteReferenceCandidates(
    store.state(),
    { quoteNumber: 'DEMO-Q-004' },
    totalsOf(store),
  );
  assert.deepEqual(
    lookup.candidates.map((x) => [x.versionLabel, x.versionStatus, x.finalLocked, x.selectable]),
    [
      ['V1', '已记录发出', false, false],
      ['V2', '草稿', false, false],
    ],
  );
  assert.ok(lookup.candidates.every((x) => x.issue === 'no-final-lock'));
  assert.ok(lookup.candidates.every((x) => x.message.includes('最终锁定')));
  assert.match(lookup.message, /没有可用于合同的最终锁定版本/);
  assert.match(lookup.message, /不自动选取最新版本/);
});

test('相似报价号与空输入不匹配，也不推算候选', () => {
  const { store } = harness();
  for (const quoteNumber of ['Q-006', 'DEMO-Q-006-1', 'DEMO-Q-06', 'DEMO-Q-999']) {
    const lookup = quoteReferenceCandidates(store.state(), { quoteNumber }, totalsOf(store));
    assert.deepEqual(lookup.candidates, [], quoteNumber);
    assert.match(lookup.message, /未找到报价号/);
  }
  for (const quoteNumber of ['', '   ']) {
    const lookup = quoteReferenceCandidates(store.state(), { quoteNumber }, totalsOf(store));
    assert.deepEqual(lookup.candidates, []);
    assert.match(lookup.message, /自由文本不产生报价版本引用/);
  }
});

test('商机或客户不一致时说明原因且不可选，不按相似关系推断归属', () => {
  const { store } = harness();
  const opportunityMismatch = quoteReferenceCandidates(
    store.state(),
    { quoteNumber: 'DEMO-Q-006', opportunityId: 'DEMO-O003', customerId: 'DEMO-C003' },
    totalsOf(store),
  ).candidates[0];
  assert.equal(opportunityMismatch.issue, 'opportunity-mismatch');
  assert.equal(opportunityMismatch.selectable, false);
  assert.match(opportunityMismatch.message, /属于商机 DEMO-O005/);
  assert.match(opportunityMismatch.message, /不自动更改合同归属/);

  const customerMismatch = quoteReferenceCandidates(
    store.state(),
    { quoteNumber: 'DEMO-Q-006', opportunityId: 'DEMO-O005', customerId: 'DEMO-C003' },
    totalsOf(store),
  ).candidates[0];
  assert.equal(customerMismatch.issue, 'customer-mismatch');
  assert.equal(customerMismatch.selectable, false);
  assert.match(customerMismatch.message, /合同客户/);
  assert.match(customerMismatch.message, /不自动更改合同归属/);
});

test('来源差异只做对比：一致、待补齐、人工值保留、双方均未提供', () => {
  const { store } = harness();
  const version = store.quoteVersion('DEMO-QV-006-1')!;
  const differences = contractQuoteDifferences({
    contract: {
      amount: 2480000,
      currency: 'CNY',
      payment: '签约30% / 发货60% / 验收10%（样例）',
      product: '人工填的产品',
      scope: '',
      delivery: '预计12周，正式交期以排产确认（样例）',
      warranty: '',
      service: '远程指导及现场服务范围待确认',
    },
    version,
    total: 2480000,
    money: moneyStub,
  });
  assert.deepEqual(
    differences.map((item) => [item.field, item.label, item.status]),
    [
      ['amount', '合同金额', '一致'],
      ['currency', '币种', '一致'],
      ['payment', '付款条件', '一致'],
      ['product', '产品', '人工值保留'],
      ['scope', '合同范围', '待补齐'],
      ['delivery', '交期', '一致'],
      ['warranty', '质保', '待补齐'],
      ['service', '服务约定', '一致'],
    ],
  );
  assert.equal(differences[0].contractValue, 'CNY 2480000');
  assert.equal(differences[0].sourceValue, 'CNY 2480000');
  assert.equal(differences[3].contractValue, '人工填的产品');
  assert.equal(differences[3].sourceValue, '储能系统');
  assert.equal(differences[4].sourceValue, '储能系统设备供货及约定服务（样例）');
});

test('金额缺失或双方同为空值时差异如实显示，不补造来源值', () => {
  const { store } = harness();
  const version = store.quoteVersion('DEMO-QV-001-1')!;
  const differences = contractQuoteDifferences({
    contract: {
      amount: 0,
      currency: 'CNY',
      payment: '',
      product: '',
      scope: '',
      delivery: '',
      warranty: '',
      service: '',
    },
    version,
    total: null,
    money: moneyStub,
  });
  assert.deepEqual(
    differences.map((item) => [item.field, item.status]),
    [
      ['amount', '双方均未提供'],
      ['currency', '一致'],
      ['payment', '待补齐'],
      ['product', '双方均未提供'],
      ['scope', '待补齐'],
      ['delivery', '待补齐'],
      ['warranty', '待补齐'],
      ['service', '待补齐'],
    ],
  );
  assert.equal(differences[0].sourceValue, '报价合计未明确');
});

function lockSeries(store: ReturnType<typeof harness>['store'], seriesNumber: string) {
  const series = store.state().quoteSeries!.find((item) => item.number === seriesNumber)!;
  const version = series.versions[series.versions.length - 1];
  version.status = '最终锁定';
  version.lockedBy = '赵主管';
  version.lockedDate = '2026-10-16';
  series.activeFinalVersionId = version.id;
  return { series, version };
}

test('显式选择后保存稳定ID与显示号，仅补空白且保留人工值', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const { series, version } = lockSeries(store, 'DEMO-Q-003');
  store.updateContractDraft(id, { scope: '人工填写的合同范围', product: '人工产品' });
  const before = store.state().contracts.find((row) => row.id === id)!;
  assert.equal(before.quoteVersionId, undefined);
  assert.equal(
    store.saveContractQuoteReference(id, { seriesId: series.id, versionId: version.id }),
    true,
  );
  const contract = store.state().contracts.find((row) => row.id === id)!;
  assert.equal(contract.quoteSeriesId, series.id);
  assert.equal(contract.quoteVersionId, version.id);
  assert.deepEqual(
    {
      seriesNumber: contract.quoteReferenceSnapshot?.seriesNumber,
      versionLabel: contract.quoteReferenceSnapshot?.versionLabel,
      versionNumber: contract.quoteReferenceSnapshot?.versionNumber,
      savedBy: contract.quoteReferenceSnapshot?.savedBy,
    },
    { seriesNumber: 'DEMO-Q-003', versionLabel: 'V1', versionNumber: 1, savedBy: '张销售' },
  );
  assert.ok(contract.quoteReferenceSnapshot?.savedAt);
  assert.equal(contract.scope, '人工填写的合同范围');
  assert.equal(contract.product, '人工产品');
  assert.equal(contract.payment, '签约30% / 发货60% / 验收10%（样例）');
  assert.equal(contract.delivery, '预计12周，正式交期以排产确认（样例）');
  assert.equal(store.state().operationEvents!.at(-1)!.taskSource.kind, 'contract-quote-reference');
});

test('自由文本或现有草稿表单都不能产生有效版本引用', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const before = structuredClone(store.state());
  for (const input of [
    { seriesId: 'DEMO-Q-003', versionId: 'DEMO-Q-003' },
    { seriesId: 'DEMO-Q-003-V1', versionId: 'V1' },
    { seriesId: '', versionId: 'DEMO-QV-003-1' },
  ]) {
    assert.throws(() => store.saveContractQuoteReference(id, input), /候选|版本/);
    assert.deepEqual(store.state(), before);
  }
  assert.equal(
    store.updateContractDraft(id, {
      quoteVersionId: 'DEMO-QV-006-1',
      quoteSeriesId: 'DEMO-Q-006',
    } as never),
    true,
  );
  const contract = store.state().contracts.find((row) => row.id === id)!;
  assert.equal(contract.quoteVersionId, undefined);
  assert.equal(contract.quoteSeriesId, undefined);
});

test('商机或客户不一致时说明原因、不可保存且不改动合同归属', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const before = structuredClone(store.state());
  assert.throws(
    () =>
      store.saveContractQuoteReference(id, { seriesId: 'DEMO-Q-006', versionId: 'DEMO-QV-006-1' }),
    /属于商机 DEMO-O005.*不自动更改合同归属/,
  );
  assert.deepEqual(store.state(), before);
  const { series, version } = lockSeries(store, 'DEMO-Q-003');
  version.customerId = 'DEMO-C005';
  assert.throws(
    () => store.saveContractQuoteReference(id, { seriesId: series.id, versionId: version.id }),
    /与合同客户 DEMO-C003.*不自动更改合同归属/,
  );
  const contract = store.state().contracts.find((row) => row.id === id)!;
  assert.equal(contract.opportunityId, 'DEMO-O003');
  assert.equal(contract.customerId, 'DEMO-C003');
  assert.equal(contract.quoteVersionId, undefined);
});

test('未关联草稿允许暂缺关联，并说明原因', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const view = store.contractQuoteReference(id);
  assert.equal(view.status, 'empty');
  assert.equal(view.displayNumber, '未关联');
  assert.equal(view.source, null);
  assert.match(view.message, /暂未关联报价版本/);
  assert.match(view.message, /自由文本不产生引用/);
});

test('已关联草稿可查看来源差异，人工值保留并标出来源不同', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const { series, version } = lockSeries(store, 'DEMO-Q-003');
  store.updateContractDraft(id, { product: '人工产品' });
  assert.equal(
    store.saveContractQuoteReference(id, { seriesId: series.id, versionId: version.id }),
    true,
  );
  const view = store.contractQuoteReference(id);
  assert.equal(view.status, 'linked');
  assert.equal(view.displayNumber, 'DEMO-Q-003 V1');
  assert.equal(view.lockedLabel, '最终锁定');
  assert.equal(view.source?.opportunityId, 'DEMO-O003');
  assert.equal(view.source?.customerId, 'DEMO-C003');
  assert.equal(view.source?.amount, null);
  assert.equal(view.source?.currency, 'EUR');
  assert.equal(view.differences.find((item) => item.field === 'amount')!.status, '人工值保留');
  assert.equal(
    view.differences.find((item) => item.field === 'amount')!.sourceValue,
    '报价合计未明确',
  );
  const product = view.differences.find((item) => item.field === 'product')!;
  assert.equal(product.status, '人工值保留');
  assert.equal(product.contractValue, '人工产品');
  assert.equal(product.sourceValue, '储能系统');
  assert.equal(view.differences.find((item) => item.field === 'scope')!.status, '一致');
});

test('未知旧来源保留待核，不按相似报价号或最新版本补造', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const contract = store.state().contracts.find((row) => row.id === id)!;
  contract.quoteSeriesId = 'UNKNOWN-QS';
  contract.quoteVersionId = 'UNKNOWN-QV';
  const view = store.contractQuoteReference(id);
  assert.equal(view.status, 'review');
  assert.equal(view.displayNumber, 'UNKNOWN-QV');
  assert.match(view.message, /保留待核/);
  assert.match(view.message, /不按相似报价号或最新版本补造/);
  assert.throws(
    () =>
      store.saveContractQuoteReference(id, { seriesId: 'DEMO-Q-003', versionId: 'DEMO-QV-003-1' }),
    /最终锁定版本/,
  );
  const after = store.state().contracts.find((row) => row.id === id)!;
  assert.equal(after.quoteSeriesId, 'UNKNOWN-QS');
  assert.equal(after.quoteVersionId, 'UNKNOWN-QV');
});

test('非最终锁定版本、过期表单及存储失败都不改变已有引用', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const { series, version } = lockSeries(store, 'DEMO-Q-003');
  assert.equal(
    store.saveContractQuoteReference(id, { seriesId: series.id, versionId: version.id }),
    true,
  );
  const linked = structuredClone(store.state().contracts.find((row) => row.id === id)!);
  const live = () => {
    const current = store.state().quoteSeries!.find((row) => row.number === 'DEMO-Q-003')!;
    return { series: current, version: current.versions[0] };
  };
  live().version.status = '附条件通过';
  live().series.activeFinalVersionId = '';
  assert.throws(
    () =>
      store.saveContractQuoteReference(id, {
        seriesId: live().series.id,
        versionId: live().version.id,
      }),
    /最终锁定版本/,
  );
  assert.deepEqual(
    store.state().contracts.find((row) => row.id === id),
    linked,
  );
  live().version.status = '最终锁定';
  live().series.activeFinalVersionId = live().version.id;
  assert.throws(
    () =>
      store.saveContractQuoteReference(
        id,
        { seriesId: live().series.id, versionId: live().version.id },
        (store.state().dataVersion || 1) + 5,
      ),
    /版本已变化/,
  );
  store.updateContractDraft(id, { delivery: '' });
  const beforeQuota = structuredClone(store.state().contracts.find((row) => row.id === id)!);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem() {
        throw new Error('QuotaExceededError');
      },
    },
  });
  assert.throws(
    () =>
      store.saveContractQuoteReference(id, {
        seriesId: live().series.id,
        versionId: live().version.id,
      }),
    /Quota/,
  );
  const afterQuota = store.state().contracts.find((row) => row.id === id)!;
  assert.deepEqual(afterQuota, beforeQuota);
  assert.equal(afterQuota.quoteVersionId, linked.quoteVersionId);
  assert.equal(afterQuota.delivery, '');
});

test('草稿已预置同系列同版本但无快照时，重复选择仍补写显示号与保存人', () => {
  const { store } = harness();
  const { series, version } = lockSeries(store, 'DEMO-Q-002');
  const id = store.createContractDraft('DEMO-O014')!;
  const preset = store.state().contracts.find((row) => row.id === id)!;
  assert.equal(preset.quoteSeriesId, series.id);
  assert.equal(preset.quoteVersionId, version.id);
  assert.equal(preset.quoteReferenceSnapshot, undefined);
  assert.deepEqual(
    {
      savedBy: store.contractQuoteReference(id).savedBy,
      savedAt: store.contractQuoteReference(id).savedAt,
    },
    { savedBy: '', savedAt: '' },
  );
  assert.equal(
    store.saveContractQuoteReference(id, { seriesId: series.id, versionId: version.id }),
    true,
  );
  const saved = store.state().contracts.find((row) => row.id === id)!;
  assert.deepEqual(
    {
      seriesNumber: saved.quoteReferenceSnapshot?.seriesNumber,
      versionLabel: saved.quoteReferenceSnapshot?.versionLabel,
      savedBy: saved.quoteReferenceSnapshot?.savedBy,
    },
    { seriesNumber: 'DEMO-Q-002', versionLabel: 'V1', savedBy: '张销售' },
  );
  assert.ok(saved.quoteReferenceSnapshot?.savedAt);
  const events = store.state().operationEvents!.length;
  assert.equal(
    store.saveContractQuoteReference(id, { seriesId: series.id, versionId: version.id }),
    true,
  );
  const repeated = store.state().contracts.find((row) => row.id === id)!;
  assert.equal(repeated.quoteReferenceSnapshot?.savedAt, saved.quoteReferenceSnapshot?.savedAt);
  assert.equal(store.state().operationEvents!.length, events);
});

function quoteWorkspace(
  store: ReturnType<typeof harness>['store'],
  opportunityId: string,
  query: Record<string, string>,
) {
  const params = convertToParamMap({ id: opportunityId });
  const queryParams = convertToParamMap(query);
  const route = {
    paramMap: of(params),
    queryParamMap: of(queryParams),
    snapshot: { paramMap: params, queryParamMap: queryParams },
  } as unknown as ActivatedRoute;
  const injector = Injector.create({
    providers: [
      { provide: DemoStore, useValue: store },
      { provide: ActivatedRoute, useValue: route },
      // 报价工作区构造函数用 effect 同步草稿；裸 Injector 没有变更检测平台提供的调度器，
      // 这里补最小实现，本用例只读取 series/selectedId 这类纯计算信号，不依赖 effect 真正执行。
      { provide: ChangeDetectionScheduler, useValue: { notify: () => {} } },
      {
        provide: EffectScheduler,
        useValue: { add: () => {}, schedule: () => {}, flush: () => {}, remove: () => {} },
      },
    ],
  });
  return runInInjectionContext(injector, () => new QuoteWorkspace());
}

test('打开来源链接按 series/version 查询参数定位到所关联的系列与版本', () => {
  const { store } = harness();
  const first = store.state().quoteSeries!.find((row) => row.number === 'DEMO-Q-002')!;
  const second: QuoteSeries = {
    ...structuredClone(first),
    id: 'DEMO-Q-002-B',
    number: 'DEMO-Q-002-B',
    versions: [
      {
        ...structuredClone(first.versions[0]),
        id: 'DEMO-QV-002-B-1',
        seriesId: 'DEMO-Q-002-B',
        status: '最终锁定',
      },
    ],
  };
  second.activeFinalVersionId = 'DEMO-QV-002-B-1';
  store.state().quoteSeries!.push(second);

  const fallback = quoteWorkspace(store, 'DEMO-O014', {});
  assert.equal(fallback.series()?.id, first.id);

  const linked = quoteWorkspace(store, 'DEMO-O014', {
    series: 'DEMO-Q-002-B',
    version: 'DEMO-QV-002-B-1',
  });
  assert.equal(linked.series()?.id, 'DEMO-Q-002-B');
  assert.equal(linked.series()?.number, 'DEMO-Q-002-B');
  assert.equal(linked.selectedId(), 'DEMO-QV-002-B-1');
  assert.equal(linked.current()?.id, 'DEMO-QV-002-B-1');

  // 参数指向其它商机的系列（DEMO-Q-003 属于 DEMO-O003）时必须忽略，不回落到别的商机报价。
  const foreign = quoteWorkspace(store, 'DEMO-O014', {
    series: 'DEMO-Q-003',
    version: 'DEMO-QV-003-1',
  });
  assert.equal(foreign.series()?.id, first.id);
  assert.equal(store.quoteSeriesById('DEMO-Q-003')?.opportunityId, 'DEMO-O003');
  const unknown = quoteWorkspace(store, 'DEMO-O014', { series: 'DEMO-Q-999' });
  assert.equal(unknown.series()?.id, first.id);
});

test('系列指针失效或版本不属于保存的系列时保留待核，不按可解析版本补造来源', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const contract = store.state().contracts.find((row) => row.id === id)!;
  assert.equal(contract.quoteVersionId, undefined);

  // 版本能解析出来，但合同保存的系列指针不存在 → 待核。
  contract.quoteSeriesId = 'DEMO-Q-999';
  contract.quoteVersionId = 'DEMO-QV-001-1';
  const missingSeries = store.contractQuoteReference(id);
  assert.equal(missingSeries.status, 'review');
  assert.equal(missingSeries.lockedLabel, '待核');
  assert.equal(missingSeries.source, null);
  assert.match(missingSeries.message, /不属于合同保存的报价系列 DEMO-Q-999/);
  assert.match(missingSeries.message, /保留待核，不按相似报价号或最新版本补造/);

  // 版本能解析、系列也存在，但版本属于另一个系列 → 仍待核，不把它当成合同来源。
  contract.quoteSeriesId = 'DEMO-Q-003';
  contract.quoteVersionId = 'DEMO-QV-006-1';
  const foreignVersion = store.contractQuoteReference(id);
  assert.equal(store.quoteVersion('DEMO-QV-006-1')!.seriesId, 'DEMO-Q-006');
  assert.equal(foreignVersion.status, 'review');
  assert.equal(foreignVersion.lockedLabel, '待核');
  assert.equal(foreignVersion.seriesId, 'DEMO-Q-003');
  assert.equal(foreignVersion.source, null);
  assert.match(foreignVersion.message, /不属于合同保存的报价系列 DEMO-Q-003/);
});

test('来源商机取自报价系列本身，不用合同归属兜底', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const contract = store.state().contracts.find((row) => row.id === id)!;
  assert.equal(contract.opportunityId, 'DEMO-O003');
  contract.quoteSeriesId = 'DEMO-Q-006';
  contract.quoteVersionId = 'DEMO-QV-006-1';
  const view = store.contractQuoteReference(id);
  assert.equal(view.status, 'linked');
  assert.equal(view.source?.opportunityId, 'DEMO-O005');
  assert.equal(view.source?.opportunityName, '青山储能一期');
  assert.equal(contract.opportunityId, 'DEMO-O003');
  assert.equal(contract.customerId, 'DEMO-C003');
});
