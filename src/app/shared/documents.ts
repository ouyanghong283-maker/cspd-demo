import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { DemoStore } from '../core/store';
import { Icon } from './icon';
import { Badge } from './badge';
@Component({
  selector: 'app-documents',
  imports: [Icon, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <div class="document-section">
    <div class="section-heading">
      <div>
        <h3>{{ title() }}</h3>
        <p>现用表格直接上传，同一份资料可关联多个节点。</p>
      </div>
      <app-badge text="本地演示资料" />
    </div>
    <div class="doc-kinds">
      @for (kind of kinds(); track kind) {
        <div class="doc-kind" [attr.id]="'doc-' + kind">
          <div>
            <app-icon name="file" /><strong>{{ kind }}</strong
            ><app-badge [text]="store.has(entityId(), kind) ? '已关联' : '待补资料'" />
          </div>
          <div class="row-actions">
            <button
              class="btn small"
              [disabled]="!store.canAttach(entityId(), kind)"
              (click)="store.sample(entityId(), kind)"
            >
              使用演示附件</button
            ><label class="btn small" [class.disabled]="!store.canAttach(entityId(), kind)"
              ><app-icon name="upload" />选择文件<input
                type="file"
                class="sr-only"
                accept=".pdf,.xlsx,.xls,.docx"
                [disabled]="!store.canAttach(entityId(), kind) || busy()"
                (change)="upload($event, kind)"
                [attr.aria-label]="'上传' + kind"
            /></label>
          </div>
        </div>
      }
    </div>
    @if (store.attachments(entityId()).length) {
      <div class="file-list">
        @for (a of store.attachments(entityId()); track a.id) {
          <div class="file-row">
            <span class="file-icon"><app-icon name="file" /></span>
            <div class="grow">
              <button class="text-link" (click)="store.openFile(a)">{{ a.name }}</button>
              <p>
                {{ a.kind }} · {{ a.operator }} · {{ a.date }} · {{ (a.size / 1024).toFixed(1) }} KB
                @if (a.sample) {
                  <span>· 演示样例</span>
                }
              </p>
            </div>
            <button class="icon-btn" aria-label="下载资料" (click)="store.openFile(a)">
              <app-icon name="download" /></button
            ><button
              class="icon-btn"
              [disabled]="!store.canAttach(entityId(), a.kind)"
              [attr.aria-label]="'删除' + a.kind"
              (click)="remove(a.id)"
            >
              <app-icon name="trash" />
            </button>
          </div>
        }
      </div>
    }
    <p class="fine-print">
      单文件10MB，本轮总容量50MB。支持PDF、Word及Excel；有文件不代表业务已审核。{{
        busy() ? '正在保存文件…' : ''
      }}
    </p>
  </div>`,
})
export class Documents {
  store = inject(DemoStore);
  entityId = input.required<string>();
  kinds = input<string[]>(['需求导入表']);
  title = input('资料与附件');
  busy = signal(false);
  async upload(event: Event, kind: string): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set(true);
    await this.store.upload(this.entityId(), kind, file);
    this.busy.set(false);
    input.value = '';
  }
  async remove(id: string): Promise<void> {
    const a = this.store.state().attachments.find((x) => x.id === id);
    if (a && window.confirm('删除资料后相关关键节点将需要复核，确定删除吗？'))
      await this.store.removeAttachment(a);
  }
}
