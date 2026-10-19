import { formatSolutionTime } from '../core/solution-workflow/presentation';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  achievementLabel,
  type selectFinalizationSource,
} from '../core/solution-workflow/finalization';
import { SolutionInputPanel } from './solution-input-panel';
import { newId } from '../core/seed';
import type { SolutionOutputIds, V9OperationContext } from '../core/v9-contracts';
/**
 * CODEX固定阅读骨架；K15仅绑定确认表单、成绩/缺项文本与差异历史回调：
 * 不生成业务时间、不计算成绩、不设计布局，确认只经父页公开回调提交统一保存。
 */
@Component({
  selector: 'app-solution-finalization-summary',
  imports: [FormsModule],
  styleUrl: './solution-input-panel.scss',
  template: ` <section class="v9-reading v9-panel" data-v9-theme="light" aria-label="方案定稿依据">
    <h3>首次成绩与当前方案</h3>
    <p>
      首次成绩：{{ view().historicalUnscored ? '历史未评分' : label(view().first) }} · 当前{{
        view().status === 'current'
          ? '组合已确认'
          : view().status === 'stale'
            ? '资料或需求已变化，待重新定稿'
            : '尚未定稿'
      }}
    </p>
    @if (view().first; as f) {
      <p>
        首次完成日 {{ f.businessDate }} · 首次期限 {{ f.deadlineDate }} ·
        {{ f.timezone }}；后续改版不重算。
      </p>
    }
    <p>
      产品需求修订 {{ view().productNeedRevision ?? '待补' }} · 期限
      {{ view().schedule?.deadlineDate ?? '待补' }} · 业务PM
      {{ view().schedule?.pm?.name ?? '待补' }} · 方案负责人
      {{ view().schedule?.owner?.name ?? '待补' }}
    </p>
    @if (view().issues.length) {
      <section aria-label="缺项与错误">
        <h4>缺项与错误</h4>
        @for (i of view().issues; track i.code + (i.field ?? '')) {
          <p>{{ i.message }}</p>
        }
      </section>
    }
    @if (view().status === 'stale') {
      <section aria-label="当前差异">
        <h4>当前差异</h4>
        @if (view().differences.length) {
          <p>版本已变化：{{ kindNames(view().differences) }}</p>
        }
        @if (view().requirementChanged) {
          <p>产品需求已修订：{{ view().productNeedRevision }}</p>
        }
      </section>
    }
    <details>
      <summary>历次定稿（{{ view().events.length }}）</summary>
      @for (e of view().events; track e.id) {
        <article>
          <p>
            第{{ e.sequence }}次 ·
            <time [attr.datetime]="e.confirmedAt">{{ businessTime(e.confirmedAt) }}</time
            >（Asia/Shanghai） · 负责人 {{ e.owner.name }} · 操作人 {{ e.operator.name }} · 需求修订
            {{ e.productNeedRevision }}
          </p>
          @for (v of e.versionMetadataSnapshot; track v.id) {
            <p>
              {{ v.kind }} V{{ v.number }} · {{ v.fileName }} · {{ v.size }} 字节 ·
              {{ businessTime(v.uploadedAt) }}（Asia/Shanghai）
            </p>
          }
        </article>
      }
    </details>
    @if (writable()) {
      <button class="btn" [disabled]="!canConfirm() || busy()" (click)="beginConfirm()">
        {{ view().status === 'missing' ? '核对并首次定稿' : '核对并重新定稿' }}
      </button>
    }
    @if (confirming()) {
      <form (ngSubmit)="confirm()">
        <fieldset [disabled]="busy()">
          <legend>确认摘要（打开时快照；资料、需求或期限责任变化须重新核对）</legend>
          <p>
            四类版本：{{ summaryText() }}；需求修订
            {{ snapshot?.productNeedRevision ?? '待补' }}；期限修订第
            {{ snapshot?.scheduleRevision ?? '?' }} 版
          </p>
          <p>
            首次期限 {{ snapshot?.deadlineDate }} · 业务PM {{ snapshot?.pmName }} · 方案负责人
            {{ snapshot?.ownerName }}
          </p>
          <p>系统将记录当前时间（Asia/Shanghai展示），无需填写操作时间。</p>
          <label>
            <input type="checkbox" name="actingOnBehalf" [(ngModel)]="actingOnBehalf" />
            代方案负责人办理（实际操作者：{{ store.person() }}）
          </label>
          <button class="btn" type="submit" [disabled]="busy()">
            {{ busy() ? '正在确认，请等待结果' : '确认定稿' }}
          </button>
          <button class="btn" type="button" [disabled]="busy()" (click)="cancelConfirm()">
            取消
          </button>
        </fieldset>
      </form>
    }
    <p role="status" aria-live="polite">{{ feedback() }}</p>
  </section>`,
})
export class SolutionFinalizationSummary {
  readonly view = input.required<ReturnType<typeof selectFinalizationSource>>();
  readonly label = achievementLabel;
  /** 父页公开K15接缝：命令自行核对摘要、文件、权限并统一保存后发布。 */
  private readonly panel = inject(SolutionInputPanel);
  readonly store = this.panel.store;
  readonly confirming = signal(false);
  readonly busy = signal(false);
  readonly feedback = signal('');
  readonly writable = computed(() => this.panel.writable());
  actingOnBehalf = false;
  snapshot: {
    opportunityId: string;
    fourVersionIds: SolutionOutputIds;
    productNeedRevision: string;
    ownerPersonId: string;
    scheduleRevision: number;
    deadlineDate: string;
    pmName: string;
    ownerName: string;
    versions: { kind: string; number: number; fileName: string }[];
  } | null = null;
  private context: V9OperationContext | null = null;
  constructor() {
    let previous: string | undefined;
    effect(() => {
      const current = this.targetKey();
      if (previous !== undefined && previous !== current) this.cancelConfirm();
      previous = current;
    });
  }
  private targetKey() {
    const t = this.store.v9CommandTarget();
    return JSON.stringify([t?.workspaceId, t?.roundId, this.view().opportunityId]);
  }
  readonly businessTime = formatSolutionTime;
  kindLabel(k: string) {
    return (
      (
        { proposal: '技术方案', bom: '设计BOM', sld: 'SLD', degradation: '衰减资料' } as Record<
          string,
          string
        >
      )[k] ?? k
    );
  }
  kindNames(kinds: string[]) {
    return kinds.map((k) => this.kindLabel(k)).join('、');
  }
  summaryText() {
    const s = this.snapshot;
    return s
      ? s.versions.map((v) => `${this.kindLabel(v.kind)} V${v.number} · ${v.fileName}`).join('；')
      : '';
  }
  canConfirm() {
    const v = this.view();
    return (
      !!v.fourVersionIds &&
      !!v.schedule &&
      v.issues.length === 0 &&
      (v.status === 'missing' || v.status === 'stale')
    );
  }
  beginConfirm() {
    const v = this.view();
    const t = this.store.v9CommandTarget();
    if (!v.fourVersionIds || !v.schedule || !v.productNeedRevision || !t) {
      this.feedback.set('当前摘要不齐或无活动工作区，无法确认定稿');
      return;
    }
    this.snapshot = {
      opportunityId: v.opportunityId,
      fourVersionIds: { ...v.fourVersionIds },
      productNeedRevision: v.productNeedRevision,
      ownerPersonId: v.schedule.owner.personId,
      scheduleRevision: v.schedule.revision,
      deadlineDate: v.schedule.deadlineDate,
      pmName: v.schedule.pm.name,
      ownerName: v.schedule.owner.name,
      versions: v.versions.flatMap((version) =>
        version ? [{ kind: version.kind, number: version.number, fileName: version.fileName }] : [],
      ),
    };
    this.context = { ...t, operationId: newId('FINAL') };
    this.actingOnBehalf = false;
    this.feedback.set('');
    this.confirming.set(true);
  }
  cancelConfirm() {
    this.confirming.set(false);
    this.snapshot = null;
    this.context = null;
    this.feedback.set('');
  }
  async confirm() {
    const s = this.snapshot,
      c = this.context;
    if (!s || !c || this.busy()) return;
    if (s.opportunityId !== this.view().opportunityId) {
      this.cancelConfirm();
      this.feedback.set('来源商机已切换，请重新核对摘要');
      return;
    }
    const targetKey = this.targetKey();
    this.busy.set(true);
    try {
      const r = await this.panel.confirmFinalization(
        {
          scheduleRevision: s.scheduleRevision,
          opportunityId: s.opportunityId,
          fourVersionIds: { ...s.fourVersionIds },
          productNeedRevision: s.productNeedRevision,
          ownerPersonId: s.ownerPersonId,
          actingOnBehalf: this.actingOnBehalf,
        },
        c,
      );
      if (this.targetKey() !== targetKey || this.context !== c) {
        this.cancelConfirm();
        this.feedback.set('商机、工作区或轮次已变化，请重新核对当前来源。');
        return;
      }
      if (r.status === 'rejected' || r.status === 'failed') {
        if (r.issue.code === 'revision-mismatch') {
          // 摘要已变化：重新核对当前查询并分配新操作号，不沿用旧确认。
          this.confirming.set(false);
          this.snapshot = null;
          this.context = null;
          this.beginConfirm();
          this.feedback.set('资料、需求或期限责任已变化；摘要已刷新，请再次核对后确认。');
          return;
        }
        this.feedback.set(
          r.status === 'failed' ? `定稿保存失败，确认摘要已保留，可重试：${r.message}` : r.message,
        );
        return;
      }
      this.cancelConfirm();
      this.feedback.set(r.message + '；首次事实、成绩与历史以已提交来源查询为准。');
    } finally {
      this.busy.set(false);
    }
  }
}
