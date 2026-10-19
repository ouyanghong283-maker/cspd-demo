import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormGroup } from '@angular/forms';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { Dialog } from '../src/app/shared/dialog';
import { DemoStore } from '../src/app/core/store';
import { DialogRequest, SolutionDocumentKind } from '../src/app/core/models';
import { INTERNAL_PEOPLE, personField } from '../src/app/core/personnel';
import { BusinessForms } from '../src/app/core/forms';
import { SolutionService } from '../src/app/features/solution-service';
import { QuoteWorkspace } from '../src/app/features/quote-workspace';
import { ProjectDetail } from '../src/app/features/project-detail';
import { harness } from './v4-harness';

function dialogFor(request: DialogRequest): Dialog {
  const dialog = Object.create(Dialog.prototype) as Dialog;
  Object.assign(dialog, { config: () => request, form: new FormGroup({}) });
  dialog.ngOnInit();
  return dialog;
}

test('人员选择拒绝名单外姓名，保留历史原值提示；必选和选填分别校验', () => {
  const fields = [
    personField('owner', '方案负责人', '旧姓名', true),
    personField('conditionOwner', '条件责任人'),
  ];
  assert.ok(!fields[0].options!.includes('旧姓名'));
  assert.match(fields[0].hint!, /旧姓名/);
  const dialog = dialogFor({ title: '选择人员', fields, onSave() {} });
  assert.equal(dialog.form.controls['owner'].value, '旧姓名');
  assert.equal(dialog.form.valid, false);
  dialog.form.controls['owner'].setValue('周方案');
  assert.equal(dialog.form.valid, true);
  dialog.form.controls['conditionOwner'].setValue('任意手输姓名');
  assert.equal(dialog.form.valid, false);
  dialog.form.controls['conditionOwner'].setValue('');
  dialog.form.controls['owner'].setValue('');
  assert.equal(dialog.form.valid, false);
  dialog.form.controls['owner'].setValue('王项目');
  assert.equal(dialog.form.valid, true);
});

test('从既有人员下拉维护四类方案与确认负责人，变更仍保留历史', () => {
  const { store } = harness();
  const id = 'DEMO-O014';
  let request!: DialogRequest;
  Object.assign(store.ui, { open: (value: DialogRequest) => (request = value) });
  const injector = Injector.create({
    providers: [
      { provide: DemoStore, useValue: store },
      { provide: Router, useValue: {} },
    ],
  });
  const service = runInInjectionContext(injector, () => new SolutionService());
  Object.assign(service, { opportunityId: () => id });
  store.saveProductNeed(id, { id: 'people-need', model: 'PCS-100', quantity: 1, unit: '台' });
  for (const kind of ['技术方案', 'TIC', '设计BOM', 'SLD'] as SolutionDocumentKind[]) {
    service.uploadSolutionDocument(kind);
    const field = request.fields.find((field) => field.key === 'owner')!;
    assert.equal(field.type, 'select');
    assert.deepEqual(field.options, INTERNAL_PEOPLE);
    assert.equal(request.onSave({ name: `${kind}.pdf`, owner: '周方案', note: '' }), true);
  }
  service.uploadSolutionDocument('TIC');
  request.onSave({ name: 'TIC-V2.pdf', owner: '王项目', note: '负责人变更' });
  assert.equal(store.solutionDocuments(id)!.owner, '王项目');
  assert.ok(
    store
      .solutionDocuments(id)!
      .ownerHistory.some((item) => item.from === '周方案' && item.to === '王项目'),
  );
  service.confirmCurrentSolution();
  assert.equal(request.fields[0].value, '王项目');
  assert.equal(request.fields[0].type, 'select');
  assert.equal(request.onSave({ owner: '王项目' }), true);
  assert.equal(store.solutionConfirmation(id)?.owner, '王项目');
  service.startFiveCan();
  const owners = request.fields.filter((field) => /owner$/i.test(field.key));
  assert.equal(owners.length, 10);
  for (const field of owners) {
    assert.equal(field.type, 'select');
    assert.equal(field.optionsOnly, true);
  }
  injector.destroy();
});

test('客户确认、接收和验收签认只能从当前关联客户联系人选择', () => {
  const { store } = harness();
  let request!: DialogRequest;
  Object.assign(store.ui, { open: (value: DialogRequest) => (request = value) });
  const sale = store.sale('DEMO-O014')!;
  const quote = store.quoteSeries(sale.id)!.versions[0];
  const names = store.customer(quote.customerId)!.contacts.map((contact) => contact.name);
  const other = store.state().customers.find((customer) => customer.id !== quote.customerId)!;
  other.contacts[0].name = '其他客户人员';
  const workspace = Object.create(QuoteWorkspace.prototype) as QuoteWorkspace;
  Object.assign(workspace, { store, sale: () => sale });
  workspace.customerResult(quote);
  assert.deepEqual(request.fields.find((field) => field.key === 'person')!.options, names);
  workspace.recordSent(quote);
  const receiver = request.fields.find((field) => field.key === 'recipient')!;
  assert.deepEqual(receiver.options, names);
  const dialog = dialogFor(request);
  dialog.form.controls['recipient'].setValue('其他客户人员');
  assert.ok(dialog.form.controls['recipient'].hasError('invalidSelection'));

  const project = store.state().projects[0];
  const detail = Object.create(ProjectDetail.prototype) as ProjectDetail;
  Object.assign(detail, { store, project: () => project, id: () => project.id });
  detail.check(project.acceptance[0]);
  assert.deepEqual(
    request.fields.find((field) => field.key === 'signer')!.options,
    store.customer(project.customerId)!.contacts.map((contact) => contact.name),
  );
});

test('沟通参与人从内部人员和关联客户联系人中多选，去重并保留多人与既有存储格式', () => {
  const { store } = harness();
  let request!: DialogRequest;
  const forms = Object.create(BusinessForms.prototype) as BusinessForms;
  Object.assign(forms, { store, ui: { open: (value: DialogRequest) => (request = value) } });
  const id = 'DEMO-O014';
  const contact = store.customer(store.sale(id)!.customerId)!.contacts[0].name;
  forms.activity(id);
  const people = request.fields.find((field) => field.key === 'people')!;
  assert.equal(people.multiple, true);
  assert.ok(people.options!.includes(contact));
  const dialog = dialogFor(request);
  dialog.form.patchValue(request.sample!);
  const target = { value: contact };
  const event = new Event('change');
  Object.defineProperty(event, 'target', { value: target });
  dialog.addPerson('people', event);
  target.value = contact;
  dialog.addPerson('people', event);
  assert.equal(dialog.form.controls['people'].value, `张销售、${contact}`);
  assert.equal(dialog.form.valid, true);
  assert.equal(request.onSave(dialog.form.getRawValue()), true);
  assert.equal(store.state().activities.at(-1)!.people, `张销售、${contact}`);
  dialog.form.controls['people'].setValue(`张销售、${contact}、不存在的人`);
  assert.equal(dialog.form.valid, false);
  dialog.removePerson('people', '不存在的人');
  assert.equal(dialog.form.valid, true);
});
