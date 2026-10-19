import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DemoStore } from '../core/store';
import {
  STARTUP_ACTIONS,
  STARTUP_BRIEFING_DOCUMENT_KINDS,
  STARTUP_DEPARTMENTS,
  StartupActionKey,
  StartupContentInput,
  StartupContentKey,
  StartupContentValues,
  StartupDepartmentKey,
  startupAction,
  startupContentFieldsFor,
  startupDepartmentForRole,
  startupDepartmentLabel,
  startupDepartmentParam,
  startupLocation,
  startupLocationHint,
} from '../core/project-startup';
import { Badge } from '../shared/badge';
import { Documents } from '../shared/documents';

/**
 * 项目区“启动交底”页签内的启动工作区：部门内容查看/保存 + 原显式门禁动作。
 * 规则全部来自 core/project-startup，页面只负责展示与触发，不自己判断前置。
 */
@Component({
  selector: 'app-project-startup-panel',
  imports: [FormsModule, RouterLink, Badge, Documents],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (project(); as project) {
      <section class="panel" aria-label="启动交底部门内容">
        <div class="panel-head">
          <h2>部门启动内容</h2>
          <span class="fine-print">每个字段只有一个维护部门；保存内容不代表完成 G4 或移交</span>
        </div>
        @if (hint()) {
          <p class="inline-alert" id="startup-located-hint">{{ hint() }}</p>
        }
        <nav class="dept-tabs" aria-label="启动交底部门">
          @for (department of departments; track department.key) {
            <button
              [id]="'startup-content-' + department.key"
              [class.active]="activeDepartment() === department.key"
              [attr.aria-current]="activeDepartment() === department.key ? 'true' : null"
              (click)="switchDepartment(department.key)"
            >
              {{ department.label }}
            </button>
          }
        </nav>
        <div class="dept-body">
          <div class="dept-context">
            <div>
              <small>维护部门</small><strong>{{ activeDepartmentLabel() }}</strong>
            </div>
            <div>
              <small>责任动作</small><strong>{{ activeDepartmentActions() }}</strong>
            </div>
            <div>
              <small>团队来源</small><strong>{{ teamSource() }}</strong>
            </div>
            <div>
              <small>来源与客户</small
              ><strong>{{ project.contractId || '待关联合同' }} · {{ customerName() }}</strong>
            </div>
          </div>
          <div class="team-links">
            <a
              [routerLink]="['/projects', project.id]"
              [queryParams]="{ tab: 'overview', section: '团队' }"
              queryParamsHandling="merge"
              [preserveFragment]="true"
              >团队任命入口（沿用既有）</a
            >
            <a
              [routerLink]="['/projects', project.id]"
              [queryParams]="{ tab: 'overview', section: '资料历史' }"
              queryParamsHandling="merge"
              [preserveFragment]="true"
              >启动交底历史</a
            >
          </div>
          @if (contentRows().length) {
            <div class="field-grid">
              @for (row of contentRows(); track row.field.key) {
                <label class="field" [attr.data-field]="row.field.key">
                  <span class="field-label"
                    >{{ row.field.label }}
                    <em>{{
                      row.field.department === activeDepartment() ? '本部门维护' : ''
                    }}</em></span
                  >
                  @if (row.field.type === 'textarea') {
                    <textarea
                      rows="2"
                      [attr.aria-label]="row.field.label"
                      [disabled]="!store.editingWritable()"
                      [ngModel]="row.value"
                      (ngModelChange)="updateValue(row.field.key, $event)"
                    ></textarea>
                  } @else {
                    <input
                      [type]="row.field.type === 'date' ? 'date' : 'text'"
                      [attr.aria-label]="row.field.label"
                      [disabled]="!store.editingWritable()"
                      [ngModel]="row.value"
                      (ngModelChange)="updateValue(row.field.key, $event)"
                    />
                  }
                  @if (row.changed) {
                    <span class="unsaved">未保存：原值 {{ row.saved || '空' }}</span>
                  }
                </label>
              }
            </div>
          } @else {
            <p class="dept-note">
              {{ activeDepartmentLabel() }}不在本页维护启动内容字段；本部门的动作是{{
                activeDepartmentActions()
              }}。
            </p>
          }
          <div class="save-row">
            <button
              class="btn primary"
              [disabled]="!currentDirty() || !store.editingWritable()"
              (click)="saveContent()"
            >
              保存{{ activeDepartmentLabel() }}启动内容
            </button>
            <button class="btn" [disabled]="!currentDirty()" (click)="discardContent()">
              放弃本部门修改
            </button>
            @if (dirty()) {
              <span class="unsaved">有未保存的启动内容，离开本页会先确认</span>
            }
          </div>
        </div>
      </section>

      <section class="panel" aria-label="合同交底与显式门禁">
        <div class="panel-head">
          <h2>合同交底与显式门禁</h2>
          <app-badge
            [text]="
              gate().submissionVersion === null ? '待销售提交' : '交底 V' + gate().submissionVersion
            "
          />
        </div>
        <div class="gate-body">
          @if (gate().confirmationNeedsReview) {
            <div class="inline-alert warning" id="startup-source-review">
              关键来源已变化：{{ gate().changedSources.join('、') || '交底依据' }}。PM 已确认的交底
              V{{ gate().confirmationVersion }}
              依据待复核：按原样保留，未改指新版本；请销售重新提交当前版本后由 PM 重新确认。
            </div>
          }
          <div class="basis">
            <div>
              <small>交底依据（提交时快照）</small><strong>{{ basisText() }}</strong>
            </div>
            <div>
              <small>销售提交</small><strong>{{ submissionText() }}</strong>
            </div>
            <div>
              <small>PM确认</small><strong>{{ confirmationText() }}</strong>
            </div>
            <div>
              <small>G4结果</small><strong>{{ g4Text() }}</strong>
            </div>
            <div>
              <small>启动移交</small><strong>{{ handoverText() }}</strong>
            </div>
          </div>
          @if (project.contractId) {
            <p class="basis-links">
              <a [routerLink]="['/contracts', project.contractId]"
                >查看合同主字段与配置 / 偏离来源（合同页）</a
              >
            </p>
          }
          <div class="action-list">
            @for (action of actions; track action.key) {
              <div
                class="action-row"
                [id]="'startup-action-' + action.key"
                [class.located]="locatedAction() === action.key"
                [attr.aria-current]="locatedAction() === action.key ? 'true' : null"
              >
                <div class="action-text">
                  <h3>{{ action.label }}</h3>
                  <p>
                    <span class="owner">{{ action.responsible }}</span>
                    {{ actionStateText(action.key) }}
                  </p>
                </div>
                <button
                  class="btn"
                  [class.primary]="action.key === 'submit'"
                  [disabled]="actionDisabled(action.key) || !store.editingWritable()"
                  (click)="runAction(action.key)"
                >
                  {{ action.button }}
                </button>
              </div>
            }
          </div>
          <p class="fine-print">
            打开页签、保存启动内容或上传会议资料都不会完成 G4
            或移交；只有上面的显式动作会推进门禁状态。 普通保存失败时不写成功历史与进度。
          </p>
          <p class="fine-print">交底资料检查：{{ missingText() }}</p>
        </div>
        <app-documents [entityId]="project.id" [kinds]="documentKinds" title="启动交底资料" />
        <p class="fine-print doc-note">
          交底包与启动会议资料可反复补充；上传附件本身不代表 PM 确认、G4
          通过或移交完成，也不写入交底版本。
        </p>
      </section>
    } @else {
      <section class="panel" aria-label="启动交底部门内容">
        <p class="dept-note">找不到项目，无法展示启动交底内容。</p>
      </section>
    }
  `,
  styles: `
    .dept-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 16px 23px 0;
    }
    .dept-tabs button {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 6px;
      font-size: 12px;
      color: #8493aa;
      padding: 8px 14px;
    }
    .dept-tabs button.active {
      background: #edf2ff;
      border-color: #c7d6ff;
      color: var(--primary);
    }
    .dept-body,
    .gate-body {
      padding: 16px 23px 22px;
      font-size: 12px;
      line-height: 1.8;
    }
    .dept-context,
    .basis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .dept-context small,
    .basis small {
      display: block;
      color: #8997ad;
      font-size: 11px;
    }
    .dept-context strong,
    .basis strong {
      font-weight: 500;
      word-break: break-word;
    }
    .team-links {
      display: flex;
      gap: 16px;
      margin-bottom: 14px;
    }
    .team-links a {
      color: var(--primary, #355dc8);
    }
    .basis-links {
      margin: 0 0 14px;
    }
    .basis-links a {
      color: var(--primary, #355dc8);
    }
    .field-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .field-label {
      color: #667996;
      font-size: 11px;
    }
    .field input,
    .field textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 5px;
      padding: 8px;
      font-family: inherit;
      font-size: 12px;
      color: inherit;
      background: #fff;
    }
    .unsaved {
      color: #9a5a12;
      font-size: 11px;
    }
    .dept-note {
      margin: 0 0 12px;
      color: #667996;
    }
    .save-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 18px;
      flex-wrap: wrap;
    }
    .action-list {
      border-top: 1px solid var(--line);
    }
    .action-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 14px 0;
      border-bottom: 1px solid var(--line);
    }
    .action-row.located {
      background: #f5f8ff;
      box-shadow: inset 3px 0 0 var(--primary, #355dc8);
    }
    .action-text h3 {
      font-size: 13px;
      margin: 0 0 4px;
    }
    .action-text p {
      margin: 0;
      color: #667996;
    }
    .owner {
      display: inline-block;
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 1px 6px;
      margin-right: 6px;
      font-size: 11px;
      color: #45577a;
    }
    .gate-body .inline-alert {
      margin-bottom: 14px;
    }
    .doc-note {
      padding: 0 24px 22px;
    }
    @media (max-width: 700px) {
      .action-row {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  `,
})
export class ProjectStartupPanel implements OnDestroy {
  readonly store = inject(DemoStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly projectId = input.required<string>();
  readonly departments = STARTUP_DEPARTMENTS;
  readonly actions = STARTUP_ACTIONS;
  /** 与提交快照共用同一组资料类目，避免页面上无法补交快照会收纳的资料。 */
  readonly documentKinds = STARTUP_BRIEFING_DOCUMENT_KINDS;
  readonly project = computed(() => this.store.project(this.projectId()));
  readonly gate = computed(() => this.store.startupGate(this.projectId()));

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly location = computed(() =>
    startupLocation(this.queryParams().get('dept'), this.queryParams().get('action')),
  );
  readonly hint = computed(() => startupLocationHint(this.location()));
  readonly locatedAction = computed(() => this.location().action);

  /** 页面内可切分组；切换分组不写草稿、不丢输入，未保存时也不改 URL。 */
  private readonly selectedDepartment = signal<StartupDepartmentKey | null>(null);
  readonly activeDepartment = computed(
    () =>
      this.selectedDepartment() ??
      this.location().department ??
      startupDepartmentForRole(this.store.role()),
  );
  readonly activeDepartmentLabel = computed(() => startupDepartmentLabel(this.activeDepartment()));
  readonly activeDepartmentActions = computed(
    () =>
      this.actions
        .filter((action) => action.department === this.activeDepartment())
        .map((action) => action.label)
        .join('、') || '本页无启动门禁动作',
  );
  readonly customerName = computed(() => {
    const project = this.project();
    return project ? this.store.customer(project.customerId)?.name || '客户待确认' : '';
  });
  readonly teamSource = computed(() => {
    const team = this.project()?.team || [];
    return team.length
      ? team.map((member) => `${member.person}（${member.department}）`).join('、')
      : '待任命，沿用既有任命入口';
  });
  readonly missingText = computed(() => {
    const missing = this.store.briefingMissing(this.projectId());
    return missing.length
      ? '还缺' + missing.join('、')
      : '演示提交所需资料已齐备（不等于审批通过）';
  });

  /** 各部门草稿分开保存，切换部门不偷存也不丢弃。 */
  private readonly drafts = signal<
    Partial<Record<StartupDepartmentKey, Partial<Record<StartupContentKey, string>>>>
  >({});

  readonly savedValues = computed<StartupContentValues>(() => {
    const project = this.project();
    return {
      start: project?.start || '',
      site: project?.site || '',
      siteConditions: project?.siteConditions || '',
      acceptance: project?.briefing.acceptance || '',
      production: project?.briefing.production || '',
      shipping: project?.briefing.shipping || '',
      commissioning: project?.briefing.commissioning || '',
    };
  });
  readonly contentRows = computed(() => {
    const saved = this.savedValues();
    const draft = this.drafts()[this.activeDepartment()];
    return startupContentFieldsFor(this.activeDepartment()).map((field) => {
      const value = draft?.[field.key] ?? saved[field.key];
      return {
        field,
        value,
        saved: saved[field.key],
        changed: draft ? value !== saved[field.key] : false,
      };
    });
  });
  readonly dirty = computed(() => STARTUP_DEPARTMENTS.some(({ key }) => this.departmentDirty(key)));
  readonly currentDirty = computed(() => this.departmentDirty(this.activeDepartment()));

  private pendingOwned = false;

  constructor() {
    effect(() => {
      const located = this.location().department;
      if (!located) return;
      this.selectedDepartment.set(located);
    });
    effect(() => {
      const dirty = this.dirty();
      if (dirty && !this.pendingOwned) {
        this.pendingOwned = true;
        this.store.setPendingInlineEdit(true);
      } else if (!dirty && this.pendingOwned) {
        this.pendingOwned = false;
        this.store.setPendingInlineEdit(false);
      }
    });
    effect(() => {
      const anchor = this.location().anchor;
      if (!anchor) return;
      setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: 'center' }));
    });
  }

  ngOnDestroy(): void {
    if (this.pendingOwned) {
      this.pendingOwned = false;
      this.store.setPendingInlineEdit(false);
    }
  }

  private departmentDirty(department: StartupDepartmentKey): boolean {
    const draft = this.drafts()[department];
    if (!draft) return false;
    const saved = this.savedValues();
    return Object.entries(draft).some(
      ([key, value]) => value !== undefined && value !== saved[key as StartupContentKey],
    );
  }

  switchDepartment(department: StartupDepartmentKey): void {
    this.selectedDepartment.set(department);
    // 有未保存输入时只切分组，URL 保持原状以免触发离开确认后丢掉草稿。
    if (this.dirty()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { dept: startupDepartmentParam(department), action: null },
      queryParamsHandling: 'merge',
      preserveFragment: true,
    });
  }

  updateValue(key: StartupContentKey, value: string): void {
    const department = this.activeDepartment();
    this.drafts.update((all) => ({
      ...all,
      [department]: { ...(all[department] || {}), [key]: value ?? '' },
    }));
  }

  saveContent(): void {
    const department = this.activeDepartment();
    const draft = this.drafts()[department];
    if (!draft) {
      this.store.ui.notify('内容没有变化，无需保存');
      return;
    }
    const content: StartupContentInput = {};
    for (const field of startupContentFieldsFor(department)) {
      const value = draft[field.key];
      if (value !== undefined) content[field.key] = value;
    }
    if (!this.store.saveStartupContent(this.projectId(), department, content)) return;
    this.clearDraft(department);
  }

  discardContent(): void {
    this.clearDraft(this.activeDepartment());
  }

  private clearDraft(department: StartupDepartmentKey): void {
    this.drafts.update((all) => {
      const next = { ...all };
      delete next[department];
      return next;
    });
  }

  actionDisabled(key: StartupActionKey): boolean {
    if (key === 'handover' && this.gate().handoverStatus === '已移交') return true;
    return !this.gate().actions[key].allowed;
  }

  actionStateText(key: StartupActionKey): string {
    if (key === 'handover' && this.gate().handoverStatus === '已移交')
      return '启动移交已完成，重复确认不新增记录';
    return this.gate().actions[key].reason || '前置已满足，可执行';
  }

  basisText(): string {
    const submission = this.project()?.briefing.submission;
    if (!submission) return '尚未提交，普通保存与上传不会生成交底版本';
    const snapshot = submission.snapshot;
    const contract = snapshot.contract;
    return [
      `合同 ${snapshot.contractId || '待关联'}`,
      `报价版本 ${snapshot.quoteVersionId || '待核'}`,
      `${contract.currency} ${contract.amount}`,
      `付款 ${contract.payment || '待核'}`,
      `罚则 ${contract.penalty || '待核'}`,
      `产品 ${contract.product || '待核'}`,
      `交底资料 ${snapshot.attachmentIds.length}项`,
    ].join(' · ');
  }

  submissionText(): string {
    const submission = this.project()?.briefing.submission;
    return submission
      ? `V${submission.version} · ${submission.submittedBy} · ${submission.submittedAt} · ${submission.opinion}`
      : '待销售提交';
  }

  confirmationText(): string {
    const project = this.project();
    const confirmation = project?.briefing.confirmation;
    if (!confirmation) return '待PM确认';
    return `V${confirmation.version} · ${confirmation.confirmedBy} · ${confirmation.confirmedAt} · ${confirmation.opinion}`;
  }

  g4Text(): string {
    const g4 = this.project()?.briefing.g4;
    return g4 ? `${g4.result} · ${g4.reviewer} · ${g4.reviewedAt} · ${g4.opinion}` : '待审核';
  }

  handoverText(): string {
    const handover = this.project()?.briefing.startupHandover;
    return handover
      ? `${handover.status} · ${handover.sender} → ${handover.receiver} · 依据交底V${handover.briefingVersion} · ${handover.opinion}`
      : '待移交';
  }

  runAction(key: StartupActionKey): void {
    const project = this.project();
    if (!project) return;
    if (key === 'submit') {
      this.store.ui.open({
        title: startupAction('submit').label,
        description: '提交当前合同、报价及项目启动资料版本；PM仍需显式确认。',
        fields: [
          {
            key: 'opinion',
            label: '特殊承诺、条款差异与遗留事项',
            type: 'textarea',
            required: true,
          },
        ],
        sample: { opinion: '请复核现场交期、验收标准及未结商务承诺。' },
        onSave: (data) => this.store.submitContractBriefing(project.id, data['opinion']),
      });
      return;
    }
    if (key === 'confirm') {
      this.store.ui.open({
        title: startupAction('confirm').label,
        description: '确认人、时间、交底版本和意见分别留存；来源变化后需重新提交。',
        fields: [{ key: 'opinion', label: '确认意见', type: 'textarea', required: true }],
        sample: { opinion: '已核对合同、报价版本、资料和项目团队来源。' },
        onSave: (data) => this.store.confirmContractBriefing(project.id, data['opinion']),
      });
      return;
    }
    if (key === 'g4') {
      this.store.ui.open({
        title: startupAction('g4').label,
        description: '本地模拟记录，不触发真实OA；附条件或退回不产生正式移交。',
        fields: [
          {
            key: 'result',
            label: 'G4结果',
            type: 'select',
            options: ['通过', '附条件通过', '退回'],
            required: true,
          },
          { key: 'opinion', label: '审核意见 / 条件 / 退回原因', type: 'textarea', required: true },
        ],
        sample: { result: '通过', opinion: '已核对交底内容、合同来源和启动资料。' },
        onSave: (data) =>
          this.store.recordProjectG4(
            project.id,
            data['result'] as '通过' | '附条件通过' | '退回',
            data['opinion'],
          ),
      });
      return;
    }
    this.store.ui.open({
      title: startupAction('handover').label,
      description: '仅G4明确通过后可执行；附条件通过和退回不能完成移交。',
      fields: [
        { key: 'receiver', label: '项目团队接收人', required: true, value: project.pm },
        { key: 'opinion', label: '移交意见', type: 'textarea', required: true },
      ],
      sample: { receiver: project.pm, opinion: '已完成销售/方案到项目团队的资料接续。' },
      onSave: (data) =>
        this.store.completeStartupHandover(project.id, data['receiver'], data['opinion']),
    });
  }
}
