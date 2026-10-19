import { Component, effect, inject, signal } from '@angular/core';
import { SolutionInputPanel } from './solution-input-panel';
import { newId } from '../core/seed';
import type { SolutionOutputKind } from '../core/v9-contracts';
/**
 * K12数据绑定：缺件/暂不可读专属恢复提示、重传说明与回收恢复重试回调。
 * 只绑定父页公开查询与recoverReplacedFiles回调；不操作IndexedDB、不推断归属、
 * 不用重新上传代替回收；恢复候选由模块从已提交收据读取。
 */
@Component({
  selector: 'app-solution-output-upload',
  styleUrl: './solution-input-panel.scss',
  template: ` <section class="v9-reading" aria-label="缺件恢复与重传">
    <h4>缺件恢复与重传</h4>
    @for (f of panel.view().files; track f.kind) {
      @if (f.availability === 'missing') {
        <p>
          {{ kindLabel(f.kind) }}：{{
            missingLabel(f.kind)
          }}。请重新选择文件并保存新版；不会回填旧上传时间，历史真实上传与定稿记录保留。
        </p>
      }
      @if (f.availability === 'unavailable') {
        <p>
          {{ kindLabel(f.kind) }}
          ：文件暂不可读取。请先“重新核验文件”；仍不可读时保存新版，历史记录保留。
        </p>
      }
    }
    <p>旧文件释放失败不影响已保存的资料；可重试释放，重试不新增版本、不写历史。</p>
    <button
      class="btn"
      [disabled]="!panel.writable() || !!panel.busy() || busy()"
      (click)="retryRecovery()"
    >
      {{ busy() ? '正在重试恢复…' : '重试释放旧文件' }}
    </button>
    @if (last(); as r) {
      <p role="status" aria-live="polite">
        本次释放 {{ r.removed.length }} 项、保留 {{ r.retained.length }} 项{{
          r.recoveryNeeded
            ? '；仍有待恢复内容，可再次重试'
            : r.retained.length
              ? '；保留项未强制清理'
              : '；恢复检查完成'
        }}
      </p>
    } @else {
      <p role="status" aria-live="polite">{{ feedback() }}</p>
    }
  </section>`,
})
export class SolutionOutputUpload {
  readonly panel = inject(SolutionInputPanel);
  readonly busy = signal(false);
  readonly feedback = signal('');
  readonly last = signal<{ removed: string[]; retained: string[]; recoveryNeeded: boolean } | null>(
    null,
  );
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
  missingLabel(kind: SolutionOutputKind) {
    const current = this.panel.current(kind);
    return !current
      ? '尚未上传当前文件'
      : !current.file
        ? '仅有元数据，真实文件待补'
        : '文件已证实缺失';
  }
  constructor() {
    let previous: string | undefined;
    effect(() => {
      const current = this.targetKey();
      if (previous !== undefined && current !== previous) {
        this.last.set(null);
        this.feedback.set('');
      }
      previous = current;
    });
  }
  private targetKey() {
    const t = this.panel.store.v9CommandTarget();
    return JSON.stringify([t?.workspaceId, t?.roundId, this.panel.opportunityId()]);
  }
  async retryRecovery() {
    if (this.busy() || this.panel.busy()) return;
    this.last.set(null);
    this.feedback.set('');
    if (!this.panel.store.v9CanEdit()) {
      this.feedback.set('当前没有修改资格，仅可查看，请取得修改权后重试');
      return;
    }
    const t = this.panel.store.v9CommandTarget();
    if (!t) {
      this.feedback.set('当前没有活动工作区，无法重试恢复');
      return;
    }
    const targetKey = this.targetKey();
    this.busy.set(true);
    try {
      const r = await this.panel.recoverReplacedFiles({ ...t, operationId: newId('RECOVER') });
      if (this.targetKey() !== targetKey) {
        this.feedback.set('商机、工作区或轮次已变化，请重新核对后重试');
        return;
      }
      if (!this.panel.store.v9CanEdit()) {
        this.feedback.set('恢复期间修改资格已变化，请取得修改权后重新核对');
        return;
      }
      this.last.set(r);
    } catch {
      this.feedback.set('恢复检查未完成，已保存资料保留，请稍后重试');
    } finally {
      this.busy.set(false);
    }
  }
}
