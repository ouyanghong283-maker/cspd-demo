import '@angular/compiler';
import { computed, signal } from '@angular/core';
import { DemoStore } from '../src/app/core/store';
import { createSeed } from '../src/app/core/seed';
import { Role } from '../src/app/core/models';
import { observationDateForMode } from '../src/app/core/rules';
export function harness() {
  const store = Object.create(DemoStore.prototype) as DemoStore;
  let role: Role = 'sales';
  const state = signal(createSeed());
  const dateMode = computed(() => state().dateMode || 'normal');
  Object.assign(store, {
    state,
    dateMode,
    observationDate: computed(() => observationDateForMode(dateMode())),
    role: () => role,
    person: () =>
      ({ solution: '周方案', finance: '黄财务', receiver: '吴运维', pm: '王项目' })[role] ||
      '张销售',
    salesEditable: () => ['sales', 'assistant', 'manager'].includes(role),
    internal: () => role !== 'outsider',
    ui: {
      notify() {},
      fail(message: string) {
        throw new Error(message);
      },
    },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      setItem() {},
      getItem() {
        return null;
      },
    },
  });
  return {
    store,
    role: (r: Role) => {
      role = r;
    },
  };
}
export function prepare(store: DemoStore, setRole: (r: Role) => void, id: string) {
  setRole('solution');
  store.uploadSolution(id, '方案.pdf', '周方案');
  setRole('sales');
  store.saveServiceTerms({ ...store.terms(id), years: 2, scope: '设备质量', sla: '24小时响应' });
  store.confirmServiceTerms(id, store.terms(id).revision);
  store.saveAgreement({
    ...store.agreement(id),
    applicability: '不购买',
    reason: '客户暂不购买运维服务',
  });
  store.confirmAgreement(id, store.agreement(id).revision);
}
/** 已完成报价侧流程的隔离样例；签约测试通过正式来源选择入口绑定。 */
export function prepareSigningQuote(store: DemoStore, contractId: string): void {
  const contract = store.contract(contractId)!;
  const source = structuredClone(store.quoteVersion('DEMO-QV-006-1')!);
  const seriesId = `SIGN-FIXTURE-${contractId}`;
  source.id = `${seriesId}-V1`;
  source.seriesId = seriesId;
  source.customerId = contract.customerId;
  source.status = '最终锁定';
  store
    .state()
    .quoteSeries!.push({
      id: seriesId,
      number: seriesId,
      opportunityId: contract.opportunityId,
      activeFinalVersionId: source.id,
      versions: [source],
      createdBy: '隔离样例',
      createdDate: '2026-10-10',
    });
  store.saveContractQuoteReference(contractId, { seriesId, versionId: source.id });
}
