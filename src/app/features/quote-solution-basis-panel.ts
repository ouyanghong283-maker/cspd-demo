import { RouterLink } from '@angular/router';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  DestroyRef,
} from '@angular/core';
import { DemoStore } from '../core/store';
import { SolutionFilesService, checkSolutionFile } from '../core/solution-workflow/files';
import { selectFinalizationSource } from '../core/solution-workflow/finalization';
import {
  selectQuoteSolutionBasis,
  adoptQuoteSolutionBasis,
} from '../core/solution-workflow/quote-basis';
import { newId } from '../core/seed';
import type { FileAvailability, V9OperationContext } from '../core/v9-contracts';
@Component({
  selector: 'app-quote-solution-basis-panel',
  imports: [RouterLink],
  styleUrl: './solution-input-panel.scss',
  template: ` <section class="v9-reading v9-panel" data-v9-theme="light" aria-label="报价方案依据">
    <h3>报价采用的方案</h3>
    <p>草稿可先准备。查看来源不会自动采用，也不会改变报价配置或价格。</p>
    <p>{{ statusLabel() }}</p>
    @if (view().adoptedBasis; as b) {
      <p>
        定稿 {{ b.finalizationId }} · 需求修订 {{ b.productNeedRevision }} · 采用人
        {{ b.operator.name }} · {{ b.adoptedAt }}
      </p>
      <details>
        <summary>已采用四类资料摘要</summary>
        @for (v of b.versionMetadataSnapshot; track v.id) {
          <p>
            {{ v.kind }} V{{ v.number }} · {{ v.fileName }} · {{ v.size }}字节 · {{ v.uploadedAt }}
          </p>
        }
      </details>
    }
    @if (view().fileIssues?.length) {
      <section aria-label="当前方案文件异常">
        <h4>当前文件核验</h4>
        @for (issue of view().fileIssues; track $index) {
          <p>{{ issue.message }}</p>
        }
        <p>
          文件缺失或不可读时，不能新定稿或新采用。已采用报价仍按版本与需求身份复核；上传和首次历史保留。
        </p>
      </section>
    }
    @if (view().submitIssues.length) {
      <section aria-label="方案依据推进检查">
        <h4>方案依据待确认</h4>
        @for (issue of view().submitIssues; track $index) {
          <p>{{ issue.message }}</p>
        }
        <a [routerLink]="['/sales/solutions', opportunityId()]">前往方案核对当前定稿</a>
        <p>审核中可退回补充；已发报价请创建新版。原金额与已采用摘要保留。</p>
      </section>
    }
    @if (editable()) {
      @if (dirty()) {
        <p>请先保存当前报价修改，再核对方案依据。</p>
      }
      <button
        class="btn"
        [disabled]="dirty() || !store.editingWritable() || busy()"
        (click)="prepare()"
      >
        核对当前有效定稿
      </button>
      @if (prepared(); as p) {
        <p>拟采用定稿 {{ p.finalizationId }}</p>
        <p>需求修订 {{ p.productNeedRevision }}</p>
        @for (v of p.versions; track v.id) {
          <p>{{ v.kind }} V{{ v.number }} · {{ v.fileName }} · {{ v.size }}字节</p>
        }
        <button
          class="btn"
          [disabled]="busy() || dirty() || !store.editingWritable()"
          (click)="adopt()"
        >
          确认采用此方案
        </button>
      }
    }
    <p role="status">{{ feedback() }}</p>
  </section>`,
})
export class QuoteSolutionBasisPanel {
  readonly store = inject(DemoStore);
  readonly files = inject(SolutionFilesService);
  readonly quoteVersionId = input.required<string>();
  readonly dirty = input(false);
  readonly editable = input(false);
  readonly availability = signal<Record<string, FileAvailability>>({});
  readonly feedback = signal('');
  readonly busy = signal(false);
  readonly view = computed(() =>
    selectQuoteSolutionBasis(
      this.store.state(),
      this.quoteVersionId(),
      this.availability(),
      this.store.v9CommandTarget(),
    ),
  );
  readonly prepared = signal<{
    quoteVersionId: string;
    quoteRevision: number;
    finalizationId: string;
    productNeedRevision: string;
    versions: import('../core/v9-contracts').SolutionOutputVersion[];
    context: V9OperationContext;
  } | null>(null);
  constructor() {
    effect(() => {
      this.quoteVersionId();
      this.store.state();
      untracked(() => void this.check());
    });
    const check = () => void this.check();
    window.addEventListener('focus', check);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('focus', check));
  }
  statusLabel() {
    return {
      historical: '历史报价依据只读',
      current: '已采用当前组合',
      stale: '已采用的组合已过期，须重新核对',
      'not-adopted': '尚未采用方案',
    }[this.view().status];
  }
  opportunityId() {
    return (
      this.store
        .state()
        .quoteSeries?.find((s) => s.versions.some((v) => v.id === this.quoteVersionId()))
        ?.opportunityId ?? ''
    );
  }
  async check() {
    const id = this.quoteVersionId();
    const source = selectFinalizationSource(this.store.state(), this.opportunityId(), {});
    const revision = this.store.state().dataVersion;
    const vs = source.versions.filter((v) => v !== null);
    this.availability.set(Object.fromEntries(vs.map((v) => [v.id, 'checking'])));
    const values = Object.fromEntries(
      await Promise.all(
        vs.map(async (v) => [v.id, await checkSolutionFile(this.files, v)] as const),
      ),
    );
    if (id === this.quoteVersionId() && revision === this.store.state().dataVersion)
      this.availability.set(values);
  }
  async prepare() {
    this.prepared.set(null);
    this.busy.set(true);
    try {
      await this.check();
      const source = selectFinalizationSource(
        this.store.state(),
        this.opportunityId(),
        this.availability(),
        this.store.v9CommandTarget(),
      );
      const t = this.store.v9CommandTarget();
      if (!source.current || source.issues.length || !t) {
        this.feedback.set(source.issues.map((i) => i.message).join('；') || '请先完成当前方案定稿');
        return;
      }
      this.prepared.set({
        quoteVersionId: this.quoteVersionId(),
        quoteRevision: this.store.quoteVersion(this.quoteVersionId())?.contentRevision ?? 0,
        finalizationId: source.current.id,
        productNeedRevision: source.current.productNeedRevision,
        versions: source.current.versionMetadataSnapshot,
        context: { ...t, operationId: newId('ADOPT') },
      });
      this.feedback.set('请核对四类资料后明确采用');
    } finally {
      this.busy.set(false);
    }
  }
  async adopt() {
    const p = this.prepared();
    if (!p || this.dirty() || p.quoteVersionId !== this.quoteVersionId()) {
      this.feedback.set('报价已切换或有未保存修改，请重新核对');
      return;
    }
    this.busy.set(true);
    try {
      const r = await adoptQuoteSolutionBasis(
        this.store,
        {
          quoteVersionId: p.quoteVersionId,
          quoteRevision: p.quoteRevision,
          finalizationId: p.finalizationId,
        },
        p.context,
        this.files,
      );
      this.feedback.set(r.message);
      if (r.status === 'committed' || r.status === 'unchanged') this.prepared.set(null);
    } finally {
      this.busy.set(false);
    }
  }
}
