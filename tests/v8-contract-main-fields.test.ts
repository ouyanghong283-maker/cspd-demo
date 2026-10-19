import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './v4-harness';

test('合同主字段保存原值和客户采用值，客户主档及审批事实保持独立', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const customer = structuredClone(store.state().customers);
  assert.equal(
    store.saveContractMainFields(id, {
      expectedDataVersion: store.state().dataVersion || 1,
      title: '框架合同',
      crmFields: {
        alp_contracttype: 10,
        alp_contractcode: 'LOCAL-01',
        alp_customermail: 'adopted@example.com',
        alp_bdmanager: { id: 'user-1', name: '经办人', entityType: 'systemuser' },
      },
    }),
    true,
  );
  const contract = store.state().contracts.find((x) => x.id === id)!;
  assert.equal(contract.crmFields?.alp_contracttype, 10);
  assert.equal(contract.crmFields?.alp_approvaldate, undefined);
  assert.equal(contract.crmFields?.alp_name, undefined);
  assert.deepEqual(store.state().customers, customer);
});

test('过期编辑表单在 Store 已收到更新时拒绝覆盖；无变化不生成进度', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const version = store.state().dataVersion || 1;
  store.saveContractMainFields(id, {
    expectedDataVersion: version,
    title: '新名称',
    crmFields: { alp_contracttype: 30 },
  });
  const before = structuredClone(store.state());
  assert.throws(
    () =>
      store.saveContractMainFields(id, {
        expectedDataVersion: version,
        title: '旧表单',
        crmFields: {},
      }),
    /版本已变化/,
  );
  assert.deepEqual(store.state(), before);
  assert.equal(
    store.saveContractMainFields(id, {
      expectedDataVersion: before.dataVersion!,
      title: '新名称',
      crmFields: {},
    }),
    true,
  );
  assert.deepEqual(store.state(), before);
});

test('旧快照缺少主字段时支持两种合同；未知来源原值可以保留且不猜测', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const record = () => store.state().contracts.find((x) => x.id === id)!;
  delete record().crmFields;
  for (const type of [10, 30]) {
    assert.equal(
      store.saveContractMainFields(id, {
        expectedDataVersion: store.state().dataVersion || 1,
        crmFields: {
          alp_contracttype: type,
          alp_homeregion: { id: 'region-1', name: '来源大区', entityType: 'businessunit' },
        },
      }),
      true,
    );
    assert.equal(record().crmFields?.alp_contracttype, type);
  }
  record().crmFields!.alp_contractsource_type = 987654;
  assert.equal(
    store.saveContractMainFields(id, {
      expectedDataVersion: store.state().dataVersion!,
      title: '保留未知值',
      crmFields: {},
    }),
    true,
  );
  assert.equal(record().crmFields?.alp_contractsource_type, 987654);
  assert.equal(record().crmFields?.alp_remainday, undefined);
});

test('资格丢失、存储旧修订及容量失败不发布合同、历史或进展', () => {
  for (const failure of ['lease', 'revision', 'quota']) {
    const { store } = harness();
    const id = store.createContractDraft('DEMO-O003')!;
    const before = structuredClone(store.state());
    Object.assign(store, { editingWritable: { set() {} } });
    if (failure === 'lease') Object.assign(store, { editingLease: { owns: () => false } });
    if (failure === 'revision')
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
          getItem: () => JSON.stringify({ ...before, dataVersion: (before.dataVersion || 1) + 1 }),
          setItem() {
            throw Error('不应写入');
          },
        },
      });
    if (failure === 'quota')
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
          getItem: () => null,
          setItem() {
            throw Error('QuotaExceededError');
          },
        },
      });
    assert.throws(
      () =>
        store.saveContractMainFields(id, {
          expectedDataVersion: before.dataVersion!,
          title: '不应保存',
          crmFields: { alp_contracttype: 20 },
        }),
      /修改权|版本已变化|Quota/,
    );
    assert.deepEqual(store.state(), before);
  }
});

test('专用主字段入口不能伪造审批日期、源编号、客户归属或支付采用', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  for (const key of [
    'alp_name',
    'alp_approvaldate',
    'alp_customername',
    'alp_paymenttermsid',
    'alp_signaturedate',
    'alp_quotation_id',
    'ownerid',
    'alp_remainday',
  ]) {
    const before = structuredClone(store.state());
    assert.throws(
      () =>
        store.saveContractMainFields(id, {
          expectedDataVersion: before.dataVersion!,
          crmFields: { [key]: '伪造' },
        }),
      /专属业务动作/,
    );
    assert.deepEqual(store.state(), before);
  }
});

test('客户名称采用值独立保存；非法日期和不完整关联给出业务提示', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const customers = structuredClone(store.state().customers);
  assert.equal(
    store.saveContractMainFields(id, {
      expectedDataVersion: store.state().dataVersion!,
      customerAdoptedName: '合同客户抬头',
      crmFields: {},
    }),
    true,
  );
  assert.equal(
    store.state().contracts.find((x) => x.id === id)?.customerAdoptedName,
    '合同客户抬头',
  );
  assert.deepEqual(store.state().customers, customers);
  for (const crmFields of [
    { alp_startdate: '2026-99-99' },
    { alp_bdmanager: { id: 12, name: null, entityType: 'systemuser' } },
  ]) {
    const before = structuredClone(store.state());
    assert.throws(
      () =>
        store.saveContractMainFields(id, {
          expectedDataVersion: before.dataVersion!,
          crmFields,
        } as any),
      /需要合法日期|需要目标类型/,
    );
    assert.deepEqual(store.state(), before);
  }
});

test('主字段隔离调用者关联对象，显式清空客户名称且生产失败返回false', () => {
  const { store } = harness();
  const id = store.createContractDraft('DEMO-O003')!;
  const lookup = { id: 'user-1', name: '原经办人', entityType: 'systemuser' };
  assert.equal(
    store.saveContractMainFields(id, {
      expectedDataVersion: store.state().dataVersion!,
      customerAdoptedName: '临时抬头',
      crmFields: { alp_bdmanager: lookup },
    }),
    true,
  );
  lookup.name = '外部更改';
  assert.equal(
    (store.state().contracts.find((x) => x.id === id)!.crmFields!.alp_bdmanager as { name: string })
      .name,
    '原经办人',
  );
  assert.equal(
    store.saveContractMainFields(id, {
      expectedDataVersion: store.state().dataVersion!,
      customerAdoptedName: '',
      crmFields: {},
    }),
    true,
  );
  assert.equal(store.state().contracts.find((x) => x.id === id)!.customerAdoptedName, '');
  store.ui.fail = () => false;
  const before = structuredClone(store.state());
  assert.equal(
    store.saveContractMainFields(id, {
      expectedDataVersion: before.dataVersion! - 1,
      crmFields: {},
    }),
    false,
  );
  assert.deepEqual(store.state(), before);
});
