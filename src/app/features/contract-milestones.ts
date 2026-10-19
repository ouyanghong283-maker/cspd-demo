import { Component, computed, effect, inject, input, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ContractMilestone } from '../core/models';
import { CONTRACT_MILESTONE_OWNERS, ContractMilestoneInput } from '../core/contract-milestones';
import { DemoStore } from '../core/store';

@Component({
  selector: 'app-contract-milestones',
  imports: [FormsModule],
  template: `
    <section class="milestones" aria-label="合同里程碑">
      <div class="head">
        <div>
          <h3>合同里程碑</h3>
          <p>
            {{
              readonly()
                ? '引用关联合同中的记录，由合同经办人维护。'
                : '维护合同约定的日期与责任人。'
            }}
          </p>
        </div>
        @if (!readonly() && !editing()) {
          <button
            class="btn"
            [disabled]="!store.salesEditable() || !store.editingWritable()"
            (click)="begin()"
          >
            新增合同里程碑
          </button>
        }
      </div>
      @if (rows().length) {
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>名称 / 编号</th>
                <th>合同日期</th>
                <th>提前天数</th>
                <th>负责人</th>
                <th>创建时间</th>
                @if (!readonly()) {
                  <th>操作</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr [attr.data-milestone-id]="row.id">
                  <td>
                    <strong>{{ row.name }}</strong
                    ><small>{{ row.id }}</small>
                  </td>
                  <td>{{ row.dueDate }}</td>
                  <td>{{ row.warningLeadDays }}</td>
                  <td>
                    {{ row.ownerName }}<small>{{ row.ownerPersonId || '历史身份待补' }}</small>
                  </td>
                  <td>{{ row.createdAt || '历史时间未记录' }}</td>
                  @if (!readonly()) {
                    <td>
                      <button
                        class="btn"
                        [disabled]="editing() || !store.salesEditable() || !store.editingWritable()"
                        (click)="begin(row)"
                      >
                        编辑里程碑
                      </button>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="empty">尚未登记合同里程碑</p>
      }
      @if (editing() && !readonly()) {
        <div class="editor" aria-label="合同里程碑表单">
          <label>里程碑名称<input aria-label="里程碑名称" [(ngModel)]="draft.name" /></label>
          <label
            >合同日期<input aria-label="里程碑日期" type="date" [(ngModel)]="draft.dueDate"
          /></label>
          <label
            >提前天数<input
              aria-label="里程碑提前天数"
              type="number"
              min="0"
              step="1"
              [(ngModel)]="draft.warningLeadDays"
          /></label>
          <label
            >负责人<select aria-label="里程碑负责人" [(ngModel)]="draft.ownerPersonId">
              <option value="">请选择负责人</option>
              @for (person of owners; track person.personId) {
                <option [value]="person.personId">{{ person.displayName }}</option>
              }
            </select></label
          >
          <div class="actions">
            <button class="btn primary" (click)="save()">保存合同里程碑</button
            ><button class="btn" (click)="cancel()">取消里程碑编辑</button>
          </div>
        </div>
      }
      <p class="note">合同里程碑独立于项目计划；保存不会生成 WBS、预算或提醒任务。</p>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .milestones {
        border: 1px solid var(--border, #dce3ec);
        border-radius: 12px;
        padding: 20px;
        background: var(--surface, #fff);
      }
      .head {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
      }
      h3 {
        margin: 0;
      }
      p {
        color: var(--muted, #64748b);
        font-size: 13px;
        margin: 6px 0 14px;
      }
      .table-scroll {
        overflow: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        text-align: left;
        padding: 12px;
        border-bottom: 1px solid var(--border, #e2e8f0);
        font-size: 13px;
        vertical-align: top;
      }
      small {
        display: block;
        color: var(--muted, #64748b);
        font-size: 11px;
        margin-top: 4px;
      }
      .editor {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        padding-top: 16px;
      }
      label {
        display: grid;
        gap: 6px;
        font-size: 13px;
      }
      input,
      select {
        width: 100%;
        padding: 9px;
        border: 1px solid var(--border, #cbd5e1);
        border-radius: 6px;
      }
      .actions {
        grid-column: 1/-1;
        display: flex;
        gap: 8px;
      }
      .note {
        margin: 14px 0 0;
      }
      .empty {
        padding: 18px 0;
      }
      @media (max-width: 700px) {
        .editor {
          grid-template-columns: 1fr;
        }
        .head {
          align-items: start;
          flex-direction: column;
        }
      }
    `,
  ],
})
export class ContractMilestones implements OnDestroy {
  readonly store = inject(DemoStore);
  readonly contractId = input.required<string>();
  readonly readonly = input(false);
  readonly rows = computed(() => this.store.contractMilestones(this.contractId()));
  readonly owners = CONTRACT_MILESTONE_OWNERS;
  readonly editing = signal(false);
  draft: ContractMilestoneInput = this.emptyDraft();
  private editingContractId = '';
  constructor() {
    effect(() => {
      const id = this.contractId();
      const readOnly = this.readonly();
      if (this.editing() && (id !== this.editingContractId || readOnly)) this.cancel();
    });
  }
  private emptyDraft(): ContractMilestoneInput {
    return {
      contractId: '',
      name: '',
      dueDate: '',
      warningLeadDays: null,
      ownerPersonId: '',
      expectedDataVersion: 0,
    };
  }
  begin(row?: ContractMilestone) {
    if (this.readonly() || !this.store.salesEditable() || !this.store.editingWritable()) return;
    this.editingContractId = this.contractId();
    this.draft = {
      ...this.emptyDraft(),
      ...(row
        ? {
            id: row.id,
            name: row.name,
            dueDate: row.dueDate,
            warningLeadDays: row.warningLeadDays,
            ownerPersonId: row.ownerPersonId || '',
          }
        : {}),
      contractId: this.contractId(),
      expectedDataVersion: this.store.state().dataVersion || 1,
    };
    this.editing.set(true);
    this.store.setPendingInlineEdit(true, 'contract-milestones');
  }
  save() {
    if (this.readonly() || this.editingContractId !== this.contractId()) {
      this.store.ui.fail('合同已切换，请重新打开表单');
      return;
    }
    if (this.store.saveContractMilestone(this.draft)) this.cancel();
  }
  cancel() {
    this.editing.set(false);
    this.store.setPendingInlineEdit(false, 'contract-milestones');
  }
  ngOnDestroy() {
    if (this.editing()) this.store.setPendingInlineEdit(false, 'contract-milestones');
  }
}
