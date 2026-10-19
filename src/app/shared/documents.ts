import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DemoStore } from '../core/store';
import { newId } from '../core/seed';
import { personField } from '../core/personnel';
import { Badge } from './badge';
@Component({
  selector: 'app-documents',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .file-row p,
    .file-row .text-link {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .file-row .text-link {
      max-width: 100%;
    }
  `,
  template: `<div class="document-section">
    <div class="section-heading">
      <div>
        <h3>{{ title() }}</h3>
        <p>仅模拟文件记录，不保存原文件。</p>
      </div>
      <app-badge text="模拟资料" />
    </div>
    <div class="doc-kinds">
      @for (kind of kinds(); track kind) {
        <div class="doc-kind" [attr.id]="'doc-' + kind">
          <strong>{{ kind }}</strong
          ><app-badge [text]="store.has(entityId(), kind) ? '已留档' : '待补资料'" /><button
            class="btn small"
            [disabled]="!store.canAttach(entityId(), kind)"
            (click)="simulate(kind)"
          >
            模拟上传{{ kind }}
          </button>
        </div>
      }
    </div>
    <div class="file-list">
      @for (a of store.attachments(entityId()).slice().reverse(); track a.id) {
        <div class="file-row">
          <div class="grow">
            <button class="text-link" (click)="store.openFile(a)">{{ a.name }}</button>
            <p>
              {{ a.kind }} · {{ a.operator }} · {{ a.date }} ·
              {{ a.mode === 'simulated' ? '模拟记录' : '旧记录' }} · {{ a.note }}
            </p>
          </div>
        </div>
      }
    </div>
    <p class="fine-print">历史只读，更正请新增记录。文件名后缀仅展示，不校验格式或容量。</p>
  </div>`,
})
export class Documents {
  store = inject(DemoStore);
  entityId = input.required<string>();
  kinds = input<string[]>(['需求导入表']);
  title = input('资料与附件');
  simulate(kind: string): void {
    const operationId = newId('OP');
    const latest = this.store.solution(this.entityId())?.latestVersionId || '';
    this.store.ui.open({
      title: `模拟上传${kind}`,
      description: '仅模拟文件记录，不保存原文件；关闭弹窗不生成记录。',
      fields: [
        { key: 'name', label: '示例文件名', value: `演示_${kind}.pdf`, required: true },
        ...(['方案报价样例', '核心技术方案'].includes(kind)
          ? [personField('owner', '方案业务责任人', '周方案', true)]
          : []),
        { key: 'note', label: '说明', type: 'textarea' },
      ],
      onSave: (d) =>
        ['方案报价样例', '核心技术方案'].includes(kind)
          ? this.store.uploadSolution(
              this.entityId(),
              d['name'],
              d['owner'],
              d['note'],
              operationId,
              latest,
            )
          : this.store.simulateDocument(this.entityId(), kind, d['name'], d['note'], operationId),
    });
  }
}
