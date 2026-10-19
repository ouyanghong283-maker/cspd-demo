import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DemoStore } from '../core/store';
import {
  selectNodeApplicability,
  setNodeApplicability,
  OPTIONAL_EXECUTION_NODES,
} from '../core/lifecycle-progress/applicability';
import { knownDemoPersonId } from '../core/plan-person';
import { newId } from '../core/seed';
import type { V9CommandResult, V9OperationContext } from '../core/v9-contracts';
/** K17绑定：既定错误字段格式化，只呈现命令返回，不触碰原任务完成门禁。 */
function formatCommandFeedback(r: V9CommandResult): string {
  return r.status === 'rejected' || r.status === 'failed'
    ? `保存未完成（${r.issue.code}${r.issue.field ? ' · 字段 ' + r.issue.field : ''}）：${r.message}`
    : r.message;
}
/** CODEX来源页适配器；只调用公开命令，不触碰原任务完成门禁。 */
@Component({
  selector: 'app-node-applicability-panel',
  imports: [FormsModule],
  styleUrl: './solution-input-panel.scss',
  template: ` <section
    class="v9-reading v9-panel"
    data-v9-theme="light"
    aria-label="执行节点适用性"
  >
    <h3>执行节点适用性</h3>
    <p>业务PM：{{ store.project(projectId())?.pm }} · 实际操作者：{{ store.person() }}</p>
    <p>仅下列六类允许留因免做。客户验收与内部移交仍须满足原报告、结果等要求。</p>
    @for (n of view(); track n.id) {
      <p>
        {{ n.label }}：{{
          n.record?.applicability === 'not-required' ? '无需执行' : '按原任务依据执行'
        }}{{ n.record ? ' · ' + n.record.reason : '' }}
      </p>
    }
    <button class="btn" [disabled]="!store.editingWritable()" (click)="begin()">
      设置或撤销免做
    </button>
    <form (ngSubmit)="save()">
      <fieldset [disabled]="!store.editingWritable() || !context">
        <legend>业务PM确认适用性</legend>
        <label
          >节点<select name="node" [(ngModel)]="node">
            @for (n of nodes; track n.id) {
              <option [value]="n.id">{{ n.label }}</option>
            }
          </select></label
        >
        <label
          >执行要求<select name="applicability" [(ngModel)]="applicability">
            <option value="not-required">无需执行</option>
            <option value="applicable">撤销免做，恢复原依据</option>
          </select></label
        >
        <label
          >原因<textarea name="applicabilityReason" [(ngModel)]="reason" required></textarea>
        </label>
        <button class="btn" type="submit">保存执行要求</button>
      </fieldset>
    </form>
    <p role="status">{{ feedback() }}</p>
    <details>
      <summary>适用性历史</summary>
      @for (n of view(); track n.id) {
        @for (h of n.record?.history ?? []; track h.id) {
          <p>
            {{ n.label }} · {{ h.applicability === 'not-required' ? '无需执行' : '恢复执行' }} ·
            {{ h.reason }} · PM {{ h.pm?.name ?? n.record?.pm?.name }} · 操作人
            {{ h.operator.name }} · {{ h.confirmedAt }}
          </p>
        }
      }
    </details>
  </section>`,
})
export class NodeApplicabilityPanel {
  readonly store = inject(DemoStore);
  readonly projectId = input.required<string>();
  readonly nodes = OPTIONAL_EXECUTION_NODES;
  readonly view = computed(() => selectNodeApplicability(this.store.state(), this.projectId()));
  readonly feedback = signal('');
  node: string = 'execution.sat';
  applicability: 'applicable' | 'not-required' = 'not-required';
  reason = '';
  context: V9OperationContext | null = null;
  private editingProjectId = '';
  begin() {
    this.editingProjectId = this.projectId();
    const t = this.store.v9CommandTarget();
    this.context = t ? { ...t, operationId: newId('APPLICABILITY') } : null;
    this.reason = '';
  }
  save() {
    if (this.editingProjectId !== this.projectId() || !this.context) {
      this.feedback.set('项目已变化，请重新设置执行要求');
      return;
    }
    const p = this.store.project(this.projectId())!;
    const r = setNodeApplicability(
      this.store,
      {
        projectId: p.id,
        nodeId: this.node,
        applicability: this.applicability,
        reason: this.reason,
        pmPersonId: p.pmPersonId ?? knownDemoPersonId(p.pm) ?? '',
      },
      this.context,
    );
    this.feedback.set(formatCommandFeedback(r));
    if (r.status === 'committed' || r.status === 'unchanged') this.context = null;
  }
}
