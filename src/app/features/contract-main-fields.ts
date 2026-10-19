import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CONTRACT_MAIN_FIELDS,
  ContractLookup,
  ContractMainField,
  ContractMainValue,
} from '../core/contract-main-fields';
import { Contract } from '../core/models';
import { DemoStore } from '../core/store';

@Component({
  selector: 'app-contract-main-fields',
  imports: [FormsModule],
  template: `
    <section class="main-fields" aria-label="合同主字段">
      <div class="head">
        <div>
          <h3>合同详细信息</h3>
          <p>按业务分组查看合同、客户及履约信息。</p>
        </div>
        @if (contract().status === '草稿' && !editing()) {
          <button class="btn" (click)="begin()">维护合同主字段</button>
        }
      </div>
      @if (editing()) {
        <label
          >合同名称（V7原有要求）<input aria-label="主字段合同名称" [(ngModel)]="title"
        /></label>
        <label
          >合同客户采用名称<input
            aria-label="合同客户采用名称"
            [(ngModel)]="customerAdoptedName"
            placeholder="留空时引用客户主档名称"
        /></label>
      }
      <nav aria-label="合同主字段部门">
        @for (department of departments; track department) {
          <button
            class="btn"
            [class.primary]="department === selectedDepartment()"
            [attr.aria-pressed]="department === selectedDepartment()"
            (click)="selectedDepartment.set(department)"
          >
            {{ department }}
          </button>
        }
      </nav>
      <nav class="group-nav" aria-label="合同信息分组">
        @for (group of groups(); track group) {
          <button
            type="button"
            [class.active]="activeGroup() === group"
            [attr.aria-pressed]="activeGroup() === group"
            (click)="selectedGroup.set(group)"
          >
            {{ group }}
          </button>
        }
      </nav>
      @for (group of groups(); track group) {
        <div [hidden]="activeGroup() !== group" class="field-group">
          <h4>{{ group }}</h4>
          <div class="fields">
            @for (field of groupFields(group); track field.key) {
              <article>
                <label [for]="'contract-main-' + field.key">{{ field.label }}</label>
                @if (editing() && field.editable && field.key !== 'alp_contractname') {
                  @if (field.options.length) {
                    <select
                      [id]="'contract-main-' + field.key"
                      [ngModel]="draft[field.key] ?? null"
                      (ngModelChange)="draft[field.key] = $event"
                    >
                      <option [ngValue]="null">未提供</option>
                      @if (unknownOption(field)) {
                        <option [ngValue]="draft[field.key]">
                          未知来源原值 {{ draft[field.key] }}（保留待核）
                        </option>
                      }
                      @for (option of field.options; track option.value) {
                        <option [ngValue]="option.value">
                          {{ option.label }}（{{ option.value }}）
                        </option>
                      }
                    </select>
                  } @else if (field.type === 'lookup') {
                    <input
                      [id]="'contract-main-' + field.key"
                      [attr.aria-label]="field.label + '记录ID'"
                      placeholder="关联记录ID；空值表示未关联"
                      [ngModel]="lookup(field.key).id"
                      (ngModelChange)="setLookup(field, 'id', $event)"
                    />
                    <input
                      [attr.aria-label]="field.label + '名称'"
                      placeholder="来源显示名称"
                      [ngModel]="lookup(field.key).name"
                      (ngModelChange)="setLookup(field, 'name', $event)"
                    />
                    <select
                      [attr.aria-label]="field.label + '目标实体'"
                      [ngModel]="lookup(field.key).entityType || field.targets[0]"
                      (ngModelChange)="setLookup(field, 'entityType', $event)"
                    >
                      @for (target of field.targets; track target) {
                        <option [value]="target">{{ target }}</option>
                      }
                    </select>
                  } @else {
                    <input
                      [id]="'contract-main-' + field.key"
                      [type]="
                        field.type === 'datetime'
                          ? 'date'
                          : field.type === 'double'
                            ? 'number'
                            : 'text'
                      "
                      [ngModel]="draft[field.key] ?? ''"
                      (ngModelChange)="draft[field.key] = $event"
                    />
                  }
                } @else {
                  <strong>{{ display(field) }}</strong>
                }
                @if (showSource()) {
                  <small
                    >{{ field.key }} · {{ field.type }} ·
                    {{ field.editable ? '可维护' : '只读' }}</small
                  >
                  <small>{{ field.rule }}</small>
                }
              </article>
            }
          </div>
        </div>
      }
      @if (editing()) {
        <div class="actions">
          <button class="btn primary" (click)="save()">保存合同主字段</button
          ><button class="btn" (click)="cancel()">取消</button>
        </div>
      }
      <details class="source-details">
        <summary>字段来源与维护说明</summary>
        <p>
          合同采用值独立保存，客户主档不随合同修改。标准CRM仅作为只读参考；未核实的子字段不额外强制必填。保存资料不代表完成审批或签约。
        </p>
        <label class="source-toggle"
          ><input
            type="checkbox"
            [ngModel]="showSource()"
            (ngModelChange)="showSource.set($event)"
          />显示字段来源说明</label
        >
      </details>
      <details class="history-details">
        <summary>
          合同操作时间线 <span>{{ timeline().length }} 条记录</span>
        </summary>
        @for (event of timeline(); track event.id) {
          <p>
            <small
              >{{ event.occurredAt }} · {{ event.operator }} · {{ event.action }} · 数据修订
              {{ event.dataVersion }}</small
            >
          </p>
        } @empty {
          <p><small>尚无可追溯的本地操作；不补造历史。</small></p>
        }
      </details>
    </section>
  `,
  styleUrl: './contract-main-fields.scss',
})
export class ContractMainFields {
  private editingContractId = '';
  private originalDraft = '';
  constructor() {
    effect(() => {
      if (this.editing() && this.editingContractId !== this.contract().id) {
        this.editing.set(false);
        this.store.setPendingInlineEdit(false);
        this.store.ui.notify('已切换合同，原合同未保存的表单已取消，请重新打开', true);
      }
    });
  }
  private dirty() {
    return (
      this.editing() &&
      this.originalDraft !== JSON.stringify([this.title, this.customerAdoptedName, this.draft])
    );
  }
  cancel() {
    if (!this.dirty() || window.confirm('有未保存修改，确定放弃并关闭吗？')) {
      this.editing.set(false);
      this.store.setPendingInlineEdit(false);
    }
  }
  ngOnDestroy() {
    if (this.editing()) this.store.setPendingInlineEdit(false);
  }
  readonly store = inject(DemoStore);
  readonly contract = input.required<Contract>();
  readonly editing = signal(false);
  readonly showSource = signal(false);
  readonly selectedGroup = signal('合同信息');
  readonly activeGroup = computed(() =>
    this.groups().includes(this.selectedGroup()) ? this.selectedGroup() : this.groups()[0],
  );
  readonly departments = ['销售', '财务'];
  readonly selectedDepartment = signal('销售');
  readonly timeline = computed(() =>
    (this.store.state().operationEvents || [])
      .filter((event) => event.objectType === 'contract' && event.objectId === this.contract().id)
      .slice()
      .reverse(),
  );
  readonly groups = computed(() => [
    ...new Set(
      CONTRACT_MAIN_FIELDS.filter((f) => f.department === this.selectedDepartment()).map(
        (f) => f.group,
      ),
    ),
  ]);
  draft: Record<string, ContractMainValue> = {};
  title = '';
  customerAdoptedName = '';
  private expectedDataVersion = 0;
  groupFields(group: string) {
    return CONTRACT_MAIN_FIELDS.filter(
      (f) => f.department === this.selectedDepartment() && f.group === group,
    );
  }
  begin() {
    this.editingContractId = this.contract().id;
    this.expectedDataVersion = this.store.state().dataVersion || 1;
    this.title = this.contract().title || '';
    this.customerAdoptedName = this.contract().customerAdoptedName || '';
    this.draft = Object.fromEntries(
      CONTRACT_MAIN_FIELDS.filter((f) => f.editable && f.key !== 'alp_contractname').map((f) => [
        f.key,
        structuredClone(this.contract().crmFields?.[f.key] ?? null),
      ]),
    );
    this.originalDraft = JSON.stringify([this.title, this.customerAdoptedName, this.draft]);
    this.editing.set(true);
    this.store.setPendingInlineEdit(true);
  }
  lookup(key: string): ContractLookup {
    const value = this.draft[key];
    return typeof value === 'object' && value !== null
      ? value
      : { id: '', name: '', entityType: '' };
  }
  setLookup(field: ContractMainField, key: keyof ContractLookup, value: string) {
    const next = {
      ...this.lookup(field.key),
      entityType: this.lookup(field.key).entityType || field.targets[0],
      [key]: value,
    };
    this.draft[field.key] = !next.id && !next.name ? null : next;
  }
  unknownOption(field: ContractMainField) {
    const value = this.draft[field.key];
    return value !== null && value !== undefined && !field.options.some((o) => o.value === value);
  }
  display(field: ContractMainField): string {
    const contract = this.contract();
    const linked: Record<string, string | undefined> = {
      alp_name: String(contract.crmFields?.['alp_name'] || contract.id),
      alp_contractname: contract.title,
      alp_customername:
        contract.customerAdoptedName ||
        this.store.customer(contract.customerId)?.name ||
        '尚未选择客户',
      alp_opportunitycode: contract.opportunityId,
      alp_quotation_id: contract.quoteVersionId,
      alp_paymenttermsid: contract.paymentTermId || contract.payment,
      ownerid: this.store.sale(contract.opportunityId)?.owner || contract.createdBy,
      alp_status:
        contract.crmFields?.['alp_status'] == null ? contract.status || '历史登记' : undefined,
      alp_signaturedate: contract.signedDate,
      createdon: contract.createdAt,
    };
    const value = linked[field.key] ?? contract.crmFields?.[field.key];
    if (value === null || value === undefined || value === '')
      return (
        (
          {
            alp_remainday: '来源未提供',
            alp_approvaldate: '尚未记录审批日期',
            alp_signaturedate: '尚未登记签约',
            alp_terminationdate: '无终止记录',
            alp_terminationcause: '不适用，合同未终止',
            alp_originalcontract: '首版合同，无原合同',
            createdon: '历史记录未保留创建时间',
          } as Record<string, string>
        )[field.key] || '尚未填写'
      );
    if (typeof value === 'object') return value.name || value.id;
    const option = field.options.find((o) => o.value === value);
    return option
      ? option.label
      : field.key === 'alp_status' && typeof value === 'string'
        ? value
        : field.options.length
          ? `未知来源原值 ${value}（待核）`
          : String(value);
  }
  save() {
    if (this.editingContractId !== this.contract().id) {
      this.store.ui.fail('合同已切换，请重新打开表单');
      return;
    }
    const original = this.contract().crmFields || {};
    const changes = Object.fromEntries(
      Object.entries(this.draft).filter(
        ([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key] ?? null),
      ),
    );
    if (
      this.store.saveContractMainFields(this.contract().id, {
        expectedDataVersion: this.expectedDataVersion,
        title: this.title,
        customerAdoptedName: this.customerAdoptedName,
        crmFields: changes,
      })
    ) {
      this.editing.set(false);
      this.store.setPendingInlineEdit(false);
    }
  }
}
