import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DemoStore } from '../core/store';
import {
  confirmProgressMapping,
  selectProgressMapping,
  PROGRESS_GROUPS,
} from '../core/lifecycle-progress/mapping';
import type { ProgressGroupId, V9CommandResult, V9OperationContext } from '../core/v9-contracts';
import { newId } from '../core/seed';
/** K17绑定：既定错误字段格式化，只呈现命令返回，不改变规则或判定。 */
function formatCommandFeedback(r: V9CommandResult): string {
  return r.status === 'rejected' || r.status === 'failed'
    ? `保存未完成（${r.issue.code}${r.issue.field ? ' · 字段 ' + r.issue.field : ''}）：${r.message}`
    : r.message;
}
@Component({
  selector: 'app-progress-mapping-panel',
  imports: [FormsModule],
  styleUrl: './solution-input-panel.scss',
  template: ` <section
    class="v9-reading v9-panel"
    data-v9-theme="light"
    aria-label="固定执行任务组"
  >
    <h3>固定执行任务组</h3>
    <p>演示代办 · 实际操作者：{{ store.person() }}；业务PM：{{ store.project(projectId())?.pm }}</p>
    <p>只确认关联，不改变来源任务状态。改名和新增小任务不会改变已确认成员。</p>
    <p role="status">{{ feedback() }}</p>
    @for (g of view().groups; track g.id) {
      <p>
        {{ g.label }} · {{ g.weight }}分 ·
        {{ g.pending ? '映射待处理' : '完成 ' + g.done + '/' + g.total }} · 修订{{ g.revision }}
      </p>
    }
    <details>
      <summary>查看固定成员及来源状态</summary>
      @for (g of view().groups; track g.id) {
        <h4>{{ g.label }}</h4>
        @for (id of g.planIds; track id) {
          <p>{{ id }} · {{ memberLabel(id) }}；改名保留稳定身份，删除或取消须重新留因处理。</p>
        }
      }
    </details>
    <button class="btn" [disabled]="!writable()" (click)="begin()">编辑任务组关联</button>
    <fieldset [disabled]="!writable()">
      <legend>确认固定成员</legend>
      <label
        >执行组<select name="group" [(ngModel)]="group" (ngModelChange)="begin()">
          @for (g of groups; track g.id) {
            <option [value]="g.id">{{ g.label }}</option>
          }
        </select></label
      >
      @for (p of view().options; track p.id) {
        <label
          ><span
            ><input
              type="checkbox"
              [checked]="selected.has(p.id)"
              (change)="toggle(p.id, $event)"
            />
            {{ p.name }} · {{ p.id }} · {{ p.status }}</span
          ></label
        >
      }
      <label>关联原因<textarea name="mappingReason" [(ngModel)]="reason"></textarea></label>
      <button class="btn" (click)="save()">确认任务组</button>
    </fieldset>
    <details>
      <summary>关联历史</summary>
      @for (g of view().groups; track g.id) {
        @for (h of g.history; track h.id) {
          <p>
            {{ g.label }} · {{ h.reason }} · {{ h.operator.name }} · {{ h.changedAt }} · 原成员{{
              h.fromPlanIds.join('、')
            }}
            → {{ h.toPlanIds.join('、') }}
          </p>
        }
      }
    </details>
  </section>`,
})
export class ProgressMappingPanel {
  readonly store = inject(DemoStore);
  readonly projectId = input.required<string>();
  readonly groups = PROGRESS_GROUPS;
  readonly view = computed(() => selectProgressMapping(this.store.state(), this.projectId()));
  readonly feedback = signal('');
  readonly writable = computed(() => this.store.editingWritable());
  group: ProgressGroupId = 'design';
  selected = new Set<string>();
  reason = '';
  private revision = 0;
  private context: V9OperationContext | null = null;
  private editingProjectId: string | null = null;
  begin() {
    this.editingProjectId = this.projectId();
    const g = this.view().groups.find((g) => g.id === this.group)!;
    this.selected = new Set(g.planIds);
    this.revision = g.revision;
    this.reason = '';
    const t = this.store.v9CommandTarget();
    this.context = t ? { ...t, operationId: newId('MAPPING') } : null;
  }
  memberLabel(id: string) {
    const p = this.store.project(this.projectId())?.plans.find((p) => p.id === id);
    return p
      ? `${p.name} · ${p.status} · 实际日期 ${p.actual || '待补'}`
      : '来源任务已删除，映射待处理';
  }
  toggle(id: string, event: Event) {
    if ((event.target as HTMLInputElement).checked) this.selected.add(id);
    else this.selected.delete(id);
  }
  save() {
    if (this.editingProjectId !== this.projectId()) {
      this.feedback.set('来源项目已切换，请重新编辑关联');
      return;
    }
    if (!this.context) {
      this.feedback.set('请先编辑任务组关联');
      return;
    }
    const r = confirmProgressMapping(
      this.store,
      {
        projectId: this.projectId(),
        groupId: this.group,
        planIds: [...this.selected],
        expectedMappingRevision: this.revision,
        reason: this.reason,
      },
      this.context,
    );
    this.feedback.set(formatCommandFeedback(r));
    if (r.status === 'committed' || r.status === 'unchanged') this.context = null;
  }
}
