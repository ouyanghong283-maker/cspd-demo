import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { CONTRACT_ORIGINAL_ACCEPT, contractOriginalPreviewKind } from '../core/contract-originals';
import { Contract } from '../core/models';
import { newId } from '../core/seed';
import { DemoStore } from '../core/store';
import { Badge } from '../shared/badge';

@Component({
  selector: 'app-contract-original-file',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="original-file" aria-label="合同真实原件">
      <div class="section-heading">
        <div>
          <h3>合同真实原件</h3>
          <p>真实字节只保存在本浏览器原件库；业务 JSON 导出与浏览器备份均不包含原件内容。</p>
        </div>
        <app-badge [text]="current() ? '已登记原件' : '无真实原件'" />
      </div>
      @if (current(); as version) {
        <div class="file-row">
          <div class="grow">
            <strong>{{ version.fileName }}</strong>
            <p>
              V{{ version.version }} · {{ version.mimeType }} · {{ formatSize(version.size) }} ·
              上传人 {{ version.uploadedBy }}（{{ version.uploadedByPersonId || '身份未绑定' }}） ·
              上传时间 {{ version.uploadedAt }}
            </p>
          </div>
          @if (previewable(version.mimeType)) {
            <button class="btn small" type="button" (click)="preview(version.id)">受限预览</button>
          }
          <button class="btn small" type="button" (click)="download(version.id)">下载原件</button>
        </div>
        @if (previewUrl(); as url) {
          <div class="preview-box">
            @if (previewKind() === 'pdf') {
              <iframe [src]="previewSafeUrl()" title="合同原件受限预览"></iframe>
            } @else {
              <img [src]="url" alt="合同原件受限预览" />
            }
            <button class="btn small" type="button" (click)="closePreview()">关闭预览</button>
          </div>
        }
      } @else {
        <p>本合同尚无真实原件；上传 V1 后，刷新页面仍可预览或下载同一文件。</p>
      }
      <input
        hidden
        type="file"
        [attr.accept]="accept"
        #fileInput
        (change)="onFileSelected(fileInput)"
      />
      <button
        class="btn"
        type="button"
        [disabled]="uploading() || !store.editingWritable()"
        (click)="pick(fileInput)"
      >
        {{ uploading() ? '原件保存中…' : current() ? '替换合同原件' : '上传合同真实原件（V1）' }}
      </button>
      @if (!store.editingWritable()) {
        <small class="muted">当前标签页为只读查看；接管修改权后可上传或替换原件。</small>
      }
      @if (versions().length > 1) {
        <h4>原件版本历史（最新在前）</h4>
        @for (version of versions(); track version.id) {
          <div class="file-row">
            <div class="grow">
              <strong>V{{ version.version }} · {{ version.fileName }}</strong>
              <p>
                {{ version.id === current()?.id ? '当前有效' : '历史版本' }} ·
                {{ formatSize(version.size) }} · 上传人 {{ version.uploadedBy }} · 上传时间
                {{ version.uploadedAt }}
              </p>
            </div>
            <button class="btn small" type="button" (click)="download(version.id)">
              下载 V{{ version.version }}
            </button>
          </div>
        }
        <p class="muted">
          替换只新增文件版本；合同业务版本、签约及 G4
          结果仍按业务规则办理。已确认资料保留原依据，来源变化需重新复核。
        </p>
      }
      @if (legacyAttachments().length) {
        <h4>旧模拟附件记录</h4>
        @for (a of legacyAttachments(); track a.id) {
          <div class="file-row">
            <div class="grow">
              <button class="text-link" type="button" (click)="store.openFile(a)">
                {{ a.name }}
              </button>
              <p>
                {{ a.kind }} · {{ a.operator }} · {{ a.date }} ·
                {{ a.mode === 'simulated' ? '模拟记录' : '旧记录' }} · 无原件
              </p>
            </div>
          </div>
        }
      }
      @if (pendingCleanups().length) {
        <p class="warn">
          有
          {{ pendingCleanups().length }}
          个原件恢复或清理未完成，已标记为待处理；不影响已登记原件。
        </p>
      }
      @if (store.originalRecoveryMessage()) {
        <p class="warn">{{ store.originalRecoveryMessage() }}</p>
      }
      @if (store.originalRecoveryMessage() || pendingCleanups().length) {
        <button class="btn" type="button" [disabled]="!store.editingWritable()" (click)="store.recoverContractFiles()">重试原件恢复</button>
      }
      <p class="fine-print">
        接受 PDF、DOC/DOCX、PNG/JPG/JPEG、XLS/XLSX，单个文件不超过 20MiB
        且不能为空；取消选择不会产生记录。 PDF 与图片仅在本页内嵌受限预览，Office
        文件仅提供下载；绝不渲染 HTML/SVG，也不执行文件内容。 业务 JSON
        导出与浏览器备份不包含原件字节；清除浏览器数据会丢失原件。
      </p>
    </section>
  `,
  styles: `
    .original-file {
      margin: 20px 0;
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .section-heading {
      display: flex;
      justify-content: space-between;
      gap: 20px;
    }
    .section-heading p,
    .fine-print,
    .muted,
    .file-row p {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.7;
    }
    .file-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }
    .file-row .grow {
      min-width: 0;
      flex: 1;
    }
    .file-row strong,
    .file-row .text-link {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .preview-box {
      margin: 12px 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .preview-box iframe {
      width: 100%;
      height: 480px;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: white;
    }
    .preview-box img {
      max-width: 100%;
      max-height: 480px;
      align-self: flex-start;
      border: 1px solid var(--line);
      border-radius: 4px;
    }
    .preview-box .btn {
      align-self: flex-start;
    }
    .warn {
      color: #9a3412;
      font-size: 12px;
    }
    h4 {
      margin: 18px 0 6px;
    }
  `,
})
export class ContractOriginalFile {
  readonly store = inject(DemoStore);
  private readonly sanitizer = inject(DomSanitizer);
  readonly contract = input.required<Contract>();
  readonly accept = CONTRACT_ORIGINAL_ACCEPT;
  readonly current = computed(() => this.store.contractFileVersion(this.contract().id));
  readonly versions = computed(() => this.store.contractFileHistory(this.contract().id));
  readonly legacyAttachments = computed(() =>
    this.store.contractLegacyAttachments(this.contract().id),
  );
  readonly pendingCleanups = computed(() => this.store.pendingOriginalCleanups());
  readonly uploading = signal(false);
  readonly previewUrl = signal<string | null>(null);
  readonly previewKind = signal<'pdf' | 'image' | null>(null);
  readonly previewSafeUrl = computed(() => {
    const url = this.previewUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });
  private expectedDataVersion = 1;
  /** 每次选择文件生成一个上传请求标识；同一请求重试不重复登记版本。 */
  private operationId = newId('OP-CFO');
  previewable(mimeType: string): boolean {
    return contractOriginalPreviewKind(mimeType) !== 'download';
  }
  formatSize(size: number): string {
    return size >= 1024 * 1024
      ? `${(size / 1024 / 1024).toFixed(1)} MiB`
      : `${Math.max(1, Math.round(size / 1024))} KB`;
  }
  pick(input: HTMLInputElement): void {
    if (this.uploading()) return;
    this.expectedDataVersion = this.store.state().dataVersion || 1;
    this.operationId = newId('OP-CFO');
    input.click();
  }
  async onFileSelected(input: HTMLInputElement): Promise<void> {
    if (this.uploading()) return;
    const file = input.files?.[0];
    input.value = '';
    // 取消选择不产生任何记录
    if (!file) return;
    this.uploading.set(true);
    try {
      const saved = await this.store.replaceContractFile(this.contract().id, file, {
        operationId: this.operationId,
        expectedDataVersion: this.expectedDataVersion,
      });
      if (saved) this.closePreview();
    } catch (error) {
      this.store.ui.fail(
        `原件上传未完成：${error instanceof Error ? error.message : '未知错误'}；当前附件没有变化`,
      );
    } finally {
      this.uploading.set(false);
    }
  }
  /** 受限预览只接受 PDF 与图片；返回的字节一律带登记时归一化的类型。 */
  async preview(versionId: string): Promise<void> {
    const result = await this.store.readContractOriginal(versionId);
    if (!result.ok) {
      this.store.ui.fail(result.error);
      return;
    }
    const kind = contractOriginalPreviewKind(result.version.mimeType);
    if (kind === 'download') {
      this.store.ui.fail(`「${result.version.fileName}」不支持页内预览，请下载后打开`);
      return;
    }
    this.closePreview();
    const url = URL.createObjectURL(result.blob);
    this.previewUrl.set(url);
    this.previewKind.set(kind);
  }
  closePreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null);
    this.previewKind.set(null);
  }
  async download(versionId: string): Promise<void> {
    const result = await this.store.readContractOriginal(versionId);
    if (!result.ok) {
      this.store.ui.fail(result.error);
      return;
    }
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.version.fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.store.ui.notify(`已下载原件「${result.version.fileName}」`);
  }
  ngOnDestroy(): void {
    this.closePreview();
  }
}
