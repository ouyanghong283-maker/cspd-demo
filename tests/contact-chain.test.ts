import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormGroup } from '@angular/forms';
import { BusinessForms } from '../src/app/core/forms';
import { DialogRequest } from '../src/app/core/models';
import { CUSTOMER_COUNTRIES } from '../src/app/core/customer-dictionaries';
import { Dialog } from '../src/app/shared/dialog';
import { harness } from './v4-harness';
import { blankSales } from '../src/app/core/seed';

function dialogFor(request: DialogRequest): Dialog {
  const dialog = Object.create(Dialog.prototype) as Dialog;
  Object.assign(dialog, { config: () => request, form: new FormGroup({}) });
  dialog.ngOnInit();
  return dialog;
}

for (const legacyGap of ['owner', 'status', 'industry', 'contact'] as const) {
  test(`已有客户历史资料缺失${legacyGap}时，填入演示内容可保存线索且不改写旧资料`, () => {
    const { store } = harness();
    const customer = store.state().customers[0];
    if (legacyGap === 'contact') {
      customer.contacts[0].email = '';
      customer.contacts[0].phone = '';
    } else Object.assign(customer, { [legacyGap]: '' });
    const original = structuredClone(customer);
    let request!: DialogRequest;
    const forms = Object.create(BusinessForms.prototype) as BusinessForms;
    Object.assign(forms, {
      store, router: { navigate() {} },
      ui: { open: (value: DialogRequest) => { request = value; }, fail: store.ui.fail },
    });
    forms.newLead();
    const dialog = dialogFor(request);
    dialog.fill();
    assert.equal(request.onSave(dialog.form.getRawValue()), true);
    const saved = store.customer(customer.id)!;
    assert.deepEqual({ ...saved, contacts: original.contacts }, original);
    assert.deepEqual(saved.contacts.slice(0, original.contacts.length), original.contacts);
    const lead = store.state().sales.at(-1)!;
    assert.equal(lead.customerCountrySnapshot, '中国');
    assert.equal(lead.customerId, customer.id);
    assert.equal(saved.contacts.find((contact) => contact.id === lead.contactId)!.email, 'demo@example.com');
  });
}

test('联合保存仍拒绝新客户缺必填值、已改坏的客户字段和新增或改坏的联系人', () => {
  const { store } = harness();
  const original = structuredClone(store.state().customers[0]);
  const lead = blankSales('VALIDATE-NEW-LEAD', original.id);
  lead.crmSource = '自有开发';
  const before = structuredClone(store.state());
  for (const field of ['owner', 'status', 'industry'] as const) {
    const changed = structuredClone(original);
    Object.assign(changed, { [field]: '' });
    assert.throws(() => store.saveSales(lead, changed));
    changed.id = 'NEW-CUSTOMER';
    assert.throws(() => store.saveSales({ ...lead, customerId: changed.id }, changed));
  }
  const added = structuredClone(original);
  added.contacts.push({ ...added.contacts[0], id: 'INVALID-CONTACT', email: '', phone: '' });
  assert.throws(() => store.saveSales(lead, added));
  const changed = structuredClone(original);
  changed.contacts[0].email = '';
  changed.contacts[0].phone = '';
  assert.throws(() => store.saveSales(lead, changed));
  assert.deepEqual(store.state(), before);
});

test('客户国家下拉包含中国和新加坡，且可保存并在转商机时自动带入', () => {
  assert.ok(CUSTOMER_COUNTRIES.includes('中国'));
  assert.ok(CUSTOMER_COUNTRIES.includes('新加坡'));
  const { store } = harness();
  const lead = store.sale('DEMO-L001')!;
  const customer = store.customer(lead.customerId)!;
  customer.country = '中国';
  assert.equal(store.saveCustomer(customer), true);
  store.state().attachments.push({
    ...store.state().attachments[0],
    id: 'country-chain-requirement',
    entityId: lead.id,
    kind: '需求导入表',
  });
  const opportunityId = store.convert(lead.id)!;
  const opportunity = store.sale(opportunityId)!;
  assert.equal(opportunity.customerId, customer.id);
  assert.equal(opportunity.customerCountrySnapshot, '中国');
  assert.equal(opportunity.customerProfileAtConversion?.country, '中国');
});

