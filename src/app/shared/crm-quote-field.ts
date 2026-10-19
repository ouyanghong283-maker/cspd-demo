import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CrmField, CrmValue } from '../core/crm-quote-schema';
import { CrmReference } from '../core/crm-quote';

@Component({
  selector: 'app-crm-quote-field',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label [for]="controlId()"
      >{{ field().label }}
      @if (required()) {
        <span class="required" aria-label="必填"> *</span>
      }
    </label>
    @if (readonly()) {
      <div
        class="read-value"
        [id]="controlId()"
        role="textbox"
        [attr.aria-label]="field().label"
        aria-readonly="true"
      >
        {{ display() }}
      </div>
    } @else if (field().type === 'lookup') {
      <select
        [id]="controlId()"
        [name]="controlId()"
        [attr.name]="controlId()"
        [ngModel]="value()"
        (ngModelChange)="valueChange.emit($event)"
        [required]="required()"
      >
        <option [ngValue]="null">请选择</option>
        @if (value() && !hasReference()) {
          <option [ngValue]="value()">原关联不适用于当前条件，请重新选择</option>
        }
        @for (option of references(); track option.id) {
          <option [ngValue]="option.id">{{ option.label }}</option>
        }
      </select>
      @if (value() && !hasReference()) {
        <small>上游条件或目录已变化，原选择不可保存，请重新选择；原引用仍保留供核对。</small>
      }
      @if (!references().length) {
        <small>当前业务无适用资料；来源范围：当前商机、币种及所选上游目录</small>
      }
    } @else if (field().options.length) {
      <select
        [id]="controlId()"
        [name]="controlId()"
        [attr.name]="controlId()"
        [ngModel]="value()"
        (ngModelChange)="valueChange.emit($event)"
        [required]="required()"
      >
        <option [ngValue]="null">请选择</option>
        @for (option of field().options; track option.value) {
          <option [ngValue]="option.value">{{ option.label }}</option>
        }
      </select>
    } @else if (field().type === 'boolean') {
      <select
        [id]="controlId()"
        [name]="controlId()"
        [attr.name]="controlId()"
        [ngModel]="value()"
        (ngModelChange)="valueChange.emit($event)"
      >
        <option [ngValue]="null">未提供</option>
        <option [ngValue]="true">是</option>
        <option [ngValue]="false">否</option>
      </select>
    } @else if (field().type === 'memo') {
      <textarea
        [id]="controlId()"
        [name]="controlId()"
        [attr.name]="controlId()"
        rows="3"
        [ngModel]="value()"
        (ngModelChange)="valueChange.emit($event || null)"
        [attr.maxlength]="field().maxLength"
        [required]="required()"
      ></textarea>
    } @else if (numeric()) {
      <input
        [id]="controlId()"
        [name]="controlId()"
        [attr.name]="controlId()"
        type="number"
        [ngModel]="value()"
        (ngModelChange)="valueChange.emit($event)"
        [step]="field().precision === 0 ? '1' : '0.01'"
        [attr.min]="field().min"
        [attr.max]="field().max"
        [required]="required()"
      />
    } @else {
      <input
        [id]="controlId()"
        [name]="controlId()"
        [attr.name]="controlId()"
        [type]="field().type === 'datetime' ? 'date' : 'text'"
        [ngModel]="value()"
        (ngModelChange)="valueChange.emit($event || null)"
        [attr.maxlength]="field().maxLength"
        [required]="required()"
      />
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #526079;
      margin-bottom: 6px;
    }
    .required {
      color: #b52e3d;
    }
    input,
    select,
    textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 38px;
      border: 1px solid #cbd4e2;
      border-radius: 5px;
      padding: 8px 10px;
      color: #23344e;
      background: white;
      font: inherit;
      font-size: 13px;
    }
    textarea {
      resize: vertical;
    }
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible {
      outline: 2px solid #315be6;
      outline-offset: 2px;
    }
    .read-value {
      min-height: 38px;
      padding: 9px 10px;
      border-bottom: 1px solid #e0e6ee;
      color: #23344e;
      font-size: 13px;
      overflow-wrap: anywhere;
      font-variant-numeric: tabular-nums;
    }
    small {
      display: block;
      margin-top: 5px;
      color: #8b4b15;
      font-size: 11px;
    }
  `,
})
export class CrmQuoteField {
  readonly field = input.required<CrmField>();
  readonly value = input<CrmValue>(null);
  readonly references = input<CrmReference[]>([]);
  readonly readonly = input(false);
  readonly required = input(false);
  readonly context = input('quote');
  readonly valueChange = output<CrmValue>();
  readonly controlId = computed(() => `${this.context()}-${this.field().name}`);
  readonly numeric = computed(() =>
    ['decimal', 'integer', 'double', 'money'].includes(this.field().type),
  );
  readonly hasReference = computed(() =>
    this.references().some((reference) => reference.id === this.value()),
  );
  readonly display = computed(() => {
    const value = this.value();
    if (value == null || value === '') return '—';
    if (this.field().type === 'lookup')
      return this.references().find((row) => row.id === value)?.label || String(value);
    if (this.field().options.length)
      return this.field().options.find((row) => row.value === value)?.label || String(value);
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'number')
      return new Intl.NumberFormat('zh-CN', {
        minimumFractionDigits: this.field().precision ?? 0,
        maximumFractionDigits: this.field().precision ?? 2,
      }).format(value);
    return String(value);
  });
}
