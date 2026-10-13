import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DialogRequest } from '../core/models';
import { UiService } from '../core/ui.service';
import { Icon } from './icon';
@Component({
  selector: 'app-dialog',
  imports: [ReactiveFormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <div class="modal-backdrop" (click)="close()"></div>
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="config().title"
      (keydown)="trap($event)"
    >
      <header>
        <div>
          <h2>{{ config().title }}</h2>
          <p>{{ config().description || '保存后将在关联页面同步显示。' }}</p>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭弹窗" (click)="close()">
          <app-icon name="close" />
        </button>
      </header>
      <form [formGroup]="form" (ngSubmit)="save()">
        <div class="modal-body">
          <p class="example-note">示例用于说明填写方式，具体内容请按当前业务记录。</p>
          <div class="form-grid">
            @for (f of requiredFields(); track f.key) {
              <label [class.full]="f.type === 'textarea'"><span>{{ f.label }} <em>*</em></span>
                @if (f.type === 'select') {
                  <select [formControlName]="f.key" [attr.data-field]="f.key"><option value="">请选择</option>@for (option of f.options || []; track option) { <option [value]="option">{{ option }}</option> }</select>
                } @else if (f.type === 'textarea') {
                  <textarea rows="3" [formControlName]="f.key" [attr.data-field]="f.key" [placeholder]="placeholder(f)"></textarea>
                } @else {
                  <input [type]="f.type || 'text'" [formControlName]="f.key" [attr.data-field]="f.key" [placeholder]="placeholder(f)" [attr.min]="f.min ?? null" />
                }
                @if (form.controls[f.key].touched && form.controls[f.key].invalid) { <small class="field-error">请填写有效的{{ f.label }}</small> }
                @else if (f.hint || placeholder(f)) { <small>{{ f.hint || placeholder(f) }}</small> }
              </label>
            }
          </div>
          @if (optionalFields().length) {
            <details class="optional-fields"><summary>补充信息（选填） · {{ optionalFields().length }} 项</summary>
              <div class="form-grid">
                @for (f of optionalFields(); track f.key) {
                  <label [class.full]="f.type === 'textarea'"><span>{{ f.label }}</span>
                    @if (f.type === 'select') {
                      <select [formControlName]="f.key" [attr.data-field]="f.key"><option value="">请选择</option>@for (option of f.options || []; track option) { <option [value]="option">{{ option }}</option> }</select>
                    } @else if (f.type === 'textarea') {
                      <textarea rows="3" [formControlName]="f.key" [attr.data-field]="f.key" [placeholder]="placeholder(f)"></textarea>
                    } @else {
                      <input [type]="f.type || 'text'" [formControlName]="f.key" [attr.data-field]="f.key" [placeholder]="placeholder(f)" [attr.min]="f.min ?? null" />
                    }
                    @if (form.controls[f.key].touched && form.controls[f.key].invalid) { <small class="field-error">请填写有效的{{ f.label }}</small> }
                    @else if (f.hint || placeholder(f)) { <small>{{ f.hint || placeholder(f) }}</small> }
                  </label>
                }
              </div>
            </details>
          }
          @if (error()) {
            <div class="inline-alert error" role="alert">{{ error() }}</div>
          }
        </div>
        <footer>
          @if (config().sample) {
            <button class="btn" type="button" (click)="fill()">填入演示内容</button>
          }
          <span class="spacer"></span
          ><button class="btn" type="button" (click)="close()">取消</button
          ><button class="btn primary" type="submit" [disabled]="busy()">
            {{ busy() ? '正在保存' : config().submitLabel || '保存' }}
          </button>
        </footer>
      </form>
    </section>`,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 100;
    }
    .modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(18, 32, 57, 0.38);
      backdrop-filter: blur(2px);
    }
    .modal {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(720px, calc(100vw - 32px));
      max-height: 90vh;
      overflow: auto;
      background: white;
      border-radius: 14px;
      box-shadow: 0 20px 70px #13203930;
    }
    .modal header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 24px;
      border-bottom: 1px solid var(--line);
    }
    header h2 {
      font-size: 20px;
      margin: 0 0 6px;
    }
    header p {
      font-size: 13px;
      color: var(--muted);
      margin: 0;
      line-height: 1.7;
    }
    .modal-body {
      padding: 24px;
    }
    .modal footer {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 18px 24px;
      border-top: 1px solid var(--line);
      background: #fafbfc;
      position: sticky;
      bottom: 0;
    }
    .spacer {
      flex: 1;
    }
    .example-note{margin:0 0 14px;color:#7d8ba1;font-size:11px}.optional-fields{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}.optional-fields summary{cursor:pointer;color:#52647f;font-size:12px;font-weight:550;padding:5px 0 12px}.optional-fields[open] .form-grid{padding-top:8px}
    em {
      color: var(--red);
      font-style: normal;
    }
  `,
})
export class Dialog {
  config = input.required<DialogRequest>();
  ui = inject(UiService);
  busy = signal(false);
  error = signal('');
  form = new FormGroup<Record<string, FormControl<string>>>({});
  constructor() {
    afterNextRender(() =>
      document.querySelector<HTMLElement>('.modal input,.modal select,.modal textarea')?.focus(),
    );
  }
  requiredFields() { return this.config().fields.filter((field) => field.required); }
  optionalFields() { return this.config().fields.filter((field) => !field.required); }
  placeholder(field: { key: string; label: string; type?: string; hint?: string; min?: number }): string {
    if (field.hint) return field.hint;
    const examples: Record<string, string> = { customer: '海岳储能科技有限公司', customerName: '海岳储能科技有限公司', project: '青山储能一期', projectName: '青山储能一期', contact: '陈先生', phone: '13800000000', email: 'name@example.com', capacity: '50', amount: '1200000', owner: '张销售', reason: '客户要求调整交期', summary: '说明现状、依据和待确认事项', evidence: '客户邮件确认（演示记录）' };
    if (examples[field.key]) return `例如：${examples[field.key]}`;
    if (field.type === 'date') return '例如：2026-10-20';
    if (field.type === 'number') return field.min !== undefined ? `按实际业务填写，最小值 ${field.min}` : '按实际金额或数量填写';
    if (field.type === 'textarea') return `例如：说明${field.label}的现状、依据或待确认事项`;
    if (field.type === 'select') return '';
    return `例如：填写${field.label}对应的实际信息`;
  }
  ngOnInit(): void {
    for (const f of this.config().fields)
      this.form.addControl(
        f.key,
        new FormControl(String(f.value ?? ''), {
          nonNullable: true,
          validators: [
            ...(f.required ? [Validators.required] : []),
            ...(f.type === 'email' ? [Validators.email] : []),
            ...(f.min !== undefined ? [Validators.min(f.min)] : []),
          ],
        }),
      );
  }
  fill(): void {
    this.form.patchValue(
      Object.fromEntries(
        Object.entries(this.config().sample || {}).map(([k, v]) => [k, String(v)]),
      ),
    );
  }
  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('请补齐红色标出的必填项');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.config().onSave(this.form.getRawValue());
      if (result !== false) this.ui.dialog.set(null);
      else this.error.set(this.ui.toast()?.text || '请检查输入信息');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      this.busy.set(false);
    }
  }
  close(): void {
    if (this.busy()) return;
    if (this.form.dirty && !window.confirm('有未保存修改，确定放弃并关闭吗？')) return;
    this.ui.dialog.set(null);
  }
  @HostListener('document:keydown.escape') escape(): void {
    this.close();
  }
  trap(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const el = document.querySelector('.modal');
    const list = Array.from(
      el?.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea') || [],
    );
    if (e.shiftKey && document.activeElement === list[0]) {
      list.at(-1)?.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === list.at(-1)) {
      list[0]?.focus();
      e.preventDefault();
    }
  }
}
