import { initializeFinanceSources } from './management-v10/finance-sources';
import { initializeDeliveryRetention, retainDeliveryCommitments, registerDeliveryPlan } from './management-v10/delivery-sources';
import { selectSolutionBusinessRecords, writableSolutionBusinessRecords, selectBusinessConfirmation } from './solution-workflow/business-records';
import { selectQuoteSolutionBasis } from './solution-workflow/quote-basis';
import { prepareV9Workspace, V9_STORAGE_SCHEMA_VERSION } from './solution-migration/workspace';
import { createG1Check } from './lifecycle-progress';
import { withCrmQuoteDemoCatalog } from './crm-quote-demo-catalog';
import { commandInputFingerprint } from './v9-command-input';
import type { V9CommandRequest, V9CommandPlan, V9CommandResult, V9Issue } from './v9-contracts';
import { migrateV8Snapshot, V8_STORAGE_SCHEMA_VERSION } from './v8-migration';
import { backfillProjectWarnings } from './plan-warning-backfill';
import { recoverContractOriginals, retainedOriginalReferences } from './contract-file-recovery';
import { ContractMilestoneInput, contractMilestoneError, makeContractMilestone } from './contract-milestones';
import { ContractFileOperations, contractFileHistory } from './contract-file-history';
import { CRM_QUOTE_DEMO_POLICY } from './crm-quote-demo-policy';
import { CONTRACT_MAIN_FIELDS, ContractMainFieldsInput } from './contract-main-fields';
import { computed, inject, Injectable, signal } from '@angular/core';
import {
  ServiceTerms,
  ServiceAgreement,
  FinalActualCost,
  QuoteGateMissing,
  Activity,
  Attachment,
  BASE_DATE,
  ContractFileVersion,
  ContractMilestone,
  CreditPolicySnapshot,
  Contact,
  Contract,
  ContractQuoteReferenceSnapshot,
  Customer,
  CustomerRole,
  DemoDateMode,
  DemoState,
  FinanceInvoice,
  History,
  HANDOVER_TYPES,
  Issue,
  MilestoneSyncRecord,
  MilestoneWarning,
  Notice,
  Plan,
  Project,
  QuoteFeedback,
  QuoteItem,
  QuoteSeries,
  QuoteVersion,
  Role,
  ROLES,
  SalesRecord,
  STAGES,
  TeamMember,
  ProductNeed,
  PmoAssignment,
  TechnicalAssessment,
  SolutionDocumentKind,
  SolutionDocumentVersion,
  SolutionCosting,
  FiveCanKey,
  FiveCanReview,
  SolutionConfirmation,
  ProjectRiskRecord,
  ProjectCommunicationRecord,
  EquipmentSerialRecord,
  ProjectBriefingSubmission,
  ProjectBriefingConfirmation,
  ProjectG4Review,
  ProjectStartupHandover,
  OpportunityRoughPlan,
  OpportunityRoughPlanTemplate,
  OperationCommitRequest,
  OperationEvent,
  OperationFieldChange,
  PaymentMethodRecord,
  PaymentTermRecord,
} from './models';
import {
  blankPlan,
  blankProject,
  blankSales,
  createSeed,
  makePlans,
  makeTeam,
  newId,
} from './seed';
import {
  acceptanceReady,
  coolingDays,
  DEMO_COMPARISON_DATE,
  isClosed,
  isValidWarningLeadDays,
  needsTenderTeam,
  observationDateForMode,
  planRisk,
  validDateRange,
  weightedAmount,
} from './rules';
import { ProjectBudgetSummary, summarizeProjectBudget, validateBudget } from './budget';
import { UiService } from './ui.service';
import { PLAN_RISK_DEMO_CASES, planRiskDemoDates } from './plan-risk-demo';
import {
  collectPlanWarningNotices,
  currentPlanWarning,
  isSupersededPlanNotice,
  knownDemoPersonId,
  normalizePlanWarningReads,
  knownProjectPersonId,
  planWarningRecipients,
} from './plan-warning';
import { CUSTOMER_COUNTRIES } from './customer-dictionaries';
import { productCatalogItem } from './product-catalog';
import { FilesService } from './files.service';
import { CRM_QUOTE_CATALOG } from './crm-quote-reference';
import { CRM_DETAIL_FIELDS, CRM_SUMMARY_FIELDS, CrmValues } from './crm-quote-schema';
import {
  addCrmDays,
  applyCrmProduct,
  calculateCrmLine,
  crmAggregate,
  crmDraftFields,
  crmLineFields,
  crmNumber,
  crmQuoteErrors,
  CrmCatalog,
  persistCrmFields,
  syncCrmAliases,
} from './crm-quote';
import {
  ContractOriginalBlobStore,
  ContractOriginalRecord,
  ContractOriginalStore,
} from './contract-original-store';
import { contractOriginalError, contractOriginalMimeType } from './contract-originals';
import { migrateV4, financeTemplate, invoiceFacts, syncClosedQuoteNotices } from './v4';
import { DEMO_IDENTITY_BINDINGS, identityForRole } from './identity';
import {
  appendPlanWarningRead,
  isPlanWarningRead,
  planWarningPersonKey,
  planWarningId,
  collectPlanWarnings,
} from './plan-warnings';
import {
  completionKind,
  PROJECT_REVIEW_LABELS,
  setProjectReview,
  syncProjectCompletion,
} from './project-review';
import { EditingLease } from './editing-lease';
import {
  STARTUP_BRIEFING_DOCUMENT_KINDS,
  StartupContentInput,
  StartupContentKey,
  startupContentError,
  startupContentFieldsFor,
  startupContentLabel,
  StartupContentValues,
  startupDepartmentLabel,
  startupDepartmentOwner,
  StartupDepartmentKey,
  StartupGateInput,
  StartupGateState,
  StartupSourceSnapshot,
  changedStartupSources,
  startupGateActions,
  startupSourceContentChanged,
  startupSourceMatches,
} from './project-startup';
import { quoteExtensionFieldError } from './field-metadata';
import { WorkspaceStorage, WorkspaceStorageError } from './workspace-storage';
import {
  ContractInvoice,
  InvoiceReceiptClaim,
  calculateInvoiceBalance,
  invoiceAmount,
  invoiceCents,
  invoiceDueFacts,
  migrateContractInvoices,
} from './invoices';
import { SalesOrder, SalesOrderLine } from './orders';
import {
  BankReceiptClaim,
  BankReceiptClaimLine,
  summarizeRemittance,
  toInvoiceReceiptClaims,
} from './remittances';
import {
  ContractQuoteReferenceView,
  QuoteReferenceLookup,
  blankQuoteFields,
  contractQuoteReferenceView,
  quoteReferenceCandidates as resolveQuoteReferenceCandidates,
} from './quote-reference';
const KEY = 'cspd-demo-v2';
const PENDING_ORIGINAL_CLEANUP_KEY = `${KEY}:contract-originals-pending-cleanup`;
const EDITING_LEASE_KEY = `${KEY}:editing-lease`;
type StoredWorkspace = WorkspaceStorage<DemoState>;
function isDemoState(value: unknown): value is DemoState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<DemoState>;
  return (
    state.version === 2 &&
    [
      'projects',
      'sales',
      'customers',
      'contracts',
      'activities',
      'attachments',
      'notices',
      'history',
    ].every((key) => Array.isArray(state[key as keyof DemoState]))
  );
}
function validISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function productNeedLabel(need: ProductNeed): string {
  return need.name ? `${need.name}（${need.model}）` : need.model;
}
function operationFieldChanges(before: object, after: object): OperationFieldChange[] {
  const ignored = new Set(['lastEditor', 'lastEditorPersonId']);
  return Object.entries(after).flatMap(([field, afterValue]) => {
    if (ignored.has(field)) return [];
    const beforeValue = (before as Record<string, unknown>)[field];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) return [];
    const value = afterValue === undefined ? null : afterValue;
    let valueType: OperationFieldChange['valueType'];
    if (value === null) valueType = 'null';
    else if (Array.isArray(value)) valueType = 'array';
    else if (typeof value === 'string') valueType = 'string';
    else if (typeof value === 'number') valueType = 'number';
    else if (typeof value === 'boolean') valueType = 'boolean';
    else valueType = 'object';
    return [{ field, valueType, before: beforeValue ?? null, after: value }];
  });
}
interface PendingOriginalCleanup {
  blobId: string;
  contractId: string;
  markedAt: string;
  /** 仅成功重置产生：允许该新轮重试指定旧轮的定向清理。 */
  resetAuthorization?: {
    fromWorkspaceId: string;
    fromRoundId: string;
    targetWorkspaceId: string;
    targetRoundId: string;
  };
}
@Injectable({ providedIn: 'root' })
export class DemoStore {
  readonly ui = inject(UiService);
  private readonly files = inject(FilesService);
  readonly state = signal<DemoState>(createSeed());
  readonly editingWritable = signal(true);
  readonly pendingInlineEdit = signal(false);
  private readonly editingPageId = newId('TAB');
  private editingLease?: EditingLease;
  private editingLeaseTimer?: ReturnType<typeof setInterval>;
  private workspaceStorage?: StoredWorkspace;
  private activeSnapshotKey = KEY;
  private activeWorkspaceId?: string;
  private storageInitializationFailed = false;
  private readonly contractOriginals: ContractOriginalBlobStore = inject(ContractOriginalStore);
  /** 不能完成转正或定向回收的原件；启动/接管/续接时重新核实引用。 */
  readonly pendingOriginalCleanups = signal<PendingOriginalCleanup[]>(
    this.readPendingOriginalCleanups(),
  );
  readonly workspaceRecoveryMessage = signal('');
  readonly v8MigrationMessage = signal('');
  readonly originalRecoveryMessage = signal('');
  private originalRecoveryRunning = false;
  private originalRecoveryRequest?: Promise<void>;
  private originalUploads = 0;
  private readonly originalUploadsInFlight = new Set<string>();
  readonly role = computed(() => this.state().role);
  readonly person = computed(() => ROLES.find((x) => x.id === this.role())?.person || '访客');
  readonly roleInfo = computed(() => ROLES.find((x) => x.id === this.role())!);
  readonly dateMode = computed(() => this.state().dateMode || 'normal');
  readonly observationDate = computed(() => observationDateForMode(this.dateMode()));
  readonly opportunities = computed(() =>
    this.state().sales.filter((x) => x.type === 'opportunity'),
  );
  readonly leads = computed(() => this.state().sales.filter((x) => x.type === 'lead'));
  // Demo roles describe who normally owns an action; they do not block this demo's workflows.
  readonly salesEditable = computed(() => true);
  readonly internal = computed(() => true);
  readonly pendingNotices = computed(() => {
    const state = this.state();
    return [
      ...state.notices.filter(
        (notice) =>
          notice.role === this.role() && !notice.resolved && !isSupersededPlanNotice(state, notice),
      ),
      ...collectPlanWarningNotices(state, this.person(), this.role()),
    ];
  });
  readonly archivedWorkspaces = computed(() => {
    this.state();
    if (!this.workspaceStorage) return [];
    try {
      return this.workspaceStorage
        .workspaceIds()
        .filter((id) => id !== this.activeWorkspaceId)
        .flatMap((id) => {
          const snapshot = this.workspaceStorage!.readWorkspace(id);
          return snapshot
            ? [
                {
                  id,
                  roundId: snapshot.roundId || '旧版未记录',
                  dataVersion: snapshot.dataVersion || 1,
                },
              ]
            : [];
        });
    } catch {
      return [];
    }
  });
  readonly cooling = computed(() =>
    this.opportunities().filter((x) => coolingDays(x, this.state().activities) >= 30),
  );
  readonly escalatedCooling = computed(() =>
    this.cooling().filter((x) => coolingDays(x, this.state().activities) >= 60),
  );
  readonly unclosedConditions = computed(() =>
    this.state().projects.reduce((n, p) => n + p.conditions.filter((c) => !c.closed).length, 0),
  );
  constructor() {
    if (typeof localStorage !== 'undefined') {
      this.editingLease = new EditingLease(localStorage, this.editingPageId);
      this.editingWritable.set(this.editingLease.acquire());
      this.initializeWorkspaceStorage();
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', this.onStorageChange);
        window.addEventListener('pagehide', this.releaseEditingPage);
        this.editingLeaseTimer = setInterval(() => this.renewEditingPage(), 5000);
      }
    }
    this.state.set(this.load());
    this.tryMigrateWorkspaceToV8();
    void this.recoverContractFiles();
    if (this.editingLease && !this.editingWritable())
      this.ui.notify('当前标签页为只读查看；如需修改，请先接管修改权', true);
  }
  private readonly onStorageChange = (event: StorageEvent): void => {
    if (event.key === this.workspaceStorage?.activePointerKey) {
      const activeId = this.workspaceStorage.activeWorkspaceId();
      if (activeId) {
        this.activeWorkspaceId = activeId;
        this.activeSnapshotKey = this.workspaceStorage.workspaceKey(activeId);
      }
      if (!this.canEdit()) this.state.set(this.load());
      return;
    }
    if (event.key === EDITING_LEASE_KEY) {
      const previouslyWritable = this.editingWritable();
      let writable = this.editingLease?.owns() || false;
      if (!writable && !event.newValue) writable = this.editingLease?.acquire() || false;
      this.editingWritable.set(writable);
      if (previouslyWritable && !writable)
        this.ui.notify('此标签页已失去修改权；请复制未保存内容或重新接管', true);
      else if (!previouslyWritable && writable) {
        this.initializeWorkspaceStorage();
        this.state.set(this.load());
        this.tryMigrateWorkspaceToV8();
        void this.recoverContractFiles();
        this.ui.notify('当前标签页已取得修改权');
      }
      return;
    }
    if (event.key === this.activeSnapshotKey && !this.canEdit()) this.state.set(this.load());
  };
  private readonly releaseEditingPage = (): void => {
    this.editingLease?.release();
    this.editingWritable.set(false);
  };
  private renewEditingPage(): void {
    if (!this.editingLease) return;
    const previouslyWritable = this.editingWritable();
    const writable = (this.state().storageSchemaVersion || 0) <= V9_STORAGE_SCHEMA_VERSION && (this.editingLease.renew() || this.editingLease.acquire());
    this.editingWritable.set(writable);
    if (previouslyWritable && !writable)
      this.ui.notify('此标签页已失去修改权；请复制未保存内容或重新接管', true);
    else if (!previouslyWritable && writable) {
      this.initializeWorkspaceStorage();
      this.state.set(this.load());
      this.tryMigrateWorkspaceToV8();
      void this.recoverContractFiles();
      this.ui.notify('当前标签页已取得修改权');
    }
  }
  takeOverEditing(): boolean {
    if (!this.editingLease) return this.ui.fail('浏览器不支持本地标签页修改资格管理');
    if (!this.editingLease.takeOver())
      return this.ui.fail('修改权接管失败，请检查浏览器存储空间后重试');
    this.editingWritable.set(true);
    this.initializeWorkspaceStorage();
    this.state.set(this.load());
    this.tryMigrateWorkspaceToV8();
    void this.recoverContractFiles();
    this.ui.notify('已接管修改权；原操作标签页现在只能查看');
    return true;
  }
  private inlineEditSources?: Set<string>;
  setPendingInlineEdit(pending: boolean, source = 'default'): void {
    const sources = (this.inlineEditSources ||= new Set<string>());
    if (pending) sources.add(source);
    else sources.delete(source);
    this.pendingInlineEdit.set(sources.size > 0);
  }
  resumeWorkspace(workspaceId: string): boolean {
    if (!this.canEdit()) {
      this.editingWritable.set(false);
      return this.ui.fail('当前标签页没有修改权；请先接管后再续接旧工作区');
    }
    if (!this.workspaceStorage || !this.workspaceStorage.readWorkspace(workspaceId))
      return this.ui.fail('指定工作区不存在或校验失败，当前工作区保持不变');
    try {
      this.workspaceStorage.activateWorkspace(workspaceId);
      this.activeWorkspaceId = workspaceId;
      this.activeSnapshotKey = this.workspaceStorage.workspaceKey(workspaceId);
      this.state.set(this.load());
      this.tryMigrateWorkspaceToV8();
      void this.recoverContractFiles();
      this.ui.notify('已续接旧工作区；当前其他工作区仍保留');
      return true;
    } catch (error) {
      return this.ui.fail(error instanceof Error ? error.message : '续接工作区失败');
    }
  }
  private tryMigrateWorkspaceToV8(): void {
    if (!this.canEdit() || !this.activeWorkspaceId) return;
    try {
      // 必须早于任何从名称兼容后的内存写回的修复，避免把推断当作原始证据。
      if (this.state().customerDeliveryRetentionVersion !== 1 && !this.migrateWorkspaceDeliveryCommitments(this.state().dataVersion || 1)) return;
      if ((this.state().storageSchemaVersion || 0) < V8_STORAGE_SCHEMA_VERSION &&
          !this.migrateWorkspaceToV8(this.state().dataVersion || 1)) {
        this.v8MigrationMessage.set(
          '旧数据升级尚未完成，原工作区和备份保留。可重试升级或稍后刷新。',
        );
        return;
      }
      if (this.state().financeBatches === undefined && !this.migrateWorkspaceFinanceSources(this.state().dataVersion || 1)) return;
      if (this.state().projectWarningBackfillVersion !== 1) this.fillProjectWarningSettings();
      this.repairLegacyCustomerCountries();
      if ((this.state().storageSchemaVersion || 0) < V9_STORAGE_SCHEMA_VERSION) this.migrateWorkspaceToV9(this.state().dataVersion || 1);
    } catch (error) {
      this.v8MigrationMessage.set(
        error instanceof Error ? error.message : '旧数据升级失败，原工作区和备份保留',
      );
    }
  }
  /** 修复已知历史别名；保留地区和业务历史快照，备份及提交成功后才发布。 */
  private repairLegacyCustomerCountries(): void {
    if (!this.workspaceStorage || !this.activeWorkspaceId || !this.canEdit()) return;
    const candidate = structuredClone(this.state());
    let count = 0;
    for (const customer of candidate.customers) {
      const country = customer.country === '德国' ? 'Germany'
        : customer.country === '荷兰' ? 'Netherlands' : undefined;
      if (!country) continue;
      customer.country = country;
      count++;
    }
    if (!count) return;
    const raw = localStorage.getItem(this.activeSnapshotKey);
    const persisted = this.workspaceStorage.readActive();
    if (!raw || !persisted || (persisted.dataVersion || 1) !== (this.state().dataVersion || 1))
      throw new Error('客户国家修复前数据版本已变化，请刷新重试');
    candidate.dataVersion = (persisted.dataVersion || 1) + 1;
    initializeDeliveryRetention(candidate, persisted);
    this.workspaceStorage.upgradeWorkspace(this.activeWorkspaceId, raw, candidate, () => this.canEdit());
    this.state.set(candidate);
    this.ui.notify(`已修复${count}家客户的历史国家值，原快照已备份`);
  }
  /** 使用已有的备份及提交前复核流程，成功持久化后才发布补齐结果。 */
  private fillProjectWarningSettings(): void {
    if (!this.workspaceStorage || !this.activeWorkspaceId || !this.canEdit()) return;
    const raw = localStorage.getItem(this.activeSnapshotKey);
    const persisted = this.workspaceStorage.readActive();
    if (!raw || !persisted || (persisted.dataVersion || 1) !== (this.state().dataVersion || 1))
      throw new Error('预警补齐前数据版本已变化，请刷新重试');
    const candidate = structuredClone(this.state());
    const count = backfillProjectWarnings(candidate);
    candidate.dataVersion = (persisted.dataVersion || 1) + 1;
    initializeDeliveryRetention(candidate, persisted);
    this.workspaceStorage.upgradeWorkspace(this.activeWorkspaceId, raw, candidate, () => this.canEdit());
    this.state.set(candidate);
    if (count) this.ui.notify(`已为历史项目的${count}项计划补齐提前7天预警，原快照已备份`);
  }
  /** 公开维护入口：迁移本工作区，不生成业务操作历史或本轮进度。 */
  migrateWorkspaceToV8(expectedDataVersion: number): boolean {
    const ok = this.upgradeWorkspaceSources(expectedDataVersion, candidate => {
      if (candidate.storageSchemaVersion === V8_STORAGE_SCHEMA_VERSION) return false;
      Object.assign(candidate, migrateV8Snapshot(candidate));
      return true;
    });
    try {
      if (ok) {
        this.repairLegacyCustomerCountries();
        this.workspaceRecoveryMessage.set('');
        this.v8MigrationMessage?.set('');
      }
      return ok;
    } catch (error) { return this.ui.fail(error instanceof Error ? error.message : '升级失败'); }
  }
  /** 显式升级入口：原文备份、候选回读、保存后才发布schema与统一方案。 */
  migrateWorkspaceToV9(expectedDataVersion: number): boolean {
    const upgraded = this.state().storageSchemaVersion !== V9_STORAGE_SCHEMA_VERSION;
    const ok = this.upgradeWorkspaceSources(expectedDataVersion, candidate => {
      if ((candidate.storageSchemaVersion || 0) > V9_STORAGE_SCHEMA_VERSION) throw new Error('更高版本快照不能降级写入');
      if (candidate.storageSchemaVersion === V9_STORAGE_SCHEMA_VERSION) return false;
      Object.assign(candidate, prepareV9Workspace(candidate));
      return true;
    });
    if (ok && upgraded) this.ui.notify('升级已备份保存');
    return ok;
  }
  private canEdit(): boolean {
    return !this.storageInitializationFailed && (this.state().storageSchemaVersion || 0) <= V9_STORAGE_SCHEMA_VERSION && (!this.editingLease || this.editingLease.owns());
  }
  /** 存储升级与增量来源共用原文备份、版本复核和先保存后发布机制。 */
  private upgradeWorkspaceSources(expectedDataVersion: number, prepare: (state: DemoState) => boolean): boolean {
    if (!this.canEdit() || !this.workspaceStorage || !this.activeWorkspaceId) return this.ui.fail('没有修改资格或工作区尚未初始化');
    const raw = localStorage.getItem(this.activeSnapshotKey);
    const persisted = this.workspaceStorage.readActive();
    if (!raw || !persisted || (persisted.dataVersion || 1) !== expectedDataVersion || (this.state().dataVersion || 1) !== expectedDataVersion)
      return this.ui.fail('版本已变化');
    try {
      const candidate = structuredClone(persisted);
      if (!prepare(candidate)) return true;
      candidate.dataVersion = expectedDataVersion + 1;
      this.workspaceStorage.upgradeWorkspace(this.activeWorkspaceId, raw, candidate, () => this.canEdit());
      this.state.set(candidate);
      return true;
    } catch (error) { return this.ui.fail(error instanceof Error ? error.message : '升级失败'); }
  }
  /** V10承诺来源：只消费原文，不能把load的名称兼容推断当成历史证据。 */
  migrateWorkspaceDeliveryCommitments(expectedDataVersion: number): boolean {
    return this.upgradeWorkspaceSources(expectedDataVersion, candidate => {
      if (candidate.customerDeliveryRetentionVersion === 1 || (!candidate.roundId && !this.state().roundId)) return false;
      candidate.roundId ||= this.state().roundId;
      // 留存捕获数据修订须为此次候选提交修订。
      candidate.dataVersion = expectedDataVersion + 1;
      initializeDeliveryRetention(candidate);
      return true;
    });
  }
  /** 旧财务与预算完全保留，仅增补独立模拟批次。 */
  migrateWorkspaceFinanceSources(expectedDataVersion: number): boolean {
    return this.upgradeWorkspaceSources(expectedDataVersion, initializeFinanceSources);
  }
  private initializeWorkspaceStorage(): void {
    if (typeof localStorage === 'undefined') return;
    this.workspaceStorage ||= new WorkspaceStorage(localStorage, isDemoState);
    try {
      const activeId = this.workspaceStorage.activeWorkspaceId();
      if (activeId) {
        this.activeWorkspaceId = activeId;
        this.activeSnapshotKey = this.workspaceStorage.workspaceKey(activeId);
        this.storageInitializationFailed = false;
        return;
      }
      if (!this.canEdit()) return;
      const legacyRaw = localStorage.getItem(KEY);
      let candidate: DemoState;
      let corruptLegacy = false;
      try {
        const legacy = legacyRaw ? JSON.parse(legacyRaw) : createSeed();
        if (!isDemoState(legacy)) throw new Error('旧快照结构不完整');
        // 名称兼容修复前先核验原始稳定关联，不能把补猜的关联当作历史承诺。
        legacy.roundId ||= newId('ROUND');
        initializeDeliveryRetention(legacy);
        candidate = legacyRaw !== null
          ? this.prepareWorkspaceState(legacy, true)
          : migrateV8Snapshot(this.prepareWorkspaceState(legacy));
      } catch {
        corruptLegacy = legacyRaw !== null;
        candidate = migrateV8Snapshot(this.prepareWorkspaceState(createSeed()));
      }
      initializeDeliveryRetention(candidate);
      const activated =
        legacyRaw !== null
          ? this.workspaceStorage.migrateLegacy(legacyRaw, candidate)
          : this.workspaceStorage.createAndActivateRound(candidate);
      this.activeWorkspaceId = activated.workspaceId;
      this.activeSnapshotKey = activated.workspaceKey;
      this.storageInitializationFailed = false;
      this.workspaceRecoveryMessage.set('');
      this.ui.notify(
        corruptLegacy
          ? '旧数据原文已备份；无法识别的字段保留在备份中，当前工作区从演示样例启动'
          : legacyRaw !== null
            ? '旧数据已先备份并迁入独立V7工作区'
            : '已创建独立V7演示工作区',
      );
    } catch (error) {
      this.activeWorkspaceKeyFallback(error);
    }
  }
  private activeWorkspaceKeyFallback(error: unknown): void {
    this.storageInitializationFailed = true;
    this.editingWritable.set(false);
    this.activeWorkspaceId = undefined;
    this.activeSnapshotKey = KEY;
    this.workspaceRecoveryMessage.set(
      error instanceof Error
        ? `${error.message}；现有工作区和备份均保留，当前以只读兼容方式打开。`
        : 'V7工作区初始化失败；现有工作区和备份均保留，当前以只读兼容方式打开。',
    );
    this.ui.notify(
      error instanceof WorkspaceStorageError
        ? `${error.message}；旧工作区保持不变，当前以只读兼容方式打开`
        : 'V7工作区初始化失败；旧工作区保持不变，当前以只读兼容方式打开',
      true,
    );
  }
  private prepareWorkspaceState(
    input: DemoState,
    convertLegacyHistory = false,
    fallbackRoundId?: string,
  ): DemoState {
    const state = structuredClone(input);
    const shouldMigrateLegacyHistory =
      convertLegacyHistory && (input.storageSchemaVersion || 0) < 1;
    state.quoteSeries ||= [];
    state.dataVersion ||= 1;
    state.roundId ||= fallbackRoundId || newId('ROUND');
    state.operationEvents ||= [];
    state.storageSchemaVersion = Math.max(state.storageSchemaVersion || 0, 1);
    state.quoteSchemaVersion = 1;
    state.dateMode ||= 'normal';
    /** 08-03：旧快照没有预警已读记录时补空数组，缺失不影响业务字段。 */
    state.planWarningReads ||= [];
    for (const sale of state.sales)
      if (sale.type === 'opportunity') sale.quoteFlowMode ||= 'legacy';
    migrateV4(state);
    for (const object of [...state.projects, ...state.sales]) {
      for (const member of object.team) member.personId ||= knownDemoPersonId(member.person);
    }
    state.planWarningReads = normalizePlanWarningReads(state);
    if (!shouldMigrateLegacyHistory) return state;
    const customerIds = new Set(state.customers.map((item) => item.id));
    const opportunityIds = new Set(state.sales.map((item) => item.id));
    const projectIds = new Set(state.projects.map((item) => item.id));
    const contractIds = new Set(state.contracts.map((item) => item.id));
    const quoteSeriesIds = new Set((state.quoteSeries || []).map((item) => item.id));
    const quoteVersionIds = new Set(
      (state.quoteSeries || []).flatMap((item) => item.versions.map((version) => version.id)),
    );
    const quoteVersionSeries = new Map(
      (state.quoteSeries || []).flatMap((series) =>
        series.versions.map((version) => [version.id, series] as const),
      ),
    );
    const attachmentIds = new Set(state.attachments.map((item) => item.id));
    const templateIds = new Set((state.roughPlanTemplates || []).map((template) => template.id));
    const templateTaskIds = new Set(
      (state.roughPlanTemplates || []).flatMap((template) => template.tasks.map((task) => task.id)),
    );
    const templateTaskOwners = new Map(
      (state.roughPlanTemplates || []).flatMap((template) =>
        template.tasks.map((task) => [task.id, template.id] as const),
      ),
    );
    const allEntityIds = new Set<string>();
    const collectIds = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(collectIds);
      } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (key === 'id' && typeof child === 'string') allEntityIds.add(child);
          else if (key === 'sourceOwner' || key === 'sourceCreator') continue;
          else collectIds(child);
        }
      }
    };
    collectIds(state);
    const markReview = (entityType: string, entityId: string, relation: string, target: string) => {
      state.migrationReviewItems ||= [];
      if (
        state.migrationReviewItems.some(
          (item) => item.entityId === entityId && item.relation === relation,
        )
      )
        return;
      state.migrationReviewItems.push({
        id: `MIGRATION-REVIEW-${entityType}-${entityId}-${relation}`,
        entityType,
        entityId,
        relation,
        reason: `旧数据关联“${target || '空值'}”无法确认；原记录已保留，需人工核对。`,
      });
    };
    const hasCustomerContact = (customerId: string | undefined, contactId: string): boolean =>
      !!customerId &&
      !!state.customers
        .find((customer) => customer.id === customerId)
        ?.contacts.some((contact) => contact.id === contactId);
    const hasCustomerMilestone = (projectId: string | undefined, milestoneId: string): boolean =>
      !!state.projects
        .find((project) => project.id === projectId)
        ?.plans.some((plan) => plan.id === milestoneId && plan.type === '客户主节点');
    for (const sale of state.sales) {
      if (sale.customerId && !customerIds.has(sale.customerId))
        markReview(sale.type, sale.id, 'customerId', sale.customerId);
      if (sale.leadId && !state.sales.some((record) => record.id === sale.leadId))
        markReview(sale.type, sale.id, 'leadId', sale.leadId);
      if (sale.contactId && !hasCustomerContact(sale.customerId, sale.contactId))
        markReview(sale.type, sale.id, 'contactId', sale.contactId);
      if (
        sale.customerProfileAtConversion?.customerId &&
        !customerIds.has(sale.customerProfileAtConversion.customerId)
      )
        markReview(
          sale.type,
          sale.id,
          'customerProfileAtConversion.customerId',
          sale.customerProfileAtConversion.customerId,
        );
      for (const roughPlan of sale.opportunityRoughPlans || []) {
        if (roughPlan.sourceTemplateId && !templateIds.has(roughPlan.sourceTemplateId))
          markReview(
            'opportunityRoughPlan',
            roughPlan.id,
            'sourceTemplateId',
            roughPlan.sourceTemplateId,
          );
        if (
          roughPlan.sourceTemplateTaskId &&
          (!templateTaskIds.has(roughPlan.sourceTemplateTaskId) ||
            !roughPlan.sourceTemplateId ||
            templateTaskOwners.get(roughPlan.sourceTemplateTaskId) !== roughPlan.sourceTemplateId)
        )
          markReview(
            'opportunityRoughPlan',
            roughPlan.id,
            'sourceTemplateTaskId',
            roughPlan.sourceTemplateTaskId,
          );
      }
      for (const assessment of sale.technicalAssessments || []) {
        for (const attachmentId of assessment.evidenceAttachmentIds || []) {
          if (!attachmentIds.has(attachmentId))
            markReview('technicalAssessment', assessment.id, 'evidenceAttachmentIds', attachmentId);
        }
      }
    }
    for (const activity of state.activities) {
      if (activity.entityId && !allEntityIds.has(activity.entityId))
        markReview('activity', activity.id, 'entityId', activity.entityId);
      if (activity.customerId && !customerIds.has(activity.customerId))
        markReview('activity', activity.id, 'customerId', activity.customerId);
      if (activity.contactId && !hasCustomerContact(activity.customerId, activity.contactId))
        markReview('activity', activity.id, 'contactId', activity.contactId);
    }
    for (const attachment of state.attachments) {
      if (attachment.entityId && !allEntityIds.has(attachment.entityId))
        markReview('attachment', attachment.id, 'entityId', attachment.entityId);
    }
    for (const notice of state.notices) {
      if (notice.entityId && !allEntityIds.has(notice.entityId))
        markReview('notice', notice.id, 'entityId', notice.entityId);
    }
    for (const history of state.history) {
      if (history.entityId && !allEntityIds.has(history.entityId))
        markReview('history', history.id, 'entityId', history.entityId);
    }
    for (const event of state.operationEvents) {
      if (event.objectId && !allEntityIds.has(event.objectId))
        markReview('operationEvent', event.id, 'objectId', event.objectId);
      if (event.location.objectId && event.location.objectId !== event.objectId)
        markReview('operationEvent', event.id, 'location.objectId', event.location.objectId);
      if (event.taskSource?.id && !allEntityIds.has(event.taskSource.id))
        markReview('operationEvent', event.id, 'taskSource.id', event.taskSource.id);
    }
    for (const project of state.projects) {
      if (project.opportunityId && !opportunityIds.has(project.opportunityId))
        markReview('project', project.id, 'opportunityId', project.opportunityId);
      if (project.contractId && !contractIds.has(project.contractId))
        markReview('project', project.id, 'contractId', project.contractId);
      if (project.customerId && !customerIds.has(project.customerId))
        markReview('project', project.id, 'customerId', project.customerId);
      const projectSale = state.sales.find((sale) => sale.id === project.opportunityId);
      const projectContract = state.contracts.find(
        (contract) => contract.id === project.contractId,
      );
      const opportunityPlanIds = new Set(
        (projectSale?.opportunityRoughPlans || []).map((plan) => plan.id),
      );
      if (projectSale && project.customerId && projectSale.customerId !== project.customerId)
        markReview('project', project.id, 'customerId', project.customerId);
      if (
        projectContract &&
        (projectContract.opportunityId !== project.opportunityId ||
          projectContract.customerId !== project.customerId)
      )
        markReview('project', project.id, 'contractId', project.contractId);
      if (project.contactId && !hasCustomerContact(project.customerId, project.contactId))
        markReview('project', project.id, 'contactId', project.contactId);
      for (const plan of project.plans) {
        if (plan.sourceOpportunityPlanId && !opportunityPlanIds.has(plan.sourceOpportunityPlanId))
          markReview(
            'projectPlan',
            plan.id,
            'sourceOpportunityPlanId',
            plan.sourceOpportunityPlanId,
          );
        if (plan.sourceTemplateId && !templateIds.has(plan.sourceTemplateId))
          markReview('projectPlan', plan.id, 'sourceTemplateId', plan.sourceTemplateId);
        if (
          plan.sourceTemplateTaskId &&
          (!templateTaskIds.has(plan.sourceTemplateTaskId) ||
            !plan.sourceTemplateId ||
            templateTaskOwners.get(plan.sourceTemplateTaskId) !== plan.sourceTemplateId)
        )
          markReview('projectPlan', plan.id, 'sourceTemplateTaskId', plan.sourceTemplateTaskId);
        if (plan.customerMilestoneId && !hasCustomerMilestone(project.id, plan.customerMilestoneId))
          markReview('projectPlan', plan.id, 'customerMilestoneId', plan.customerMilestoneId);
      }
      for (const equipment of project.equipmentSerialRecords || []) {
        if (equipment.projectId !== project.id)
          markReview('equipmentSerialRecord', equipment.id, 'projectId', equipment.projectId);
        if (equipment.contractId && !contractIds.has(equipment.contractId))
          markReview('equipmentSerialRecord', equipment.id, 'contractId', equipment.contractId);
      }
    }
    for (const contract of state.contracts) {
      if (contract.opportunityId && !opportunityIds.has(contract.opportunityId))
        markReview('contract', contract.id, 'opportunityId', contract.opportunityId);
      if (contract.customerId && !customerIds.has(contract.customerId))
        markReview('contract', contract.id, 'customerId', contract.customerId);
      const contractSale = state.sales.find((sale) => sale.id === contract.opportunityId);
      if (contractSale && contractSale.customerId !== contract.customerId)
        markReview('contract', contract.id, 'customerId', contract.customerId);
      if (contract.contactId && !hasCustomerContact(contract.customerId, contract.contactId))
        markReview('contract', contract.id, 'contactId', contract.contactId);
      if (contract.quoteSeriesId && !quoteSeriesIds.has(contract.quoteSeriesId))
        markReview('contract', contract.id, 'quoteSeriesId', contract.quoteSeriesId);
      if (contract.quoteVersionId && !quoteVersionIds.has(contract.quoteVersionId))
        markReview('contract', contract.id, 'quoteVersionId', contract.quoteVersionId);
      if (
        contract.quoteVersionId &&
        contract.quoteSeriesId &&
        quoteVersionSeries.get(contract.quoteVersionId)?.id !== contract.quoteSeriesId
      )
        markReview('contract', contract.id, 'quoteVersionId', contract.quoteVersionId);
      if (
        contract.quoteVersionId &&
        quoteVersionSeries.get(contract.quoteVersionId)?.opportunityId !== contract.opportunityId
      )
        markReview('contract', contract.id, 'quoteVersionId', contract.quoteVersionId);
      if (
        contract.quoteSeriesId &&
        state.quoteSeries?.find((series) => series.id === contract.quoteSeriesId)?.opportunityId !==
          contract.opportunityId
      )
        markReview('contract', contract.id, 'quoteSeriesId', contract.quoteSeriesId);
      if (
        contract.serviceSnapshot?.quoteVersionId &&
        !quoteVersionIds.has(contract.serviceSnapshot.quoteVersionId)
      )
        markReview(
          'contract',
          contract.id,
          'serviceSnapshot.quoteVersionId',
          contract.serviceSnapshot.quoteVersionId,
        );
      if (
        contract.serviceSnapshot?.quoteVersionId &&
        contract.quoteSeriesId &&
        quoteVersionSeries.get(contract.serviceSnapshot.quoteVersionId)?.id !==
          contract.quoteSeriesId
      )
        markReview(
          'contract',
          contract.id,
          'serviceSnapshot.quoteVersionId',
          contract.serviceSnapshot.quoteVersionId,
        );
      if (
        contract.serviceSnapshot?.quoteVersionId &&
        quoteVersionSeries.get(contract.serviceSnapshot.quoteVersionId)?.opportunityId !==
          contract.opportunityId
      )
        markReview(
          'contract',
          contract.id,
          'serviceSnapshot.quoteVersionId',
          contract.serviceSnapshot.quoteVersionId,
        );
    }
    for (const series of state.quoteSeries || []) {
      if (series.opportunityId && !opportunityIds.has(series.opportunityId))
        markReview('quoteSeries', series.id, 'opportunityId', series.opportunityId);
      const localVersions = new Set(series.versions.map((version) => version.id));
      if (series.activeFinalVersionId && !localVersions.has(series.activeFinalVersionId))
        markReview('quoteSeries', series.id, 'activeFinalVersionId', series.activeFinalVersionId);
      for (const version of series.versions) {
        if (version.seriesId !== series.id)
          markReview('quoteVersion', version.id, 'seriesId', version.seriesId);
        if (version.sourceVersionId && !localVersions.has(version.sourceVersionId))
          markReview('quoteVersion', version.id, 'sourceVersionId', version.sourceVersionId);
        if (version.customerId && !customerIds.has(version.customerId))
          markReview('quoteVersion', version.id, 'customerId', version.customerId);
        if (version.contactId && !hasCustomerContact(version.customerId, version.contactId))
          markReview('quoteVersion', version.id, 'contactId', version.contactId);
        if (
          version.solutionVersionId &&
          !state.solutionSeries?.some(
            (solution) =>
              solution.opportunityId === series.opportunityId &&
              solution.versions.some((item) => item.id === version.solutionVersionId),
          )
        )
          markReview('quoteVersion', version.id, 'solutionVersionId', version.solutionVersionId);
        if (
          version.sourceSolutionConfirmationId &&
          !state.solutionDocuments?.some(
            (documents) =>
              documents.opportunityId === series.opportunityId &&
              documents.confirmations.some(
                (item) => item.id === version.sourceSolutionConfirmationId,
              ),
          )
        )
          markReview(
            'quoteVersion',
            version.id,
            'sourceSolutionConfirmationId',
            version.sourceSolutionConfirmationId,
          );
        if (
          version.costingId &&
          !state.solutionDocuments?.some(
            (documents) =>
              documents.opportunityId === series.opportunityId &&
              documents.costings.some((item) => item.id === version.costingId),
          )
        )
          markReview('quoteVersion', version.id, 'costingId', version.costingId);
        for (const attachmentId of version.sourceAttachmentIds || []) {
          const sale = state.sales.find((item) => item.id === series.opportunityId);
          const sourceAttachment = state.attachments.find((item) => item.id === attachmentId);
          if (
            !sourceAttachment ||
            ![series.opportunityId, sale?.leadId].includes(sourceAttachment.entityId)
          )
            markReview('quoteVersion', version.id, 'sourceAttachmentIds', attachmentId);
        }
        for (const [kind, documentVersionId] of Object.entries(
          version.sourceDocumentVersions || {},
        )) {
          if (
            documentVersionId &&
            !state.solutionDocuments?.some(
              (documents) =>
                documents.opportunityId === series.opportunityId &&
                documents.versions.some(
                  (item) => item.id === documentVersionId && item.kind === kind,
                ),
            )
          )
            markReview(
              'quoteVersion',
              version.id,
              `sourceDocumentVersions.${kind}`,
              documentVersionId,
            );
        }
        for (const item of version.items) {
          const productNeedIds = new Set(
            (state.sales.find((sale) => sale.id === series.opportunityId)?.productNeeds || []).map(
              (need) => need.id,
            ),
          );
          const productNeedHistoryIds = new Set(
            (
              state.sales.find((sale) => sale.id === series.opportunityId)?.productNeedHistory || []
            ).flatMap((snapshot) => snapshot.productNeeds.map((need) => need.id)),
          );
          if (
            item.productNeedId &&
            !productNeedIds.has(item.productNeedId) &&
            !productNeedHistoryIds.has(item.productNeedId)
          )
            markReview('quoteItem', item.id, 'productNeedId', item.productNeedId);
          if (
            item.guideCostingId &&
            !state.solutionDocuments?.some(
              (documents) =>
                documents.opportunityId === series.opportunityId &&
                documents.costings.some((costing) => costing.id === item.guideCostingId),
            )
          )
            markReview('quoteItem', item.id, 'guideCostingId', item.guideCostingId);
        }
      }
    }
    for (const series of state.solutionSeries || []) {
      if (series.opportunityId && !opportunityIds.has(series.opportunityId))
        markReview('solutionSeries', series.id, 'opportunityId', series.opportunityId);
      const localVersions = new Set(series.versions.map((version) => version.id));
      if (series.latestVersionId && !localVersions.has(series.latestVersionId))
        markReview('solutionSeries', series.id, 'latestVersionId', series.latestVersionId);
      if (series.finalVersionId && !localVersions.has(series.finalVersionId))
        markReview('solutionSeries', series.id, 'finalVersionId', series.finalVersionId);
    }
    for (const documents of state.solutionDocuments || []) {
      if (documents.opportunityId && !opportunityIds.has(documents.opportunityId))
        markReview(
          'solutionDocuments',
          documents.opportunityId,
          'opportunityId',
          documents.opportunityId,
        );
      const documentVersionIds = new Set(documents.versions.map((version) => version.id));
      const documentKinds = new Map(
        documents.versions.map((version) => [version.id, version.kind] as const),
      );
      const needIds = new Set(
        (state.sales.find((sale) => sale.id === documents.opportunityId)?.productNeeds || []).map(
          (need) => need.id,
        ),
      );
      const historicalNeedIds = new Set(
        (
          state.sales.find((sale) => sale.id === documents.opportunityId)?.productNeedHistory || []
        ).flatMap((snapshot) => snapshot.productNeeds.map((need) => need.id)),
      );
      for (const version of documents.versions) {
        const sourceSale = state.sales.find((sale) => sale.id === documents.opportunityId);
        const sourceDocument = state.attachments.find(
          (attachment) => attachment.id === version.documentId,
        );
        if (
          version.documentId &&
          (!sourceDocument ||
            ![documents.opportunityId, sourceSale?.leadId].includes(sourceDocument.entityId))
        )
          markReview('solutionDocumentVersion', version.id, 'documentId', version.documentId);
      }
      for (const confirmation of documents.confirmations) {
        for (const [kind, versionId] of Object.entries(confirmation.documentVersions)) {
          if (
            versionId &&
            (!documentVersionIds.has(versionId) || documentKinds.get(versionId) !== kind)
          )
            markReview(
              'solutionConfirmation',
              confirmation.id,
              `documentVersions.${kind}`,
              versionId,
            );
        }
      }
      for (const [kind, versionId] of Object.entries(documents.current)) {
        if (
          versionId &&
          (!documentVersionIds.has(versionId) || documentKinds.get(versionId) !== kind)
        )
          markReview('solutionDocuments', documents.opportunityId, `current.${kind}`, versionId);
      }
      for (const costing of documents.costings) {
        if (
          costing.confirmationId &&
          !documents.confirmations.some((item) => item.id === costing.confirmationId)
        )
          markReview('solutionCosting', costing.id, 'confirmationId', costing.confirmationId);
        for (const row of costing.rows) {
          if (
            row.productNeedId &&
            !needIds.has(row.productNeedId) &&
            !historicalNeedIds.has(row.productNeedId)
          )
            markReview('solutionCosting', costing.id, 'rows.productNeedId', row.productNeedId);
        }
      }
    }
    for (const terms of state.serviceTerms || []) {
      if (terms.opportunityId && !opportunityIds.has(terms.opportunityId))
        markReview('serviceTerms', terms.opportunityId, 'opportunityId', terms.opportunityId);
    }
    for (const agreement of state.serviceAgreements || []) {
      if (agreement.opportunityId && !opportunityIds.has(agreement.opportunityId))
        markReview(
          'serviceAgreement',
          agreement.opportunityId,
          'opportunityId',
          agreement.opportunityId,
        );
      const agreementSale = state.sales.find((sale) => sale.id === agreement.opportunityId);
      const agreementDocument = state.attachments.find(
        (attachment) => attachment.id === agreement.documentId,
      );
      if (
        agreement.documentId &&
        (!agreementDocument ||
          ![agreement.opportunityId, agreementSale?.leadId].includes(agreementDocument.entityId))
      )
        markReview('serviceAgreement', agreement.opportunityId, 'documentId', agreement.documentId);
    }
    for (const snapshot of state.financeSnapshots || []) {
      if (snapshot.projectId && !projectIds.has(snapshot.projectId))
        markReview('financeSnapshot', snapshot.projectId, 'projectId', snapshot.projectId);
      if (
        snapshot.cumulativeActualCost?.projectId &&
        snapshot.cumulativeActualCost.projectId !== snapshot.projectId
      )
        markReview(
          'actualCostSnapshot',
          snapshot.projectId,
          'projectId',
          snapshot.cumulativeActualCost.projectId,
        );
      const invoiceIds = new Set(snapshot.invoices.map((invoice) => invoice.id));
      for (const event of snapshot.events) {
        if (event.invoiceId && !invoiceIds.has(event.invoiceId))
          markReview('financeEvent', event.invoiceId, 'invoiceId', event.invoiceId);
      }
    }
    for (const policy of state.creditPolicies || []) {
      if (policy.projectId && !projectIds.has(policy.projectId))
        markReview('creditPolicy', policy.policyId, 'projectId', policy.projectId);
      if (policy.customerId && !customerIds.has(policy.customerId))
        markReview('creditPolicy', policy.policyId, 'customerId', policy.customerId);
      const project = state.projects.find((item) => item.id === policy.projectId);
      if (project && policy.customerId && project.customerId !== policy.customerId)
        markReview('creditPolicy', policy.policyId, 'customerId', policy.customerId);
      if (
        policy.startCustomerMilestoneId &&
        !hasCustomerMilestone(policy.projectId, policy.startCustomerMilestoneId)
      )
        markReview(
          'creditPolicy',
          policy.policyId,
          'startCustomerMilestoneId',
          policy.startCustomerMilestoneId,
        );
    }
    for (const binding of state.projectMilestoneBindings || []) {
      if (binding.projectId && !projectIds.has(binding.projectId))
        markReview('projectMilestoneBinding', binding.projectId, 'projectId', binding.projectId);
      const project = state.projects.find((item) => item.id === binding.projectId);
      if (binding.sourcePlanId && !project?.plans.some((plan) => plan.id === binding.sourcePlanId))
        markReview(
          'projectMilestoneBinding',
          binding.projectId,
          'sourcePlanId',
          binding.sourcePlanId,
        );
      if (
        binding.customerMilestoneId &&
        !hasCustomerMilestone(binding.projectId, binding.customerMilestoneId)
      )
        markReview(
          'projectMilestoneBinding',
          binding.projectId,
          'customerMilestoneId',
          binding.customerMilestoneId,
        );
    }
    for (const record of state.milestoneSyncRecords || []) {
      if (record.projectId && !projectIds.has(record.projectId))
        markReview('milestoneSyncRecord', record.id, 'projectId', record.projectId);
      const project = state.projects.find((item) => item.id === record.projectId);
      if (record.sourcePlanId && !project?.plans.some((plan) => plan.id === record.sourcePlanId))
        markReview('milestoneSyncRecord', record.id, 'sourcePlanId', record.sourcePlanId);
      if (
        record.customerMilestoneId &&
        !hasCustomerMilestone(record.projectId, record.customerMilestoneId)
      )
        markReview(
          'milestoneSyncRecord',
          record.id,
          'customerMilestoneId',
          record.customerMilestoneId,
        );
    }
    for (const warning of state.milestoneWarnings || []) {
      if (warning.projectId && !projectIds.has(warning.projectId))
        markReview('milestoneWarning', warning.id, 'projectId', warning.projectId);
      const project = state.projects.find((item) => item.id === warning.projectId);
      if (warning.sourcePlanId && !project?.plans.some((plan) => plan.id === warning.sourcePlanId))
        markReview('milestoneWarning', warning.id, 'sourcePlanId', warning.sourcePlanId);
      if (
        warning.customerMilestoneId &&
        !hasCustomerMilestone(warning.projectId, warning.customerMilestoneId)
      )
        markReview(
          'milestoneWarning',
          warning.id,
          'customerMilestoneId',
          warning.customerMilestoneId,
        );
      if (
        warning.invoiceId &&
        !state.financeSnapshots?.some(
          (snapshot) =>
            snapshot.projectId === warning.projectId &&
            snapshot.invoices.some((invoice) => invoice.id === warning.invoiceId),
        )
      )
        markReview('milestoneWarning', warning.id, 'invoiceId', warning.invoiceId);
    }
    for (const cost of state.finalActualCosts || []) {
      if (cost.projectId && !projectIds.has(cost.projectId))
        markReview('finalActualCost', cost.id, 'projectId', cost.projectId);
      const costDocument = state.attachments.find(
        (attachment) => attachment.id === cost.documentId,
      );
      if (cost.documentId && (!costDocument || costDocument.entityId !== cost.projectId))
        markReview('finalActualCost', cost.id, 'documentId', cost.documentId);
    }
    for (const series of state.solutionSeries || []) {
      for (const version of series.versions) {
        const solutionSale = state.sales.find((sale) => sale.id === series.opportunityId);
        const solutionDocument = state.attachments.find(
          (attachment) => attachment.id === version.documentId,
        );
        if (
          version.documentId &&
          (!solutionDocument ||
            ![series.opportunityId, solutionSale?.leadId].includes(solutionDocument.entityId))
        )
          markReview('solutionVersion', version.id, 'documentId', version.documentId);
      }
    }
    const knownLegacyIds = new Set(
      state.operationEvents
        .filter((event) => event.legacyHistoryId)
        .map((event) => event.legacyHistoryId),
    );
    for (const history of state.history) {
      if (knownLegacyIds.has(history.id)) continue;
      const objectId = history.entityId || '旧版未记录';
      const action = history.action || '旧版未记录';
      const missing = ['模块', '部门', '主线', '字段变化', '负责人', '对象类型'];
      state.operationEvents.push({
        id: history.id || newId('LEGACY'),
        legacyHistoryId: history.id,
        legacy: true,
        legacyMissingFields: missing,
        roundId: `LEGACY-${history.id || newId('HISTORY')}`,
        mainlineId: '旧版未记录',
        module: '旧版未记录',
        department: '旧版未记录',
        objectType: '旧版未记录',
        objectId,
        action,
        operator: history.operator || '旧版未记录',
        owner: '旧版未记录',
        occurredAt: history.date || '旧版未记录',
        sourceVersion: 0,
        dataVersion: 0,
        location: {
          objectType: '旧版未记录',
          objectId,
          module: '旧版未记录',
          department: '旧版未记录',
          section: '旧版未记录',
          action,
        },
        changes: [],
      });
    }
    return state;
  }
  private load(): DemoState {
    if (this.workspaceStorage && this.activeWorkspaceId) {
      try {
        const active = this.workspaceStorage.readActive();
        if (active) {
          if ((active.storageSchemaVersion || 0) > V9_STORAGE_SCHEMA_VERSION) {
            this.editingWritable.set(false);
            this.workspaceRecoveryMessage.set('该工作区来自更高版本，当前仅只读查看，不能降级写入');
            return structuredClone(active);
          }
          this.workspaceRecoveryMessage.set('');
          return this.prepareWorkspaceState(active);
        }
        this.workspaceRecoveryMessage.set(
          '活动V7工作区无法通过结构校验；原快照和迁移备份均已保留，当前以只读样例打开。',
        );
        this.ui.notify('活动V7工作区无法通过结构校验；原快照和迁移备份均已保留', true);
      } catch {
        this.workspaceRecoveryMessage.set(
          '读取活动V7工作区失败；原快照和迁移备份均已保留，当前以只读样例打开。',
        );
        this.ui.notify('读取活动V7工作区失败；原快照和迁移备份均已保留', true);
      }
      this.storageInitializationFailed = true;
      this.editingWritable.set(false);
      return this.prepareWorkspaceState(createSeed());
    }
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
      if (raw) {
        const state: DemoState = JSON.parse(raw);
        if (isDemoState(state)) {
          const migrated = this.prepareWorkspaceState(state, true, 'LEGACY-UNMIGRATED');
          for (const project of migrated.projects) {
            this.syncMilestoneWarnings(migrated, project.id);
            if (migrated.financeSnapshots?.some((snapshot) => snapshot.projectId === project.id))
              this.syncReceivables(migrated, project.id);
          }
          return migrated;
        }
        throw new Error('旧存储结构损坏');
      }
    } catch {
      try {
        if (raw && this.canEdit() && !this.workspaceStorage) {
          localStorage.setItem(`${KEY}-corrupt-backup-${Date.now()}`, raw);
          this.ui.notify('旧数据无法读取，原始记录已备份，现显示初始演示数据', true);
        } else if (raw) {
          this.ui.notify('旧数据无法读取；此标签页只读，接管后可创建本地恢复副本', true);
        }
      } catch {
        this.ui.notify('旧数据无法读取且无法写入备份；原存储保留，现显示初始演示数据', true);
      }
    }
    const state = this.prepareWorkspaceState(createSeed());
    state.dataVersion ||= 1;
    state.roundId ||= newId('ROUND');
    state.operationEvents ||= [];
    return state;
  }
  customer(id: string): Customer | undefined {
    return this.state().customers.find((x) => x.id === id);
  }
  sale(id: string): SalesRecord | undefined {
    return this.state().sales.find((x) => x.id === id);
  }
  project(id: string): Project | undefined {
    return this.state().projects.find((x) => x.id === id);
  }
  contract(id: string): Contract | undefined {
    return this.state().contracts.find((x) => x.id === id);
  }
  contractForOpportunity(opportunityId: string): Contract | undefined {
    return this.state().contracts.find((x) => x.opportunityId === opportunityId);
  }
  invoicesForContract(contractId: string): ContractInvoice[] {
    return (this.state().contractInvoices || [])
      .filter((invoice) => invoice.contractId === contractId)
      .map((invoice) => this.invoiceWithMilestoneFacts(invoice))
      .sort((left, right) => left.number.localeCompare(right.number, 'zh-CN'));
  }
  invoicesForProject(projectId: string, state: DemoState = this.state()): ContractInvoice[] {
    return (state.contractInvoices || [])
      .filter((invoice) => invoice.projectIds.includes(projectId))
      .map((invoice) => this.invoiceWithMilestoneFacts(invoice, state, projectId));
  }
  invoiceMilestoneOptions(contractId: string): {
    projectId: string;
    id: string;
    name: string;
    status: string;
    sourceReference: string;
  }[] {
    return this.state()
      .projects.filter((project) => project.contractId === contractId)
      .flatMap((project) =>
        project.plans
          .filter((plan) => plan.type === '客户主节点')
          .map((plan) => ({
            projectId: project.id,
            id: plan.id,
            name: plan.name,
            status: plan.status,
            sourceReference:
              plan.actualSourceReference ||
              plan.sourceReference ||
              `项目计划 ${project.id}/${plan.id}`,
          })),
      );
  }
  projectsForContract(contractId: string): Project[] {
    return this.state().projects.filter((project) => project.contractId === contractId);
  }
  bankReceiptClaims(contractId: string): BankReceiptClaim[] {
    return structuredClone(
      (this.state().bankReceiptClaims || []).filter((receipt) => receipt.contractId === contractId),
    );
  }
  bankReceiptClaimLines(receiptId?: string): BankReceiptClaimLine[] {
    return structuredClone(
      (this.state().bankReceiptClaimLines || []).filter(
        (line) => !receiptId || line.receiptId === receiptId,
      ),
    );
  }
  bankReceiptSummary(receiptId: string) {
    const receipt = (this.state().bankReceiptClaims || []).find((item) => item.id === receiptId);
    return receipt ? summarizeRemittance(receipt, this.state().bankReceiptClaimLines || []) : [];
  }
  private invoiceClaims(state: DemoState): InvoiceReceiptClaim[] {
    const projected = toInvoiceReceiptClaims(
      state.bankReceiptClaims || [],
      state.bankReceiptClaimLines || [],
      state.orders || [],
      state.contractInvoices || [],
    );
    const seen = new Set<string>();
    return [...(state.invoiceReceiptClaims || []), ...projected].filter((claim) => {
      if (!claim.id.trim() || seen.has(claim.id)) return false;
      seen.add(claim.id);
      return true;
    });
  }
  /** V8 retired: receipt-claim writes stay refused, claims stay readable. */
  saveBankReceiptClaim(_receipt: BankReceiptClaim, _inputLines: BankReceiptClaimLine[]): boolean {
    return this.retiredFinanceWrite('水单认领及认领明细');
  }
  private invoiceWithMilestoneFacts(
    invoice: ContractInvoice,
    state: DemoState = this.state(),
    selectedProjectId?: string,
  ): ContractInvoice {
    const claimIds = new Set<string>();
    const claimedCents =
      invoice.cumulativeSource === 'claims'
        ? this.invoiceClaims(state)
            .filter((claim) => {
              if (
                claim.invoiceId !== invoice.id ||
                claim.currency !== invoice.currency ||
                claim.status !== '有效' ||
                !claim.id.trim() ||
                claimIds.has(claim.id)
              )
                return false;
              claimIds.add(claim.id);
              return true;
            })
            .reduce((sum, claim) => sum + invoiceCents(claim.amount), 0)
        : invoiceCents(invoice.received);
    const effectiveReceived = invoiceAmount(
      invoice.cumulativeSource === 'claims'
        ? invoiceCents(invoice.legacyReceived) + claimedCents
        : claimedCents,
    );
    const contextualPolicy = selectedProjectId
      ? this.creditPolicy(selectedProjectId, state)
      : undefined;
    const milestoneId =
      invoice.dueMilestoneId ||
      (!invoice.due ? contextualPolicy?.startCustomerMilestoneId : undefined);
    const policyDays =
      contextualPolicy && contextualPolicy.startCustomerMilestoneId === milestoneId
        ? contextualPolicy.days
        : undefined;
    const matches = state.projects.flatMap((project) => {
      if (!invoice.projectIds.includes(project.id)) return [];
      if (selectedProjectId && project.id !== selectedProjectId) return [];
      if (invoice.dueProjectId && project.id !== invoice.dueProjectId) return [];
      return project.plans
        .filter((plan) => !!milestoneId && plan.type === '客户主节点' && plan.id === milestoneId)
        .map((plan) => ({ project, plan }));
    });
    if (matches.length !== 1)
      return {
        ...invoice,
        received: effectiveReceived,
        dueMilestoneActualDate: undefined,
        dueMilestoneExpectedDate: undefined,
        dueMilestoneStatus:
          matches.length > 1 ? '待核：多个项目节点匹配' : '待核：未找到关联项目节点',
        dueMilestoneSourceReference: '',
      };
    const { project, plan } = matches[0];
    const completed = plan.status === '已完成';
    const actualDate = completed && validISODate(plan.actual) ? plan.actual : undefined;
    const expectedDate = !completed && validISODate(plan.expected) ? plan.expected : undefined;
    return {
      ...invoice,
      received: effectiveReceived,
      paymentTermDays: invoice.paymentTermDays ?? policyDays,
      dueMilestoneName: plan.name,
      dueMilestoneActualDate: actualDate,
      dueMilestoneExpectedDate: expectedDate,
      dueMilestoneStatus: plan.status,
      dueMilestoneSourceReference: actualDate
        ? plan.actualSourceReference || `项目计划 ${project.id}/${plan.id} · 已完成实际日期`
        : expectedDate
          ? plan.sourceReference || `项目计划 ${project.id}/${plan.id} · 预计日期`
          : `项目计划 ${project.id}/${plan.id} · 日期待核`,
    };
  }
  invoiceReceiptClaims(invoiceId: string): {
    source: 'legacy-simulation' | 'claims';
    received: number;
    claimReceived: number;
    claimIds: string[];
  } {
    const invoice = (this.state().contractInvoices || []).find((item) => item.id === invoiceId);
    if (!invoice)
      return { source: 'legacy-simulation', received: 0, claimReceived: 0, claimIds: [] };
    const seen = new Set<string>();
    const claims = this.invoiceClaims(this.state()).filter((claim) => {
      if (
        !claim.id.trim() ||
        claim.invoiceId !== invoiceId ||
        claim.status !== '有效' ||
        claim.currency !== invoice.currency ||
        seen.has(claim.id)
      )
        return false;
      seen.add(claim.id);
      return true;
    });
    const receivedCents = claims.reduce((sum, claim) => sum + invoiceCents(claim.amount), 0);
    return {
      source: invoice.cumulativeSource,
      received:
        invoice.cumulativeSource === 'claims'
          ? invoiceAmount(invoiceCents(invoice.legacyReceived) + receivedCents)
          : invoice.received,
      claimReceived: invoiceAmount(receivedCents),
      claimIds: claims.map((claim) => claim.id),
    };
  }
  /** V8 retired: contract invoice writes stay refused, balances stay readable. */
  saveContractInvoice(_input: ContractInvoice): boolean {
    return this.retiredFinanceWrite('合同发票');
  }
  ordersForContract(contractId: string): SalesOrder[] {
    return (this.state().orders || []).filter((order) => order.contractId === contractId);
  }
  ordersForProject(projectId: string): SalesOrder[] {
    return (this.state().orders || []).filter((order) => order.projectId === projectId);
  }
  orderLines(orderId: string): SalesOrderLine[] {
    return (this.state().orderLines || []).filter((line) => line.orderId === orderId);
  }
  /** V8 retired: contract order and line writes stay refused, history stays readable. */
  saveSalesOrder(_input: SalesOrder, _inputLines: SalesOrderLine[]): boolean {
    return this.retiredFinanceWrite('合同订单及明细');
  }
  quoteSeries(opportunityId: string): QuoteSeries | undefined {
    return this.state().quoteSeries?.find((series) => series.opportunityId === opportunityId);
  }
  quoteSeriesById(seriesId: string): QuoteSeries | undefined {
    if (!seriesId) return undefined;
    return this.state().quoteSeries?.find((series) => series.id === seriesId);
  }
  quoteVersion(versionId: string): QuoteVersion | undefined {
    return this.state()
      .quoteSeries?.flatMap((series) => series.versions)
      .find((version) => version.id === versionId);
  }
  quoteTotals(version: QuoteVersion): {
    lines: number;
    added: number;
    beforeDiscount: number;
    net: number;
    total: number | null;
  } {
    if (version.crmSchemaVersion === 1) {
      const fields = crmAggregate(version.items);
      return {
        lines:
          crmNumber(fields, 'alp_beforedistotalsum') - crmNumber(fields, 'alp_total_shipping_cost'),
        added: crmNumber(fields, 'alp_total_shipping_cost'),
        beforeDiscount: crmNumber(fields, 'alp_beforedistotalsum'),
        net: crmNumber(fields, 'alp_quototalpriceofftax'),
        total: crmNumber(fields, 'alp_quototalpriceintax'),
      };
    }
    const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const lines = round(
      version.items.reduce(
        (sum, item) => sum + round(Number(item.quantity) * Number(item.unitPrice)),
        0,
      ),
    );
    const added = round(
      (version.freightTreatment === '另收' ? Number(version.freightAmount) : 0) +
        (version.dutyTreatment === '另收' ? Number(version.dutyAmount) : 0) +
        (version.otherFeeTreatment === '另收' ? Number(version.otherFee) : 0),
    );
    const beforeDiscount = round(lines + added);
    const afterLineDiscount = round(
      version.items.reduce(
        (sum, item) =>
          sum +
          round(
            Number(item.quantity) *
              Number(item.unitPrice) *
              (1 - (Number(item.discountPercent) || 0) / 100),
          ),
        0,
      ),
    );
    const net = round(afterLineDiscount + added - Number(version.discount));
    return {
      lines,
      added,
      beforeDiscount,
      net,
      total:
        version.taxMode === '含税样例'
          ? round(net + Number(version.vatAmount))
          : version.taxMode === '含税待确认'
            ? null
            : net,
    };
  }
  contact(s: SalesRecord): Contact | undefined {
    const contacts = this.customer(s.customerId)?.contacts || [];
    if (s.contactId) return contacts.find((c) => c.id === s.contactId);
    // Legacy drafts may predate their customer's first contact. Never guess among people.
    return contacts.length === 1 ? contacts[0] : undefined;
  }
  canOperateSale(sale: SalesRecord | undefined): boolean {
    if (!sale) return false;
    if (sale.type === 'opportunity') return true;
    if (
      sale.crmStatus === '无效线索' ||
      sale.crmStatus === '退回公海' ||
      sale.crmStatus === '已转商机'
    )
      return false;
    if (!['未分配', '已分配'].includes(sale.crmStatus || '')) return false;
    return true;
  }
  identityName(personId: string | undefined): string {
    return (
      DEMO_IDENTITY_BINDINGS.find((binding) => binding.personId === personId)?.displayName ||
      '演示账号待对应'
    );
  }
  leadsForCustomer(customerId: string): SalesRecord[] {
    return this.state().sales.filter(
      (sale) => sale.type === 'lead' && sale.customerId === customerId,
    );
  }
  activitiesForContact(customerId: string, contactId: string): Activity[] {
    return this.state()
      .activities.filter(
        (activity) => activity.customerId === customerId && activity.contactId === contactId,
      )
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  salesName(s: SalesRecord): string {
    const c = this.customer(s.customerId);
    return `${c?.country || '待补国家'} · ${c?.shortName || c?.name || '待补客户'} · ${s.projectName || '待补项目'} · ${s.capacity || '待补容量'}${s.unit}`;
  }
  attachments(id: string, kind?: string): Attachment[] {
    const leadId = this.sale(id)?.leadId;
    return this.state().attachments.filter(
      (x) => (x.entityId === id || x.entityId === leadId) && (!kind || x.kind === kind),
    );
  }
  has(id: string, kind: string): boolean {
    return this.attachments(id, kind).length > 0;
  }
  activities(id: string): Activity[] {
    const s = this.sale(id);
    const p = this.project(id);
    const ids = [id, s?.leadId, p?.opportunityId, this.sale(p?.opportunityId || '')?.leadId].filter(
      Boolean,
    );
    return this.state()
      .activities.filter((a) => ids.includes(a.entityId))
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  history(id: string): History[] {
    const migratedIds = new Set(
      (this.state().operationEvents || [])
        .filter((event) => event.legacy && event.objectId === id)
        .map((event) => event.legacyHistoryId),
    );
    return this.state()
      .history.filter((x) => x.entityId === id && !migratedIds.has(x.id))
      .slice()
      .reverse();
  }
  days(s: SalesRecord): number {
    return coolingDays(s, this.state().activities);
  }
  weighted(s: SalesRecord): number {
    return weightedAmount(s);
  }
  money(n: number, currency = 'CNY'): string {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  }
  private auditQuote(version: QuoteVersion, action: string, note = ''): void {
    version.audit.push({
      id: newId('QH'),
      action,
      person: this.person(),
      date: new Date().toISOString(),
      note,
    });
  }
  private quoteIn(state: DemoState, id: string): QuoteVersion | undefined {
    return state.quoteSeries
      ?.flatMap((series) => series.versions)
      .find((version) => version.id === id);
  }
  private seriesByVersion(id: string): QuoteSeries | undefined {
    return this.state().quoteSeries?.find((series) =>
      series.versions.some((version) => version.id === id),
    );
  }
  private allowQuoteAction(versionId: string): boolean {
    const series = this.seriesByVersion(versionId);
    const opportunity = series && this.sale(series.opportunityId);
    if (!opportunity) return this.ui.fail('没有找到报价来源商机');
    return (
      !isClosed(opportunity) || this.ui.fail('商机已关闭，报价历史只读，不能继续审核、发出或锁定')
    );
  }
  createQuote(opportunityId: string): string | null {
    const opportunity = this.sale(opportunityId);
    if (
      !opportunity ||
      opportunity.type !== 'opportunity' ||
      opportunity.stage === '意向沟通' ||
      isClosed(opportunity)
    ) {
      this.ui.fail('请先进入方案报价阶段后再创建报价');
      return null;
    }
    const existing = this.quoteSeries(opportunityId);
    if (existing) {
      const draft = existing.versions.find((version) =>
        ['草稿', '退回补充'].includes(version.status),
      );
      if (draft) return draft.id;
      this.ui.fail('报价系列已存在，请从现有版本创建新版');
      return null;
    }
    const seriesId = newId('Q');
    const sourceConfirmation = this.solutionConfirmation(opportunityId);
    const sourceCosting = this.solutionDocuments(opportunityId)?.costings.at(-1);
    const sourceRows =
      sourceConfirmation && sourceCosting?.confirmationId === sourceConfirmation.id
        ? sourceCosting.rows
        : [];
    const sourceReady =
      !!sourceConfirmation &&
      !!sourceCosting &&
      (opportunity.productNeeds || []).every((need) =>
        sourceRows.some(
          (row) => row.productNeedId === need.id && row.guidePrice !== null && row.cost !== null,
        ),
      );
    const version: QuoteVersion = {
      id: newId('QV'),
      crmSchemaVersion: 1,
      crmCalculationPolicy: CRM_QUOTE_DEMO_POLICY.id,
      crmCreatedOn: BASE_DATE,
      seriesId,
      number: 1,
      sourceVersionId: '',
      status: '草稿',
      title: opportunity.projectName || '项目报价',
      sellerEntity: '',
      customerId: opportunity.customerId,
      contactId: opportunity.contactId,
      owner: opportunity.owner,
      country: this.customer(opportunity.customerId)?.country || '',
      currency: opportunity.currency,
      tradeTerm: opportunity.tradeTerm,
      tradeNote: '',
      plannedSendDate: BASE_DATE,
      validUntil: '',
      scope: '',
      delivery: '',
      payment: '',
      warranty: '',
      service: '',
      solutionSummary: '',
      boundaries: '',
      notes: '',
      items: sourceReady
        ? (opportunity.productNeeds || [])
            .map((need) => {
              const costing = sourceRows.find((row) => row.productNeedId === need.id);
              if (!costing || costing.guidePrice === null) return null;
              return {
                id: newId('QI'),
                productNeedId: need.id,
                category: '货物',
                name: productNeedLabel(need),
                spec: '',
                unit: need.unit,
                quantity: need.quantity,
                unitPrice: costing.guidePrice,
                discountPercent: 0,
                guidePrice: costing.guidePrice,
                guideCurrency: costing.currency,
                guideUnit: costing.unit,
                guideQuantity: costing.quantity,
                guideTaxBasis: costing.taxBasis,
                guideCostingId: sourceCosting?.id,
                source: `商机产品行 ${need.id} · ${sourceCosting?.id || '待核价'}`,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
        : [],
      freightAmount: 0,
      freightTreatment: '已含在明细',
      dutyAmount: 0,
      dutyTreatment: '由客户另付',
      otherFee: 0,
      otherFeeTreatment: '已含在明细',
      discount: 0,
      sourceAttachmentIds: [],
      taxMode: '不含税报价',
      vatAmount: 0,
      taxNote: '',
      taxReview: '待确认',
      taxReviewBy: '',
      taxReviewDate: '',
      costs: { goods: null, logistics: null, delivery: null, service: null, source: '' },
      reviewBy: '',
      reviewDate: '',
      reviewNote: '',
      conditions: [],
      lockRequestedBy: '',
      lockRequestedDate: '',
      sentDate: '',
      sentMethod: '',
      sentTo: '',
      sentEvidence: '',
      acceptedBy: '',
      acceptedDate: '',
      acceptedEvidence: '',
      lockedBy: '',
      lockedDate: '',
      invalidationReason: '',
      feedback: [],
      audit: [],
    };
    const currencyId = this.crmQuoteCatalog().references.find(
      (row) =>
        row.entity === 'transactioncurrency' && row.data['isocurrencycode'] === version.currency,
    )?.id;
    version.crmFields = {
      opportunityid: opportunityId,
      customerid: opportunity.customerId,
      alp_bdmanager: opportunity.owner,
      transactioncurrencyid: currencyId || null,
      closedon: addCrmDays(BASE_DATE, 30),
      alp_isintax: 20,
      alp_tax_rate: 0,
    };
    version.validUntil = String(version.crmFields['closedon']);
    version.items = [];
    this.auditQuote(version, '创建报价草稿', 'V1');
    const ok = this.write((state) => {
      state.quoteSeries ||= [];
      state.quoteSeries.push({
        id: seriesId,
        number: `DEMO-Q-${Date.now().toString().slice(-6)}`,
        opportunityId,
        versions: [version],
        activeFinalVersionId: '',
        createdBy: this.person(),
        createdDate: BASE_DATE,
      });
      version.crmFields!['quotenumber'] = state.quoteSeries.at(-1)!.number;
      version.crmFields!['revisionnumber'] = 0;
      this.syncQuoteSources(state, state.quoteSeries.at(-1)!.versions[0]);
      state.sales.find((sale) => sale.id === opportunityId)!.quoteFlowMode = 'v2';
      this.log(state, opportunityId, '启用V2报价流程并创建V1草稿');
    }, '报价V1草稿已创建');
    return ok ? version.id : null;
  }
  quoteSourceCandidates(opportunityId: string): Attachment[] {
    const opportunity = this.sale(opportunityId);
    const solution = this.solution(opportunityId);
    const documentId = solution?.versions.find(
      (x) => x.id === solution.latestVersionId,
    )?.documentId;
    const entities = [opportunityId, opportunity?.leadId].filter(Boolean);
    return this.state().attachments.filter(
      (a) =>
        entities.includes(a.entityId) &&
        (a.id === documentId ||
          ['需求导入表', '核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'].includes(a.kind)),
    );
  }
  ensureTechnicalDemoFiles(opportunityId: string): boolean {
    if (!this.salesEditable() || this.sale(opportunityId)?.type !== 'opportunity') return false;
    const files = [
      { kind: '核心技术方案', name: 'DEMO_Technical_Proposal.html' },
      { kind: '单线图（SLD）', name: 'DEMO_SLD.svg' },
      { kind: 'BOM清单', name: 'DEMO_BOM.csv' },
      { kind: '衰减曲线', name: 'DEMO_Degradation.csv' },
    ];
    const missing = files.filter(
      (file) =>
        !this.quoteSourceCandidates(opportunityId).some(
          (item) => item.operationId === `technical-demo-${opportunityId}-${file.kind}`,
        ),
    );
    if (!missing.length) return true;
    return this.write((state) => {
      for (const file of missing)
        state.attachments.push({
          id: newId('ATT'),
          entityId: opportunityId,
          kind: file.kind,
          name: file.name,
          size: 0,
          date: BASE_DATE,
          operator: this.person(),
          sample: true,
          url: `demo/technical/${file.name}`,
          mode: 'simulated',
          operationId: `technical-demo-${opportunityId}-${file.kind}`,
          note: '演示假设数据，仅供流程演示，不作为设计、采购或性能承诺。',
        });
    }, '技术初判演示文件已关联，请在下拉框选择');
  }
  technicalEvidenceMissing(opportunityId: string, evidenceIds?: string[]): string[] {
    const requiredKinds = ['核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'];
    const candidates = this.quoteSourceCandidates(opportunityId);
    return requiredKinds.filter((kind) => {
      const applicable = candidates.filter((item) => item.kind === kind);
      return (
        !applicable.length ||
        (evidenceIds ? !applicable.some((item) => evidenceIds.includes(item.id)) : false)
      );
    });
  }
  quoteSourceFiles(versionId: string): Attachment[] {
    const version = this.quoteVersion(versionId);
    const series = this.seriesByVersion(versionId);
    if (!version || !series) return [];
    const sale = this.sale(series.opportunityId);
    return this.state().attachments.filter(
      (a) =>
        version.sourceAttachmentIds.includes(a.id) &&
        [series.opportunityId, sale?.leadId].includes(a.entityId),
    );
  }
  quoteSourceDifferences(versionId: string): string[] {
    if (this.quoteVersion(versionId)?.crmSchemaVersion === 1) return [];
    const version = this.quoteVersion(versionId);
    const series = this.seriesByVersion(versionId);
    const sale = series && this.sale(series.opportunityId);
    if (!version || !sale) return [];
    const differences: string[] = [];
    const customer = this.customer(sale.customerId);
    if (version.customerId !== sale.customerId) differences.push('来源商机客户发生变化');
    if (version.contactId !== sale.contactId) differences.push('来源商机联系人发生变化');
    if (version.owner !== sale.owner) differences.push('来源商机负责人发生变化');
    if (customer && version.country !== customer.country)
      differences.push(`客户国家变化：${version.country} → ${customer.country}`);
    if (version.currency !== sale.currency)
      differences.push(`商机币种变化：${version.currency} → ${sale.currency}`);
    const current = sale.productNeeds || [];
    const known = new Map(
      version.items.filter((item) => item.productNeedId).map((item) => [item.productNeedId!, item]),
    );
    differences.push(
      ...current.flatMap((need) => {
        const old = known.get(need.id);
        if (!old) return [`新增需求行：${productNeedLabel(need)}（${need.quantity} ${need.unit}）`];
        known.delete(need.id);
        return old.name !== productNeedLabel(need) ||
          old.quantity !== need.quantity ||
          old.unit !== need.unit
          ? [
              `需求行变化：${old.name} ${old.quantity} ${old.unit} → ${productNeedLabel(need)} ${need.quantity} ${need.unit}`,
            ]
          : [];
      }),
    );
    differences.push(...[...known.values()].map((item) => `商机需求已删除：${item.name}`));
    if (
      version.costingId &&
      version.items.some((item) => item.productNeedId && item.guideCostingId !== version.costingId)
    )
      differences.push('报价行引用的核价记录与当前报价采用的核价不一致');
    const confirmation = this.solutionConfirmation(sale.id);
    const latestCosting = this.solutionDocuments(sale.id)
      ?.costings.filter((row) => row.confirmationId === confirmation?.id)
      .at(-1);
    if (
      confirmation &&
      (version.sourceSolutionConfirmationId !== confirmation.id ||
        version.costingId !== latestCosting?.id)
    )
      differences.push('当前方案确认/核价依据已变化');
    return differences;
  }
  adoptQuoteSources(versionId: string): boolean {
    if (this.quoteVersion(versionId)?.crmSchemaVersion === 1)
      return this.ui.fail('当前报价采用标准CRM本地资料，请直接维护摘要与明细');
    const version = this.quoteVersion(versionId);
    const series = this.seriesByVersion(versionId);
    const sale = series && this.sale(series.opportunityId);
    const confirmation = sale && this.solutionConfirmation(sale.id);
    const costing =
      sale &&
      this.solutionDocuments(sale.id)
        ?.costings.filter((row) => row.confirmationId === confirmation?.id)
        .at(-1);
    if (!version || !sale || !confirmation || !costing)
      return this.ui.fail('需先完成方案确认和当前配置核价');
    if (
      (sale.productNeeds || []).some((need) => {
        const row = costing.rows.find((item) => item.productNeedId === need.id);
        return (
          !row ||
          row.cost === null ||
          row.guidePrice === null ||
          !row.currency ||
          !row.unit ||
          !row.taxBasis ||
          row.quantity !== need.quantity ||
          row.unit !== need.unit
        );
      })
    )
      return this.ui.fail('当前核价缺少产品行或完整口径，不能采纳为报价来源');
    if (!['草稿', '退回补充'].includes(version.status) || (version.discountApprovalCount || 0) > 0)
      return this.ui.fail('当前报价版已锁定或已进入审批，不能更新来源');
    const items = (sale.productNeeds || []).map((need) => {
      const old = version.items.find((item) => item.productNeedId === need.id);
      const row = costing.rows.find((item) => item.productNeedId === need.id);
      return {
        id: old?.id || newId('QI'),
        productNeedId: need.id,
        category: old?.category || '货物',
        name: productNeedLabel(need),
        spec: old?.spec || '',
        unit: need.unit,
        quantity: need.quantity,
        unitPrice: old?.unitPrice ?? row!.guidePrice!,
        discountPercent: old?.discountPercent || 0,
        guidePrice: row?.guidePrice ?? null,
        guideCurrency: row?.currency,
        guideUnit: row?.unit,
        guideQuantity: row?.quantity,
        guideTaxBasis: row?.taxBasis,
        guideCostingId: costing.id,
        source: `商机产品行 ${need.id} · ${costing.id}`,
      };
    });
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!;
      target.customerId = sale.customerId;
      target.contactId = sale.contactId;
      target.owner = sale.owner;
      target.country = this.customer(sale.customerId)?.country || target.country;
      target.currency = sale.currency;
      target.countryChangeConfirmed = true;
      target.items = items;
      target.costingId = costing.id;
      target.sourceSolutionConfirmationId = confirmation.id;
      target.sourceDocumentVersions = { ...confirmation.documentVersions };
      target.sourceProductNeedRevision = sale.productNeedRevision || 0;
      target.sourceDiff = [];
      target.sourceAdoptedAt = new Date().toISOString();
      target.contentRevision = (target.contentRevision || 0) + 1;
      this.auditQuote(target, '销售确认采用当前商机/方案/核价来源');
    }, '已按销售确认更新需求行和核价来源；保留原有行价格输入');
  }
  private syncQuoteSources(state: DemoState, version: QuoteVersion): void {
    if (version.crmSchemaVersion === 1) return;
    const series = state.quoteSeries!.find((x) => x.id === version.seriesId)!;
    const opportunity = state.sales.find((x) => x.id === series.opportunityId);
    const solution = state.solutionSeries?.find((x) => x.opportunityId === series.opportunityId);
    const latest = solution?.versions.find((x) => x.id === solution.latestVersionId);
    const entities = [series.opportunityId, opportunity?.leadId];
    const files = state.attachments.filter(
      (a) => entities.includes(a.entityId) && a.kind === '需求导入表',
    );
    const allCoreIds = new Set(solution?.versions.map((x) => x.documentId) || []);
    const solutionDocs = state.solutionDocuments?.find(
      (item) => item.opportunityId === series.opportunityId,
    );
    const confirmation = solutionDocs?.confirmations.at(-1);
    const kinds: SolutionDocumentKind[] = ['技术方案', 'TIC', '设计BOM', 'SLD'];
    const confirmedDocs =
      confirmation &&
      confirmation.productNeedRevision === (opportunity?.productNeedRevision || 0) &&
      kinds.every((kind) => confirmation.documentVersions[kind] === solutionDocs?.current[kind]);
    const confirmedDocumentIds = confirmedDocs
      ? kinds
          .map(
            (kind) =>
              solutionDocs!.versions.find(
                (item) => item.id === confirmation!.documentVersions[kind],
              )?.documentId,
          )
          .filter((id): id is string => !!id)
      : [];
    version.sourceAttachmentIds = [
      ...new Set([
        ...version.sourceAttachmentIds.filter(
          (id) =>
            !allCoreIds.has(id) &&
            state.attachments.some((a) => a.id === id && entities.includes(a.entityId)),
        ),
        ...files.map((x) => x.id),
        ...(latest ? [latest.documentId] : []),
        ...confirmedDocumentIds,
      ]),
    ];
    version.solutionVersionId = latest?.id || '';
    const costing = solutionDocs?.costings
      .filter((item) => item.confirmationId === confirmation?.id)
      .at(-1);
    if (confirmedDocs && confirmation) {
      version.sourceSolutionConfirmationId ??= confirmation.id;
      version.sourceDocumentVersions ??= { ...confirmation.documentVersions };
      if (costing && !version.costingId) version.costingId = costing.id;
    }
    const needRevision = opportunity?.productNeedRevision || 0;
    version.sourceProductNeedRevision ??= needRevision;
    version.sourceAdoptedAt ??= new Date().toISOString();
  }
  crmQuoteCatalog(): CrmCatalog {
    const state = this.state();
    const references = [
      ...CRM_QUOTE_CATALOG.references,
      ...state.customers.map((customer) => ({
        id: customer.id,
        entity: 'account',
        label: customer.name,
        workspace: true,
        data: {},
      })),
      ...state.sales
        .filter((sale) => sale.type === 'opportunity')
        .map((sale) => ({
          id: sale.id,
          entity: 'opportunity',
          label: sale.projectName || sale.id,
          workspace: true,
          data: {},
        })),
      ...[...new Set(state.sales.map((sale) => sale.owner).filter(Boolean))].map((owner) => ({
        id: owner,
        entity: 'systemuser',
        label: owner,
        workspace: true,
        data: {},
      })),
    ];
    return withCrmQuoteDemoCatalog({ ...CRM_QUOTE_CATALOG, references });
  }
  crmQuoteDraft(version: QuoteVersion): QuoteVersion {
    const draft = structuredClone(version);
    const series = this.seriesByVersion(version.id);
    const catalog = this.crmQuoteCatalog();
    draft.crmFields = crmDraftFields(version, series?.opportunityId || '', series?.number || '');
    draft.crmFields['quotenumber'] = series?.number || '';
    draft.crmFields['revisionnumber'] = version.number - 1;
    draft.crmFields['opportunityid'] = series?.opportunityId || '';
    if (draft.crmFields['transactioncurrencyid'] == null)
      draft.crmFields['transactioncurrencyid'] =
        catalog.references.find(
          (row) =>
            row.entity === 'transactioncurrency' &&
            row.data['isocurrencycode'] === version.currency,
        )?.id || null;
    if (draft.crmFields['alp_isintax'] == null && version.taxMode.includes('不含税')) {
      draft.crmFields['alp_isintax'] = 20;
      draft.crmFields['alp_tax_rate'] = 0;
    }
    draft.items = version.items.map((item) => ({ ...item, crmFields: crmLineFields(item, draft) }));
    return draft;
  }
  saveCrmQuote(input: QuoteVersion): boolean {
    if (!this.allowQuoteAction(input.id)) return false;
    const stored = this.quoteVersion(input.id);
    const series = this.seriesByVersion(input.id);
    if (!stored || !series || !['草稿', '退回补充'].includes(stored.status))
      return this.ui.fail('当前报价不可编辑');
    if (this.quoteContentLocked(stored)) return this.ui.fail('本版本低价特批已成功，请创建新版');
    if ((stored.contentRevision || 0) !== (input.contentRevision || 0))
      return this.ui.fail('报价内容已更新，请刷新后保存');
    const catalog = this.crmQuoteCatalog();
    const draft = this.crmQuoteDraft(stored);
    const f = draft.crmFields!;
    for (const field of CRM_SUMMARY_FIELDS) {
      if (!field.readonly && Object.hasOwn(input.crmFields || {}, field.name))
        f[field.name] = input.crmFields![field.name];
    }
    if (stored.crmSchemaVersion === 1 && stored.items.length) {
      for (const name of ['transactioncurrencyid', 'alp_price_list', 'alp_salesbranch']) {
        if ((stored.crmFields?.[name] ?? null) !== (f[name] ?? null))
          return this.ui.fail('已有报价明细，币种、价目表与销售组织不可更改');
      }
    }
    if (f['alp_isintax'] === 20) f['alp_tax_rate'] = 0;
    if (String(f['customerid'] || '') !== stored.customerId)
      return this.ui.fail('报价客户须与本地来源商机关联一致');
    draft.crmSchemaVersion = 1;
    draft.crmCalculationPolicy = CRM_QUOTE_DEMO_POLICY.id;
    draft.crmCreatedOn ||= BASE_DATE;
    const ids = new Set<string>();
    draft.items = [];
    for (const item of input.items) {
      if (!item.id || ids.has(item.id)) return this.ui.fail('报价明细ID重复或缺失');
      ids.add(item.id);
      const line: CrmValues = {};
      for (const field of CRM_DETAIL_FIELDS)
        if (!field.readonly) line[field.name] = item.crmFields?.[field.name] ?? null;
      line['quoteid'] = stored.id;
      line['alp_quotedetailnumber'] = item.id;
      line['transactioncurrencyid'] = f['transactioncurrencyid'] ?? null;
      const priced = applyCrmProduct(line, f, catalog);
      if (line['quantity'] != null && !Number.isInteger(line['quantity']))
        return this.ui.fail('数量必须为整数');
      const calculated = persistCrmFields(
        calculateCrmLine(priced, item.crmPriceInput || ''),
        CRM_DETAIL_FIELDS,
      );
      draft.items.push({ ...item, crmFields: calculated });
    }
    Object.assign(f, persistCrmFields({ ...f, ...crmAggregate(draft.items) }, CRM_SUMMARY_FIELDS));
    syncCrmAliases(draft, catalog);
    const errors = crmQuoteErrors(draft, catalog, true).filter(
      (error) => error !== '请添加报价明细',
    );
    if (errors.length) return this.ui.fail(errors.join('；'));
    const selectedReferences = new Set(
      [
        ...Object.values(f),
        ...draft.items.flatMap((item) => Object.values(item.crmFields || {})),
      ].filter((value): value is string => typeof value === 'string'),
    );
    const selectedSkus = new Set(draft.items.map((item) => item.crmFields?.['alp_skuid']));
    draft.crmReferenceSnapshot = structuredClone({
      ...catalog,
      references: catalog.references.filter((row) => selectedReferences.has(row.id)),
      prices: catalog.prices.filter(
        (row) => selectedReferences.has(row.productId) && selectedReferences.has(row.priceListId),
      ),
      rates: catalog.rates.filter((row) => row.currencyId === f['transactioncurrencyid']),
      paymentStages: catalog.paymentStages.filter((row) => row.termId === f['alp_paymenttermsid']),
      skuLinks: catalog.skuLinks.filter((row) => selectedSkus.has(row.skuId)),
    });
    return this.write(
      (state) => {
        const target = this.quoteIn(state, input.id)!;
        Object.assign(target, draft);
        target.contentRevision = (stored.contentRevision || 0) + 1;
        this.auditQuote(target, '保存报价草稿', '标准CRM摘要与明细表单；固定演示口径V1');
        this.log(state, series.id, '保存报价草稿');
      },
      '报价草稿已保存',
      this.moduleOperation(
        'quote-version',
        stored.id,
        series.opportunityId,
        'quote-workspace',
        '销售',
        '报价',
        '保存报价草稿',
        stored.owner,
        'quote-draft',
        stored.id,
        [{ field: 'quoteVersion', valueType: 'object', before: stored, after: draft }],
      ),
    );
  }
  private submitCrmQuote(versionId: string): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    const version = this.quoteVersion(versionId);
    const series = this.seriesByVersion(versionId);
    if (!version || !series || !['草稿', '退回补充'].includes(version.status))
      return this.ui.fail('当前版本不能提交审核');
    const errors = crmQuoteErrors(version, this.crmQuoteCatalog(), true);
    if (errors.length) return this.ui.fail(errors.join('；'));
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        target.status = '待模拟审核';
        target.submittedRevision = target.contentRevision || 0;
        target.reviewBy = '';
        target.reviewDate = '';
        target.reviewNote = '';
        target.invalidationReason = '';
        this.auditQuote(target, '提交模拟审核');
        this.notice(
          state,
          `quote-review-${versionId}`,
          series.opportunityId,
          'manager',
          '报价待模拟审核',
          target.title,
        );
        this.log(state, series.id, `提交报价V${target.number}模拟审核`);
      },
      '报价已提交审核',
      this.moduleOperation(
        'quote-version',
        versionId,
        series.opportunityId,
        'quote-workspace',
        '销售',
        '审核',
        '提交模拟审核',
        version.owner,
        'quote-review',
        versionId,
        [{ field: 'status', valueType: 'string', before: version.status, after: '待模拟审核' }],
      ),
    );
  }
  recordCrmCustomerDecision(
    versionId: string,
    result: '接受' | '不接受',
    person: string,
    evidence: string,
    date: string,
  ): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    const version = this.quoteVersion(versionId);
    const series = this.seriesByVersion(versionId);
    if (!version || !series || version.status !== '已记录发出' || version.crmSchemaVersion !== 1)
      return this.ui.fail('请先发出当前报价');
    if (!['接受', '不接受'].includes(result)) return this.ui.fail('客户最终结果只能是接受或不接受');
    if (!this.customer(version.customerId)?.contacts.some((contact) => contact.name === person))
      return this.ui.fail('请选择当前客户名下的确认人');
    if (version.customerDecision || version.acceptedBy)
      return this.ui.fail('已记录最终结果，请创建新版保留原有依据');
    if (
      !person.trim() ||
      !evidence.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date > BASE_DATE ||
      date < version.sentDate
    )
      return this.ui.fail('请填写确认人、凭据及发出日至演示基准日之间的日期');
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        target.customerDecision = result;
        if (result === '接受') {
          target.acceptedBy = person;
          target.acceptedDate = date;
          target.acceptedEvidence = evidence;
        }
        this.auditQuote(target, `客户${result}报价`, `${date}；${person}；${evidence}`);
        this.log(state, series.id, `报价V${target.number}客户${result}`);
      },
      `已记录客户${result}`,
      this.moduleOperation(
        'quote-version',
        versionId,
        series.opportunityId,
        'quote-workspace',
        '销售',
        '发出与反馈',
        '记录客户最终结果',
        version.owner,
        'quote-feedback',
        versionId,
        [{ field: 'customerDecision', valueType: 'string', before: '', after: result }],
      ),
    );
  }
  saveQuote(version: QuoteVersion): boolean {
    if (version.crmSchemaVersion === 1 || this.quoteVersion(version.id)?.crmSchemaVersion === 1)
      return this.saveCrmQuote(version);
    const extensionError = quoteExtensionFieldError(version.crmFields);
    if (extensionError) return this.ui.fail(extensionError);
    if (!this.allowQuoteAction(version.id)) return false;
    const customer = this.customer(version.customerId);
    if (!customer) return this.ui.fail('请选择客户库中的客户主体');
    const source = this.sale(this.seriesByVersion(version.id)?.opportunityId || '');
    if (source?.customerId !== version.customerId)
      return this.ui.fail('报价客户与来源商机不一致，请核对关联');
    if (!customer.contacts.some((contact) => contact.id === version.contactId))
      return this.ui.fail('请选择所选客户名下的联系人');
    if (!['草稿', '退回补充'].includes(version.status))
      return this.ui.fail('该报价版本已提交或发出，不能直接修改');
    const stored = this.quoteVersion(version.id);
    if (!stored) return this.ui.fail('没有找到报价版本');
    if (this.quoteContentLocked(stored))
      return this.ui.fail('本版本低价特批已成功，报价内容已锁定，请创建新版本');
    if ((stored.contentRevision || 0) !== (version.contentRevision || 0))
      return this.ui.fail('报价来源或内容已更新，请刷新后保存');
    if (!['草稿', '退回补充'].includes(stored.status))
      return this.ui.fail('当前报价已提交，不能保存旧草稿');
    if (stored.country !== version.country && !version.countryChangeConfirmed)
      return this.ui.fail('报价客户国家已变化；请明确确认后再将新国家写入当前草稿');
    return this.write(
      (state) => {
        const target = this.quoteIn(state, version.id)!;
        const taxChanged =
          target.sellerEntity !== version.sellerEntity ||
          target.country !== version.country ||
          target.currency !== version.currency ||
          target.tradeTerm !== version.tradeTerm ||
          target.taxMode !== version.taxMode ||
          target.vatAmount !== version.vatAmount ||
          target.freightAmount !== version.freightAmount ||
          target.freightTreatment !== version.freightTreatment ||
          target.dutyAmount !== version.dutyAmount ||
          target.dutyTreatment !== version.dutyTreatment;
        const previousSources = target.sourceAttachmentIds;
        Object.assign(target, structuredClone(version));
        target.countryChangeConfirmed = false;
        target.sourceAttachmentIds = [
          ...new Set([...previousSources, ...target.sourceAttachmentIds]),
        ];
        this.syncQuoteSources(state, target);
        for (const key of [
          'freightAmount',
          'dutyAmount',
          'otherFee',
          'discount',
          'vatAmount',
        ] as const)
          target[key] = Number(target[key] || 0);
        if (taxChanged) {
          target.taxReview = '需重新确认';
          target.taxReviewBy = '';
          target.taxReviewDate = '';
        }
        target.contentRevision = (target.contentRevision || 0) + 1;
        this.auditQuote(target, '保存报价草稿');
        this.log(state, target.seriesId, '保存报价草稿');
      },
      '报价草稿已保存',
      this.moduleOperation(
        'quote-version',
        version.id,
        source.id,
        'quote-workspace',
        '销售',
        '报价',
        '保存报价草稿',
        source.owner,
        'quote-draft',
        version.id,
        [{ field: 'quoteVersion', valueType: 'object', before: stored, after: version }],
      ),
    );
  }
  addQuoteItem(versionId: string, item: Omit<QuoteItem, 'id'>, expectedRevision?: number): boolean {
    const version = this.quoteVersion(versionId);
    if (!version || !['草稿', '退回补充'].includes(version.status))
      return this.ui.fail('当前版本不可编辑');
    if (expectedRevision !== undefined && (version.contentRevision || 0) !== expectedRevision)
      return this.ui.fail('报价内容已更新，请刷新后保存');
    return this.saveQuote({
      ...structuredClone(version),
      items: [...version.items, { ...item, id: newId('QI') }],
    });
  }
  attachQuoteSource(versionId: string, attachmentId: string): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    const version = this.quoteVersion(versionId);
    const series = this.seriesByVersion(versionId);
    if (!version || !series || !['草稿', '退回补充'].includes(version.status))
      return this.ui.fail('仅草稿版本可以补充来源引用');
    if (this.quoteContentLocked(version))
      return this.ui.fail('低价特批成功后来源依据锁定，请创建新版本');
    const attachment = this.quoteSourceCandidates(series.opportunityId).find(
      (item) => item.id === attachmentId && ['核心技术方案', '需求导入表'].includes(item.kind),
    );
    if (!attachment) return this.ui.fail('没有找到可引用的需求或方案资料');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!;
      if (!target.sourceAttachmentIds.includes(attachmentId))
        target.sourceAttachmentIds.push(attachmentId);
      this.auditQuote(target, '引用来源资料', attachment.name);
    }, '报价来源资料已引用');
  }
  saveQuoteCosts(
    versionId: string,
    costs: QuoteVersion['costs'],
    expectedRevision?: number,
  ): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    const v = this.quoteVersion(versionId);
    if (v && this.quoteContentLocked(v))
      return this.ui.fail('本版本低价特批已成功，成本依据已锁定');
    if (!v || !['草稿', '退回补充'].includes(v.status))
      return this.ui.fail('成本参考只在报价草稿阶段维护');
    if (expectedRevision !== undefined && (v.contentRevision || 0) !== expectedRevision)
      return this.ui.fail('报价内容已更新，请刷新后保存');
    if (
      [costs.goods, costs.logistics, costs.delivery, costs.service].some(
        (amount) => amount !== null && (!Number.isFinite(amount) || amount < 0),
      )
    )
      return this.ui.fail('成本金额须为非负数字或留空表示未提供');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!;
      target.costs = structuredClone(costs);
      this.auditQuote(target, '更新内部成本参考', costs.source);
    }, '成本参考已保存，不计入客户报价');
  }
  saveQuoteSolution(
    versionId: string,
    summary: string,
    boundaries: string,
    expectedRevision?: number,
  ): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    const v = this.quoteVersion(versionId);
    if (v && this.quoteContentLocked(v))
      return this.ui.fail('本版本低价特批已成功，方案依据已锁定');
    if (!v || !['草稿', '退回补充'].includes(v.status))
      return this.ui.fail('仅草稿报价可以维护方案摘要');
    if (expectedRevision !== undefined && (v.contentRevision || 0) !== expectedRevision)
      return this.ui.fail('报价内容已更新，请刷新后保存');
    if (!summary || !boundaries) return this.ui.fail('请填写方案摘要和范围边界');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!;
      target.solutionSummary = summary;
      target.boundaries = boundaries;
      target.contentRevision = (target.contentRevision || 0) + 1;
      this.auditQuote(target, '更新方案摘要及范围边界');
    }, '方案资料已更新');
  }
  removeQuoteItem(versionId: string, itemId: string): boolean {
    const version = this.quoteVersion(versionId);
    if (!version) return false;
    return this.saveQuote({
      ...structuredClone(version),
      items: version.items.filter((item) => item.id !== itemId),
    });
  }
  /** 同一来源查询核对已提交的版本/需求身份；Blob在上传、定稿及采用时真实核验。
   * null只跳过物理存在性检查，不跳过版本元数据、真实来源或需求有效性。
   */
  private checkQuoteSolutionBasis(versionId: string): boolean {
    const quote = this.quoteVersion(versionId);
    if ((this.state().storageSchemaVersion ?? 0) < 3 && quote?.crmSchemaVersion !== 1 && !quote?.solutionBasis) return true;
    const view = selectQuoteSolutionBasis(this.state(), versionId, null, this.v9CommandTarget());
    return (
      !view.submitIssues.length ||
      this.ui.fail(
        `方案依据不能继续推进：${view.submitIssues.map((i) => i.message).join('；')}。请在方案页重新定稿，再在草稿显式采用；审核中可退回补充，已发报价请创建新版。`,
      )
    );
  }
  submitQuote(versionId: string): boolean {
    if (!this.checkQuoteSolutionBasis(versionId)) return false;
    if (this.quoteVersion(versionId)?.crmSchemaVersion === 1) return this.submitCrmQuote(versionId);
    if (!this.allowQuoteAction(versionId)) return false;
    const v = this.quoteVersion(versionId);
    if (!v || !['草稿', '退回补充'].includes(v.status))
      return this.ui.fail('当前报价版本不能提交审核');
    if (
      [
        v.freightAmount,
        v.dutyAmount,
        v.otherFee,
        v.discount,
        v.vatAmount,
        ...v.items.flatMap((item) => [item.quantity, item.unitPrice]),
      ].some((amount) => !Number.isFinite(Number(amount)) || Number(amount) < 0)
    )
      return this.ui.fail('报价金额、费用和数量必须是非负数字');
    const gate = this.quoteGate(this.seriesByVersion(versionId)!.opportunityId, versionId);
    if (gate.length)
      return this.ui.fail(`正式报价前请补齐：${gate.map((x) => x.label).join('、')}`);
    const totals = this.quoteTotals(v);
    const sourceFiles = this.quoteSourceFiles(versionId);
    const missing = [
      !v.title ? '报价标题' : '',
      !v.sellerEntity ? '交易主体' : '',
      !v.contactId ? '主要联系人' : '',
      !v.owner ? '销售负责人' : '',
      !v.tradeTerm ? '贸易条款' : '',
      v.tradeTerm === '其他' && !v.tradeNote ? '其他贸易条款说明' : '',
      !v.plannedSendDate ? '计划发出日期' : '',
      !v.validUntil ? '有效期截止日' : '',
      v.validUntil && v.plannedSendDate && v.validUntil < v.plannedSendDate
        ? '有效期不能早于计划发出日'
        : '',
      !v.scope ? '交付范围' : '',
      !v.delivery ? '交期说明' : '',
      !v.payment ? '付款条件' : '',
      !v.warranty ? '质保说明' : '',
      !v.solutionSummary ? '方案摘要' : '',
      !v.boundaries ? '方案边界' : '',
      !sourceFiles.length ? '引用需求表或方案报价资料' : '',
      !v.items.length ? '至少一条报价明细' : '',
      v.items.some(
        (item) =>
          !item.name ||
          !item.unit ||
          !Number.isFinite(item.quantity) ||
          item.quantity <= 0 ||
          !Number.isFinite(item.unitPrice) ||
          item.unitPrice < 0,
      )
        ? '明细名称、单位、数量和单价'
        : '',
      v.items.some(
        (item) =>
          !Number.isFinite(item.discountPercent || 0) ||
          (item.discountPercent || 0) < 0 ||
          (item.discountPercent || 0) > 100,
      )
        ? '行折扣须为0到100之间的降价百分比'
        : '',
      v.items.some((item) => item.productNeedId && this.guideComparison(item, v) === '缺少核价')
        ? '商机产品行缺少有效模拟核价，不能按零价继续'
        : '',
      v.items.some((item) => item.unitPrice === 0 && !item.source) ? '零金额明细的说明' : '',
      totals.net <= 0 ? '未税报价合计需大于零' : '',
      v.discount > totals.beforeDiscount ? '优惠金额不能超过报价金额' : '',
    ].filter(Boolean);
    if (missing.length) return this.ui.fail(`提交前请补齐：${missing.join('、')}`);
    if (v.taxMode === '含税待确认' && !v.taxNote)
      return this.ui.fail('含税待确认时请填写待财务确认问题');
    if (v.taxReview !== '样例已确认' && !v.taxNote)
      return this.ui.fail('财务口径待确认时请记录待确认的问题，主管将在审核时看到');
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        target.status = '待模拟审核';
        target.submittedRevision = target.contentRevision || 0;
        target.reviewBy = '';
        target.reviewDate = '';
        target.reviewNote = '';
        for (const n of state.notices.filter(
          (x) =>
            x.entityId === this.seriesByVersion(versionId)!.opportunityId &&
            x.key.startsWith(`v4-recheck-${versionId}-`),
        ))
          n.resolved = true;
        this.auditQuote(target, '提交模拟审核');
        const series = state.quoteSeries!.find((item) => item.id === target.seriesId)!;
        this.notice(
          state,
          `quote-review-${versionId}`,
          series.opportunityId,
          'manager',
          '报价待模拟审核',
          `${target.title} V${target.number} · ${this.money(this.quoteTotals(target).net, target.currency)}`,
        );
        this.log(state, target.seriesId, `提交报价V${target.number}模拟审核`);
      },
      '报价已提交，通知销售主管模拟审核',
      this.moduleOperation(
        'quote-version',
        versionId,
        this.seriesByVersion(versionId)!.opportunityId,
        'quote-workspace',
        '销售',
        '审核',
        '提交模拟审核',
        this.sale(this.seriesByVersion(versionId)!.opportunityId)!.owner,
        'quote-review',
        versionId,
        [{ field: 'status', valueType: 'string', before: v.status, after: '待模拟审核' }],
      ),
    );
  }
  reviewQuote(
    versionId: string,
    result: '模拟审核通过' | '附条件通过' | '退回补充',
    note: string,
    condition = '',
    expectedRevision?: number,
  ): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    const v = this.quoteVersion(versionId);
    if (!v || v.status !== '待模拟审核') return this.ui.fail('报价当前不在待审核状态');
    if (v.crmSchemaVersion === 1 && result === '附条件通过')
      return this.ui.fail('请使用审核通过或退回补充');
    if (expectedRevision !== undefined && (v.contentRevision || 0) !== expectedRevision)
      return this.ui.fail('审核内容已更新，请刷新');
    if (result !== '退回补充' && !this.checkQuoteSolutionBasis(versionId)) return false;
    if (
      result !== '退回补充' &&
      (v.submittedRevision !== (v.contentRevision || 0) ||
        this.quoteGate(this.seriesByVersion(versionId)!.opportunityId, versionId).length)
    )
      return this.ui.fail('审核资料已过期或不完整，请重新提交');
    if (!note || (result === '附条件通过' && !condition))
      return this.ui.fail('请填写审核意见及附条件内容');
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        target.status = result;
        target.reviewBy = this.person();
        target.reviewDate = BASE_DATE;
        target.reviewNote = note;
        if (result === '附条件通过')
          target.conditions.push({
            id: newId('QC'),
            text: condition,
            owner: '张销售',
            due: '2026-10-20',
            closed: false,
            closedBy: '',
          });
        for (const n of state.notices.filter((item) => item.key === `quote-review-${versionId}`))
          n.resolved = true;
        const series = state.quoteSeries!.find((item) => item.id === target.seriesId)!;
        this.notice(
          state,
          `quote-result-${versionId}`,
          series.opportunityId,
          'sales',
          `报价${result}`,
          note,
        );
        this.auditQuote(target, result, note);
        this.log(state, target.seriesId, `报价V${target.number}${result}`);
      },
      `报价模拟审核结果：${result}`,
      this.moduleOperation(
        'quote-version',
        versionId,
        this.seriesByVersion(versionId)!.opportunityId,
        'quote-workspace',
        '主管',
        '审核',
        '保存模拟审核',
        this.sale(this.seriesByVersion(versionId)!.opportunityId)!.owner,
        'quote-review-result',
        versionId,
        [{ field: 'status', valueType: 'string', before: v.status, after: result }],
      ),
    );
  }
  closeQuoteCondition(versionId: string, conditionId: string, evidence: string): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    if (!evidence) return this.ui.fail('请填写条件关闭凭据');
    const v = this.quoteVersion(versionId);
    if (!v || v.status !== '附条件通过') return false;
    if (v.conditions.every(c => c.closed || c.id === conditionId) && !this.checkQuoteSolutionBasis(versionId)) return false;
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!;
      const condition = target.conditions.find((item) => item.id === conditionId);
      if (condition) {
        condition.closed = true;
        condition.closedBy = `${this.person()}：${evidence}`;
      }
      if (target.conditions.every((item) => item.closed)) target.status = '模拟审核通过';
      this.auditQuote(target, '关闭审核条件', evidence);
    }, '报价条件已记录');
  }
  confirmQuoteTax(versionId: string, result: '样例已确认' | '待财务确认', note: string): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    if (!note) return this.ui.fail('请记录财务样例意见或待确认问题');
    const version = this.quoteVersion(versionId);
    if (!version || !['草稿', '退回补充'].includes(version.status))
      return this.ui.fail('仅可在报价草稿或退回补充状态调整财务口径');
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        target.taxReview = result;
        target.taxReviewBy = this.person();
        target.taxReviewDate = BASE_DATE;
        target.taxNote = note;
        this.auditQuote(target, `财务口径${result}`, note);
      },
      `财务已记录：${result}（DEMO样例）`,
      this.moduleOperation(
        'quote-version',
        versionId,
        this.seriesByVersion(versionId)!.opportunityId,
        'quote-workspace',
        '财务',
        '税费口径',
        '记录税费口径',
        this.sale(this.seriesByVersion(versionId)!.opportunityId)!.owner,
        'quote-tax-review',
        versionId,
        [{ field: 'taxReview', valueType: 'string', before: version.taxReview, after: result }],
      ),
    );
  }
  recordQuoteSent(
    versionId: string,
    sentDate: string,
    method: string,
    recipient: string,
    evidence: string,
    expectedRevision?: number,
  ): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    const v = this.quoteVersion(versionId);
    if (!v || v.status !== '模拟审核通过') return this.ui.fail('只有模拟审核通过的报价可记录发出');
    if (expectedRevision !== undefined && (v.contentRevision || 0) !== expectedRevision)
      return this.ui.fail('报价内容已更新，请刷新后记录发出');
    const gate = this.quoteGate(this.seriesByVersion(versionId)!.opportunityId, versionId);
    if (gate.length) return this.ui.fail(`发出前请补齐：${gate.map((x) => x.label).join('、')}`);
    if (this.needsLowPriceApproval(v) && !this.lowPriceApprovalValid(v, sentDate))
      return this.ui.fail('低于指导价的报价缺少当前版本有效的独立特批；普通审核不能替代特批');
    if (!sentDate || !method || !recipient || !evidence)
      return this.ui.fail('请填写发出日期、方式、接收联系人和凭据说明');
    if (sentDate > BASE_DATE || (v.validUntil && sentDate > v.validUntil))
      return this.ui.fail('发出日期需在演示基准日和报价有效期内');
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        target.sentDate = sentDate;
        target.sentMethod = method;
        target.sentTo = recipient;
        target.sentEvidence = evidence;
        target.status = '已记录发出';
        const series = state.quoteSeries!.find((item) => item.id === target.seriesId)!;
        const opp = state.sales.find((item) => item.id === series.opportunityId)!;
        target.sentSnapshot = {
          customerId: target.customerId,
          customerName: this.customer(target.customerId)?.name || '',
          contactId: target.contactId,
          contactName: this.contact(opp)?.name || '',
          country: target.country,
          currency: target.currency,
          title: target.title,
          items: structuredClone(target.items),
          total: this.quoteTotals(target).total,
          solutionVersionId: target.solutionVersionId,
          sourceSolutionConfirmationId: target.sourceSolutionConfirmationId,
          sourceDocumentVersions: target.sourceDocumentVersions
            ? { ...target.sourceDocumentVersions }
            : undefined,
          costingId: target.costingId,
        };
        state.activities.push({
          id: newId('ACT'),
          entityId: opp.id,
          customerId: opp.customerId,
          date: sentDate,
          type: '报价发出',
          summary: `${series.number} V${target.number}报价已记录发出`,
          people: recipient,
          next: '等待客户反馈',
          operator: this.person(),
          stage: opp.stage,
        });
        this.auditQuote(target, '记录报价已发出', evidence);
        this.log(state, series.id, `报价V${target.number}已记录发出`);
      },
      '报价发出记录已保存（DEMO未发送邮件）',
      this.moduleOperation(
        'quote-version',
        versionId,
        this.seriesByVersion(versionId)!.opportunityId,
        'quote-workspace',
        '销售',
        '发出与反馈',
        '记录报价已发出',
        this.sale(this.seriesByVersion(versionId)!.opportunityId)!.owner,
        'quote-sent',
        versionId,
        [{ field: 'status', valueType: 'string', before: v.status, after: '已记录发出' }],
      ),
    );
  }
  addQuoteFeedback(versionId: string, feedback: Omit<QuoteFeedback, 'id'>): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    const v = this.quoteVersion(versionId);
    if (!v || !['已记录发出', '最终锁定'].includes(v.status))
      return this.ui.fail('请先记录报价发出');
    if (!feedback.date || !feedback.kind || !feedback.summary || feedback.date > BASE_DATE)
      return this.ui.fail('请填写有效日期、反馈类型和摘要');
    if (feedback.kind === '客户确认接受' && (!feedback.person || !feedback.evidence))
      return this.ui.fail('客户接受需记录确认人和凭据说明');
    if (feedback.kind === '客户确认接受' && v.acceptedBy)
      return this.ui.fail('本报价版本已记录客户接受，不能覆盖成交依据');
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        target.feedback.push({ ...feedback, id: newId('QF') });
        if (feedback.kind === '客户确认接受') {
          target.acceptedBy = feedback.person;
          target.acceptedDate = feedback.date;
          target.acceptedEvidence = feedback.evidence;
        }
        const series = state.quoteSeries!.find((item) => item.id === target.seriesId)!;
        const opp = state.sales.find((item) => item.id === series.opportunityId)!;
        if (feedback.kind !== '无反馈')
          state.activities.push({
            id: newId('ACT'),
            entityId: opp.id,
            customerId: opp.customerId,
            date: feedback.date,
            type: '客户报价反馈',
            summary: `V${target.number} ${feedback.kind}：${feedback.summary}`,
            people: feedback.person || '',
            next: '',
            operator: this.person(),
            stage: opp.stage,
          });
        this.auditQuote(target, `客户反馈：${feedback.kind}`, feedback.summary);
        this.log(state, series.id, `报价V${target.number}客户反馈：${feedback.kind}`);
      },
      '客户反馈已记录',
      this.moduleOperation(
        'quote-version',
        versionId,
        this.seriesByVersion(versionId)!.opportunityId,
        'quote-workspace',
        '销售',
        '发出与反馈',
        '记录客户反馈',
        this.sale(this.seriesByVersion(versionId)!.opportunityId)!.owner,
        'quote-feedback',
        versionId,
        [{ field: 'feedback', valueType: 'object', before: null, after: feedback }],
      ),
    );
  }
  createQuoteVersion(versionId: string, reason: string): string | null {
    if (!this.allowQuoteAction(versionId)) return null;
    if (!reason) {
      this.ui.fail('请填写创建新版本的原因');
      return null;
    }
    const series = this.seriesByVersion(versionId);
    const source = this.quoteVersion(versionId);
    if (
      !series ||
      !source ||
      (source.status !== '已记录发出' &&
        !this.successfulLowPriceApproval(source) &&
        !(
          source.crmSchemaVersion !== 1 &&
          ['待模拟审核', '模拟审核通过', '附条件通过'].includes(source.status)
        ))
    ) {
      this.ui.fail('请从已发版本或成功特批锁定版本创建新版');
      return null;
    }
    const currentDraft = series.versions.find(
      (item) =>
        item.id !== versionId &&
        ['草稿', '退回补充', '待模拟审核'].includes(item.status) &&
        !series.versions.some((next) => next.sourceVersionId === item.id),
    );
    if (currentDraft) {
      this.ui.fail(`V${currentDraft.number}仍在处理中，请先完成或撤回`);
      return null;
    }
    const version = structuredClone(source);
    version.id = newId('QV');
    version.number = Math.max(...series.versions.map((item) => item.number)) + 1;
    version.sourceVersionId = source.id;
    version.solutionBasis = undefined;
    version.status = '草稿';
    version.reviewBy = '';
    version.reviewDate = '';
    version.reviewNote = '';
    version.discountApprovalCount = 0;
    version.discountApprovals = [];
    version.sentSnapshot = undefined;
    version.sourceSolutionConfirmationId = undefined;
    version.sourceDocumentVersions = undefined;
    version.costingId = undefined;
    version.sourceProductNeedRevision = undefined;
    version.sourceDiff = [];
    version.sourceAdoptedAt = undefined;
    version.invalidationReason = '';
    version.conditions = [];
    version.lockRequestedBy = '';
    version.lockRequestedDate = '';
    version.sentDate = '';
    version.sentMethod = '';
    version.sentTo = '';
    version.sentEvidence = '';
    version.acceptedBy = '';
    version.acceptedDate = '';
    version.acceptedEvidence = '';
    version.lockedBy = '';
    version.lockedDate = '';
    version.feedback = [];
    version.customerDecision = undefined;
    if (version.crmSchemaVersion === 1) {
      version.crmCreatedOn = BASE_DATE;
      version.crmFields = {
        ...version.crmFields,
        revisionnumber: version.number - 1,
        effectivefrom: null,
        closedon: addCrmDays(BASE_DATE, 30),
      };
      version.validUntil = String(version.crmFields['closedon']);
    }
    version.audit = [];
    this.auditQuote(version, `基于V${source.number}创建新版`, reason);
    const ok = this.write(
      (state) => {
        const target = state.quoteSeries!.find((item) => item.id === series.id)!;
        target.versions.push(version);
        for (const notice of state.notices.filter(
          (notice) =>
            notice.key === `quote-review-${source.id}` || notice.key === `quote-lock-${source.id}`,
        ))
          notice.resolved = true;
        this.syncQuoteSources(state, version);
        this.log(state, series.id, `创建报价V${version.number}：${reason}`);
      },
      `V${version.number}报价草稿已创建`,
      this.moduleOperation(
        'quote-version',
        version.id,
        series.opportunityId,
        'quote-workspace',
        '销售',
        '报价版本',
        '创建报价新版',
        this.sale(series.opportunityId)!.owner,
        'quote-version',
        version.id,
        [{ field: 'sourceVersionId', valueType: 'string', before: '', after: source.id }],
      ),
    );
    return ok ? version.id : null;
  }
  requestQuoteLock(versionId: string): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    const version = this.quoteVersion(versionId);
    const series = this.seriesByVersion(versionId);
    if (!version || !series || version.status !== '已记录发出')
      return this.ui.fail('只有已发出的报价版本可以申请最终锁定');
    if (!version.acceptedBy || !version.acceptedEvidence)
      return this.ui.fail('请先记录客户确认接受及凭据');
    if (version.lockRequestedBy) return this.ui.fail('该版本已提交最终锁定申请');
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        target.lockRequestedBy = this.person();
        target.lockRequestedDate = BASE_DATE;
        const currentSeries = state.quoteSeries!.find((item) => item.id === target.seriesId)!;
        this.notice(
          state,
          `quote-lock-${versionId}`,
          currentSeries.opportunityId,
          'manager',
          '报价待最终锁定',
          `${currentSeries.number} V${target.number}：已记录客户接受，请核对报价条件、审核条件及财务口径`,
        );
        this.auditQuote(target, '申请最终报价锁定');
        this.log(state, currentSeries.id, `报价V${target.number}申请最终锁定`);
      },
      '最终锁定申请已提交给销售主管',
      this.moduleOperation(
        'quote-version',
        versionId,
        series.opportunityId,
        'quote-workspace',
        '销售',
        '成交锁定',
        '申请最终锁定',
        this.sale(series.opportunityId)!.owner,
        'quote-lock-request',
        versionId,
        [{ field: 'lockRequestedBy', valueType: 'string', before: '', after: this.person() }],
      ),
    );
  }
  lockQuote(versionId: string): boolean {
    if (!this.allowQuoteAction(versionId)) return false;
    if (!this.checkQuoteSolutionBasis(versionId)) return false;
    const version = this.quoteVersion(versionId);
    const series = this.seriesByVersion(versionId);
    if (
      !version ||
      !series ||
      version.status !== '已记录发出' ||
      (!version.lockRequestedBy && version.crmSchemaVersion !== 1)
    )
      return this.ui.fail('该报价尚未提交锁定申请');
    if (series.activeFinalVersionId && series.activeFinalVersionId !== versionId)
      return this.ui.fail('本商机已有唯一成交报价版本');
    if (
      this.sale(series.opportunityId)?.customerId !== version.customerId ||
      (version.crmSchemaVersion !== 1 &&
        !this.customer(version.customerId)?.contacts.some(
          (contact) => contact.id === version.contactId,
        ))
    )
      return this.ui.fail('报价客户或联系人与来源关联不一致，不能锁定');
    const openDraft = series.versions.some(
      (item) =>
        item.id !== versionId &&
        ['草稿', '退回补充', '待模拟审核', '附条件通过'].includes(item.status) &&
        !series.versions.some((next) => next.sourceVersionId === item.id),
    );
    if (!version.acceptedBy || !version.acceptedEvidence)
      return this.ui.fail('请先记录客户确认接受及凭据');
    if (
      (version.crmSchemaVersion !== 1 && version.conditions.some((item) => !item.closed)) ||
      openDraft
    )
      return this.ui.fail('还有未关闭审核条件或处理中版本');
    if (
      version.crmSchemaVersion !== 1 &&
      (version.taxMode === '含税待确认' || version.taxReview !== '样例已确认')
    )
      return this.ui.fail('税费口径尚未确认，不能锁定');
    const total = this.quoteTotals(version).total;
    if (total === null || total <= 0) return this.ui.fail('报价合计未明确，不能锁定');
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        target.status = '最终锁定';
        target.lockedBy = this.person();
        target.lockedDate = BASE_DATE;
        for (const notice of state.notices.filter((item) => item.key === `quote-lock-${versionId}`))
          notice.resolved = true;
        const targetSeries = state.quoteSeries!.find((item) => item.id === target.seriesId)!;
        targetSeries.activeFinalVersionId = target.id;
        this.auditQuote(target, '锁定最终报价');
        this.log(state, targetSeries.id, `报价V${target.number}最终锁定`);
      },
      '最终报价已锁定，合同模拟来源可引用',
      this.moduleOperation(
        'quote-version',
        versionId,
        series.opportunityId,
        'quote-workspace',
        '主管',
        '成交锁定',
        '锁定最终报价',
        this.sale(series.opportunityId)!.owner,
        'quote-final-lock',
        versionId,
        [{ field: 'status', valueType: 'string', before: version.status, after: '最终锁定' }],
      ),
    );
  }
  reopenLockedQuote(versionId: string, reason: string): string | null {
    if (!this.allowQuoteAction(versionId)) return null;
    const series = this.seriesByVersion(versionId);
    const source = this.quoteVersion(versionId);
    if (!series || !source || source.status !== '最终锁定' || !reason) {
      this.ui.fail('请选最终锁定版本并填写重新报价原因');
      return null;
    }
    if (this.state().contracts.some((contract) => contract.quoteVersionId === versionId)) {
      this.ui.fail('合同模拟来源已引用该版本，需走后续变更流程');
      return null;
    }
    const version = structuredClone(source);
    version.id = newId('QV');
    version.number = Math.max(...series.versions.map((item) => item.number)) + 1;
    version.sourceVersionId = source.id;
    version.status = '草稿';
    version.reviewBy = '';
    version.reviewDate = '';
    version.reviewNote = '';
    version.discountApprovalCount = 0;
    version.discountApprovals = [];
    version.sentSnapshot = undefined;
    version.conditions = [];
    version.lockRequestedBy = '';
    version.lockRequestedDate = '';
    version.sentDate = '';
    version.sentMethod = '';
    version.sentTo = '';
    version.sentEvidence = '';
    version.acceptedBy = '';
    version.acceptedDate = '';
    version.acceptedEvidence = '';
    version.lockedBy = '';
    version.lockedDate = '';
    version.feedback = [];
    version.customerDecision = undefined;
    if (version.crmSchemaVersion === 1) {
      version.crmCreatedOn = BASE_DATE;
      version.crmFields = {
        ...version.crmFields,
        revisionnumber: version.number - 1,
        effectivefrom: null,
        closedon: addCrmDays(BASE_DATE, 30),
      };
      version.validUntil = String(version.crmFields['closedon']);
    }
    version.audit = [];
    version.invalidationReason = `V${source.number}锁定失效：${reason}`;
    this.auditQuote(version, '主管批准重新报价', reason);
    const ok = this.write((state) => {
      const targetSeries = state.quoteSeries!.find((item) => item.id === series.id)!;
      targetSeries.versions.push(version);
      targetSeries.activeFinalVersionId = '';
      const old = this.quoteIn(state, source.id)!;
      old.invalidationReason = `已由V${version.number}重新报价：${reason}`;
      this.log(state, series.id, `批准重新报价V${version.number}：${reason}`);
    }, `已生成V${version.number}草稿，原锁定记录保留`);
    return ok ? version.id : null;
  }
  syncQuoteAmount(versionId: string): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    if (!this.allowQuoteAction(versionId)) return false;
    const version = this.quoteVersion(versionId);
    const series = this.seriesByVersion(versionId);
    if (!version || !series) return false;
    const total = this.quoteTotals(version).total;
    if (total === null) return this.ui.fail('含税金额待确认，暂不能同步商机预计金额');
    return this.write((state) => {
      const sale = state.sales.find((item) => item.id === series.opportunityId)!;
      sale.amount = total;
      sale.currency = version.currency;
      this.log(
        state,
        series.id,
        `将V${version.number}报价金额同步为商机预计金额${total} ${version.currency}`,
      );
    }, '商机预计金额已更新');
  }
  /**
   * Shared module submission entry: business changes and the typed event are
   * serialized in one snapshot, then published to the UI only after storage succeeds.
   */
  /** 模块发起动作前取得目标；异步完成后仍以原目标提交，交由统一入口复核。 */
  v9CanEdit(): boolean { return this.canEdit(); }
  v9CommandTarget(): import('./v9-contracts').V9Target | null {
    const roundId = this.state().roundId;
    return this.activeWorkspaceId && roundId ? { workspaceId: this.activeWorkspaceId, roundId } : null;
  }
  /** 回收前读所有已知工作区；任一快照不可读时保守停止。 */
  v9SolutionCurrentReferences(): import('./v9-contracts').SolutionFileReference[] | null {
    try {
      const states = [this.state()];
      if (this.workspaceStorage) for (const id of this.workspaceStorage.workspaceIds()) {
        const snapshot = this.workspaceStorage.readWorkspace(id);
        if (!snapshot) return null;
        states.push(snapshot);
      }
      return states.flatMap(s => (s.solutionWorkspaces ?? []).flatMap(w => w.versions.filter(v => v.contentState === 'current' && Object.values(w.currentOutputs).includes(v.id) && v.file).map(v => v.file!)));
    } catch { return null; }
  }
  commitV9Command(request: V9CommandRequest, plan: V9CommandPlan): V9CommandResult {
    const reject = (
      code: import('./v9-contracts').V9ErrorCode,
      message: string,
    ): V9CommandResult => ({
      status: 'rejected',
      objectId: request.objectId,
      issue: { code, message },
      message,
    });
    if (
      ![
        request.command,
        request.objectId,
        request.operationId,
        request.workspaceId,
        request.roundId,
      ].every((value) => typeof value === 'string' && value.trim())
    )
      return reject('field-required', '命令、对象、操作号和目标身份均必填');
    if (plan.recordUnchangedAction && !plan.taskSource?.kind)
      return reject('field-required', '无字段变化的确认必须提供明确动作来源');
    if (plan.object.id !== request.objectId)
      return reject('field-invalid', '模块计划与命令的业务对象不一致');
    if (request.workspaceId !== this.activeWorkspaceId || request.roundId !== this.state().roundId)
      return reject('workspace-changed', '目标工作区或演示轮次已变化');
    if (!this.canEdit()) return reject('no-edit-right', '当前标签页没有修改权');
    let fingerprint: string;
    try {
      fingerprint = commandInputFingerprint(request.input);
    } catch {
      return reject('field-invalid', '命令输入含非法或不可持久化值');
    }
    const findReceipt = () => this.state().v9CommandReceipts?.find(receipt =>
      receipt.workspaceId === request.workspaceId && receipt.roundId === request.roundId &&
      receipt.command === request.command && receipt.objectId === request.objectId && receipt.operationId === request.operationId);
    const existing = findReceipt();
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return {
          status: 'rejected',
          objectId: request.objectId,
          issue: {
            code: 'operation-input-mismatch',
            message: '同一操作号不能更换输入',
          },
          message: '同一操作号不能更换输入',
        };
      return { ...structuredClone(existing.result), status: 'unchanged' };
    }
    if (!plan.changes.length && !plan.recordUnchangedAction)
      return {
        status: 'unchanged',
        objectId: request.objectId,
        revision: this.state().dataVersion || 1,
        value: structuredClone(plan.value),
        message: '未变化',
      };
    const result = {
      status: 'committed' as const,
      objectId: request.objectId,
      revision: (this.state().dataVersion || 1) + 1,
      value: structuredClone(plan.value),
      message: '已保存',
    };
    let ok = false;
    let failure: V9Issue = {
      code: 'storage-failed',
      message: '保存失败，记录未更新',
    };
    try {
      ok = this.commitOperation(
        {
          ...plan,
          change: (state) => {
            plan.change(state);
            (state.v9CommandReceipts ||= []).push({
              workspaceId: request.workspaceId,
              roundId: request.roundId,
              command: request.command,
              objectId: request.objectId,
              operationId: request.operationId,
              fingerprint,
              result: structuredClone(result),
            });
          },
        },
        (issue) => {
          failure = issue;
        },
      );
    } catch {
      /* 统一结果覆盖既有UI抛错适配；write已报告具体原因。 */
    }
    // 已发布快照中的收据是成功依据，提示层异常不撤销已成功的保存。
    const committed = findReceipt();
    if (ok || committed) return structuredClone(committed?.result ?? result);
    const status = ['no-edit-right', 'revision-mismatch'].includes(failure.code)
      ? 'rejected'
      : 'failed';
    return {
      status,
      objectId: request.objectId,
      issue: failure,
      message: failure.message,
    };
  }
  commitOperation(request: OperationCommitRequest, onFailure?: (issue: V9Issue) => void): boolean {
    if (!request.changes.length && !request.recordUnchangedAction) return true;
    if (request.recordUnchangedAction && !request.taskSource?.kind)
      return this.ui.fail('无字段变化的操作事件必须提供明确动作来源');
    return this.write(request.change, request.message, {
      objectType: request.object.type,
      objectId: request.object.id,
      location: {
        objectType: request.object.type,
        objectId: request.object.id,
        module: request.module,
        department: request.department,
        section: request.section,
        action: request.action,
      },
      mainlineId: request.mainlineId,
      module: request.module,
      department: request.department,
      action: request.action,
      owner: request.owner.name,
      ownerPersonId: request.owner.personId,
      taskSource: request.taskSource,
      changes: request.changes,
    }, onFailure);
  }
  private moduleOperation(
    objectType: string,
    objectId: string,
    mainlineId: string,
    module: string,
    department: string,
    section: string,
    action: string,
    owner: string,
    taskKind: string,
    taskId: string,
    changes: OperationFieldChange[],
  ): Omit<
    OperationEvent,
    | 'id'
    | 'roundId'
    | 'operator'
    | 'operatorPersonId'
    | 'occurredAt'
    | 'sourceVersion'
    | 'dataVersion'
  > {
    return {
      objectType,
      objectId,
      location: { objectType, objectId, module, department, section, action },
      mainlineId,
      module,
      department,
      action,
      owner,
      taskSource: { kind: taskKind, id: taskId },
      changes,
    };
  }
  private write(
    change: (state: DemoState) => void,
    message?: string,
    operation?: Omit<
      OperationEvent,
      | 'id'
      | 'roundId'
      | 'operator'
      | 'operatorPersonId'
      | 'occurredAt'
      | 'sourceVersion'
      | 'dataVersion'
    >,
    onFailure?: (issue: V9Issue) => void,
  ): boolean {
    const fail = (code: V9Issue['code'], message: string): false => {
      if (onFailure) { onFailure({ code, message }); return false; }
      return this.ui.fail(message);
    };
    if (!this.canEdit()) {
      this.editingWritable.set(false);
      return fail('no-edit-right', '当前标签页没有修改权；请先接管修改权后再保存');
    }
    try {
      const current = this.state();
      const next = structuredClone(current);
      const sourceVersion = current.dataVersion || 1;
      next.roundId ||= newId('ROUND');
      const original = next.customerDeliveryRetentionVersion !== 1
        ? this.workspaceStorage?.readActive() ?? JSON.parse(localStorage.getItem?.(this.activeSnapshotKey) || 'null')
        : null;
      initializeDeliveryRetention(next, this.workspaceStorage ? original : original || current);
      initializeFinanceSources(next);
      migrateV4(next);
      next.dataVersion = sourceVersion;
      next.storageSchemaVersion = Math.max(next.storageSchemaVersion || 0, 1);
      next.operationEvents ||= [];
      next.quoteSchemaVersion = 1;
      next.dateMode ||= 'normal';
      next.planWarningReads ||= [];
      change(next);
      syncClosedQuoteNotices(next);
      for (const project of next.projects) {
        syncProjectCompletion(project);
        this.syncMilestoneWarnings(next, project.id);
        if (next.financeSnapshots?.some((snapshot) => snapshot.projectId === project.id))
          this.syncReceivables(next, project.id);
      }
      next.dataVersion = sourceVersion + 1;
      retainDeliveryCommitments(next);
      if (operation) {
        next.operationEvents.push({
          ...structuredClone(operation),
          id: newId('OP'),
          roundId: next.roundId!,
          operator: this.person(),
          operatorPersonId: identityForRole(this.role())?.personId,
          occurredAt: new Date().toISOString(),
          sourceVersion,
          dataVersion: next.dataVersion,
        });
      }
      const latestRaw =
        typeof localStorage?.getItem === 'function'
          ? localStorage.getItem(this.activeSnapshotKey)
          : null;
      const latest =
        this.workspaceStorage && this.activeWorkspaceId
          ? this.workspaceStorage.readActive()
          : latestRaw
            ? (JSON.parse(latestRaw) as DemoState)
            : undefined;
      if (latest && (latest.dataVersion || 1) !== sourceVersion)
        return fail('revision-mismatch', '存储中的数据版本已变化；当前修改未保存，请刷新后重试');
      if (!this.canEdit()) {
        this.editingWritable.set(false);
        return fail('no-edit-right', '保存前修改权已变更；当前修改未保存，请刷新或重新接管');
      }
      localStorage.setItem(
        this.activeSnapshotKey,
        this.workspaceStorage && this.activeWorkspaceId
          ? JSON.stringify({
              formatVersion: 1,
              workspaceId: this.activeWorkspaceId,
              snapshot: next,
            })
          : JSON.stringify(next),
      );
      this.state.set(next);
      if (message) this.ui.notify(message);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败，记录未更新';
      return fail(/quota/i.test(message) ? 'quota-exceeded' : 'storage-failed', message);
    }
  }
  operationEvents(id: string): OperationEvent[] {
    return (this.state().operationEvents || [])
      .filter((event) => event.objectId === id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  saveOpportunityRoughPlan(opportunityId: string, input: OpportunityRoughPlan): boolean {
    const opportunity = this.sale(opportunityId);
    if (!opportunity || opportunity.type !== 'opportunity')
      return this.ui.fail('粗计划仅适用于商机');
    if (
      !input.id ||
      !input.name.trim() ||
      !input.owner.trim() ||
      !validDateRange(input.start, input.end)
    )
      return this.ui.fail('请填写稳定节点ID、任务、负责人和有效起止日期');
    if (!input.sourceReference.trim()) return this.ui.fail('请记录任务来源');
    if (!['自行制定', '参考模板', '客户要求'].includes(input.sourceType || ''))
      return this.ui.fail('请选择任务来源');
    if (input.sourceType === '参考模板') {
      const template = (this.state().roughPlanTemplates || []).find(
        (item) => item.id === input.sourceTemplateId && item.status === '启用',
      );
      const templateTask = template?.tasks?.find((item) => item.id === input.sourceTemplateTaskId);
      if (!template || !templateTask) return this.ui.fail('请选择模板及其中一个有效任务');
      input.sourceReference = `计划模板：${template.name} · ${templateTask.wbsCode} ${templateTask.name}`;
    } else if (input.sourceType === '客户要求') {
      if (!input.sourceDetail?.trim()) return this.ui.fail('请填写客户要求来源说明');
      input.sourceTemplateId = '';
      input.sourceTemplateTaskId = '';
      input.sourceReference = `客户要求：${input.sourceDetail.trim()}`;
    } else {
      input.sourceTemplateId = '';
      input.sourceTemplateTaskId = '';
      input.sourceReference = `自行制定${input.sourceDetail?.trim() ? `：${input.sourceDetail.trim()}` : ''}`;
    }
    if (
      input.durationDays !== undefined &&
      (!Number.isInteger(input.durationDays) || input.durationDays < 0)
    )
      return this.ui.fail('计划天数必须为非负整数');
    return this.write((state) => {
      const target = state.sales.find((item) => item.id === opportunityId)!;
      target.opportunityRoughPlans ||= [];
      const index = target.opportunityRoughPlans.findIndex((item) => item.id === input.id);
      if (index >= 0) target.opportunityRoughPlans[index] = structuredClone(input);
      else target.opportunityRoughPlans.push(structuredClone(input));
      this.log(state, opportunityId, `保存商机粗计划：${input.name}（节点 ${input.id}）`);
    }, '商机粗计划已保存');
  }
  installRoughPlanTemplates(templates: OpportunityRoughPlanTemplate[]): boolean {
    if (!templates?.length) return this.ui.fail('计划模板数据为空');
    if (this.state().roughPlanTemplates?.every((template) => !!template.tasks?.length)) return true;
    return this.write((state) => {
      state.roughPlanTemplates = structuredClone(templates);
    });
  }
  private copyOpportunityRoughPlans(project: Project, opportunity: SalesRecord): void {
    project.plans = [
      ...project.plans,
      ...(opportunity.opportunityRoughPlans || []).map((source) => ({
        ...blankPlan('内部WBS'),
        id: newId('PLAN'),
        type: '内部WBS' as const,
        wbsCode: source.wbsCode,
        name: source.name,
        owner: source.owner,
        start: source.start,
        end: source.end,
        expected: source.end,
        actual: '',
        status: '未开始',
        durationDays: source.durationDays,
        predecessor: source.predecessor,
        relationNote: source.relationNote,
        note: source.note,
        weekWindow: source.weekWindow,
        sourceReference: source.sourceReference,
        sourceTemplateId: source.sourceTemplateId,
        sourceTemplateTaskId: source.sourceTemplateTaskId,
        sourceType: source.sourceType,
        sourceDetail: source.sourceDetail,
        sourceStatus: '待核' as const,
        sourceOpportunityPlanId: source.id,
      })),
    ];
  }
  private log(state: DemoState, id: string, action: string): void {
    state.history.push({
      id: newId('H'),
      entityId: id,
      operator: this.person(),
      action,
      date: new Date().toISOString(),
    });
  }
  private notice(
    state: DemoState,
    key: string,
    id: string,
    role: Role,
    title: string,
    text: string,
  ): void {
    if (state.notices.some((n) => n.key === key && !n.resolved)) return;
    state.notices.push({
      id: newId('N'),
      key,
      entityId: id,
      role,
      title,
      text,
      read: false,
      resolved: false,
      date: BASE_DATE,
    });
  }
  private allow(_roles: Role[]): boolean {
    // Demo identities select a work perspective and audit actor, not permissions.
    // Keep existing callers compatible; each operation still checks its business prerequisites.
    return true;
  }
  /**
   * V8 retired contract-finance capabilities. Orders, lines, invoices, receipt
   * claims and their simulated receipts are refused here so no screen, legacy
   * route or direct call can publish a new value; history keeps being readable.
   */
  private retiredFinanceWrite(feature: string): false {
    return this.ui.fail(`${feature}已停用新增与编辑；历史记录、稳定ID、余额与项目引用继续只读可查`);
  }
  setRole(role: Role): void {
    this.write((s) => (s.role = role));
  }
  setDateMode(mode: DemoDateMode): boolean {
    if (mode === this.dateMode()) return true;
    return this.write(
      (s) => {
        s.dateMode = mode;
      },
      mode === 'comparison' ? '已切换至预警对比档（2026-10-22）' : '已切换至正常档（2026-10-15）',
    );
  }
  preparePlanRiskDemo(projectId: string, type: Plan['type']): boolean {
    const project = this.project(projectId);
    if (!project) return this.ui.fail('找不到关联项目');
    if (type !== '内部WBS' && type !== '客户主节点')
      return this.ui.fail('该计划类型不支持甘特三色演示');
    const existingColors = new Set(
      project.plans
        .filter((plan) => plan.type === type)
        .map((plan) => planRisk(plan, DEMO_COMPARISON_DATE).level),
    );
    if (existingColors.has('blue') && existingColors.has('yellow') && existingColors.has('red'))
      return this.setDateMode('comparison');
    const samples = PLAN_RISK_DEMO_CASES.map((scenario): Plan => {
      const dates = planRiskDemoDates(scenario);
      return {
        ...blankPlan(type),
        ...dates,
        id: `DEMO-RISK-${projectId}-${type}-${scenario.key}`,
        name: scenario.name,
        owner: project.pm || '',
        expected: dates.end,
        status: scenario.key === 'normal' ? '未开始' : '进行中',
        durationDays: 5,
        sourceStatus: '模拟',
        sourceReference: '甘特三色演示样例 v1',
        note: '演示样例：预警提前3天；与真实计划分开记录。',
        ...(type === '内部WBS'
          ? { budgetAmount: 0, budgetCurrency: 'CNY', budgetSource: '模拟' }
          : {}),
      };
    });
    const sampleIds = new Set(samples.map((plan) => plan.id));
    const nextPlans = [...project.plans.filter((plan) => !sampleIds.has(plan.id)), ...samples];
    return this.commitOperation({
      object: { type: 'project', id: projectId },
      mainlineId: project.opportunityId || projectId,
      module: '项目计划',
      department: 'PM',
      section: `计划:${type}`,
      action: '准备甘特三色演示',
      owner: { name: project.pm },
      taskSource: { kind: 'project-plan', id: samples[0].id },
      changes: [
        {
          field: 'plans.demo',
          valueType: 'array',
          before: project.plans.filter((plan) => sampleIds.has(plan.id)),
          after: samples,
        },
      ],
      change: (state) => {
        state.projects.find((item) => item.id === projectId)!.plans = nextPlans;
        state.dateMode = 'comparison';
      },
      message: '已加载蓝、黄、红三色演示节点，模拟日期为2026-10-22',
    });
  }
  /**
   * 08-03：标记本人已读。只追加一条阅读记录，不改任务事实、不写业务历史，
   * 也不影响他人已读状态与风险颜色；保存失败时不更新页面状态。
   */
  setRoundContext(mainlineId: string, projectId = ''): boolean {
    const mainline = this.state().sales.find(
      (sale) => sale.id === mainlineId && (sale.type === 'opportunity' || sale.type === 'lead'),
    );
    if (!mainline) return this.ui.fail('请选择现有线索或商机作为本轮主线');
    const canonicalOpportunityId =
      mainline.type === 'opportunity' ? mainline.id : mainline.convertedTo || '';
    const relatedProjects = this.state().projects.filter(
      (project) => !!canonicalOpportunityId && project.opportunityId === canonicalOpportunityId,
    );
    const effectiveProjectId =
      projectId || (relatedProjects.length === 1 ? relatedProjects[0].id : '');
    if (
      effectiveProjectId &&
      this.state().projects.find((project) => project.id === effectiveProjectId)?.opportunityId !==
        canonicalOpportunityId
    )
      return this.ui.fail('所选项目不属于当前主线');
    return this.write((state) => {
      state.selectedMainlineId = mainline.id;
      state.selectedProjectId = effectiveProjectId || undefined;
    });
  }
  saveCustomer(customer: Customer): boolean {
    if (!customer.name || !customer.country) return this.ui.fail('请填写客户名称和国家/地区');
    if (!CUSTOMER_COUNTRIES.includes(customer.country as (typeof CUSTOMER_COUNTRIES)[number]))
      return this.ui.fail('客户国家必须从下拉选项中选择');
    if (!customer.owner || !customer.status || !customer.industry)
      return this.ui.fail('请填写 CRM 客户状态、销售负责人和行业角色');
    if (customer.contacts.some((c) => !c.name || (!c.email && !c.phone)))
      return this.ui.fail('联系人需要姓名和至少一种联系方式');
    return this.write((s) => {
      const index = s.customers.findIndex((x) => x.id === customer.id);
      if (index >= 0) s.customers[index] = structuredClone(customer);
      else s.customers.push(structuredClone(customer));
      if (customer.contacts.length === 1) {
        for (const lead of s.sales.filter(
          (record) =>
            record.type === 'lead' &&
            record.customerId === customer.id &&
            !record.contactId &&
            !record.convertedTo,
        )) {
          if (!this.canOperateSale(lead)) continue;
          lead.contactId = customer.contacts[0].id;
          this.log(s, lead.id, `关联客户补录的唯一联系人${lead.contactId}`);
        }
      }
      this.log(s, customer.id, '保存客户档案');
    }, '客户资料已保存，关联项目同步引用');
  }
  saveContact(customerId: string, contact: Contact): boolean {
    const customer = this.customer(customerId);
    if (!customer) return this.ui.fail('请先选择有效客户');
    if (!contact.name || (!contact.email && !contact.phone))
      return this.ui.fail('联系人需要姓名和至少一种联系方式');
    if (!contact.id) return this.ui.fail('联系人编号无效，请重新保存');
    return this.write((state) => {
      const source = state.customers.find((item) => item.id === customerId)!;
      const current = source.contacts.findIndex((item) => item.id === contact.id);
      if (current >= 0) source.contacts[current] = structuredClone(contact);
      else source.contacts.push(structuredClone(contact));
      this.log(state, customerId, `${current >= 0 ? '更新' : '新增'}联系人：${contact.id}`);
    }, '联系人资料已保存');
  }
  saveSales(
    record: SalesRecord,
    customerUpdate?: Customer,
    section = record.type === 'opportunity' ? '商机信息' : '线索信息',
  ): boolean {
    record = structuredClone(record);
    customerUpdate = customerUpdate ? structuredClone(customerUpdate) : undefined;
    const customer = customerUpdate || this.customer(record.customerId);
    if (!customer || customer.id !== record.customerId)
      return this.ui.fail('请选择已有客户，或先新建客户');
    if (customerUpdate) {
      if (!customer.name ||
          !CUSTOMER_COUNTRIES.includes(customer.country as (typeof CUSTOMER_COUNTRIES)[number]))
        return this.ui.fail('客户需有名称和有效国家，请核对客户档案');
      const existingCustomer = this.customer(customer.id);
      // 新建线索只校验本次新增/修改的资料，未改动的旧档案缺值留在客户管理补齐。
      for (const [key, label] of [
        ['owner', '销售负责人'], ['status', '客户状态'], ['industry', '行业角色'],
      ] as const) {
        if (!customer[key] && (!existingCustomer || customer[key] !== existingCustomer[key]))
          return this.ui.fail(`客户${label}不能为空，请到客户管理补齐`);
      }
      const invalidContact = customer.contacts.find((contact) => {
        const previous = existingCustomer?.contacts.find((item) => item.id === contact.id);
        const changed = !previous || previous.name !== contact.name ||
          previous.email !== contact.email || previous.phone !== contact.phone;
        return changed && (!contact.name || (!contact.email && !contact.phone));
      });
      if (invalidContact)
        return this.ui.fail(`本次新增或修改的联系人“${invalidContact.name || invalidContact.id}”需要姓名和至少一种联系方式`);
    }
    if (record.contactId && !customer.contacts.some((contact) => contact.id === record.contactId))
      return this.ui.fail('所选联系人不属于当前客户，请重新选择');
    if (
      !Number.isFinite(record.amount) ||
      record.amount < 0 ||
      !Number.isFinite(record.capacity) ||
      record.capacity < 0
    )
      return this.ui.fail('金额与容量不能为负数');
    const old = this.sale(record.id);
    if (customerUpdate && (old || record.type !== 'lead'))
      return this.ui.fail('关联客户资料的联合保存仅用于新建线索');
    if (!old && record.type !== 'lead') return this.ui.fail('新商机请通过线索转换动作创建');
    if (old && old.type !== record.type)
      return this.ui.fail('业务对象类型不能通过通用编辑动作改变');
    if (
      old &&
      [
        'stage',
        'quoteFlowMode',
        'status',
        'convertedTo',
        'convertedDate',
        'leadId',
        'closedDate',
        'incomeDate',
      ].some((key) => old[key as keyof SalesRecord] !== record[key as keyof SalesRecord])
    )
      return this.ui.fail('阶段、报价流程与关闭状态请使用专用动作；内容已更新时请刷新表单');
    if (
      old?.type === 'opportunity' &&
      record.customerId !== old.customerId &&
      !!this.quoteSeries(old.id)?.versions.length
    )
      return this.ui.fail('已有报价的客户不能通过商机编辑更换，请保留报价与客户关联');
    if (old) {
      for (const key of [
        'team',
        'customerRoles',
        'g1',
        'deliveryOpinion',
        'resourceWindow',
        'taxCase',
        'taxNote',
        'taxConfirmed',
        'needsReview',
        'operator',
        'operatorPersonId',
        'createdDate',
      ] as const)
        Object.assign(record, { [key]: structuredClone(old[key]) });
      if (old.type === 'opportunity') {
        record.owner = old.owner;
        record.ownerPersonId = old.ownerPersonId;
      }
    }
    if (record.type === 'lead') {
      if (old && (old.owner !== record.owner || old.ownerPersonId !== record.ownerPersonId))
        return this.ui.fail('更换线索负责人请使用主管的分配动作');
      if (
        old &&
        (old.crmStatus !== record.crmStatus || old.followUpStatus !== record.followUpStatus)
      )
        return this.ui.fail('线索状态请使用对应的分配、转商机或跟进动作');
      if (!old) {
        if (
          !['市场活动', '官网咨询', '客户推荐', '中间人', '自有开发'].includes(
            record.crmSource || '',
          )
        )
          return this.ui.fail('请选择线索来源');
        const manuallyAssigned = DEMO_IDENTITY_BINDINGS.find(
          (binding) =>
            binding.role === 'sales' &&
            (binding.personId === record.ownerPersonId || binding.displayName === record.owner),
        );
        if (manuallyAssigned) {
          record.owner = manuallyAssigned.displayName;
          record.ownerPersonId = manuallyAssigned.personId;
          record.crmStatus = '已分配';
        } else if (this.role() === 'sales') {
          const identity = identityForRole('sales')!;
          record.owner = identity.displayName;
          record.ownerPersonId = identity.personId;
          record.crmStatus = '已分配';
        } else if (this.role() === 'assistant') {
          record.owner = '';
          record.ownerPersonId = undefined;
          record.crmStatus = '未分配';
        } else if (this.role() === 'manager') {
          const assigned = DEMO_IDENTITY_BINDINGS.find(
            (binding) => binding.role === 'sales' && binding.personId === record.ownerPersonId,
          );
          if (record.ownerPersonId && !assigned)
            return this.ui.fail('只能分配给演示名册中的在岗销售');
          record.owner = assigned?.displayName || '';
          record.crmStatus = assigned ? '已分配' : '未分配';
        } else {
          record.owner = '';
          record.ownerPersonId = undefined;
          record.crmStatus = '未分配';
        }
        record.followUpStatus = '跟进中';
        record.stage = '意向沟通';
        record.convertedTo = '';
        record.convertedDate = '';
        record.quoteFlowMode = 'legacy';
        record.customerCountrySnapshot = customer.country;
        record.customerCountryConfirmed = '';
      }
    } else {
      record.ownerPersonId = DEMO_IDENTITY_BINDINGS.find((binding) =>
        binding.legacyPlatformNames.includes(record.owner),
      )?.personId;
    }
    record.lastEditor = this.person();
    record.lastEditorPersonId = identityForRole(this.role())?.personId;
    if (!old) record.operatorPersonId = identityForRole(this.role())?.personId;
    if (old && (old.grade !== record.grade || old.tender !== record.tender)) {
      record.team = record.team.map((t) => ({ ...t, confirmed: false, confirmedBy: '' }));
      record.g1 = '未提交';
    }
    const changes = old ? operationFieldChanges(old, record) : [];
    if (old && changes.length === 0 && !customerUpdate) {
      this.ui.notify('内容没有变化，无需保存');
      return true;
    }
    const change = (s: DemoState) => {
      if (customerUpdate) {
        const customerIndex = s.customers.findIndex((item) => item.id === customerUpdate!.id);
        if (customerIndex >= 0) s.customers[customerIndex] = customerUpdate;
        else s.customers.push(customerUpdate);
        this.log(s, customerUpdate.id, '联合保存客户、联系人与线索草稿');
      }
      const index = s.sales.findIndex((x) => x.id === record.id);
      if (index >= 0) s.sales[index] = record;
      else s.sales.push(record);
      this.log(s, record.id, old ? '修改业务信息' : '保存线索草稿');
    };
    if (old?.type === 'opportunity' && changes.length) {
      return this.commitOperation({
        object: { type: 'opportunity', id: record.id },
        mainlineId: old.leadId || old.id,
        module: '商机',
        department: '销售',
        section,
        action: '修改业务信息',
        owner: { name: old.owner, personId: old.ownerPersonId },
        changes,
        change,
        message: '业务信息已保存',
      });
    }
    return this.write(change, '业务信息已保存');
  }
  archive(id: string, status: string, reason: string): boolean {
    if (!['待跟进', '暂缓跟进', '已归档'].includes(status)) return this.ui.fail('线索跟进状态无效');
    if (status !== '待跟进' && !reason) return this.ui.fail('请填写归档或暂缓原因');
    const sale = this.sale(id);
    if (!this.canOperateSale(sale))
      return this.ui.fail('仅线索负责人、其对应助理或销售主管可处理此线索');
    if (sale?.convertedTo) return this.ui.fail('已转换线索不能归档，请到商机中处理');
    if (sale?.type !== 'lead') return this.ui.fail('仅线索支持跟进状态调整');
    const followUpStatus = status === '待跟进' ? '跟进中' : status;
    if (sale.followUpStatus === followUpStatus) {
      this.ui.notify('线索已处于该跟进状态');
      return true;
    }
    return this.write((s) => {
      const x = s.sales.find((x) => x.id === id)!;
      x.status = status;
      x.followUpStatus = followUpStatus as SalesRecord['followUpStatus'];
      x.reason = reason;
      this.log(s, id, `${status}：${reason}`);
    }, '线索状态已更新');
  }
  assignLead(id: string, personId: string, reason: string): boolean {
    const sale = this.sale(id);
    if (!sale || sale.type !== 'lead') return this.ui.fail('只能分配未转换的线索');
    if (sale.convertedTo || sale.crmStatus === '已转商机')
      return this.ui.fail('已转换线索不能重新分配');
    if (sale.crmStatus === '无效线索' || sale.crmStatus === '退回公海')
      return this.ui.fail('无效线索或退回公海线索不能分配');
    if (!reason?.trim()) return this.ui.fail('请填写分配原因');
    const target = DEMO_IDENTITY_BINDINGS.find(
      (binding) => binding.role === 'sales' && binding.personId === personId,
    );
    if (!target) return this.ui.fail('只能分配给演示名册中的在岗销售');
    if (sale.ownerPersonId === target.personId && sale.crmStatus === '已分配') {
      this.ui.notify('该线索已分配给此销售，无需重复操作');
      return true;
    }
    return this.write((state) => {
      const lead = state.sales.find((candidate) => candidate.id === id)!;
      const previous = lead.ownerPersonId ? this.identityName(lead.ownerPersonId) : '未分配';
      lead.ownerPersonId = target.personId;
      lead.owner = target.displayName;
      lead.crmStatus = '已分配';
      lead.lastEditor = this.person();
      lead.lastEditorPersonId = identityForRole(this.role())?.personId;
      this.log(state, id, `主管分配：${previous} → ${target.displayName}；${reason}`);
    }, '线索负责人已更新');
  }
  convert(id: string): string | null {
    const x = this.sale(id);
    if (!x) return null;
    if (x.type !== 'lead') {
      this.ui.fail('仅线索可以转换为商机');
      return null;
    }
    if (x.convertedTo && x.conversionKind !== 'customer') {
      const linked = this.sale(x.convertedTo);
      if (linked?.type === 'opportunity' && linked.leadId === id) return linked.id;
      this.ui.fail('原商机关联无法核对，请保留原记录并核对资料');
      return null;
    }
    if (!this.customer(x.customerId)) {
      this.ui.fail('请先关联有效客户');
      return null;
    }
    const conversionCustomer = this.customer(x.customerId)!;
    if (
      !CUSTOMER_COUNTRIES.includes(
        conversionCustomer.country as (typeof CUSTOMER_COUNTRIES)[number],
      )
    ) {
      this.ui.fail('关联客户的国家为空或不在当前可选范围中，请先到客户管理更新客户国家');
      return null;
    }
    if (x.conversionKind === 'customer' && x.convertedTo !== x.customerId) {
      this.ui.fail('原客户关联无法核对，请保留原记录并核对资料');
      return null;
    }
    if (x.crmStatus === '无效线索' || x.crmStatus === '退回公海') {
      this.ui.fail('无效线索或退回公海线索不能转换商机');
      return null;
    }
    if (x.followUpStatus !== '跟进中' || ['已归档', '暂缓跟进'].includes(x.status)) {
      this.ui.fail('请先恢复线索跟进状态');
      return null;
    }
    const c = this.contact(x);
    const missing = [
      !this.has(id, '需求导入表') ? '需求导入表' : '',
      !c?.name ? '主要联系人' : '',
      !(c?.phone || c?.email) ? '联系人联系方式' : '',
    ].filter(Boolean);
    if (missing.length) {
      this.ui.fail(`还缺：${missing.join('、')}。请到资料或基础信息中补充`);
      return null;
    }
    const oid = newId('O');
    const ok = this.write((s) => {
      const lead = s.sales.find((x) => x.id === id)!;
      lead.contactId = c!.id;
      lead.status = '已转商机';
      lead.crmStatus = '已转商机';
      lead.convertedTo = oid;
      lead.convertedDate = BASE_DATE;
      lead.conversionKind = 'opportunity';
      lead.customerCountryAtConversion = conversionCustomer.country;
      lead.customerCountrySnapshot = conversionCustomer.country;
      lead.customerProfileAtConversion = this.customerProfileSnapshot(conversionCustomer);
      const opp = {
        ...structuredClone(lead),
        id: oid,
        type: 'opportunity' as const,
        status: '跟进中',
        leadId: id,
        convertedTo: '',
        operator: this.person(),
        operatorPersonId: identityForRole(this.role())?.personId,
        quoteFlowMode: 'v2' as const,
        productNeeds: structuredClone(lead.productNeeds || []),
        productNeedRevision: Math.max(1, lead.productNeedRevision || 0),
        technicalAssessments: [],
        submittedAt: '',
        submissionHistory: [],
        customerCountryAtConversion: conversionCustomer.country,
        customerCountrySnapshot: conversionCustomer.country,
        customerProfileAtConversion: this.customerProfileSnapshot(conversionCustomer),
        customerCountryConfirmed: '',
      };
      s.sales.push(opp);
      // Sources remain on the lead with stable IDs; opportunity readers follow leadId.
      this.log(s, id, `转商机：${oid}`);
      this.log(s, oid, `由线索${id}转换，客户与资料带入`);
    }, '已转商机，客户、联系人、沟通与资料已带入');
    return ok ? oid : null;
  }
  private customerProfileSnapshot(
    customer: Customer,
  ): NonNullable<SalesRecord['customerProfileAtConversion']> {
    return {
      customerId: customer.id,
      name: customer.name,
      country: customer.country,
      region: customer.region,
      email: customer.email,
      address: customer.address,
      basicInfo: customer.basicInfo,
      owner: customer.owner,
      industry: customer.industry,
      employeeSize: customer.employeeSize,
      status: customer.status,
    };
  }
  convertToCustomer(id: string): string | null {
    const lead = this.sale(id);
    if (!lead || lead.type !== 'lead') return (this.ui.fail('只有线索可以转为客户记录'), null);
    if (!this.customer(lead.customerId)) return (this.ui.fail('请先选择或创建客户'), null);
    if (lead.conversionKind === 'opportunity')
      return (this.ui.fail('该线索已转为商机，不能改写转换结果'), null);
    if (lead.conversionKind === 'customer' && lead.convertedTo === lead.customerId)
      return lead.customerId;
    const ok = this.write((state) => {
      const target = state.sales.find((sale) => sale.id === id)!;
      target.conversionKind = 'customer';
      target.convertedTo = target.customerId;
      target.convertedDate = BASE_DATE;
      target.status = '已转客户';
      target.crmStatus = '已转客户';
      target.customerCountryAtConversion = this.customer(target.customerId)?.country || '';
      target.customerCountrySnapshot = this.customer(target.customerId)?.country || '';
      this.log(state, id, `线索转为客户记录：${target.customerId}；未创建商机`);
    }, '线索已转为客户记录，尚未创建商机');
    return ok ? lead.customerId : null;
  }
  saveProductNeed(opportunityId: string, need: ProductNeed): boolean {
    const opportunity = this.sale(opportunityId);
    if (!opportunity || opportunity.type !== 'opportunity' || isClosed(opportunity))
      return this.ui.fail('只能维护未关闭商机的产品需求');
    if (
      !need.model.trim() ||
      !need.unit.trim() ||
      !Number.isFinite(need.quantity) ||
      need.quantity <= 0
    )
      return this.ui.fail('请填写产品编码、正数数量和单位');
    need = {
      ...need,
      name: need.name?.trim() || productCatalogItem(need.model.trim())?.name || '',
    };
    const previousNeed = structuredClone(
      (opportunity.productNeeds || []).find((item) => item.id === need.id) || null,
    );
    return this.write(
      (state) => {
        const target = state.sales.find((sale) => sale.id === opportunityId)!;
        target.productNeeds ||= [];
        const index = target.productNeeds.findIndex((item) => item.id === need.id);
        const previousNeeds = structuredClone(target.productNeeds);
        if (index < 0) target.productNeeds.push(structuredClone(need));
        else target.productNeeds[index] = structuredClone(need);
        target.productNeedRevision = (target.productNeedRevision || 0) + 1;
        target.productNeedHistory ||= [];
        if (!target.productNeedHistory.length) {
          target.productNeedHistory.push({
            revision: Math.max(1, target.productNeedRevision - 1),
            changedAt: BASE_DATE,
            changeDescription: '需求历史初始化（修改前快照）',
            operator: this.person(),
            productNeeds: previousNeeds,
          });
        }
        target.productNeedHistory.push({
          revision: target.productNeedRevision,
          changedAt: BASE_DATE,
          changeDescription: index < 0 ? `新增需求行 ${need.id}` : `修改需求行 ${need.id}`,
          operator: this.person(),
          productNeeds: structuredClone(target.productNeeds),
        });
        target.customerCountryConfirmed = '';
        if (target.submittedAt) {
          target.submissionHistory ||= [];
          target.submissionHistory.push(target.submittedAt);
          target.submittedAt = '';
          for (const notice of state.notices.filter(
            (item) => item.key === `valid-submission-${opportunityId}` && !item.resolved,
          ))
            notice.resolved = true;
        }
        this.log(
          state,
          opportunityId,
          `产品需求更新至修订${target.productNeedRevision}；既有技术初判保留为历史`,
        );
      },
      '产品需求已保存；旧初判需要按当前修订重新确认',
      this.moduleOperation(
        'opportunity',
        opportunityId,
        opportunity.leadId || opportunityId,
        'opportunity-collaboration',
        '销售',
        '需求',
        '保存产品需求',
        opportunity.owner,
        'product-need',
        need.id,
        [{ field: 'productNeeds', valueType: 'object', before: previousNeed, after: need }],
      ),
    );
  }
  removeProductNeed(opportunityId: string, needId: string): boolean {
    const opportunity = this.sale(opportunityId);
    if (!opportunity || opportunity.type !== 'opportunity' || isClosed(opportunity))
      return this.ui.fail('只能维护未关闭商机的产品需求');
    return this.write((state) => {
      const target = state.sales.find((sale) => sale.id === opportunityId)!;
      const previousNeeds = structuredClone(target.productNeeds || []);
      const oldRevision = Math.max(1, target.productNeedRevision || 1);
      if (!(target.productNeeds || []).some((item) => item.id === needId)) return;
      target.productNeeds = target.productNeeds!.filter((item) => item.id !== needId);
      target.productNeedRevision = (target.productNeedRevision || 0) + 1;
      target.productNeedHistory ||= [];
      if (!target.productNeedHistory.length) {
        target.productNeedHistory.push({
          revision: oldRevision,
          changedAt: BASE_DATE,
          changeDescription: '需求历史初始化（删除前快照）',
          operator: this.person(),
          productNeeds: previousNeeds,
        });
      }
      target.productNeedHistory.push({
        revision: target.productNeedRevision,
        changedAt: BASE_DATE,
        changeDescription: `删除需求行 ${needId}`,
        operator: this.person(),
        productNeeds: structuredClone(target.productNeeds),
      });
      target.customerCountryConfirmed = '';
      if (target.submittedAt) {
        target.submissionHistory ||= [];
        target.submissionHistory.push(target.submittedAt);
        target.submittedAt = '';
        for (const notice of state.notices.filter(
          (item) => item.key === `valid-submission-${opportunityId}` && !item.resolved,
        ))
          notice.resolved = true;
      }
      this.log(
        state,
        opportunityId,
        `删除产品需求并更新至修订${target.productNeedRevision}；旧初判保留`,
      );
    }, '产品需求已删除；旧初判已过期');
  }
  saveTechnicalAssessment(
    opportunityId: string,
    assessment: Omit<
      TechnicalAssessment,
      'id' | 'requirementRevision' | 'requirementSnapshot' | 'date'
    >,
  ): boolean {
    const opportunity = this.sale(opportunityId);
    if (!opportunity || opportunity.type !== 'opportunity' || isClosed(opportunity))
      return this.ui.fail('只有未关闭商机可以记录技术初判');
    const needs = opportunity.productNeeds || [];
    if (!needs.length) return this.ui.fail('请先维护至少一条产品需求');
    const currentEvidence = this.quoteSourceCandidates(opportunityId);
    if (!['满足', '不满足', '待补资料'].includes(assessment.result))
      return this.ui.fail('请选择明确的技术初判结论');
    if (
      assessment.evidenceAttachmentIds.some((id) => !currentEvidence.some((item) => item.id === id))
    )
      return this.ui.fail('初判证据必须来自当前商机或来源线索的需求资料');
    if (assessment.result !== '待补资料' && assessment.evidenceAttachmentIds.length === 0)
      return this.ui.fail('满足或不满足的技术初判必须引用适用证据');
    if (assessment.result === '满足') {
      const missing = this.technicalEvidenceMissing(
        opportunityId,
        assessment.evidenceAttachmentIds,
      );
      if (missing.length) return this.ui.fail(`满足结论还需引用适用资料：${missing.join('、')}`);
    }
    if (!assessment.owner.trim() || !assessment.opinion.trim())
      return this.ui.fail('请填写初判负责人和结论说明');
    const current: TechnicalAssessment = {
      ...structuredClone(assessment),
      id: newId('TA'),
      requirementRevision: opportunity.productNeedRevision || 1,
      requirementSnapshot: structuredClone(needs),
      date: BASE_DATE,
    };
    return this.write(
      (state) => {
        const target = state.sales.find((sale) => sale.id === opportunityId)!;
        target.technicalAssessments ||= [];
        target.technicalAssessments.push(current);
        if (target.submittedAt) {
          target.submissionHistory ||= [];
          target.submissionHistory.push(target.submittedAt);
          target.submittedAt = '';
          for (const notice of state.notices.filter(
            (item) => item.key === `valid-submission-${opportunityId}` && !item.resolved,
          ))
            notice.resolved = true;
        }
        if (current.result === '不满足') {
          target.stage = '丢单';
          target.status = '已关闭';
          target.reason = current.opinion;
          target.closedDate = BASE_DATE;
        }
        this.log(
          state,
          opportunityId,
          `保存技术初判：${current.result}，需求修订${current.requirementRevision}`,
        );
      },
      assessment.result === '不满足' ? '不满足结论已保留，商机已关闭' : '技术初判已保存',
      this.moduleOperation(
        'opportunity',
        opportunityId,
        opportunity.leadId || opportunityId,
        'opportunity-collaboration',
        '方案',
        '技术初判',
        '保存技术初判',
        opportunity.owner,
        'technical-assessment',
        current.id,
        [{ field: 'technicalAssessments', valueType: 'object', before: null, after: current }],
      ),
    );
  }
  submitOpportunity(opportunityId: string): boolean {
    const opportunity = this.sale(opportunityId);
    if (!opportunity || opportunity.type !== 'opportunity' || isClosed(opportunity))
      return this.ui.fail('只有未关闭商机可以有效提交');
    const latest = opportunity.technicalAssessments?.at(-1);
    if (!(opportunity.productNeeds || []).length) return this.ui.fail('请先维护产品需求');
    if (
      !latest ||
      latest.result !== '满足' ||
      latest.requirementRevision !== (opportunity.productNeedRevision || 1)
    )
      return this.ui.fail('需要针对当前需求修订取得“满足”的技术初判');
    if (!this.has(opportunity.leadId || opportunity.id, '需求导入表'))
      return this.ui.fail('有效提交前必须关联需求导入表');
    if (
      !latest.evidenceAttachmentIds.length ||
      latest.evidenceAttachmentIds.some(
        (id) => !this.quoteSourceCandidates(opportunityId).some((file) => file.id === id),
      )
    )
      return this.ui.fail('初判证据缺失或已不适用于当前商机');
    const missingEvidence = this.technicalEvidenceMissing(
      opportunityId,
      latest.evidenceAttachmentIds,
    );
    if (missingEvidence.length)
      return this.ui.fail(`有效提交前需补齐并引用适用资料：${missingEvidence.join('、')}`);
    const missingBusinessFields = this.intentMissing(opportunityId).filter(
      (item) => item !== '重点投标团队确认',
    );
    if (missingBusinessFields.length)
      return this.ui.fail(`有效提交前请逐项补齐：${missingBusinessFields.join('、')}`);
    if (opportunity.submittedAt) {
      this.ui.notify('该商机已有效提交');
      return true;
    }
    return this.write(
      (state) => {
        const target = state.sales.find((sale) => sale.id === opportunityId)!;
        target.submittedAt = BASE_DATE;
        if (!target.pmoAssignment)
          this.notice(
            state,
            `valid-submission-${opportunityId}`,
            opportunityId,
            'pmo',
            '有效商机待分配',
            '销售已完成有效提交，请PMO查看当前需求和初判。',
          );
        this.log(state, opportunityId, '销售有效提交，创建PMO待分配事项');
      },
      '商机已有效提交，PMO待分配事项已创建',
      this.moduleOperation(
        'opportunity',
        opportunityId,
        opportunity.leadId || opportunityId,
        'opportunity-collaboration',
        '销售',
        '有效提交',
        '有效提交商机',
        opportunity.owner,
        'valid-submission',
        opportunityId,
        [
          {
            field: 'submittedAt',
            valueType: 'string',
            before: opportunity.submittedAt || '',
            after: BASE_DATE,
          },
        ],
      ),
    );
  }
  confirmCustomerCountryChange(opportunityId: string): boolean {
    const opportunity = this.sale(opportunityId);
    const customer = opportunity && this.customer(opportunity.customerId);
    if (!opportunity || !customer || (opportunity.type === 'opportunity' && isClosed(opportunity)))
      return this.ui.fail('仅未结束业务可确认客户国家变化');
    return this.write((state) => {
      const target = state.sales.find((sale) => sale.id === opportunityId)!;
      target.customerCountryConfirmed = customer.country;
      this.log(
        state,
        opportunityId,
        `确认客户国家变化：${target.customerCountrySnapshot || '未知'} → ${customer.country}`,
      );
      target.customerCountrySnapshot = customer.country;
    }, '已记录客户国家变化确认');
  }
  createOpportunityAfterAssessment(opportunityId: string): string | null {
    const source = this.sale(opportunityId);
    const latest = source?.technicalAssessments?.at(-1);
    if (
      !source ||
      source.type !== 'opportunity' ||
      source.stage !== '丢单' ||
      latest?.result !== '不满足'
    ) {
      this.ui.fail('只有因技术初判不满足而关闭的商机可以另建机会');
      return null;
    }
    const id = newId('O');
    const ok = this.write((state) => {
      const next: SalesRecord = {
        ...structuredClone(source),
        id,
        stage: '意向沟通',
        status: '跟进中',
        leadId: source.leadId || source.id,
        convertedTo: '',
        conversionKind: 'opportunity',
        reason: '',
        closedDate: '',
        incomeDate: '',
        submittedAt: '',
        submissionHistory: [],
        pmoAssignment: undefined,
        departmentTasks: [],
        departmentTaskConfirmations: [],
        productNeedHistory: [
          {
            revision: 1,
            changedAt: BASE_DATE,
            changeDescription: `从已关闭商机${source.id}复制需求，新商机重新评估`,
            operator: this.person(),
            productNeeds: structuredClone(source.productNeeds || []),
          },
        ],
        productNeedRevision: 1,
        technicalAssessments: [],
        team: [],
        customerRoles: [],
        g1: '未提交',
        needsReview: false,
        quoteFlowMode: 'v2',
        customerCountrySnapshot: this.customer(source.customerId)?.country || '',
        customerCountryConfirmed: '',
      };
      state.sales.push(next);
      this.log(state, source.id, `技术初判不满足后另建商机${id}；原机会及初判历史保留`);
      this.log(state, id, `基于已关闭商机${source.id}另建，需求和初判需重新确认`);
    }, '已另建待评估商机，原关闭记录保留');
    return ok ? id : null;
  }
  addActivity(
    entityId: string,
    data: Omit<Activity, 'id' | 'entityId' | 'customerId' | 'operator' | 'stage'>,
  ): boolean {
    if (!data.summary || !data.date) return this.ui.fail('请填写沟通日期和摘要');
    if (!Number.isFinite(Date.parse(data.date)) || data.date > BASE_DATE)
      return this.ui.fail('沟通日期不得晚于演示基准日2026-10-10');
    const sale = this.sale(entityId);
    if (sale?.type === 'lead' && !this.canOperateSale(sale))
      return this.ui.fail('仅线索负责人、其对应助理或销售主管可记录此线索跟进');
    const p = this.project(entityId);
    return this.write((s) => {
      s.activities.push({
        ...data,
        id: newId('ACT'),
        entityId,
        customerId: sale?.customerId || p?.customerId || '',
        contactId: sale?.contactId || '',
        operator: this.person(),
        operatorPersonId: identityForRole(this.role())?.personId,
        stage: sale?.stage || '项目执行',
      });
      if (data.type !== '内部备注')
        for (const n of s.notices.filter(
          (n) => n.entityId === entityId && n.key.startsWith('cooling'),
        ))
          n.resolved = true;
      this.log(s, entityId, `新增${data.type}记录：${data.summary}`);
    }, '沟通已保存，有效跟进将同步更新冷却提醒');
  }
  intentMissing(id: string): string[] {
    const sale = this.sale(id);
    if (!sale || sale.stage !== '意向沟通') return [];
    return [
      !sale.description ? '项目背景' : '',
      sale.capacity <= 0 ? '预计容量' : '',
      sale.amount <= 0 ? '预计金额' : '',
      !sale.expectedDate ? '预计签单日期' : '',
      !sale.grade ? '人工等级' : '',
      !this.contact(sale) ? '主要联系人' : '',
      !sale.tender ? '是否投标' : '',
      !this.has(id, '需求导入表') ? '需求导入表' : '',
      needsTenderTeam(sale) &&
      (sale.team.length < 3 || sale.team.some((member) => !member.confirmed))
        ? '重点投标团队确认'
        : '',
    ].filter(Boolean);
  }
  opportunityGateMissing(id: string): string[] {
    const sale = this.sale(id);
    if (!sale || sale.type !== 'opportunity') return [];
    const missing = [...this.intentMissing(id)];
    if (!(sale.productNeeds || []).length) missing.push('产品需求行');
    const latest = sale.technicalAssessments?.at(-1);
    if (
      !latest ||
      latest.result !== '满足' ||
      latest.requirementRevision !== (sale.productNeedRevision || 1)
    )
      missing.push('当前需求修订的满足技术初判');
    else if (latest.result === '满足')
      for (const item of this.technicalEvidenceMissing(id, latest.evidenceAttachmentIds))
        missing.push(`${item}证据`);
    if (!sale.submittedAt) missing.push('销售有效提交');
    if (!sale.pmoAssignment) missing.push('PMO手动指定PM');
    if (!sale.departmentScopeConfirmed) missing.push('确认适用协作部门');
    for (const task of sale.departmentTasks || [])
      if (task.status !== '已完成') missing.push(`${task.department}：${task.name}`);
    if (
      needsTenderTeam(sale) &&
      (sale.team.length < 3 || sale.team.some((member) => !member.confirmed)) &&
      !missing.includes('重点投标团队确认')
    )
      missing.push('重点投标团队确认');
    return [...new Set(missing)];
  }
  advance(id: string, operationId = newId('G1OP')): boolean {
    const eventId = `g1:${JSON.stringify([this.state().roundId || 'legacy-round', id, operationId])}`;
    if (this.state().opportunityG1Checks?.some(event => event.id === eventId))
      return this.canEdit() || this.ui.fail('当前标签页没有修改权');
    const x = this.sale(id);
    if (!x || x.type !== 'opportunity' || isClosed(x))
      return this.ui.fail('阶段推进仅适用于未关闭商机');
    if (x.quoteFlowMode === 'v2' && x.stage === '方案报价') {
      const versions = this.quoteSeries(id)?.versions || [];
      if (!versions.some((version) => ['已记录发出', '最终锁定'].includes(version.status)))
        return this.ui.fail('报价流程需至少记录一版已发出的报价后才能进入洽谈，请前往报价标签处理');
    }
    if (x.quoteFlowMode === 'v2' && x.stage === '洽谈') {
      const series = this.quoteSeries(id);
      const final = series?.versions.find(
        (version) => version.id === series.activeFinalVersionId && version.status === '最终锁定',
      );
      if (!final) return this.ui.fail('进入合同谈判前需要最终锁定报价，请前往报价标签处理');
    }
    if (x.stage === '意向沟通') {
      const missing =
        x.quoteFlowMode === 'v2' ? this.opportunityGateMissing(id) : this.intentMissing(id);
      if (missing.length) return this.ui.fail(`阶段推进前请逐项补齐：${missing.join('、')}`);
    } else if (
      !this.activities(id).some((a) => a.stage === x.stage && a.type !== '内部备注') &&
      !(x.stage === '方案报价' && !!this.solution(id)?.latestVersionId)
    )
      return this.ui.fail('请先保存本阶段沟通结果或方案报价样例');
    if (x.stage === '合同谈判') return this.ui.fail('请记录赢单或丢单，并填写关闭原因');
    return this.write((s) => {
      const a = s.sales.find((x) => x.id === id)!;
      if (a.stage === '意向沟通') {
        (s.opportunityG1Checks ||= []).push(createG1Check({
          id: eventId, opportunityId: id,
          sourceRevision: commandInputFingerprint(JSON.parse(JSON.stringify(a))),
          evidenceIds: [id, ...(a.technicalAssessments?.at(-1)?.evidenceAttachmentIds || [])],
          operator: { personId: identityForRole(this.role())?.personId || `demo-role:${this.role()}`, name: this.person() },
          occurredAt: new Date().toISOString(),
        }));
      }
      a.stage = STAGES[STAGES.indexOf(a.stage) + 1];
      this.log(s, id, `进入${a.stage}`);
    }, '本步已完成，已进入下一阶段');
  }
  closeSale(
    id: string,
    result: '赢单' | '丢单',
    reason: string,
    date: string,
    incomeDate: string,
  ): boolean {
    if (this.sale(id)?.type !== 'opportunity') return this.ui.fail('赢单或丢单仅适用于商机');
    if (!reason || (result === '赢单' && !date))
      return this.ui.fail('请填写关闭原因；赢单需要成交日期');
    const sale = this.sale(id)!;
    if (isClosed(sale)) return this.ui.fail('商机已关闭，请勿重复提交');
    if (result === '赢单' && sale.stage !== '合同谈判')
      return this.ui.fail('只有合同谈判阶段的商机可以赢单，请按阶段完成业务结果');
    if (result === '赢单' && sale.quoteFlowMode === 'v2' && !this.finalQuote(id))
      return this.ui.fail('请先锁定有效最终报价，再记录赢单');
    if (result === '赢单' && (!validISODate(date) || date > BASE_DATE))
      return this.ui.fail('成交日期需为有效日期且不能晚于演示基准日');
    if (
      result === '赢单' &&
      this.sale(id)?.stage === '合同谈判' &&
      !this.activities(id).some((a) => a.stage === '合同谈判' && a.type !== '内部备注')
    )
      return this.ui.fail('请先记录合同谈判阶段的沟通摘要，再提交赢单');
    return this.write((s) => {
      const x = s.sales.find((x) => x.id === id)!;
      x.stage = result;
      x.reason = reason;
      x.closedDate = date || BASE_DATE;
      x.incomeDate = incomeDate;
      x.status = '已关闭';
      for (const n of s.notices.filter((n) => n.entityId === id && n.key.startsWith('cooling')))
        n.resolved = true;
      this.log(s, id, `${result}：${reason}`);
    }, '商机已关闭，管道与提醒已同步更新');
  }
  saveCustomerRole(id: string, item: CustomerRole, remove = false): boolean {
    const sale = this.sale(id);
    if (sale?.type === 'lead' && !this.canOperateSale(sale))
      return this.ui.fail('仅线索负责人、其对应助理或销售主管可修改此线索');
    if (sale?.type === 'lead') return this.ui.fail('客户角色仅用于商机，请从商机工作区维护');
    return this.write((s) => {
      const x = s.sales.find((x) => x.id === id)!;
      x.customerRoles = x.customerRoles.filter((r) => r.id !== item.id);
      if (!remove) x.customerRoles.push(item);
      this.notice(
        s,
        `customer-role-${id}`,
        id,
        'solution',
        '客户角色信息更新',
        '请查看最新客户角色及影响说明。',
      );
      this.log(s, id, '更新客户角色，非强制完整关系图');
    }, '客户角色已更新');
  }
  saveDeliveryOpinion(record: SalesRecord): boolean {
    if (this.sale(record.id)?.type !== 'opportunity') return this.ui.fail('交付初判仅适用于商机');
    return this.write((s) => {
      const x = s.sales.find((x) => x.id === record.id)!;
      x.deliveryOpinion = record.deliveryOpinion;
      x.resourceWindow = record.resourceWindow;
      this.log(s, record.id, 'PM记录售前交付初判');
    }, '交付初判已保存');
  }
  assignOpportunityPM(
    opportunityId: string,
    pmId: string,
    pmName: string,
    window: string,
  ): boolean {
    const opportunity = this.sale(opportunityId);
    if (!opportunity || opportunity.type !== 'opportunity') return this.ui.fail('PM只能指派给商机');
    if (!opportunity.submittedAt) return this.ui.fail('请先完成销售有效提交，再由PMO指定PM');
    if (!ROLES.some((role) => role.id === 'pm' && role.id === pmId && role.person === pmName))
      return this.ui.fail('请选择演示名册中的PM');
    if (!pmId.trim() || !pmName.trim() || !window.trim())
      return this.ui.fail('请从模拟人员名单选择PM并填写模拟排期窗口');
    const previous = opportunity.pmoAssignment;
    if (previous?.pmId === pmId && previous.pmName === pmName) {
      this.ui.notify('该PM已指派，无需重复操作');
      return true;
    }
    const assignment: PmoAssignment = { pmId, pmName, window, assignedAt: BASE_DATE };
    return this.write(
      (state) => {
        const target = state.sales.find((item) => item.id === opportunityId)!;
        target.pmoAssignment = assignment;
        if (previous)
          this.log(
            state,
            opportunityId,
            `PM指派变更：${previous.pmName}（${previous.window}）→ ${pmName}（${window}）`,
          );
        else this.log(state, opportunityId, `PMO手动指派PM：${pmName}；模拟窗口：${window}`);
        for (const notice of state.notices.filter(
          (item) => item.key === `valid-submission-${opportunityId}` && !item.resolved,
        ))
          notice.resolved = true;
      },
      'PM已指派；人员和排期窗口仅供模拟展示，不锁定真实资源',
      this.moduleOperation(
        'opportunity',
        opportunityId,
        opportunity.leadId || opportunityId,
        'opportunity-collaboration',
        'PMO',
        '团队',
        '手动指派PM',
        opportunity.owner,
        'pmo-assignment',
        opportunityId,
        [
          {
            field: 'pmoAssignment',
            valueType: 'object',
            before: previous || null,
            after: assignment,
          },
        ],
      ),
    );
  }
  completeDepartmentTask(opportunityId: string, taskId: string): boolean {
    const opportunity = this.sale(opportunityId);
    if (!opportunity || opportunity.type !== 'opportunity')
      return this.ui.fail('部门任务仅适用于商机');
    const task = (opportunity.departmentTasks || []).find((item) => item.id === taskId);
    if (!task) return this.ui.fail('找不到该部门任务，请刷新后重试');
    if (task.status === '已完成') {
      this.ui.notify('该部门任务已完成');
      return true;
    }
    return this.write(
      (state) => {
        const target = state.sales.find((item) => item.id === opportunityId)!;
        const current = target.departmentTasks!.find((item) => item.id === taskId)!;
        current.status = '已完成';
        current.completedBy = this.person();
        current.completedAt = BASE_DATE;
        this.log(state, opportunityId, `部门任务完成：${current.department} · ${current.name}`);
      },
      '部门任务完成情况已单独记录',
      this.moduleOperation(
        'opportunity',
        opportunityId,
        opportunity.leadId || opportunityId,
        'opportunity-collaboration',
        task.department,
        '部门任务',
        '完成部门任务',
        opportunity.owner,
        'department-task',
        taskId,
        [{ field: 'departmentTasks', valueType: 'object', before: task.status, after: '已完成' }],
      ),
    );
  }
  assignTeam(id: string, team: TeamMember[]): boolean {
    if (this.sale(id)?.type === 'lead') return this.ui.fail('线索不维护投标团队');
    const sale = this.sale(id);
    const previousTeam = structuredClone(sale?.team || this.project(id)?.team || []);
    return this.write(
      (s) => {
        const object = s.sales.find((x) => x.id === id) || s.projects.find((x) => x.id === id);
        if (!object) throw new Error('未找到对象');
        object.team = team.map((member) => {
          const previous = previousTeam.find((item) => item.id === member.id);
          return {
            ...member,
            personId:
              knownDemoPersonId(member.person) || member.personId ||
              previous?.personId || knownDemoPersonId(previous?.person || ''),
          };
        });
        if ('type' in object && object.type === 'opportunity') {
          object.departmentScopeConfirmed = true;
          const existing = new Map((object.departmentTasks || []).map((task) => [task.id, task]));
          object.departmentTasks = team.map(
            (member) =>
              existing.get(`DEPT-${member.id}`) || {
                id: `DEPT-${member.id}`,
                department: member.department,
                name: `${member.department}协作准备`,
                status: '待开始' as const,
              },
          );
        }
        for (const n of s.notices.filter((n) => n.entityId === id && n.key.startsWith('team')))
          n.resolved = true;
        for (const t of team)
          this.notice(
            s,
            `team-${id}-${t.id}`,
            id,
            t.role,
            '请确认参与项目',
            `${t.department}：${t.person}，查看需求与责任后确认。`,
          );
        this.log(s, id, '部门负责人指定团队');
      },
      '团队已指定，确认待办已分发',
      this.moduleOperation(
        sale?.type === 'opportunity' ? 'opportunity' : 'project',
        id,
        sale?.leadId || id,
        'opportunity-collaboration',
        'PMO/部门协作',
        '团队',
        '指定部门团队',
        sale?.owner || '项目经理待指定',
        'department-team',
        id,
        [{ field: 'team', valueType: 'array', before: previousTeam, after: team }],
      ),
    );
  }
  confirmTeam(id: string, memberId?: string): boolean {
    const object = this.sale(id) || this.project(id);
    if (!object) return false;
    if ('type' in object && object.type === 'lead') return this.ui.fail('线索不维护投标团队');
    const targets = object.team.filter((t) =>
      memberId ? t.id === memberId : t.role === this.role(),
    );
    if (!targets.length) return this.ui.fail('本角色没有待确认的团队席位');
    return this.write((s) => {
      const x = s.sales.find((x) => x.id === id) || s.projects.find((x) => x.id === id);
      for (const t of x!.team.filter((t) => targets.some((k) => k.id === t.id))) {
        t.confirmed = true;
        t.confirmedBy = this.person();
      }
      if ('type' in x! && x!.type === 'opportunity') {
        x!.departmentTaskConfirmations ||= [];
        for (const member of targets)
          if (
            !x!.departmentTaskConfirmations.some(
              (confirmation) =>
                confirmation.department === member.department &&
                confirmation.personId === member.id,
            )
          )
            x!.departmentTaskConfirmations.push({
              department: member.department,
              personId: member.id,
              personName: member.person,
              confirmedAt: BASE_DATE,
            });
      }
      for (const n of s.notices.filter(
        (n) => n.entityId === id && n.key.startsWith('team') && n.role === this.role(),
      ))
        n.resolved = true;
      this.log(s, id, '确认团队参与/成员责任');
    }, '参与确认已记录');
  }
  remind(id: string): boolean {
    const x = this.sale(id);
    if (!x || x.type !== 'opportunity' || this.days(x) < 30)
      return this.ui.fail('该商机当前不满足冷却条件');
    return this.write((s) => {
      this.notice(
        s,
        `cooling-${id}`,
        id,
        'sales',
        '主管提醒：请跟进客户',
        `${x.owner}负责的${x.projectName}已${this.days(x)}天未更新，请记录有效沟通。`,
      );
      this.log(s, id, '发送站内模拟跟进提醒');
    }, '销售已收到站内模拟提醒');
  }
  markNotice(id: string): void {
    this.write((s) => {
      const n = s.notices.find((x) => x.id === id);
      if (n) n.read = true;
    });
  }
  markPlanWarningRead(projectIdOrWarningId: string, planId?: string): boolean {
    const activeRequired = !!planId;
    const matched = planId ? undefined : this.state().projects.flatMap((project) => project.plans.map((plan) => ({projectId: project.id, planId: plan.id, id: planWarningId(project.id, plan.id)}))).find((warning) => warning.id === projectIdOrWarningId);
    const projectId = matched?.projectId || projectIdOrWarningId;
    planId = matched?.planId || planId;
    const project = this.project(projectId);
    const plan = project?.plans.find((item) => item.id === planId);
    if (!project || !plan) return this.ui.fail('找不到关联计划');
    const warning = currentPlanWarning(
      this.state(),
      project,
      plan,
      this.observationDate(),
      this.person(),
    );
    const personId = knownProjectPersonId(project, this.person());
    if (!personId || !planWarningRecipients(project, plan).includes(personId) || (activeRequired && !warning)) return this.ui.fail('当前身份没有该计划的有效预警');
    if (isPlanWarningRead(this.state(), personId, planWarningId(projectId, planId!))) return true;
    return this.write((state) => {
      state.planWarningReads ||= [];
      state.planWarningReads = appendPlanWarningRead(state, personId, planWarningId(projectId, planId!), new Date().toISOString());
    }, '已标记为本人已读，计划风险仍按日期判断');
  }
  private finalQuote(opportunityId: string): QuoteVersion | undefined {
    const series = this.quoteSeries(opportunityId);
    return series?.versions.find(
      (version) => version.id === series.activeFinalVersionId && version.status === '最终锁定',
    );
  }
  private ensureContract(
    state: DemoState,
    opportunity: SalesRecord,
    finalQuote?: QuoteVersion,
  ): Contract {
    const existing = state.contracts.find(
      (contract) => contract.opportunityId === opportunity.id && contract.status !== '草稿',
    );
    if (existing) return existing;
    const contract: Contract = {
      id: newId('CON'),
      opportunityId: opportunity.id,
      customerId: opportunity.customerId,
      amount: finalQuote ? this.quoteTotals(finalQuote).total! : opportunity.amount,
      currency: finalQuote?.currency || opportunity.currency,
      payment: finalQuote?.payment || '签约30% / 发货60% / 验收10%（样例）',
      penalty: '演示合同约定',
      product: '储能系统',
      g3: '待显式加载模拟结果',
      ...(finalQuote ? { quoteVersionId: finalQuote.id, quoteSeriesId: finalQuote.seriesId } : {}),
      title: `${opportunity.projectName || '项目'}销售合同`,
      contactId: opportunity.contactId,
      scope: finalQuote?.scope || '',
      delivery: finalQuote?.delivery || '',
      warranty: finalQuote?.warranty || '',
      service: finalQuote?.service || '',
      status: '已登记',
      registeredBy: this.person(),
      registeredAt: BASE_DATE,
      ...(finalQuote
        ? {
            serviceSnapshot: {
              quoteVersionId: finalQuote.id,
              warranty: finalQuote.warranty,
              sla: finalQuote.service,
              scope: finalQuote.scope,
            },
          }
        : {}),
    };
    state.contracts.push(contract);
    return contract;
  }
  bridge(id: string): string | null {
    if (!this.allow(['sales', 'assistant', 'manager', 'pm'])) return null;
    const x = this.sale(id);
    if (x?.type !== 'opportunity') {
      this.ui.fail('只有赢单商机可以创建交付项目');
      return null;
    }
    if (x?.stage !== '赢单') {
      this.ui.fail('需先记录赢单；合同/G3随后显式加载模拟结果');
      return null;
    }
    if (
      this.state().contracts.some(
        (contract) => contract.opportunityId === id && contract.status === '草稿',
      )
    ) {
      this.ui.fail('该商机已有合同草稿，请先完成签约登记');
      return null;
    }
    const finalQuote = this.finalQuote(id);
    if (x.quoteFlowMode === 'v2' && !finalQuote) {
      this.ui.fail('V2报价流程需要先锁定最终报价');
      return null;
    }
    const existing = this.state().projects.find((p) => p.opportunityId === id);
    if (existing?.contractId) {
      const linkedContract = this.state().contracts.find(
        (contract) => contract.id === existing.contractId,
      );
      if (linkedContract?.opportunityId === id && linkedContract.status !== '草稿')
        return existing.id;
      this.ui.fail('既有项目引用的合同与来源商机不一致，需先人工核对');
      return null;
    }
    const pid = existing?.id || newId('P');
    return this.write(
      (s) => {
        const cid = this.ensureContract(s, x, finalQuote).id;
        let p = s.projects.find((project) => project.id === pid);
        if (p) {
          p.contractId = cid;
          p.status = '待启动';
          p.team = structuredClone(x.team);
          if (!p.plans.length) this.copyOpportunityRoughPlans(p, x);
        } else {
          p = blankProject(pid, x.customerId, id, cid);
          p.name = x.projectName;
          p.capacity = x.capacity;
          p.unit = x.unit;
          p.contactId = x.contactId;
          p.status = '待启动';
          p.team = structuredClone(x.team);
          this.copyOpportunityRoughPlans(p, x);
          s.projects.push(p);
        }
        this.notice(
          s,
          `accept-${pid}`,
          pid,
          'pm',
          '请接收交付项目',
          '已关联演示合同和来源商机，请完善现场信息。',
        );
        this.log(s, pid, '旧建档旁路归并至既有/新建合同，并创建待启动项目；G3未通过');
      },
      '合同与待启动项目已关联；G3仍需显式加载模拟结果',
      this.moduleOperation(
        'project',
        pid,
        id,
        'contracts',
        '销售',
        '合同来源',
        '归并旧建档并创建项目',
        x.owner,
        'legacy-contract-bridge',
        id,
        [{ field: 'project.id', valueType: 'string', before: '', after: pid }],
      ),
    )
      ? pid
      : null;
  }
  createContractDraft(opportunityId: string): string | null {
    if (!this.allow(['sales', 'assistant', 'manager'])) return null;
    const opportunity = this.sale(opportunityId);
    if (!opportunity || opportunity.type !== 'opportunity' || opportunity.stage === '丢单') {
      this.ui.fail('请选择有效商机');
      return null;
    }
    const existing = this.state().contracts.find(
      (contract) => contract.opportunityId === opportunityId,
    );
    if (existing) {
      this.ui.notify(existing.status === '草稿' ? '该商机已有合同草稿' : '该商机已有登记合同');
      return existing.id;
    }
    const quote = this.finalQuote(opportunityId);
    const id = newId('CON');
    const contract: Contract = {
      id,
      opportunityId,
      customerId: opportunity.customerId,
      amount: quote ? this.quoteTotals(quote).total || 0 : opportunity.amount,
      currency: quote?.currency || opportunity.currency,
      payment: quote?.payment || '',
      penalty: '',
      product:
        quote?.items
          .map((item) => item.name)
          .filter(Boolean)
          .join('、') || '储能系统',
      g3: '未加载',
      ...(quote ? { quoteVersionId: quote.id, quoteSeriesId: quote.seriesId } : {}),
      title: `${opportunity.projectName || '项目'}销售合同`,
      contactId: opportunity.contactId,
      scope: quote?.scope || '',
      delivery: quote?.delivery || '',
      warranty: quote?.warranty || '',
      service: quote?.service || '',
      status: '草稿',
      createdBy: this.person(),
      createdAt: new Date().toISOString(),
      note: '',
      ...(quote
        ? {
            serviceSnapshot: {
              quoteVersionId: quote.id,
              warranty: quote.warranty,
              sla: quote.service,
              scope: quote.scope,
            },
          }
        : {}),
    };
    return this.write(
      (state) => {
        state.contracts.push(contract);
        this.log(state, id, `创建合同草稿，来源商机${opportunityId}`);
      },
      '合同草稿已创建',
      this.moduleOperation(
        'contract',
        id,
        opportunityId,
        'contract-workspace',
        '销售',
        '合同草稿',
        '创建合同草稿',
        opportunity.owner,
        'contract-draft',
        id,
        [{ field: 'contract', valueType: 'object', before: null, after: contract }],
      ),
    )
      ? id
      : null;
  }
  contractMilestones(contractId: string): ContractMilestone[] {
    if (!this.state().contracts.some((contract) => contract.id === contractId)) return [];
    return (this.state().contractMilestones || []).filter((row) => row.contractId === contractId);
  }

  saveContractMilestone(input: ContractMilestoneInput): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    if (!this.canEdit()) return this.ui.fail('当前标签页没有修改权；请接管后重新打开表单');
    if (input.expectedDataVersion !== (this.state().dataVersion || 1))
      return this.ui.fail('表单打开后数据版本已变化；请重新打开表单');
    const contract = this.state().contracts.find((row) => row.id === input.contractId);
    if (!contract) return this.ui.fail('合同不存在，无法保存里程碑');
    const previous = input.id
      ? (this.state().contractMilestones || []).find((row) => row.id === input.id)
      : undefined;
    if (input.id && (!previous || previous.contractId !== contract.id))
      return this.ui.fail('里程碑不存在或所属合同不匹配');
    const error = contractMilestoneError(input);
    if (error) return this.ui.fail(error);
    const next = makeContractMilestone(input, previous, newId('CM'), new Date().toISOString());
    if (JSON.stringify(next) === JSON.stringify(previous)) return true;
    return this.commitOperation({
      object: { type: 'contract', id: contract.id },
      mainlineId: contract.opportunityId,
      module: 'contract-workspace',
      department: '销售',
      section: '合同里程碑',
      action: previous ? '编辑合同里程碑' : '新增合同里程碑',
      owner: { name: next.ownerName, personId: next.ownerPersonId },
      taskSource: { kind: 'contract-milestone', id: next.id },
      changes: [{ field: 'contract.milestone', valueType: 'object', before: previous || null, after: next }],
      change: (state) => {
        state.contractMilestones ||= [];
        const index = state.contractMilestones.findIndex((row) => row.id === next.id);
        if (index < 0) state.contractMilestones.push(next);
        else state.contractMilestones[index] = next;
        this.log(state, contract.id, `${previous ? '编辑' : '新增'}合同里程碑：${next.name}`);
      },
      message: '合同里程碑已保存',
    });
  }

  saveContractMainFields(id: string, input: ContractMainFieldsInput): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    if (!this.canEdit()) return this.ui.fail('当前标签页没有修改权；请接管后重新打开表单');
    if (input.expectedDataVersion !== (this.state().dataVersion || 1))
      return this.ui.fail('表单打开后数据版本已变化；请重新打开表单');
    const contract = this.state().contracts.find((row) => row.id === id);
    if (!contract || contract.status !== '草稿') return this.ui.fail('只有合同草稿可以编辑');
    const fields = structuredClone(contract.crmFields || {});
    for (const [key, value] of Object.entries(input.crmFields)) {
      const definition = CONTRACT_MAIN_FIELDS.find((field) => field.key === key);
      if (!definition?.editable || key === 'alp_contractname')
        return this.ui.fail('此字段须使用专属业务动作维护：' + key);
      if (value !== null && value !== '') {
        const unchanged = JSON.stringify(value) === JSON.stringify(fields[key]);
        if (
          definition.options.length &&
          !definition.options.some((option) => option.value === value) &&
          !unchanged
        )
          return this.ui.fail(definition.label + '必须使用来源枚举原值');
        if (definition.type === 'lookup') {
          if (
            typeof value !== 'object' ||
            !('id' in value) ||
            typeof value.id !== 'string' ||
            typeof value.name !== 'string' ||
            !value.id.trim() ||
            !value.name.trim() ||
            !definition.targets.includes(value.entityType)
          )
            return this.ui.fail(definition.label + '需要目标类型、记录ID与名称');
          if (
            key === 'alp_originalcontract' &&
            (value.id === id || !this.state().contracts.some((row) => row.id === value.id))
          )
            return this.ui.fail('原合同必须关联存在的另一份合同');
        } else if (definition.type === 'datetime') {
          if (
            typeof value !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value
          )
            return this.ui.fail(definition.label + '需要合法日期');
        } else if (definition.type === 'double') {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
            return this.ui.fail(definition.label + '需要非负数值');
        } else if (!definition.options.length && typeof value !== 'string')
          return this.ui.fail(definition.label + '需要文本');
      }
      fields[key] = structuredClone(value);
    }
    if (
      fields['alp_startdate'] &&
      fields['alp_enddate'] &&
      String(fields['alp_startdate']) > String(fields['alp_enddate'])
    )
      return this.ui.fail('结束日期不能早于开始日期');
    const title = input.title === undefined ? contract.title : input.title.trim();
    if (!title) return this.ui.fail('合同名称不能为空');
    const customerAdoptedName =
      input.customerAdoptedName === undefined
        ? contract.customerAdoptedName
        : input.customerAdoptedName.trim();
    const before = {
      title: contract.title,
      customerAdoptedName: contract.customerAdoptedName,
      crmFields: contract.crmFields || {},
    };
    const after = { title, customerAdoptedName, crmFields: fields };
    if (JSON.stringify(before) === JSON.stringify(after)) return true;
    return this.commitOperation({
      object: { type: 'contract', id },
      mainlineId: contract.opportunityId,
      module: 'contract-workspace',
      department: '销售',
      section: '合同主字段',
      action: '保存合同主字段',
      owner: { name: this.sale(contract.opportunityId)?.owner || '未记录' },
      taskSource: { kind: 'contract-main-fields', id },
      changes: [{ field: 'contract.mainFields', valueType: 'object', before, after }],
      change: (state) => {
        const target = state.contracts.find((row) => row.id === id)!;
        target.title = title;
        target.customerAdoptedName = customerAdoptedName;
        target.crmFields = fields;
        target.mainFieldsRevision = (target.mainFieldsRevision || 0) + 1;
        this.log(state, id, '保存合同主字段（本地采用值）');
      },
      message: '合同主字段已保存',
    });
  }
  updateContractDraft(
    id: string,
    changes: Partial<Contract>,
    expectedDataVersion?: number,
  ): boolean {
    if (
      expectedDataVersion !== undefined &&
      expectedDataVersion !== (this.state().dataVersion || 1)
    )
      return this.ui.fail('表单打开后数据版本已变化；请重新打开表单');
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const contract = this.state().contracts.find((item) => item.id === id);
    if (!contract || contract.status !== '草稿') return this.ui.fail('只有合同草稿可以编辑');
    const allowed: (keyof Contract)[] = [
      'title',
      'customerId',
      'contactId',
      'sellerEntity',
      'product',
      'scope',
      'amount',
      'currency',
      'payment',
      'penalty',
      'delivery',
      'warranty',
      'service',
      'plannedSignDate',
      'note',
    ];
    const before = structuredClone(contract);
    return this.write(
      (state) => {
        const target = state.contracts.find((item) => item.id === id)!;
        const previousCustomerId = target.customerId;
        for (const key of allowed) {
          const value = changes[key];
          if (value !== undefined) (target as any)[key] = value;
        }
        if (target.customerId !== previousCustomerId) target.contactId = '';
        this.log(state, id, '编辑合同草稿');
      },
      '合同草稿已保存',
      this.moduleOperation(
        'contract',
        id,
        contract.opportunityId,
        'contract-workspace',
        '销售',
        '合同草稿',
        '保存合同草稿',
        this.sale(contract.opportunityId)?.owner || '未记录',
        'contract-draft',
        id,
        [{ field: 'contract', valueType: 'object', before, after: changes }],
      ),
    );
  }
  /** 按报价号查询候选；只做精确匹配，不自动选择、不更改合同归属。 */
  quoteReferenceCandidates(contractId: string, quoteNumber: string): QuoteReferenceLookup {
    const contract = this.state().contracts.find((row) => row.id === contractId);
    if (!contract)
      return {
        quoteNumber: (quoteNumber || '').trim(),
        candidates: [],
        message: '找不到合同记录；请刷新后重试。',
      };
    return resolveQuoteReferenceCandidates(
      this.state(),
      {
        quoteNumber,
        opportunityId: contract.opportunityId,
        customerId: contract.customerId,
      },
      (version) => this.quoteTotals(version).total,
    );
  }
  /** 合同草稿当前的报价来源、来源快照与差异；旧来源不明时保留待核。 */
  contractQuoteReference(contractId: string): ContractQuoteReferenceView {
    const contract = this.state().contracts.find((row) => row.id === contractId);
    if (!contract) {
      return {
        contractId,
        status: 'empty',
        seriesId: '',
        versionId: '',
        displayNumber: '未关联',
        lockedLabel: '未关联',
        message: '找不到合同记录；请刷新后重试。',
        savedAt: '',
        savedBy: '',
        source: null,
        differences: [],
      };
    }
    return contractQuoteReferenceView({
      state: this.state(),
      contract,
      totalOf: (version) => this.quoteTotals(version).total,
      money: (amount, currency) => this.money(amount, currency),
    });
  }
  /** 保存显式选择的报价版本来源：仅补空白字段，不改客户/商机归属。 */
  saveContractQuoteReference(
    contractId: string,
    input: { seriesId: string; versionId: string },
    expectedDataVersion?: number,
  ): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    if (expectedDataVersion !== undefined && expectedDataVersion !== (this.state().dataVersion || 1))
      return this.ui.fail('表单打开后数据版本已变化；请重新打开表单');
    const contract = this.state().contracts.find((row) => row.id === contractId);
    if (!contract || contract.status !== '草稿')
      return this.ui.fail('只有合同草稿可以关联报价版本来源');
    const series = (this.state().quoteSeries || []).find((row) => row.id === input.seriesId);
    const version = series?.versions.find(
      (row) => row.id === input.versionId && row.seriesId === series.id,
    );
    if (!series || !version)
      return this.ui.fail('请从报价号候选中显式选择版本；手工输入的文本不产生报价版本引用');
    const candidate = this.quoteReferenceCandidates(contractId, series.number).candidates.find(
      (row) => row.versionId === version.id,
    );
    if (!candidate) return this.ui.fail('报价号与所选版本不一致；请重新查询候选');
    if (!candidate.selectable) return this.ui.fail(candidate.message);
    const total = this.quoteTotals(version).total;
    const patch = blankQuoteFields(contract, version, total);
    const snapshot: ContractQuoteReferenceSnapshot = {
      seriesNumber: series.number,
      versionNumber: version.number,
      versionLabel: `V${version.number}`,
      savedAt: new Date().toISOString(),
      savedBy: this.person(),
    };
    const saved = contract.quoteReferenceSnapshot;
    if (
      contract.quoteSeriesId === series.id &&
      contract.quoteVersionId === version.id &&
      saved?.seriesNumber === series.number &&
      saved?.versionNumber === version.number &&
      !Object.keys(patch).length
    )
      return true;
    const before = {
      quoteSeriesId: contract.quoteSeriesId || '',
      quoteVersionId: contract.quoteVersionId || '',
      quoteReferenceSnapshot: contract.quoteReferenceSnapshot || null,
      blankFields: Object.keys(patch),
    };
    return this.write(
      (state) => {
        const target = state.contracts.find((row) => row.id === contractId)!;
        Object.assign(target, patch);
        target.quoteSeriesId = series.id;
        target.quoteVersionId = version.id;
        target.quoteReferenceSnapshot = snapshot;
        this.log(
          state,
          contractId,
          `关联报价版本来源 ${series.number} V${version.number}（仅补空白字段：${
            Object.keys(patch).join('、') || '无'
          }）`,
        );
      },
      `报价版本来源已关联：${series.number} V${version.number}`,
      this.moduleOperation(
        'contract',
        contractId,
        contract.opportunityId,
        'contract-workspace',
        '销售',
        '合同草稿',
        '关联报价版本来源',
        this.sale(contract.opportunityId)?.owner || '未记录',
        'contract-quote-reference',
        contractId,
        [
          { field: 'contract.quoteVersionId', valueType: 'string', before: before.quoteVersionId, after: version.id },
          { field: 'contract.quoteSeriesId', valueType: 'string', before: before.quoteSeriesId, after: series.id },
          { field: 'contract.quoteReferenceSnapshot', valueType: 'object', before: before.quoteReferenceSnapshot, after: snapshot },
          { field: 'contract.blankFields', valueType: 'array', before: [], after: Object.keys(patch) },
        ],
      ),
    );
  }
  paymentTerms(): PaymentTermRecord[] {
    return structuredClone(this.state().paymentTerms || []);
  }
  paymentMethods(paymentTermId?: string): PaymentMethodRecord[] {
    return structuredClone(
      (this.state().paymentMethods || [])
        .map(paymentMethodView)
        .filter((item) => (!paymentTermId || item.paymentTermId === paymentTermId) && item.active),
    );
  }
  savePaymentTerm(
    input: Omit<PaymentTermRecord, 'id' | 'revision' | 'updatedBy' | 'updatedAt'> & { id?: string },
    expectedDataVersion?: number,
  ): boolean {
    if (!this.canEdit()) return this.ui.fail('当前标签页没有修改权；请接管后重新打开表单');
    if (
      expectedDataVersion !== undefined &&
      expectedDataVersion !== (this.state().dataVersion || 1)
    )
      return this.ui.fail('表单打开后数据版本已变化；请重新打开表单');
    input = structuredClone(input);
    if (!this.allow(['finance', 'manager'])) return false;
    if (!input.code.trim() || !input.descriptionZh.trim())
      return this.ui.fail('支付条款代码和中文说明不能为空');
    const previous = input.id
      ? this.state().paymentTerms?.find((item) => item.id === input.id)
      : undefined;
    if (input.id && !previous) return this.ui.fail('原支付主记录已不存在，请刷新后重试');
    if (
      previous &&
      Object.entries(input).every(
        ([key, value]) =>
          JSON.stringify(previous[key as keyof typeof previous]) === JSON.stringify(value),
      )
    )
      return true;
    const record: PaymentTermRecord = {
      ...previous,
      ...input,
      id: previous?.id || newId('PT'),
      createdAt: previous ? previous.createdAt : new Date().toISOString(),
      revision: (previous?.revision || 0) + 1,
      updatedBy: this.person(),
      updatedAt: new Date().toISOString(),
    };
    const before = previous ? structuredClone(previous) : null;
    return this.commitOperation({
      object: { type: 'payment-term', id: record.id },
      mainlineId: record.id,
      module: 'contracts',
      department: '财务',
      section: '支付条款',
      action: previous ? '更新支付条款' : '新增支付条款',
      owner: { name: this.person() },
      taskSource: { kind: 'payment-term', id: record.id },
      changes: [{ field: 'paymentTerm', valueType: 'object', before, after: record }],
      change: (state) => {
        const rows = (state.paymentTerms ||= []);
        const index = rows.findIndex((item) => item.id === record.id);
        if (index < 0) rows.push(record);
        else rows[index] = record;
      },
      message: '支付条款已保存',
    });
  }
  savePaymentMethod(
    input: Omit<PaymentMethodRecord, 'id' | 'revision' | 'updatedBy' | 'updatedAt'> & {
      id?: string;
    },
    expectedDataVersion?: number,
  ): boolean {
    if (!this.canEdit()) return this.ui.fail('当前标签页没有修改权；请接管后重新打开表单');
    if (
      expectedDataVersion !== undefined &&
      expectedDataVersion !== (this.state().dataVersion || 1)
    )
      return this.ui.fail('表单打开后数据版本已变化；请重新打开表单');
    input = structuredClone(input);
    if (!this.allow(['finance', 'manager'])) return false;
    if (!input.name.trim() || !input.condition.trim() || !input.method.trim())
      return this.ui.fail('付款方式名称、付款条件和方式原值不能为空');
    if (
      [input.proportion, input.days, input.fixedAmount].some(
        (value) => value !== null && (!Number.isFinite(value) || value < 0),
      )
    )
      return this.ui.fail('比例、天数和固定金额必须是非负有效数值');
    if (input.days !== null && !Number.isInteger(input.days)) return this.ui.fail('天数必须为整数');
    if (!(this.state().paymentTerms || []).some((item) => item.id === input.paymentTermId))
      return this.ui.fail('请先选择有效的支付条款主记录');
    const previous = input.id
      ? this.state().paymentMethods?.find((item) => item.id === input.id)
      : undefined;
    if (input.id && !previous) return this.ui.fail('原支付主记录已不存在，请刷新后重试');
    if (
      previous &&
      Object.entries(input).every(
        ([key, value]) =>
          JSON.stringify(previous[key as keyof typeof previous]) === JSON.stringify(value),
      )
    )
      return true;
    const record: PaymentMethodRecord = {
      ...previous,
      ...input,
      id: previous?.id || newId('PMT'),
      createdAt: previous ? previous.createdAt : new Date().toISOString(),
      revision: (previous?.revision || 0) + 1,
      updatedBy: this.person(),
      updatedAt: new Date().toISOString(),
    };
    const before = previous ? structuredClone(previous) : null;
    return this.commitOperation({
      object: { type: 'payment-method', id: record.id },
      mainlineId: record.paymentTermId,
      module: 'contracts',
      department: '财务',
      section: '付款方式',
      action: previous ? '更新付款方式' : '新增付款方式',
      owner: { name: this.person() },
      taskSource: { kind: 'payment-method', id: record.id },
      changes: [{ field: 'paymentMethod', valueType: 'object', before, after: record }],
      change: (state) => {
        const rows = (state.paymentMethods ||= []);
        const index = rows.findIndex((item) => item.id === record.id);
        if (index < 0) rows.push(record);
        else rows[index] = record;
      },
      message: '付款方式已保存',
    });
  }
  setContractPaymentSelection(
    contractId: string,
    paymentTermId: string,
    paymentMethodIds: string[],
    expectedDataVersion?: number,
  ): boolean {
    if (!this.canEdit()) return this.ui.fail('当前标签页没有修改权；请接管后重新打开表单');
    if (
      expectedDataVersion !== undefined &&
      expectedDataVersion !== (this.state().dataVersion || 1)
    )
      return this.ui.fail('表单打开后数据版本已变化；请重新打开表单');
    if (!this.allow(['sales', 'assistant', 'manager', 'finance'])) return false;
    const contract = this.state().contracts.find((item) => item.id === contractId);
    const term = this.state().paymentTerms?.find((item) => item.id === paymentTermId);
    const methods = this.state().paymentMethods || [];
    if (!contract || contract.status !== '草稿')
      return this.ui.fail('只有合同草稿可以变更采用的支付条款');
    if (
      !term ||
      paymentMethodIds.some(
        (id) =>
          !methods.some(
            (method) => method.id === id && method.paymentTermId === term.id && method.active,
          ),
      )
    )
      return this.ui.fail('付款方式必须来自所选支付条款且处于有效状态');
    const before = {
      paymentTermId: contract.paymentTermId || '',
      paymentMethodIds: contract.paymentMethodIds || [],
    };
    const after = { paymentTermId, paymentMethodIds: [...new Set(paymentMethodIds)] };
    if (JSON.stringify(before) === JSON.stringify(after)) return true;
    return this.commitOperation({
      object: { type: 'contract', id: contractId },
      mainlineId: contract.opportunityId,
      module: 'contracts',
      department: '销售',
      section: '合同草稿',
      action: '采用支付条款',
      owner: { name: this.sale(contract.opportunityId)?.owner || '未记录' },
      taskSource: { kind: 'contract-payment-selection', id: contractId },
      changes: [{ field: 'paymentSelection', valueType: 'object', before, after }],
      change: (state) => {
        const target = state.contracts.find((item) => item.id === contractId)!;
        target.paymentTermId = paymentTermId;
        target.paymentMethodIds = [...after.paymentMethodIds];
      },
      message: '合同采用的支付条款已保存',
    });
  }
  private contractPaymentSnapshot(
    contract: Contract,
    adoptedText = contract.payment,
  ): Contract['paymentSnapshot'] | false {
    if (!contract.paymentTermId) {
      if (contract.paymentMethodIds?.length)
        return this.ui.fail('已选付款方式缺少支付条款关联，请重新选择');
      return undefined;
    }
    const term = this.state().paymentTerms?.find((item) => item.id === contract.paymentTermId);
    if (!term) {
      return this.ui.fail('采用的支付条款已不存在，请重新选择');
    }
    const methods: PaymentMethodRecord[] = [];
    for (const id of new Set(contract.paymentMethodIds || [])) {
      const method = this.state().paymentMethods?.find((item) => item.id === id);
      if (!method || !method.active || method.paymentTermId !== term.id) {
        return this.ui.fail('所选付款方式已失效、缺失或不属于当前支付条款，请重新选择');
      }
      if (method.contractId && method.contractId !== contract.id) {
        return this.ui.fail('所选付款方式关联其他合同，请重新选择');
      }
      if (method.orderId) {
        return this.ui.fail('付款方式的订单关联尚待核实，不能登记签约');
      }
      methods.push(paymentMethodView(method));
    }
    return {
      term: structuredClone(term),
      methods: structuredClone(methods),
      adoptedText,
      adoptedBy: this.person(),
      adoptedAt: BASE_DATE,
    };
  }
  /** 登记只核验合同已保存的稳定引用，不取“当前最新”替换用户选择。 */
  private signingQuote(contract: Contract): QuoteVersion | undefined {
    const series = (this.state().quoteSeries || []).find(
      (row) => row.id === contract.quoteSeriesId,
    );
    const version = series?.versions.find(
      (row) => row.id === contract.quoteVersionId && row.seriesId === series.id,
    );
    if (!series || !version) {
      this.ui.fail('签约前请关联可确认的报价系列和版本；旧来源保持待核');
      return undefined;
    }
    if (series.opportunityId !== contract.opportunityId) {
      this.ui.fail('报价来源商机与合同不一致，不能登记');
      return undefined;
    }
    if (version.customerId !== contract.customerId) {
      this.ui.fail('报价来源客户与合同主体不一致，不能登记');
      return undefined;
    }
    if (series.activeFinalVersionId !== version.id || version.status !== '最终锁定') {
      this.ui.fail('合同引用版本不是该系列的最终锁定报价，请重新确认来源');
      return undefined;
    }
    return version;
  }
  private adoptedQuoteSnapshot(
    contract: Contract,
    quote: QuoteVersion,
  ): NonNullable<Contract['adoptedQuoteSnapshot']> {
    const series = this.state().quoteSeries!.find((row) => row.id === quote.seriesId)!;
    return structuredClone({
      quoteSeriesId: series.id,
      quoteVersionId: quote.id,
      seriesNumber: series.number,
      versionNumber: quote.number,
      customerId: quote.customerId,
      opportunityId: series.opportunityId,
      lockedAt: quote.lockedDate || '',
      lockedBy: quote.lockedBy || '',
      adoptedAt: new Date().toISOString(),
      adoptedBy: this.person(),
      commercial: {
        total: this.quoteTotals(quote).total!,
        currency: quote.currency,
        payment: quote.payment,
        tradeTerm: quote.tradeTerm,
        tradeNote: quote.tradeNote,
        delivery: quote.delivery,
        validUntil: quote.validUntil,
        freightAmount: quote.freightAmount,
        freightTreatment: quote.freightTreatment,
        dutyAmount: quote.dutyAmount,
        dutyTreatment: quote.dutyTreatment,
        otherFee: quote.otherFee,
        otherFeeTreatment: quote.otherFeeTreatment,
        discount: quote.discount,
      },
      products: quote.items,
      service: {
        scope: quote.scope,
        warranty: quote.warranty,
        service: quote.service,
        solutionSummary: quote.solutionSummary,
        boundaries: quote.boundaries,
      },
      adoptedTerms: {
        amount: contract.amount,
        currency: contract.currency,
        payment: contract.payment,
        product: contract.product,
        scope: contract.scope,
        delivery: contract.delivery,
        warranty: contract.warranty,
        service: contract.service,
        penalty: contract.penalty,
      },
    });
  }
  registerContract(
    id: string,
    signedDate: string,
    evidence: string,
    expectedDataVersion?: number,
  ): boolean {
    if (!this.allow(['manager'])) return false;
    if (
      expectedDataVersion !== undefined &&
      expectedDataVersion !== (this.state().dataVersion || 1)
    )
      return this.ui.fail('签约表单打开后数据版本已变化；请重新打开表单');
    const contract = this.state().contracts.find((item) => item.id === id);
    if (contract?.status === '已登记') return true;
    if (!contract || contract.status !== '草稿') return this.ui.fail('只有合同草稿可以登记签约');
    const opportunity = this.sale(contract.opportunityId);
    if (!opportunity || opportunity.stage !== '赢单')
      return this.ui.fail('来源商机赢单后才能登记签约');
    const finalQuote = this.signingQuote(contract);
    if (!finalQuote) return false;
    if (contract.customerId !== opportunity.customerId)
      return this.ui.fail('合同客户与来源商机不一致，请先修正主体');
    if (finalQuote.customerId !== contract.customerId)
      return this.ui.fail('最终报价客户与合同主体不一致，不能登记');
    const finalAmount = finalQuote ? this.quoteTotals(finalQuote).total : null;
    if (finalAmount === null || !Number.isFinite(finalAmount))
      return this.ui.fail('最终报价金额尚未确认，不能登记合同');
    const contractScope = contract.scope || finalQuote?.scope || '';
    const contractPayment = contract.payment || finalQuote?.payment || '';
    const contractAmount = contract.amount;
    const contractCurrency = contract.currency;
    const paymentSnapshot = this.contractPaymentSnapshot(contract, contractPayment);
    if (paymentSnapshot === false) return false;
    if (
      !contract.title ||
      !contract.sellerEntity ||
      !contract.product ||
      !contractScope ||
      !Number.isFinite(contractAmount) ||
      contractAmount <= 0 ||
      !contractCurrency ||
      !contractPayment ||
      !signedDate ||
      !evidence
    )
      return this.ui.fail('请补齐合同主体、范围、金额、付款、签约日期和凭据');
    if (!validISODate(signedDate) || signedDate > BASE_DATE)
      return this.ui.fail('签约日期需为有效日期且不晚于演示基准日');
    const adoptedQuoteSnapshot = this.adoptedQuoteSnapshot(
      { ...contract, scope: contractScope, payment: contractPayment },
      finalQuote,
    );
    return this.write(
      (state) => {
        const target = state.contracts.find((item) => item.id === id)!;
        target.status = '已登记';
        target.signedDate = signedDate;
        target.evidence = evidence;
        target.registeredBy = this.person();
        target.registeredAt = BASE_DATE;
        target.g3 = '待显式加载模拟结果';
        if (finalQuote) {
          target.quoteVersionId = finalQuote.id;
          target.quoteSeriesId = finalQuote.seriesId;
          target.amount = contractAmount;
          target.currency = contractCurrency;
          target.payment = contractPayment;
          target.scope = contractScope;
          target.serviceSnapshot = {
            quoteVersionId: finalQuote.id,
            warranty: target.warranty || finalQuote.warranty,
            sla: target.service || finalQuote.service,
            scope: contractScope,
          };
          target.adoptedQuoteSnapshot = adoptedQuoteSnapshot;
        }
        target.paymentSnapshot = paymentSnapshot;
        this.log(state, id, `演示登记签约，来源商机${opportunity.id}`);
      },
      '签约信息已登记（演示记录）',
      this.moduleOperation(
        'contract',
        id,
        opportunity.id,
        'contract-workspace',
        '主管',
        '签约',
        '登记签约信息',
        opportunity.owner,
        'contract-signing',
        id,
        [
          {
            field: 'status',
            valueType: 'string',
            before: contract.status || '草稿',
            after: '已登记',
          },
          {
            field: 'contract.adoptedQuoteSnapshot',
            valueType: 'object',
            before: null,
            after: adoptedQuoteSnapshot,
          },
          ...(paymentSnapshot
            ? [
                {
                  field: 'paymentSnapshot',
                  valueType: 'object' as const,
                  before: null,
                  after: paymentSnapshot,
                },
              ]
            : []),
        ],
      ),
    );
  }
  /**
   * Atomically records a valid contract signing, closes its opportunity as won,
   * and creates the first pending project. Repeated calls return the existing
   * contract/project pair without writing a second event.
   */
  registerContractAndStartProject(
    id: string,
    signedDate: string,
    evidence: string,
    expectedDataVersion?: number,
  ): { contractId: string; projectId: string } | null {
    if (!this.allow(['manager'])) return null;
    if (
      expectedDataVersion !== undefined &&
      expectedDataVersion !== (this.state().dataVersion || 1)
    ) {
      this.ui.fail('签约表单打开后数据版本已变化；请重新打开表单');
      return null;
    }
    const contract = this.state().contracts.find((item) => item.id === id);
    const opportunity = contract && this.sale(contract.opportunityId);
    if (!contract || !opportunity || opportunity.type !== 'opportunity') {
      this.ui.fail('没有找到合同或来源商机');
      return null;
    }
    const existingProject = this.state().projects.find((item) => item.contractId === id);
    if (contract.status === '已登记' && opportunity.stage === '赢单' && existingProject)
      return { contractId: contract.id, projectId: existingProject.id };
    if (contract.status !== '草稿') {
      this.ui.fail('只有合同草稿可以登记签约并创建首项目');
      return null;
    }
    if (opportunity.stage !== '合同谈判' || isClosed(opportunity)) {
      this.ui.fail('只有合同谈判中的有效商机可以登记签约');
      return null;
    }
    const finalQuote = this.signingQuote(contract);
    if (!finalQuote) return null;
    if (
      opportunity.stage === '合同谈判' &&
      !this.activities(opportunity.id).some(
        (item) => item.stage === '合同谈判' && item.type !== '内部备注',
      )
    ) {
      this.ui.fail('请先记录合同谈判阶段的沟通摘要，再登记签约');
      return null;
    }
    if (contract.customerId !== opportunity.customerId) {
      this.ui.fail('合同客户与来源商机不一致，请先修正主体');
      return null;
    }
    if (finalQuote && finalQuote.customerId !== contract.customerId) {
      this.ui.fail('最终报价客户与合同主体不一致，不能登记');
      return null;
    }
    const finalAmount = finalQuote ? this.quoteTotals(finalQuote).total : null;
    if (finalAmount === null || !Number.isFinite(finalAmount)) {
      this.ui.fail('最终报价金额尚未确认，不能登记合同');
      return null;
    }
    const contractScope = contract.scope || finalQuote?.scope || '';
    const contractPayment = contract.payment || finalQuote?.payment || '';
    const contractAmount = contract.amount;
    const contractCurrency = contract.currency;
    const paymentSnapshot = this.contractPaymentSnapshot(contract, contractPayment);
    if (paymentSnapshot === false) return null;
    if (
      !contract.title ||
      !contract.sellerEntity ||
      !contract.product ||
      !contractScope ||
      !Number.isFinite(contractAmount) ||
      contractAmount <= 0 ||
      !contractCurrency ||
      !contractPayment ||
      !signedDate ||
      !evidence
    ) {
      this.ui.fail('请补齐合同主体、范围、金额、付款、签约日期和凭据');
      return null;
    }
    if (!validISODate(signedDate) || signedDate > BASE_DATE) {
      this.ui.fail('签约日期需为有效日期且不晚于演示基准日');
      return null;
    }
    const adoptedQuoteSnapshot = this.adoptedQuoteSnapshot(
      { ...contract, scope: contractScope, payment: contractPayment },
      finalQuote,
    );
    const contractId = contract.id;
    const projectId = newId('P');
    const owner = opportunity.owner || '未记录';
    const committed = this.write(
      (state) => {
        const target = state.contracts.find((item) => item.id === contractId)!;
        const sale = state.sales.find((item) => item.id === opportunity.id)!;
        target.status = '已登记';
        target.signedDate = signedDate;
        target.evidence = evidence;
        target.registeredBy = this.person();
        target.registeredAt = BASE_DATE;
        target.g3 = '待显式加载模拟结果';
        if (finalQuote) {
          target.quoteVersionId = finalQuote.id;
          target.quoteSeriesId = finalQuote.seriesId;
          target.amount = contractAmount;
          target.currency = contractCurrency;
          target.payment = contractPayment;
          target.scope = contractScope;
          target.serviceSnapshot = {
            quoteVersionId: finalQuote.id,
            warranty: target.warranty || finalQuote.warranty,
            sla: target.service || finalQuote.service,
            scope: contractScope,
          };
          target.adoptedQuoteSnapshot = adoptedQuoteSnapshot;
        }
        target.paymentSnapshot = paymentSnapshot;
        sale.stage = '赢单';
        sale.status = '已关闭';
        sale.reason = '演示合同签约';
        sale.closedDate = signedDate;
        sale.incomeDate = signedDate;
        for (const notice of state.notices.filter(
          (item) => item.entityId === sale.id && item.key.startsWith('cooling'),
        ))
          notice.resolved = true;

        const project = blankProject(projectId, target.customerId, sale.id, target.id);
        project.name = sale.projectName || target.title || '合同首项目';
        project.pm =
          sale.pmoAssignment?.pmName ||
          sale.team.find((member) => member.role === 'pm')?.person ||
          '';
        project.site = '';
        project.siteConditions = '';
        project.start = '';
        project.capacity = sale.capacity;
        project.unit = sale.unit;
        project.contactId = target.contactId || sale.contactId;
        project.status = '待启动';
        project.team = structuredClone(sale.team);
        project.briefing.production = '';
        project.briefing.shipping = '';
        project.briefing.commissioning = '';
        this.copyOpportunityRoughPlans(project, sale);
        state.projects.push(project);
        this.notice(
          state,
          `accept-${projectId}`,
          projectId,
          'pm',
          '请接收交付项目',
          '已由签约事务创建首个待启动项目，请补充现场信息。',
        );
        this.log(state, contractId, `原子登记签约、赢单并创建首项目${projectId}`);
      },
      '合同签约、商机赢单和首项目已在同次保存完成',
      {
        objectType: 'contract',
        objectId: contractId,
        location: {
          objectType: 'contract',
          objectId: contractId,
          module: 'contracts',
          department: '销售',
          section: '签约',
          action: '签约并创建首项目',
        },
        mainlineId: opportunity.id,
        module: 'contracts',
        department: '销售',
        action: '签约并创建首项目',
        owner,
        taskSource: { kind: 'contract-signing', id: contractId },
        changes: [
          {
            field: 'contract.status',
            valueType: 'string',
            before: contract.status || '草稿',
            after: '已登记',
          },
          {
            field: 'contract.adoptedQuoteSnapshot',
            valueType: 'object',
            before: null,
            after: adoptedQuoteSnapshot,
          },
          ...(paymentSnapshot
            ? [
                {
                  field: 'contract.paymentSnapshot',
                  valueType: 'object' as const,
                  before: null,
                  after: paymentSnapshot,
                },
              ]
            : []),
          {
            field: 'opportunity.stage',
            valueType: 'string',
            before: opportunity.stage,
            after: '赢单',
          },
          { field: 'project.id', valueType: 'string', before: '', after: projectId },
        ],
      },
    );
    return committed ? { contractId, projectId } : null;
  }
  loadContractG3(id: string): boolean {
    if (!this.allow(['manager', 'pm'])) return false;
    const contract = this.state().contracts.find((item) => item.id === id);
    if (!contract || contract.status === '草稿')
      return this.ui.fail('合同草稿不能加载G3或作为项目来源');
    return this.write((state) => {
      const target = state.contracts.find((item) => item.id === id)!;
      target.g3 = '已通过（模拟）';
      this.log(state, id, '显式加载G3模拟结果');
    }, 'G3模拟结果已加载');
  }
  createProjectForContract(contractId: string, name: string, pm: string, site = ''): string | null {
    if (!this.allow(['pm'])) return null;
    const contract = this.state().contracts.find((item) => item.id === contractId);
    const opportunity = this.sale(contract?.opportunityId || '');
    if (!contract || contract.status === '草稿' || !opportunity || opportunity.stage !== '赢单') {
      this.ui.fail('只能从已登记且来源商机已赢单的合同创建项目');
      return null;
    }
    if (!name || !pm) {
      this.ui.fail('请填写项目名称和项目经理');
      return null;
    }
    const projectId = newId('P');
    return this.write((state) => {
      const project = blankProject(
        projectId,
        contract.customerId,
        contract.opportunityId,
        contract.id,
      );
      project.name = name;
      project.pm = pm;
      project.site = site;
      project.contactId = contract.contactId || opportunity.contactId;
      project.capacity = opportunity.capacity;
      project.unit = opportunity.unit;
      project.status = '待启动';
      project.team = structuredClone(opportunity.team);
      this.copyOpportunityRoughPlans(project, opportunity);
      state.projects.push(project);
      this.notice(
        state,
        `accept-${projectId}`,
        projectId,
        'pm',
        '请接收交付项目',
        '已关联登记合同，请完善现场信息。',
      );
      this.log(state, projectId, `由合同${contract.id}创建项目`);
    }, '项目已从登记合同创建')
      ? projectId
      : null;
  }
  associateProjectToContract(projectId: string, contractId: string): boolean {
    if (!this.allow(['pm'])) return false;
    const contract = this.state().contracts.find((item) => item.id === contractId);
    const project = this.project(projectId);
    if (!contract || contract.status === '草稿') return this.ui.fail('只有已登记合同可以关联项目');
    if (!project || project.contractId) return this.ui.fail('请选择尚未关联合同的项目草稿');
    if (
      project.opportunityId !== contract.opportunityId ||
      project.customerId !== contract.customerId
    )
      return this.ui.fail('项目与合同的来源商机或客户主体不一致，不能直接关联');
    return this.write((state) => {
      state.projects.find((item) => item.id === projectId)!.contractId = contractId;
      this.log(state, projectId, `关联登记合同${contractId}`);
    }, '项目已关联合同');
  }
  /**
   * 启动内容的公共写入：只覆盖本次传入的字段，交底来源版本变化时置"待复核"
   * 并保留原确认依据，不代替 PM 确认、G4 或移交。
   */
  private applyStartupContent(state: DemoState, id: string, next: StartupContentValues): void {
    const current = state.projects.find((item) => item.id === id)!;
    if (this.startupSourceChanged(current, next) && current.briefing.review !== '待提交') {
      this.log(
        state,
        current.id,
        `交底关键内容修改前：${JSON.stringify(current.briefing)}；计划启动日期${current.start}`,
      );
      current.briefing.review = '待提交';
      setProjectReview(current, 'briefing', true);
      this.invalidateHandover(state, current, '启动交底关键内容变化');
      for (const notice of state.notices.filter((n) => n.key === `review-${current.id}`))
        notice.resolved = true;
      current.status = '交底待复核';
    }
    // Only the fields owned by this form can change; a stale form cannot restore results.
    current.site = next.site;
    current.siteConditions = next.siteConditions;
    current.start = next.start;
    current.briefing.acceptance = next.acceptance;
    current.briefing.production = next.production;
    current.briefing.shipping = next.shipping;
    current.briefing.commissioning = next.commissioning;
  }
  /**
   * 来源版本是否变化：已提交交底按同一份快照口径比较（与门禁放行判定同源），
   * 尚未提交交底时按本次保存的交底关键内容比较。空串与缺省值统一按空值处理。
   */
  private startupSourceChanged(current: Project, next: StartupContentValues): boolean {
    const recorded = current.briefing.submission?.snapshot;
    if (!recorded) {
      return startupSourceContentChanged(this.startupContentValues(current), next);
    }
    return (
      changedStartupSources(
        recorded,
        this.briefingSnapshot({
          ...current,
          start: next.start,
          briefing: {
            ...current.briefing,
            acceptance: next.acceptance,
            production: next.production,
            shipping: next.shipping,
            commissioning: next.commissioning,
          },
        }),
      ).length > 0
    );
  }
  private startupContentValues(project: Project): StartupContentValues {
    return {
      site: project.site || '',
      siteConditions: project.siteConditions || '',
      start: project.start || '',
      acceptance: project.briefing.acceptance || '',
      production: project.briefing.production || '',
      shipping: project.briefing.shipping || '',
      commissioning: project.briefing.commissioning || '',
    };
  }
  /**
   * 按部门保存启动交底内容：每个字段只有一个维护部门，未知字段直接拒绝；
   * 团队任命、PM确认、G4 与移交结果都不由本入口改动。
   */
  saveStartupContent(
    id: string,
    department: StartupDepartmentKey,
    content: StartupContentInput,
  ): boolean {
    const project = this.project(id);
    if (!project) return this.ui.fail('找不到关联项目，请先创建项目草稿');
    const error = startupContentError(department, content);
    if (error) return this.ui.fail(error);
    const before = this.startupContentValues(project);
    const next = { ...before };
    const changes: OperationFieldChange[] = [];
    const blanks: StartupContentKey[] = [];
    for (const field of startupContentFieldsFor(department)) {
      const raw = content[field.key];
      if (raw === undefined) continue;
      const value = raw.trim();
      if (before[field.key] === value) continue;
      // 交底关键内容是来源版本与门禁的依据，可以把字段改到新值，但不能清空为空值。
      if (!value) {
        blanks.push(field.key);
        continue;
      }
      const target = field.key === 'start' || field.key === 'site' || field.key === 'siteConditions';
      changes.push({
        field: target ? field.key : `briefing.${field.key}`,
        valueType: 'string',
        before: before[field.key] || null,
        after: value,
      });
      next[field.key] = value;
    }
    if (blanks.length)
      return this.ui.fail(
        blanks.map((key) => `【${startupContentLabel(key)}】不能保存为空，请填写有效值`).join('；'),
      );
    if (!changes.length) {
      this.ui.notify('内容没有变化，无需保存');
      return true;
    }
    const owner = startupDepartmentOwner(department);
    const label = startupDepartmentLabel(department);
    return this.commitOperation({
      object: { type: 'project', id },
      mainlineId: project.opportunityId || id,
      module: '项目启动',
      department: owner,
      section: '启动资料',
      action: '保存启动资料',
      owner: { name: project.pm },
      taskSource: { kind: 'project-startup', id },
      changes,
      change: (state) => {
        this.applyStartupContent(state, id, next);
        this.log(state, id, `${label}保存启动交底内容`);
      },
      message: `${label}启动内容已保存`,
    });
  }
  saveProject(project: Project): boolean {
    if (!this.allow(['pm'])) return false;
    if (!this.project(project.id)) return this.ui.fail('找不到关联项目，请先创建项目草稿');
    const before = this.project(project.id)!;
    const changes: OperationFieldChange[] = [];
    const addChange = (field: string, oldValue: unknown, newValue: unknown) => {
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
      const value = newValue === undefined ? null : newValue;
      const valueType: OperationFieldChange['valueType'] =
        value === null
          ? 'null'
          : Array.isArray(value)
            ? 'array'
            : typeof value === 'object'
              ? 'object'
              : (typeof value as OperationFieldChange['valueType']);
      changes.push({ field, valueType, before: oldValue ?? null, after: value });
    };
    addChange('site', before.site, project.site);
    addChange('siteConditions', before.siteConditions, project.siteConditions);
    addChange('start', before.start, project.start);
    for (const key of ['acceptance', 'production', 'shipping', 'commissioning'] as const)
      addChange(`briefing.${key}`, before.briefing[key], project.briefing[key]);
    if (!changes.length) {
      this.ui.notify('内容没有变化，无需保存');
      return true;
    }
    return this.commitOperation({
      object: { type: 'project', id: project.id },
      mainlineId: before.opportunityId || project.id,
      module: '项目启动',
      department: 'PM',
      section: '启动资料',
      action: '保存启动资料',
      owner: { name: before.pm },
      taskSource: { kind: 'project-startup', id: project.id },
      changes,
      change: (s) => {
        this.applyStartupContent(s, project.id, {
          site: project.site,
          siteConditions: project.siteConditions,
          start: project.start,
          acceptance: project.briefing.acceptance,
          production: project.briefing.production,
          shipping: project.briefing.shipping,
          commissioning: project.briefing.commissioning,
        });
        this.log(s, project.id, '保存项目现场与业务信息');
      },
      message: '项目信息已保存',
    });
  }
  createProjectDraft(name: string, pm: string, site: string, opportunityId = ''): string | null {
    if (!this.allow(['pm'])) return null;
    if (!name || !pm) {
      this.ui.fail('请填写项目名称和拟任PM');
      return null;
    }
    const opportunity = opportunityId ? this.sale(opportunityId) : undefined;
    if (opportunityId && (!opportunity || opportunity.stage === '丢单')) {
      this.ui.fail('请选择有效商机');
      return null;
    }
    const id = newId('P');
    return this.write((s) => {
      const p = blankProject(id, opportunity?.customerId || '', opportunityId, '');
      p.name = name;
      p.pm = pm;
      p.site = site;
      p.start = '';
      p.status = opportunity ? '待准备交付' : '待关联商机';
      if (opportunity) {
        p.contactId = opportunity.contactId;
        p.capacity = opportunity.capacity;
        p.unit = opportunity.unit;
        p.team = structuredClone(opportunity.team);
        this.copyOpportunityRoughPlans(p, opportunity);
      }
      s.projects.push(p);
      this.log(
        s,
        id,
        opportunityId ? `创建项目草稿并关联商机${opportunityId}` : '创建待关联商机的项目草稿',
      );
    }, '项目号已生成，项目草稿已保存')
      ? id
      : null;
  }
  associateProject(id: string, opportunityId: string): boolean {
    if (!this.allow(['pm'])) return false;
    const p = this.project(id);
    const opportunity = this.sale(opportunityId);
    if (!p || p.opportunityId || p.contractId)
      return this.ui.fail('仅未关联来源的项目草稿可以关联商机');
    if (!opportunity || opportunity.stage === '丢单') return this.ui.fail('请选择有效商机');
    return this.write((s) => {
      const target = s.projects.find((x) => x.id === id)!;
      const source = s.sales.find((x) => x.id === opportunityId)!;
      target.opportunityId = source.id;
      target.customerId = source.customerId;
      target.contactId = source.contactId;
      target.capacity = source.capacity;
      target.unit = source.unit;
      target.team = structuredClone(source.team);
      target.status = source.stage === '赢单' ? '待准备交付' : '待准备交付';
      this.copyOpportunityRoughPlans(target, source);
      this.log(s, id, `关联来源商机${source.id}`);
    }, '来源商机已关联，项目号保持不变');
  }
  loadProjectContract(id: string): boolean {
    if (!this.allow(['pm'])) return false;
    const project = this.project(id);
    const opportunity = this.sale(project?.opportunityId || '');
    if (!project || !opportunity || opportunity.stage !== '赢单')
      return this.ui.fail('来源商机赢单后才能加载合同/G3模拟来源');
    const finalQuote = this.finalQuote(opportunity.id);
    if (opportunity.quoteFlowMode === 'v2' && !finalQuote)
      return this.ui.fail('V2报价流程需要先锁定最终报价');
    if (
      this.state().contracts.some(
        (contract) => contract.opportunityId === opportunity.id && contract.status === '草稿',
      )
    )
      return this.ui.fail('该商机已有合同草稿，请先完成签约登记');
    return this.write((s) => {
      const p = s.projects.find((x) => x.id === id)!;
      const contract = this.ensureContract(s, opportunity, finalQuote);
      p.contractId = contract.id;
      p.status = '待启动';
      this.log(s, id, '显式加载合同/G3模拟来源');
    }, '合同与G3模拟来源已加载');
  }
  acceptProject(id: string): boolean {
    if (!this.allow(['pm'])) return false;
    const candidate = this.project(id);
    if (!candidate?.opportunityId || !candidate.contractId)
      return this.ui.fail('请先关联赢单商机并加载合同/G3模拟来源');
    return this.write((s) => {
      const project = s.projects.find((p) => p.id === id)!;
      project.accepted = true;
      project.status = '待启动';
      this.log(s, id, 'PM接收项目');
      for (const n of s.notices.filter((n) => n.entityId === id && n.key.startsWith('accept')))
        n.resolved = true;
    }, '项目已接收，请补充启动交底资料');
  }
  addSubproject(parentId: string, name: string, site: string, pm: string): string | null {
    if (!this.allow(['pm'])) return null;
    if (!name || !site || !pm) {
      this.ui.fail('请填写子项目名称、现场/批次和PM');
      return null;
    }
    const parent = this.project(parentId)!;
    const id = newId('P');
    return this.write((s) => {
      const p = blankProject(id, parent.customerId, parent.opportunityId, parent.contractId);
      p.name = name;
      p.site = site;
      p.pm = pm;
      const opportunity = s.sales.find((sale) => sale.id === parent.opportunityId);
      if (opportunity?.type === 'opportunity') this.copyOpportunityRoughPlans(p, opportunity);
      s.projects.push(p);
      this.log(s, id, `新增子项目，引用合同${parent.contractId}`);
    }, '子项目已创建，计划与资料独立维护')
      ? id
      : null;
  }
  /**
   * 启动交底门禁的只读判定：页面按钮状态、待复核提示和 Store 保存校验
   * 都读取这里，避免页面禁用条件与保存前置各写一套。
   */
  startupGate(id: string): StartupGateState {
    const project = this.project(id);
    if (!project) {
      const input: StartupGateInput = {
        accepted: false,
        contractRegistered: false,
        submissionVersion: null,
        submissionMatchesSource: false,
        confirmationVersion: null,
        g4Result: '',
        handoverStatus: '',
        missing: [],
      };
      return {
        ...input,
        exists: false,
        confirmationNeedsReview: false,
        changedSources: [],
        actions: startupGateActions(input),
      };
    }
    const contract = this.state().contracts.find((item) => item.id === project.contractId);
    const submission = project.briefing.submission;
    const confirmation = project.briefing.confirmation;
    const current = this.briefingSnapshot(project) as StartupSourceSnapshot;
    const recorded = submission?.snapshot as StartupSourceSnapshot | undefined;
    const changedSources = recorded ? changedStartupSources(recorded, current) : [];
    const matches = startupSourceMatches(recorded, current);
    const input: StartupGateInput = {
      accepted: project.accepted,
      contractRegistered: !!contract && contract.status !== '草稿',
      submissionVersion: submission?.version ?? null,
      submissionMatchesSource: matches,
      confirmationVersion: confirmation?.version ?? null,
      g4Result: project.briefing.g4?.result || '',
      handoverStatus: project.briefing.startupHandover?.status || '',
      missing: this.briefingMissing(id),
    };
    return {
      ...input,
      exists: true,
      confirmationNeedsReview:
        !!confirmation && (input.confirmationVersion !== input.submissionVersion || !matches),
      changedSources,
      actions: startupGateActions(input),
    };
  }
  briefingMissing(id: string): string[] {
    const p = this.project(id);
    if (!p) return [];
    return [
      !p.start ? '计划启动日期' : '',
      !p.briefing.acceptance ? '验收标准' : '',
      !this.has(id, '启动纪要') ? '启动纪要' : '',
      !this.has(id, '启动文件') ? '启动文件' : '',
    ].filter(Boolean);
  }
  private briefingSnapshot(project: Project): ProjectBriefingSubmission['snapshot'] {
    const contract = this.state().contracts.find((item) => item.id === project.contractId);
    return {
      contractId: project.contractId,
      quoteVersionId: contract?.quoteVersionId || '',
      contractFileVersionId: contract?.currentContractFileVersionId || '',
      contract: {
        title: contract?.title || '',
        amount: contract?.amount || 0,
        currency: contract?.currency || '',
        payment: contract?.payment || '',
        penalty: contract?.penalty || '',
        product: contract?.product || '',
        scope: contract?.scope || '',
      },
      projectName: project.name,
      start: project.start || '',
      acceptance: project.briefing.acceptance || '',
      production: project.briefing.production || '',
      shipping: project.briefing.shipping || '',
      commissioning: project.briefing.commissioning || '',
      attachmentIds: this.attachments(project.id)
        .filter((item) => STARTUP_BRIEFING_DOCUMENT_KINDS.includes(item.kind))
        .map((item) => item.id)
        .sort(),
    };
  }
  canSubmitContractBriefing(id: string): boolean {
    const project = this.project(id);
    if (!project) return false;
    return (
      project.briefing.startupHandover?.status !== '已移交' ||
      !startupSourceMatches(
        project.briefing.submission?.snapshot as StartupSourceSnapshot | undefined,
        this.briefingSnapshot(project) as StartupSourceSnapshot,
      )
    );
  }
  submitContractBriefing(id: string, opinion: string): boolean {
    if (!this.allow(['sales'])) return false;
    const project = this.project(id);
    const gate = this.startupGate(id);
    if (!project || !gate.actions.submit.allowed) return this.ui.fail(gate.actions.submit.reason);
    if (!opinion.trim()) return this.ui.fail('请填写交底差异与遗留事项意见');
    const previous = project.briefing.submission;
    const submission: ProjectBriefingSubmission = {
      version: (previous?.version || 0) + 1,
      submittedBy: this.person(),
      submittedAt: new Date().toISOString(),
      opinion: opinion.trim(),
      snapshot: this.briefingSnapshot(project),
    };
    const owner = this.sale(project.opportunityId)?.owner || '销售负责人待核';
    return this.commitOperation({
      object: { type: 'project', id },
      mainlineId: project.opportunityId || id,
      module: '项目启动',
      department: '销售',
      section: '合同交底',
      action: '提交合同交底',
      owner: { name: owner },
      taskSource: { kind: 'project-briefing', id },
      changes: [
        {
          field: 'briefing.submission',
          valueType: 'object',
          before: previous || null,
          after: submission,
        },
      ],
      change: (state) => {
        const target = state.projects.find((item) => item.id === id)!;
        target.briefing.submission = structuredClone(submission);
        target.briefing.confirmation = undefined;
        target.briefing.g4 = { result: '待审核', reviewer: '', reviewedAt: '', opinion: '' };
        target.briefing.startupHandover = {
          status: '待移交',
          sender: '',
          receiver: '',
          transferredAt: '',
          opinion: '',
          briefingVersion: submission.version,
        };
        if (project.briefing.startupHandover?.status === '已移交')
          setProjectReview(target, 'briefing', true);
        this.log(state, id, `销售提交合同交底V${submission.version}`);
      },
      message: `合同交底V${submission.version}已提交，等待PM确认`,
    });
  }
  confirmContractBriefing(id: string, opinion: string): boolean {
    if (!this.allow(['pm'])) return false;
    const project = this.project(id);
    const gate = this.startupGate(id);
    if (!project || !gate.actions.confirm.allowed)
      return this.ui.fail(gate.actions.confirm.reason);
    if (!opinion.trim()) return this.ui.fail('请填写PM确认意见');
    const submission = project.briefing.submission!;
    const confirmation: ProjectBriefingConfirmation = {
      version: submission.version,
      confirmedBy: this.person(),
      confirmedAt: new Date().toISOString(),
      opinion: opinion.trim(),
    };
    return this.commitOperation({
      object: { type: 'project', id },
      mainlineId: project.opportunityId || id,
      module: '项目启动',
      department: 'PM',
      section: '合同交底',
      action: '确认合同交底',
      owner: { name: project.pm },
      taskSource: { kind: 'project-briefing', id },
      changes: [
        {
          field: 'briefing.confirmation',
          valueType: 'object',
          before: project.briefing.confirmation || null,
          after: confirmation,
        },
      ],
      change: (state) => {
        state.projects.find((item) => item.id === id)!.briefing.confirmation =
          structuredClone(confirmation);
        this.log(state, id, `PM确认合同交底V${submission.version}`);
      },
      message: `PM已确认合同交底V${submission.version}`,
    });
  }
  recordProjectG4(id: string, result: ProjectG4Review['result'], opinion: string): boolean {
    if (!this.allow(['pmo'])) return false;
    const project = this.project(id);
    const gate = this.startupGate(id);
    if (!project || !gate.actions.g4.allowed) return this.ui.fail(gate.actions.g4.reason);
    if (!['通过', '附条件通过', '退回'].includes(result) || !opinion.trim())
      return this.ui.fail('请选择有效G4结果并填写意见');
    const review: ProjectG4Review = {
      result,
      reviewer: this.person(),
      reviewedAt: new Date().toISOString(),
      opinion: opinion.trim(),
    };
    return this.commitOperation({
      object: { type: 'project', id },
      mainlineId: project.opportunityId || id,
      module: '项目启动',
      department: 'PMO',
      section: 'G4审核',
      action: `记录G4${result}`,
      owner: { name: project.pm },
      taskSource: { kind: 'project-g4', id },
      changes: [
        {
          field: 'briefing.g4',
          valueType: 'object',
          before: project.briefing.g4 || null,
          after: review,
        },
      ],
      change: (state) => {
        state.projects.find((item) => item.id === id)!.briefing.g4 = structuredClone(review);
        this.log(state, id, `PMO记录G4${result}，不代表正式移交`);
      },
      message: `G4模拟结果已记录：${result}`,
    });
  }
  completeStartupHandover(id: string, receiver: string, opinion: string): boolean {
    if (!this.allow(['pm'])) return false;
    const project = this.project(id);
    const gate = this.startupGate(id);
    if (gate.handoverStatus === '已移交') return true;
    if (!project || !gate.actions.handover.allowed)
      return this.ui.fail(gate.actions.handover.reason);
    const submission = project.briefing.submission!;
    if (!receiver.trim() || !opinion.trim()) return this.ui.fail('请填写移交接收人和意见');
    const handover: ProjectStartupHandover = {
      status: '已移交',
      sender: this.person(),
      receiver: receiver.trim(),
      transferredAt: new Date().toISOString(),
      opinion: opinion.trim(),
      briefingVersion: submission.version,
    };
    return this.commitOperation({
      object: { type: 'project', id },
      mainlineId: project.opportunityId || id,
      module: '项目启动',
      department: 'PM',
      section: '正式移交',
      action: '完成项目启动移交',
      owner: { name: project.pm },
      taskSource: { kind: 'project-startup-handover', id },
      changes: [
        {
          field: 'briefing.startupHandover',
          valueType: 'object',
          before: project.briefing.startupHandover || null,
          after: handover,
        },
        { field: 'status', valueType: 'string', before: project.status, after: '项目执行中' },
      ],
      change: (state) => {
        const target = state.projects.find((item) => item.id === id)!;
        target.briefing.startupHandover = structuredClone(handover);
        setProjectReview(target, 'briefing', false);
        target.status = '项目执行中';
        this.log(state, id, `项目启动正式移交给${receiver.trim()}`);
      },
      message: 'G4通过，项目启动移交已完成',
    });
  }
  submitBriefing(id: string): boolean {
    if (!this.allow(['pm'])) return false;
    const missing = this.briefingMissing(id);
    if (missing.length) return this.ui.fail(`还缺：${missing.join('、')}。可在交底资料区补齐`);
    return this.write((s) => {
      const p = s.projects.find((p) => p.id === id)!;
      p.briefing.review = '模拟审核中';
      for (const n of s.notices.filter((n) => n.entityId === id && n.key.startsWith('return-')))
        n.resolved = true;
      this.notice(
        s,
        `review-${id}`,
        id,
        'pmo',
        '交底待查看OA模拟结果',
        '请应用预置通过、附条件通过或退回结果。',
      );
      this.log(s, id, '提交交底，资料完整性不等于审核通过');
      this.syncMilestone(
        s.projects.find((x) => x.id === id)!,
        '项目启动交底',
        '进行中',
      );
    }, '已提交交底，切换PMO查看模拟结果');
  }
  review(id: string, result: string, opinion: string): boolean {
    if (!this.allow(['pmo'])) return false;
    const p = this.project(id)!;
    if (p.briefing.review !== '模拟审核中')
      return this.ui.fail('请PM先补齐资料并提交交底，再应用模拟结果');
    if (!opinion) return this.ui.fail('请填写模拟审核意见');
    return this.write((s) => {
      const x = s.projects.find((p) => p.id === id)!;
      x.briefing.review = result;
      x.briefing.opinion = opinion;
      if (result === '附条件通过')
        x.conditions.push({
          id: newId('CD'),
          text: opinion,
          owner: '周方案',
          due: '2026-10-18',
          evidence: '',
          closed: false,
        });
      if (result === '退回') {
        x.status = '交底待补充';
        x.briefing.returns++;
        this.notice(s, `return-${id}-${x.briefing.returns}`, id, 'pm', '交底退回，请补充', opinion);
        if (x.briefing.returns >= 2)
          this.notice(
            s,
            `escalation-${id}`,
            id,
            'pmo',
            '第二次退回：模拟升级提醒',
            '管理层接收对象待正式确认，仅演示记录。',
          );
      }
      if (result === '通过' || result === '附条件通过') setProjectReview(x, 'briefing', false);
      for (const n of s.notices.filter((n) => n.key === `review-${id}`)) n.resolved = true;
      this.log(s, id, `OA模拟结果：${result}，${opinion}`);
    }, '交底模拟结果已记录');
  }
  conditionEvidence(id: string, conditionId: string, evidence: string): boolean {
    if (!this.allow(['solution', 'pm', 'pmo'])) return false;
    if (!evidence) return this.ui.fail('请填写关闭凭据说明或资料引用');
    return this.write((s) => {
      s.projects.find((p) => p.id === id)!.conditions.find((c) => c.id === conditionId)!.evidence =
        evidence;
      this.notice(
        s,
        `condition-${conditionId}`,
        id,
        'pmo',
        '条件凭据待确认',
        '责任人已补充凭据，请确认条件关闭。',
      );
      this.log(s, id, '补充交底条件关闭凭据');
    }, '凭据已保存，待PMO确认');
  }
  closeCondition(id: string, conditionId: string): boolean {
    if (!this.allow(['pmo'])) return false;
    const c = this.project(id)!.conditions.find((c) => c.id === conditionId)!;
    if (!c.evidence) return this.ui.fail('条件尚无关闭凭据，请先补充');
    return this.write((s) => {
      s.projects.find((p) => p.id === id)!.conditions.find((c) => c.id === conditionId)!.closed =
        true;
      for (const n of s.notices.filter((n) => n.key === `condition-${conditionId}`))
        n.resolved = true;
      this.log(s, id, `PMO关闭条件：${c.text}`);
    }, '条件已关闭，各处未完成数量同步');
  }
  canEditPlan(plan: Plan): boolean {
    return plan.type !== '产研来源';
  }
  planReadiness(projectId: string): Array<{ planId: string; name: string; missing: string[] }> {
    const project = this.project(projectId);
    if (!project) return [];
    return (project.plans || [])
      .map((plan) => {
        const missing = [
          !plan.owner?.trim() ? '负责人' : '',
          !validISODate(plan.start) || !validISODate(plan.end) ? '有效计划起止日期' : '',
          plan.sourceStatus === '已引用' && !plan.sourceReference?.trim()
            ? '来源引用'
            : !plan.sourceType && !plan.sourceReference?.trim()
              ? '来源规则/说明'
              : '',
        ].filter(Boolean);
        return { planId: plan.id, name: plan.name, missing };
      })
      .filter((item) => item.missing.length > 0);
  }
  /**
   * BUD02/BUD03 同源摘要：表格、计划与预算面板、项目概况读取同一个纯函数结果，
   * 按 projectId+planId 去重、分币种以最小货币单位合计，不跨币种换算。
   */
  planBudgetSummary(projectId: string): ProjectBudgetSummary {
    const project = this.project(projectId);
    return summarizeProjectBudget(projectId, project?.plans || []);
  }
  savePlan(projectId: string, plan: Plan, operationId = newId('OP')): boolean {
    if (!this.canEditPlan(plan))
      return this.ui.fail('本角色不能修改此计划，产研及实际来源始终只读');
    const project = this.project(projectId);
    if (!project) return this.ui.fail('找不到关联项目');
    const oldPlan = project.plans.find((candidate) => candidate.id === plan.id);
    plan = {
      ...plan,
      ownerPersonId: knownProjectPersonId(
        project,
        plan.owner,
        oldPlan?.owner === plan.owner ? oldPlan.ownerPersonId || plan.ownerPersonId : undefined,
      ),
    };
    plan = { ...plan, completionKind: oldPlan ? completionKind(oldPlan) : completionKind(plan) };
    const syncEligible = ['内部WBS', '要货发货', 'FAT测试'].includes(plan.type);
    const isCustomerMilestone = plan.type === '客户主节点';
    const customerMilestone = isCustomerMilestone
      ? plan
      : plan.customerMilestoneId
        ? project.plans.find(
            (candidate) =>
              candidate.type === '客户主节点' && candidate.id === plan.customerMilestoneId,
          )
        : undefined;
    if (plan.customerMilestoneId && !customerMilestone)
      return this.ui.fail('所选客户主节点已不存在，请重新选择');
    if (plan.customerMilestoneId && !syncEligible)
      return this.ui.fail('当前计划类型不能绑定客户主节点');
    if (!plan.name || !validDateRange(plan.start, plan.end))
      return this.ui.fail('请填写名称及有效起止日期，开始不能晚于结束');
    if (
      (plan.expected && !validISODate(plan.expected)) ||
      (plan.actual && !validISODate(plan.actual))
    )
      return this.ui.fail('预计日期或实际日期无效');
    if (
      !Number.isFinite(plan.amount) ||
      plan.amount < 0 ||
      !Number.isInteger(plan.quantity) ||
      plan.quantity <= 0
    )
      return this.ui.fail('金额不能为负数，数量必须是正整数');
    if (
      plan.durationDays !== undefined &&
      (!Number.isInteger(plan.durationDays) || plan.durationDays < 0)
    )
      return this.ui.fail('计划天数必须为非负整数');
    if (
      plan.warningLeadDays !== undefined &&
      plan.warningLeadDays !== null &&
      !isValidWarningLeadDays(plan.warningLeadDays)
    )
      return this.ui.fail('预警天数必须为非负整数；留空表示待补');
    if (oldPlan?.warningLeadDays !== plan.warningLeadDays) {
      plan = { ...plan, warningLeadDaysSource: undefined };
    }
    if (plan.type === '内部WBS') {
      // BUD01：仅内部WBS在新建/编辑保存时要求独立预算金额与币种齐全；
      // 0 合法，缺值/负数/NaN/无穷/超两位精度明确报错而不静默截断。
      const budget = validateBudget(plan.budgetAmount, plan.budgetCurrency);
      if (!budget.valid) return this.ui.fail(budget.message);
      const previousBudgetUnchanged =
        oldPlan?.budgetAmount === budget.amount &&
        (oldPlan?.budgetCurrency || '') === budget.currency;
      plan = {
        ...plan,
        budgetAmount: budget.amount,
        budgetCurrency: budget.currency,
        // 金额/币种未变时保留原来源（样例仍标“模拟”）；一旦改动即为本次业务填报。
        budgetSource: previousBudgetUnchanged
          ? oldPlan!.budgetSource || plan.budgetSource || '业务填报'
          : '业务填报',
      };
    } else if (plan.budgetAmount !== undefined || plan.budgetCurrency !== undefined) {
      // 预算只属于内部WBS：其他计划类型不承载预算，避免混入分币种汇总。
      const { budgetAmount, budgetCurrency, budgetSource, ...rest } = plan;
      plan = rest;
    }
    if (plan.type === '内部WBS' && !oldPlan && !isValidWarningLeadDays(plan.warningLeadDays))
      return this.ui.fail('新增内部WBS必须填写预警日期（提前天数），请输入非负整数');
    if (plan.sourceStatus === '已引用' && !plan.sourceReference?.trim())
      return this.ui.fail('标记已引用时必须保留来源引用');
    if (plan.status === '已完成' && !plan.actual)
      return this.ui.fail('完成任务需要填写实际完成日期');
    if (
      plan.type === 'FAT测试' &&
      plan.status === '已完成' &&
      (plan.result !== '合格' || !this.has(projectId, 'FAT报告'))
    )
      return this.ui.fail('FAT完成需要合格结论与报告，计划日期不代表测试通过');
    if (plan.type === '内部WBS' && plan.status === '已完成') {
      if (
        (plan.completionKind === 'briefing' || /启动/.test(plan.name)) &&
        (this.briefingMissing(projectId).length ||
          this.project(projectId)!.briefing.startupHandover?.status !== '已移交')
      )
        return this.ui.fail('启动任务需交底资料齐备并完成G4后的正式项目移交');
      if (
        ['sat', 'acceptance', 'handover'].includes(plan.completionKind || '') ||
        /验收|移交/.test(plan.name)
      )
        return this.ui.fail('关键验收/移交任务请在专用页面完成，不能用普通状态绕过');
    }
    const dateChanged = oldPlan?.expected !== plan.expected || oldPlan?.actual !== plan.actual;
    const bindingChanged = oldPlan?.customerMilestoneId !== plan.customerMilestoneId;
    const statusChanged = oldPlan?.status !== plan.status;
    const agreedDateChanged = isCustomerMilestone && oldPlan?.end !== plan.end;
    const syncRelevantChange = dateChanged || bindingChanged || statusChanged || agreedDateChanged;
    const missingStableBinding = syncEligible && syncRelevantChange && !customerMilestone;
    const changes = oldPlan
      ? operationFieldChanges(oldPlan, plan)
      : [{ field: 'plan', valueType: 'object' as const, before: null, after: plan }];
    return this.commitOperation({
      object: { type: 'project', id: projectId },
      mainlineId: project.opportunityId || projectId,
      module: '项目计划',
      department: ROLES.find((role) => role.id === this.role())?.name || this.role(),
      section: `计划:${plan.type}`,
      action: '保存项目计划',
      owner: { name: plan.owner || project.pm },
      taskSource: { kind: 'project-plan', id: plan.id },
      changes,
      change: (s) => {
        const p = s.projects.find((p) => p.id === projectId)!;
        const i = p.plans.findIndex((x) => x.id === plan.id);
        if (i >= 0) p.plans[i] = structuredClone(plan);
        else p.plans.push(structuredClone(plan));
        if (syncEligible) {
          s.projectMilestoneBindings = (s.projectMilestoneBindings || []).filter(
            (binding) => !(binding.projectId === projectId && binding.sourcePlanId === plan.id),
          );
          if (customerMilestone)
            s.projectMilestoneBindings!.push({
              projectId,
              sourcePlanId: plan.id,
              customerMilestoneId: customerMilestone.id,
            });
        }
        if (!oldPlan || bindingChanged) registerDeliveryPlan(s, p, plan.id);
        if (customerMilestone && syncRelevantChange && (syncEligible || isCustomerMilestone)) {
          const alreadyRecorded = s.milestoneSyncRecords!.some(
            (record) =>
              record.projectId === projectId &&
              record.sourcePlanId === plan.id &&
              record.operationId === operationId,
          );
          if (!alreadyRecorded) {
            const history = s.milestoneSyncRecords!.filter(
              (record) => record.projectId === projectId && record.sourcePlanId === plan.id,
            );
            const record: MilestoneSyncRecord = {
              id: `MILESTONE-SYNC-${plan.id}-${operationId}`,
              projectId,
              sourcePlanId: plan.id,
              sourcePlanName: plan.name,
              customerMilestoneId: customerMilestone.id,
              customerMilestoneName: customerMilestone.name,
              oldCustomerAgreedDate: isCustomerMilestone
                ? oldPlan?.end || ''
                : customerMilestone.end,
              customerAgreedDate: customerMilestone.end,
              revision: history.length + 1,
              operationId,
              oldExpectedDate: oldPlan?.expected || '',
              newExpectedDate: plan.expected || '',
              oldActualDate: oldPlan?.actual || '',
              newActualDate: plan.actual || '',
              oldStatus: oldPlan?.status || '',
              newStatus: plan.status,
              operator: this.person(),
              createdAt: new Date().toISOString(),
              status: 'simulated',
            };
            s.milestoneSyncRecords!.push(record);
          }
        }
        if (plan.type === '客户主节点') {
          this.notice(
            s,
            `milestone-${projectId}-${plan.id}`,
            projectId,
            'sales',
            '客户主节点日期变化',
            `${plan.name}：${plan.end}，${plan.note}`,
          );
          this.notice(
            s,
            `milestone-pm-${projectId}-${plan.id}`,
            projectId,
            'pm',
            '客户主节点日期变化',
            `${plan.name}：${plan.end}`,
          );
        }
        this.syncMilestoneWarnings(s, projectId);
        if (s.financeSnapshots?.some((snapshot) => snapshot.projectId === projectId))
          this.syncReceivables(s, projectId);
        this.log(s, projectId, `保存${plan.type}：${plan.name}`);
      },
      message: missingStableBinding
        ? '计划已保存；请关联客户主节点后再生成财务模拟同步记录'
        : '计划已保存；已绑定客户节点的日期变化会生成财务模拟同步记录',
    });
  }
  addProjectRisk(
    projectId: string,
    input: Omit<ProjectRiskRecord, 'id' | 'sourceStatus' | 'createdAt' | 'operator'>,
  ): boolean {
    if (
      !input.category.trim() ||
      !input.level.trim() ||
      !input.likelihood.trim() ||
      !input.status.trim() ||
      !input.description.trim()
    )
      return this.ui.fail('风险记录需填写类别、等级、可能性、状态和说明');
    if (!input.sourceReference.trim())
      return this.ui.fail('请填写风险来源引用；无法核实时保留待核说明');
    return this.write((state) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) throw new Error('找不到关联项目');
      project.riskRecords ||= [];
      project.riskRecords.push({
        ...input,
        id: newId('RISK'),
        sourceStatus: '待核',
        createdAt: new Date().toISOString(),
        operator: this.person(),
      });
      this.log(state, projectId, `新增风险 / 问题记录：${input.category}（来源待核）`);
    }, '风险 / 问题记录已保存；来源仍需核对');
  }
  addProjectCommunication(
    projectId: string,
    input: Omit<ProjectCommunicationRecord, 'id' | 'sourceStatus' | 'createdAt' | 'operator'>,
  ): boolean {
    if (!['需求澄清', '执行情况', '需求变更', '回款信息', '问题风险'].includes(input.type))
      return this.ui.fail('请选择已有客户沟通类型');
    if (!validISODate(input.date) || !input.summary.trim())
      return this.ui.fail('请填写手工登记日期和沟通摘要');
    if (!input.sourceReference.trim())
      return this.ui.fail('请填写沟通记录的来源引用；无法核实时标明待核');
    return this.write((state) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) throw new Error('找不到关联项目');
      project.communicationRecords ||= [];
      project.communicationRecords.push({
        ...input,
        id: newId('COMM'),
        sourceStatus: '待核',
        createdAt: new Date().toISOString(),
        operator: this.person(),
      });
      this.log(state, projectId, `新增客户沟通记录：${input.type}（来源待核）`);
    }, '客户沟通记录已保存；未导入外部消息时间线');
  }
  addEquipmentSerial(
    projectId: string,
    input: Omit<
      EquipmentSerialRecord,
      'id' | 'projectId' | 'contractId' | 'sourceStatus' | 'createdAt' | 'operator'
    >,
  ): boolean {
    if (
      !input.serialNumber.trim() ||
      !input.model.trim() ||
      !input.status.trim() ||
      !input.siteLocation.trim()
    )
      return this.ui.fail('设备SN、型号、状态和现场位置不能为空');
    if (!Number.isInteger(input.quantity) || input.quantity <= 0)
      return this.ui.fail('设备数量必须为正整数');
    if (input.actualDate && !validISODate(input.actualDate))
      return this.ui.fail('设备节点实际日期无效');
    if (input.actualDate && !input.sourceReference.trim())
      return this.ui.fail('实际日期需要明确来源引用');
    return this.write((state) => {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) throw new Error('找不到关联项目');
      project.equipmentSerialRecords ||= [];
      project.equipmentSerialRecords.push({
        ...input,
        id: newId('SN'),
        projectId: project.id,
        contractId: project.contractId,
        sourceStatus: '待核',
        createdAt: new Date().toISOString(),
        operator: this.person(),
      });
      this.log(state, projectId, `新增设备SN记录：${input.serialNumber}（来源待核）`);
    }, '设备SN记录已保存；未声明MES实时同步');
  }
  deletePlan(id: string, planId: string): boolean {
    const plan = this.project(id)!.plans.find((p) => p.id === planId)!;
    if (!this.canEditPlan(plan)) return this.ui.fail('当前角色不能删除该计划');
    if (plan.status === '已完成') return this.ui.fail('已完成计划保留历史，请修改或重新复核');
    if (
      plan.type === '客户主节点' &&
      this.state().projectMilestoneBindings?.some(
        (binding) => binding.projectId === id && binding.customerMilestoneId === planId,
      )
    )
      return this.ui.fail('该客户节点仍被项目计划引用，请先解除关联');
    return this.write((s) => {
      const p = s.projects.find((p) => p.id === id)!;
      p.plans = p.plans.filter((x) => x.id !== planId);
      s.projectMilestoneBindings = (s.projectMilestoneBindings || []).filter(
        (binding) => !(binding.projectId === id && binding.sourcePlanId === planId),
      );
      this.log(s, id, `删除计划草稿：${plan.name}`);
    }, '计划行已删除');
  }
  applyTemplate(id: string, regional: boolean): boolean {
    if (!this.allow(['pm'])) return false;
    return this.write((s) => {
      const p = s.projects.find((p) => p.id === id)!;
      const replacedPlanIds = new Set(p.plans.filter((x) => x.type === '内部WBS').map((x) => x.id));
      p.plans = [
        ...p.plans.filter((x) => x.type !== '内部WBS'),
        ...makePlans(newId('WBS'), regional).map((x) => ({ ...x, status: '未开始', actual: '' })),
      ];
      s.projectMilestoneBindings = (s.projectMilestoneBindings || []).filter(
        (binding) => !(binding.projectId === id && replacedPlanIds.has(binding.sourcePlanId)),
      );
      this.log(s, id, `应用${regional ? '区域' : '标准'}演示WBS模板`);
    }, '模板已生成内部计划，其他类型保持不变');
  }
  applicability(id: string, applicable: boolean, reason: string): boolean {
    if (!this.allow(['pm'])) return false;
    if (!applicable && !reason) return this.ui.fail('不适用需要填写原因');
    return this.write((s) => {
      const p = s.projects.find((p) => p.id === id)!;
      p.productionApplicable = applicable;
      p.productionReason = reason;
      this.log(s, id, '记录产研计划适用性，不修改来源');
    }, '适用性已保存');
  }
  submitSpare(id: string, planId: string): boolean {
    if (!this.allow(['pm'])) return false;
    const plan = this.project(id)!.plans.find((x) => x.id === planId)!;
    if (!plan.end || !plan.receiver || !this.has(id, '备件清单'))
      return this.ui.fail('还缺：需求日期、备件清单或接收专员，请补齐再提交');
    return this.write((s) => {
      s.projects.find((p) => p.id === id)!.plans.find((x) => x.id === planId)!.status = '已提交';
      this.notice(
        s,
        `spare-${planId}`,
        id,
        'spare',
        '调试备件需求已提交',
        `${plan.name}，需求日期${plan.end}，请查看清单。`,
      );
      this.log(s, id, '提交备件需求，站内通知接收专员');
    }, '备件需求已提交');
  }
  saveSat(id: string, date: string, result: string, complete = false): boolean {
    if (!this.allow(['pm'])) return false;
    if (!this.project(id)) return this.ui.fail('找不到关联项目');
    if (date && !validISODate(date)) return this.ui.fail('请填写有效SAT测试日期');
    if (complete && (!date || result !== '合格' || !this.has(id, 'SAT报告')))
      return this.ui.fail('SAT完成需要测试日期、合格结论与报告');
    return this.write(
      (s) => {
        const p = s.projects.find((p) => p.id === id)!;
        const changed =
          p.sat.date !== date || p.sat.result !== result || p.sat.complete !== complete;
        if (changed) {
          this.log(s, id, `SAT修改前：${JSON.stringify(p.sat)}`);
          this.invalidateHandover(s, p, 'SAT结果或测试日期变化');
        }
        p.sat = { date, result, complete };
        if (changed || p.reviewReasons?.includes('sat'))
          p.status = complete ? '客户验收中' : 'SAT测试中';
        setProjectReview(p, 'sat', !complete);
        if (complete) {
          this.syncMilestone(p, '调试测试', '已完成', date);
        }
        this.log(s, id, complete ? 'PM确认SAT完成' : '保存SAT测试草稿');
      },
      complete ? 'SAT已完成，客户验收仍需分别签认' : 'SAT草稿已保存',
    );
  }
  saveAcceptance(
    id: string,
    itemId: string,
    result: string,
    signer: string,
    date: string,
    note: string,
  ): boolean {
    if (!this.allow(['pm'])) return false;
    return this.write((s) => {
      const p = s.projects.find((p) => p.id === id)!;
      const a = p.acceptance.find((a) => a.id === itemId)!;
      const changed = a.result !== result || a.signer !== signer || a.date !== date;
      if (changed) {
        this.log(s, id, `验收项修改前：${JSON.stringify(a)}`);
        if (p.acceptanceComplete) setProjectReview(p, 'acceptance', true);
        p.acceptanceComplete = false;
        this.invalidateHandover(s, p, '客户验收签认或结果变化');
      }
      Object.assign(a, { result, signer, date, note });
      this.log(s, id, `更新验收检查项：${a.name}`);
    }, '检查项已保存，请逐项确认');
  }
  completeAcceptance(id: string): boolean {
    if (!this.allow(['pm'])) return false;
    const p = this.project(id)!;
    if (!acceptanceReady(p, this.has(id, '客户签字清单')))
      return this.ui.fail('还有未通过/未签认项，或缺客户签字清单，请逐项补齐');
    return this.write((s) => {
      s.projects.find((p) => p.id === id)!.acceptanceComplete = true;
      const project = s.projects.find((p) => p.id === id)!;
      if (project.handover.status !== '已接收') project.status = '客户验收中';
      this.syncMilestone(project, '客户验收', '已完成', BASE_DATE);
      setProjectReview(project, 'acceptance', false);
      this.log(s, id, '记录客户逐项验收完成，非电子签章');
    }, '客户验收已记录完成');
  }
  saveHandover(id: string, project: Project): boolean {
    if (!this.allow(['pm'])) return false;
    return this.write((s) => {
      const current = s.projects.find((p) => p.id === id)!;
      const content = {
        receiver: project.handover.receiver,
        categories: structuredClone(project.handover.categories),
        issues: structuredClone(project.handover.issues),
      };
      const changed =
        current.handover.receiver !== content.receiver ||
        JSON.stringify(current.handover.categories) !== JSON.stringify(content.categories) ||
        JSON.stringify(current.handover.issues) !== JSON.stringify(content.issues);
      if (changed) this.invalidateHandover(s, current, '移交资料、接收方或遗留事项变化');
      Object.assign(current.handover, content);
      this.log(s, id, '保存移交资料与遗留事项草稿');
    }, '移交草稿已保存');
  }
  submitHandover(id: string): boolean {
    if (!this.allow(['pm'])) return false;
    const p = this.project(id)!;
    if (!p.sat.complete || !this.has(id, 'SAT报告'))
      return this.ui.fail('SAT尚未完成或报告需复核，请先完成SAT及凭据');
    if (p.reviewReasons?.some((reason) => reason !== 'handover'))
      return this.ui.fail(`请先完成复核：${this.projectReviewLabels(p)}`);
    if (!this.handoverReady(p))
      return this.ui.fail('请明确接收方、补齐八类资料状态和不适用原因，并填写遗留事项负责人/期限');
    if (p.handover.status === '已接收') return this.ui.fail('移交已接收，请保留历史');
    if (p.handover.status === '待接收') return true;
    return this.write((s) => {
      s.projects.find((p) => p.id === id)!.handover.status = '待接收';
      for (const n of s.notices.filter(
        (n) => n.entityId === id && n.key.startsWith('handover-return-'),
      ))
        n.resolved = true;
      this.notice(
        s,
        `handover-${id}`,
        id,
        'receiver',
        '内部移交待接收',
        '请查看八类资料与遗留事项，确认收到或退回。',
      );
      this.log(s, id, '提交内部移交申请，等待接收确认');
    }, '移交已提交，接收方收到待办');
  }
  receive(id: string, result: string, opinion: string): boolean {
    if (!this.allow(['receiver'])) return false;
    const p = this.project(id)!;
    if (p.handover.status !== '待接收') return this.ui.fail('当前没有待接收申请');
    if (!['已接收', '退回补充'].includes(result)) return this.ui.fail('请选择接收或退回补充');
    if (result === '已接收' && (!p.sat.complete || !this.has(id, 'SAT报告')))
      return this.ui.fail('SAT凭据变化，需PM重新复核后提交');
    if (result === '已接收' && p.reviewReasons?.some((reason) => reason !== 'handover'))
      return this.ui.fail(`当前仍需复核：${this.projectReviewLabels(p)}`);
    if (result === '已接收' && !this.handoverReady(p))
      return this.ui.fail('移交资料已不完整，请PM补齐后重新提交');
    if (result === '退回补充' && !opinion) return this.ui.fail('请填写具体退回原因');
    return this.write(
      (s) => {
        const p = s.projects.find((p) => p.id === id)!;
        p.handover.status = result;
        p.handover.opinion = opinion;
        if (result === '已接收') {
          p.status = '已移交';
          this.syncMilestone(p, '内部移交', '已完成', BASE_DATE);
          setProjectReview(p, 'handover', false);
        }
        for (const n of s.notices.filter((n) => n.key === `handover-${id}`)) n.resolved = true;
        if (result === '退回补充')
          this.notice(s, `handover-return-${id}`, id, 'pm', '移交退回，请补充', opinion);
        this.log(s, id, `移交${result}：${opinion}`);
      },
      result === '已接收' ? '已确认收到，申请和接收分别留痕' : '已退回PM补充',
    );
  }
  private syncMilestone(project: Project, name: string, status: string, actual = ''): void {
    const kind = completionKind({ type: '内部WBS', name });
    const plan = project.plans.find(
      (x) => x.type === '内部WBS' && (kind ? completionKind(x) === kind : x.name === name),
    );
    if (plan) {
      plan.status = status;
      if (status === '已完成') plan.actual = actual || BASE_DATE;
    }
  }
  projectReviewLabels(project: Project): string {
    return (project.reviewReasons || []).map((reason) => PROJECT_REVIEW_LABELS[reason]).join('、');
  }
  private handoverReady(project: Project): boolean {
    const h = project.handover;
    return (
      !!h.receiver &&
      h.categories.length === HANDOVER_TYPES.length &&
      HANDOVER_TYPES.every((name) => h.categories.filter((c) => c.name === name).length === 1) &&
      h.categories.every(
        (c) => c.status === '已有资料' || (c.status === '不适用' && !!c.note.trim()),
      ) &&
      h.issues.every((issue) => !!issue.owner && validISODate(issue.due))
    );
  }
  private invalidateHandover(state: DemoState, project: Project, reason: string): void {
    if (!['待接收', '已接收', '待复核'].includes(project.handover.status)) return;
    this.log(
      state,
      project.id,
      `移交复核前记录：${JSON.stringify(project.handover)}；变更原因：${reason}`,
    );
    project.handover.status = '待复核';
    project.status = '移交待复核';
    project.handover.opinion = `${reason}，请PM复核并重新提交；原提交与接收历史保留`;
    setProjectReview(project, 'handover', true);
    for (const notice of state.notices.filter((n) => n.key === `handover-${project.id}`))
      notice.resolved = true;
  }
  customerMilestone(
    projectId: string,
    customerMilestoneId: string,
    state: DemoState = this.state(),
  ): Plan | undefined {
    return state.projects
      .find((project) => project.id === projectId)
      ?.plans.find((plan) => plan.type === '客户主节点' && plan.id === customerMilestoneId);
  }
  customerMilestoneActualDate(
    projectId: string,
    customerMilestoneId: string,
    state: DemoState = this.state(),
  ): string | undefined {
    const milestone = this.customerMilestone(projectId, customerMilestoneId, state);
    return milestone?.status === '已完成' && validISODate(milestone.actual)
      ? milestone.actual
      : undefined;
  }
  creditPolicy(
    projectId: string,
    state: DemoState = this.state(),
  ): CreditPolicySnapshot | undefined {
    return state.creditPolicies?.find((policy) => policy.projectId === projectId);
  }
  creditDateFacts(projectId: string, state: DemoState = this.state()) {
    const policy = this.creditPolicy(projectId, state);
    const milestone = policy?.startCustomerMilestoneId
      ? this.customerMilestone(projectId, policy.startCustomerMilestoneId, state)
      : undefined;
    const actualStart = milestone
      ? this.customerMilestoneActualDate(projectId, milestone.id, state)
      : undefined;
    const expectedStart =
      milestone?.status !== '已完成' && milestone?.expected && validISODate(milestone.expected)
        ? milestone.expected
        : undefined;
    const addDays = (date?: string) => {
      if (!date || !policy || !Number.isInteger(policy.days) || policy.days < 0) return undefined;
      const result = new Date(`${date}T00:00:00.000Z`);
      result.setUTCDate(result.getUTCDate() + policy.days);
      return result.toISOString().slice(0, 10);
    };
    return {
      policy,
      milestone,
      actualStart,
      expectedStart,
      actualDue: addDays(actualStart),
      expectedDue: addDays(expectedStart),
      label: actualStart
        ? '模拟推算到期日（客户节点实际完成日＋账期）'
        : expectedStart
          ? '预计到期日（客户节点预计日期＋账期，不判实际逾期）'
          : '无法判断：缺少有效节点日期或信用政策',
    };
  }
  invoiceDue(projectId: string, invoice: FinanceInvoice, state: DemoState = this.state()) {
    if ('contractId' in invoice && 'cumulativeSource' in invoice) {
      const contextualInvoice = this.invoiceWithMilestoneFacts(
        invoice as ContractInvoice,
        state,
        projectId,
      );
      const facts = invoiceDueFacts(contextualInvoice, BASE_DATE);
      return {
        date: facts.effectiveDate,
        forecastDate: facts.forecastDate,
        source: facts.source,
      };
    }
    if (invoice.due)
      return validISODate(invoice.due)
        ? { date: invoice.due, forecastDate: '', source: '发票约定到期日' }
        : { date: '', forecastDate: '', source: '无法判断：发票约定到期日格式无效' };
    const facts = this.creditDateFacts(projectId, state);
    if (facts.actualDue) return { date: facts.actualDue, forecastDate: '', source: facts.label };
    return {
      date: '',
      forecastDate: facts.expectedDue || '',
      source: facts.expectedDue ? facts.label : '无法判断：缺少有效日期或政策',
    };
  }
  invoiceFacts(projectId: string, invoice: FinanceInvoice, state: DemoState = this.state()) {
    if ('contractId' in invoice && 'cumulativeSource' in invoice) {
      const canonical = this.invoiceWithMilestoneFacts(
        invoice as ContractInvoice,
        state,
        projectId,
      );
      const claims = this.invoiceClaims(state).filter(
        (claim) =>
          claim.invoiceId === canonical.id &&
          claim.status === '有效' &&
          claim.currency === canonical.currency,
      );
      const facts = calculateInvoiceBalance(canonical, claims, BASE_DATE);
      const ageDays =
        canonical.issued && validISODate(canonical.issued)
          ? Math.max(
              0,
              Math.floor(
                (Date.parse(`${BASE_DATE}T00:00:00.000Z`) -
                  Date.parse(`${canonical.issued}T00:00:00.000Z`)) /
                  86400000,
              ),
            )
          : null;
      const overdue = facts.due.actual && facts.balance > 0 ? facts.due.overdueDays : 0;
      return {
        balance: facts.balance,
        overdue,
        age: ageDays,
        band:
          ageDays === null
            ? '无法判断'
            : ageDays <= 30
              ? '0–30'
              : ageDays <= 60
                ? '31–60'
                : ageDays <= 90
                  ? '61–90'
                  : '90以上',
        status:
          facts.status === '数据异常：负余额'
            ? facts.status
            : facts.balance === 0
              ? '已收齐'
              : !facts.due.effectiveDate
                ? '无法判断到期'
                : overdue > 0
                  ? '逾期'
                  : '未逾期',
      };
    }
    return invoiceFacts(invoice, this.invoiceDue(projectId, invoice, state).date);
  }
  milestoneWarnings(projectId: string): MilestoneWarning[] {
    return (this.state().milestoneWarnings || []).filter(
      (warning) => warning.projectId === projectId,
    );
  }
  private syncMilestoneWarnings(state: DemoState, projectId: string): void {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    const plans = project.plans.filter((plan) =>
      ['内部WBS', '要货发货', 'FAT测试', '客户主节点'].includes(plan.type),
    );
    const active: MilestoneWarning[] = plans
      .filter(
        (plan) =>
          plan.status !== '已完成' &&
          !!plan.expected &&
          validISODate(plan.expected) &&
          plan.expected < BASE_DATE,
      )
      .map((plan) => {
        const binding = state.projectMilestoneBindings?.find(
          (item) => item.projectId === projectId && item.sourcePlanId === plan.id,
        );
        return {
          id: `MILESTONE-WARNING-${projectId}-${plan.id}`,
          projectId,
          sourcePlanId: plan.id,
          customerMilestoneId: binding?.customerMilestoneId,
          kind: '节点延期',
          dueDate: plan.expected,
          offsetDays: Math.floor((Date.parse(BASE_DATE) - Date.parse(plan.expected)) / 86400000),
          owner: 'pm',
        };
      });
    state.milestoneWarnings = [
      ...(state.milestoneWarnings || []).filter((warning) => warning.projectId !== projectId),
      ...active,
    ];
    const activeKeys = new Set(
      active.map((warning) => `v4-milestone-${projectId}-${warning.sourcePlanId}`),
    );
    for (const notice of state.notices.filter((item) =>
      item.key.startsWith(`v4-milestone-${projectId}-`),
    ))
      if (!activeKeys.has(notice.key)) notice.resolved = true;
    for (const warning of active) {
      const plan = plans.find((item) => item.id === warning.sourcePlanId)!;
      const key = `v4-milestone-${projectId}-${plan.id}`;
      const notice = state.notices.find((item) => item.key === key && !item.resolved);
      const text = `${plan.name} · 预计${warning.dueDate} · 已延期${warning.offsetDays}天`;
      if (notice) notice.text = text;
      else this.notice(state, key, projectId, 'pm', '项目节点延期', text);
    }
  }
  milestoneSyncHistory(projectId: string): MilestoneSyncRecord[] {
    return (this.state().milestoneSyncRecords || [])
      .filter((record) => record.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  solution(id: string) {
    return this.state().solutionSeries?.find((x) => x.opportunityId === id);
  }
  solutionDocuments(id: string) {
    return selectSolutionBusinessRecords(this.state(), id);
  }
  solutionConfirmation(id: string): SolutionConfirmation | undefined {
    return selectBusinessConfirmation(this.state(), id);
  }
  addSolutionDocument(
    id: string,
    kind: SolutionDocumentKind,
    name: string,
    owner: string,
    note = '',
  ): boolean {
    if (!this.sale(id) || !name.trim() || !owner.trim())
      return this.ui.fail('请填写商机、模拟文件名和负责人');
    if ((this.state().storageSchemaVersion ?? 0) >= 3 && kind !== 'TIC')
      return this.ui.fail('四类输出请在统一方案区上传真实文件，旧模拟输出仅供历史查看');
    const previousVersionId = this.solutionDocuments(id)?.current[kind] || '';
    return this.write(
      (state) => {
        if ((state.storageSchemaVersion ?? 0) < 3) state.solutionDocuments ||= [];
        let data =
          (state.storageSchemaVersion ?? 0) >= 3
            ? writableSolutionBusinessRecords(state, id)
            : state.solutionDocuments!.find((row) => row.opportunityId === id);
        if (!data) {
          data = {
            opportunityId: id,
            current: {},
            versions: [],
            confirmations: [],
            costings: [],
            fiveCanReviews: [],
            owner,
            ownerHistory: [],
          };
          state.solutionDocuments!.push(data);
        }
        if (data.owner !== owner) {
          data.ownerHistory.push({
            from: data.owner,
            to: owner,
            operator: this.person(),
            createdAt: new Date().toISOString(),
          });
          data.owner = owner;
        }
        const attachment = this.simulatedRecord(
          state,
          id,
          `方案资料-${kind}`,
          name,
          note,
          newId('OP'),
        );
        const version: SolutionDocumentVersion = {
          id: newId('SDV'),
          kind,
          number: data.versions.filter((item) => item.kind === kind).length + 1,
          documentId: attachment.id,
          owner,
          operator: this.person(),
          createdAt: attachment.date,
          note,
        };
        data.versions.push(version);
        data.current[kind] = version.id;
        this.invalidateQuotes(
          state,
          id,
          `${kind}资料更新为V${version.number}，原方案确认/核价需要重新核对`,
        );
        this.log(state, id, `新增模拟${kind}资料V${version.number}`);
      },
      `${kind}模拟资料已留档；未上传或解析实际文件`,
      this.moduleOperation(
        'opportunity',
        id,
        id,
        'solution-workspace',
        '方案',
        '资料版本',
        '保存方案资料',
        owner,
        'solution-document-version',
        kind,
        [
          {
            field: `solutionDocuments.current.${kind}`,
            valueType: 'string',
            before: previousVersionId,
            after: '新版本',
          },
        ],
      ),
    );
  }
  confirmSolutionDocuments(id: string, owner: string): boolean {
    if ((this.state().storageSchemaVersion ?? 0) >= 3)
      return this.ui.fail('请在统一方案区办理首次或重新定稿；旧确认仅供历史查看');
    const data = this.solutionDocuments(id);
    const kinds: SolutionDocumentKind[] = ['技术方案', 'TIC', '设计BOM', 'SLD'];
    const missing = kinds.filter((kind) => !data?.current[kind]);
    if (!data || missing.length)
      return this.ui.fail(`方案资料未齐全：${missing.join('、') || '请先建立资料记录'}`);
    if (!owner.trim()) return this.ui.fail('请明确方案负责人');
    const opportunity = this.sale(id)!;
    if (!opportunity.productNeeds?.length) return this.ui.fail('商机尚无产品配置行，不能确认方案');
    return this.write(
      (state) => {
        const target = writableSolutionBusinessRecords(state, id);
        target.confirmations.push({
          id: newId('SC'),
          createdAt: new Date().toISOString(),
          owner,
          operator: this.person(),
          productNeedRevision: opportunity.productNeedRevision || 0,
          documentVersions: { ...target.current },
        });
        if (target.owner !== owner) {
          target.ownerHistory.push({
            from: target.owner,
            to: owner,
            operator: this.person(),
            createdAt: new Date().toISOString(),
          });
          target.owner = owner;
        }
        this.log(state, id, `方案负责人${owner}确认四类资料与配置`);
      },
      '当前四类方案资料已确认',
      this.moduleOperation(
        'opportunity',
        id,
        id,
        'solution-workspace',
        '方案',
        '资料确认',
        '确认方案资料',
        owner,
        'solution-document-confirmation',
        id,
        [
          {
            field: 'solutionDocuments.confirmations',
            valueType: 'object',
            before: null,
            after: { owner, versions: data.current },
          },
        ],
      ),
    );
  }
  recordSolutionCosting(
    id: string,
    costs: Record<string, number | null>,
    currency: string,
    taxBasis: string,
    source: string,
  ): boolean {
    const confirmation = this.solutionConfirmation(id);
    const sale = this.sale(id);
    if (!confirmation) return this.ui.fail('请先确认当前四类方案资料');
    if (!sale?.productNeeds?.length) return this.ui.fail('缺少商机产品配置行');
    if (!currency.trim() || !taxBasis.trim() || !source.trim())
      return this.ui.fail('币种、税费口径和成本来源均必填');
    if (
      sale.productNeeds.some(
        (need) => !Number.isFinite(costs[need.id]) || (costs[need.id] as number) < 0,
      )
    )
      return this.ui.fail('每个产品行都需填写非负成本，空值不按零处理');
    const record: SolutionCosting = {
      solutionOutputIds: structuredClone(
        this.state().solutionWorkspaces?.find((w) => w.opportunityId === id)?.currentOutputs,
      ),
      id: newId('COST'),
      confirmationId: confirmation.id,
      createdAt: new Date().toISOString(),
      operator: this.person(),
      simulated: true,
      coefficientSource: 'DEMO预置只读系数 1.20（非正式定价政策）',
      rows: sale.productNeeds.map((need) => ({
        productNeedId: need.id,
        model: need.model,
        name: need.name || '',
        quantity: need.quantity,
        unit: need.unit,
        cost: costs[need.id] ?? null,
        currency,
        taxBasis,
        coefficient: 1.2,
        guidePrice:
          costs[need.id] === null
            ? null
            : Math.round((costs[need.id]! * 1.2 + Number.EPSILON) * 100) / 100,
        source,
      })),
    };
    return this.write(
      (state) => {
        const target = writableSolutionBusinessRecords(state, id);
        target.costings.push(record);
        this.invalidateQuotes(state, id, `当前模拟核价依据更新为${record.id}，报价需确认是否采用`);
        this.log(state, id, `保存模拟核价${record.id}`);
      },
      '模拟核价已保存；系数为只读演示值',
      this.moduleOperation(
        'opportunity',
        id,
        id,
        'solution-workspace',
        '方案',
        '模拟核价',
        '保存模拟核价',
        sale.owner,
        'solution-costing',
        record.id,
        [{ field: 'solutionDocuments.costings', valueType: 'object', before: null, after: record }],
      ),
    );
  }
  recordFiveCan(
    id: string,
    source: string,
    items: FiveCanReview['items'],
    conditions: Omit<FiveCanReview['conditions'][number], 'id' | 'closed' | 'closedBy'>[],
  ): boolean {
    const confirmation = this.solutionConfirmation(id);
    if (!confirmation) return this.ui.fail('请先确认当前四类方案资料');
    if (
      !source.trim() ||
      Object.values(items).some(
        (item) => !item.result || !item.owner.trim() || !item.opinion.trim(),
      )
    )
      return this.ui.fail('五项结果、依据、责任人和意见均需填写');
    if (
      conditions.some(
        (condition) =>
          !condition.key ||
          !condition.text.trim() ||
          !condition.owner.trim() ||
          !condition.due.trim(),
      )
    )
      return this.ui.fail('每条附加条件需关联五可项目，并填写内容、责任人和截止日');
    if (
      Object.entries(items).some(
        ([key, item]) =>
          item.result === '附条件' && !conditions.some((condition) => condition.key === key),
      )
    )
      return this.ui.fail('每个“附条件”结果都需填写对应项目的条件、责任人和截止日');
    return this.write(
      (state) => {
        const data = writableSolutionBusinessRecords(state, id);
        const review: FiveCanReview = {
          confirmationId: confirmation.id,
          solutionOutputIds: structuredClone(
            state.solutionWorkspaces?.find((w) => w.opportunityId === id)?.currentOutputs,
          ),
          id: newId('5C'),
          createdAt: new Date().toISOString(),
          operator: this.person(),
          simulated: true,
          source,
          items: structuredClone(items),
          conditions: conditions.map((condition) => ({
            ...condition,
            id: newId('COND'),
            closed: false,
            closedBy: '',
          })),
        };
        data.fiveCanReviews.push(review);
        this.invalidateQuotes(state, id, `五可模拟会签更新为${review.id}，请检查报价适用条件`);
        this.log(state, id, `记录五可模拟会签${review.id}；未声称正式门禁通过`);
      },
      '五可模拟会签已记录；未关闭条件仍保留',
      this.moduleOperation(
        'opportunity',
        id,
        id,
        'solution-workspace',
        '方案',
        '五可评估',
        '记录五可模拟会签',
        this.sale(id)?.owner || '未记录',
        'five-can-review',
        id,
        [
          {
            field: 'solutionDocuments.fiveCanReviews',
            valueType: 'object',
            before: null,
            after: { source, items, conditions },
          },
        ],
      ),
    );
  }
  closeFiveCanCondition(
    id: string,
    reviewId: string,
    conditionId: string,
    evidence: string,
  ): boolean {
    if (!evidence.trim()) return this.ui.fail('请填写条件关闭依据');
    const review = this.solutionDocuments(id)?.fiveCanReviews.find((item) => item.id === reviewId);
    const condition = review?.conditions.find((item) => item.id === conditionId);
    if (!condition) return this.ui.fail('没有找到该条件记录');
    if (condition.closed) return true;
    return this.write(
      (state) => {
        const target = writableSolutionBusinessRecords(state, id)
          .fiveCanReviews.find((item) => item.id === reviewId)!
          .conditions.find((item) => item.id === conditionId)!;
        target.closed = true;
        target.closedBy = this.person();
        target.closedAt = new Date().toISOString();
        target.evidence = evidence;
        this.log(state, id, `关闭五可条件：${target.text}`);
      },
      '条件关闭依据已记录',
      this.moduleOperation(
        'opportunity',
        id,
        id,
        'solution-workspace',
        '方案',
        '五可评估',
        '关闭五可条件',
        this.sale(id)?.owner || '未记录',
        'five-can-condition',
        conditionId,
        [
          {
            field: 'fiveCanCondition',
            valueType: 'object',
            before: { closed: false },
            after: { closed: true, evidence },
          },
        ],
      ),
    );
  }
  guideComparison(
    item: QuoteItem,
    version: QuoteVersion,
  ): '低于指导价' | '不低于指导价' | '不可比较' | '缺少核价' {
    if (version.crmSchemaVersion === 1) {
      if (item.crmFields?.['alp_salesguidanceprice'] == null) return '缺少核价';
      return crmNumber(item.crmFields, 'alp_afterdiscountamount') <
        crmNumber(item.crmFields, 'alp_salesguidanceprice')
        ? '低于指导价'
        : '不低于指导价';
    }
    if (!item.guideCostingId || item.guidePrice == null) return '缺少核价';
    const basis = this.solutionDocuments(this.seriesByVersion(version.id)?.opportunityId || '')
      ?.costings.find((entry) => entry.id === item.guideCostingId)
      ?.rows.find((row) => row.productNeedId === item.productNeedId);
    if (
      !basis ||
      !item.guideCurrency ||
      !item.guideUnit ||
      item.guideQuantity === undefined ||
      !item.guideTaxBasis ||
      item.guideCurrency !== version.currency ||
      item.guideUnit !== item.unit ||
      item.guideQuantity !== item.quantity ||
      item.guideTaxBasis !== version.taxMode
    )
      return '不可比较';
    const netPrice = item.unitPrice * (1 - (item.discountPercent || 0) / 100);
    return netPrice < item.guidePrice ? '低于指导价' : '不低于指导价';
  }
  needsLowPriceApproval(version: QuoteVersion): boolean {
    return version.items.some((item) => this.guideComparison(item, version) === '低于指导价');
  }
  successfulLowPriceApproval(version: QuoteVersion): boolean {
    return !!version.discountApprovals?.some(
      (approval) => approval.successful && approval.status === '通过',
    );
  }
  private lowPriceApprovalValid(version: QuoteVersion, sentDate: string): boolean {
    if (!this.successfulLowPriceApproval(version)) return false;
    const approval = version.discountApprovals!.find(
      (item) => item.successful && item.status === '通过',
    )!;
    try {
      const basis = JSON.parse(approval.basis) as { contentRevision: number; costingId?: string };
      return (
        basis.contentRevision === (version.contentRevision || 0) &&
        basis.costingId === version.costingId &&
        (!approval.expiry || sentDate <= approval.expiry)
      );
    } catch {
      return false;
    }
  }
  requestLowPriceApproval(versionId: string, reason: string, expiry: string): boolean {
    const version = this.quoteVersion(versionId);
    if (version?.crmSchemaVersion === 1 && version.status !== '模拟审核通过')
      return this.ui.fail('请先完成普通报价审核，再申请低价特批');
    if (!version || !this.needsLowPriceApproval(version))
      return this.ui.fail('当前报价没有可比较的低于指导价行');
    if ((version.discountApprovalCount || 0) > 0)
      return this.ui.fail('本报价版本已成功特批，不能再次申请');
    if (!['草稿', '退回补充', '待模拟审核', '模拟审核通过'].includes(version.status))
      return this.ui.fail('当前报价状态不能申请特批');
    if (!reason.trim() || !expiry.trim()) return this.ui.fail('请填写特批理由和有效期');
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        target.discountApprovals ||= [];
        target.discountApprovals.push({
          id: newId('EX'),
          type: '低价模拟特批',
          status: '待审批',
          reason,
          opinion: '',
          operator: this.person(),
          submitter: this.person(),
          createdAt: new Date().toISOString(),
          basis: JSON.stringify({
            contentRevision: target.contentRevision || 0,
            costingId: target.costingId,
            rows: target.items
              .filter((item) => this.guideComparison(item, target) === '低于指导价')
              .map((item) => ({
                id: item.id,
                productNeedId: item.productNeedId,
                unitPrice: item.unitPrice,
                discountPercent: item.discountPercent,
                guidePrice: item.guidePrice,
              })),
          }),
          successful: false,
          expiry,
        });
        this.auditQuote(target, '提交低价模拟特批', reason);
      },
      '低价模拟特批申请已提交',
      this.moduleOperation(
        'quote-version',
        versionId,
        this.seriesByVersion(versionId)!.opportunityId,
        'quote-workspace',
        '销售',
        '低价特批',
        '申请低价特批',
        this.sale(this.seriesByVersion(versionId)!.opportunityId)!.owner,
        'quote-low-price-approval',
        versionId,
        [
          {
            field: 'discountApprovals',
            valueType: 'object',
            before: null,
            after: { reason, expiry },
          },
        ],
      ),
    );
  }
  decideLowPriceApproval(versionId: string, result: '退回' | '通过', opinion: string): boolean {
    const version = this.quoteVersion(versionId);
    const pending = version?.discountApprovals?.at(-1);
    if (!version || !pending || pending.status !== '待审批')
      return this.ui.fail('没有待处理的特批申请');
    if (this.successfulLowPriceApproval(version)) return this.ui.fail('本报价版本已有一次成功特批');
    if (!opinion.trim()) return this.ui.fail('请填写特批意见');
    if (result === '通过' && !this.checkQuoteSolutionBasis(versionId)) return false;
    if (result === '通过') {
      try {
        const basis = JSON.parse(pending.basis) as { contentRevision: number; costingId?: string };
        if (
          basis.contentRevision !== (version.contentRevision || 0) ||
          basis.costingId !== version.costingId
        )
          return this.ui.fail('特批申请中的报价或核价依据已变化，请退回后重新申请');
      } catch {
        return this.ui.fail('特批申请依据损坏，不能模拟通过');
      }
    }
    return this.write(
      (state) => {
        const target = this.quoteIn(state, versionId)!;
        const approval = target.discountApprovals!.at(-1)!;
        approval.status = result;
        approval.opinion = opinion;
        approval.reviewer = this.person();
        approval.reviewedAt = new Date().toISOString();
        if (result === '通过') {
          approval.successful = true;
          target.discountApprovalCount = (target.discountApprovalCount || 0) + 1;
        }
        this.auditQuote(target, `低价特批${result}`, opinion);
      },
      `低价模拟特批结果：${result}`,
      this.moduleOperation(
        'quote-version',
        versionId,
        this.seriesByVersion(versionId)!.opportunityId,
        'quote-workspace',
        '主管',
        '低价特批',
        '处理低价特批',
        this.sale(this.seriesByVersion(versionId)!.opportunityId)!.owner,
        'quote-low-price-decision',
        versionId,
        [
          {
            field: 'discountApproval.status',
            valueType: 'string',
            before: pending.status,
            after: result,
          },
        ],
      ),
    );
  }
  private quoteContentLocked(version: QuoteVersion): boolean {
    return this.successfulLowPriceApproval(version);
  }
  terms(id: string): ServiceTerms {
    return (
      this.state().serviceTerms?.find((x) => x.opportunityId === id) || {
        opportunityId: id,
        revision: 0,
        kind: '常规',
        years: 0,
        scope: '',
        sla: '',
        special: '',
        note: '',
        reviews: [],
      }
    );
  }
  agreement(id: string): ServiceAgreement {
    return (
      this.state().serviceAgreements?.find((x) => x.opportunityId === id) || {
        opportunityId: id,
        revision: 0,
        applicability: '待确认',
        reason: '',
        summary: '',
        documentId: '',
      }
    );
  }
  finance(id: string) {
    const snapshot = this.state().financeSnapshots?.find((x) => x.projectId === id);
    if (!snapshot) return undefined;
    const canonical = this.invoicesForProject(id);
    if (!canonical.length) return snapshot;
    const canonicalIds = new Set(canonical.map((invoice) => invoice.id));
    const unresolvedLegacy = snapshot.invoices.filter(
      (invoice) => !invoice.id || !canonicalIds.has(invoice.id),
    );
    return { ...snapshot, invoices: [...canonical, ...unresolvedLegacy] };
  }
  costs(id: string) {
    return (this.state().finalActualCosts || [])
      .filter((x) => x.projectId === id)
      .slice()
      .reverse();
  }
  private simulatedRecord(
    state: DemoState,
    id: string,
    kind: string,
    name: string,
    note: string,
    operationId: string,
  ): Attachment {
    const record: Attachment = {
      id: newId('ATT'),
      entityId: id,
      kind,
      name: name.trim(),
      note,
      size: 0,
      date: new Date().toISOString(),
      operator: this.person(),
      sample: true,
      mode: 'simulated',
      url: '',
      operationId,
    };
    state.attachments.push(record);
    return record;
  }
  simulateDocument(
    id: string,
    kind: string,
    name: string,
    note = '',
    operationId = newId('OP'),
  ): boolean {
    if (['方案报价样例', '核心技术方案'].includes(kind))
      return this.uploadSolution(id, name, '周方案', note, operationId);
    if (!this.canAttach(id, kind)) return this.ui.fail('当前角色不能补充此类资料');
    if (!name.trim()) return this.ui.fail('请填写模拟文件名');
    if (this.state().attachments.some((x) => x.operationId === operationId && x.entityId === id))
      return true;
    return this.write((s) => {
      this.simulatedRecord(s, id, kind, name, note, operationId);
      this.log(s, id, `模拟上传${kind}：${name}`);
    }, '模拟文件记录已保存；不保存原文件');
  }
  uploadSolution(
    id: string,
    name: string,
    owner: string,
    note = '',
    operationId = newId('OP'),
    expectedLatest?: string,
  ): boolean {
    if ((this.state().storageSchemaVersion ?? 0) >= 3)
      return this.ui.fail('请在统一方案区上传真实输出文件；旧模拟系列仅保留历史');
    if (this.sale(id)?.type !== 'opportunity' || !name.trim() || !owner.trim())
      return this.ui.fail('请填写商机方案文件名和业务责任人');
    if (this.solution(id)?.versions.some((x) => x.operationId === operationId)) return true;
    if (
      expectedLatest !== undefined &&
      (this.solution(id)?.latestVersionId || '') !== expectedLatest
    )
      return this.ui.fail('方案已更新，请刷新后重新上传');
    return this.write((s) => {
      let series = s.solutionSeries!.find((x) => x.opportunityId === id);
      if (!series) {
        series = {
          id: newId('SOL'),
          opportunityId: id,
          latestVersionId: '',
          finalVersionId: '',
          versions: [],
          marks: [],
        };
        s.solutionSeries!.push(series);
      }
      const document = this.simulatedRecord(s, id, '核心技术方案', name, note, operationId);
      const version = {
        id: newId('SV'),
        number: series.versions.length + 1,
        documentId: document.id,
        owner,
        note,
        operator: this.person(),
        createdAt: document.date,
        operationId,
      };
      const previous = series.latestVersionId;
      series.versions.push(version);
      series.latestVersionId = version.id;
      this.invalidateQuotes(
        s,
        id,
        `核心方案 ${previous || '待交付'} → ${version.id}，请人工核对配置、价格和文字`,
      );
      this.log(s, id, `模拟方案V${version.number}已交付：${name}；业务负责人${owner}`);
    }, '方案新版已交付，未发报价已更新引用');
  }
  markFinalSolution(id: string, versionId: string): boolean {
    if ((this.state().storageSchemaVersion ?? 0) >= 3)
      return this.ui.fail('请在统一方案区办理真实定稿；旧最终标记仅保留历史');
    const series = this.solution(id);
    if (!series?.versions.some((x) => x.id === versionId)) return this.ui.fail('没有找到方案版本');
    if (series.finalVersionId === versionId) return true;
    return this.write((s) => {
      const target = s.solutionSeries!.find((x) => x.opportunityId === id)!;
      target.marks.push({
        from: target.finalVersionId,
        to: versionId,
        operator: this.person(),
        createdAt: new Date().toISOString(),
      });
      target.finalVersionId = versionId;
      this.log(s, id, `方案最终标记改为${versionId}`);
    }, '最终确认标记已保存，不改变报价审核');
  }
  private invalidateQuotes(state: DemoState, id: string, reason: string): void {
    if (state.sales.some((sale) => sale.id === id && isClosed(sale))) return;
    for (const series of state.quoteSeries!.filter((x) => x.opportunityId === id))
      for (const v of series.versions) {
        if (v.crmSchemaVersion === 1) continue;
        if (v.status === '作废') continue;
        if (v.sentDate || ['已记录发出', '最终锁定'].includes(v.status)) {
          this.notice(
            state,
            `v4-sent-check-${v.id}-${this.solutionRevision(state, id)}`,
            id,
            'sales',
            '已发报价需核对新版资料',
            `${reason}；历史保持，重新报价请创建新版`,
          );
          continue;
        }
        if (series.versions.some((next) => next.sourceVersionId === v.id)) continue;
        v.contentRevision = (v.contentRevision || 0) + 1;
        if (!['草稿', '退回补充'].includes(v.status)) v.status = '退回补充';
        this.auditQuote(
          v,
          '当前审核失效',
          `${reason}；原审核${v.reviewBy} ${v.reviewNote}；原条件${JSON.stringify(v.conditions)}`,
        );
        v.reviewBy = '';
        v.reviewDate = '';
        v.reviewNote = '';
        v.conditions = [];
        v.invalidationReason = reason;
        if (!state.solutionDocuments?.some((item) => item.opportunityId === id))
          this.syncQuoteSources(state, v);
        for (const n of state.notices.filter((x) => x.key === `quote-review-${v.id}`))
          n.resolved = true;
        this.notice(
          state,
          `v4-recheck-${v.id}-${v.contentRevision}`,
          id,
          'sales',
          '报价资料变化，请核对并重新提交',
          reason,
        );
      }
  }
  private solutionRevision(state: DemoState, id: string): string {
    return `${state.solutionSeries?.find((x) => x.opportunityId === id)?.latestVersionId || ''}-${state.serviceTerms!.find((x) => x.opportunityId === id)?.revision || 0}-${state.serviceAgreements!.find((x) => x.opportunityId === id)?.revision || 0}`;
  }
  solutionNextStep(id: string): {
    role: 'sales' | 'receiver' | 'solution';
    tab: '概览' | '服务条件' | '方案' | '报价';
    label: string;
    missing: string[];
  } {
    if (this.sale(id)?.stage === '意向沟通')
      return {
        role: 'sales',
        tab: '概览',
        label: '交接销售完善商机并进入方案报价',
        missing: this.intentMissing(id),
      };
    const allMissing = this.quoteGate(id);
    const solutionMissing = allMissing.filter((item) =>
      [
        'solution-documents',
        'solution-confirmation',
        'solution-costing',
        'five-can-review',
        'five-can-results',
        'five-can-conditions',
      ].includes(item.code),
    );
    if (solutionMissing.length)
      return {
        role: 'solution',
        tab: '方案',
        label: '补齐方案确认、模拟核价或未关闭条件',
        missing: solutionMissing.map((item) => item.label),
      };
    const missing = allMissing.filter((item) =>
      ['warranty', 'special', 'agreement'].includes(item.code),
    );
    if (missing.some((item) => item.code === 'warranty'))
      return {
        role: 'sales',
        tab: '服务条件',
        label: '交接销售补齐并确认服务条件',
        missing: missing.map((item) => item.label),
      };
    if (missing.some((item) => item.code === 'special')) {
      const terms = this.terms(id);
      const rejected = terms.reviews.some(
        (review) => review.revision === terms.revision && review.result === '需调整',
      );
      if (rejected)
        return {
          role: 'sales',
          tab: '服务条件',
          label: '按运维意见修改特殊服务条件',
          missing: missing.map((item) => item.label),
        };
      const submitted = !!terms.special.trim() && terms.submittedRevision === terms.revision;
      return {
        role: submitted ? 'receiver' : 'sales',
        tab: '服务条件',
        label: submitted ? '交接运维复核特殊服务条件' : '交接销售补齐特殊服务需求',
        missing: missing.map((item) => item.label),
      };
    }
    if (missing.length)
      return {
        role: 'sales',
        tab: '服务条件',
        label: '交接销售确认服务协议适用情况',
        missing: missing.map((item) => item.label),
      };
    return { role: 'sales', tab: '报价', label: '交接销售进入报价工作区', missing: [] };
  }
  quoteGate(id: string, versionId?: string): QuoteGateMissing[] {
    const crmVersion = versionId ? this.quoteVersion(versionId) : undefined;
    if (crmVersion?.crmSchemaVersion === 1)
      return crmQuoteErrors(crmVersion, this.crmQuoteCatalog(), true).map((label, index) => ({
        code: `crm-quote-${index}`,
        label,
        role: 'sales',
        tab: '报价',
        entityId: id,
      }));
    const missing: QuoteGateMissing[] = [];
    const add = (code: string, label: string, role: Role, tab: string) =>
      missing.push({ code, label, role, tab, entityId: id });
    const series = this.solution(id);
    const latest = series?.versions.find((x) => x.id === series.latestVersionId);
    const quote = versionId ? this.quoteVersion(versionId) : undefined;
    const opportunity = this.sale(id);
    const solutionDocs = this.solutionDocuments(id);
    if (opportunity?.stage !== '意向沟通' && (opportunity?.productNeeds?.length || 0) > 0) {
      const kinds: SolutionDocumentKind[] = ['技术方案', 'TIC', '设计BOM', 'SLD'];
      const absent = kinds.filter((kind) => !solutionDocs?.current[kind]);
      if (absent.length)
        add('solution-documents', `四类方案资料待补：${absent.join('、')}`, 'solution', '方案');
      if (!this.solutionConfirmation(id))
        add(
          'solution-confirmation',
          '负责人尚未确认当前四类方案资料和产品配置',
          'solution',
          '方案',
        );
      const confirmation = this.solutionConfirmation(id);
      const costing = solutionDocs?.costings
        .filter((item) => item.confirmationId === confirmation?.id)
        .at(-1);
      if (
        !costing ||
        opportunity!.productNeeds!.some(
          (need) =>
            !costing.rows.some(
              (row) =>
                row.productNeedId === need.id &&
                row.guidePrice !== null &&
                !!row.currency &&
                !!row.unit &&
                !!row.taxBasis,
            ),
        )
      )
        add('solution-costing', '当前产品配置缺少完整模拟核价口径', 'solution', '方案');
      const latestFiveCan = solutionDocs?.fiveCanReviews.at(-1);
      if (!latestFiveCan) add('five-can-review', '尚未记录五可模拟会签结果', 'solution', '方案');
      else if (
        Object.values(latestFiveCan.items).some((item) =>
          ['不满足', '待评估'].includes(item.result),
        )
      )
        add('five-can-results', '五可存在不满足或待评估项，需补充评估并复核', 'solution', '方案');
      const openConditions =
        solutionDocs?.fiveCanReviews.flatMap((review) =>
          review.conditions.filter((condition) => !condition.closed),
        ) || [];
      if (openConditions.length)
        add(
          'five-can-conditions',
          `未关闭五可条件 ${openConditions.length} 项，继续阻断适用业务检查`,
          'pm',
          '方案',
        );
      if (quote && this.quoteSourceDifferences(quote.id).length)
        add(
          'source-changes',
          '商机产品行、方案确认或核价依据有变化，销售确认后才能提交',
          'sales',
          '报价',
        );
    }
    if (
      quote &&
      (this.seriesByVersion(quote.id)?.opportunityId !== id ||
        quote.customerId !== this.sale(id)?.customerId ||
        !this.customer(quote.customerId)?.contacts.some(
          (contact) => contact.id === quote.contactId,
        ))
    )
      add('association', '报价客户及联系人与来源商机关联一致', 'sales', '报价');
    if (
      !latest ||
      !this.state().attachments.some((x) => x.id === latest.documentId && x.mode === 'simulated') ||
      (quote &&
        (quote.solutionVersionId !== latest.id ||
          !quote.sourceAttachmentIds.includes(latest.documentId)))
    )
      add('solution', '当前核心方案及报价引用', 'solution', '方案');
    const terms = this.terms(id);
    if (
      !Number.isFinite(terms.years) ||
      terms.years <= 0 ||
      !terms.scope.trim() ||
      !terms.sla.trim() ||
      terms.salesConfirmation?.revision !== terms.revision
    )
      add('warranty', '销售确认当前质保年限、范围及SLA', 'sales', '服务条件');
    if (
      terms.kind === '特殊' &&
      (!terms.special.trim() ||
        !terms.reviews.some((x) => x.revision === terms.revision && x.result === '可接受'))
    )
      add('special', '当前特殊服务需求运维复核', 'receiver', '服务条件');
    const agreement = this.agreement(id);
    if (
      agreement.applicability === '待确认' ||
      agreement.confirmation?.revision !== agreement.revision ||
      (agreement.applicability === '不购买'
        ? !agreement.reason.trim()
        : !agreement.summary.trim() ||
          !this.state().attachments.some(
            (x) => x.id === agreement.documentId && x.entityId === id && x.mode === 'simulated',
          ))
    )
      add('agreement', '服务协议适用性及条款确认', 'sales', '服务条件');
    return missing;
  }
  saveServiceTerms(input: ServiceTerms, expectedRevision = input.revision): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    if (
      !this.sale(input.opportunityId) ||
      !['常规', '特殊'].includes(input.kind) ||
      !Number.isFinite(input.years) ||
      input.years < 0
    )
      return this.ui.fail('服务年限和类型无效');
    const current = this.terms(input.opportunityId);
    if (current.revision !== expectedRevision) return this.ui.fail('服务内容已更新，请刷新后保存');
    const changed = ['kind', 'years', 'scope', 'sla', 'special'].some(
      (key) => current[key as keyof ServiceTerms] !== input[key as keyof ServiceTerms],
    );
    return this.write((s) => {
      const next = {
        ...structuredClone(current),
        kind: input.kind,
        years: input.years,
        scope: input.scope,
        sla: input.sla,
        special: input.special,
        note: input.note,
      };
      if (changed) {
        this.log(s, input.opportunityId, `服务修订历史：${JSON.stringify(current)}`);
        next.revision++;
        next.salesConfirmation = undefined;
        next.submittedRevision = undefined;
        for (const n of s.notices.filter(
          (x) => x.entityId === input.opportunityId && x.key.startsWith('v4-service-'),
        ))
          n.resolved = true;
        this.notice(
          s,
          `v4-service-update-${input.opportunityId}-${next.revision}`,
          input.opportunityId,
          'sales',
          '服务条件需重新确认或提交运维',
          '进入服务条件处理当前修订',
        );
        this.invalidateQuotes(s, input.opportunityId, '质保／SLA关键内容变化，需要重新确认');
      }
      s.serviceTerms = s.serviceTerms!.filter((x) => x.opportunityId !== input.opportunityId);
      s.serviceTerms.push(next);
      this.log(s, input.opportunityId, changed ? '更新服务条件，确认失效' : '保存普通服务备注');
    }, '服务条件已保存');
  }
  confirmServiceTerms(id: string, revision: number): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const t = this.terms(id);
    if (t.revision !== revision) return this.ui.fail('服务内容已更新，请刷新');
    if (
      !Number.isFinite(t.years) ||
      t.years <= 0 ||
      !t.scope.trim() ||
      !t.sla.trim() ||
      (t.kind === '特殊' && !t.special.trim())
    )
      return this.ui.fail('请补齐质保年限、范围、SLA及特殊说明');
    if (
      t.salesConfirmation?.revision === revision &&
      (t.kind === '常规' || t.submittedRevision === revision)
    )
      return true;
    return this.write((s) => {
      const target = s.serviceTerms!.find((x) => x.opportunityId === id)!;
      for (const n of s.notices.filter((x) => x.key === `v4-service-update-${id}-${revision}`))
        n.resolved = true;
      target.salesConfirmation = {
        revision,
        person: this.person(),
        owner: this.sale(id)!.owner,
        createdAt: new Date().toISOString(),
      };
      if (target.kind === '特殊') {
        target.submittedRevision = revision;
        this.notice(
          s,
          `v4-service-review-${id}-${revision}`,
          id,
          'receiver',
          '特殊服务待复核',
          '请进入服务条件核对当前修订',
        );
      }
      this.log(s, id, target.kind === '特殊' ? '销售确认并提交运维复核' : '销售确认常规质保及SLA');
    }, '当前修订已确认；特殊需求已提交运维');
  }
  reviewServiceTerms(
    id: string,
    revision: number,
    result: '可接受' | '需调整',
    opinion: string,
  ): boolean {
    if (!this.allow(['receiver'])) return false;
    const t = this.terms(id);
    if (t.reviews.some((x) => x.revision === revision))
      return this.ui.fail('本修订已复核，请查看历史');
    if (
      !['可接受', '需调整'].includes(result) ||
      t.kind !== '特殊' ||
      t.revision !== revision ||
      t.submittedRevision !== revision ||
      !opinion.trim()
    )
      return this.ui.fail('复核已过期或尚未提交，请刷新并填写意见');
    return this.write((s) => {
      const target = s.serviceTerms!.find((x) => x.opportunityId === id)!;
      target.reviews.push({
        revision,
        result,
        opinion,
        person: this.person(),
        createdAt: new Date().toISOString(),
      });
      for (const n of s.notices.filter((x) => x.key === `v4-service-review-${id}-${revision}`))
        n.resolved = true;
      if (result === '需调整')
        this.notice(
          s,
          `v4-service-return-${id}-${revision}`,
          id,
          'sales',
          '特殊服务需调整后重新提交',
          opinion,
        );
      this.log(s, id, `运维复核修订${revision}：${result} ${opinion}`);
    }, '运维意见已保存');
  }
  saveAgreement(input: ServiceAgreement, expectedRevision = input.revision): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const current = this.agreement(input.opportunityId);
    if (
      !this.sale(input.opportunityId) ||
      !['待确认', '适用', '不购买'].includes(input.applicability)
    )
      return this.ui.fail('协议适用性无效');
    if (current.revision !== expectedRevision) return this.ui.fail('协议条款已更新，请刷新');
    const changed = ['applicability', 'reason', 'summary', 'documentId'].some(
      (k) => current[k as keyof ServiceAgreement] !== input[k as keyof ServiceAgreement],
    );
    return this.write((s) => {
      const next = {
        ...structuredClone(current),
        applicability: input.applicability,
        reason: input.reason,
        summary: input.summary,
        documentId: input.documentId,
      };
      if (changed) {
        this.log(s, input.opportunityId, `协议修订历史：${JSON.stringify(current)}`);
        next.revision++;
        next.confirmation = undefined;
        this.invalidateQuotes(s, input.opportunityId, '服务协议关键条款变化，需要重新敲定');
      }
      s.serviceAgreements = s.serviceAgreements!.filter(
        (x) => x.opportunityId !== input.opportunityId,
      );
      s.serviceAgreements.push(next);
      this.log(s, input.opportunityId, '保存协议适用性和条款');
    }, '协议已保存，请确认当前条款');
  }
  confirmAgreement(id: string, revision: number): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const a = this.agreement(id);
    if (
      a.revision !== revision ||
      a.applicability === '待确认' ||
      (a.applicability === '不购买'
        ? !a.reason.trim()
        : !a.summary.trim() ||
          !this.state().attachments.some(
            (x) => x.id === a.documentId && x.entityId === id && x.mode === 'simulated',
          ))
    )
      return this.ui.fail('请补齐不购买原因，或协议摘要及模拟文件；过期内容须刷新');
    if (a.confirmation?.revision === revision) return true;
    return this.write((s) => {
      s.serviceAgreements!.find((x) => x.opportunityId === id)!.confirmation = {
        revision,
        person: this.person(),
        owner: this.sale(id)!.owner,
        createdAt: new Date().toISOString(),
      };
      this.log(s, id, '销售确认协议当前修订；不代表真实签署');
    }, '条款已敲定，不代表真实签署');
  }
  loadFinance(id: string): boolean {
    if (!this.allow(['finance']) || !this.project(id)) return false;
    if (this.finance(id)) return this.refreshFinance(id);
    return this.write((s) => {
      s.financeSnapshots!.push(financeTemplate(id));
      migrateContractInvoices(s, id);
      this.ensureCreditPolicy(s, id);
      this.syncReceivables(s, id);
      this.syncMilestoneWarnings(s, id);
      this.log(s, id, '加载独立模拟SAP／CRM快照');
    }, '演示财务快照已加载');
  }
  private ensureCreditPolicy(state: DemoState, projectId: string): void {
    if (state.creditPolicies!.some((policy) => policy.projectId === projectId)) return;
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    // 用户确认的Demo映射：只绑定“客户要求首批到货”客户节点的唯一匹配项。
    const matches = project.plans.filter(
      (plan) => plan.type === '客户主节点' && plan.name === '客户要求首批到货',
    );
    state.creditPolicies!.push({
      projectId,
      customerId: project.customerId,
      policyId: 'DEMO-CRM-NET30',
      revision: 1,
      terms: '客户要求首批到货节点完成日起30个自然日付款（Demo样例）',
      days: 30,
      startCustomerMilestoneId: matches.length === 1 ? matches[0].id : '',
      source: 'CRM',
      snapshotDate: BASE_DATE,
    });
  }
  refreshFinance(id: string): boolean {
    if (!this.allow(['finance']) || !this.finance(id)) return false;
    return this.write((s) => {
      const snapshot = s.financeSnapshots!.find((x) => x.projectId === id)!;
      snapshot.refreshedAt = new Date().toISOString();
      // Existing snapshots gain the new read-only sample only after an explicit refresh.
      const template = financeTemplate(id);
      snapshot.indicators ??= template.indicators;
      snapshot.cumulativeActualCost ??= template.cumulativeActualCost;
      this.ensureCreditPolicy(s, id);
      this.syncReceivables(s, id);
      this.syncMilestoneWarnings(s, id);
      this.log(s, id, '刷新模拟财务快照，保留回款事件');
    }, '模拟快照已刷新');
  }
  private syncReceivables(s: DemoState, id: string): void {
    for (const invoice of this.invoicesForProject(id, s)) {
      const key = `v4-receivable-${invoice.id}`;
      const due = this.invoiceDue(id, invoice, s);
      const facts = invoiceFacts(invoice, due.date);
      s.milestoneWarnings = (s.milestoneWarnings || []).filter(
        (warning) => !(warning.projectId === id && warning.invoiceId === invoice.id),
      );
      if (facts.overdue > 0 && facts.balance > 0)
        s.milestoneWarnings!.push({
          id: `RECEIVABLE-WARNING-${invoice.id}`,
          projectId: id,
          invoiceId: invoice.id,
          kind: '回款逾期',
          dueDate: due.date,
          offsetDays: facts.overdue,
          owner: 'sales',
        });
      if (facts.overdue > 0 && facts.balance > 0)
        this.notice(
          s,
          key,
          id,
          'sales',
          '逾期应收，请跟进',
          `${invoice.number} · 余额${invoice.currency} ${facts.balance} · 逾期${facts.overdue}天`,
        );
      else for (const n of s.notices.filter((x) => x.key === key)) n.resolved = true;
      for (const n of s.notices.filter((x) => x.key === key && !x.resolved))
        n.text = `${invoice.number} · 余额${invoice.currency} ${facts.balance} · 逾期${facts.overdue}天`;
    }
  }
  /** V8 retired: legacy simulated receipts can no longer edit the invoice balance. */
  simulateReceipt(_id: string, _invoiceId: string, _full: boolean): boolean {
    return this.retiredFinanceWrite('历史模拟累计回款');
  }
  saveFinalCost(
    input: Omit<FinalActualCost, 'id' | 'revision' | 'operator' | 'createdAt'>,
    expectedRevision: number,
  ): boolean {
    if (!this.allow(['finance']) || !this.project(input.projectId)) return false;
    if (this.costs(input.projectId).some((x) => x.operationId === input.operationId)) return true;
    const current = this.costs(input.projectId)[0];
    if ((current?.revision || 0) !== expectedRevision)
      return this.ui.fail('成本记录已更新，请刷新');
    const validDate = (v: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v;
    if (
      !Number.isFinite(input.amount) ||
      input.amount < 0 ||
      (input.amount === 0 && !input.zeroReason.trim()) ||
      !['CNY', 'EUR', 'USD'].includes(input.currency) ||
      !input.scope.trim() ||
      !input.provider.trim() ||
      !validDate(input.cutoff) ||
      !validDate(input.confirmedDate) ||
      input.cutoff > input.confirmedDate ||
      !this.state().attachments.some(
        (x) =>
          x.id === input.documentId &&
          x.entityId === input.projectId &&
          x.kind === '最终成本资料' &&
          x.mode === 'simulated',
      )
    )
      return this.ui.fail('请补齐有效金额、币种、范围、日期、确认人及模拟成本文件；0金额需解释');
    const keys = [
      'amount',
      'currency',
      'scope',
      'cutoff',
      'confirmedDate',
      'provider',
      'documentId',
      'zeroReason',
    ] as const;
    if (current && keys.every((k) => current[k] === input[k])) return true;
    if (current && !input.reason.trim()) return this.ui.fail('修改最终成本必须填写修订原因');
    return this.write((s) => {
      s.finalActualCosts!.push({
        ...input,
        id: newId('COST'),
        revision: (current?.revision || 0) + 1,
        operator: this.person(),
        createdAt: new Date().toISOString(),
      });
      this.log(
        s,
        input.projectId,
        `保存最终实际成本修订${(current?.revision || 0) + 1}：${input.reason}`,
      );
    }, '最终实际成本已生效');
  }
  /** 启动/接管/续接后按持久引用恢复，手动重试也走相同入口。 */
  recoverContractFiles(): Promise<void> {
    if (this.originalRecoveryRequest) return this.originalRecoveryRequest;
    const request = this.performContractFileRecovery().finally(() => {
      if (this.originalRecoveryRequest === request) this.originalRecoveryRequest = undefined;
    });
    this.originalRecoveryRequest = request;
    return request;
  }
  private async performContractFileRecovery(): Promise<void> {
    await this.recoverOriginalScope(this.activeWorkspaceId || '', this.state().roundId || '', false);
    // 重置后旧轮的失败标记也可重试；只处理显式待处理ID，仍复核全部保留引用。
    for (const pending of [...this.pendingOriginalCleanups()]) {
      if (!this.canEdit() || this.originalRecoveryRunning || this.contractFileOperations?.hasPending()) return;
      try {
        const record = await this.contractOriginals.read(pending.blobId);
        if (!record?.workspaceId || !record.roundId) continue;
        const ownScope = record.workspaceId === this.activeWorkspaceId && record.roundId === this.state().roundId;
        const authorization = pending.resetAuthorization;
        const resetAuthorized = authorization?.fromWorkspaceId === this.activeWorkspaceId &&
          authorization?.fromRoundId === this.state().roundId &&
          authorization?.targetWorkspaceId === record.workspaceId && authorization?.targetRoundId === record.roundId;
        if (ownScope || resetAuthorized)
          await this.recoverOriginalScope(record.workspaceId, record.roundId, !!resetAuthorized, new Set([pending.blobId]));
        else if (!this.originalRecoveryMessage())
          this.originalRecoveryMessage.set('其他工作区待处理原件缺少本轮重置授权，文件已保留；请先续接所属工作区复核');
      } catch { /* 留待下一次明确重试。 */ }
    }
  }
  private async recoverOriginalScope(workspaceId: string, roundId: string, afterReset: boolean, onlyBlobIds?: ReadonlySet<string>): Promise<void> {
    if (this.originalRecoveryRunning || this.originalUploads || this.contractFileOperations?.hasPending() || !this.canEdit() || !workspaceId || !roundId) return;
    this.originalRecoveryRunning = true;
    const activeId = this.activeWorkspaceId;
    const activeRound = this.state().roundId;
    try {
      const result = await recoverContractOriginals({
        blobs: this.contractOriginals,
        storage: localStorage,
        workspaceId, roundId,
        includeUnreferencedHistory: afterReset, onlyBlobIds,
        canMutate: () => this.canEdit() && this.activeWorkspaceId === activeId && this.state().roundId === activeRound &&
          (!this.workspaceStorage || this.workspaceStorage.activeWorkspaceId() === activeId),
        liveReferences: () => (this.state().contractFileVersions || []).map(version => version.blobId),
        inFlight: id => this.originalUploadsInFlight?.has(id) || false,
      });
      for (const item of result.pending) this.markPendingOriginalCleanup(item.blobId, item.contractId,
        afterReset && activeId && activeRound ? {
          fromWorkspaceId: activeId, fromRoundId: activeRound,
          targetWorkspaceId: workspaceId, targetRoundId: roundId,
        } : undefined);
      const pending = this.pendingOriginalCleanups().filter(item => !result.deleted.includes(item.blobId) && !result.promoted.includes(item.blobId));
      this.pendingOriginalCleanups.set(pending);
      try { localStorage.setItem(PENDING_ORIGINAL_CLEANUP_KEY, JSON.stringify(pending)); } catch {}
      const message = result.blocked ? '原件清理暂缓：修改资格、工作区或保留备份无法完整核实，文件均保留' :
        result.pending.length ? '原件恢复或清理未完成，已标记待处理；已提交业务状态不受影响' : '';
      this.originalRecoveryMessage.set(message);
      if (message) this.ui.notify(message, true);
    } catch {
      this.originalRecoveryMessage.set('原件恢复暂未完成，文件保留，可稍后重试');
    } finally { this.originalRecoveryRunning = false; }
  }
  private readonly contractFileOperations = new ContractFileOperations();
  contractFileHistory(contractId: string): ContractFileVersion[] {
    return contractFileHistory(this.state().contractFileVersions || [], contractId);
  }
  /** 当前有效合同原件版本；旧合同无原件时返回 undefined，绝不猜测同名文件。 */
  contractFileVersion(contractId: string): ContractFileVersion | undefined {
    const currentId = this.contract(contractId)?.currentContractFileVersionId;
    if (!currentId) return undefined;
    return (this.state().contractFileVersions || []).find((item) => item.id === currentId);
  }
  /**
   * 合同附件区要展示的旧模拟附件记录：合同自身及其商机上的历史模拟记录。
   * 这些记录只有元数据、没有真实原件字节，只读且不再新增。
   */
  contractLegacyAttachments(contractId: string): Attachment[] {
    const opportunityId = this.contract(contractId)?.opportunityId;
    const ids = [contractId, opportunityId].filter(Boolean) as string[];
    return this.state().attachments.filter((item) => ids.includes(item.entityId));
  }
  /**
   * 登记合同真实原件的唯一异步入口；首次上传与不可变替换共用三阶段提交。
   * 三阶段提交：先暂存 Blob → 再复核修改资格/修订版本 → 再提交快照引用。
   * 任一阶段失败不登记有效版本、不更新历史/引导、不显示成功；快照失败仅尽力清理本次无引用暂存。
   */
  replaceContractFile(
    contractId: string,
    file: File,
    options: { operationId?: string; expectedDataVersion?: number } = {},
  ): Promise<boolean> {
    if (this.originalRecoveryRunning || this.originalRecoveryRequest) return Promise.resolve(this.ui.fail('正在复核原件引用，请稍后重试上传'));
    const operationId = options.operationId || newId('OP');
    return this.contractFileOperations.run(contractId, operationId,
      async () => {
        this.originalUploads = (this.originalUploads || 0) + 1;
        try { return await this.commitContractFile(contractId, file, { ...options, operationId }); }
        finally { this.originalUploads--; }
      },
      () => this.ui.fail('本合同正在保存原件，请等待本次操作完成后再替换'),
    );
  }
  private async commitContractFile(
    contractId: string,
    file: File,
    options: { operationId?: string; expectedDataVersion?: number } = {},
  ): Promise<boolean> {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const contract = this.contract(contractId);
    if (!contract) return this.ui.fail('找不到目标合同');
    const operationId = options.operationId || newId('OP');
    const existing = (this.state().contractFileVersions || []).find(
      (item) => item.operationId === operationId && item.contractId === contractId,
    );
    if (existing) {
      this.ui.notify(`该上传请求已登记为原件V${existing.version}，未重复创建`);
      return true;
    }
    const previous = this.contractFileVersion(contractId);
    const nextVersion = Math.max(0, ...this.contractFileHistory(contractId).map(item => item.version)) + 1;
    const validationError = contractOriginalError(file);
    if (validationError) return this.ui.fail(validationError);
    if (!this.canEdit()) {
      this.editingWritable.set(false);
      return this.ui.fail('当前标签页没有修改权；请先接管修改权后再上传原件');
    }
    const expectedDataVersion = options.expectedDataVersion ?? this.state().dataVersion ?? 1;
    if (expectedDataVersion !== (this.state().dataVersion || 1))
      return this.ui.fail('合同数据已变化；请刷新后重新选择文件上传');
    // 阶段一：真实字节以暂存态写入专用库，并带明确归属；失败则不产生任何记录。
    // 类型按已配置规则归一，避免把声明为 HTML/SVG 的字节带进库与预览。
    const blobId = newId('CFB');
    const versionId = newId('CFV');
    const mimeType = contractOriginalMimeType(file.name, file.type);
    const roundId = this.state().roundId || '';
    const workspaceId = this.activeWorkspaceId || '';
    this.originalUploadsInFlight?.add(blobId);
    try {
      await this.contractOriginals.stage({
        blob: new Blob([file], { type: mimeType }),
        blobId,
        contractId,
        workspaceId,
        roundId,
        operationId,
        state: 'staged',
        stagedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.originalUploadsInFlight?.delete(blobId);
      return this.ui.fail(
        error instanceof Error ? error.message : '原件暂存失败，未登记为有效版本',
      );
    }
    // 阶段二：暂存后复核修改资格与数据修订；失效则清理本次暂存。
    if (!this.canEdit() || expectedDataVersion !== (this.state().dataVersion || 1) || workspaceId !== (this.activeWorkspaceId || '') || roundId !== (this.state().roundId || '')) {
      await this.discardStagedOriginal(blobId, contractId);
      return this.ui.fail('上传期间修改权或数据版本已变化；原件未登记，请刷新后重试');
    }
    // 阶段三：提交快照引用；write 内部对存储中的最新修订与修改资格再兜底复核。
    // 提交返回 false 或直接抛错时都只清理本次无引用暂存，绝不登记有效版本。
    const version: ContractFileVersion = {
      id: versionId,
      contractId,
      workspaceId,
      roundId,
      blobId,
      version: nextVersion,
      previousVersionId: previous?.id,
      fileName: file.name,
      mimeType,
      size: file.size,
      uploadedByPersonId: identityForRole(this.role())?.personId,
      uploadedBy: this.person(),
      uploadedAt: new Date().toISOString(),
      isRealOriginal: true,
      operationId,
    };
    let committed = false;
    try {
      committed = this.commitOperation({
        object: { type: 'contract', id: contractId },
        mainlineId: contract.opportunityId,
        module: 'contract-workspace',
        department: '销售',
        section: '合同真实原件',
        action: `${previous ? '替换' : '上传'}合同真实原件V${nextVersion}`,
        owner: { name: this.sale(contract.opportunityId)?.owner || '未记录' },
        taskSource: { kind: 'contract-original-file', id: contractId },
        changes: [
          {
            field: 'contract.currentOriginal',
            valueType: 'object',
            before: previous ? { ...previous, blobId: undefined } : null,
            after: { ...version, blobId: undefined },
          },
        ],
        change: (state) => {
          state.contractFileVersions ||= [];
          state.contractFileVersions.push(version);
          state.contracts.find((row) => row.id === contractId)!.currentContractFileVersionId =
            version.id;
          this.log(state, contractId, `${previous ? '替换' : '上传'}合同真实原件V${nextVersion}：${version.fileName}`);
        },
        message: `合同真实原件V${nextVersion}已登记；历史原件保留可下载`,
      });
    } catch (error) {
      await this.discardStagedOriginal(blobId, contractId);
      throw error;
    }
    if (!committed) {
      await this.discardStagedOriginal(blobId, contractId);
      return committed;
    }
    // 引用已提交后才把暂存态转正；转正失败不回退已提交版本，恢复以快照引用为事实。
    try {
      await this.contractOriginals.promote(blobId);
    } catch {
      this.ui.notify('原件已登记，暂存标记转正未完成，将由引用复核后续处理', true);
    }
    this.originalUploadsInFlight?.delete(blobId);
    return committed;
  }
  /** 清理本次无引用的暂存原件；清理失败标记为待处理，不影响已登记数据。 */
  private async discardStagedOriginal(blobId: string, contractId: string): Promise<void> {
    this.originalUploadsInFlight?.delete(blobId);
    try {
      await this.contractOriginals.discard(blobId, () => {
        const references = retainedOriginalReferences(localStorage);
        return this.canEdit() && (!this.workspaceStorage || this.workspaceStorage.activeWorkspaceId() === this.activeWorkspaceId) && !!references && !references.has(blobId) && !(this.state().contractFileVersions || []).some(version => version.blobId === blobId);
      });
    } catch {
      this.markPendingOriginalCleanup(blobId, contractId);
      this.ui.notify('暂存原件清理失败，已标记为待处理；已登记数据不受影响', true);
    }
  }
  private markPendingOriginalCleanup(blobId: string, contractId: string, resetAuthorization?: PendingOriginalCleanup['resetAuthorization']): void {
    const next = [
      ...this.pendingOriginalCleanups().filter(item => item.blobId !== blobId),
      { blobId, contractId, markedAt: new Date().toISOString(), resetAuthorization: resetAuthorization || this.pendingOriginalCleanups().find(item => item.blobId === blobId)?.resetAuthorization },
    ];
    this.pendingOriginalCleanups.set(next);
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(PENDING_ORIGINAL_CLEANUP_KEY, JSON.stringify(next));
    } catch {
      // 标记仅存内存信号，待 07-03 崩溃恢复统一处理。
    }
  }
  private readPendingOriginalCleanups(): PendingOriginalCleanup[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(PENDING_ORIGINAL_CLEANUP_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((item) => item && typeof item.blobId === 'string')
        : [];
    } catch {
      return [];
    }
  }
  /**
   * 按登记版本取回原件字节；字节缺失、归属不符或不完整时明确报错，绝不按同名返回别的文件。
   * 返回的 Blob 一律带登记时归一化的 MIME，避免声明与渲染类型不一致。
   */
  async readContractOriginal(
    versionId: string,
  ): Promise<
    { ok: true; version: ContractFileVersion; blob: Blob } | { ok: false; error: string }
  > {
    const version = (this.state().contractFileVersions || []).find((item) => item.id === versionId);
    if (!version) return { ok: false, error: '找不到该原件版本的登记记录' };
    let record: ContractOriginalRecord | null;
    try {
      record = await this.contractOriginals.read(version.blobId);
    } catch {
      return { ok: false, error: '原件读取失败：浏览器原件存储不可用' };
    }
    if (!record)
      return {
        ok: false,
        error: `原件字节缺失：本地存储中找不到「${version.fileName}」的内容；不会按同名返回其他文件，请由上传人重新提供原件`,
      };
    if (record.contractId !== version.contractId)
      return {
        ok: false,
        error: `原件归属不符：「${version.fileName}」登记于其他合同，已阻止返回，请由上传人重新提供原件`,
      };
    if (record.blob.size !== version.size)
      return {
        ok: false,
        error: `原件字节不完整：登记大小 ${version.size} 字节，实际读取 ${record.blob.size} 字节；已阻止返回，请由上传人重新提供原件`,
      };
    return { ok: true, version, blob: new Blob([record.blob], { type: version.mimeType }) };
  }
  canAttach(id: string, kind: string): boolean {
    if (this.sale(id)) {
      const sale = this.sale(id)!;
      if (['方案报价样例', '核心技术方案'].includes(kind)) return sale.type === 'opportunity';
      if (sale.type === 'lead') return this.canOperateSale(sale);
      return this.salesEditable();
    }
    if (!this.project(id)) return false;
    return true;
  }
  async upload(id: string, kind: string, file: File): Promise<boolean> {
    return this.ui.fail('V4仅支持模拟文件记录，请使用模拟上传');
  }
  sample(id: string, kind: string): boolean {
    return this.simulateDocument(id, kind, `演示_${kind}.pdf`);
  }
  async openFile(a: Attachment): Promise<void> {
    if (
      a.sample &&
      /^demo\/technical\/DEMO_(SLD\.svg|BOM\.csv|Degradation\.csv|Technical_Proposal\.html)$/.test(
        a.url,
      )
    ) {
      window.open(a.url, '_blank', 'noopener,noreferrer');
      return;
    }
    this.ui.open({
      title: '模拟文件记录详情',
      description: `${a.name}\n${a.kind} · ${a.operator} · 实际操作时间 ${a.date}\n${a.note || ''}\n${a.mode === 'simulated' ? '仅模拟文件记录，不保存原文件' : '旧记录，仅保留元数据'}；不提供原件预览或下载。`,
      fields: [],
      submitLabel: '关闭',
      onSave: () => true,
    });
  }
  async removeAttachment(a: Attachment): Promise<boolean> {
    return this.ui.fail('历史资料只读，更正请新增模拟记录');
  }
  async reset(): Promise<boolean> {
    if (
      this.originalUploads ||
      this.contractFileOperations?.hasPending() ||
      this.originalRecoveryRunning ||
      this.originalRecoveryRequest
    )
      return this.ui.fail('原件正在保存或复核，请等待完成后重新开始');
    if (!this.canEdit()) {
      this.editingWritable.set(false);
      return this.ui.fail('当前标签页没有修改权；请先接管修改权后再重新开始');
    }
    const startingVersion = this.state().dataVersion || 1;
    const previousWorkspace = this.activeWorkspaceId || '';
    const previousRound = this.state().roundId || '';
    try {
      const state = prepareV9Workspace(migrateV8Snapshot(this.prepareWorkspaceState(createSeed())));
      // A new round must already carry the same seed backfill state as a
      // normally loaded workspace, so resuming it does not mutate its snapshot.
      backfillProjectWarnings(state);
      state.dataVersion = 1;
      state.roundId = newId('ROUND');
      initializeDeliveryRetention(state);
      state.operationEvents = [];
      state.dateMode = 'normal';
      // Blob ownership is unknown on the legacy unnamespaced file store. Keep
      // it intact until a round-aware index can prove which records are safe.
      // 原件库只在新轮快照成功后定向回收；旧工作区、保留备份及未知归属均保留。
      const latestRaw =
        typeof localStorage?.getItem === 'function'
          ? localStorage.getItem(this.activeSnapshotKey)
          : null;
      const latest =
        this.workspaceStorage && this.activeWorkspaceId
          ? this.workspaceStorage.readActive()
          : latestRaw
            ? (JSON.parse(latestRaw) as DemoState)
            : undefined;
      if (!this.canEdit() || (latest && (latest.dataVersion || 1) !== startingVersion)) {
        this.editingWritable.set(false);
        return this.ui.fail('重置期间修改权或数据版本已变更，存储中的最新状态已保留');
      }
      if (this.workspaceStorage) {
        const activated = this.workspaceStorage.createAndActivateRound(state);
        this.activeWorkspaceId = activated.workspaceId;
        this.activeSnapshotKey = activated.workspaceKey;
      } else {
        localStorage.setItem(this.activeSnapshotKey, JSON.stringify(state));
      }
      this.state.set(state);
      this.ui.notify('已开始新的独立演示轮；旧工作区备份与无法确认归属的附件均保留');
      await this.recoverOriginalScope(previousWorkspace, previousRound, true);
      return true;
    } catch (e) {
      return this.ui.fail(e instanceof Error ? e.message : '重置失败');
    }
  }
  export(): void {
    const blob = new Blob([JSON.stringify(this.state(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CSPD_业务走查数据.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.ui.notify('业务数据已导出；本地上传文件内容不包含在JSON内');
  }
}
// 旧标准CRM来源值保留为证据；仅维护款清发货的本地业务主值。
function paymentMethodView(method: PaymentMethodRecord): PaymentMethodRecord {
  const row = structuredClone(method);
  const nested = row.crmFields?.['alp_framework_protocol'];
  const values = [
    Object.hasOwn(row, 'deliveryInFullPayment') ? row.deliveryInFullPayment : undefined,
    nested && typeof nested === 'object'
      ? (nested as Record<string, unknown>)['alp_delivery_in_full_payment']
      : undefined,
    row.crmFields?.['alp_delivery_in_full_payment'],
  ].filter((value) => value !== undefined);
  row.deliveryInFullPayment = (values.length ? values[0] : '') as string | null;
  row.deliveryInFullPaymentNeedsReview = values.some((value) => value !== values[0]);
  return row;
}