test('线索草稿在客户页补齐首个联系人后，可以转换并保留同一联系人ID', () => {
  const { store } = harness();
  const lead = store.sale('DEMO-L001')!;
  const customer = store.customer(lead.customerId)!;
  customer.contacts = [];
  lead.contactId = '';
  store.state().attachments.push({
    ...store.state().attachments[0],
    id: 'contact-chain-requirement',
    entityId: lead.id,
    kind: '需求导入表',
  });
  let dialog!: DialogRequest;
  const forms = Object.create(BusinessForms.prototype) as BusinessForms;
  Object.assign(forms, {
    store,
    ui: {
      open: (request: DialogRequest) => {
        dialog = request;
      },
    },
  });
  forms.addContact(customer);
  assert.equal(
    dialog.onSave({
      name: '新联系人',
      phone: '13900001234',
      email: '',
      title: '',
      department: '',
      position: '',
      purchasingRole: '',
    }),
    true,
  );
  const contact = store.customer(customer.id)!.contacts[0];
  assert.equal(store.saveSales({ ...lead, contactId: contact.id }), true);
  assert.equal(store.sale(lead.id)!.contactId, contact.id, '已填写联系人却没有关联到线索');
  const opportunityId = store.convert(lead.id)!;
  assert.ok(opportunityId);
  assert.equal(store.sale(opportunityId)!.contactId, contact.id);
  assert.equal(store.sale(opportunityId)!.customerId, customer.id);
  assert.equal(store.convert(lead.id), opportunityId);
});

test('旧草稿有唯一联系人时转换修复关联；多联系人与跨客户联系人不能猜测', () => {
  const { store } = harness();
  const lead = store.sale('DEMO-L001')!;
  const customer = store.customer(lead.customerId)!;
  customer.contacts = [customer.contacts[0]];
  lead.contactId = '';
  store.state().attachments.push({
    ...store.state().attachments[0],
    id: 'legacy-requirement',
    entityId: lead.id,
    kind: '需求导入表',
  });
  const opportunityId = store.convert(lead.id)!;
  assert.equal(store.sale(opportunityId)!.contactId, customer.contacts[0].id);
  assert.equal(store.sale(lead.id)!.contactId, customer.contacts[0].id);

  const second = harness().store;
  const ambiguous = second.sale('DEMO-L001')!;
  const ambiguousCustomer = second.customer(ambiguous.customerId)!;
  ambiguous.contactId = '';
  ambiguousCustomer.contacts.push({ ...ambiguousCustomer.contacts[0], id: 'another-contact' });
  assert.equal(second.contact(ambiguous), undefined);
  assert.throws(() => second.convert(ambiguous.id), /主要联系人/);
  const foreignContact = second.state().customers.find((item) => item.id !== ambiguous.customerId)!
    .contacts[0];
  assert.throws(
    () => second.saveSales({ ...ambiguous, contactId: foreignContact.id }),
    /不属于当前客户/,
  );
});

test('编辑同名客户与同名联系人不会改变稳定ID', () => {
  const { store } = harness();
  const lead = store.sale('DEMO-L001')!;
  const customer = store.customer(lead.customerId)!;
  const other = store.state().customers.find((item) => item.id !== customer.id)!;
  other.name = customer.name;
  customer.contacts.push({
    ...customer.contacts[0],
    id: 'same-name-contact',
    email: 'second@example.com',
  });
  lead.contactId = 'same-name-contact';
  let dialog!: DialogRequest;
  const forms = Object.create(BusinessForms.prototype) as BusinessForms;
  Object.assign(forms, {
    store,
    ui: {
      open: (request: DialogRequest) => {
        dialog = request;
      },
      fail: store.ui.fail,
    },
  });
  forms.editSales(lead);
  const values = Object.fromEntries(
    dialog.fields.map((field) => [field.key, String(field.value ?? '')]),
  );
  assert.equal(values['customer'], customer.id);
  assert.equal(values['contact'], 'same-name-contact');
  assert.equal(dialog.onSave(values), true);
  assert.equal(store.sale(lead.id)!.customerId, customer.id);
  assert.equal(store.sale(lead.id)!.contactId, 'same-name-contact');
});

