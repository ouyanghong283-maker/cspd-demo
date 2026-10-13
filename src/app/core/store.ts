import { computed, inject, Injectable, signal } from '@angular/core';
import {
  Activity,
  Attachment,
  BASE_DATE,
  Contact,
  Customer,
  CustomerRole,
  DemoState,
  History,
  Issue,
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
} from './models';
import { blankProject, blankSales, createSeed, makePlans, makeTeam, newId } from './seed';
import {
  acceptanceReady,
  coolingDays,
  isClosed,
  needsTenderTeam,
  validDateRange,
  weightedAmount,
} from './rules';
import { UiService } from './ui.service';
import { FilesService } from './files.service';
const KEY = 'cspd-demo-v2';
@Injectable({ providedIn: 'root' })
export class DemoStore {
  readonly ui = inject(UiService);
  private readonly files = inject(FilesService);
  readonly state = signal<DemoState>(this.load());
  readonly role = computed(() => this.state().role);
  readonly person = computed(() => ROLES.find((x) => x.id === this.role())?.person || '访客');
  readonly roleInfo = computed(() => ROLES.find((x) => x.id === this.role())!);
  readonly opportunities = computed(() =>
    this.state().sales.filter((x) => x.type === 'opportunity'),
  );
  readonly leads = computed(() => this.state().sales.filter((x) => x.type === 'lead'));
  readonly salesEditable = computed(() => ['sales', 'assistant', 'manager'].includes(this.role()));
  readonly internal = computed(() => this.role() !== 'outsider');
  readonly pendingNotices = computed(() =>
    this.state().notices.filter((x) => x.role === this.role() && !x.resolved),
  );
  readonly cooling = computed(() =>
    this.opportunities().filter((x) => coolingDays(x, this.state().activities) >= 30),
  );
  readonly escalatedCooling = computed(() => this.cooling().filter((x) => coolingDays(x, this.state().activities) >= 60));
  readonly unclosedConditions = computed(() =>
    this.state().projects.reduce((n, p) => n + p.conditions.filter((c) => !c.closed).length, 0),
  );
  private load(): DemoState {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const state: DemoState = JSON.parse(raw);
        if (
          state.version === 2 &&
          Array.isArray(state.projects) &&
          Array.isArray(state.sales) &&
          Array.isArray(state.customers)
        )
          {
            state.quoteSeries ||= [];
            state.quoteSchemaVersion = 1;
            for (const sale of state.sales) if (sale.type === 'opportunity') sale.quoteFlowMode ||= 'legacy';
            return state;
          }
      }
    } catch {}
    return createSeed();
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
  quoteSeries(opportunityId: string): QuoteSeries | undefined {
    return this.state().quoteSeries?.find((series) => series.opportunityId === opportunityId);
  }
  quoteVersion(versionId: string): QuoteVersion | undefined {
    return this.state().quoteSeries?.flatMap((series) => series.versions).find((version) => version.id === versionId);
  }
  quoteTotals(version: QuoteVersion): { lines: number; added: number; beforeDiscount: number; net: number; total: number | null } {
    const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const lines = round(version.items.reduce((sum, item) => sum + round(Number(item.quantity) * Number(item.unitPrice)), 0));
    const added = round((version.freightTreatment === '另收' ? Number(version.freightAmount) : 0) + (version.dutyTreatment === '另收' ? Number(version.dutyAmount) : 0) + (version.otherFeeTreatment === '另收' ? Number(version.otherFee) : 0));
    const beforeDiscount = round(lines + added);
    const net = round(beforeDiscount - Number(version.discount));
    return { lines, added, beforeDiscount, net, total: version.taxMode === '含税样例' ? round(net + Number(version.vatAmount)) : version.taxMode === '含税待确认' ? null : net };
  }
  contact(s: SalesRecord): Contact | undefined {
    return this.customer(s.customerId)?.contacts.find((c) => c.id === s.contactId);
  }
  salesName(s: SalesRecord): string {
    const c = this.customer(s.customerId);
    return `${c?.country || '待补国家'} · ${c?.shortName || c?.name || '待补客户'} · ${s.projectName || '待补项目'} · ${s.capacity || '待补容量'}${s.unit}`;
  }
  attachments(id: string, kind?: string): Attachment[] {
    return this.state().attachments.filter((x) => x.entityId === id && (!kind || x.kind === kind));
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
    return this.state()
      .history.filter((x) => x.entityId === id)
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
    version.audit.push({ id: newId('QH'), action, person: this.person(), date: BASE_DATE, note });
  }
  private quoteIn(state: DemoState, id: string): QuoteVersion | undefined {
    return state.quoteSeries?.flatMap((series) => series.versions).find((version) => version.id === id);
  }
  private seriesByVersion(id: string): QuoteSeries | undefined {
    return this.state().quoteSeries?.find((series) => series.versions.some((version) => version.id === id));
  }
  createQuote(opportunityId: string): string | null {
    if (!this.allow(['sales', 'assistant', 'manager'])) return null;
    const opportunity = this.sale(opportunityId);
    if (!opportunity || opportunity.type !== 'opportunity' || opportunity.stage === '意向沟通' || isClosed(opportunity)) { this.ui.fail('请先进入方案报价阶段后再创建报价'); return null; }
    const existing = this.quoteSeries(opportunityId);
    if (existing) {
      const draft = existing.versions.find((version) => ['草稿', '退回补充'].includes(version.status));
      if (draft) return draft.id;
      this.ui.fail('报价系列已存在，请从现有版本创建新版'); return null;
    }
    const seriesId = newId('Q');
    const version: QuoteVersion = {
      id: newId('QV'), seriesId, number: 1, sourceVersionId: '', status: '草稿',
      title: opportunity.projectName || '项目报价', sellerEntity: '', customerId: opportunity.customerId, contactId: opportunity.contactId, owner: opportunity.owner,
      country: this.customer(opportunity.customerId)?.country || '', currency: opportunity.currency, tradeTerm: opportunity.tradeTerm, tradeNote: '',
      plannedSendDate: BASE_DATE, validUntil: '', scope: '', delivery: '', payment: '', warranty: '', service: '', solutionSummary: '', boundaries: '', notes: '',
      items: [], freightAmount: 0, freightTreatment: '已含在明细', dutyAmount: 0, dutyTreatment: '由客户另付', otherFee: 0, otherFeeTreatment: '已含在明细', discount: 0,
      sourceAttachmentIds: [],
      taxMode: '不含税报价', vatAmount: 0, taxNote: '', taxReview: '待确认', taxReviewBy: '', taxReviewDate: '', costs: { goods: null, logistics: null, delivery: null, service: null, source: '' },
      reviewBy: '', reviewDate: '', reviewNote: '', conditions: [], lockRequestedBy: '', lockRequestedDate: '', sentDate: '', sentMethod: '', sentTo: '', sentEvidence: '', acceptedBy: '', acceptedDate: '', acceptedEvidence: '',
      lockedBy: '', lockedDate: '', invalidationReason: '', feedback: [], audit: [],
    };
    this.auditQuote(version, '创建报价草稿', 'V1');
    const ok = this.write((state) => {
      state.quoteSeries ||= [];
      state.quoteSeries.push({ id: seriesId, number: `DEMO-Q-${Date.now().toString().slice(-6)}`, opportunityId, versions: [version], activeFinalVersionId: '', createdBy: this.person(), createdDate: BASE_DATE });
      this.syncQuoteSources(state, state.quoteSeries.at(-1)!.versions[0]);
      state.sales.find((sale) => sale.id === opportunityId)!.quoteFlowMode = 'v2';
      this.log(state, opportunityId, '启用V2报价流程并创建V1草稿');
    }, '报价V1草稿已创建');
    return ok ? version.id : null;
  }
  quoteSourceCandidates(opportunityId: string): Attachment[] {
    const opportunity = this.sale(opportunityId);
    const entities = [opportunityId, opportunity?.leadId].filter(Boolean);
    return this.state().attachments.filter((attachment) => entities.includes(attachment.entityId) && ['方案报价样例', '需求导入表'].includes(attachment.kind));
  }
  quoteSourceFiles(versionId: string): Attachment[] {
    const version = this.quoteVersion(versionId); const series = this.seriesByVersion(versionId);
    if (!version || !series) return [];
    return this.quoteSourceCandidates(series.opportunityId).filter((attachment) => version.sourceAttachmentIds.includes(attachment.id));
  }
  private syncQuoteSources(state: DemoState, version: QuoteVersion): void {
    const series = state.quoteSeries!.find((item) => item.id === version.seriesId)!;
    const opportunity = state.sales.find((item) => item.id === series.opportunityId);
    const entities = [series.opportunityId, opportunity?.leadId].filter(Boolean);
    const files = state.attachments.filter((attachment) => entities.includes(attachment.entityId) && ['方案报价样例', '需求导入表'].includes(attachment.kind));
    const validIds = new Set(files.map((file) => file.id));
    version.sourceAttachmentIds = [...new Set([...version.sourceAttachmentIds.filter((id) => validIds.has(id)), ...validIds])];
  }
  saveQuote(version: QuoteVersion): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    if (!['草稿', '退回补充'].includes(version.status)) return this.ui.fail('该报价版本已提交或发出，不能直接修改');
    const stored = this.quoteVersion(version.id);
    if (!stored) return this.ui.fail('没有找到报价版本');
    if (!['草稿', '退回补充'].includes(stored.status)) return this.ui.fail('当前报价已提交，不能保存旧草稿');
    return this.write((state) => {
      const target = this.quoteIn(state, version.id)!;
      const taxChanged = target.sellerEntity !== version.sellerEntity || target.country !== version.country || target.currency !== version.currency || target.tradeTerm !== version.tradeTerm || target.taxMode !== version.taxMode || target.vatAmount !== version.vatAmount || target.freightAmount !== version.freightAmount || target.freightTreatment !== version.freightTreatment || target.dutyAmount !== version.dutyAmount || target.dutyTreatment !== version.dutyTreatment;
      const previousSources = target.sourceAttachmentIds;
      Object.assign(target, structuredClone(version));
      target.sourceAttachmentIds = [...new Set([...previousSources, ...target.sourceAttachmentIds])];
      this.syncQuoteSources(state, target);
      for (const key of ['freightAmount','dutyAmount','otherFee','discount','vatAmount'] as const) target[key] = Number(target[key] || 0);
      if (taxChanged) { target.taxReview = '需重新确认'; target.taxReviewBy = ''; target.taxReviewDate = ''; }
      this.auditQuote(target, '保存报价草稿'); this.log(state, target.seriesId, '保存报价草稿');
    }, '报价草稿已保存');
  }
  addQuoteItem(versionId: string, item: Omit<QuoteItem, 'id'>): boolean {
    const version = this.quoteVersion(versionId); if (!version || !['草稿', '退回补充'].includes(version.status)) return this.ui.fail('当前版本不可编辑');
    return this.saveQuote({ ...structuredClone(version), items: [...version.items, { ...item, id: newId('QI') }] });
  }
  attachQuoteSource(versionId: string, attachmentId: string): boolean {
    if (!this.allow(['sales', 'assistant', 'manager', 'solution'])) return false;
    const version = this.quoteVersion(versionId); const series = this.seriesByVersion(versionId);
    if (!version || !series || !['草稿', '退回补充'].includes(version.status)) return this.ui.fail('仅草稿版本可以补充来源引用');
    const attachment = this.quoteSourceCandidates(series.opportunityId).find((item) => item.id === attachmentId && ['方案报价样例', '需求导入表'].includes(item.kind));
    if (!attachment) return this.ui.fail('没有找到可引用的需求或方案资料');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!; if (!target.sourceAttachmentIds.includes(attachmentId)) target.sourceAttachmentIds.push(attachmentId);
      this.auditQuote(target, '引用来源资料', attachment.name);
    }, '报价来源资料已引用');
  }
  saveQuoteCosts(versionId: string, costs: QuoteVersion['costs']): boolean {
    if (!this.allow(['pm', 'solution', 'sales', 'assistant', 'manager'])) return false;
    const v = this.quoteVersion(versionId); if (!v || !['草稿', '退回补充'].includes(v.status)) return this.ui.fail('成本参考只在报价草稿阶段维护');
    if ([costs.goods, costs.logistics, costs.delivery, costs.service].some((amount) => amount !== null && (!Number.isFinite(amount) || amount < 0))) return this.ui.fail('成本金额须为非负数字或留空表示未提供');
    return this.write((state) => { const target = this.quoteIn(state, versionId)!; target.costs = structuredClone(costs); this.auditQuote(target, '更新内部成本参考', costs.source); }, '成本参考已保存，不计入客户报价');
  }
  saveQuoteSolution(versionId: string, summary: string, boundaries: string): boolean {
    if (!this.allow(['solution'])) return false;
    const v = this.quoteVersion(versionId); if (!v || !['草稿', '退回补充'].includes(v.status)) return this.ui.fail('仅草稿报价可以维护方案摘要');
    if (!summary || !boundaries) return this.ui.fail('请填写方案摘要和范围边界');
    return this.write((state) => { const target = this.quoteIn(state, versionId)!; target.solutionSummary = summary; target.boundaries = boundaries; this.auditQuote(target, '更新方案摘要及范围边界'); }, '方案资料已更新');
  }
  removeQuoteItem(versionId: string, itemId: string): boolean {
    const version = this.quoteVersion(versionId); if (!version) return false;
    return this.saveQuote({ ...structuredClone(version), items: version.items.filter((item) => item.id !== itemId) });
  }
  submitQuote(versionId: string): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const v = this.quoteVersion(versionId); if (!v || !['草稿', '退回补充'].includes(v.status)) return this.ui.fail('当前报价版本不能提交审核');
    if ([v.freightAmount, v.dutyAmount, v.otherFee, v.discount, v.vatAmount, ...v.items.flatMap((item) => [item.quantity,item.unitPrice])].some((amount) => !Number.isFinite(Number(amount)) || Number(amount) < 0)) return this.ui.fail('报价金额、费用和数量必须是非负数字');
    const totals = this.quoteTotals(v);
    const sourceFiles = this.quoteSourceFiles(versionId);
    const missing = [!v.title ? '报价标题' : '', !v.sellerEntity ? '交易主体' : '', !v.contactId ? '主要联系人' : '', !v.owner ? '销售负责人' : '', !v.tradeTerm ? '贸易条款' : '', v.tradeTerm === '其他' && !v.tradeNote ? '其他贸易条款说明' : '', !v.plannedSendDate ? '计划发出日期' : '', !v.validUntil ? '有效期截止日' : '', v.validUntil && v.plannedSendDate && v.validUntil < v.plannedSendDate ? '有效期不能早于计划发出日' : '', !v.scope ? '交付范围' : '', !v.delivery ? '交期说明' : '', !v.payment ? '付款条件' : '', !v.warranty ? '质保说明' : '', !v.solutionSummary ? '方案摘要' : '', !v.boundaries ? '方案边界' : '', !sourceFiles.length ? '引用需求表或方案报价资料' : '', !v.items.length ? '至少一条报价明细' : '', v.items.some((item) => !item.name || !item.unit || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) ? '明细名称、单位、数量和单价' : '', v.items.some((item) => item.unitPrice === 0 && !item.source) ? '零金额明细的说明' : '', totals.net <= 0 ? '未税报价合计需大于零' : '', v.discount > totals.beforeDiscount ? '优惠金额不能超过报价金额' : ''].filter(Boolean);
    if (missing.length) return this.ui.fail(`提交前请补齐：${missing.join('、')}`);
    if (v.taxMode === '含税待确认' && !v.taxNote) return this.ui.fail('含税待确认时请填写待财务确认问题');
    if (v.taxReview !== '样例已确认' && !v.taxNote) return this.ui.fail('财务口径待确认时请记录待确认的问题，主管将在审核时看到');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!; target.status = '待模拟审核'; target.reviewBy = ''; target.reviewDate = ''; target.reviewNote = '';
      this.auditQuote(target, '提交模拟审核'); const series = state.quoteSeries!.find((item) => item.id === target.seriesId)!; this.notice(state, `quote-review-${versionId}`, series.opportunityId, 'manager', '报价待模拟审核', `${target.title} V${target.number} · ${this.money(this.quoteTotals(target).net, target.currency)}`);
      this.log(state, target.seriesId, `提交报价V${target.number}模拟审核`);
    }, '报价已提交，通知销售主管模拟审核');
  }
  reviewQuote(versionId: string, result: '模拟审核通过' | '附条件通过' | '退回补充', note: string, condition = ''): boolean {
    if (!this.allow(['manager'])) return false;
    const v = this.quoteVersion(versionId); if (!v || v.status !== '待模拟审核') return this.ui.fail('报价当前不在待审核状态');
    if (!note || (result === '附条件通过' && !condition)) return this.ui.fail('请填写审核意见及附条件内容');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!; target.status = result; target.reviewBy = this.person(); target.reviewDate = BASE_DATE; target.reviewNote = note;
      if (result === '附条件通过') target.conditions.push({ id: newId('QC'), text: condition, owner: '张销售', due: '2026-10-20', closed: false, closedBy: '' });
      for (const n of state.notices.filter((item) => item.key === `quote-review-${versionId}`)) n.resolved = true;
      const series = state.quoteSeries!.find((item) => item.id === target.seriesId)!; this.notice(state, `quote-result-${versionId}`, series.opportunityId, 'sales', `报价${result}`, note);
      this.auditQuote(target, result, note); this.log(state, target.seriesId, `报价V${target.number}${result}`);
    }, `报价模拟审核结果：${result}`);
  }
  closeQuoteCondition(versionId: string, conditionId: string, evidence: string): boolean {
    if (!this.allow(['manager'])) return false;
    if (!evidence) return this.ui.fail('请填写条件关闭凭据');
    const v = this.quoteVersion(versionId); if (!v || v.status !== '附条件通过') return false;
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!; const condition = target.conditions.find((item) => item.id === conditionId);
      if (condition) { condition.closed = true; condition.closedBy = `${this.person()}：${evidence}`; }
      if (target.conditions.every((item) => item.closed)) target.status = '模拟审核通过';
      this.auditQuote(target, '关闭审核条件', evidence);
    }, '报价条件已记录');
  }
  confirmQuoteTax(versionId: string, result: '样例已确认' | '待财务确认', note: string): boolean {
    if (!this.allow(['finance'])) return false;
    if (!note) return this.ui.fail('请记录财务样例意见或待确认问题');
    const version = this.quoteVersion(versionId); if (!version || !['草稿', '退回补充'].includes(version.status)) return this.ui.fail('仅可在报价草稿或退回补充状态调整财务口径');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!; target.taxReview = result; target.taxReviewBy = this.person(); target.taxReviewDate = BASE_DATE;
      target.taxNote = note; this.auditQuote(target, `财务口径${result}`, note);
    }, `财务已记录：${result}（DEMO样例）`);
  }
  recordQuoteSent(versionId: string, sentDate: string, method: string, recipient: string, evidence: string): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const v = this.quoteVersion(versionId); if (!v || v.status !== '模拟审核通过') return this.ui.fail('只有模拟审核通过的报价可记录发出');
    if (!sentDate || !method || !recipient || !evidence) return this.ui.fail('请填写发出日期、方式、接收联系人和凭据说明');
    if (sentDate > BASE_DATE || (v.validUntil && sentDate > v.validUntil)) return this.ui.fail('发出日期需在演示基准日和报价有效期内');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!; target.sentDate = sentDate; target.sentMethod = method; target.sentTo = recipient; target.sentEvidence = evidence; target.status = '已记录发出';
      const series = state.quoteSeries!.find((item) => item.id === target.seriesId)!; const opp = state.sales.find((item) => item.id === series.opportunityId)!;
      state.activities.push({ id: newId('ACT'), entityId: opp.id, customerId: opp.customerId, date: sentDate, type: '报价发出', summary: `${series.number} V${target.number}报价已记录发出`, people: recipient, next: '等待客户反馈', operator: this.person(), stage: opp.stage });
      this.auditQuote(target, '记录报价已发出', evidence); this.log(state, series.id, `报价V${target.number}已记录发出`);
    }, '报价发出记录已保存（DEMO未发送邮件）');
  }
  addQuoteFeedback(versionId: string, feedback: Omit<QuoteFeedback, 'id'>): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const v = this.quoteVersion(versionId); if (!v || !['已记录发出', '最终锁定'].includes(v.status)) return this.ui.fail('请先记录报价发出');
    if (!feedback.date || !feedback.kind || !feedback.summary || feedback.date > BASE_DATE) return this.ui.fail('请填写有效日期、反馈类型和摘要');
    if (feedback.kind === '客户确认接受' && (!feedback.person || !feedback.evidence)) return this.ui.fail('客户接受需记录确认人和凭据说明');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!; target.feedback.push({ ...feedback, id: newId('QF') });
      if (feedback.kind === '客户确认接受') { target.acceptedBy = feedback.person; target.acceptedDate = feedback.date; target.acceptedEvidence = feedback.evidence; }
      const series = state.quoteSeries!.find((item) => item.id === target.seriesId)!; const opp = state.sales.find((item) => item.id === series.opportunityId)!;
      if (feedback.kind !== '无反馈') state.activities.push({ id: newId('ACT'), entityId: opp.id, customerId: opp.customerId, date: feedback.date, type: '客户报价反馈', summary: `V${target.number} ${feedback.kind}：${feedback.summary}`, people: feedback.person || '', next: '', operator: this.person(), stage: opp.stage });
      this.auditQuote(target, `客户反馈：${feedback.kind}`, feedback.summary); this.log(state, series.id, `报价V${target.number}客户反馈：${feedback.kind}`);
    }, '客户反馈已记录');
  }
  createQuoteVersion(versionId: string, reason: string): string | null {
    if (!this.allow(['sales', 'assistant', 'manager'])) return null;
    if (!reason) { this.ui.fail('请填写创建新版本的原因'); return null; }
    const series = this.seriesByVersion(versionId); const source = this.quoteVersion(versionId);
    if (!series || !source || source.status !== '已记录发出') { this.ui.fail('请从已记录发出的版本创建新版'); return null; }
    const currentDraft = series.versions.find((item) => ['草稿', '退回补充', '待模拟审核'].includes(item.status));
    if (currentDraft) { this.ui.fail(`V${currentDraft.number}仍在处理中，请先完成或撤回`); return null; }
    const version = structuredClone(source);
    version.id = newId('QV'); version.number = Math.max(...series.versions.map((item) => item.number)) + 1; version.sourceVersionId = source.id; version.status = '草稿';
    version.reviewBy = ''; version.reviewDate = ''; version.reviewNote = ''; version.conditions = []; version.lockRequestedBy = ''; version.lockRequestedDate = ''; version.sentDate = ''; version.sentMethod = ''; version.sentTo = ''; version.sentEvidence = ''; version.acceptedBy = ''; version.acceptedDate = ''; version.acceptedEvidence = ''; version.lockedBy = ''; version.lockedDate = ''; version.feedback = []; version.audit = [];
    this.auditQuote(version, `基于V${source.number}创建新版`, reason);
    const ok = this.write((state) => { const target = state.quoteSeries!.find((item) => item.id === series.id)!; target.versions.push(version); this.log(state, series.id, `创建报价V${version.number}：${reason}`); }, `V${version.number}报价草稿已创建`);
    return ok ? version.id : null;
  }
  requestQuoteLock(versionId: string): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const version = this.quoteVersion(versionId); const series = this.seriesByVersion(versionId);
    if (!version || !series || version.status !== '已记录发出') return this.ui.fail('只有已发出的报价版本可以申请最终锁定');
    if (!version.acceptedBy || !version.acceptedEvidence) return this.ui.fail('请先记录客户确认接受及凭据');
    if (version.lockRequestedBy) return this.ui.fail('该版本已提交最终锁定申请');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!; target.lockRequestedBy = this.person(); target.lockRequestedDate = BASE_DATE;
      const currentSeries = state.quoteSeries!.find((item) => item.id === target.seriesId)!;
      this.notice(state, `quote-lock-${versionId}`, currentSeries.opportunityId, 'manager', '报价待最终锁定', `${currentSeries.number} V${target.number}：已记录客户接受，请核对报价条件、审核条件及财务口径`);
      this.auditQuote(target, '申请最终报价锁定'); this.log(state, currentSeries.id, `报价V${target.number}申请最终锁定`);
    }, '最终锁定申请已提交给销售主管');
  }
  lockQuote(versionId: string): boolean {
    if (!this.allow(['manager'])) return false;
    const version = this.quoteVersion(versionId); const series = this.seriesByVersion(versionId);
    if (!version || !series || version.status !== '已记录发出' || !version.lockRequestedBy) return this.ui.fail('该报价尚未提交锁定申请');
    const openDraft = series.versions.some((item) => item.id !== versionId && ['草稿', '退回补充', '待模拟审核', '附条件通过'].includes(item.status));
    if (!version.acceptedBy || !version.acceptedEvidence) return this.ui.fail('请先记录客户确认接受及凭据');
    if (version.conditions.some((item) => !item.closed) || openDraft) return this.ui.fail('还有未关闭审核条件或处理中版本');
    if (version.taxMode === '含税待确认' || version.taxReview !== '样例已确认') return this.ui.fail('税费口径尚未确认，不能锁定');
    const total = this.quoteTotals(version).total;
    if (total === null || total <= 0) return this.ui.fail('报价合计未明确，不能锁定');
    return this.write((state) => {
      const target = this.quoteIn(state, versionId)!; target.status = '最终锁定'; target.lockedBy = this.person(); target.lockedDate = BASE_DATE;
      for (const notice of state.notices.filter((item) => item.key === `quote-lock-${versionId}`)) notice.resolved = true;
      const targetSeries = state.quoteSeries!.find((item) => item.id === target.seriesId)!; targetSeries.activeFinalVersionId = target.id;
      this.auditQuote(target, '锁定最终报价'); this.log(state, targetSeries.id, `报价V${target.number}最终锁定`);
    }, '最终报价已锁定，合同模拟来源可引用');
  }
  reopenLockedQuote(versionId: string, reason: string): string | null {
    if (!this.allow(['manager'])) return null;
    const series = this.seriesByVersion(versionId); const source = this.quoteVersion(versionId);
    if (!series || !source || source.status !== '最终锁定' || !reason) { this.ui.fail('请选最终锁定版本并填写重新报价原因'); return null; }
    if (this.state().contracts.some((contract) => contract.quoteVersionId === versionId)) { this.ui.fail('合同模拟来源已引用该版本，需走后续变更流程'); return null; }
    const version = structuredClone(source);
    version.id = newId('QV'); version.number = Math.max(...series.versions.map((item) => item.number)) + 1; version.sourceVersionId = source.id; version.status = '草稿';
    version.reviewBy = ''; version.reviewDate = ''; version.reviewNote = ''; version.conditions = []; version.lockRequestedBy = ''; version.lockRequestedDate = ''; version.sentDate = ''; version.sentMethod = ''; version.sentTo = ''; version.sentEvidence = ''; version.acceptedBy = ''; version.acceptedDate = ''; version.acceptedEvidence = ''; version.lockedBy = ''; version.lockedDate = ''; version.feedback = []; version.audit = []; version.invalidationReason = `V${source.number}锁定失效：${reason}`;
    this.auditQuote(version, '主管批准重新报价', reason);
    const ok = this.write((state) => { const targetSeries = state.quoteSeries!.find((item) => item.id === series.id)!; targetSeries.versions.push(version); targetSeries.activeFinalVersionId = ''; const old = this.quoteIn(state, source.id)!; old.invalidationReason = `已由V${version.number}重新报价：${reason}`; this.log(state, series.id, `批准重新报价V${version.number}：${reason}`); }, `已生成V${version.number}草稿，原锁定记录保留`);
    return ok ? version.id : null;
  }
  syncQuoteAmount(versionId: string): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const version = this.quoteVersion(versionId); const series = this.seriesByVersion(versionId); if (!version || !series) return false;
    const total = this.quoteTotals(version).total; if (total === null) return this.ui.fail('含税金额待确认，暂不能同步商机预计金额');
    return this.write((state) => { const sale = state.sales.find((item) => item.id === series.opportunityId)!; sale.amount = total; sale.currency = version.currency; this.log(state, series.id, `将V${version.number}报价金额同步为商机预计金额${total} ${version.currency}`); }, '商机预计金额已更新');
  }
  private write(change: (state: DemoState) => void, message?: string): boolean {
    try {
      const next = structuredClone(this.state());
      next.quoteSeries ||= [];
      next.quoteSchemaVersion = 1;
      change(next);
      localStorage.setItem(KEY, JSON.stringify(next));
      this.state.set(next);
      if (message) this.ui.notify(message);
      return true;
    } catch (error) {
      return this.ui.fail(error instanceof Error ? error.message : '保存失败，记录未更新');
    }
  }
  private log(state: DemoState, id: string, action: string): void {
    state.history.push({
      id: newId('H'),
      entityId: id,
      operator: this.person(),
      action,
      date: `${BASE_DATE} ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
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
  private allow(roles: Role[]): boolean {
    return (
      roles.includes(this.role()) || this.ui.fail('当前角色不能执行此操作，请切换至对应业务角色')
    );
  }
  setRole(role: Role): void {
    this.write((s) => (s.role = role));
  }
  saveCustomer(customer: Customer): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    if (!customer.name || !customer.country) return this.ui.fail('请填写客户名称和国家/地区');
    if (customer.contacts.some((c) => !c.name || (!c.email && !c.phone)))
      return this.ui.fail('联系人需要姓名和至少一种联系方式');
    return this.write((s) => {
      const index = s.customers.findIndex((x) => x.id === customer.id);
      if (index >= 0) s.customers[index] = customer;
      else s.customers.push(customer);
      this.log(s, customer.id, '保存客户及联系人，共用源记录');
    }, '客户资料已保存，关联项目同步引用');
  }
  saveSales(record: SalesRecord): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    if (!this.customer(record.customerId)) return this.ui.fail('请选择已有客户，或先新建客户');
    if (
      !Number.isFinite(record.amount) ||
      record.amount < 0 ||
      !Number.isFinite(record.capacity) ||
      record.capacity < 0
    )
      return this.ui.fail('金额与容量不能为负数');
    const old = this.sale(record.id);
    record.lastEditor = this.person();
    if (old && (old.grade !== record.grade || old.tender !== record.tender)) {
      record.team = record.team.map((t) => ({ ...t, confirmed: false, confirmedBy: '' }));
      record.g1 = '未提交';
    }
    return this.write((s) => {
      const index = s.sales.findIndex((x) => x.id === record.id);
      if (index >= 0) s.sales[index] = record;
      else s.sales.push(record);
      this.log(s, record.id, old ? '修改业务信息' : '保存线索草稿');
    }, '业务信息已保存');
  }
  archive(id: string, status: string, reason: string): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    if (status !== '待跟进' && !reason) return this.ui.fail('请填写归档或暂缓原因');
    if (this.sale(id)?.convertedTo) return this.ui.fail('已转换线索不能归档，请到商机中处理');
    return this.write((s) => {
      const x = s.sales.find((x) => x.id === id)!;
      x.status = status;
      x.reason = reason;
      this.log(s, id, `${status}：${reason}`);
    }, '线索状态已更新');
  }
  convert(id: string): string | null {
    if (!this.allow(['sales', 'assistant', 'manager'])) return null;
    const x = this.sale(id);
    if (!x) return null;
    if (x.convertedTo) return x.convertedTo;
    if (['已归档', '暂缓跟进'].includes(x.status)) {
      this.ui.fail('请先恢复线索跟进状态');
      return null;
    }
    const c = this.contact(x);
    const missing = [
      !this.has(id, '需求导入表') ? '需求导入表' : '',
      !c?.name ? '主要联系人' : '',
      !(c?.phone || c?.email) ? '联系人联系方式' : '',
      !x.owner ? '销售负责人' : '',
    ].filter(Boolean);
    if (missing.length) {
      this.ui.fail(`还缺：${missing.join('、')}。请到资料或基础信息中补充`);
      return null;
    }
    const oid = newId('O');
    const ok = this.write((s) => {
      const lead = s.sales.find((x) => x.id === id)!;
      lead.status = '已转商机';
      lead.convertedTo = oid;
      lead.convertedDate = BASE_DATE;
      const opp = {
        ...structuredClone(lead),
        id: oid,
        type: 'opportunity' as const,
        status: '跟进中',
        leadId: id,
        convertedTo: '',
        operator: this.person(),
        quoteFlowMode: 'v2' as const,
      };
      s.sales.push(opp);
      for (const a of s.attachments.filter((a) => a.entityId === id))
        s.attachments.push({ ...a, id: newId('ATT'), entityId: oid, fileId: a.fileId || a.id });
      this.log(s, id, `转商机：${oid}`);
      this.log(s, oid, `由线索${id}转换，客户与资料带入`);
    }, '已转商机，客户、联系人、沟通与资料已带入');
    return ok ? oid : null;
  }
  addActivity(
    entityId: string,
    data: Omit<Activity, 'id' | 'entityId' | 'customerId' | 'operator' | 'stage'>,
  ): boolean {
    if (!this.allow(['sales', 'assistant', 'manager', 'solution', 'pm'])) return false;
    if (!data.summary || !data.date) return this.ui.fail('请填写沟通日期和摘要');
    if (!Number.isFinite(Date.parse(data.date)) || data.date > BASE_DATE)
      return this.ui.fail('沟通日期不得晚于演示基准日2026-10-10');
    const sale = this.sale(entityId);
    const p = this.project(entityId);
    return this.write((s) => {
      s.activities.push({
        ...data,
        id: newId('ACT'),
        entityId,
        customerId: sale?.customerId || p?.customerId || '',
        operator: this.person(),
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
  advance(id: string): boolean {
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    const x = this.sale(id);
    if (!x || isClosed(x)) return this.ui.fail('当前商机已关闭');
    if (x.quoteFlowMode === 'v2' && x.stage === '方案报价') {
      const versions = this.quoteSeries(id)?.versions || [];
      if (!versions.some((version) => ['已记录发出', '最终锁定'].includes(version.status))) return this.ui.fail('报价流程需至少记录一版已发出的报价后才能进入洽谈，请前往报价标签处理');
    }
    if (x.quoteFlowMode === 'v2' && x.stage === '洽谈') {
      const series = this.quoteSeries(id); const final = series?.versions.find((version) => version.id === series.activeFinalVersionId && version.status === '最终锁定');
      if (!final) return this.ui.fail('进入合同谈判前需要最终锁定报价，请前往报价标签处理');
    }
    if (x.stage === '意向沟通') {
      const missing = [
        !x.description ? '项目背景' : '',
        x.capacity <= 0 ? '预计容量' : '',
        x.amount <= 0 ? '预计金额' : '',
        !x.expectedDate ? '预计签单日期' : '',
        !x.grade ? '人工等级' : '',
        !this.contact(x) ? '主要联系人' : '',
        !x.tender ? '是否投标' : '',
        !this.has(id, '需求导入表') ? '需求导入表' : '',
      ].filter(Boolean);
      if (missing.length) return this.ui.fail(`还缺：${missing.join('、')}`);
      if (needsTenderTeam(x) && (x.team.length < 3 || x.team.some((t) => !t.confirmed)))
        return this.ui.fail('重点投标团队尚未确认，请由负责人指定，并由成员确认参与');
      if (['挂起', '降级'].includes(x.g1))
        return this.ui.fail('请先补齐G1待处理事项并重新提交模拟结果');
    } else if (
      !this.activities(id).some((a) => a.stage === x.stage && a.type !== '内部备注') &&
      !(x.stage === '方案报价' && this.has(id, '方案报价样例'))
    )
      return this.ui.fail('请先保存本阶段沟通结果或方案报价样例');
    if (x.stage === '合同谈判') return this.ui.fail('请记录赢单或丢单，并填写关闭原因');
    return this.write((s) => {
      const a = s.sales.find((x) => x.id === id)!;
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
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
    if (!reason || (result === '赢单' && !date))
      return this.ui.fail('请填写关闭原因；赢单需要成交日期');
    if (isClosed(this.sale(id)!)) return this.ui.fail('商机已关闭，请勿重复提交');
    if (result === '赢单' && this.sale(id)?.stage === '合同谈判' && !this.activities(id).some((a) => a.stage === '合同谈判' && a.type !== '内部备注'))
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
    if (!this.allow(['sales', 'assistant', 'manager'])) return false;
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
    if (!this.allow(['pm'])) return false;
    return this.write((s) => {
      const x = s.sales.find((x) => x.id === record.id)!;
      x.deliveryOpinion = record.deliveryOpinion;
      x.resourceWindow = record.resourceWindow;
      this.log(s, record.id, 'PM记录售前交付初判');
    }, '交付初判已保存');
  }
  assignTeam(id: string, team: TeamMember[]): boolean {
    if (!this.allow(['pmo'])) return false;
    return this.write((s) => {
      const object = s.sales.find((x) => x.id === id) || s.projects.find((x) => x.id === id);
      if (!object) throw new Error('未找到对象');
      object.team = team;
      for (const n of s.notices.filter((n) => n.entityId === id && n.key.startsWith('team'))) n.resolved = true;
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
    }, '团队已指定，确认待办已分发');
  }
  confirmTeam(id: string, memberId?: string): boolean {
    const object = this.sale(id) || this.project(id);
    if (!object) return false;
    const targets = object.team.filter((t) =>
      memberId ? t.id === memberId : t.role === this.role(),
    );
    if (!targets.length) return this.ui.fail('本角色没有待确认的团队席位');
    if (!this.allow([this.role()])) return false;
    if (memberId && targets[0].role !== this.role() && !(this.project(id) && this.role() === 'pm'))
      return this.ui.fail('请由对应成员确认，项目团队由PM最终确认');
    return this.write((s) => {
      const x = s.sales.find((x) => x.id === id) || s.projects.find((x) => x.id === id);
      for (const t of x!.team.filter((t) => targets.some((k) => k.id === t.id))) {
        t.confirmed = true;
        t.confirmedBy = this.person();
      }
      for (const n of s.notices.filter(
        (n) => n.entityId === id && n.key.startsWith('team') && n.role === this.role(),
      ))
        n.resolved = true;
      this.log(s, id, '确认团队参与/成员责任');
    }, '参与确认已记录');
  }
  g1(id: string, result: string, opinion: string): boolean {
    if (!this.allow(['pmo', 'manager'])) return false;
    if (result !== '通过' && !opinion) return this.ui.fail('请填写挂起或降级意见');
    return this.write((s) => {
      s.sales.find((x) => x.id === id)!.g1 = result;
      for (const n of s.notices.filter((n) => n.entityId === id && n.key.startsWith('g1-'))) n.resolved = true;
      this.notice(
        s,
        `g1-${id}-${result}`,
        id,
        'sales',
        `G1模拟结果：${result}`,
        opinion || '模拟通过，请销售继续推进',
      );
      this.log(s, id, `G1模拟结果：${result}，${opinion}`);
    }, 'G1演示结果已更新，不执行正式审批');
  }
  remind(id: string): boolean {
    if (!this.allow(['manager', 'sales'])) return false;
    const x = this.sale(id);
    if (!x || this.days(x) < 30) return this.ui.fail('该商机当前不满足冷却条件');
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
  bridge(id: string): string | null {
    if (!this.allow(['sales', 'assistant', 'manager', 'pm'])) return null;
    const x = this.sale(id);
    if (x?.stage !== '赢单') {
      this.ui.fail('需先记录赢单；合同/G3随后显式加载模拟结果');
      return null;
    }
    const quoteSeries = this.quoteSeries(id);
    const finalQuote = quoteSeries?.versions.find((version) => version.id === quoteSeries.activeFinalVersionId && version.status === '最终锁定');
    if (x.quoteFlowMode === 'v2' && !finalQuote) { this.ui.fail('V2报价流程需要先锁定最终报价'); return null; }
    const existing = this.state().projects.find((p) => p.opportunityId === id);
    if (existing) return existing.id;
    const pid = newId('P');
    return this.write((s) => {
      const cid = newId('CON');
      s.contracts.push({
        id: cid,
        opportunityId: id,
        customerId: x.customerId,
        amount: finalQuote ? this.quoteTotals(finalQuote).total! : x.amount,
        currency: finalQuote?.currency || x.currency,
        payment: '签约30% / 发货60% / 验收10%（样例）',
        penalty: '演示合同约定',
        product: '储能系统',
        g3: '已通过（模拟）',
        ...(finalQuote ? { quoteVersionId: finalQuote.id, quoteSeriesId: quoteSeries!.id } : {}),
      });
      const p = blankProject(pid, x.customerId, id, cid);
      p.name = x.projectName;
      p.capacity = x.capacity;
      p.unit = x.unit;
      p.contactId = x.contactId;
      p.team = [
        { id: newId('TM'), role: 'sales', person: x.owner, department: '销售', window: x.resourceWindow || '待确认', confirmed: true, confirmedBy: this.person() },
        ...x.team.map((member) => ({ ...structuredClone(member), confirmed: false, confirmedBy: '' })),
      ];
      s.projects.push(p);
      this.notice(
        s,
        `accept-${pid}`,
        pid,
        'pm',
        '请接收交付项目',
        '已关联演示合同和来源商机，请完善现场信息。',
      );
      this.log(s, pid, '加载已签约合同/G3模拟来源');
    }, '已加载合同与G3样例，进入交付演示')
      ? pid
      : null;
  }
  saveProject(project: Project): boolean {
    if (!this.allow(['pm'])) return false;
    return this.write((s) => {
      const index = s.projects.findIndex((p) => p.id === project.id);
      if (index < 0) s.projects.push(project);
      else s.projects[index] = project;
      this.log(s, project.id, '保存项目现场与业务信息');
    }, '项目信息已保存');
  }
  createProjectDraft(name: string, pm: string, site: string, opportunityId = ''): string | null {
    if (!this.allow(['pm'])) return null;
    if (!name || !pm) { this.ui.fail('请填写项目名称和拟任PM'); return null; }
    const opportunity = opportunityId ? this.sale(opportunityId) : undefined;
    if (opportunityId && (!opportunity || opportunity.stage === '丢单')) { this.ui.fail('请选择有效商机'); return null; }
    const id = newId('P');
    return this.write((s) => {
      const p = blankProject(id, opportunity?.customerId || '', opportunityId, '');
      p.name = name; p.pm = pm; p.site = site; p.start = ''; p.status = opportunity ? '待准备交付' : '待关联商机';
      if (opportunity) { p.contactId = opportunity.contactId; p.capacity = opportunity.capacity; p.unit = opportunity.unit; p.team = structuredClone(opportunity.team); }
      s.projects.push(p); this.log(s, id, opportunityId ? `创建项目草稿并关联商机${opportunityId}` : '创建待关联商机的项目草稿');
    }, '项目号已生成，项目草稿已保存') ? id : null;
  }
  associateProject(id: string, opportunityId: string): boolean {
    if (!this.allow(['pm'])) return false;
    const p = this.project(id); const opportunity = this.sale(opportunityId);
    if (!p || p.opportunityId || p.contractId) return this.ui.fail('仅未关联来源的项目草稿可以关联商机');
    if (!opportunity || opportunity.stage === '丢单') return this.ui.fail('请选择有效商机');
    return this.write((s) => {
      const target = s.projects.find((x) => x.id === id)!; const source = s.sales.find((x) => x.id === opportunityId)!;
      target.opportunityId = source.id; target.customerId = source.customerId; target.contactId = source.contactId;
      target.capacity = source.capacity; target.unit = source.unit; target.team = structuredClone(source.team);
      target.status = source.stage === '赢单' ? '待准备交付' : '待准备交付';
      this.log(s, id, `关联来源商机${source.id}`);
    }, '来源商机已关联，项目号保持不变');
  }
  loadProjectContract(id: string): boolean {
    if (!this.allow(['pm'])) return false;
    const project = this.project(id); const opportunity = this.sale(project?.opportunityId || '');
    if (!project || !opportunity || opportunity.stage !== '赢单') return this.ui.fail('来源商机赢单后才能加载合同/G3模拟来源');
    const quoteSeries = this.quoteSeries(opportunity.id);
    const finalQuote = quoteSeries?.versions.find((version) => version.id === quoteSeries.activeFinalVersionId && version.status === '最终锁定');
    if (opportunity.quoteFlowMode === 'v2' && !finalQuote) return this.ui.fail('V2报价流程需要先锁定最终报价');
    return this.write((s) => {
      const p = s.projects.find((x) => x.id === id)!;
      let contract = s.contracts.find((x) => x.opportunityId === opportunity.id);
      if (!contract) {
        contract = { id: newId('CON'), opportunityId: opportunity.id, customerId: opportunity.customerId, amount: finalQuote ? this.quoteTotals(finalQuote).total! : opportunity.amount, currency: finalQuote?.currency || opportunity.currency, payment: finalQuote?.payment || '签约30% / 发货60% / 验收10%（样例）', penalty: '演示合同约定', product: '储能系统', g3: '已通过（模拟）', ...(finalQuote ? { quoteVersionId: finalQuote.id, quoteSeriesId: quoteSeries!.id } : {}) };
        s.contracts.push(contract);
      }
      p.contractId = contract.id; p.status = '待启动'; this.log(s, id, '显式加载合同/G3模拟来源');
    }, '合同与G3模拟来源已加载');
  }
  acceptProject(id: string): boolean {
    if (!this.allow(['pm'])) return false;
    const candidate = this.project(id);
    if (!candidate?.opportunityId || !candidate.contractId) return this.ui.fail('请先关联赢单商机并加载合同/G3模拟来源');
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
      s.projects.push(p);
      this.log(s, id, `新增子项目，引用合同${parent.contractId}`);
    }, '子项目已创建，计划与资料独立维护')
      ? id
      : null;
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
  submitBriefing(id: string): boolean {
    if (!this.allow(['pm'])) return false;
    const missing = this.briefingMissing(id);
    if (missing.length) return this.ui.fail(`还缺：${missing.join('、')}。可在交底资料区补齐`);
    return this.write((s) => {
      const p = s.projects.find((p) => p.id === id)!;
      p.briefing.review = '模拟审核中';
      p.needsReview = false;
      for (const n of s.notices.filter((n) => n.entityId === id && n.key.startsWith('return-'))) n.resolved = true;
      this.notice(
        s,
        `review-${id}`,
        id,
        'pmo',
        '交底待查看OA模拟结果',
        '请应用预置通过、附条件通过或退回结果。',
      );
      this.log(s, id, '提交交底，资料完整性不等于审核通过');
      this.syncMilestone(s.projects.find((x) => x.id === id)!, '项目启动交底', '进行中');
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
      if (result === '通过' || result === '附条件通过') x.status = '项目执行中';
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
    if (plan.type === '产研来源') return false;
    if (this.role() === 'pm') return true;
    if (this.role() === 'member') return plan.type === '内部WBS' && plan.owner === this.person();
    if (this.role() === 'sales') return plan.type === '客户主节点';
    if (this.role() === 'opm') return plan.type === '要货发货';
    if (this.role() === 'quality') return plan.type === 'FAT测试';
    return false;
  }
  savePlan(projectId: string, plan: Plan): boolean {
    if (!this.canEditPlan(plan))
      return this.ui.fail('本角色不能修改此计划，产研及实际来源始终只读');
    if (!plan.name || !validDateRange(plan.start, plan.end))
      return this.ui.fail('请填写名称及有效起止日期，开始不能晚于结束');
    if (
      !Number.isFinite(plan.amount) ||
      plan.amount < 0 ||
      !Number.isInteger(plan.quantity) ||
      plan.quantity <= 0
    )
      return this.ui.fail('金额不能为负数，数量必须是正整数');
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
        /启动/.test(plan.name) &&
        (this.briefingMissing(projectId).length ||
          !['通过', '附条件通过'].includes(this.project(projectId)!.briefing.review))
      )
        return this.ui.fail('启动任务需资料齐备，并查看模拟交底结果');
      if (/验收|移交/.test(plan.name))
        return this.ui.fail('关键验收/移交任务请在专用页面完成，不能用普通状态绕过');
    }
    return this.write((s) => {
      const p = s.projects.find((p) => p.id === projectId)!;
      const i = p.plans.findIndex((x) => x.id === plan.id);
      if (i >= 0) p.plans[i] = plan;
      else p.plans.push(plan);
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
      this.log(s, projectId, `保存${plan.type}：${plan.name}`);
    }, '计划已保存，相关视图同步更新');
  }
  deletePlan(id: string, planId: string): boolean {
    const plan = this.project(id)!.plans.find((p) => p.id === planId)!;
    if (!this.canEditPlan(plan)) return this.ui.fail('当前角色不能删除该计划');
    if (plan.status === '已完成') return this.ui.fail('已完成计划保留历史，请修改或重新复核');
    return this.write((s) => {
      const p = s.projects.find((p) => p.id === id)!;
      p.plans = p.plans.filter((x) => x.id !== planId);
      this.log(s, id, `删除计划草稿：${plan.name}`);
    }, '计划行已删除');
  }
  applyTemplate(id: string, regional: boolean): boolean {
    if (!this.allow(['pm'])) return false;
    return this.write((s) => {
      const p = s.projects.find((p) => p.id === id)!;
      p.plans = [
        ...p.plans.filter((x) => x.type !== '内部WBS'),
        ...makePlans(newId('WBS'), regional).map((x) => ({ ...x, status: '未开始', actual: '' })),
      ];
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
    if (complete && (!date || result !== '合格' || !this.has(id, 'SAT报告')))
      return this.ui.fail('SAT完成需要测试日期、合格结论与报告');
    return this.write(
      (s) => {
        const p = s.projects.find((p) => p.id === id)!;
        p.sat = { date, result, complete };
        p.status = complete ? '客户验收中' : 'SAT测试中';
        if (complete) {
          p.needsReview = false;
          this.syncMilestone(p, '调试测试', '已完成', date);
        } else {
          p.needsReview = true;
          if (p.handover.status !== '草稿') p.handover.opinion = 'SAT资料变化，接收前需重新复核';
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
      Object.assign(a, { result, signer, date, note });
      p.acceptanceComplete = false;
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
      project.status = '客户验收中';
      this.syncMilestone(project, '客户验收', '已完成', BASE_DATE);
      project.needsReview = false;
      this.log(s, id, '记录客户逐项验收完成，非电子签章');
    }, '客户验收已记录完成');
  }
  saveHandover(id: string, project: Project): boolean {
    if (!this.allow(['pm'])) return false;
    return this.write((s) => {
      const current = s.projects.find((p) => p.id === id)!;
      const changed = JSON.stringify(current.handover) !== JSON.stringify(project.handover);
      current.handover = project.handover;
      if (changed && current.handover.status === '待接收') {
        current.handover.status = '草稿';
        current.handover.opinion = '资料已变更，请重新提交并复核';
        for (const n of s.notices.filter((n) => n.key === `handover-${id}`)) n.resolved = true;
      }
      this.log(s, id, '保存移交资料与遗留事项草稿');
    }, '移交草稿已保存');
  }
  submitHandover(id: string): boolean {
    if (!this.allow(['pm'])) return false;
    const p = this.project(id)!;
    if (!p.sat.complete || !this.has(id, 'SAT报告'))
      return this.ui.fail('SAT尚未完成或报告需复核，请先完成SAT及凭据');
    if (
      !p.handover.receiver ||
      p.handover.categories.some(
        (c) => c.status === '待补' || (c.status === '不适用' && !c.note),
      ) ||
      p.handover.issues.some((i) => !i.owner || !i.due)
    )
      return this.ui.fail('请明确接收方、补齐八类资料状态和不适用原因，并填写遗留事项负责人/期限');
    if (p.handover.status === '已接收') return this.ui.fail('移交已接收，请保留历史');
    return this.write((s) => {
      s.projects.find((p) => p.id === id)!.handover.status = '待接收';
      for (const n of s.notices.filter((n) => n.entityId === id && n.key.startsWith('handover-return-'))) n.resolved = true;
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
    if (!p.sat.complete || !this.has(id, 'SAT报告'))
      return this.ui.fail('SAT凭据变化，需PM重新复核后提交');
    if (!p.handover.receiver || p.handover.categories.length !== 8 || p.handover.categories.some(c => c.status === '待补' || (c.status === '不适用' && !c.note)) || p.handover.issues.some(i => !i.owner || !i.due))
      return this.ui.fail('移交资料已不完整，请PM补齐后重新提交');
    if (!p.handover.receiver || p.handover.categories.length !== 8 || p.handover.categories.some(c => c.status === '待补' || (c.status === '不适用' && !c.note)) || p.handover.issues.some(i => !i.owner || !i.due))
      return this.ui.fail('移交资料已不完整，请PM补齐八类资料、接收方和遗留事项后重新提交');
    if (result === '退回补充' && !opinion) return this.ui.fail('请填写具体退回原因');
    return this.write(
      (s) => {
        const p = s.projects.find((p) => p.id === id)!;
        p.handover.status = result;
        p.handover.opinion = opinion;
        if (result === '已接收') {
          p.status = '已移交';
          this.syncMilestone(p, '内部移交', '已完成', BASE_DATE);
          p.needsReview = false;
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
    const plan = project.plans.find((x) => x.type === '内部WBS' && x.name === name);
    if (plan) { plan.status = status; if (status === '已完成') plan.actual = actual || BASE_DATE; }
  }
  canAttach(id: string, kind: string): boolean {
    if (this.sale(id))
      return this.salesEditable() || (this.role() === 'solution' && kind === '方案报价样例');
    return (
      this.internal() &&
      (['pm', 'solution'].includes(this.role()) ||
        (this.role() === 'quality' && kind === 'FAT报告'))
    );
  }
  async upload(id: string, kind: string, file: File): Promise<boolean> {
    if (!this.canAttach(id, kind)) return this.ui.fail('本角色不能上传此类资料');
    if (!file.size) return this.ui.fail('空文件不能作为有效资料');
    if (file.size > 10 * 1024 * 1024) return this.ui.fail('单文件不能超过10MB');
    if (!/\.(xlsx?|docx|pdf)$/i.test(file.name))
      return this.ui.fail('请选择xlsx、xls、docx或pdf文件');
    if (
      this.state()
        .attachments.filter((a) => !a.sample)
        .reduce((n, a) => n + a.size, 0) +
        file.size >
      50 * 1024 * 1024
    )
      return this.ui.fail('本轮附件总容量不能超过50MB');
    const aid = newId('ATT');
    try {
      await this.files.put(aid, file);
      const ok = this.write((s) => {
        s.attachments.push({
          id: aid,
          entityId: id,
          kind,
          name: file.name,
          size: file.size,
          date: BASE_DATE,
          operator: this.person(),
          sample: false,
          url: '',
        });
        this.log(s, id, `上传${kind}：${file.name}`);
      }, '文件已保存到本地，可刷新后查看');
      if (!ok) await this.files.delete(aid);
      return ok;
    } catch (e) {
      return this.ui.fail(e instanceof Error ? e.message : '文件保存失败');
    }
  }
  sample(id: string, kind: string): boolean {
    if (!this.canAttach(id, kind)) return this.ui.fail('本角色不能补充此类资料');
    if (this.has(id, kind)) {
      this.ui.notify('该类样例已关联，可直接查看');
      return true;
    }
    return this.write((s) => {
      s.attachments.push({
        id: newId('ATT'),
        entityId: id,
        kind,
        name: `演示_${kind}.pdf`,
        size: 1800,
        date: BASE_DATE,
        operator: this.person(),
        sample: true,
        url: `/samples/${kind}.pdf`,
      });
      this.log(s, id, `关联演示附件：${kind}`);
    }, '演示附件已关联，上传不等于业务审核通过');
  }
  async openFile(a: Attachment): Promise<void> {
    try {
      if (a.sample) {
        window.open(a.url, '_blank', 'noopener');
        return;
      }
      const blob = await this.files.get(a.fileId || a.id);
      if (!blob) {
        this.ui.fail('本地文件已不可用，请重新上传');
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      this.ui.fail(e instanceof Error ? e.message : '无法打开文件');
    }
  }
  async removeAttachment(a: Attachment): Promise<boolean> {
    if (!this.canAttach(a.entityId, a.kind)) return this.ui.fail('本角色不能删除资料');
    try {
      if (
        !a.sample &&
        !this.state().attachments.some(
          (x) => x.id !== a.id && (x.fileId || x.id) === (a.fileId || a.id),
        )
      )
        await this.files.delete(a.fileId || a.id);
      return this.write((s) => {
        s.attachments = s.attachments.filter((x) => x.id !== a.id);
        const sale = s.sales.find((x) => x.id === a.entityId);
        const p = s.projects.find((x) => x.id === a.entityId);
        if (sale) {
          sale.needsReview = true;
          this.notice(
            s,
            `attachment-${a.entityId}`,
            a.entityId,
            'sales',
            '关键资料需复核',
            `${a.kind}已删除，请补齐。`,
          );
        }
        if (p) {
          p.needsReview = true;
          if (a.kind === 'SAT报告') p.sat.complete = false;
          if (a.kind === '客户签字清单') p.acceptanceComplete = false;
          if (a.kind === 'FAT报告')
            for (const plan of p.plans.filter((x) => x.type === 'FAT测试')) plan.status = '需复核';
          if (['启动纪要', '启动文件'].includes(a.kind)) p.briefing.review = '资料需复核';
        }
        this.log(s, a.entityId, `删除${a.kind}，相关节点需复核`);
      }, '资料已删除，关键状态重新检查');
    } catch (e) {
      return this.ui.fail(e instanceof Error ? e.message : '删除失败');
    }
  }
  async reset(): Promise<boolean> {
    try {
      await this.files.clear();
      const state = createSeed();
      localStorage.setItem(KEY, JSON.stringify(state));
      this.state.set(state);
      this.ui.notify('已恢复初始样例，当前练习记录已清除');
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
