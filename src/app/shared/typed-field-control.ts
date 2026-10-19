import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  QuoteExtensionFieldDefinition,
  QuoteExtensionValue,
} from '../core/field-metadata';

@Component({
  selector: 'app-typed-field-control',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="typed-field" [attr.data-logical-name]="definition().logicalName">
      <span class="field-heading">
        <strong>{{ definition().label }}</strong>
        <span class="field-type">{{ definition().crmType }} · {{ definition().kind }}</span>
      </span>
      @if (definition().kind === 'readonly') {
        <span class="readonly-value">{{ definition().readOnlyReason || '来源值未提供' }}</span>
      } @else if (definition().kind === 'enum') {
        <select
          [attr.aria-label]="definition().label"
          [ngModel]="enumValue()"
          (ngModelChange)="setEnumValue($event)"
        >
          <option value="">未填写</option>
          @for (option of definition().options || []; track option.rawValue) {
            <option [value]="option.rawValue">{{ option.label }} · 原值 {{ option.rawValue }}</option>
          }
        </select>
      } @else if (definition().kind === 'lookup') {
        <select
          [attr.aria-label]="definition().label"
          [ngModel]="lookupValue()"
          (ngModelChange)="valueChange.emit($event || null)"
        >
          <option value="">未选择</option>
          @for (option of definition().options || []; track option.id) {
            <option [value]="option.id">
              {{ option.label }} · ID {{ option.id }} · {{ option.source === 'simulated' ? '模拟引用' : '本地引用' }}
            </option>
          }
        </select>
      } @else {
        <input
          [type]="inputType()"
          [attr.aria-label]="definition().label"
          [ngModel]="value() ?? ''"
          (ngModelChange)="setInputValue($event)"
        />
      }
      <span class="source-note">
        来源：{{ definition().sourceEvidence }} · CSPD字段级必填：{{ cspdRequirement() }}
        @if (definition().crmRequiredLevel !== 'none') {
          · 标准CRM元数据必填：{{ definition().crmRequiredLevel }}（不自动作为CSPD必填）
        }
      </span>
      @if (definition().semanticsNote) {
        <span class="semantics-note">{{ definition().semanticsNote }}</span>
      }
    </label>
  `,
  styles: `
    :host { display:block; min-width:0; }
    .typed-field { display:grid; gap:7px; min-width:0; }
    .field-heading { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
    .field-heading strong { color:#344258; font-size:12px; }
    .field-type { color:#929cad; font-size:10px; white-space:nowrap; }
    input,select { width:100%; height:38px; box-sizing:border-box; padding:0 10px; border:1px solid #dfe4ec; border-radius:7px; color:#26344a; background:white; font:inherit; font-size:12px; }
    .readonly-value { min-height:38px; box-sizing:border-box; padding:10px; border:1px dashed #d7dde7; border-radius:7px; color:#808b9d; background:#f8f9fb; font-size:11px; line-height:1.5; }
    .source-note,.semantics-note { color:#8994a5; font-size:10px; line-height:1.55; overflow-wrap:anywhere; }
    .semantics-note { color:#687890; }
  `,
})
export class TypedFieldControl {
  definition = input.required<QuoteExtensionFieldDefinition>();
  value = input<QuoteExtensionValue>(null);
  valueChange = output<QuoteExtensionValue>();

  inputType(): string {
    if (this.definition().kind === 'number') return 'number';
    if (this.definition().kind === 'date') return 'date';
    return 'text';
  }

  enumValue(): string {
    return this.value() === null ? '' : String(this.value());
  }

  lookupValue(): string {
    return typeof this.value() === 'string' ? this.value() as string : '';
  }

  cspdRequirement(): string {
    if (this.definition().cspdRequired.status === 'required') return '必填';
    if (this.definition().cspdRequired.status === 'optional') return '选填';
    return '待核；当前不强制';
  }

  setEnumValue(raw: string): void {
    if (!raw) {
      this.valueChange.emit(null);
      return;
    }
    const option = this.definition().options?.find((item) => String(item.rawValue) === raw);
    this.valueChange.emit(option?.rawValue ?? null);
  }

  setInputValue(input: string | number): void {
    if (this.definition().kind === 'number') {
      const value = input === '' ? null : Number(input);
      this.valueChange.emit(value === null || Number.isFinite(value) ? value : null);
      return;
    }
    this.valueChange.emit(input === '' ? null : String(input));
  }
}