test('新建线索失败不留下客户或联系人半条记录，成功保存的客户不受调用方修改影响', () => {
  const { store } = harness();
  let dialog!: DialogRequest;
  const forms = Object.create(BusinessForms.prototype) as BusinessForms;
  Object.assign(forms, {
    store,
    router: { navigate() {} },
    ui: {
      open: (request: DialogRequest) => {
        dialog = request;
      },
      fail: store.ui.fail,
    },
  });
  const customer = store.state().customers[0];
  const before = structuredClone(store.state());
  forms.newLead();
  const input = {
    customer: customer.name,
    country: customer.country,
    project: '原子保存验证',
    existingCustomerId: customer.id,
    contact: '新增联系人',
    email: 'new@example.com',
    source: '自有开发',
    description: '需求',
  };
  localStorage.setItem = () => {
    throw new Error('存储容量不足');
  };
  assert.throws(() => dialog.onSave(input), /存储容量不足/);
  assert.deepEqual(store.state(), before);
  localStorage.setItem = () => {};
  assert.equal(dialog.onSave(input), true);
  const created = store.state().sales.at(-1)!;
  assert.equal(store.contact(created)?.email, 'new@example.com');
  const edited = structuredClone(store.customer(customer.id)!);
  assert.equal(store.saveCustomer(edited), true);
  edited.contacts[0].name = '保存后外部篡改';
  assert.notEqual(store.customer(customer.id)!.contacts[0].name, edited.contacts[0].name);
});

test('已有报价的商机不能静默切换客户并留下旧客户报价', () => {
  const { store } = harness();
  const opportunity = store.sale('DEMO-O014')!;
  const other = store.state().customers.find((item) => item.id !== opportunity.customerId)!;
  const before = structuredClone(store.state());
  assert.throws(
    () =>
      store.saveSales({ ...opportunity, customerId: other.id, contactId: other.contacts[0].id }),
    /已有报价/,
  );
  assert.deepEqual(store.state(), before);
});

test('报价保存和正式门禁拒绝客户、联系人错配', () => {
  const { store } = harness();
  const opportunity = store.sale('DEMO-O014')!;
  const quote = store.quoteSeries(opportunity.id)!.versions[0];
  const other = store.state().customers.find((item) => item.id !== opportunity.customerId)!;
  assert.throws(
    () =>
      store.saveQuote({
        ...quote,
        status: '草稿',
        customerId: other.id,
        contactId: other.contacts[0].id,
      }),
    /报价客户与来源商机不一致/,
  );
  quote.customerId = other.id;
  quote.contactId = other.contacts[0].id;
  assert.ok(store.quoteGate(opportunity.id, quote.id).some((item) => item.code === 'association'));
  quote.customerId = opportunity.customerId;
  assert.ok(store.quoteGate(opportunity.id, quote.id).some((item) => item.code === 'association'));
});

test('新建线索国家选择“跟随关联”时自动匹配关联客户，新建独立客户则拒绝', () => {
  const { store } = harness();
  let dialog!: DialogRequest;
  const forms = Object.create(BusinessForms.prototype) as BusinessForms;
  Object.assign(forms, {
    store,
    router: { navigate() {} },
    ui: {
      open: (request: DialogRequest) => {
        dialog = request;
      },
      fail: store.ui.fail,
    },
  });
  forms.newLead();
  const countryField = dialog.fields.find((field) => field.key === 'country')!;
  const optionValues = countryField.options!.map((option) =>
    typeof option === 'string' ? option : option.value,
  );
  assert.ok(optionValues.includes('__follow_linked_country__'));
  assert.equal(countryField.value, '__follow_linked_country__');

  const base = {
    project: '跟随关联验证',
    contact: '',
    email: '',
    owner: '',
    source: '自有开发',
    description: '',
  };
  for (const customer of store.state().customers) {
    assert.equal(
      dialog.onSave({
        ...base,
        customer: customer.name,
        existingCustomerId: customer.id,
        country: '__follow_linked_country__',
      }),
      true,
      `跟随关联已有客户 ${customer.id} 应保存成功`,
    );
    const created = store.state().sales.at(-1)!;
    assert.equal(created.customerId, customer.id);
    assert.equal(created.customerCountrySnapshot, customer.country);
    assert.equal(store.customer(customer.id)!.country, customer.country);
  }

  const before = structuredClone(store.state());
  assert.throws(
    () =>
      dialog.onSave({
        ...base,
        customer: '全新客户有限公司',
        existingCustomerId: '__new__',
        country: '__follow_linked_country__',
      }),
    /新建独立客户请选择具体国家/,
  );
  assert.deepEqual(store.state(), before);
});

