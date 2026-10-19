import { isClosed } from '../core/rules';
import { formatSolutionTime } from '../core/solution-workflow/presentation';
import { SolutionOutputUpload } from './solution-output-upload';
import { recoverReplacedSolutionFiles } from '../core/solution-workflow/reclaim';
import { finalizeSolution } from '../core/solution-workflow/finalization';
import { SolutionFinalizationSummary } from './solution-finalization-summary';
import { selectFinalizationSource } from '../core/solution-workflow/finalization';
import { PROJECT_MANAGERS } from '../core/personnel';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  DestroyRef,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DemoStore } from '../core/store';
import { SolutionFilesService, checkSolutionFile } from '../core/solution-workflow/files';
import { uploadSolutionOutput, SOLUTION_OUTPUT_FORMATS } from '../core/solution-workflow/upload';
import { SolutionClock } from '../core/solution-workflow/clock';
import {
  setSolutionSchedule,
  changeSolutionDeadline,
  selectSolutionSchedule,
  SOLUTION_PEOPLE,
} from '../core/solution-workflow/schedule';
import { selectSolutionWorkspace } from '../core/v9-queries';
import { SOLUTION_OUTPUT_KINDS } from '../core/v9-contracts';
import type {
  FileAvailability,
  SolutionOutputKind,
  V9OperationContext,
} from '../core/v9-contracts';
import { newId } from '../core/seed';
@Component({
  selector: 'app-solution-input-panel',
  imports: [FormsModule, SolutionFinalizationSummary, SolutionOutputUpload],
  templateUrl: './solution-input-panel.html',
  styleUrl: './solution-input-panel.scss',
})
export class SolutionInputPanel {
  readonly store = inject(DemoStore);
  readonly files = inject(SolutionFilesService);
  readonly clock = inject(SolutionClock);
  readonly opportunityId = input.required<string>();
  readonly kinds = SOLUTION_OUTPUT_KINDS;
  readonly people = SOLUTION_PEOPLE;
  readonly pms = SOLUTION_PEOPLE.filter((p) => PROJECT_MANAGERS.includes(p.name));
  readonly availability = signal<Record<string, FileAvailability>>({});
  readonly busy = signal<SolutionOutputKind | null>(null);
  readonly feedback = signal('');
  readonly view = computed(() =>
    selectSolutionWorkspace(this.store.state(), this.opportunityId(), this.availability()),
  );
  readonly finalization = computed(() =>
    selectFinalizationSource(
      this.store.state(),
      this.opportunityId(),
      this.availability(),
      this.store.v9CommandTarget(),
    ),
  );
  readonly schedule = computed(() =>
    selectSolutionSchedule(this.store.state(), this.opportunityId(), this.clock.dates()),
  );
  readonly writable = computed(
    () =>
      this.store.editingWritable() &&
      !!this.store.sale(this.opportunityId()) &&
      !isClosed(this.store.sale(this.opportunityId())!),
  );
  readonly editingSchedule = signal(false);
  readonly businessTime = formatSolutionTime;
  selected: Partial<Record<SolutionOutputKind, File>> = {};
  private requests: Partial<
    Record<SolutionOutputKind, { context: V9OperationContext; opportunityId: string }>
  > = {};
  note = '';
  pm = '';
  owner = '';
  deadline = '';
  reason = '';
  editRevision = 0;
  private editContext: V9OperationContext | null = null;
  private editOpportunityId: string | null = null;
  constructor() {
    let previous = '';
    effect(() => {
      const t = this.store.v9CommandTarget();
      const key = JSON.stringify([t?.workspaceId, t?.roundId, this.opportunityId()]);
      if (previous && previous !== key) {
        this.cancelSchedule();
        this.selected = {};
        this.requests = {};
        this.note = '';
        this.feedback.set('');
      }
      previous = key;
    });
    effect(() => {
      this.store.state();
      this.opportunityId();
      untracked(() => void this.check());
    });
    const visible = () => {
      if (document.visibilityState === 'visible') void this.check();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
    });
  }
  label(k: SolutionOutputKind) {
    return { proposal: '技术方案', bom: '设计BOM', sld: 'SLD', degradation: '衰减资料' }[k];
  }
  history(k: SolutionOutputKind) {
    return (
      this.view()
        .workspace?.versions.filter((v) => v.kind === k && v.id !== this.current(k)?.id)
        .slice()
        .reverse() ?? []
    );
  }
  finalizedVersion(id: string) {
    return this.finalization().events.some((e) => Object.values(e.fourVersionIds).includes(id));
  }
  accept(k: SolutionOutputKind) {
    return SOLUTION_OUTPUT_FORMATS[k].map((ext) => '.' + ext).join(',');
  }
  status(s: string) {
    return (
      (
        {
          checking: '正在核验',
          present: '文件可用',
          missing: '缺少文件，请上传新版',
          unavailable: '暂不可读取，请重新核验',
        } as Record<string, string>
      )[s] ?? s
    );
  }
  current(k: SolutionOutputKind) {
    const w = this.view().workspace;
    return w?.versions.find((v) => v.id === w.currentOutputs[k]);
  }
  async check() {
    const w = this.view().workspace;
    const id = this.opportunityId();
    const targetKey = JSON.stringify(this.store.v9CommandTarget());
    const versions = w?.versions.filter((v) => v.file && v.contentState === 'current') ?? [];
    // 不读取availability信号，避免核验自身触发effect循环。
    const initial: Record<string, FileAvailability> = {};
    for (const v of versions) initial[v.id] = 'checking';
    this.availability.set(initial);
    const result = await Promise.all(
      versions.map(async (v) => [v.id, await checkSolutionFile(this.files, v)] as const),
    );
    if (
      this.opportunityId() === id &&
      targetKey === JSON.stringify(this.store.v9CommandTarget()) &&
      this.view().workspace?.revision === w?.revision
    )
      this.availability.set(Object.fromEntries(result));
  }
  choose(k: SolutionOutputKind, event: Event) {
    const f = (event.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.selected[k] = f;
    const t = this.store.v9CommandTarget();
    this.requests[k] = t
      ? { context: { ...t, operationId: newId('UPLOAD') }, opportunityId: this.opportunityId() }
      : undefined;
    this.feedback.set('已选择文件，尚未保存');
    (event.target as HTMLInputElement).value = '';
  }
  async upload(k: SolutionOutputKind) {
    const file = this.selected[k],
      request = this.requests[k];
    if (!file || !request || this.busy()) return;
    if (request.opportunityId !== this.opportunityId()) {
      this.feedback.set('来源商机已切换，请为当前商机重新选择文件');
      return;
    }
    const context = request.context;
    this.busy.set(k);
    try {
      const r = await uploadSolutionOutput(
        this.store,
        { opportunityId: this.opportunityId(), kind: k, file, note: this.note },
        context,
        this.files,
      );
      this.feedback.set(r.message);
      if (r.status === 'committed' || r.status === 'unchanged') {
        delete this.selected[k];
        delete this.requests[k];
        await this.check();
      }
    } finally {
      this.busy.set(null);
    }
  }
  /** K12绑定恢复按钮；不登记新版本、不更新历史。 */
  recoverReplacedFiles(context: V9OperationContext) {
    return recoverReplacedSolutionFiles(this.store, context, this.files);
  }
  /** 供K15确认控件绑定；命令自行核对摘要、文件、权限与保存结果。 */
  confirmFinalization(
    input: import('../core/v9-contracts').V9SolutionCommandInputs['finalizeSolution'],
    context: V9OperationContext,
  ) {
    return finalizeSolution(this.store, input, context, this.files);
  }
  cancelSchedule() {
    this.editingSchedule.set(false);
    this.editContext = null;
    this.editOpportunityId = null;
    this.pm = this.owner = this.deadline = this.reason = '';
    this.editRevision = 0;
  }
  beginEdit() {
    if (!this.writable() || this.schedule().frozen) return;
    this.editingSchedule.set(true);
    this.editOpportunityId = this.opportunityId();
    const s = this.schedule().schedule;
    this.pm = s?.pm.personId ?? '';
    this.owner = s?.owner.personId ?? '';
    this.deadline = s?.deadlineDate ?? '';
    this.editRevision = s?.revision ?? 0;
    this.reason = '';
    const t = this.store.v9CommandTarget();
    this.editContext = t ? { ...t, operationId: newId('SCHEDULE') } : null;
  }
  saveSchedule() {
    if (this.editOpportunityId !== this.opportunityId()) {
      this.feedback.set('来源商机已切换，请重新打开期限编辑');
      return;
    }
    if (!this.editContext) {
      this.feedback.set('请先选择设置或调整期限');
      return;
    }
    const r = this.editRevision
      ? changeSolutionDeadline(
          this.store,
          {
            opportunityId: this.opportunityId(),
            deadlineDate: this.deadline,
            reason: this.reason,
            scheduleRevision: this.editRevision,
          },
          this.editContext,
        )
      : setSolutionSchedule(
          this.store,
          {
            opportunityId: this.opportunityId(),
            pmPersonId: this.pm,
            ownerPersonId: this.owner,
            deadlineDate: this.deadline,
            note: this.reason,
          },
          this.editContext,
        );
    this.feedback.set(r.message);
    if (r.status === 'committed' || r.status === 'unchanged') this.cancelSchedule();
  }
}