test('客户国家仅在新建独立客户时开放，关联已有客户时锁定为跟随关联且门禁不阻碍', () => {
  const { store } = harness();
  let request!: DialogRequest;
  const forms = Object.create(BusinessForms.prototype) as BusinessForms;
  Object.assign(forms, {
    store,
    router: { navigate() {} },
    ui: {
      open: (value: DialogRequest) => (request = value),
      fail: store.ui.fail,
    },
  });
  forms.newLead();
  const countryField = request.fields.find((field) => field.key === 'country')!;
  assert.deepEqual(countryField.enabledWhen, { field: 'existingCustomerId', equals: '__new__' });
  assert.equal(countryField.disabledValue, '__follow_linked_country__');

  const dialog = dialogFor(request);
  const country = dialog.form.controls['country'];
  const association = dialog.form.controls['existingCustomerId'];
  assert.equal(country.disabled, true, '未选择客户关联时国家应锁定');
  assert.equal(country.value, '__follow_linked_country__');

  const customer = store.state().customers[0];
  association.setValue(customer.id);
  dialog.fieldChanged('existingCustomerId');
  assert.equal(country.disabled, true, '关联已有客户时国家应锁定');
  assert.equal(country.value, '__follow_linked_country__');

  association.setValue('__new__');
  dialog.fieldChanged('existingCustomerId');
  assert.equal(country.enabled, true, '新建独立客户时国家应开放');
  country.setValue('中国');

  association.setValue(customer.id);
  dialog.fieldChanged('existingCustomerId');
  assert.equal(country.disabled, true, '改回已有客户时国家应重新锁定');
  assert.equal(country.value, '__follow_linked_country__', '锁定后应回到跟随关联');

  const raw = dialog.form.getRawValue();
  assert.equal(raw['country'], '__follow_linked_country__', '锁定值应随表单提交');
  assert.equal(
    request.onSave({
      ...raw,
      customer: customer.name,
      project: '锁定跟随保存验证',
      contact: '',
      email: '',
      owner: '',
      source: '自有开发',
      description: '',
    }),
    true,
    '关联已有客户时门禁不应阻碍保存',
  );
  assert.equal(store.state().sales.at(-1)!.customerCountrySnapshot, customer.country);

  const renamed = harness();
  renamed.store.state().customers.find((item) => item.name === '演示能源科技')!.name =
    '已改名能源公司';
  let renamedRequest!: DialogRequest;
  const renamedForms = Object.create(BusinessForms.prototype) as BusinessForms;
  Object.assign(renamedForms, {
    store: renamed.store,
    router: { navigate() {} },
    ui: { open: (value: DialogRequest) => (renamedRequest = value), fail: renamed.store.ui.fail },
  });
  renamedForms.newLead();
  const renamedDialog = dialogFor(renamedRequest);
  renamedDialog.fill();
  assert.equal(renamedDialog.form.controls['country'].enabled, true, '演示新建独立客户时国家应开放');
  assert.equal(renamedDialog.form.controls['country'].value, '中国');
});

test('演示客户被改名后，填入演示内容仍能新建独立客户及线索', () => {
  const { store } = harness();
  store.state().customers.find((customer) => customer.name === '演示能源科技')!.name = '已改名能源公司';
  let dialog!: DialogRequest;
  const forms = Object.create(BusinessForms.prototype) as BusinessForms;
  Object.assign(forms, {
    store,
    router: { navigate() {} },
    ui: { open: (request: DialogRequest) => { dialog = request; }, fail: store.ui.fail },
  });
  forms.newLead();
  const before = structuredClone(store.state());
  assert.equal(dialog.sample!.existingCustomerId, '__new__');
  assert.equal(dialog.onSave(dialog.sample!), true);
  assert.equal(store.state().customers.length, before.customers.length + 1);
  assert.equal(store.state().sales.length, before.sales.length + 1);
  assert.equal(store.state().customers.at(-1)!.country, '中国');
  assert.equal(store.state().sales.at(-1)!.customerCountrySnapshot, '中国');
});
